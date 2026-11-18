import { supabase } from '../lib/supabase';
import type { TradeDraft } from '../domain/validation';
import type { Instrument, Quote, Trade } from '../domain/types';

// Dostop do baze. Številska polja (numeric) beremo kot besedilo (::text),
// ker jih PostgREST sicer vrne kot JSON števila in izgubimo natančnost.

export interface InstrumentRow extends Instrument {
  id: string;
}

export interface PortfolioData {
  instruments: InstrumentRow[];
  trades: Trade[];
  quotes: Quote[];
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? 'neznana napaka'}`);
}

export async function loadPortfolio(): Promise<PortfolioData> {
  const [inst, tx] = await Promise.all([
    supabase.from('instruments').select('id, isin, symbol, name, currency, type'),
    supabase
      .from('transactions')
      .select(
        'id, account_id, type, trade_date, currency, instrument:instruments(isin), quantity:quantity::text, price:price::text, fee:fee::text, rate_per_eur:rate_per_eur::text',
      )
      .in('type', ['NAKUP', 'PRODAJA'])
      .order('trade_date')
      .order('created_at'),
  ]);
  if (inst.error) fail('Branje instrumentov', inst.error);
  if (tx.error) fail('Branje transakcij', tx.error);

  const instruments: InstrumentRow[] = inst.data.map((r) => ({
    id: r.id,
    isin: r.isin,
    symbol: r.symbol ?? r.isin,
    name: r.name,
    currency: r.currency,
    type: r.type,
  }));

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

  // Tečaji instrumentov pridejo s samodejno posodobitvijo (REQ-05).
  return { instruments, trades, quotes: [] };
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
