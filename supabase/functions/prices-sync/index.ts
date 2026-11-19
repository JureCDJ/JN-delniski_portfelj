// Edge Function: posodobi tržne cene in tečaje ECB.
//
// Dva načina klica:
//  • iz aplikacije z uporabnikovim žetonom (Authorization: Bearer <jwt>) → velja RLS, samo njegovi podatki;
//  • dnevno iz pg_cron z glavo x-cron-secret (= skrivnost CRON_SECRET) → vsi uporabniki, servisni ključ.
// Skrivnosti so v Supabase Secrets, nikoli v repozitoriju. Funkcija samo bere vire cen in piše
// v tabeli prices / fx_rates (upsert, idempotentno).
//
// Ob vsakem klicu:
//  1. zadnji dve dnevni ceni za odprte pozicije (dnevna sprememba),
//  2. manjkajoča zgodovina cen za vse instrumente v obdobju lastništva (tedensko, zadnjih 30 dni dnevno),
//  3. tečaji ECB za datume cen in manjkajoča zgodovina tečajev od najstarejšega posla.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.1';
import { parseFrankfurter, parseYahooChart, thinToWeekly, type YahooQuote } from '../_shared/marketData.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Instr {
  id: string;
  user_id: string;
  symbol: string | null;
  name: string;
  price_symbol: string | null;
  price_source: string;
  price_currency: string | null;
  held: number;
  firstBuy: string | null;
  lastSell: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

async function loadInstruments(db: SupabaseClient): Promise<Instr[]> {
  const [ins, tx] = await Promise.all([
    db.from('instruments').select('id, user_id, symbol, name, price_symbol, price_source, price_currency'),
    db.from('transactions').select('instrument_id, type, trade_date, quantity:quantity::text').in('type', ['NAKUP', 'PRODAJA']),
  ]);
  if (ins.error) throw new Error(`instrumenti: ${ins.error.message}`);
  if (tx.error) throw new Error(`transakcije: ${tx.error.message}`);
  const agg = new Map<string, { held: number; firstBuy: string | null; lastSell: string | null }>();
  for (const t of tx.data as { instrument_id: string; type: string; trade_date: string; quantity: string }[]) {
    const a = agg.get(t.instrument_id) ?? { held: 0, firstBuy: null, lastSell: null };
    if (t.type === 'NAKUP') {
      a.held += Number(t.quantity);
      if (!a.firstBuy || t.trade_date < a.firstBuy) a.firstBuy = t.trade_date;
    } else {
      a.held -= Number(t.quantity);
      if (!a.lastSell || t.trade_date > a.lastSell) a.lastSell = t.trade_date;
    }
    agg.set(t.instrument_id, a);
  }
  return (ins.data as Omit<Instr, 'held' | 'firstBuy' | 'lastSell'>[]).map((i) => ({
    ...i,
    ...(agg.get(i.id) ?? { held: 0, firstBuy: null, lastSell: null }),
  }));
}

