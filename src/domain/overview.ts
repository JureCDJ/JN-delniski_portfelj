import Decimal from 'decimal.js';
import { compareIsoDate, type IsoDate } from './dates';
import { buildLedger, buildPositions, type Lot, type Position } from './portfolio';
import { estimateSaleOfLots, nextLowerRate, taxOnDisposals, type SaleEstimate, type TaxSettings } from './tax';
import type { Quote, Trade } from './types';

// Kazalniki pregleda (v2), kot v Apps Script »Pregled portfelja«:
// davek ob prodaji danes, ciljna cena in neto ob cilju po davku, realiziran davek,
// dividende in skupni donos = nerealizirano + realizirano + dividende neto − davek na prodaje.
// Pogled v USD: nakupi po tečaju ECB na dan nakupa (zamrznjeno), vrednosti po zadnjem tečaju.

const ZERO = new Decimal(0);

export interface Dividend {
  isin: string;
  date: IsoDate;
  grossEur: Decimal;
  foreignTaxEur: Decimal;
}

export interface UsdRate {
  date: IsoDate;
  /** Enot USD za 1 EUR. */
  rate: Decimal;
}

export interface PositionView extends Position {
  priceEur: Decimal | null;
  taxToday: SaleEstimate | null;
  target: null | {
    priceEur: Decimal;
    toTargetPct: Decimal | null;
    reached: boolean;
    atTarget: SaleEstimate;
  };
  lotsView: (Lot & { nextLower: { date: IsoDate; rate: Decimal } | null })[];
}

export interface OverviewSummary {
  investedOpen: Decimal;
  valueEur: Decimal;
  unrealizedEur: Decimal;
  unrealizedPct: Decimal | null;
  taxTodayEur: Decimal;
  unrealizedNetEur: Decimal;
  realizedEur: Decimal;
  realizedTaxEur: Decimal;
  dividendsNetEur: Decimal;
  dividendsCount: number;
  totalReturnEur: Decimal;
  targetsCount: number;
  targetsNetEur: Decimal;
  targetsReached: number;
  dayChangeEur: Decimal;
  missingQuotes: string[];
}

export interface OverviewData {
  positions: PositionView[];
  summary: OverviewSummary;
}

export function buildOverview(input: {
  trades: Trade[];
  quotes: Quote[];
  dividends: Dividend[];
  targets: Map<string, Decimal>;
  settings: TaxSettings;
  today: IsoDate;
}): OverviewData {
  const { trades, quotes, dividends, targets, settings, today } = input;
  const all = buildPositions(trades, quotes);
  const { disposals } = buildLedger(trades);
  const quoteByIsin = new Map(quotes.map((q) => [q.isin, q]));

  const positions: PositionView[] = all
    .filter((p) => p.quantity.gt(0))
    .map((p) => {
      const q = quoteByIsin.get(p.isin);
      const priceEur = q ? new Decimal(q.price).div(q.ratePerEur) : null;
      const t = targets.get(p.isin);
      return {
        ...p,
        priceEur,
        taxToday: priceEur ? estimateSaleOfLots(p.lots, priceEur, today, settings) : null,
        target: t
          ? {
              priceEur: t,
              toTargetPct: priceEur && priceEur.gt(0) ? t.div(priceEur).minus(1).mul(100) : null,
              reached: Boolean(priceEur && priceEur.gte(t)),
              atTarget: estimateSaleOfLots(p.lots, t, today, settings),
            }
          : null,
        lotsView: p.lots.map((l) => ({ ...l, nextLower: nextLowerRate(l.buyDate, today, settings) })),
      };
    })
    .sort((a, b) => (b.valueEur ?? b.costEur).cmp(a.valueEur ?? a.costEur));

  const priced = positions.filter((p) => p.valueEur);
  const valueEur = priced.reduce((s, p) => s.plus(p.valueEur!), ZERO);
  const pricedCost = priced.reduce((s, p) => s.plus(p.costEur), ZERO);
  const unrealizedEur = valueEur.minus(pricedCost);
  const taxTodayEur = priced.reduce((s, p) => s.plus(p.taxToday!.taxEur), ZERO);
  const realizedEur = disposals.reduce((s, d) => s.plus(d.gainEur), ZERO);
  const realizedTaxEur = taxOnDisposals(disposals, settings);
  const dividendsNetEur = dividends.reduce((s, d) => s.plus(d.grossEur).minus(d.foreignTaxEur), ZERO);
  const withTarget = positions.filter((p) => p.target);

  return {
    positions,
    summary: {
      investedOpen: positions.reduce((s, p) => s.plus(p.costEur), ZERO),
      valueEur,
      unrealizedEur,
      unrealizedPct: pricedCost.gt(0) ? unrealizedEur.div(pricedCost).mul(100) : null,
      taxTodayEur,
      unrealizedNetEur: unrealizedEur.minus(taxTodayEur),
      realizedEur,
      realizedTaxEur,
      dividendsNetEur,
      dividendsCount: dividends.length,
      totalReturnEur: unrealizedEur.plus(realizedEur).plus(dividendsNetEur).minus(realizedTaxEur),
      targetsCount: withTarget.length,
      targetsNetEur: withTarget.reduce((s, p) => s.plus(p.target!.atTarget.netEur), ZERO),
      targetsReached: withTarget.filter((p) => p.target!.reached).length,
      dayChangeEur: priced.reduce((s, p) => s.plus(p.dayChangeEur ?? ZERO), ZERO),
      missingQuotes: positions.filter((p) => !p.valueEur).map((p) => p.isin),
    },
  };
}

