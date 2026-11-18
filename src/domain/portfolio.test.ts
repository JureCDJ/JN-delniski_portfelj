import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { fullYearsBetween, formatDateSl, parseIsoDate } from './dates';
import { formatEur, formatPct, formatSignedEur } from './format';
import { buildLedger, buildPositions, PortfolioError, summarize } from './portfolio';
import type { Trade } from './types';

let seq = 0;
function trade(p: Partial<Trade> & Pick<Trade, 'type' | 'date' | 'quantity' | 'price'>): Trade {
  seq += 1;
  return {
    id: p.id ?? `t${seq}`,
    accountId: 'ibkr',
    isin: p.isin ?? 'US0378331005',
    fee: '0',
    currency: 'EUR',
    ratePerEur: '1',
    ...p,
  };
}

const d = (v: Decimal) => v.toString();

describe('datumi', () => {
  it('polna leta: obletnica šteje kot dopolnjeno leto', () => {
    expect(fullYearsBetween('2020-03-15', '2025-03-14')).toBe(4);
    expect(fullYearsBetween('2020-03-15', '2025-03-15')).toBe(5);
  });
  it('29. februar', () => {
    expect(fullYearsBetween('2020-02-29', '2021-02-28')).toBe(0);
    expect(fullYearsBetween('2020-02-29', '2021-03-01')).toBe(1);
  });
  it('zavrne neveljaven datum', () => {
    expect(() => parseIsoDate('2025-02-30')).toThrow();
    expect(() => parseIsoDate('15.03.2025')).toThrow();
  });
  it('slovenski zapis', () => {
    expect(formatDateSl('2026-01-05')).toBe('05.01.2026');
  });
});

describe('FIFO', () => {
  it('provizija ob nakupu se prišteje nabavni vrednosti', () => {
    const { openLots } = buildLedger([trade({ type: 'NAKUP', date: '2025-01-10', quantity: '10', price: '100', fee: '5' })]);
    expect(d(openLots[0]!.costEur)).toBe('1005');
  });

  it('delna prodaja porabi najstarejšo loto najprej', () => {
    const { openLots, disposals } = buildLedger([
      trade({ id: 'b1', type: 'NAKUP', date: '2020-01-10', quantity: '10', price: '100' }),
      trade({ id: 'b2', type: 'NAKUP', date: '2024-01-10', quantity: '10', price: '200' }),
      trade({ id: 's1', type: 'PRODAJA', date: '2025-06-01', quantity: '15', price: '300' }),
    ]);
    expect(disposals).toHaveLength(2);
    expect(disposals[0]).toMatchObject({ buyTradeId: 'b1', holdingYears: 5 });
    expect(d(disposals[0]!.quantity)).toBe('10');
    expect(d(disposals[0]!.costEur)).toBe('1000');
    expect(d(disposals[0]!.proceedsEur)).toBe('3000');
    expect(d(disposals[1]!.quantity)).toBe('5');
    expect(d(disposals[1]!.costEur)).toBe('1000');
    expect(disposals[1]!.holdingYears).toBe(1);
    expect(openLots).toHaveLength(1);
    expect(d(openLots[0]!.quantity)).toBe('5');
    expect(d(openLots[0]!.costEur)).toBe('1000');
  });

  it('provizija ob prodaji zmanjša kupnino; vsota kosov je točna', () => {
    const { disposals } = buildLedger([
      trade({ type: 'NAKUP', date: '2024-01-01', quantity: '1', price: '10' }),
      trade({ type: 'NAKUP', date: '2024-01-02', quantity: '1', price: '10' }),
      trade({ type: 'NAKUP', date: '2024-01-03', quantity: '1', price: '10' }),
      trade({ type: 'PRODAJA', date: '2025-01-01', quantity: '3', price: '10', fee: '1' }),
    ]);
    const total = disposals.reduce((s, x) => s.plus(x.proceedsEur), new Decimal(0));
    expect(d(total)).toBe('29');
  });

  it('pretvorba v EUR po tečaju na dan posla (enot valute za 1 EUR)', () => {
    const { disposals } = buildLedger([
      trade({ type: 'NAKUP', date: '2024-01-10', quantity: '10', price: '110', currency: 'USD', ratePerEur: '1.10' }),
      trade({ type: 'PRODAJA', date: '2025-01-10', quantity: '10', price: '120', currency: 'USD', ratePerEur: '1.20' }),
    ]);
    // nakup 1100 USD / 1,10 = 1000 EUR; prodaja 1200 USD / 1,20 = 1000 EUR → dobiček 0 kljub rasti v USD
    expect(d(disposals[0]!.costEur)).toBe('1000');
    expect(d(disposals[0]!.proceedsEur)).toBe('1000');
    expect(d(disposals[0]!.gainEur)).toBe('0');
  });

  it('decimalna natančnost (0,1 + 0,2)', () => {
    const { openLots } = buildLedger([
      trade({ type: 'NAKUP', date: '2025-01-01', quantity: '0.1', price: '1' }),
      trade({ type: 'NAKUP', date: '2025-01-02', quantity: '0.2', price: '1' }),
    ]);
    const qty = openLots.reduce((s, l) => s.plus(l.quantity), new Decimal(0));
    expect(d(qty)).toBe('0.3');
  });

  it('isti dan: nakup se upošteva pred prodajo', () => {
    expect(() =>
      buildLedger([
        trade({ type: 'PRODAJA', date: '2025-01-01', quantity: '5', price: '10' }),
        trade({ type: 'NAKUP', date: '2025-01-01', quantity: '5', price: '9' }),
      ]),
    ).not.toThrow();
  });

  it('prodaja več, kot je v lasti → jasna napaka, ne tiho', () => {
    expect(() =>
      buildLedger([
        trade({ type: 'NAKUP', date: '2025-01-01', quantity: '5', price: '10' }),
        trade({ type: 'PRODAJA', date: '2025-02-01', quantity: '6', price: '10' }),
      ]),
    ).toThrow(PortfolioError);
  });

  it('zavrne ničelno količino in negativno ceno', () => {
    expect(() => buildLedger([trade({ type: 'NAKUP', date: '2025-01-01', quantity: '0', price: '1' })])).toThrow(PortfolioError);
    expect(() => buildLedger([trade({ type: 'NAKUP', date: '2025-01-01', quantity: '1', price: '-1' })])).toThrow(PortfolioError);
  });

  it('lote se ločijo po ISIN', () => {
    const { openLots } = buildLedger([
      trade({ isin: 'A', type: 'NAKUP', date: '2025-01-01', quantity: '1', price: '1' }),
      trade({ isin: 'B', type: 'NAKUP', date: '2025-01-01', quantity: '2', price: '1' }),
    ]);
    expect(openLots.map((l) => l.isin).sort()).toEqual(['A', 'B']);
  });
});