async function fetchYahoo(symbol: string, from?: string): Promise<YahooQuote> {
  const span = from
    ? `period1=${Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000)}&period2=${Math.floor(Date.now() / 1000)}`
    : 'range=5d';
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${span}&interval=1d`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (portfelj)' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok && !body) throw new Error(`HTTP ${res.status}`);
  return parseYahooChart(body);
}

async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function upsertChunked(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`zapis ${table}: ${error.message}`);
  }
}

async function sync(db: SupabaseClient) {
  const all = await loadInstruments(db);
  const today = isoDay(new Date());
  const users = [...new Set(all.map((i) => i.user_id))];
  const open = all.filter((i) => i.held > 0.001);
  const auto = open.filter((i) => i.price_source === 'YAHOO' && i.price_symbol);
  const ok: string[] = [];
  const failed: { symbol: string; reason: string }[] = [];
  const priceRows: Record<string, unknown>[] = [];
  const dates = new Set<string>();
  const currencies = new Set<string>();
  const row = (ins: Instr, date: string, close: string, currency: string) => ({
    user_id: ins.user_id,
    instrument_id: ins.id,
    date,
    close,
    currency,
    source: 'YAHOO',
    fetched_at: new Date().toISOString(),
  });

  // 1. Zadnji dve ceni za odprte pozicije.
  await inBatches(auto, 5, async (ins) => {
    try {
      const q = await fetchYahoo(ins.price_symbol!);
      for (const c of q.closes.slice(-2)) {
        priceRows.push(row(ins, c.date, c.close, q.currency));
        dates.add(c.date);
      }
      if (q.currency !== 'EUR') currencies.add(q.currency);
      ok.push(ins.symbol ?? ins.price_symbol!);
    } catch (e) {
      failed.push({ symbol: ins.symbol ?? ins.price_symbol ?? ins.name, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  await upsertChunked(db, 'prices', priceRows, 'instrument_id,date');

  // 2. Manjkajoča zgodovina (enkrat na instrument; potem le, če se pojavi starejši nakup).
  const withHistory = all.filter((i) => i.price_source === 'YAHOO' && i.price_symbol && i.firstBuy);
  const earliest = new Map<string, string>();
  for (const i of withHistory) {
    const r = await db.from('prices').select('date').eq('instrument_id', i.id).order('date').limit(1);
    if (r.data?.[0]) earliest.set(i.id, r.data[0].date as string);
  }
  const needHistory = withHistory.filter((i) => {
    const e = earliest.get(i.id);
    return !e || e > shiftDays(i.firstBuy!, 7);
  });
  const histRows: Record<string, unknown>[] = [];
  const dailyFrom = shiftDays(today, -30);
  await inBatches(needHistory, 4, async (ins) => {
    try {
      const from = shiftDays(ins.firstBuy!, -7);
      const until = ins.held > 0.001 ? today : shiftDays(ins.lastSell ?? today, 7);
      const q = await fetchYahoo(ins.price_symbol!, from);
      for (const c of thinToWeekly(q.closes, dailyFrom)) {
        if (c.date >= from && c.date <= until) histRows.push(row(ins, c.date, c.close, q.currency));
      }
      if (q.currency !== 'EUR') currencies.add(q.currency);
    } catch (e) {
      failed.push({ symbol: `${ins.symbol ?? ins.price_symbol} (zgodovina)`, reason: e instanceof Error ? e.message : String(e) });
    }
  });
  await upsertChunked(db, 'prices', histRows, 'instrument_id,date');

  // 3. Tečaji ECB: za datume današnjih cen + zgodovina od najstarejšega posla.
  for (const i of all) if (i.price_currency && i.price_currency !== 'EUR') currencies.add(i.price_currency);
  if (currencies.size) {
    const fxRows: Record<string, unknown>[] = [];
    const add = (date: string, rates: Record<string, string | number>) => {
      for (const [currency, rate] of Object.entries(rates)) {
        for (const user_id of users) fxRows.push({ user_id, date, currency, rate_per_eur: String(rate), source: 'ECB' });
      }
    };
    for (const d of dates) {
      const res = await fetch(`https://api.frankfurter.dev/v1/${d}?from=EUR&to=${[...currencies].join(',')}`);
      if (res.ok) {
        const fx = parseFrankfurter(await res.json());
        add(fx.date, fx.rates);
      }
    }
    const start = all.map((i) => i.firstBuy).filter(Boolean).sort()[0] as string | undefined;
    if (start) {
      for (const cur of currencies) {
        const oldest = await db.from('fx_rates').select('date').eq('currency', cur).order('date').limit(1);
        const have = oldest.data?.[0]?.date as string | undefined;
        if (have && have <= start) continue;
        const res = await fetch(`https://api.frankfurter.dev/v1/${shiftDays(start, -7)}..?from=EUR&to=${cur}`);
        if (!res.ok) continue;
        const body = (await res.json()) as { rates?: Record<string, Record<string, number>> };
        for (const [date, r] of Object.entries(body.rates ?? {})) {
          if (typeof r[cur] === 'number' && r[cur]! > 0) add(date, { [cur]: r[cur]! });
        }
      }
    }
    const unique = new Map(fxRows.map((r) => [`${r.user_id}|${r.currency}|${r.date}`, r]));
    await upsertChunked(db, 'fx_rates', [...unique.values()], 'user_id,currency,date');
  }

  return {
    posodobljeno: ok.length,
    skupaj: open.length,
    zgodovina: histRows.length,
    napake: failed,
    rocno: open.filter((i) => i.price_source !== 'YAHOO' || !i.price_symbol).map((i) => i.symbol ?? i.name),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const cron = req.headers.get('x-cron-secret');
    if (cron) {
      if (!CRON_SECRET || cron !== CRON_SECRET) return json({ napaka: 'Ni dovoljeno' }, 401);
      return json(await sync(createClient(URL_, SERVICE, { auth: { persistSession: false } })));
    }
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ napaka: 'Prijava je obvezna' }, 401);
    const db = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data, error } = await db.auth.getUser(auth.slice(7));
    if (error || !data.user) return json({ napaka: 'Prijava ni veljavna' }, 401);
    return json(await sync(db));
  } catch (e) {
    return json({ napaka: e instanceof Error ? e.message : String(e) }, 500);
  }
});
