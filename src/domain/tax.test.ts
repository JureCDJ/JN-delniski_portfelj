import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Lot } from './portfolio';
import {
  estimateSaleOfLots,
  nextLowerRate,
  rateForYears,
  taxOnPart,
  TaxSettingsError,
  validateTaxSettings,
  type TaxSettings,
} from './tax';

// Vrednosti kot v Code.gs (DAVCNE_STOPNJE, DIV_STOPNJA, NORMIRANI_STROSKI) — v aplikaciji pridejo iz tax_settings.
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

const d = (x: Decimal) => x.toDecimalPlaces(2).toFixed(2);

describe('stopnje', () => {
  it('po dopolnjenih letih', () => {
    expect(rateForYears(S, 0).toString()).toBe('0.25');
    expect(rateForYears(S, 4).toString()).toBe('0.25');
    expect(rateForYears(S, 5).toString()).toBe('0.2');
    expect(rateForYears(S, 14).toString()).toBe('0.15');
    expect(rateForYears(S, 15).toString()).toBe('0');
  });
  it('zavrne nesmiselne nastavitve', () => {
    expect(() => validateTaxSettings({ ...S, capitalGains: [{ fromYears: 1, rate: '0.25' }] })).toThrow(TaxSettingsError);
    expect(() => validateTaxSettings({ ...S, dividendRate: '1.5' })).toThrow(TaxSettingsError);
  });
});

describe('davek na prodajo (ujemanje z listom PRODAJE)', () => {
  it('RENK: osnova z 1 % normiranimi stroški 55,08 €, davek 13,77 €', () => {
    // Natančne vrednosti iz xlsx: 13,988 × 43,00 = 601,484 ; 13,988 × 38,25 = 535,041
    const t = taxOnPart({ costEur: new Decimal('535.041'), proceedsEur: new Decimal('601.484'), buyDate: '2025-03-06', sellDate: '2026-06-28' }, S);
    expect(d(t.gainEur)).toBe('66.44');
    expect(d(t.baseEur)).toBe('55.08');
    expect(t.years).toBe(1);
    expect(d(t.taxEur)).toBe('13.77');
  });
  it('izguba → davek 0 (osnova ostane negativna za pobot)', () => {
    const t = taxOnPart({ costEur: new Decimal('893.32'), proceedsEur: new Decimal('893.32'), buyDate: '2026-10-19', sellDate: '2026-10-20' }, S);
    expect(d(t.baseEur)).toBe('-17.87');
    expect(t.taxEur.isZero()).toBe(true);
  });
  it('po 5 letih 20 %', () => {
    const t = taxOnPart({ costEur: new Decimal(1000), proceedsEur: new Decimal(2000), buyDate: '2020-01-10', sellDate: '2025-01-10' }, S);
    expect(t.rate.toString()).toBe('0.2');
    expect(d(t.taxEur)).toBe('194.00'); // (1980 − 1010) × 0,20 = 970 × 0,20
  });
});

describe('ocena prodaje vseh lotov (davek danes, neto ob cilju)', () => {
  const lots: Lot[] = [
    { isin: 'X', tradeId: 'a', buyDate: '2019-01-10', quantity: new Decimal(10), costEur: new Decimal(1000) },
    { isin: 'X', tradeId: 'b', buyDate: '2026-01-10', quantity: new Decimal(10), costEur: new Decimal(2500) },
  ];
  it('vsak lot po svoji stopnji; izguba lota ne zmanjša davka drugega', () => {
    const e = estimateSaleOfLots(lots, '200', '2026-11-19', S);
    // lot a: 2000 vs 1000, 7 let → 20 % od (1980 − 1010) = 194 ; lot b: 2000 vs 2500 → izguba, davek 0
    expect(d(e.gainEur)).toBe('500.00');
    expect(d(e.taxEur)).toBe('194.00');
    expect(d(e.netEur)).toBe('306.00');
  });
});

describe('naslednja nižja stopnja', () => {
  it('datum obletnice in nova stopnja', () => {
    const n = nextLowerRate('2026-01-31', '2026-11-19', S)!;
    expect(n.date).toBe('2031-01-31');
    expect(n.rate.toString()).toBe('0.2');
  });
  it('29. februar → 1. marec v neprestopnem letu', () => {
    expect(nextLowerRate('2024-02-29', '2026-11-19', S)!.date).toBe('2029-03-01');
  });
  it('po 15 letih ni nižje stopnje', () => {
    expect(nextLowerRate('2005-01-01', '2026-11-19', S)).toBeNull();
  });
});
