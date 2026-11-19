import Decimal from 'decimal.js';
import { compareIsoDate, parseIsoDate, type IsoDate } from './dates';
import type { TradeType } from './types';

// Preverjanje ročnega vnosa posla. Vrne bodisi očiščene vrednosti bodisi napake po poljih.

/** ISIN: 2 črki države + 9 znakov + kontrolna števka (Luhn). */
export function isValidIsin(raw: string): boolean {
  const isin = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const digits = [...isin]
    .map((c) => (c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Slovenski vnos števil: '1.234,56' → '1234.56'. Brez vejice je pika decimalna ('1234.56').
 * Vrne null, če niz ni število.
 */
export function parseDecimalInput(raw: string): Decimal | null {
  let s = raw.trim().replace(/[\s  ]/g, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}

export interface TradeInput {
  type: TradeType;
  isin: string;
  symbol: string;
  name: string;
  date: string;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  ratePerEur: string;
}

export interface TradeDraft {
  type: TradeType;
  isin: string;
  symbol: string | null;
  name: string;
  date: IsoDate;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  ratePerEur: string;
}

export type FieldErrors = Partial<Record<keyof TradeInput, string>>;

export function validateTradeInput(
  input: TradeInput,
  today: IsoDate,
): { ok: true; draft: TradeDraft } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const isin = input.isin.trim().toUpperCase();
  if (!isin) errors.isin = 'Vpiši ISIN (npr. US0378331005).';
  else if (!isValidIsin(isin)) errors.isin = 'ISIN ni veljaven — preveri črke in številke.';

  const name = input.name.trim();
  if (!name) errors.name = 'Vpiši ime instrumenta.';

  let date = input.date.trim();
  try {
    parseIsoDate(date);
    if (compareIsoDate(date, today) > 0) errors.date = 'Datum posla ne more biti v prihodnosti.';
  } catch {
    errors.date = 'Izberi datum posla.';
    date = '';
  }

  const qty = parseDecimalInput(input.quantity);
  if (!qty) errors.quantity = 'Vpiši količino (npr. 10 ali 0,5).';
  else if (qty.lte(0)) errors.quantity = 'Količina mora biti večja od 0.';

  const price = parseDecimalInput(input.price);
  if (!price) errors.price = 'Vpiši ceno na enoto.';
  else if (price.lt(0)) errors.price = 'Cena ne sme biti negativna.';

  const fee = input.fee.trim() === '' ? new Decimal(0) : parseDecimalInput(input.fee);
  if (!fee) errors.fee = 'Provizija mora biti število (ali prazno).';
  else if (fee.lt(0)) errors.fee = 'Provizija ne sme biti negativna.';

  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Izberi valuto.';

  const rate = currency === 'EUR' ? new Decimal(1) : parseDecimalInput(input.ratePerEur);
  if (!rate) errors.ratePerEur = 'Vpiši tečaj (enot valute za 1 EUR).';
  else if (rate.lte(0)) errors.ratePerEur = 'Tečaj mora biti večji od 0.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      type: input.type,
      isin,
      symbol: input.symbol.trim().toUpperCase() || null,
      name,
      date,
      quantity: qty!.toString(),
      price: price!.toString(),
      fee: fee!.toString(),
      currency,
      ratePerEur: rate!.toString(),
    },
  };
}

/** Simbol vira cen (Yahoo), npr. NVDA, SIE.DE, 1211.HK, KRK.WA, BRK-B. Vrne očiščen simbol ali null. */
export function normalizePriceSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/.test(s) ? s : null;
}
