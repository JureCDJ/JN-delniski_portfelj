// Edge Function: posodobi tržne cene in tečaje ECB za odprte pozicije.
//
// Dva načina klica:
//  • iz aplikacije z uporabnikovim žetonom (Authorization: Bearer <jwt>) → velja RLS, samo njegovi podatki;
//  • dnevno iz pg_cron z glavo x-cron-secret (= skrivnost CRON_SECRET) → vsi uporabniki, servisni ključ.
// Skrivnosti so v Supabase Secrets, nikoli v repozitoriju. Funkcija samo bere vire cen in piše
// v tabeli prices / fx_rates (upsert, idempotentno).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.1';
import { parseFrankfurter, parseYahooChart } from '../_shared/marketData.ts';

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
}

async function openInstruments(db: SupabaseClient): Promise<Instr[]> {
  const [ins, tx] = await Promise.all([
    db.from('instruments').select('id, user_id, symbol, name, price_symbol, price_source'),
    db.from('transactions').select('instrument_id, type, quantity:quantity::text').in('type', ['NAKUP', 'PRODAJA']),
  ]);
  if (ins.error) throw new Error(`instrumenti: ${ins.error.message}`);
  if (tx.error) throw new Error(`transakcije: ${tx.error.message}`);
  const held = new Map<string, number>();
  for (const t of tx.data as { instrument_id: string; type: string; quantity: string }[]) {
    const q = Number(t.quantity) * (t.type === 'NAKUP' ? 1 : -1);
    held.set(t.instrument_id, (held.get(t.instrument_id) ?? 0) + q);
  }
  return (ins.data as Instr[]).filter((i) => (held.get(i.id) ?? 0) > 0.001);
}

async function fetchYahoo(symbol: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (portfelj)' } },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok && !body) throw new Error(`HTTP ${res.status}`);
  return parseYahooChart(body);
}

async function fetchEcb(date: string, currencies: string[]) {
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?from=EUR&to=${currencies.join(',')}`);
  if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
  return parseFrankfurter(await res.json());
}

async function sync(db: SupabaseClient) {
  const all = await openInstruments(db);
  const auto = all.filter((i) => i.price_source === 'YAHOO' && i.price_symbol);
  const ok: string[] = [];
  const failed: { symbol: string; reason: string }[] = [];
  const priceRows: Record<string, unknown>[] = [];
  const dates = new Set<string>();
  const currencies = new Set<string>();

  // Do 5 hkratnih zahtev, da vir ne zavrne klicev.
  for (let i = 0; i < auto.length; i += 5) {
    await Promise.all(
      auto.slice(i, i + 5).map(async (ins) => {
        try {
          const q = await fetchYahoo(ins.price_symbol!);
          for (const c of q.closes) {
            priceRows.push({
              user_id: ins.user_id,
              instrument_id: ins.id,
              date: c.date,
              close: c.close,
              currency: q.currency,
              source: 'YAHOO',
              fetched_at: new Date().toISOString(),
            });
            dates.add(c.date);
          }
          if (q.currency !== 'EUR') currencies.add(q.currency);
          ok.push(ins.symbol ?? ins.price_symbol!);
        } catch (e) {
          failed.push({ symbol: ins.symbol ?? ins.price_symbol ?? ins.name, reason: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }

  if (priceRows.length) {
    const { error } = await db.from('prices').upsert(priceRows, { onConflict: 'instrument_id,date' });
    if (error) throw new Error(`zapis cen: ${error.message}`);
  }

  // Tečaji ECB za vse datume cen (ECB vrne zadnji objavljeni tečaj ≤ datum).
  const users = [...new Set(all.map((i) => i.user_id))];
  const fxRows: Record<string, unknown>[] = [];
  if (currencies.size) {
    for (const d of dates) {
      const fx = await fetchEcb(d, [...currencies]);
      for (const [currency, rate] of Object.entries(fx.rates)) {
        for (const user_id of users) fxRows.push({ user_id, date: fx.date, currency, rate_per_eur: rate, source: 'ECB' });
      }
    }
    const unique = new Map(fxRows.map((r) => [`${r.user_id}|${r.currency}|${r.date}`, r]));
    const { error } = await db.from('fx_rates').upsert([...unique.values()], { onConflict: 'user_id,currency,date' });
    if (error) throw new Error(`zapis tečajev: ${error.message}`);
  }

  return {
    posodobljeno: ok.length,
    skupaj: all.length,
    napake: failed,
    rocno: all.filter((i) => i.price_source !== 'YAHOO' || !i.price_symbol).map((i) => i.symbol ?? i.name),
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
