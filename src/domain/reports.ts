import Decimal from 'decimal.js';
import { compareIsoDate, formatDateSl, type IsoDate } from './dates';
import { buildOverview, type Dividend } from './overview';
import type { TaxSettings } from './tax';
import { divYear, kdvpYear, taxYears } from './taxReturns';
import type { Instrument, Quote, Trade } from './types';

// Izpisi (rezina 8): ena struktura poročila za prikaz, tisk (PDF) in CSV.
// Celice so surove vrednosti (Decimal, datum, besedilo); formatiranje je stvar izhoda:
//   zaslon/PDF → 1.234,56 € · CSV → 1234,56 (slovenski Excel: podpičje, decimalna vejica, UTF-8 z BOM).

const ZERO = new Decimal(0);

/** Slovenska dvojina in množina: 1 pozicija, 2 poziciji, 3–4 pozicije, 5 pozicij. */
export function plural(n: number, one: string, two: string, few: string, many: string): string {
  const m = n % 100;
  return `${n} ${m === 1 ? one : m === 2 ? two : m === 3 || m === 4 ? few : many}`;
}

export type ColType = 'text' | 'date' | 'eur' | 'qty' | 'pct' | 'int';
export interface Column {
  label: string;
  type: ColType;
}
export type Cell = string | Decimal | number | null;

export interface Report {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Cell[][];
  totals?: Cell[];
  notes?: string[];
}

type InstrumentInfo = Pick<Instrument, 'isin' | 'symbol' | 'name'>;

function namesOf(instruments: InstrumentInfo[]) {
  const m = new Map(instruments.map((i) => [i.isin, i]));
  return { sym: (isin: string) => m.get(isin)?.symbol ?? isin, name: (isin: string) => m.get(isin)?.name ?? '' };
}

// ───────────────────────────── 1. pregled portfelja na dan ─────────────────────────────

export function portfolioReport(input: {
  trades: Trade[];
  quotes: Quote[];
  instruments: InstrumentInfo[];
  targets: Map<string, Decimal>;
  settings: TaxSettings;
  today: IsoDate;
}): Report {
  const { trades, quotes, instruments, targets, settings, today } = input;
  const o = buildOverview({ trades, quotes, dividends: [], targets, settings, today });
  const { sym, name } = namesOf(instruments);
  const qByIsin = new Map(quotes.map((q) => [q.isin, q]));
  const total = o.summary.valueEur;
  return {
    title: 'Pregled portfelja',
    subtitle: `Stanje na dan ${formatDateSl(today)} · cene v EUR po tečaju ECB na dan cene`,
    columns: [
      { label: 'Simbol', type: 'text' },
      { label: 'Naziv', type: 'text' },
      { label: 'ISIN', type: 'text' },
      { label: 'Količina', type: 'qty' },
      { label: 'Povp. nabavna (€)', type: 'eur' },
      { label: 'Nabavna vrednost (€)', type: 'eur' },
      { label: 'Cena (€)', type: 'eur' },
      { label: 'Datum cene', type: 'date' },
      { label: 'Vrednost (€)', type: 'eur' },
      { label: 'Donos (€)', type: 'eur' },
      { label: 'Donos (%)', type: 'pct' },
      { label: 'Delež (%)', type: 'pct' },
      { label: 'Ciljna cena (€)', type: 'eur' },
      { label: 'Davek ob prodaji danes (€)', type: 'eur' },
    ],
    rows: o.positions.map((p) => [
      sym(p.isin),
      name(p.isin),
      p.isin,
      p.quantity,
      p.avgCostEur,
      p.costEur,
      p.priceEur,
      qByIsin.get(p.isin)?.date ?? null,
      p.valueEur,
      p.unrealizedEur,
      p.unrealizedPct,
      p.valueEur && total.gt(0) ? p.valueEur.div(total).mul(100) : null,
      p.target?.priceEur ?? null,
      p.taxToday?.taxEur ?? null,
    ]),
    totals: [
      'Skupaj',
      plural(o.positions.length, 'pozicija', 'poziciji', 'pozicije', 'pozicij'),
      null,
      null,
      null,
      o.summary.investedOpen,
      null,
      null,
      o.summary.valueEur,
      o.summary.unrealizedEur,
      o.summary.unrealizedPct,
      o.summary.valueEur.gt(0) ? new Decimal(100) : null,
      null,
      o.summary.taxTodayEur,
    ],
    notes: [
      'Davek ob prodaji danes: ocena po FIFO lotih, stopnja po letih imetništva, z normiranimi stroški; brez pobota z drugimi pozicijami.',
      ...(o.summary.missingQuotes.length ? [`Brez cene (niso v vrednosti): ${o.summary.missingQuotes.map(sym).join(', ')}.`] : []),
    ],
  };
}

