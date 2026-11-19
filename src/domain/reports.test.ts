import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildOverview } from './overview';
import { backupTransactionsCsv, dividendsReport, portfolioReport, salesReport, toCsv, type Report } from './reports';
import { validateTaxSettings, type TaxSettings } from './tax';
import { kdvpYear } from './taxReturns';
import type { Trade } from './types';

const S: TaxSettings = validateTaxSettings({
  capitalGains: [
    { fromYears: 0, rate: '0.25' },
    { fromYears: 5, rate: '0.20' },
  ],
  dividendRate: '0.25',
  standardCostRate: '0.01',
});

let n = 0;
const t = (isin: string, type: Trade['type'], date: string, quantity: string, price: string): Trade => ({
  id: `t${++n}`,
  accountId: 'a',
  isin,
  type,
  date,
  quantity,
  price,
  fee: '0',
  currency: 'EUR',
  ratePerEur: '1',
});

const trades = [
  t('AA0000000001', 'NAKUP', '2020-01-10', '10', '100'),
  t('AA0000000001', 'PRODAJA', '2026-03-01', '4', '200'),
  t('BB0000000002', 'NAKUP', '2025-01-02', '3', '1234.5'),
  t('BB0000000002', 'PRODAJA', '2025-06-01', '1', '1000'),
];
const instruments = [
  { isin: 'AA0000000001', symbol: 'AAA', name: 'Alfa; d.d. "A"' },
  { isin: 'BB0000000002', symbol: 'BBB', name: 'Beta' },
];
const quotes = [
  { isin: 'AA0000000001', date: '2026-11-18', price: '210', ratePerEur: '1' },
  { isin: 'BB0000000002', date: '2026-11-18', price: '1300', ratePerEur: '1' },
];

describe('izpisi', () => {
  it('pregled portfelja: vsote = pregled v aplikaciji', () => {
    const r = portfolioReport({ trades, quotes, instruments, targets: new Map(), settings: S, today: '2026-11-19' });
    const o = buildOverview({ trades, quotes, dividends: [], targets: new Map(), settings: S, today: '2026-11-19' });
    expect(r.rows).toHaveLength(2);
    expect((r.totals![8] as Decimal).toString()).toBe(o.summary.valueEur.toString());
    expect((r.totals![13] as Decimal).toString()).toBe(o.summary.taxTodayEur.toString());
  });

  it('prodaje: vsa leta = vsota po letih', () => {
    const all = salesReport({ trades, instruments, settings: S, year: null });
    const y25 = kdvpYear(trades, S, 2025);
    const y26 = kdvpYear(trades, S, 2026);
    expect(all.rows).toHaveLength(2);
    expect((all.totals![8] as Decimal).toString()).toBe(y25.gainEur.plus(y26.gainEur).toString());
    expect(salesReport({ trades, instruments, settings: S, year: 2026 }).rows).toHaveLength(1);
  });

  it('dividende: slovenski izplačevalec označen in brez SI davka', () => {
    const r = dividendsReport({
      dividends: [
        { isin: 'SI0031102120', date: '2026-07-01', grossEur: new Decimal('30'), foreignTaxEur: new Decimal(0) },
        { isin: 'US0000000001', date: '2026-03-10', grossEur: new Decimal('10'), foreignTaxEur: new Decimal('1.5') },
      ],
      instruments,
      settings: S,
      year: 2026,
    });
    expect(r.rows.map((x) => x[0])).toEqual(['2026-03-10', '2026-07-01']);
    expect(r.rows[1]![8]).toBeNull();
    expect((r.totals![9] as Decimal).toFixed(2)).toBe('1.00');
  });

  it('CSV za slovenski Excel: BOM, podpičje, decimalna vejica, datumi, ubežani znaki', () => {
    const r: Report = {
      title: 'x',
      subtitle: '',
      columns: [
        { label: 'Datum', type: 'date' },
        { label: 'Naziv', type: 'text' },
        { label: 'Znesek (€)', type: 'eur' },
        { label: 'Količina', type: 'qty' },
      ],
      rows: [['2026-03-01', 'Alfa; d.d. "A"', new Decimal('1234.565'), new Decimal('0.12345678')]],
    };
    const csv = toCsv(r);
    expect(csv.startsWith('﻿Datum;Naziv;Znesek (€);Količina\r\n')).toBe(true);
    expect(csv).toContain('01.03.2026;"Alfa; d.d. ""A""";1234,57;0,12345678\r\n');
  });

  it('CSV poslov iz varnostne kopije ohrani vsa decimalna mesta', () => {
    const csv = backupTransactionsCsv({
      format: 'jn-portfelj-varnostna-kopija',
      verzija: 1,
      ustvarjeno: '2026-11-19T10:00:00Z',
      accounts: [{ id: 'a1', broker: 'N26' }],
      instruments: [{ id: 'i1', isin: 'US0000000001', symbol: 'X', name: 'Ime' }],
      transactions: [{ trade_date: '2025-03-06', type: 'NAKUP', account_id: 'a1', instrument_id: 'i1', quantity: '1.0042000000', price: '495.8972316272', fee: '0', currency: 'EUR', rate_per_eur: '1', source: 'TABELA' }],
    });
    expect(csv).toContain('06.03.2025;NAKUP;N26;US0000000001;X;Ime;1,0042000000;495,8972316272;;0;EUR;1;TABELA;;');
  });
});

describe('dvojina in množina', () => {
  it('1, 2, 3–4, 5+', async () => {
    const { plural } = await import('./reports');
    expect([1, 2, 3, 5, 101, 102].map((n) => plural(n, 'vrstica', 'vrstici', 'vrstice', 'vrstic'))).toEqual([
      '1 vrstica',
      '2 vrstici',
      '3 vrstice',
      '5 vrstic',
      '101 vrstica',
      '102 vrstici',
    ]);
  });
});
