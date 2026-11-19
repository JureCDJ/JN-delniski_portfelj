import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildDivXml, buildKdvpXml, missingPayerFields, validTaxNumber, XmlExportError, type Payer } from './edavkiXml';
import { validateTaxSettings, type TaxSettings } from './tax';
import { divYear, kdvpInventory, kdvpYear, taxYears } from './taxReturns';
import type { Trade } from './types';

const S: TaxSettings = validateTaxSettings({
  capitalGains: [
    { fromYears: 0, rate: '0.25' },
    { fromYears: 5, rate: '0.20' },
    { fromYears: 10, rate: '0.15' },
    { fromYears: 15, rate: '0' },
  ],
  dividendRate: '0.25',
  standardCostRate: '0.01',
});
const d2 = (x: Decimal) => x.toDecimalPlaces(2).toFixed(2);

let n = 0;
const t = (isin: string, type: Trade['type'], date: string, quantity: string, price: string, extra: Partial<Trade> = {}): Trade => ({
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
  ...extra,
});

// A: 6 let → 20 %, osnova 970 · B: 1 leto → 25 %, osnova 475 · C: izguba −218 in nakup 14 dni po prodaji
const trades: Trade[] = [
  t('AA0000000001', 'NAKUP', '2020-01-10', '10', '100'),
  t('AA0000000001', 'PRODAJA', '2026-03-01', '10', '200'),
  t('BB0000000002', 'NAKUP', '2025-01-02', '10', '100'),
  t('BB0000000002', 'PRODAJA', '2026-03-01', '10', '150'),
  t('CC0000000003', 'NAKUP', '2025-06-01', '10', '100'),
  t('CC0000000003', 'PRODAJA', '2026-04-01', '10', '80'),
  t('CC0000000003', 'NAKUP', '2026-04-15', '10', '79'),
];

describe('Doh-KDVP po letu', () => {
  const k = kdvpYear(trades, S, 2026);

  it('osnove po lotih z normiranimi stroški', () => {
    expect(k.rows.map((r) => [r.isin.slice(0, 2), d2(r.baseEur), r.rate.toString()])).toEqual([
      ['AA', '970.00', '0.2'],
      ['BB', '475.00', '0.25'],
      ['CC', '-218.00', '0.25'],
    ]);
    expect(d2(k.gainsBaseEur)).toBe('1445.00');
    expect(d2(k.lossesBaseEur)).toBe('218.00');
    expect(d2(k.netBaseEur)).toBe('1227.00');
  });

  it('izgube pobotane sorazmerno po stopnjah (kot Code.gs)', () => {
    expect(k.byRate.map((x) => [x.rate.toString(), d2(x.baseAfterOffsetEur), d2(x.taxEur)])).toEqual([
      ['0.25', '403.34', '100.83'],
      ['0.2', '823.66', '164.73'],
    ]);
    // 1227 × (970·0,20 + 475·0,25) / 1445
    expect(d2(k.taxEur)).toBe('265.57');
  });

  it('izguba in nakup v ±30 dneh → opozorilo (nakup samega lota ne šteje)', () => {
    expect(k.rows[2]!.washBuys).toEqual(['2026-04-15']);
    expect(k.washCount).toBe(1);
  });

  it('več izgub kot dobičkov → davek 0', () => {
    const z = kdvpYear([t('DD0000000004', 'NAKUP', '2025-01-01', '1', '100'), t('DD0000000004', 'PRODAJA', '2026-01-05', '1', '10')], S, 2026);
    expect(z.netBaseEur.isZero()).toBe(true);
    expect(z.taxEur.isZero()).toBe(true);
  });

  it('leta s prodajami ali dividendami', () => {
    expect(taxYears(trades, [{ isin: 'X', date: '2024-05-01', grossEur: new Decimal(1), foreignTaxEur: new Decimal(0) }])).toEqual([2026, 2024]);
  });
});

describe('popisni list', () => {
  it('vsi posli papirja do konca leta, zaloga po vrstici', () => {
    const sheets = kdvpInventory(trades, 2026);
    expect(sheets.map((s) => s.isin)).toEqual(['AA0000000001', 'BB0000000002', 'CC0000000003']);
    const c = sheets[2]!;
    expect(c.rows.map((r) => [r.kind, r.date, r.stock.toString()])).toEqual([
      ['NAKUP', '2025-06-01', '10'],
      ['PRODAJA', '2026-04-01', '0'],
      ['NAKUP', '2026-04-15', '10'],
    ]);
  });

  it('vrednost na enoto v EUR: nakup s provizijo, prodaja po odbitku provizije', () => {
    const s = kdvpInventory(
      [
        t('EE0000000005', 'NAKUP', '2026-01-02', '4', '110', { fee: '2', currency: 'USD', ratePerEur: '1.1' }),
        t('EE0000000005', 'PRODAJA', '2026-02-02', '4', '121', { fee: '2.2', currency: 'USD', ratePerEur: '1.1' }),
      ],
      2026,
    )[0]!;
    expect(s.rows[0]!.unitEur.toFixed(4)).toBe('100.4545'); // (440 + 2) / 1,1 / 4
    expect(s.rows[1]!.unitEur.toFixed(4)).toBe('109.5000'); // (484 − 2,2) / 1,1 / 4
  });
});

