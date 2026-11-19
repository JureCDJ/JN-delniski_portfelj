// Razčlenjevanje odgovorov virov tržnih podatkov. Čiste funkcije brez Deno/Node API-jev,
// da jih uporablja Edge Function in testira Vitest.

export interface DailyClose {
  /** Koledarski datum trgovanja na borzi (lokalni čas borze), 'YYYY-MM-DD'. */
  date: string;
  /** Zaključna (ali zadnja) cena kot decimalni niz. */
  close: string;
}

export interface YahooQuote {
  symbol: string;
  currency: string;
  /** Vse trgovalne zaključne cene v odgovoru, najstarejša prva. */
  closes: DailyClose[];
}

function weekKey(date: string): string {
  // Ponedeljek tedna, v katerem je datum (UTC koledar, brez časovnega pasu).
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/**
 * Zgodovina za graf: za dni pred `dailyFrom` obdrži samo zadnji trgovalni dan v tednu,
 * od `dailyFrom` naprej vse dni. Vhod mora biti urejen od najstarejšega.
 */
export function thinToWeekly(closes: DailyClose[], dailyFrom: string): DailyClose[] {
  const out: DailyClose[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i]!;
    const next = closes[i + 1];
    if (c.date >= dailyFrom || !next || weekKey(next.date) !== weekKey(c.date)) out.push(c);
  }
  return out;
}

/**
 * Float iz JSON → decimalni niz brez artefaktov (126.66000366 → '126.66').
 * Yahoo pošilja cene kot float32 (130.39999389…), zato cene zaokrožimo na 4 decimalke.
 */
export function cleanNumber(x: number, decimals = 4): string {
  if (!Number.isFinite(x)) throw new Error(`Neveljavno število: ${x}`);
  const f = 10 ** decimals;
  return String(Math.round(x * f) / f);
}

function isoDateFromEpoch(seconds: number, gmtoffset: number): string {
  // Lokalni datum borze: UTC čas + zamik borze, nato UTC komponente (brez časovnega pasu brskalnika).
  const d = new Date((seconds + gmtoffset) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Yahoo Finance /v8/finance/chart (interval=1d).
 * Pence (GBp/GBX) pretvori v GBP. Vrne vse dni z znano ceno, najstarejši prvi.
 */
export function parseYahooChart(body: unknown): YahooQuote {
  const chart = (body as { chart?: { result?: unknown[] | null; error?: { description?: string } | null } })?.chart;
  const r = chart?.result?.[0] as
    | {
        meta?: { symbol?: string; currency?: string; gmtoffset?: number };
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }
    | undefined;
  if (!r) throw new Error(chart?.error?.description ?? 'Vir ni vrnil podatkov za simbol');
  const meta = r.meta ?? {};
  const ts = r.timestamp ?? [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  let currency = (meta.currency ?? '').trim();
  let divisor = 1;
  if (currency === 'GBp' || currency === 'GBX') {
    currency = 'GBP';
    divisor = 100;
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Neznana valuta "${meta.currency}"`);

  const byDate = new Map<string, number>();
  ts.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === 'number' && c > 0) byDate.set(isoDateFromEpoch(t, meta.gmtoffset ?? 0), c / divisor);
  });
  const days = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (days.length === 0) throw new Error('Ni cen v zadnjih dneh');
  return {
    symbol: meta.symbol ?? '',
    currency,
    closes: days.map(([date, c]) => ({ date, close: cleanNumber(c) })),
  };
}

export interface FxRates {
  date: string;
  /** Enot valute za 1 EUR. */
  rates: Record<string, string>;
}

/** Frankfurter (ECB) /v1/latest?from=EUR&to=USD,HKD */
export function parseFrankfurter(body: unknown): FxRates {
  const b = body as { base?: string; date?: string; rates?: Record<string, number> };
  if (b?.base !== 'EUR' || !b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !b.rates) {
    throw new Error('Nepričakovan odgovor vira tečajev');
  }
  const rates: Record<string, string> = {};
  for (const [cur, v] of Object.entries(b.rates)) {
    if (/^[A-Z]{3}$/.test(cur) && typeof v === 'number' && v > 0) rates[cur] = cleanNumber(v, 6);
  }
  return { date: b.date, rates };
}
