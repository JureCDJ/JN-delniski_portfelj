import Decimal from 'decimal.js';
import { compareIsoDate, type IsoDate } from './dates';
import type { Dividend } from './overview';
import { buildLedger, type Disposal } from './portfolio';
import { daysBetween, rateOn, type FxRow, type PriceRow } from './quotes';
import { taxOnPart, type TaxPart, type TaxSettings } from './tax';
import type { Trade } from './types';

// Kartica delnice (rezina 6) in predogled prodaje.
// Predogled uporabi ISTO funkcijo kot izračun portfelja (buildLedger): prodajo začasno doda
// k obstoječim poslom in prebere nastale odsvojitve — zato se predogled in shranjena prodaja
// ne moreta razlikovati.

const ZERO = new Decimal(0);
const PREVIEW_ID = '__predogled__';

/** Pravilo iz Code.gs: izguba ob nakupu istega papirja v ±30 dneh od prodaje morda ni priznana. */
const WASH_DAYS = 30;

export interface SaleInput {
  isin: string;
  date: IsoDate;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  ratePerEur: string;
}

export interface SalePart extends TaxPart {
  buyTradeId: string;
  buyDate: IsoDate;
  quantity: Decimal;
  costEur: Decimal;
  proceedsEur: Decimal;
}

export interface SalePreview {
  parts: SalePart[];
  /** Količina v lasti na dan prodaje (pred prodajo). */
  heldBefore: Decimal;
  proceedsEur: Decimal;
  costEur: Decimal;
  gainEur: Decimal;
  baseEur: Decimal;
  taxEur: Decimal;
  /** Dobiček po davku (ocena po lotih, brez pobota z drugimi prodajami v letu). */
  netEur: Decimal;
  /** Nakupi istega papirja v ±30 dneh, kadar ima prodaja izgubo. */
  washBuys: { date: IsoDate; quantity: Decimal }[];
}

/** Količina papirja v lasti na dan `date` (vključno s posli tistega dne). */
export function heldOn(trades: Trade[], isin: string, date: IsoDate): Decimal {
  const upTo = trades.filter((t) => t.isin === isin && compareIsoDate(t.date, date) <= 0);
  return buildLedger(upTo).openLots.reduce((s, l) => s.plus(l.quantity), ZERO);
}

/**
 * Predogled prodaje po FIFO. Vrže PortfolioError, če prodaja preseže količino v lasti
 * (tudi če bi kasnejša, že vpisana prodaja s tem postala neizvedljiva).
 */
export function previewSale(trades: Trade[], sale: SaleInput, settings: TaxSettings): SalePreview {
  const saleTrade: Trade = { ...sale, id: PREVIEW_ID, accountId: PREVIEW_ID, type: 'PRODAJA' };
  const { disposals } = buildLedger([...trades, saleTrade]);
  const mine = disposals.filter((d) => d.sellTradeId === PREVIEW_ID);

  const parts: SalePart[] = mine.map((d) => ({
    ...taxOnPart(d, settings),
    buyTradeId: d.buyTradeId,
    buyDate: d.buyDate,
    quantity: d.quantity,
    costEur: d.costEur,
    proceedsEur: d.proceedsEur,
  }));
  const sum = (f: (p: SalePart) => Decimal) => parts.reduce((s, p) => s.plus(f(p)), ZERO);
  const gainEur = sum((p) => p.gainEur);
  const taxEur = sum((p) => p.taxEur);
  const baseEur = sum((p) => p.baseEur);

  const washBuys = baseEur.lt(0)
    ? trades
        .filter((t) => t.isin === sale.isin && t.type === 'NAKUP' && Math.abs(daysBetween(sale.date, t.date)) <= WASH_DAYS)
        .map((t) => ({ date: t.date, quantity: new Decimal(t.quantity) }))
    : [];

  return {
    parts,
    heldBefore: heldOn(trades, sale.isin, sale.date),
    proceedsEur: sum((p) => p.proceedsEur),
    costEur: sum((p) => p.costEur),
    gainEur,
    baseEur,
    taxEur,
    netEur: gainEur.minus(taxEur),
    washBuys,
  };
}

export interface CardDisposal extends Disposal {
  tax: TaxPart;
}

export interface StockCardData {
  disposals: CardDisposal[];
  realizedEur: Decimal;
  realizedTaxEur: Decimal;
  dividends: Dividend[];
  dividendsGrossEur: Decimal;
  dividendsForeignTaxEur: Decimal;
  dividendsNetEur: Decimal;
}

/** Zaključene prodaje (z oceno davka po lotu) in dividende enega papirja, najnovejše najprej. */
export function buildStockCard(input: { trades: Trade[]; isin: string; dividends: Dividend[]; settings: TaxSettings }): StockCardData {
  const { trades, isin, settings } = input;
  const disposals = buildLedger(trades.filter((t) => t.isin === isin))
    .disposals.map((d) => ({ ...d, tax: taxOnPart(d, settings) }))
    .sort((a, b) => compareIsoDate(b.sellDate, a.sellDate) || compareIsoDate(a.buyDate, b.buyDate));
  const dividends = input.dividends.filter((d) => d.isin === isin).sort((a, b) => compareIsoDate(b.date, a.date));
  const gross = dividends.reduce((s, d) => s.plus(d.grossEur), ZERO);
  const foreign = dividends.reduce((s, d) => s.plus(d.foreignTaxEur), ZERO);
  return {
    disposals,
    realizedEur: disposals.reduce((s, d) => s.plus(d.gainEur), ZERO),
    realizedTaxEur: disposals.reduce((s, d) => s.plus(d.tax.taxEur), ZERO),
    dividends,
    dividendsGrossEur: gross,
    dividendsForeignTaxEur: foreign,
    dividendsNetEur: gross.minus(foreign),
  };
}

export interface PricePoint {
  date: IsoDate;
  priceEur: Decimal;
}

/** Zgodovina cene enega papirja v EUR (tečaj ECB na dan cene); dnevi brez tečaja so izpuščeni. */
export function priceSeriesEur(prices: PriceRow[], fx: FxRow[], isin: string): PricePoint[] {
  const out: PricePoint[] = [];
  for (const p of prices) {
    if (p.isin !== isin) continue;
    const rate = rateOn(fx, (p.currency ?? 'EUR').toUpperCase(), p.date);
    if (rate) out.push({ date: p.date, priceEur: new Decimal(p.close).div(rate) });
  }
  return out.sort((a, b) => compareIsoDate(a.date, b.date));
}

/** Cena posla na enoto v EUR (brez provizije) — za oznake nakupov in prodaj na grafu. */
export function tradePriceEur(t: Trade): Decimal {
  return new Decimal(t.price).div(t.ratePerEur);
}
