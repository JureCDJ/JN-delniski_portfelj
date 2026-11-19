import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildOverview, toUsd, usdRateOn, type Dividend } from './overview';
import { validateTaxSettings } from './tax';
import type { Trade } from './types';

const S = validateTaxSettings({
  capitalGains: [
    { fromYears: 0, rate: '0.25' },
    { fromYears: 5, rate: '0.20' },
    { fromYears: 10, rate: '0.15' },
    { fromYears: 15, rate: '0' },
  ],
  dividendRate: '0.25',
  standardCostRate: '0.01',
});
const t = (p: Partial<Trade> & Pick<Trade, 'id' | 'type' | 'date' | 'quantity' | 'price'>): Trade => ({
  accountId: 'a',
  isin: 'A',
  fee: '0',
  currency: 'EUR',
  ratePerEur: '1',
  ...p,
});
const d2 = (x: Decimal) => x.toDecimalPlaces(2).toFixed(2);

const trades: Trade[] = [
  t({ id: '1', type: 'NAKUP', date: '2025-01-10', quantity: '10', price: '100' }),
  t({ id: '2', isin: 'B', type: 'NAKUP', date: '2025-02-10', quantity: '5', price: '50' }),
  t({ id: '3', isin: 'B', type: 'PRODAJA', date: '2026-03-10', quantity: '5', price: '70' }),
];
const dividends: Dividend[] = [{ isin: 'A', date: '2026-05-01', grossEur: new Decimal('10'), foreignTaxEur: new Decimal('1.5') }];
const quotes = [{ isin: 'A', date: '2026-11-18', price: '120', ratePerEur: '1', previousPrice: '118', previousRatePerEur: '1' }];

describe('pregled v2', () => {
  const o = buildOverview({ trades, quotes, dividends, targets: new Map([['A', new Decimal('150')]]), settings: S, today: '2026-11-19' });
  const s = o.summary;

  it('davek ob prodaji danes in neto po davku', () => {
    // 1200 vs 1000: osnova 1188 − 1010 = 178 × 25 % = 44,50
    expect(d2(s.unrealizedEur)).toBe('200.00');
    expect(d2(s.taxTodayEur)).toBe('44.50');
    expect(d2(s.unrealizedNetEur)).toBe('155.50');
  });
  it('cilj: do cilja v %, neto ob cilju po davku', () => {
    const p = o.positions[0]!;
    expect(d2(p.target!.toTargetPct!)).toBe('25.00');
    expect(p.target!.reached).toBe(false);
    // 1500 vs 1000: osnova 1485 − 1010 = 475 × 25 % = 118,75 → neto 500 − 118,75
    expect(d2(p.target!.atTarget.netEur)).toBe('381.25');
    expect(d2(s.targetsNetEur)).toBe('381.25');
  });
  it('skupni donos = nerealizirano + realizirano + dividende neto − davek na prodaje', () => {
    // realizirano 100; davek: (346,5 − 252,5) × 25 % = 23,50; dividende neto 8,50
    expect(d2(s.realizedEur)).toBe('100.00');
    expect(d2(s.realizedTaxEur)).toBe('23.50');
    expect(d2(s.dividendsNetEur)).toBe('8.50');
    expect(d2(s.totalReturnEur)).toBe('285.00');
  });
  it('naslednja nižja stopnja po lotih', () => {
    expect(o.positions[0]!.lotsView[0]!.nextLower).toMatchObject({ date: '2030-01-10' });
  });
  it('pozicija brez cene: ni v vrednosti, je v investiranem', () => {
    const o2 = buildOverview({ trades, quotes: [], dividends: [], targets: new Map(), settings: S, today: '2026-11-19' });
    expect(o2.summary.missingQuotes).toEqual(['A']);
    expect(d2(o2.summary.investedOpen)).toBe('1000.00');
    expect(o2.summary.valueEur.isZero()).toBe(true);
  });

  it('pogled v USD: nakup po tečaju na dan nakupa, vrednost po zadnjem', () => {
    const rates = [
      { date: '2025-01-10', rate: new Decimal('1.03') },
      { date: '2025-02-10', rate: new Decimal('1.04') },
      { date: '2026-03-10', rate: new Decimal('1.08') },
      { date: '2026-05-01', rate: new Decimal('1.12') },
      { date: '2026-11-18', rate: new Decimal('1.10') },
    ];
    const u = toUsd(o, trades, dividends, rates, S)!;
    expect(d2(u.investedOpen)).toBe('1030.00'); // 1000 € × 1,03
    expect(d2(u.valueUsd)).toBe('1320.00'); // 1200 € × 1,10
    expect(d2(u.unrealizedUsd)).toBe('290.00');
    expect(d2(u.realizedUsd)).toBe('118.00'); // 350 × 1,08 − 250 × 1,04
    expect(d2(u.dividendsNetUsd)).toBe('9.52'); // 8,50 × 1,12
    // vpliv tečaja: 28,16 % v USD proti 20 % v EUR
    expect(d2(u.fxEffectPts!)).toBe('8.16');
  });
  it('tečaj za praznik = zadnji objavljeni', () => {
    expect(usdRateOn([{ date: '2024-12-31', rate: new Decimal('1.0389') }], '2025-01-01')!.toString()).toBe('1.0389');
  });
});
