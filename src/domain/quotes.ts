import { compareIsoDate, parseIsoDate, type IsoDate } from './dates';
import type { Quote } from './types';

// Iz shranjenih dnevnih cen in tečajev ECB sestavi Quote za vsak instrument:
// zadnja cena + prejšnja (za dnevno spremembo), vsaka s tečajem, veljavnim na tisti dan
// (zadnji objavljeni ECB tečaj na ali pred datumom cene).

export interface PriceRow {
  isin: string;
  date: IsoDate;
  close: string;
  /** Valuta cene; null/EUR = evri. */
  currency: string | null;
  source: string;
}

export interface FxRow {
  date: IsoDate;
  currency: string;
  ratePerEur: string;
}

export interface QuoteInfo extends Quote {
  currency: string;
  source: string;
}

export interface QuotesResult {
  quotes: QuoteInfo[];
  /** Instrumenti s ceno, a brez tečaja za njeno valuto. */
  missingFx: string[];
  /** Datum najnovejše cene (za oznako »cene z dne«). */
  latestDate: IsoDate | null;
}

function rateOn(fx: FxRow[], currency: string, date: IsoDate): string | null {
  if (currency === 'EUR') return '1';
  let best: FxRow | null = null;
  for (const r of fx) {
    if (r.currency !== currency || compareIsoDate(r.date, date) > 0) continue;
    if (!best || compareIsoDate(r.date, best.date) > 0) best = r;
  }
  return best?.ratePerEur ?? null;
}

export function buildQuotes(prices: PriceRow[], fx: FxRow[]): QuotesResult {
  const byIsin = new Map<string, PriceRow[]>();
  for (const p of prices) {
    const list = byIsin.get(p.isin) ?? [];
    list.push(p);
    byIsin.set(p.isin, list);
  }

  const quotes: QuoteInfo[] = [];
  const missingFx: string[] = [];
  let latestDate: IsoDate | null = null;

  for (const [isin, rows] of byIsin) {
    rows.sort((a, b) => compareIsoDate(b.date, a.date));
    const last = rows[0]!;
    const prev = rows[1];
    const currency = (last.currency ?? 'EUR').toUpperCase();
    const rate = rateOn(fx, currency, last.date);
    if (!rate) {
      missingFx.push(isin);
      continue;
    }
    const prevRate = prev ? rateOn(fx, (prev.currency ?? 'EUR').toUpperCase(), prev.date) : null;
    quotes.push({
      isin,
      date: last.date,
      price: last.close,
      ratePerEur: rate,
      ...(prev && prevRate ? { previousPrice: prev.close, previousRatePerEur: prevRate } : {}),
      currency,
      source: last.source,
    });
    if (!latestDate || compareIsoDate(last.date, latestDate) > 0) latestDate = last.date;
  }
  return { quotes, missingFx, latestDate };
}

/** Število koledarskih dni med datumoma (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.day) - Date.UTC(x.y, x.m - 1, x.day)) / 86_400_000);
}

/** Cena je zastarela, če je več kot `maxDays` dni starejša od najnovejše cene v portfelju. */
export function isStale(quoteDate: IsoDate, latest: IsoDate, maxDays = 4): boolean {
  return daysBetween(quoteDate, latest) > maxDays;
}