describe('Doh-Div po letu', () => {
  const dv = divYear(
    [
      { isin: 'US0000000001', date: '2026-03-10', grossEur: new Decimal('10'), foreignTaxEur: new Decimal(0) },
      { isin: 'US0000000001', date: '2026-03-10', grossEur: new Decimal(0), foreignTaxEur: new Decimal('1.5') },
      { isin: 'DE0000000002', date: '2026-05-05', grossEur: new Decimal('20'), foreignTaxEur: new Decimal('5.28') },
      { isin: 'DE0000000002', date: '2025-05-05', grossEur: new Decimal('99'), foreignTaxEur: new Decimal('0') },
      { isin: 'SI0031102120', date: '2026-07-01', grossEur: new Decimal('30'), foreignTaxEur: new Decimal('0') },
    ],
    S,
    2026,
  );
  it('bruto in tuji davek istega dne v eni vrstici; doplačilo = max(0, 25 % − tuji)', () => {
    expect(dv.rows.map((r) => [r.date, d2(r.grossEur), d2(r.foreignTaxEur), d2(r.topUpEur)])).toEqual([
      ['2026-03-10', '10.00', '1.50', '1.00'],
      ['2026-05-05', '20.00', '5.28', '0.00'],
    ]);
    expect(d2(dv.siTaxEur)).toBe('7.50');
    // Slovenski izdajatelj odtegne davek sam — ni v Doh-Div
    expect(dv.domesticRows.map((r) => r.isin)).toEqual(['SI0031102120']);
    expect(d2(dv.topUpEur)).toBe('1.00');
  });
});

describe('XML za eDavki', () => {
  const names = new Map([
    ['AA0000000001', { code: 'AAA', name: 'Alfa & Co', isFund: false }],
    ['BB0000000002', { code: 'BBB', name: 'Beta', isFund: false }],
    ['CC0000000003', { code: 'CCC', name: 'Gama', isFund: false }],
  ]);

  it('davčna številka: 8 števk', () => {
    expect(validTaxNumber('12345678')).toBe(true);
    expect(validTaxNumber('1234567')).toBe(false);
    expect(() => buildKdvpXml({ taxNumber: '123', year: 2026, sheets: kdvpInventory(trades, 2026), names })).toThrow(XmlExportError);
  });

  it('Doh-KDVP: popisni listi, zaloga, posebni znaki ubežani', () => {
    const xml = buildKdvpXml({ taxNumber: '12345678', year: 2026, sheets: kdvpInventory(trades, 2026), names });
    expect(xml).toContain('<SecurityCount>3</SecurityCount>');
    expect(xml).toContain('<Name>Alfa &amp; Co</Name>');
    expect(xml).toContain('<F4>79</F4>');
    expect(xml.match(/<Row>/g)).toHaveLength(7);
  });

  it('Doh-Div: manjkajoči podatki izplačevalca ustavijo izvoz', () => {
    const dv = divYear([{ isin: 'US0000000001', date: '2026-03-10', grossEur: new Decimal('10'), foreignTaxEur: new Decimal('1.5') }], S, 2026);
    expect(missingPayerFields({ name: 'X', address: null, country: 'US', id: null })).toEqual(['naslov', 'identifikacijska številka']);
    expect(missingPayerFields({ name: 'X', address: 'Ulica 1', country: 'SI', id: null })).toEqual([]);
    expect(() => buildDivXml({ taxNumber: '12345678', div: dv, payers: new Map() })).toThrow(/manjka naziv/);
  });

  it('obe datoteki ustrezata uradnima shemama FURS (xmllint)', async () => {
    let cp: { execFileSync: (cmd: string, args: string[], o?: object) => unknown };
    let fs: { writeFileSync: (p: string, d: string) => void; mkdtempSync: (p: string) => string };
    try {
      // @ts-expect-error -- Node modul samo v testu (brez @types/node v projektu)
      cp = await import('node:child_process');
      // @ts-expect-error -- Node modul samo v testu
      fs = await import('node:fs');
      cp.execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    } catch {
      return; // xmllint ni nameščen — preverjanje sheme preskočeno
    }
    const dir = fs.mkdtempSync('/tmp/edavki-');
    const payers = new Map<string, Payer>([['US0000000001', { name: 'Payer Inc.', address: '1 Main St, Wilmington, DE', country: 'US', id: '12-3456789' }]]);
    const div = divYear([{ isin: 'US0000000001', date: '2026-03-10', grossEur: new Decimal('10.005'), foreignTaxEur: new Decimal('1.5') }], S, 2026);
    const files: [string, string][] = [
      ['kdvp.xml', buildKdvpXml({ taxNumber: '12345678', year: 2026, sheets: kdvpInventory(trades, 2026), names })],
      ['div.xml', buildDivXml({ taxNumber: '12345678', div, payers, email: 'a@b.si' })],
    ];
    const xsd = { 'kdvp.xml': 'docs/edavki/Doh_KDVP_9.xsd', 'div.xml': 'docs/edavki/Doh_Div_3.xsd' } as const;
    for (const [name, content] of files) {
      fs.writeFileSync(`${dir}/${name}`, content);
      expect(() => cp.execFileSync('xmllint', ['--noout', '--schema', xsd[name as keyof typeof xsd], `${dir}/${name}`], { stdio: 'pipe' })).not.toThrow();
    }
    expect(files[1]![1]).toContain('<Value>10.01</Value>');
  });
});
