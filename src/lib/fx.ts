import type { IsoDate } from '../domain/dates';

// Referenčni tečaji ECB prek Frankfurter (brezplačno, brez ključa).
// Za neobratovalni dan ECB vrne zadnji objavljeni tečaj — zato vračamo tudi dejanski datum.
// Pred davčno napovedjo preveri, kateri tečaj zahteva FURS (glej docs/SPEC.md §5).

export interface EcbRate {
  ratePerEur: string;
  rateDate: IsoDate;
}

export async function fetchEcbRate(date: IsoDate, currency: string): Promise<EcbRate> {
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?from=EUR&to=${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Tečaja ni bilo mogoče pridobiti (${res.status}).`);
  const body = (await res.json()) as { date: string; rates: Record<string, number> };
  const rate = body.rates[currency];
  if (rate === undefined) throw new Error(`ECB nima tečaja za ${currency}.`);
  return { ratePerEur: String(rate), rateDate: body.date };
}
