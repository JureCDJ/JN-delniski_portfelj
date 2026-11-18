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