// ───────────────────────────── 2. prodaje in dobički (FIFO) ─────────────────────────────

/** Prodaje po FIFO lotih za izbrano leto ali vsa leta (null). */
export function salesReport(input: { trades: Trade[]; instruments: InstrumentInfo[]; settings: TaxSettings; year: number | null }): Report {
  const { trades, instruments, settings, year } = input;
  const { sym, name } = namesOf(instruments);
  const years = year === null ? taxYears(trades, []).sort((a, b) => a - b) : [year];
  const ks = years.map((y) => kdvpYear(trades, settings, y));
  const rows = ks.flatMap((k) => k.rows);
  const sum = (f: (r: (typeof rows)[number]) => Decimal) => rows.reduce((s, r) => s.plus(f(r)), ZERO);
  const taxByRow = (r: (typeof rows)[number]) => Decimal.max(ZERO, r.baseEur).mul(r.rate);
  return {
    title: 'Prodaje in dobički (FIFO)',
    subtitle: year === null ? 'Vsa leta' : `Leto ${year}`,
    columns: [
      { label: 'Datum prodaje', type: 'date' },
      { label: 'Simbol', type: 'text' },
      { label: 'Naziv', type: 'text' },
      { label: 'ISIN', type: 'text' },
      { label: 'Datum nakupa (lot)', type: 'date' },
      { label: 'Količina', type: 'qty' },
      { label: 'Nabavna vrednost (€)', type: 'eur' },
      { label: 'Prodajna vrednost (€)', type: 'eur' },
      { label: 'Dobiček (€)', type: 'eur' },
      { label: 'Osnova z 1 % (€)', type: 'eur' },
      { label: 'Leta', type: 'int' },
      { label: 'Stopnja (%)', type: 'pct' },
      { label: 'Davek po lotu (€)', type: 'eur' },
      { label: 'Opozorilo', type: 'text' },
    ],
    rows: rows.map((r) => [
      r.sellDate,
      sym(r.isin),
      name(r.isin),
      r.isin,
      r.buyDate,
      r.quantity,
      r.costEur,
      r.proceedsEur,
      r.gainEur,
      r.baseEur,
      r.years,
      r.rate.mul(100),
      taxByRow(r),
      r.washBuys.length ? `nakup v ±30 dneh: ${r.washBuys.map(formatDateSl).join(', ')}` : '',
    ]),
    totals: [
      'Skupaj',
      plural(rows.length, 'vrstica', 'vrstici', 'vrstice', 'vrstic'),
      null,
      null,
      null,
      null,
      sum((r) => r.costEur),
      sum((r) => r.proceedsEur),
      sum((r) => r.gainEur),
      sum((r) => r.baseEur),
      null,
      null,
      sum(taxByRow),
      '',
    ],
    notes: [
      ...ks.map(
        (k) =>
          `${k.year}: dobički (osnova) ${k.gainsBaseEur.toFixed(2).replace('.', ',')} €, izgube ${k.lossesBaseEur.toFixed(2).replace('.', ',')} €, ` +
          `neto po pobotu ${k.netBaseEur.toFixed(2).replace('.', ',')} €, davek po sorazmernem pobotu ${k.taxEur.toFixed(2).replace('.', ',')} € (ocena).`,
      ),
      '»Davek po lotu« je brez pobota izgub; davek leta po pobotu je v opombi zgoraj. Končni izračun naredi FURS.',
    ],
  };
}

// ───────────────────────────── 3. dividende ─────────────────────────────

