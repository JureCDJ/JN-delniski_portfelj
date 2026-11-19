import { describe, expect, it } from 'vitest';
import { cleanNumber, parseFrankfurter, parseYahooChart } from './marketData';

// Skrajšan resničen odgovor Yahoo za ENR.DE (19.11.2026).
const ENR = {
  chart: {
    result: [
      {
        meta: { currency: 'EUR', symbol: 'ENR.DE', exchangeTimezoneName: 'Europe/Berlin', gmtoffset: 3600 },
        timestamp: [1794556800, 1794816000, 1794902400, 1794988800, 1795075200],
        indicators: { quote: [{ close: [131.27999877929688, 128.97999572753906, 125.0, 126.66000366210938, 130.39999389648438] }] },
      },
    ],
    error: null,
  },
};

describe('Yahoo', () => {
  it('zadnji dve ceni z datumom borze, brez artefaktov float', () => {
    const q = parseYahooChart(ENR);
    expect(q.currency).toBe('EUR');
    expect(q.closes).toEqual([
      { date: '2026-11-18', close: '126.66' },
      { date: '2026-11-19', close: '130.4' },
    ]);
  });

  it('manjkajoče cene (null) preskoči', () => {
    const body = structuredClone(ENR);
    body.chart.result[0]!.indicators.quote[0]!.close[4] = null as unknown as number;
    expect(parseYahooChart(body).closes.at(-1)).toEqual({ date: '2026-11-18', close: '126.66' });
  });

  it('pence → GBP', () => {
    const body = structuredClone(ENR);
    body.chart.result[0]!.meta.currency = 'GBp';
    expect(parseYahooChart(body)).toMatchObject({ currency: 'GBP', closes: [{ close: '1.2666' }, { close: '1.304' }] });
  });

  it('neznan simbol → jasna napaka', () => {
    expect(() =>
      parseYahooChart({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }),
    ).toThrow('No data found');
  });

  it('datum ob polnoči UTC pripade pravemu lokalnemu dnevu (New York)', () => {
    // 2026-11-18 14:30 UTC = 09:30 v New Yorku (gmtoffset −18000)
    const ts = Date.UTC(2026, 10, 18, 14, 30) / 1000;
    const q = parseYahooChart({
      chart: { result: [{ meta: { currency: 'USD', gmtoffset: -18000 }, timestamp: [ts], indicators: { quote: [{ close: [150.96] }] } }] },
    });
    expect(q.closes).toEqual([{ date: '2026-11-18', close: '150.96' }]);
  });
});

describe('ECB (Frankfurter)', () => {
  it('tečaji enot za 1 EUR', () => {
    expect(parseFrankfurter({ amount: 1, base: 'EUR', date: '2026-11-18', rates: { USD: 1.0968, HKD: 8.5321 } })).toEqual({
      date: '2026-11-18',
      rates: { USD: '1.0968', HKD: '8.5321' },
    });
  });
  it('zavrne nepričakovan odgovor', () => {
    expect(() => parseFrankfurter({ base: 'USD', date: '2026-11-18', rates: {} })).toThrow();
  });
  it('cleanNumber', () => {
    expect(cleanNumber(0.1 + 0.2)).toBe('0.3');
    expect(() => cleanNumber(NaN)).toThrow();
  });
});
