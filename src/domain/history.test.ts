import { describe, expect, it } from 'vitest';
import { buildValueSeries, weeklyDates } from './history';
import { buildPositions, summarize } from './portfolio';
import { buildQuotes } from './quotes';
import type { Trade } from './types';

const t = (p: Pick<Trade, 'id' | 'isin' | 'type' | 'date' | 'quantity' | 'price'>): Trade => ({
  accountId: 'a',
  fee: '0',
  currency: 'EUR',
  ratePerEur: '1',
  ...p,
});

describe('tedenski datumi', () => {
  it('petki od začetka do danes + današnji dan', () => {
    expect(weeklyDates('2026-11-02', '2026-11-18')).toEqual(['2026-11-06', '2026-11-13', '2026-11-18']);
  });
  it('konec na petek se ne podvoji', () => {
    expect(weeklyDates('2026-11-02', '2026-11-13')).toEqual(['2026-11-06', '2026-11-13']);
  });
});

describe('vrednost skozi čas', () => {
  const trades = [
    t({ id: '1', isin: 'US', type: 'NAKUP', date: '2026-11-02', quantity: '10', price: '90' }),
    t({ id: '2', isin: 'EU', type: 'NAKUP', date: '2026-11-10', quantity: '5', price: '100' }),
    t({ id: '3', isin: 'EU', type: 'PRODAJA', date: '2026-11-17', quantity: '5', price: '110' }),
  ];
  const prices = [
    { isin: 'US', date: '2026-11-06', close: '110', currency: 'USD', source: 'YAHOO' },
    { isin: 'US', date: '2026-11-13', close: '121', currency: 'USD', source: 'YAHOO' },
    { isin: 'EU', date: '2026-11-13', close: '104', currency: 'EUR', source: 'YAHOO' },
  ];
  const fx = [
    { date: '2026-11-05', currency: 'USD', ratePerEur: '1.10' },
    { date: '2026-11-12', currency: 'USD', ratePerEur: '1.10' },
  ];
  const s = buildValueSeries(trades, prices, fx, '2026-11-18');

  it('vrednost po tečaju na tisti dan; vloženo = nabavna vrednost odprtih lotov', () => {
    expect(s.map((p) => p.date)).toEqual(['2026-11-06', '2026-11-13', '2026-11-18']);
    expect(s[0]!.valueEur.toFixed(2)).toBe('1000.00'); // 10 × 110 $ / 1,10
    expect(s[0]!.investedEur.toFixed(2)).toBe('900.00');
    expect(s[1]!.valueEur.toFixed(2)).toBe('1620.00'); // 10 × 121 / 1,10 + 5 × 104
    expect(s[1]!.investedEur.toFixed(2)).toBe('1400.00');
  });
  it('po prodaji pozicija ni več v vrednosti', () => {
    expect(s[2]!.investedEur.toFixed(2)).toBe('900.00');
    expect(s[2]!.valueEur.toFixed(2)).toBe('1100.00'); // zadnja cena 121 $ ≤ 18.11
  });
  it('zadnja točka grafa = vrednost na pregledu (iste cene in tečaji)', () => {
    const { quotes } = buildQuotes(prices, fx);
    const s1 = summarize(buildPositions(trades, quotes));
    expect(s.at(-1)!.valueEur.toFixed(2)).toBe(s1.valueEur.toFixed(2));
  });
  it('brez cene → nabavna vrednost in oznaka nepopolno', () => {
    const s2 = buildValueSeries(trades, [], [], '2026-11-07');
    expect(s2[0]).toMatchObject({ complete: false });
    expect(s2[0]!.valueEur.toFixed(2)).toBe('900.00');
  });
  it('prestara cena (> 21 dni) ne velja', () => {
    const s3 = buildValueSeries(
      [t({ id: '1', isin: 'EU', type: 'NAKUP', date: '2026-01-02', quantity: '1', price: '50' })],
      [{ isin: 'EU', date: '2026-01-02', close: '60', currency: 'EUR', source: 'YAHOO' }],
      [],
      '2026-03-06',
    );
    expect(s3.at(-1)!.complete).toBe(false);
    expect(s3[0]!.valueEur.toFixed(2)).toBe('60.00');
  });
});
