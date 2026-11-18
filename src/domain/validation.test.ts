import { describe, expect, it } from 'vitest';
import { isValidIsin, parseDecimalInput, validateTradeInput, type TradeInput } from './validation';

const base: TradeInput = {
  type: 'NAKUP',
  isin: 'US0378331005',
  symbol: 'aapl',
  name: 'Apple Inc.',
  date: '2025-02-11',
  quantity: '10',
  price: '232,50',
  fee: '',
  currency: 'USD',
  ratePerEur: '1,0324',
};

describe('ISIN', () => {
  it('sprejme veljavne', () => {
    for (const i of ['US0378331005', 'US5949181045', 'NL0010273215', 'IE00B4L5Y983', 'us0378331005']) {
      expect(isValidIsin(i), i).toBe(true);
    }
  });
  it('zavrne napačno kontrolno števko ali obliko', () => {
    expect(isValidIsin('US0378331006')).toBe(false);
    expect(isValidIsin('US037833100')).toBe(false);
    expect(isValidIsin('0S0378331005')).toBe(false);
  });
});

describe('vnos števil', () => {
  it('slovenski in mednarodni zapis', () => {
    expect(parseDecimalInput('1.234,56')!.toString()).toBe('1234.56');
    expect(parseDecimalInput('1234,5')!.toString()).toBe('1234.5');
    expect(parseDecimalInput('1234.5')!.toString()).toBe('1234.5');
    expect(parseDecimalInput(' 1 234,56 ')!.toString()).toBe('1234.56');
  });
  it('zavrne nesmisel', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('1,2,3')).toBeNull();
  });
});

describe('validacija posla', () => {
  it('veljaven vnos → očiščene vrednosti', () => {
    const r = validateTradeInput(base, '2026-11-18');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft).toMatchObject({ symbol: 'AAPL', price: '232.5', fee: '0', ratePerEur: '1.0324' });
    }
  });
  it('EUR ima vedno tečaj 1, ne glede na vnos', () => {
    const r = validateTradeInput({ ...base, currency: 'EUR', ratePerEur: '' }, '2026-11-18');
    expect(r.ok && r.draft.ratePerEur).toBe('1');
  });
  it('napake po poljih', () => {
    const r = validateTradeInput(
      { ...base, isin: 'XX123', date: '2027-01-01', quantity: '0', price: '-1', ratePerEur: '' },
      '2026-11-18',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['date', 'isin', 'price', 'quantity', 'ratePerEur']);
  });
});
