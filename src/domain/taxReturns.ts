import Decimal from 'decimal.js';
import { compareIsoDate, type IsoDate } from './dates';
import type { Dividend } from './overview';
import { buildLedger } from './portfolio';
import { daysBetween } from './quotes';
import { taxOnPart, type TaxSettings } from './tax';
import type { Trade } from './types';

// Davčne napovedi po letih (rezina 7), po pravilih iz lastnikove Apps Script aplikacije (Code.gs v3):
//
// Doh-KDVP — po FIFO lotih:
//   osnova lota  = kupnina × (1 − n) − nabavna × (1 + n)
//   D = vsota pozitivnih osnov, I = vsota izgub, neto = max(0, D − I)
//   izgube se pobotajo SORAZMERNO po stopnjah: del stopnje = (dobički te stopnje / D) × neto
//   davek = Σ del stopnje × stopnja
//   opozorilo: lot z izgubo in nakup istega papirja v ±30 dneh (razen nakupa tega lota)
//
// Doh-Div — vsako izplačilo je svoja vrstica:
//   SI davek = bruto × stopnja dividend, doplačilo = max(0, SI davek − tuji davek)
//
// Končni izračun naredi FURS; to je ocena. Stopnje pridejo iz tax_settings (potrdi lastnik).

const ZERO = new Decimal(0);
const WASH_DAYS = 30;

const yearOf = (d: IsoDate) => Number(d.slice(0, 4));

export interface KdvpRow {
  isin: string;
  sellTradeId: string;
  buyTradeId: string;
  sellDate: IsoDate;
  buyDate: IsoDate;
  quantity: Decimal;
  costEur: Decimal;
  proceedsEur: Decimal;
  gainEur: Decimal;
  baseEur: Decimal;
  years: number;
  rate: Decimal;
  /** Nakupi istega papirja v ±30 dneh od prodaje, kadar ima lot izgubo. */
  washBuys: IsoDate[];
}

export interface KdvpRateLine {
  rate: Decimal;
  gainsEur: Decimal;
  baseAfterOffsetEur: Decimal;
  taxEur: Decimal;
}

export interface KdvpYear {
  year: number;
  rows: KdvpRow[];
  proceedsEur: Decimal;
  costEur: Decimal;
  gainEur: Decimal;
  /** Vsota pozitivnih davčnih osnov. */
  gainsBaseEur: Decimal;
  /** Vsota izgub (pozitivno število). */
  lossesBaseEur: Decimal;
  netBaseEur: Decimal;
  byRate: KdvpRateLine[];
  taxEur: Decimal;
  washCount: number;
}

/** Leta, v katerih so prodaje ali dividende (najnovejše najprej). */
export function taxYears(trades: Trade[], dividends: Dividend[]): number[] {
  const ys = new Set<number>();
  for (const t of trades) if (t.type === 'PRODAJA') ys.add(yearOf(t.date));
  for (const d of dividends) ys.add(yearOf(d.date));
  return [...ys].sort((a, b) => b - a);
}

export function kdvpYear(trades: Trade[], settings: TaxSettings, year: number): KdvpYear {
  const buysByIsin = new Map<string, Trade[]>();
  for (const t of trades) {
    if (t.type !== 'NAKUP') continue;
    const l = buysByIsin.get(t.isin) ?? [];
    l.push(t);
    buysByIsin.set(t.isin, l);
  }

  const rows: KdvpRow[] = buildLedger(trades)
    .disposals.filter((d) => yearOf(d.sellDate) === year)
    .map((d) => {
      const t = taxOnPart(d, settings);
      const washBuys = t.baseEur.lt(0)
        ? (buysByIsin.get(d.isin) ?? [])
            .filter((b) => b.id !== d.buyTradeId && Math.abs(daysBetween(d.sellDate, b.date)) <= WASH_DAYS)
            .map((b) => b.date)
        : [];
      return {
        isin: d.isin,
        sellTradeId: d.sellTradeId,
        buyTradeId: d.buyTradeId,
        sellDate: d.sellDate,
        buyDate: d.buyDate,
        quantity: d.quantity,
        costEur: d.costEur,
        proceedsEur: d.proceedsEur,
        gainEur: d.gainEur,
        baseEur: t.baseEur,
        years: t.years,
        rate: t.rate,
        washBuys,
      };
    })
    .sort((a, b) => compareIsoDate(a.sellDate, b.sellDate) || compareIsoDate(a.buyDate, b.buyDate));

  const sum = (f: (r: KdvpRow) => Decimal) => rows.reduce((s, r) => s.plus(f(r)), ZERO);
  const D = rows.reduce((s, r) => (r.baseEur.gt(0) ? s.plus(r.baseEur) : s), ZERO);
  const I = rows.reduce((s, r) => (r.baseEur.lt(0) ? s.minus(r.baseEur) : s), ZERO);
  const neto = Decimal.max(ZERO, D.minus(I));

  const gainsByRate = new Map<string, Decimal>();
  for (const r of rows) {
    if (r.baseEur.lte(0)) continue;
    const k = r.rate.toString();
    gainsByRate.set(k, (gainsByRate.get(k) ?? ZERO).plus(r.baseEur));
  }
  const byRate: KdvpRateLine[] = [...gainsByRate.entries()]
    .map(([k, gains]) => {
      const rate = new Decimal(k);
      const share = D.gt(0) ? gains.div(D).mul(neto) : ZERO;
      return { rate, gainsEur: gains, baseAfterOffsetEur: share, taxEur: share.mul(rate) };
    })
    .sort((a, b) => b.rate.cmp(a.rate));

  return {
    year,
    rows,
    proceedsEur: sum((r) => r.proceedsEur),
    costEur: sum((r) => r.costEur),
    gainEur: sum((r) => r.gainEur),
    gainsBaseEur: D,
    lossesBaseEur: I,
    netBaseEur: neto,
    byRate,
    taxEur: byRate.reduce((s, x) => s.plus(x.taxEur), ZERO),
    washCount: rows.filter((r) => r.washBuys.length > 0).length,
  };
}

