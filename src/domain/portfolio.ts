import Decimal from 'decimal.js';
import { compareIsoDate, fullYearsBetween, type IsoDate } from './dates';
import type { Quote, Trade } from './types';

// Poslovna logika portfelja: FIFO lote, realizirani dobički in vrednotenje pozicij.
// Vse v EUR po referenčnem tečaju na dan posla. Čiste funkcije — brez UI in baze.

const ZERO = new Decimal(0);

export class PortfolioError extends Error {}

export interface Lot {
  isin: string;
  tradeId: string;
  buyDate: IsoDate;
  quantity: Decimal;
  /** Nabavna vrednost v EUR, vključno s sorazmernim delom provizije. */
  costEur: Decimal;
}

export interface Disposal {
  isin: string;
  buyTradeId: string;
  sellTradeId: string;
  buyDate: IsoDate;
  sellDate: IsoDate;
  quantity: Decimal;
  costEur: Decimal;
  /** Odsvojitvena vrednost v EUR, zmanjšana za sorazmerni del provizije ob prodaji. */
  proceedsEur: Decimal;
  gainEur: Decimal;
  holdingYears: number;
}

export interface LedgerResult {
  openLots: Lot[];
  disposals: Disposal[];
}

function toEur(amount: Decimal, ratePerEur: Decimal.Value): Decimal {
  const rate = new Decimal(ratePerEur);
  if (rate.lte(0)) throw new PortfolioError('Tečaj mora biti večji od 0');
  return amount.div(rate);
}

function sortTrades(trades: Trade[]): Trade[] {
  // Isti dan: nakupi pred prodajami, sicer ohrani vhodni vrstni red.
  return trades
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const byDate = compareIsoDate(a.t.date, b.t.date);
      if (byDate !== 0) return byDate;
      if (a.t.type !== b.t.type) return a.t.type === 'NAKUP' ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ t }) => t);
}

/** Izračuna odprte lote in odsvojitve po metodi FIFO, ločeno po ISIN. */
export function buildLedger(trades: Trade[]): LedgerResult {
  const lotsByIsin = new Map<string, Lot[]>();
  const disposals: Disposal[] = [];

  for (const t of sortTrades(trades)) {
    const qty = new Decimal(t.quantity);
    const price = new Decimal(t.price);
    const fee = new Decimal(t.fee);
    if (qty.lte(0)) throw new PortfolioError(`Posel ${t.id}: količina mora biti večja od 0`);
    if (price.lt(0) || fee.lt(0)) throw new PortfolioError(`Posel ${t.id}: cena in provizija ne smeta biti negativni`);

    const lots = lotsByIsin.get(t.isin) ?? [];
    lotsByIsin.set(t.isin, lots);

    if (t.type === 'NAKUP') {
      lots.push({
        isin: t.isin,
        tradeId: t.id,
        buyDate: t.date,
        quantity: qty,
        costEur: toEur(qty.mul(price).plus(fee), t.ratePerEur),
      });
      continue;
    }

    const held = lots.reduce((s, l) => s.plus(l.quantity), ZERO);
    if (qty.gt(held)) {
      throw new PortfolioError(
        `Posel ${t.id}: prodaja ${qty.toString()} ${t.isin}, v lasti pa le ${held.toString()}. Manjka nakup?`,
      );
    }

    const netProceedsEur = toEur(qty.mul(price).minus(fee), t.ratePerEur);
    let remaining = qty;
    let allocatedProceeds = ZERO;
    while (remaining.gt(0)) {
      const lot = lots[0]!;
      const take = Decimal.min(lot.quantity, remaining);
      const isLastChunk = take.eq(remaining);
      // Celotna lota → vsa njena nabavna vrednost (brez ostanka zaokroževanja).
      const costPart = take.eq(lot.quantity) ? lot.costEur : lot.costEur.mul(take.div(lot.quantity));
      // Zadnji kos dobi ostanek, da se vsota kupnin natančno ujema s prodajo.
      const proceedsPart = isLastChunk
        ? netProceedsEur.minus(allocatedProceeds)
        : netProceedsEur.mul(take.div(qty));
      allocatedProceeds = allocatedProceeds.plus(proceedsPart);

      disposals.push({
        isin: t.isin,
        buyTradeId: lot.tradeId,
        sellTradeId: t.id,
        buyDate: lot.buyDate,
        sellDate: t.date,
        quantity: take,
        costEur: costPart,
        proceedsEur: proceedsPart,
        gainEur: proceedsPart.minus(costPart),
        holdingYears: fullYearsBetween(lot.buyDate, t.date),
      });

      lot.quantity = lot.quantity.minus(take);
      lot.costEur = lot.costEur.minus(costPart);
      if (lot.quantity.isZero()) lots.shift();
      remaining = remaining.minus(take);
    }
  }

  return { openLots: [...lotsByIsin.values()].flat(), disposals };
}

