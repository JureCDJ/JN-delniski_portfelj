import type { IsoDate } from './dates';

/** Vsi zneski in količine so nizi (decimalni zapis), da ne izgubimo natančnosti. */
export type DecimalString = string;

export type TradeType = 'NAKUP' | 'PRODAJA';

export interface Trade {
  id: string;
  accountId: string;
  isin: string;
  type: TradeType;
  /** Datum posla (ne datum poravnave). */
  date: IsoDate;
  quantity: DecimalString;
  /** Cena na enoto v valuti instrumenta. */
  price: DecimalString;
  /** Provizija v valuti instrumenta. */
  fee: DecimalString;
  currency: string;
  /**
   * Referenčni tečaj na dan posla: koliko enot valute za 1 EUR (konvencija ECB).
   * Za EUR je '1'.
   */
  ratePerEur: DecimalString;
}

export interface Instrument {
  isin: string;
  symbol: string;
  name: string;
  currency: string;
  type: 'DELNICA' | 'ETF';
}

export interface Quote {
  isin: string;
  date: IsoDate;
  price: DecimalString;
  /** Tečaj valute instrumenta na dan cene (enot za 1 EUR). */
  ratePerEur: DecimalString;
  /** Prejšnja zaključna cena, za dnevno spremembo. */
  previousPrice?: DecimalString;
  previousRatePerEur?: DecimalString;
}
