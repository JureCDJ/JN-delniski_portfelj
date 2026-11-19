import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import type { Dividend, UsdRate } from '../domain/overview';
import { validateTaxSettings, type TaxSettings } from '../domain/tax';
import type { TradeDraft } from '../domain/validation';
import { buildQuotes, type FxRow, type PriceRow, type QuoteInfo } from '../domain/quotes';
import type { Instrument, Trade } from '../domain/types';

// Dostop do baze. Številska polja (numeric) beremo kot besedilo (::text),
// ker jih PostgREST sicer vrne kot JSON števila in izgubimo natančnost.

export interface InstrumentRow extends Instrument {
  id: string;
  priceSource: 'YAHOO' | 'ROCNO';
  priceSymbol: string | null;
  /** Valuta cene pri viru (npr. USD za Yahoo NVDA); null = EUR. */
  priceCurrency: string | null;
}

export interface TaxSettingsRow {
  id: string;
  settings: TaxSettings;
  confirmed: boolean;
  sourceNote: string | null;
}

export interface PortfolioData {
  instruments: InstrumentRow[];
  trades: Trade[];
  quotes: QuoteInfo[];
  /** Datum najnovejše cene v portfelju. */
  pricesDate: string | null;
  missingFx: string[];
  dividends: Dividend[];
  /** Ciljne prodajne cene v EUR po ISIN. */
  targets: Map<string, Decimal>;
  tax: TaxSettingsRow | null;
  usdRates: UsdRate[];
  /** Vse shranjene cene (zgodovina za graf vrednosti skozi čas). */
  priceHistory: PriceRow[];
  fxRows: FxRow[];
  /** Posrednik po id računa (za oznako lota: N26, IBKR …). */
  brokerByAccount: Map<string, string>;
}

interface PriceDbRow {
  instrument_id: string;
  date: string;
  close: string;
  currency: string | null;
  source: string;
}