export interface Position {
  isin: string;
  quantity: Decimal;
  costEur: Decimal;
  /** Povprečna nabavna cena na enoto v EUR. */
  avgCostEur: Decimal;
  valueEur: Decimal | null;
  unrealizedEur: Decimal | null;
  unrealizedPct: Decimal | null;
  dayChangeEur: Decimal | null;
  realizedEur: Decimal;
  lots: Lot[];
}

export function buildPositions(trades: Trade[], quotes: Quote[]): Position[] {
  const { openLots, disposals } = buildLedger(trades);
  const quoteByIsin = new Map(quotes.map((q) => [q.isin, q]));
  const isins = [...new Set([...openLots.map((l) => l.isin), ...disposals.map((d) => d.isin)])];

  return isins.map((isin) => {
    const lots = openLots.filter((l) => l.isin === isin);
    const quantity = lots.reduce((s, l) => s.plus(l.quantity), ZERO);
    const costEur = lots.reduce((s, l) => s.plus(l.costEur), ZERO);
    const realizedEur = disposals.filter((d) => d.isin === isin).reduce((s, d) => s.plus(d.gainEur), ZERO);
    const q = quoteByIsin.get(isin);

    let valueEur: Decimal | null = null;
    let dayChangeEur: Decimal | null = null;
    if (q && quantity.gt(0)) {
      valueEur = toEur(quantity.mul(q.price), q.ratePerEur);
      if (q.previousPrice && q.previousRatePerEur) {
        dayChangeEur = valueEur.minus(toEur(quantity.mul(q.previousPrice), q.previousRatePerEur));
      }
    }
    const unrealizedEur = valueEur ? valueEur.minus(costEur) : null;

    return {
      isin,
      quantity,
      costEur,
      avgCostEur: quantity.gt(0) ? costEur.div(quantity) : ZERO,
      valueEur,
      unrealizedEur,
      unrealizedPct: unrealizedEur && costEur.gt(0) ? unrealizedEur.div(costEur).mul(100) : null,
      dayChangeEur,
      realizedEur,
      lots,
    };
  });
}

export interface PortfolioSummary {
  valueEur: Decimal;
  costEur: Decimal;
  unrealizedEur: Decimal;
  unrealizedPct: Decimal | null;
  dayChangeEur: Decimal;
  realizedEur: Decimal;
  /** Pozicije brez tečaja — ne štejejo v vrednost, UI jih mora prikazati. */
  missingQuotes: string[];
}

export function summarize(positions: Position[]): PortfolioSummary {
  const open = positions.filter((p) => p.quantity.gt(0));
  const priced = open.filter((p) => p.valueEur !== null);
  const valueEur = priced.reduce((s, p) => s.plus(p.valueEur!), ZERO);
  const pricedCost = priced.reduce((s, p) => s.plus(p.costEur), ZERO);
  const unrealizedEur = valueEur.minus(pricedCost);
  return {
    valueEur,
    costEur: open.reduce((s, p) => s.plus(p.costEur), ZERO),
    unrealizedEur,
    unrealizedPct: pricedCost.gt(0) ? unrealizedEur.div(pricedCost).mul(100) : null,
    dayChangeEur: priced.reduce((s, p) => s.plus(p.dayChangeEur ?? ZERO), ZERO),
    realizedEur: positions.reduce((s, p) => s.plus(p.realizedEur), ZERO),
    missingQuotes: open.filter((p) => p.valueEur === null).map((p) => p.isin),
  };
}
