import { supabase } from '../lib/supabase';
import type { TradeDraft } from '../domain/validation';
import { buildQuotes, type QuoteInfo } from '../domain/quotes';
import type { Instrument, Trade } from '../domain/types';

// Dostop do baze. Številska polja (numeric) beremo kot besedilo (::text),
// ker jih PostgREST sicer vrne kot JSON števila in izgubimo natančnost.

export interface InstrumentRow extends Instrument {
  id: string;
  priceSource: 'YAHOO' | 'ROCNO';
  priceSymbol: string | null;
}

export interface PortfolioData {
  instruments: InstrumentRow[];
  trades: Trade[];
  quotes: QuoteInfo[];
  /** Datum najnovejše cene v portfelju. */
  pricesDate: string | null;
  missingFx: string[];
}

/** Datum pred n dnevi (lokalni koledar, brez časovnega pasu). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? 'neznana napaka'}`);
}

export async function loadPortfolio(): Promise<PortfolioData> {
  const [inst, tx, px, fx] = await Promise.all([
    supabase.from('instruments').select('id, isin, symbol, name, currency, type, price_source, price_symbol'),
    supabase
      .from('transactions')
      .select(
        'id, account_id, type, trade_date, currency, instrument:instruments(isin), quantity:quantity::text, price:price::text, fee:fee::text, rate_per_eur:rate_per_eur::text',
      )
      .in('type', ['NAKUP', 'PRODAJA'])
      .order('trade_date')
      .order('created_at'),
    // Zadnji dve ceni na instrument sta v zadnjih ~3 tednih tudi ob praznikih.
    supabase
      .from('prices')
      .select('instrument_id, date, close:close::text, currency, source')
      .gte('date', daysAgo(21)),
    supabase
      .from('fx_rates')
      .select('date, currency, rate_per_eur:rate_per_eur::text')
      .gte('date', daysAgo(35)),
  ]);
  if (inst.error) fail('Branje instrumentov', inst.error);
  if (tx.error) fail('Branje transakcij', tx.error);
  if (px.error) fail('Branje cen', px.error);
  if (fx.error) fail('Branje tečajev', fx.error);

  const instruments: InstrumentRow[] = inst.data.map((r) => ({
    id: r.id,
    isin: r.isin,
    symbol: r.symbol ?? r.isin,
    name: r.name,
    currency: r.currency,
    type: r.type,
    priceSource: r.price_source === 'ROCNO' ? 'ROCNO' : 'YAHOO',
    priceSymbol: r.price_symbol ?? null,
  }));
  const isinById = new Map(instruments.map((i) => [i.id, i.isin]));

  const trades: Trade[] = tx.data.map((r) => {
    const instrument = r.instrument as unknown as { isin: string } | null;
    return {
      id: r.id,
      accountId: r.account_id,
      isin: instrument?.isin ?? '',
      type: r.type as Trade['type'],
      date: r.trade_date,
      quantity: r.quantity as unknown as string,
      price: r.price as unknown as string,
      fee: r.fee as unknown as string,
      currency: r.currency,
      ratePerEur: r.rate_per_eur as unknown as string,
    };
  });

  const { quotes, latestDate, missingFx } = buildQuotes(
    px.data
      .filter((r) => isinById.has(r.instrument_id))
      .map((r) => ({
        isin: isinById.get(r.instrument_id)!,
        date: r.date,
        close: r.close as unknown as string,
        currency: r.currency,
        source: r.source,
      })),
    fx.data.map((r) => ({ date: r.date, currency: r.currency, ratePerEur: r.rate_per_eur as unknown as string })),
  );

  return { instruments, trades, quotes, pricesDate: latestDate, missingFx };
}

export interface RefreshResult {
  posodobljeno: number;
  skupaj: number;
  napake: { symbol: string; reason: string }[];
  rocno: string[];
}

/** Sproži posodobitev cen in tečajev (Edge Function prices-sync, z uporabnikovo prijavo). */
export async function refreshPrices(): Promise<RefreshResult> {
  const { data, error } = await supabase.functions.invoke<RefreshResult & { napaka?: string }>('prices-sync', { body: {} });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(`Posodobitev cen ni uspela: ${body?.napaka ?? error.message}`);
  }
  if (!data || data.napaka) throw new Error(`Posodobitev cen ni uspela: ${data?.napaka ?? 'ni odgovora'}`);
  return data;
}

/** Ročna cena v EUR (npr. Krka) za izbrani dan. Prepiše ceno istega dne. */
export async function saveManualPrice(instrumentId: string, date: string, priceEur: string): Promise<void> {
  const { error } = await supabase
    .from('prices')
    .upsert(
      { instrument_id: instrumentId, date, close: priceEur, currency: 'EUR', source: 'ROCNO', fetched_at: new Date().toISOString() },
      { onConflict: 'instrument_id,date' },
    );
  if (error) fail('Shranjevanje cene', error);
}

async function ensureManualAccount(): Promise<string> {
  const found = await supabase.from('accounts').select('id').eq('broker', 'ROCNO').limit(1);
  if (found.error) fail('Branje računov', found.error);
  if (found.data[0]) return found.data[0].id;
  const created = await supabase.from('accounts').insert({ broker: 'ROCNO', name: 'Ročni vnos' }).select('id').single();
  if (created.error) fail('Ustvarjanje računa', created.error);
  return created.data.id;
}

async function ensureInstrument(d: TradeDraft): Promise<string> {
  const found = await supabase.from('instruments').select('id').eq('isin', d.isin).limit(1);
  if (found.error) fail('Branje instrumenta', found.error);
  if (found.data[0]) return found.data[0].id;
  const created = await supabase
    .from('instruments')
    .insert({ isin: d.isin, symbol: d.symbol, name: d.name, currency: d.currency, country: d.isin.slice(0, 2) })
    .select('id')
    .single();
  if (created.error) fail('Ustvarjanje instrumenta', created.error);
  return created.data.id;
}

export async function saveManualTrade(d: TradeDraft): Promise<void> {
  const accountId = await ensureManualAccount();
  const instrumentId = await ensureInstrument(d);
  const { error } = await supabase.from('transactions').insert({
    account_id: accountId,
    instrument_id: instrumentId,
    type: d.type,
    trade_date: d.date,
    quantity: d.quantity,
    price: d.price,
    fee: d.fee,
    currency: d.currency,
    rate_per_eur: d.ratePerEur,
    source: 'ROCNO',
  });
  if (error) fail('Shranjevanje posla', error);
}