export function dividendsReport(input: { dividends: Dividend[]; instruments: InstrumentInfo[]; settings: TaxSettings; year: number | null }): Report {
  const { dividends, instruments, settings, year } = input;
  const { sym, name } = namesOf(instruments);
  const years = year === null ? [...new Set(dividends.map((d) => Number(d.date.slice(0, 4))))].sort((a, b) => a - b) : [year];
  const ds = years.map((y) => divYear(dividends, settings, y));
  const rows = ds
    .flatMap((d) => [...d.rows.map((r) => ({ r, domestic: false })), ...d.domesticRows.map((r) => ({ r, domestic: true }))])
    .sort((a, b) => compareIsoDate(a.r.date, b.r.date) || a.r.isin.localeCompare(b.r.isin));
  const sum = (f: (x: (typeof rows)[number]) => Decimal) => rows.reduce((s, x) => s.plus(f(x)), ZERO);
  return {
    title: 'Dividende in tuji davek',
    subtitle: year === null ? 'Vsa leta' : `Leto ${year}`,
    columns: [
      { label: 'Datum', type: 'date' },
      { label: 'Simbol', type: 'text' },
      { label: 'Naziv', type: 'text' },
      { label: 'ISIN', type: 'text' },
      { label: 'Država vira', type: 'text' },
      { label: 'Bruto (€)', type: 'eur' },
      { label: 'Tuji davek (€)', type: 'eur' },
      { label: 'Neto (€)', type: 'eur' },
      { label: 'SI davek (€)', type: 'eur' },
      { label: 'Doplačilo (€)', type: 'eur' },
      { label: 'Opomba', type: 'text' },
    ],
    rows: rows.map(({ r, domestic }) => [
      r.date,
      sym(r.isin),
      name(r.isin),
      r.isin,
      r.isin.slice(0, 2),
      r.grossEur,
      r.foreignTaxEur,
      r.grossEur.minus(r.foreignTaxEur),
      domestic ? null : r.siTaxEur,
      domestic ? null : r.topUpEur,
      domestic ? 'slovenski izplačevalec — ni v Doh-Div' : '',
    ]),
    totals: [
      'Skupaj',
      plural(rows.length, 'izplačilo', 'izplačili', 'izplačila', 'izplačil'),
      null,
      null,
      null,
      sum((x) => x.r.grossEur),
      sum((x) => x.r.foreignTaxEur),
      sum((x) => x.r.grossEur.minus(x.r.foreignTaxEur)),
      sum((x) => (x.domestic ? ZERO : x.r.siTaxEur)),
      sum((x) => (x.domestic ? ZERO : x.r.topUpEur)),
      '',
    ],
    notes: ['Doplačilo = max(0, SI davek − tuji davek) po izplačilu; ocena, odmero izda FURS.'],
  };
}

// ───────────────────────────── CSV ─────────────────────────────

function csvValue(c: Cell, type: ColType): string {
  if (c === null || c === undefined) return '';
  if (type === 'date' && typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) return formatDateSl(c);
  if (c instanceof Decimal) {
    const dp = type === 'eur' || type === 'pct' ? 2 : type === 'int' ? 0 : Math.min(c.decimalPlaces(), 8);
    return c.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(type === 'qty' ? undefined : dp).replace('.', ',');
  }
  return String(c);
}

function csvEscape(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV za slovenski Excel: UTF-8 z BOM, podpičje, decimalna vejica, datumi DD.MM.LLLL, brez ločil tisočic. */
export function toCsv(r: Report): string {
  const lines = [r.columns.map((c) => c.label), ...r.rows.map((row) => row.map((c, i) => csvValue(c, r.columns[i]!.type)))];
  if (r.totals) lines.push(r.totals.map((c, i) => csvValue(c, r.columns[i]!.type)));
  return `﻿${lines.map((l) => l.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

// ───────────────────────────── varnostna kopija → CSV poslov ─────────────────────────────

export interface Backup {
  format: string;
  verzija: number;
  ustvarjeno: string;
  accounts: Record<string, unknown>[];
  instruments: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  [k: string]: unknown;
}

/** Vsi zapisi iz tabele transactions kot CSV (za odpiranje v Excelu); števila ostanejo natančna. */
export function backupTransactionsCsv(b: Backup): string {
  const inst = new Map(b.instruments.map((i) => [String(i.id), i]));
  const acc = new Map(b.accounts.map((a) => [String(a.id), a]));
  const cols = ['Datum', 'Vrsta', 'Posrednik', 'ISIN', 'Simbol', 'Naziv', 'Količina', 'Cena', 'Znesek', 'Provizija', 'Valuta', 'Tečaj za 1 EUR', 'Vir', 'Oznaka vira', 'Opomba'];
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
  const rows = b.transactions.map((t) => {
    const i = inst.get(String(t.instrument_id));
    const a = acc.get(String(t.account_id));
    return [
      typeof t.trade_date === 'string' ? formatDateSl(t.trade_date) : '',
      String(t.type ?? ''),
      String(a?.broker ?? ''),
      String(i?.isin ?? ''),
      String(i?.symbol ?? ''),
      String(i?.name ?? ''),
      num(t.quantity),
      num(t.price),
      num(t.amount),
      num(t.fee),
      String(t.currency ?? ''),
      num(t.rate_per_eur),
      String(t.source ?? ''),
      String(t.source_ref ?? ''),
      String(t.note ?? ''),
    ];
  });
  return `﻿${[cols, ...rows].map((l) => l.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

/** Osnovno preverjanje, da je datoteka res varnostna kopija te aplikacije. */
export function isBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return Boolean(b && b.format === 'jn-portfelj-varnostna-kopija' && Array.isArray(b.transactions) && Array.isArray(b.instruments));
}
