import Decimal from 'decimal.js';
import { useMemo, useState, type ReactNode } from 'react';
import { formatDateSl, fullYearsBetween, type IsoDate } from '../domain/dates';
import { formatMoney, formatPct, formatQty, formatSignedMoney, type DisplayCurrency } from '../domain/format';
import { buildOverview, toUsd, type Dividend, type PositionView, type UsdRate } from '../domain/overview';
import { isStale } from '../domain/quotes';
import type { TaxSettings } from '../domain/tax';
import type { Instrument, Quote, Trade } from '../domain/types';

export type InstrumentView = Instrument & { priceSource?: 'YAHOO' | 'ROCNO' };
type QuoteView = Quote & { source?: string };

/** Brez davčnih nastavitev: stopnje 0 — davčni zneski se ne prikažejo. */
const NO_TAX: TaxSettings = { capitalGains: [{ fromYears: 0, rate: '0' }], dividendRate: '0', standardCostRate: '0' };

function readCurrency(): DisplayCurrency {
  try {
    return localStorage.getItem('portfelj.valuta') === 'USD' ? 'USD' : 'EUR';
  } catch {
    return 'EUR';
  }
}

export function Delta({ value, pct, stacked, cur = 'EUR' }: { value: Decimal | null; pct?: Decimal | null; stacked?: boolean; cur?: DisplayCurrency }) {
  if (value === null) return <span className="text-ink-3">—</span>;
  const r = value.toDecimalPlaces(2);
  const tone = r.isZero() ? 'text-ink-2' : r.isNegative() ? 'text-loss' : 'text-gain';
  const arrow = r.isZero() ? '' : r.isNegative() ? '▼ ' : '▲ ';
  return (
    <span className={`num whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className="text-[0.7em]">{arrow}</span>
      {formatSignedMoney(value, cur)}
      {pct ? (
        <span className={stacked ? 'block text-xs opacity-80' : 'ml-1.5 opacity-80'}>
          {stacked ? formatPct(pct) : `(${formatPct(pct)})`}
        </span>
      ) : null}
    </span>
  );
}

function Kpi({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <div className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-2 text-lg font-semibold sm:text-xl">{children}</div>
      {hint ? <div className="mt-1 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

function yearsLabel(n: number): string {
  if (n === 1) return 'leto';
  if (n === 2) return 'leti';
  if (n === 3 || n === 4) return 'leta';
  return 'let';
}

function lotsLabel(n: number): string {
  if (n === 1) return '1 lot';
  if (n === 2) return '2 lota';
  if (n === 3 || n === 4) return `${n} loti`;
  return `${n} lotov`;
}

function PositionRow(props: {
  p: PositionView;
  inst: InstrumentView | undefined;
  quote: QuoteView | undefined;
  latest: IsoDate | null;
  total: Decimal;
  today: IsoDate;
  cur: DisplayCurrency;
  fx: { rate: Decimal; investedUsd: Decimal; valueUsd: Decimal | null } | null;
  showTax: boolean;
  onManualPrice?: (isin: string) => void;
  onEditTarget?: (isin: string) => void;
}) {
  const { p, inst, quote, latest, total, today, cur, fx, showTax, onManualPrice, onEditTarget } = props;
  const m = (v: Decimal) => (cur === 'USD' && fx ? v.mul(fx.rate) : v);
  const value = cur === 'USD' && fx ? fx.valueUsd : p.valueEur;
  const invested = cur === 'USD' && fx ? fx.investedUsd : p.costEur;
  const pl = value ? value.minus(invested) : null;
  const plPct = pl && invested.gt(0) ? pl.div(invested).mul(100) : null;
  const weight = p.valueEur && total.gt(0) ? p.valueEur.div(total).mul(100) : null;
  const weightText = weight ? formatPct(weight).replace('+', '') : '—';
  const stale = quote && latest ? isStale(quote.date, latest) : false;
  const manual = inst?.priceSource === 'ROCNO';
  const first = p.lots[0];
  const years = first ? fullYearsBetween(first.buyDate, today) : 0;
  const t = p.target;

  return (
    <li className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[minmax(0,2fr)_1.1fr_1.1fr_1.1fr_0.9fr] sm:items-center sm:px-5 ${t?.reached ? 'bg-gain-bg/40' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{inst?.symbol ?? p.isin}</span>
          <span className="truncate text-sm text-ink-3">{inst?.name}</span>
          {t?.reached ? <span className="shrink-0 rounded-md bg-gain-bg px-1.5 text-xs font-medium text-gain">cilj dosežen</span> : null}
        </div>
        <div className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          <span>
            {formatQty(p.quantity)} kos · {lotsLabel(p.lots.length)}
            {first ? ` · od ${formatDateSl(first.buyDate)} (${years} ${yearsLabel(years)})` : ''}
          </span>
          {stale && quote ? <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-warn">cena z dne {formatDateSl(quote.date)}</span> : null}
          {manual && onManualPrice ? (
            <button type="button" onClick={() => onManualPrice(p.isin)} className="text-accent underline">
              {quote ? `ročna cena ${formatDateSl(quote.date)} · posodobi` : 'Vpiši ceno'}
            </button>
          ) : null}
        </div>
      </div>

      {/* vrednost */}
      <div className="num text-right sm:order-2">
        <div className="font-semibold">{value ? formatMoney(value, cur) : <span className="text-sm font-normal text-ink-3">ni cene</span>}</div>
        <div className="text-xs text-ink-3">delež {weightText}</div>
      </div>

      {/* donos */}
      <div className="text-sm sm:order-3 sm:text-right">
        <span className="text-xs text-ink-3 sm:hidden">Donos </span>
        <Delta value={pl} pct={plPct} stacked cur={cur} />
      </div>

      {/* cilj */}
      <div className="num text-right text-sm sm:order-4">
        {t ? (
          <button type="button" onClick={() => onEditTarget?.(p.isin)} className="text-right hover:underline" title="Uredi ciljno ceno">
            <div>
              {formatMoney(m(t.priceEur), cur)}
              {t.toTargetPct ? <span className="ml-1 text-xs text-ink-3">{formatPct(t.toTargetPct)}</span> : null}
            </div>
            {showTax ? <div className="text-xs text-ink-3">neto {formatSignedMoney(m(t.atTarget.netEur), cur)}</div> : null}
          </button>
        ) : onEditTarget ? (
          <button type="button" onClick={() => onEditTarget(p.isin)} className="text-xs text-accent underline">
            Dodaj cilj
          </button>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </div>

      {/* davek danes */}
      <div className="num col-span-2 text-xs text-ink-3 sm:order-5 sm:col-span-1 sm:text-right sm:text-sm sm:text-ink-2">
        {showTax && p.taxToday ? (
          <>
            <span className="sm:hidden">Davek ob prodaji danes </span>
            {formatMoney(m(p.taxToday.taxEur), cur)}
          </>
        ) : (
          '—'
        )}
      </div>
    </li>
  );
}

export interface OverviewProps {
  trades: Trade[];
  instruments: InstrumentView[];
  quotes: QuoteView[];
  today: IsoDate;
  dividends?: Dividend[];
  targets?: Map<string, Decimal>;
  /** Davčne nastavitve (null = niso nastavljene → davki se ne prikažejo). */
  tax?: { settings: TaxSettings; confirmed: boolean; sourceNote: string | null } | null;
  usdRates?: UsdRate[];
  pricesDate?: IsoDate | null;
  missingFx?: string[];
  pricesToolbar?: ReactNode;
  onAddTrade?: () => void;
  onManualPrice?: (isin: string) => void;
  onEditTarget?: (isin: string) => void;
  onConfirmTax?: () => void;
}

export function Overview(props: OverviewProps) {
  const { trades, instruments, quotes, today, dividends = [], targets, tax = null, usdRates = [], pricesDate, missingFx = [] } = props;
  const { pricesToolbar, onAddTrade, onManualPrice, onEditTarget, onConfirmTax } = props;
  const [cur, setCur] = useState<DisplayCurrency>(readCurrency);
  const settings = tax?.settings ?? NO_TAX;
  const showTax = Boolean(tax);

  const result = useMemo(() => {
    try {
      const o = buildOverview({ trades, quotes, dividends, targets: targets ?? new Map(), settings, today });
      return { o, usd: toUsd(o, trades, dividends, usdRates, settings), error: null };
    } catch (e) {
      return { o: null, usd: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [trades, quotes, dividends, targets, settings, today, usdRates]);

  function pickCurrency(c: DisplayCurrency) {
    setCur(c);
    try {
      localStorage.setItem('portfelj.valuta', c);
    } catch {
      /* zasebno okno — izbira ostane samo za to sejo */
    }
  }

  if (result.error || !result.o) {
    return (
      <div role="alert" className="mt-6 rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
        <strong>Podatki niso skladni:</strong> {result.error}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">Portfelj je še prazen</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">Dodaj prvi nakup ročno ali uvozi podatke iz tabele.</p>
        {onAddTrade ? (
          <button type="button" onClick={onAddTrade} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-bg">
            Dodaj posel
          </button>
        ) : null}
      </div>
    );
  }

  const { o, usd } = result;
  const s = o.summary;
  const c: DisplayCurrency = cur === 'USD' && usd ? 'USD' : 'EUR';
  const R = usd?.rateNow ?? new Decimal(1);
  const m = (v: Decimal) => (c === 'USD' ? v.mul(R) : v);
  const hasQuotes = quotes.length > 0;
  const instByIsin = new Map(instruments.map((i) => [i.isin, i]));
  const quoteByIsin = new Map(quotes.map((q) => [q.isin, q]));
  const latest = pricesDate ?? quotes.reduce<IsoDate | null>((mx, q) => (!mx || q.date > mx ? q.date : mx), null);
  const nameOf = (isin: string) => instByIsin.get(isin)?.symbol ?? isin;

  const value = c === 'USD' ? usd!.valueUsd : s.valueEur;
  const unrealized = c === 'USD' ? usd!.unrealizedUsd : s.unrealizedEur;
  const unrealizedPct = c === 'USD' ? usd!.unrealizedPct : s.unrealizedPct;
  const totalReturn = c === 'USD' ? usd!.totalReturnUsd : s.totalReturnEur;
  const realized = c === 'USD' ? usd!.realizedUsd : s.realizedEur;
  const dividendsNet = c === 'USD' ? usd!.dividendsNetUsd : s.dividendsNetEur;
  const invested = c === 'USD' ? usd!.investedOpen : s.investedOpen;
  const prevValue = s.valueEur.minus(s.dayChangeEur);
  const dayPct = prevValue.gt(0) ? s.dayChangeEur.div(prevValue).mul(100) : null;

  return (
    <>
      {tax && !tax.confirmed ? (
        <div role="note" className="mt-4 flex flex-col gap-3 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn sm:flex-row sm:items-center sm:justify-between">
          <span>
            <strong>Preveri davčne stopnje.</strong> Prevzete so iz tvoje Apps Script aplikacije: 25 % · 20 % po 5 letih · 15 % po 10 letih ·
            0 % po 15 letih, 1 % normirani stroški, dividende 25 %. Pred uporabo za napoved jih preveri pri FURS.
          </span>
          {onConfirmTax ? (
            <button type="button" onClick={onConfirmTax} className="min-h-10 shrink-0 rounded-lg border border-current px-3 font-medium">
              Potrjujem stopnje
            </button>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="vrednost" className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="vrednost" className="text-sm text-ink-3">
            {hasQuotes ? 'Vrednost portfelja' : 'Nabavna vrednost portfelja'}
          </h2>
          {usd ? (
            <div role="group" aria-label="Valuta prikaza" className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
              {(['EUR', 'USD'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={c === k}
                  onClick={() => pickCurrency(k)}
                  className={`min-h-8 min-w-11 rounded-md px-2 ${c === k ? 'bg-ink text-bg' : 'text-ink-3'}`}
                >
                  {k === 'EUR' ? '€' : '$'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">{formatMoney(hasQuotes ? value : invested, c)}</div>
        {hasQuotes ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span>
              <Delta value={unrealized} pct={unrealizedPct} cur={c} /> <span className="text-ink-3">nerealizirano</span>
            </span>
            {showTax ? (
              <span className="text-ink-3">
                po davku <span className="num">{formatSignedMoney(m(s.unrealizedNetEur), c)}</span>
              </span>
            ) : null}
            <span>
              <Delta value={m(s.dayChangeEur)} pct={dayPct} cur={c} /> <span className="text-ink-3">danes</span>
            </span>
          </div>
        ) : null}
        {c === 'USD' && usd ? (
          <p className="mt-1 text-xs text-ink-3">
            1 € = {usd.rateNow.toDecimalPlaces(4).toString().replace('.', ',')} $ (ECB, {formatDateSl(usd.rateDate)}) · nakupi po tečaju na dan nakupa
            {usd.fxEffectPts ? ` · vpliv tečaja ${formatPct(usd.fxEffectPts).replace(' %', ' o. t.')}` : ''}
          </p>
        ) : null}
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Skupni donos" hint="nerealiz. + realiz. + dividende − davek">
          {hasQuotes ? <Delta value={totalReturn} cur={c} /> : <span className="text-ink-3">—</span>}
        </Kpi>
        <Kpi label="Realizirano (FIFO)" hint={showTax ? `davek ocena ${formatMoney(m(s.realizedTaxEur), c)}` : 'iz zaključenih prodaj'}>
          <Delta value={realized} cur={c} />
        </Kpi>
        <Kpi label="Dividende neto" hint={`${s.dividendsCount} izplačil`}>
          <span className="num">{formatMoney(dividendsNet, c)}</span>
        </Kpi>
        <Kpi
          label="Neto ob ciljnih cenah"
          hint={s.targetsCount ? `${s.targetsCount} ciljev · ${s.targetsReached} doseženih` : 'ni ciljev'}
        >
          {s.targetsCount && showTax ? <Delta value={m(s.targetsNetEur)} cur={c} /> : <span className="text-ink-3">—</span>}
        </Kpi>
      </section>
      <p className="num mt-3 text-xs text-ink-3">
        Investirano v odprte pozicije {formatMoney(invested, c)}
        {showTax && hasQuotes ? ` · davek ob prodaji vsega danes ${formatMoney(m(s.taxTodayEur), c)}` : ''}
      </p>

      {hasQuotes && s.missingQuotes.length > 0 ? (
        <div role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
          Brez cene: {s.missingQuotes.map(nameOf).join(', ')} — te pozicije niso vštete v vrednost
          {missingFx.length ? ` (manjka tečaj ECB za ${missingFx.map(nameOf).join(', ')})` : ''}.
        </div>
      ) : null}

      <section aria-labelledby="pozicije" className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="pozicije" className="text-base font-semibold">
            Pozicije <span className="font-normal text-ink-3">({o.positions.length})</span>
          </h2>
          <div className="flex items-center gap-3">
            {latest ? <span className="text-xs text-ink-3">cene z dne {formatDateSl(latest)}</span> : null}
            {pricesToolbar}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,2fr)_1.1fr_1.1fr_1.1fr_0.9fr] gap-x-4 border-b border-line bg-surface-2 px-5 py-2.5 text-xs font-medium text-ink-3 sm:grid">
            <span>Pozicija</span>
            <span className="text-right">Vrednost ({c === 'USD' ? '$' : '€'})</span>
            <span className="text-right">Donos</span>
            <span className="text-right">Cilj · neto po davku</span>
            <span className="text-right">Davek danes</span>
          </div>
          <ul className="divide-y divide-line">
            {o.positions.map((p) => {
              const u = usd?.byIsin.get(p.isin);
              return (
                <PositionRow
                  key={p.isin}
                  p={p}
                  inst={instByIsin.get(p.isin)}
                  quote={quoteByIsin.get(p.isin)}
                  latest={latest}
                  total={s.valueEur}
                  today={today}
                  cur={c}
                  fx={usd && u ? { rate: R, investedUsd: u.investedUsd, valueUsd: u.valueUsd } : null}
                  showTax={showTax}
                  onManualPrice={onManualPrice}
                  onEditTarget={onEditTarget}
                />
              );
            })}
          </ul>
        </div>
        {showTax ? (
          <p className="mt-3 text-xs text-ink-3">
            Davek danes in neto ob cilju: ocena, če bi prodal vse kose; po FIFO lotih, stopnja po letih imetništva vsakega lota, z
            normiranimi stroški. Pobot z izgubami drugih pozicij ni upoštevan.
          </p>
        ) : null}
      </section>
    </>
  );
}
