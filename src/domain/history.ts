import Decimal from 'decimal.js';
import { compareIsoDate, parseIsoDate, type IsoDate } from './dates';
import { buildLedger } from './portfolio';
import type { FxRow, PriceRow } from './quotes';
import type { Trade } from './types';

// Vrednost portfelja skozi čas: za vsak teden (petek) od prvega nakupa do danes
// odprte lote na tisti dan × zadnja znana cena ≤ dan, preračunana po tečaju ECB ≤ dan.
// »Vloženo« = nabavna vrednost odprtih lotov (FIFO) na tisti dan.

const ZERO = new Decimal(0);
/** Cena, starejša od toliko dni, ne velja več za tisti dan (namesto nje nabavna vrednost). */
const MAX_PRICE_AGE_DAYS = 21;

export interface ValuePoint {
  date: IsoDate;
  valueEur: Decimal;
  investedEur: Decimal;
  /** false, če je za kakšno pozicijo manjkala cena (uporabljena nabavna vrednost). */
  complete: boolean;
}

function toUtc(d: IsoDate): number {
  const { y, m, day } = parseIsoDate(d);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(t: number): IsoDate {
  return new Date(t).toISOString().slice(0, 10);
}

/** Vsi petki med datumoma + končni datum (če ni petek). */
export function weeklyDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let t = toUtc(from);
  const end = toUtc(to);
  const dow = new Date(t).getUTCDay();
  t += ((5 - dow + 7) % 7) * 86_400_000;
  for (; t <= end; t += 7 * 86_400_000) out.push(fromUtc(t));
  if (out.at(-1) !== to) out.push(to);
  return out;
}

/** Zadnji element z datumom ≤ d v po datumu urejenem seznamu (binarno iskanje). */
function lastOnOrBefore<T extends { date: IsoDate }>(rows: T[], d: IsoDate): T | null {
  let lo = 0;
  let hi = rows.length - 1;
  let res: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (compareIsoDate(rows[mid]!.date, d) <= 0) {
      res = rows[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
}

export function buildValueSeries(trades: Trade[], prices: PriceRow[], fx: FxRow[], today: IsoDate): ValuePoint[] {
  const buys = trades.filter((t) => t.type === 'NAKUP');
  if (!buys.length) return [];
  const first = buys.reduce((m, t) => (compareIsoDate(t.date, m) < 0 ? t.date : m), buys[0]!.date);

  const priceBy = new Map<string, PriceRow[]>();
  for (const p of prices) {
    const l = priceBy.get(p.isin) ?? [];
    l.push(p);
    priceBy.set(p.isin, l);
  }
  for (const l of priceBy.values()) l.sort((a, b) => compareIsoDate(a.date, b.date));
  const fxBy = new Map<string, FxRow[]>();
  for (const r of fx) {
    const l = fxBy.get(r.currency) ?? [];
    l.push(r);
    fxBy.set(r.currency, l);
  }
  for (const l of fxBy.values()) l.sort((a, b) => compareIsoDate(a.date, b.date));

  const sorted = [...trades].sort((a, b) => compareIsoDate(a.date, b.date));
  return weeklyDates(first, today).map((d) => {
    const upTo = sorted.filter((t) => compareIsoDate(t.date, d) <= 0);
    const { openLots } = buildLedger(upTo);
    const byIsin = new Map<string, { qty: Decimal; cost: Decimal }>();
    for (const l of openLots) {
      const a = byIsin.get(l.isin) ?? { qty: ZERO, cost: ZERO };
      byIsin.set(l.isin, { qty: a.qty.plus(l.quantity), cost: a.cost.plus(l.costEur) });
    }
    let value = ZERO;
    let invested = ZERO;
    let complete = true;
    for (const [isin, { qty, cost }] of byIsin) {
      invested = invested.plus(cost);
      const p = lastOnOrBefore(priceBy.get(isin) ?? [], d);
      const fresh = p && (toUtc(d) - toUtc(p.date)) / 86_400_000 <= MAX_PRICE_AGE_DAYS;
      const cur = (p?.currency ?? 'EUR').toUpperCase();
      const rate = cur === 'EUR' ? new Decimal(1) : lastOnOrBefore(fxBy.get(cur) ?? [], d)?.ratePerEur;
      if (p && fresh && rate) value = value.plus(qty.mul(p.close).div(rate));
      else {
        value = value.plus(cost);
        complete = false;
      }
    }
    return { date: d, valueEur: value, investedEur: invested, complete };
  });
}
