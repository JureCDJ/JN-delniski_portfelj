import Decimal from 'decimal.js';
import type { Dividend, UsdRate } from '../domain/overview';
import type { FxRow, PriceRow } from '../domain/quotes';
import type { TaxSettings } from '../domain/tax';
import type { Instrument, Quote, Trade } from '../domain/types';

// DEMO PODATKI — izmišljeni posli in tečaji samo za prikaz vmesnika.
// Ne predstavljajo tvojega portfelja niti dejanskih tržnih cen.

export const demoInstruments: Instrument[] = [
  { isin: 'US0378331005', symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', type: 'DELNICA' },
  { isin: 'US5949181045', symbol: 'MSFT', name: 'Microsoft Corporation', currency: 'USD', type: 'DELNICA' },
  { isin: 'NL0010273215', symbol: 'ASML', name: 'ASML Holding N.V.', currency: 'EUR', type: 'DELNICA' },
  { isin: 'SI0031102120', symbol: 'KRKG', name: 'Krka, d. d., Novo mesto', currency: 'EUR', type: 'DELNICA' },
];

export const demoTrades: Trade[] = [
  { id: 'd1', accountId: 'ibkr', isin: 'US0378331005', type: 'NAKUP', date: '2019-05-14', quantity: '20', price: '47.50', fee: '1', currency: 'USD', ratePerEur: '1.1200' },
  { id: 'd2', accountId: 'ibkr', isin: 'US5949181045', type: 'NAKUP', date: '2021-03-02', quantity: '8', price: '233.40', fee: '1', currency: 'USD', ratePerEur: '1.2050' },
  { id: 'd3', accountId: 'n26', isin: 'NL0010273215', type: 'NAKUP', date: '2023-10-20', quantity: '3', price: '548.00', fee: '0.99', currency: 'EUR', ratePerEur: '1' },
  { id: 'd4', accountId: 'ibkr', isin: 'US0378331005', type: 'PRODAJA', date: '2025-02-11', quantity: '5', price: '232.00', fee: '1', currency: 'USD', ratePerEur: '1.0350' },
  { id: 'd5', accountId: 'rocno', isin: 'SI0031102120', type: 'NAKUP', date: '2024-06-05', quantity: '12', price: '128.00', fee: '6.40', currency: 'EUR', ratePerEur: '1' },
];

export const demoQuotes: Quote[] = [
  { isin: 'US0378331005', date: '2026-11-18', price: '228.10', ratePerEur: '1.0800', previousPrice: '226.40', previousRatePerEur: '1.0790' },
  { isin: 'US5949181045', date: '2026-11-18', price: '412.30', ratePerEur: '1.0800', previousPrice: '415.90', previousRatePerEur: '1.0790' },
  { isin: 'NL0010273215', date: '2026-11-18', price: '702.40', ratePerEur: '1', previousPrice: '695.10', previousRatePerEur: '1' },
  { isin: 'SI0031102120', date: '2026-11-18', price: '171.50', ratePerEur: '1', previousPrice: '171.50', previousRatePerEur: '1' },
];

// Demo cilji, dividende, davčne nastavitve in tečaji USD — samo za prikaz vmesnika.
export const demoTargets = new Map<string, Decimal>([
  ['US0378331005', new Decimal('260')],
  ['NL0010273215', new Decimal('690')],
  ['SI0031102120', new Decimal('190')],
]);

export const demoDividends: Dividend[] = [
  { isin: 'US0378331005', date: '2026-05-15', grossEur: new Decimal('3.60'), foreignTaxEur: new Decimal('0.54') },
  { isin: 'SI0031102120', date: '2026-07-10', grossEur: new Decimal('90.00'), foreignTaxEur: new Decimal('0') },
];

export const demoTax = {
  settings: {
    capitalGains: [
      { fromYears: 0, rate: '0.25' },
      { fromYears: 5, rate: '0.20' },
      { fromYears: 10, rate: '0.15' },
      { fromYears: 15, rate: '0' },
    ],
    dividendRate: '0.25',
    standardCostRate: '0.01',
  } satisfies TaxSettings,
  confirmed: true,
  sourceNote: 'demo',
};

export const demoUsdRates: UsdRate[] = [
  { date: '2019-05-14', rate: new Decimal('1.1200') },
  { date: '2021-03-02', rate: new Decimal('1.2050') },
  { date: '2023-10-20', rate: new Decimal('1.0580') },
  { date: '2024-06-05', rate: new Decimal('1.0870') },
  { date: '2025-02-11', rate: new Decimal('1.0350') },
  { date: '2026-11-18', rate: new Decimal('1.0800') },
];

// Demo zgodovina cen (tedensko, izmišljeno) za graf vrednosti skozi čas.
function demoSeries(isin: string, currency: string, from: string, start: number, end: number): PriceRow[] {
  const out: PriceRow[] = [];
  const t0 = Date.parse(`${from}T12:00:00Z`);
  const t1 = Date.parse('2026-11-13T12:00:00Z');
  const weeks = Math.floor((t1 - t0) / (7 * 86_400_000));
  for (let w = 0; w <= weeks; w++) {
    const date = new Date(t0 + w * 7 * 86_400_000).toISOString().slice(0, 10);
    const wave = Math.sin(w / 5) * 0.06 * start;
    out.push({ isin, date, close: (start + ((end - start) * w) / weeks + wave).toFixed(2), currency, source: 'DEMO' });
  }
  return out;
}

export const demoPriceHistory: PriceRow[] = [
  ...demoSeries('US0378331005', 'USD', '2019-05-17', 48, 226),
  ...demoSeries('US5949181045', 'USD', '2021-03-05', 230, 415),
  ...demoSeries('NL0010273215', 'EUR', '2023-10-20', 550, 695),
  ...demoSeries('SI0031102120', 'EUR', '2024-06-07', 128, 171),
];

export const demoFxRows: FxRow[] = [
  { date: '2019-01-01', currency: 'USD', ratePerEur: '1.12' },
  { date: '2021-01-01', currency: 'USD', ratePerEur: '1.20' },
  { date: '2023-01-01', currency: 'USD', ratePerEur: '1.07' },
  { date: '2025-01-01', currency: 'USD', ratePerEur: '1.04' },
  { date: '2026-01-01', currency: 'USD', ratePerEur: '1.08' },
];

export const demoBrokers = new Map([
  ['ibkr', 'IBKR'],
  ['n26', 'N26'],
  ['rocno', 'ROCNO'],
]);
