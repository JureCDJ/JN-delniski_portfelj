import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildLedger, PortfolioError } from './portfolio';
import { buildStockCard, heldOn, previewSale, priceSeriesEur } from './stockCard';
import { taxOnDisposals, validateTaxSettings, type TaxSettings } from './tax';
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

const t = (p: Pick<Trade, 'id' | 'type' | 'date' | 'quantity' | 'price'> & Partial<Trade>): Trade => ({
  accountId: 'a',
  isin: 'X',
  fee: '0',
  currency: 'EUR',
  ratePerEur: '1',
  ...p,
});

const trades = [
  t({ id: 'b1', type: 'NAKUP', date: '2020-01-10', quantity: '10', price: '100' }),
  t({ id: 'b2', type: 'NAKUP', date: '2024-06-01', quantity: '10', price: '150' }),
];
const sale = { isin: 'X', date: '2026-11-19', quantity: '15', price: '200', fee: '0', currency: 'EUR', ratePerEur: '1' };

describe('predogled prodaje (FIFO)', () => {
  const p = previewSale(trades, sale, S);

  it('zapre najstarejši lot, nato del naslednjega', () => {
    expect(p.parts.map((x) => [x.buyDate, x.quantity.toString()])).toEqual([
      ['2020-01-10', '10'],
      ['2024-06-01', '5'],
    ]);
    expect(p.heldBefore.toString()).toBe('20');
  });

  it('davek po lotu: stopnja po letih imetništva, 1 % normirani stroški', () => {
    // lot 1: 2000·0,99 − 1000·1,01 = 970 → 6 let → 20 % = 194
    expect(d2(p.parts[0]!.baseEur)).toBe('970.00');
    expect(p.parts[0]!.rate.toString()).toBe('0.2');
    expect(d2(p.parts[0]!.taxEur)).toBe('194.00');
    // lot 2: 1000·0,99 − 750·1,01 = 232,50 → 2 leti → 25 % = 58,125
    expect(d2(p.parts[1]!.baseEur)).toBe('232.50');
    expect(p.parts[1]!.taxEur.toString()).toBe('58.125');
    expect(d2(p.gainEur)).toBe('1250.00');
    expect(d2(p.taxEur)).toBe('252.13');
    expect(d2(p.netEur)).toBe('997.88');
  });

  it('predogled = izračun po shranjeni prodaji', () => {
    const saved = [...trades, t({ ...sale, id: 's1', type: 'PRODAJA' })];
    const disposals = buildLedger(saved).disposals.filter((x) => x.sellTradeId === 's1');
    expect(taxOnDisposals(disposals, S).toString()).toBe(p.taxEur.toString());
  });

  it('tuja valuta in provizija: kupnina = (količina × cena − provizija) / tečaj', () => {
    const usd = previewSale(trades, { ...sale, quantity: '10', price: '220', fee: '2', currency: 'USD', ratePerEur: '1.1' }, S);
    expect(d2(usd.proceedsEur)).toBe('1998.18'); // (2200 − 2) / 1,1
  });

  it('prodaja več, kot je v lasti → napaka', () => {
    expect(() => previewSale(trades, { ...sale, quantity: '21' }, S)).toThrow(PortfolioError);
  });

  it('prodaja pred nakupom ne sme porabiti kasnejšega lota', () => {
    expect(() => previewSale(trades, { ...sale, date: '2023-01-01', quantity: '15' }, S)).toThrow(PortfolioError);
    expect(heldOn(trades, 'X', '2023-01-01').toString()).toBe('10');
  });

  it('izguba in nakup v ±30 dneh → opozorilo', () => {
    const tr = [...trades, t({ id: 'b3', type: 'NAKUP', date: '2026-11-01', quantity: '1', price: '300' })];
    const loss = previewSale(tr, { ...sale, quantity: '5', price: '50' }, S);
    expect(loss.baseEur.isNegative()).toBe(true);
    expect(loss.washBuys.map((w) => w.date)).toEqual(['2026-11-01']);
    expect(previewSale(tr, { ...sale, quantity: '5' }, S).washBuys).toEqual([]);
  });
});

describe('kartica delnice', () => {
  it('zaključene prodaje z davkom in dividende samo za ta papir', () => {
    const tr = [
      ...trades,
      t({ id: 's1', type: 'PRODAJA', date: '2026-01-15', quantity: '12', price: '180' }),
      t({ id: 'o1', isin: 'Y', type: 'NAKUP', date: '2026-01-01', quantity: '1', price: '10' }),
    ];
    const card = buildStockCard({
      trades: tr,
      isin: 'X',
      settings: S,
      dividends: [
        { isin: 'X', date: '2025-05-01', grossEur: new Decimal('10'), foreignTaxEur: new Decimal('1.5') },
        { isin: 'Y', date: '2025-05-01', grossEur: new Decimal('99'), foreignTaxEur: new Decimal('0') },
      ],
    });
    expect(card.disposals).toHaveLength(2);
    expect(d2(card.realizedEur)).toBe('860.00'); // 12·180 − (1000 + 300)
    expect(card.dividends).toHaveLength(1);
    expect(d2(card.dividendsNetEur)).toBe('8.50');
  });

  it('zgodovina cene v EUR po tečaju na dan cene', () => {
    const s = priceSeriesEur(
      [
        { isin: 'X', date: '2026-11-13', close: '110', currency: 'USD', source: 'YAHOO' },
        { isin: 'X', date: '2026-11-06', close: '99', currency: 'USD', source: 'YAHOO' },
        { isin: 'Z', date: '2026-11-06', close: '1', currency: 'EUR', source: 'YAHOO' },
      ],
      [
        { date: '2026-11-05', currency: 'USD', ratePerEur: '1.1' },
        { date: '2026-11-12', currency: 'USD', ratePerEur: '1.0' },
      ],
      'X',
    );
    expect(s.map((p) => [p.date, d2(p.priceEur)])).toEqual([
      ['2026-11-06', '90.00'],
      ['2026-11-13', '110.00'],
    ]);
  });
});
