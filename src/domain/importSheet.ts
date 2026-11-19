import Decimal from 'decimal.js';
import { parseIsoDate, type IsoDate } from './dates';
import type { Trade } from './types';

// Uvoz iz lastnikove Google tabele »JN Delnice« (zavihka DELNICE in PRODAJE, izvoz CSV).
// Čiste funkcije: razčlenjevanje, preslikava ticker+naziv → ISIN in pretvorba v posle.
// Zneski v tabeli so že v EUR (tudi za posle v USD), zato tečaj = 1 in valuta EUR;
// izvirna valuta se ohrani v originalCurrency. Natančne USD podatke bo dal uvoz IBKR.

export type Broker = 'IBKR' | 'N26';

export interface SheetTrade extends Trade {
  broker: Broker;
  source: 'TABELA';
  /** Stabilen ključ za idempotentnost: NAKUP-<ID> / PRODAJA-<ID>. */
  sourceRef: string;
  ticker: string;
  name: string;
  /** Valuta, v kateri je bil posel dejansko sklenjen (podatek iz tabele). */
  originalCurrency: string;
  /** Znesek, kot je zapisan v tabeli (Skupaj / Prodajna vrednost), v EUR. */
  totalEur: string;
}

/** Preprost razčlenjevalnik CSV (vejica, narekovaji, "" znotraj narekovajev). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** '06.03.2025' → '2025-03-06' */
export function parseSlDate(raw: string): IsoDate {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw.trim());
  if (!m) throw new Error(`Neveljaven datum "${raw}" (pričakovano DD.MM.LLLL)`);
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  parseIsoDate(iso);
  return iso;
}

/** '1.198,50 €' → 1198.50 ; '−17,87 €' → -17.87 */
export function parseSlAmount(raw: string): Decimal {
  const s = raw.replace(/€/g, '').replace(/[\s  ]/g, '').replace('−', '-').replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Neveljaven znesek "${raw}"`);
  return new Decimal(s);
}

export function brokerFromPlatform(raw: string): Broker {
  const p = raw.trim().toLowerCase();
  if (p.startsWith('ibkr')) return 'IBKR';
  if (p === 'n26' || p === 'drugo') return 'N26';
  throw new Error(`Neznana platforma "${raw}"`);
}

const key = (ticker: string, name: string) => `${ticker.trim().toUpperCase()}|${name.trim().toLowerCase()}`;

/** Preslikava iz isin-preslikava.csv (ločilo ;): Ticker;Naziv;Predlagan ISIN;... */
export function parseIsinMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const [ticker, name, isin] = line.split(';');
    if (ticker && name && isin?.trim()) map.set(key(ticker, name), isin.trim().toUpperCase());
  }
  return map;
}

export interface SheetResult {
  trades: SheetTrade[];
  /** Vrstice, ki jih ni bilo mogoče uvoziti, z razlogom. */
  skipped: { ref: string; reason: string }[];
}

export function buildSheetTrades(
  purchases: Record<string, string>[],
  sales: Record<string, string>[],
  isinMap: Map<string, string>,
): SheetResult {
  const trades: SheetTrade[] = [];
  const skipped: SheetResult['skipped'] = [];

  const add = (kind: 'NAKUP' | 'PRODAJA', r: Record<string, string>) => {
    const ref = `${kind}-${r['ID']}`;
    try {
      const ticker = r['Ticker'] ?? '';
      const name = r['Naziv'] ?? '';
      const isin = isinMap.get(key(ticker, name));
      if (!isin) throw new Error(`ni ISIN za ${ticker} (${name})`);
      const quantity = parseSlAmount(r['Količina'] ?? '');
      if (quantity.lte(0)) throw new Error('količina ni pozitivna');
      const total = parseSlAmount((kind === 'NAKUP' ? r['Skupaj (€)'] : r['Prodajna vrednost (€)']) ?? '');
      const date = parseSlDate((kind === 'NAKUP' ? r['Datum nakupa'] : r['Datum prodaje']) ?? '');
      trades.push({
        id: ref,
        accountId: brokerFromPlatform(r['Platforma'] ?? ''),
        broker: brokerFromPlatform(r['Platforma'] ?? ''),
        isin,
        type: kind,
        date,
        quantity: quantity.toString(),
        // Cena = dejansko plačan/prejet znesek / količina (tabela ima ceno zaokroženo).
        price: total.div(quantity).toDecimalPlaces(10).toString(),
        fee: '0',
        currency: 'EUR',
        ratePerEur: '1',
        source: 'TABELA',
        sourceRef: ref,
        ticker,
        name,
        originalCurrency: (r['Valuta nakupa'] || 'EUR').toUpperCase(),
        totalEur: total.toString(),
      });
    } catch (e) {
      skipped.push({ ref, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  purchases.forEach((r) => add('NAKUP', r));
  sales.forEach((r) => add('PRODAJA', r));
  return { trades, skipped };
}