// ───────────────────────────── popisni list (XML) ─────────────────────────────

export interface InventoryRow {
  kind: 'NAKUP' | 'PRODAJA';
  date: IsoDate;
  quantity: Decimal;
  /** Vrednost na enoto v EUR (nakup: z deležem provizije; prodaja: po odbitku provizije) — kot v izračunu FIFO. */
  unitEur: Decimal;
  /** Zaloga po vrstici. */
  stock: Decimal;
}

export interface InventorySheet {
  isin: string;
  rows: InventoryRow[];
}

/**
 * Popisni listi za Doh-KDVP: za vsak papir s prodajo v letu vsi posli od prvega nakupa do konca leta,
 * v enakem vrstnem redu kot FIFO (po datumu, isti dan nakup pred prodajo), z zalogo po vsaki vrstici.
 */
export function kdvpInventory(trades: Trade[], year: number): InventorySheet[] {
  const soldIsins = [...new Set(trades.filter((t) => t.type === 'PRODAJA' && yearOf(t.date) === year).map((t) => t.isin))].sort();
  return soldIsins.map((isin) => {
    const own = trades
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.isin === isin && yearOf(t.date) <= year)
      .sort((a, b) => compareIsoDate(a.t.date, b.t.date) || (a.t.type === b.t.type ? a.i - b.i : a.t.type === 'NAKUP' ? -1 : 1))
      .map(({ t }) => t);
    let stock = ZERO;
    const rows = own.map((t): InventoryRow => {
      const q = new Decimal(t.quantity);
      const gross = q.mul(t.price);
      const fee = new Decimal(t.fee);
      const totalEur = (t.type === 'NAKUP' ? gross.plus(fee) : gross.minus(fee)).div(t.ratePerEur);
      stock = t.type === 'NAKUP' ? stock.plus(q) : stock.minus(q);
      return { kind: t.type, date: t.date, quantity: q, unitEur: totalEur.div(q), stock };
    });
    return { isin, rows };
  });
}

// ───────────────────────────── Doh-Div ─────────────────────────────

export interface DivRow {
  isin: string;
  date: IsoDate;
  grossEur: Decimal;
  foreignTaxEur: Decimal;
  siTaxEur: Decimal;
  topUpEur: Decimal;
}

export interface DivYear {
  year: number;
  rate: Decimal;
  rows: DivRow[];
  /**
   * Izplačila slovenskih izdajateljev (ISIN SI…): izplačevalec je plačnik davka in davek odtegne sam,
   * zato ne sodijo v Doh-Div (FURS: napoved se vloži, »kadar dividende izplača oseba, ki ni plačnik davka«).
   */
  domesticRows: DivRow[];
  grossEur: Decimal;
  foreignTaxEur: Decimal;
  siTaxEur: Decimal;
  topUpEur: Decimal;
  byIsin: { isin: string; count: number; grossEur: Decimal; foreignTaxEur: Decimal; topUpEur: Decimal }[];
}

/** Izplačila leta: bruto in tuji davek istega papirja na isti dan sta ena vrstica. */
export function divYear(dividends: Dividend[], settings: TaxSettings, year: number): DivYear {
  const rate = new Decimal(settings.dividendRate);
  const grouped = new Map<string, { isin: string; date: IsoDate; gross: Decimal; foreign: Decimal }>();
  for (const d of dividends) {
    if (yearOf(d.date) !== year) continue;
    const k = `${d.isin}|${d.date}`;
    const g = grouped.get(k) ?? { isin: d.isin, date: d.date, gross: ZERO, foreign: ZERO };
    g.gross = g.gross.plus(d.grossEur);
    g.foreign = g.foreign.plus(d.foreignTaxEur);
    grouped.set(k, g);
  }
  const all: DivRow[] = [...grouped.values()]
    .map((g) => {
      const si = g.gross.mul(rate);
      return { isin: g.isin, date: g.date, grossEur: g.gross, foreignTaxEur: g.foreign, siTaxEur: si, topUpEur: Decimal.max(ZERO, si.minus(g.foreign)) };
    })
    .sort((a, b) => compareIsoDate(a.date, b.date) || a.isin.localeCompare(b.isin));
  const rows = all.filter((r) => !r.isin.startsWith('SI'));
  const domesticRows = all.filter((r) => r.isin.startsWith('SI'));

  const by = new Map<string, DivYear['byIsin'][number]>();
  for (const r of rows) {
    const x = by.get(r.isin) ?? { isin: r.isin, count: 0, grossEur: ZERO, foreignTaxEur: ZERO, topUpEur: ZERO };
    x.count += 1;
    x.grossEur = x.grossEur.plus(r.grossEur);
    x.foreignTaxEur = x.foreignTaxEur.plus(r.foreignTaxEur);
    x.topUpEur = x.topUpEur.plus(r.topUpEur);
    by.set(r.isin, x);
  }
  const sum = (f: (r: DivRow) => Decimal) => rows.reduce((s, r) => s.plus(f(r)), ZERO);
  return {
    year,
    rate,
    rows,
    domesticRows,
    grossEur: sum((r) => r.grossEur),
    foreignTaxEur: sum((r) => r.foreignTaxEur),
    siTaxEur: sum((r) => r.siTaxEur),
    topUpEur: sum((r) => r.topUpEur),
    byIsin: [...by.values()].sort((a, b) => b.grossEur.cmp(a.grossEur)),
  };
}
