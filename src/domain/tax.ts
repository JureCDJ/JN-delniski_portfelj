import Decimal from 'decimal.js';
import { fullYearsBetween, parseIsoDate, type IsoDate } from './dates';
import type { Disposal, Lot } from './portfolio';

// Davčni izračuni po pravilih iz lastnikove Apps Script aplikacije (Code.gs v3).
// Stopnje NISO trdo v kodi — pridejo iz tabele tax_settings, ki jih lastnik potrdi.
//
//   osnova  = prodajna vrednost × (1 − n) − nabavna vrednost × (1 + n)     (n = normirani stroški, npr. 1 %)
//   stopnja = po dopolnjenih letih imetništva lota (npr. 25 % / 20 % po 5 / 15 % po 10 / 0 % po 15 letih)
//   davek   = max(0, osnova) × stopnja                                      (po lotu, brez pobota izgub)
//
// Pobot izgub med posli istega leta je del napovedi Doh-KDVP (ločena funkcija, rezina 7).

const ZERO = new Decimal(0);

export interface TaxBracket {
  /** Od koliko dopolnjenih let imetništva velja stopnja. */
  fromYears: number;
  /** Stopnja kot decimalni niz, npr. '0.25'. */
  rate: string;
}

export interface TaxSettings {
  capitalGains: TaxBracket[];
  dividendRate: string;
  /** Normirani stroški ob pridobitvi in ob odsvojitvi, npr. '0.01'. */
  standardCostRate: string;
}

export class TaxSettingsError extends Error {}

export function validateTaxSettings(s: TaxSettings): TaxSettings {
  const b = [...s.capitalGains].sort((x, y) => x.fromYears - y.fromYears);
  if (!b.length || b[0]!.fromYears !== 0) throw new TaxSettingsError('Prva davčna stopnja mora veljati od 0 let.');
  for (const x of b) {
    const r = new Decimal(x.rate);
    if (r.lt(0) || r.gt(1) || !Number.isInteger(x.fromYears) || x.fromYears < 0) {
      throw new TaxSettingsError(`Neveljavna stopnja: od ${x.fromYears} let = ${x.rate}`);
    }
  }
  for (const v of [s.dividendRate, s.standardCostRate]) {
    const r = new Decimal(v);
    if (r.lt(0) || r.gt(1)) throw new TaxSettingsError(`Neveljavna stopnja: ${v}`);
  }
  return { ...s, capitalGains: b };
}

export function rateForYears(s: TaxSettings, years: number): Decimal {
  let rate = new Decimal(s.capitalGains[0]!.rate);
  for (const b of s.capitalGains) if (years >= b.fromYears) rate = new Decimal(b.rate);
  return rate;
}

export interface TaxPart {
  gainEur: Decimal;
  baseEur: Decimal;
  years: number;
  rate: Decimal;
  taxEur: Decimal;
}

export function taxOnPart(
  part: { costEur: Decimal; proceedsEur: Decimal; buyDate: IsoDate; sellDate: IsoDate },
  s: TaxSettings,
): TaxPart {
  const n = new Decimal(s.standardCostRate);
  const baseEur = part.proceedsEur.mul(new Decimal(1).minus(n)).minus(part.costEur.mul(new Decimal(1).plus(n)));
  const years = fullYearsBetween(part.buyDate, part.sellDate);
  const rate = rateForYears(s, years);
  return {
    gainEur: part.proceedsEur.minus(part.costEur),
    baseEur,
    years,
    rate,
    taxEur: Decimal.max(ZERO, baseEur).mul(rate),
  };
}

export interface SaleEstimate {
  gainEur: Decimal;
  taxEur: Decimal;
  netEur: Decimal;
}

/** Ocena, če bi danes prodal vse odprte lote po ceni `priceEur` na kos. */
export function estimateSaleOfLots(lots: Lot[], priceEur: Decimal.Value, date: IsoDate, s: TaxSettings): SaleEstimate {
  let gainEur = ZERO;
  let taxEur = ZERO;
  for (const l of lots) {
    const t = taxOnPart({ costEur: l.costEur, proceedsEur: l.quantity.mul(priceEur), buyDate: l.buyDate, sellDate: date }, s);
    gainEur = gainEur.plus(t.gainEur);
    taxEur = taxEur.plus(t.taxEur);
  }
  return { gainEur, taxEur, netEur: gainEur.minus(taxEur) };
}

/** Ocena davka za že izvedene prodaje (po lotu, brez pobota). */
export function taxOnDisposals(disposals: Disposal[], s: TaxSettings): Decimal {
  return disposals.reduce(
    (sum, d) => sum.plus(taxOnPart({ costEur: d.costEur, proceedsEur: d.proceedsEur, buyDate: d.buyDate, sellDate: d.sellDate }, s).taxEur),
    ZERO,
  );
}

function addYears(date: IsoDate, years: number): IsoDate {
  const { y, m, day } = parseIsoDate(date);
  const ty = y + years;
  // 29. februar v neprestopnem letu → 1. marec (enako kot štetje polnih let v dates.ts).
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  if (m === 2 && day === 29 && !leap) return `${ty}-03-01`;
  return `${ty}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Kdaj lot preide v naslednjo nižjo davčno stopnjo (ali null, če nižje ni). */
export function nextLowerRate(buyDate: IsoDate, today: IsoDate, s: TaxSettings): { date: IsoDate; rate: Decimal } | null {
  const years = fullYearsBetween(buyDate, today);
  const current = rateForYears(s, years);
  const next = s.capitalGains.find((b) => b.fromYears > years && new Decimal(b.rate).lt(current));
  return next ? { date: addYears(buyDate, next.fromYears), rate: new Decimal(next.rate) } : null;
}
