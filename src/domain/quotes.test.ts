import { describe, expect, it } from 'vitest';
import { buildPositions, summarize } from './portfolio';
import { buildQuotes, daysBetween, isStale, type FxRow, type PriceRow } from './quotes';

const fx: FxRow[] = [
  { date: '2026-11-17', currency: 'USD', ratePerEur: '1.0989' },
  { date: '2026-11-18', currency: 'USD', ratePerEur: '1.0968' },
];

describe('sestava tečajev', () => {
  it('zadnja in prejšnja cena, vsaka s tečajem svojega dne', () => {
    const prices: PriceRow[] = [
      { isin: 'US', date: '2026-11-18', close: '150.96', currency: 'USD', source: 'YAHOO' },
      { isin: 'US', date: '2026-11-17', close: '148', currency: 'USD', source: 'YAHOO' },
    ];
    const { quotes, latestDate } = buildQuotes(prices, fx);
    expect(quotes[0]).toMatchObject({
      price: '150.96',
      ratePerEur: '1.0968',
      previousPrice: '148',
      previousRatePerEur: '1.0989',
    });
    expect(latestDate).toBe('2026-11-18');
  });

  it('cena na dan brez tečaja ECB (danes, vikend) uporabi zadnji objavljeni tečaj', () => {
    const { quotes } = buildQuotes([{ isin: 'US', date: '2026-11-19', close: '151', currency: 'USD', source: 'YAHOO' }], fx);
    expect(quotes[0]!.ratePerEur).toBe('1.0968');
  });

  it('EUR ima tečaj 1; ročna cena brez valute = EUR', () => {
    const { quotes } = buildQuotes([{ isin: 'SI', date: '2026-11-18', close: '250', currency: null, source: 'ROCNO' }], []);
    expect(quotes[0]).toMatchObject({ ratePerEur: '1', currency: 'EUR', source: 'ROCNO' });
  });

  it('brez tečaja za valuto → navedeno, ne tiho napačno', () => {
    const r = buildQuotes([{ isin: 'HK', date: '2026-11-18', close: '64', currency: 'HKD', source: 'YAHOO' }], fx);
    expect(r.quotes).toHaveLength(0);
    expect(r.missingFx).toEqual(['HK']);
  });

  it('zastarelost cene', () => {
    expect(daysBetween('2026-11-13', '2026-11-18')).toBe(5);
    expect(isStale('2026-11-14', '2026-11-18')).toBe(false);
    expect(isStale('2026-11-13', '2026-11-18')).toBe(true);
  });
});

describe('navzkrižna kontrola s tabelo (AKTUALNI PORTFELJ, cene KVOTE 15.11.2026)', () => {
  // Tabela: NVIDIA 16,6742 kos, cena 150,96 USD × 0,911105 EUR/USD = 137,5404 €/kos.
  // Aplikacija: tečaj kot enot USD za 1 EUR = 1 / 0,911105.
  it('vrednost pozicije se ujema na cent', () => {
    const trades = [
      { id: 'n', accountId: 'a', isin: 'US', type: 'NAKUP' as const, date: '2025-01-01', quantity: '16.6742', price: '140', fee: '0', currency: 'EUR', ratePerEur: '1' },
    ];
    const { quotes } = buildQuotes(
      [{ isin: 'US', date: '2026-11-15', close: '150.96', currency: 'USD', source: 'YAHOO' }],
      [{ date: '2026-11-15', currency: 'USD', ratePerEur: String(1 / 0.911105) }],
    );
    const s = summarize(buildPositions(trades, quotes));
    // 16,6742 × 137,5404108 = 2.293,38 € (neodvisno preverjeno s Python Decimal)
    expect(s.valueEur.toDecimalPlaces(2).toString()).toBe('2293.38');
  });
});