/** USD za 1 EUR na dan ali zadnji objavljeni pred njim. */
export function usdRateOn(rates: UsdRate[], date: IsoDate): Decimal | null {
  let best: UsdRate | null = null;
  for (const r of rates) {
    if (compareIsoDate(r.date, date) <= 0 && (!best || compareIsoDate(r.date, best.date) > 0)) best = r;
  }
  return best?.rate ?? null;
}

export interface UsdSummary {
  rateNow: Decimal;
  rateDate: IsoDate;
  investedOpen: Decimal;
  valueUsd: Decimal;
  unrealizedUsd: Decimal;
  unrealizedPct: Decimal | null;
  /** Razlika med donosom v % v USD in v EUR (odstotne točke) — vpliv tečaja. */
  fxEffectPts: Decimal | null;
  realizedUsd: Decimal;
  dividendsNetUsd: Decimal;
  totalReturnUsd: Decimal;
  /** Po pozicijah: investirano (zamrznjeno) in vrednost v USD. */
  byIsin: Map<string, { investedUsd: Decimal; valueUsd: Decimal | null }>;
}

/**
 * Pogled v USD (kot v Code.gs): nabavna vrednost vsakega lota po tečaju na dan nakupa,
 * vrednosti in davki po zadnjem tečaju, realizirano po tečajih na dan nakupa in prodaje.
 * Vrne null, če ni tečajev.
 */
export function toUsd(o: OverviewData, trades: Trade[], dividends: Dividend[], rates: UsdRate[], settings: TaxSettings): UsdSummary | null {
  if (!rates.length) return null;
  const latest = rates.reduce((m, r) => (compareIsoDate(r.date, m.date) > 0 ? r : m));
  const R = latest.rate;
  const at = (d: IsoDate) => usdRateOn(rates, d) ?? R;

  const byIsin = new Map<string, { investedUsd: Decimal; valueUsd: Decimal | null }>();
  let investedOpen = ZERO;
  let pricedInvested = ZERO;
  let valueUsd = ZERO;
  for (const p of o.positions) {
    const inv = p.lots.reduce((s, l) => s.plus(l.costEur.mul(at(l.buyDate))), ZERO);
    const val = p.valueEur ? p.valueEur.mul(R) : null;
    byIsin.set(p.isin, { investedUsd: inv, valueUsd: val });
    investedOpen = investedOpen.plus(inv);
    if (val) {
      valueUsd = valueUsd.plus(val);
      pricedInvested = pricedInvested.plus(inv);
    }
  }
  const unrealizedUsd = valueUsd.minus(pricedInvested);
  const unrealizedPct = pricedInvested.gt(0) ? unrealizedUsd.div(pricedInvested).mul(100) : null;
  const { disposals } = buildLedger(trades);
  const realizedUsd = disposals.reduce((s, d) => s.plus(d.proceedsEur.mul(at(d.sellDate))).minus(d.costEur.mul(at(d.buyDate))), ZERO);
  const dividendsNetUsd = dividends.reduce((s, d) => s.plus(d.grossEur.minus(d.foreignTaxEur).mul(at(d.date))), ZERO);
  const realizedTaxUsd = taxOnDisposals(disposals, settings).mul(R);
  return {
    rateNow: R,
    rateDate: latest.date,
    investedOpen,
    valueUsd,
    unrealizedUsd,
    unrealizedPct,
    fxEffectPts: unrealizedPct && o.summary.unrealizedPct ? unrealizedPct.minus(o.summary.unrealizedPct) : null,
    realizedUsd,
    dividendsNetUsd,
    totalReturnUsd: unrealizedUsd.plus(realizedUsd).plus(dividendsNetUsd).minus(realizedTaxUsd),
    byIsin,
  };
}