async function loadAllPrices(): Promise<{ data: PriceDbRow[]; error: { message: string } | null }> {
  const page = 1000;
  const out: PriceDbRow[] = [];
  for (let from = 0; ; from += page) {
    const r = await supabase
      .from('prices')
      .select('instrument_id, date, close:close::text, currency, source')
      .order('instrument_id')
      .order('date')
      .range(from, from + page - 1);
    if (r.error) return { data: [], error: r.error };
    out.push(...(r.data as unknown as PriceDbRow[]));
    if (r.data.length < page) return { data: out, error: null };
  }
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? 'neznana napaka'}`);
}

export async function loadPortfolio(): Promise<PortfolioData> {
  const [inst, tx, px, fx] = await Promise.all([
    supabase.from('instruments').select('id, isin, symbol, name, currency, type, price_source, price_symbol, price_currency'),
    supabase
      .from('transactions')
      .select(
        'id, account_id, type, trade_date, currency, instrument:instruments(isin), quantity:quantity::text, price:price::text, fee:fee::text, rate_per_eur:rate_per_eur::text',
      )
      .in('type', ['NAKUP', 'PRODAJA'])
      .order('trade_date')
      .order('created_at'),
    // Vsa zgodovina cen (tedenska + zadnjih 30 dni dnevno) — po straneh, ker baza vrne največ 1000 vrstic.
    loadAllPrices(),
    // Vsi tečaji (USD zgodovina za pogled v $ — nakupi po tečaju na dan nakupa).
    supabase.from('fx_rates').select('date, currency, rate_per_eur:rate_per_eur::text').order('date'),
  ]);
  if (inst.error) fail('Branje instrumentov', inst.error);
  if (tx.error) fail('Branje transakcij', tx.error);
  if (px.error) fail('Branje cen', px.error);
  if (fx.error) fail('Branje tečajev', fx.error);

  const [dv, tg, ts, ac] = await Promise.all([
    supabase
      .from('transactions')
      .select('type, trade_date, amount:amount::text, instrument:instruments(isin)')
      .in('type', ['DIVIDENDA', 'DAVEK_TUJINA']),
    supabase.from('targets').select('price_eur:price_eur::text, instrument:instruments(isin)'),
    supabase.from('tax_settings').select('id, valid_from, settings, source_note, confirmed_at').order('valid_from', { ascending: false }).limit(1),
    supabase.from('accounts').select('id, broker'),
  ]);
  if (dv.error) fail('Branje dividend', dv.error);
  if (tg.error) fail('Branje ciljev', tg.error);
  if (ts.error) fail('Branje davčnih nastavitev', ts.error);
  if (ac.error) fail('Branje računov', ac.error);

  const isinOfRow = (r: { instrument: unknown }) => (r.instrument as { isin: string } | null)?.isin ?? '';
  const dividends: Dividend[] = dv.data.map((r) => {
    const amount = new Decimal(r.amount as unknown as string);
    // Bruto dividenda in tuji davek sta ločeni vrstici; vsota je enaka kot v tabeli.
    return r.type === 'DIVIDENDA'
      ? { isin: isinOfRow(r), date: r.trade_date, grossEur: amount, foreignTaxEur: new Decimal(0) }
      : { isin: isinOfRow(r), date: r.trade_date, grossEur: new Decimal(0), foreignTaxEur: amount };
  });
  const targets = new Map(tg.data.map((r) => [isinOfRow(r), new Decimal(r.price_eur as unknown as string)]));
  const t0 = ts.data[0];
  let tax: TaxSettingsRow | null = null;
  if (t0) {
    try {
      tax = { id: t0.id, settings: validateTaxSettings(t0.settings as TaxSettings), confirmed: Boolean(t0.confirmed_at), sourceNote: t0.source_note };
    } catch (e) {
      throw new Error(`Davčne nastavitve niso veljavne: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const usdRates: UsdRate[] = fx.data
    .filter((r) => r.currency === 'USD')
    .map((r) => ({ date: r.date, rate: new Decimal(r.rate_per_eur as unknown as string) }));

  const instruments: InstrumentRow[] = inst.data.map((r) => ({
    id: r.id,
    isin: r.isin,
    symbol: r.symbol ?? r.isin,
    name: r.name,
    currency: r.currency,
    type: r.type,
    priceSource: r.price_source === 'ROCNO' ? 'ROCNO' : 'YAHOO',
    priceSymbol: r.price_symbol ?? null,
    priceCurrency: r.price_currency ?? null,
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

  const priceHistory: PriceRow[] = px.data
    .filter((r) => isinById.has(r.instrument_id))
    .map((r) => ({ isin: isinById.get(r.instrument_id)!, date: r.date, close: r.close, currency: r.currency, source: r.source }));
  const fxRows: FxRow[] = fx.data.map((r) => ({ date: r.date, currency: r.currency, ratePerEur: r.rate_per_eur as unknown as string }));
  const { quotes, latestDate, missingFx } = buildQuotes(priceHistory, fxRows);

  return {
    instruments,
    trades,
    quotes,
    pricesDate: latestDate,
    missingFx,
    dividends: dividends.filter((d) => d.isin),
    targets,
    tax,
    usdRates,
    priceHistory,
    fxRows,
    brokerByAccount: new Map(ac.data.map((a) => [a.id, String(a.broker)])),
  };
}

/** Vir cene instrumenta: Yahoo (simbol + valuta) ali ročni vnos. */
export async function savePriceSource(
  instrumentId: string,
  source: { kind: 'YAHOO'; symbol: string; currency: string } | { kind: 'ROCNO' },
): Promise<void> {
  const patch =
    source.kind === 'YAHOO'
      ? { price_source: 'YAHOO', price_symbol: source.symbol, price_currency: source.currency }
      : { price_source: 'ROCNO', price_currency: 'EUR' };
  const { error } = await supabase.from('instruments').update(patch).eq('id', instrumentId);
  if (error) fail('Shranjevanje vira cene', error);
}

/** Ciljna prodajna cena v EUR; null odstrani cilj. */
export async function saveTarget(instrumentId: string, priceEur: string | null): Promise<void> {
  const { error } = priceEur
    ? await supabase.from('targets').upsert({ instrument_id: instrumentId, price_eur: priceEur }, { onConflict: 'instrument_id' })
    : await supabase.from('targets').delete().eq('instrument_id', instrumentId);
  if (error) fail('Shranjevanje cilja', error);
}

/** Lastnik potrdi davčne nastavitve (stopnje, normirane stroške). */
export async function confirmTaxSettings(id: string): Promise<void> {
  const { error } = await supabase.from('tax_settings').update({ confirmed_at: new Date().toISOString() }).eq('id', id);
  if (error) fail('Potrditev davčnih nastavitev', error);
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