describe('pozicije in povzetek', () => {
  const trades = [
    trade({ isin: 'A', type: 'NAKUP', date: '2025-01-01', quantity: '10', price: '100', fee: '10' }),
    trade({ isin: 'B', type: 'NAKUP', date: '2025-01-01', quantity: '5', price: '50' }),
  ];

  it('vrednost, nerealiziran donos in dnevna sprememba', () => {
    const [a] = buildPositions(trades, [
      { isin: 'A', date: '2026-11-18', price: '121', ratePerEur: '1', previousPrice: '120', previousRatePerEur: '1' },
    ]);
    expect(d(a!.costEur)).toBe('1010');
    expect(d(a!.valueEur!)).toBe('1210');
    expect(d(a!.unrealizedEur!)).toBe('200');
    expect(d(a!.dayChangeEur!)).toBe('10');
  });

  it('pozicija brez tečaja se ne šteje v vrednost, je pa navedena', () => {
    const s = summarize(buildPositions(trades, [{ isin: 'A', date: '2026-11-18', price: '121', ratePerEur: '1' }]));
    expect(d(s.valueEur)).toBe('1210');
    expect(s.missingQuotes).toEqual(['B']);
    expect(d(s.costEur)).toBe('1260');
  });
});

describe('prikaz sl-SI', () => {
  it('zneski in odstotki', () => {
    // Intl uporablja nedeljivi presledek pred €
    expect(formatEur(new Decimal('1234.565')).replace(/\s/g, ' ')).toBe('1.234,57 €');
    expect(formatSignedEur(new Decimal('-12.5')).replace(/\s/g, ' ')).toBe('−12,50 €');
    expect(formatPct(new Decimal('3.14159'))).toBe('+3,14 %');
  });
});
