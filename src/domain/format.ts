import Decimal from 'decimal.js';

// Prikaz v slovenskem zapisu: 1.234,56 € · 12,3 %. Zaokroževanje samo tukaj.

// useGrouping 'always': pravila CLDR za sl sicer ne ločijo tisočic pri 4-mestnih številih (1234,56).
const eur = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const num = (digits: number) =>
  new Intl.NumberFormat('sl-SI', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: 'always',
  });

const usd = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'USD', useGrouping: 'always' });

export type DisplayCurrency = 'EUR' | 'USD';

export function formatEur(v: Decimal): string {
  return eur.format(v.toDecimalPlaces(2).toNumber());
}

export function formatMoney(v: Decimal, cur: DisplayCurrency = 'EUR'): string {
  return (cur === 'USD' ? usd : eur).format(v.toDecimalPlaces(2).toNumber());
}

export function formatSignedMoney(v: Decimal, cur: DisplayCurrency = 'EUR'): string {
  const s = formatMoney(v.abs(), cur);
  if (v.toDecimalPlaces(2).isZero()) return s;
  return v.isNegative() ? `−${s}` : `+${s}`;
}

export function formatSignedEur(v: Decimal): string {
  return formatSignedMoney(v, 'EUR');
}

export function formatPct(v: Decimal): string {
  const r = v.toDecimalPlaces(2);
  const s = `${num(2).format(r.abs().toNumber())} %`;
  if (r.isZero()) return s;
  return r.isNegative() ? `−${s}` : `+${s}`;
}

export function formatQty(v: Decimal): string {
  const digits = v.decimalPlaces() > 0 ? Math.min(v.decimalPlaces(), 6) : 0;
  return num(digits).format(v.toNumber());
}
