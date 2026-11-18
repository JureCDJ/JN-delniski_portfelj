import Decimal from 'decimal.js';
import { useMemo, type ReactNode } from 'react';
import { formatDateSl, fullYearsBetween, type IsoDate } from '../domain/dates';
import { formatEur, formatPct, formatQty, formatSignedEur } from '../domain/format';
import { buildPositions, summarize, type Position } from '../domain/portfolio';
import type { Instrument, Quote, Trade } from '../domain/types';

export function Delta({ value, pct, stacked }: { value: Decimal | null; pct?: Decimal | null; stacked?: boolean }) {
  if (value === null) return <span className="text-ink-3">—</span>;
  const r = value.toDecimalPlaces(2);
  const tone = r.isZero() ? 'text-ink-2' : r.isNegative() ? 'text-loss' : 'text-gain';
  const arrow = r.isZero() ? '' : r.isNegative() ? '▼ ' : '▲ ';
  return (
    <span className={`num whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className="text-[0.7em]">{arrow}</span>
      {formatSignedEur(value)}
      {pct ? (
        <span className={stacked ? 'block text-xs opacity-80' : 'ml-1.5 opacity-80'}>
          {stacked ? formatPct(pct) : `(${formatPct(pct)})`}
        </span>
      ) : null}
    </span>
  );
}

function Kpi({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
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

function holdingInfo(p: Position, today: IsoDate): string {
  const first = p.lots[0];
  if (!first) return '';
  const years = fullYearsBetween(first.buyDate, today);
  return `od ${formatDateSl(first.buyDate)} · ${years} ${yearsLabel(years)}`;
}

function PositionRow({ p, inst, total, today }: { p: Position; inst: Instrument | undefined; total: Decimal; today: IsoDate }) {
  const weight = p.valueEur && total.gt(0) ? p.valueEur.div(total).mul(100) : null;
  const weightText = weight ? formatPct(weight).replace('+', '') : '—';
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1.3fr_1.3fr] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{inst?.symbol ?? p.isin}</span>
          <span className="truncate text-sm text-ink-3">{inst?.name}</span>
        </div>
        <div className="mt-0.5 text-xs text-ink-3">{holdingInfo(p, today)}</div>
      </div>
      <div className="num text-right font-semibold sm:order-4">
        {p.valueEur ? formatEur(p.valueEur) : <span className="text-sm font-normal text-ink-3">ni tečaja</span>}
      </div>
      <div className="num text-sm text-ink-2 sm:order-2 sm:text-right">
        {formatQty(p.quantity)} kos
        <span className="sm:hidden"> · {p.valueEur ? weightText : `nabava ${formatEur(p.costEur)}`}</span>
      </div>
      <div className="text-right text-sm sm:order-5">
        <Delta value={p.unrealizedEur} pct={p.unrealizedPct} stacked />
      </div>
      <div className="num hidden text-right text-sm text-ink-2 sm:order-3 sm:block">{weightText}</div>
    </li>
  );
}

export interface OverviewProps {
  trades: Trade[];
  instruments: Instrument[];
  quotes: Quote[];
  today: IsoDate;
  onAddTrade?: () => void;
}

export function Overview({ trades, instruments, quotes, today, onAddTrade }: OverviewProps) {
  const { positions, summary, error } = useMemo(() => {
    try {
      const all = buildPositions(trades, quotes);
      const open = all
        .filter((p) => p.quantity.gt(0))
        .sort((a, b) => (b.valueEur ?? b.costEur).cmp(a.valueEur ?? a.costEur));
      return { positions: open, summary: summarize(all), error: null };
    } catch (e) {
      return { positions: [], summary: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [trades, quotes]);

  if (error || !summary) {
    return (
      <div role="alert" className="mt-6 rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
        <strong>Podatki niso skladni:</strong> {error}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">Portfelj je še prazen</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">
          Dodaj prvi nakup ročno. Uvoz iz IBKR, N26 in nakupnih listov pride v naslednjih korakih.
        </p>
        {onAddTrade ? (
          <button
            type="button"
            onClick={onAddTrade}
            className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-bg"
          >
            Dodaj posel
          </button>
        ) : null}
      </div>
    );
  }

  const instByIsin = new Map(instruments.map((i) => [i.isin, i]));
  const prevValue = summary.valueEur.minus(summary.dayChangeEur);
  const dayPct = prevValue.gt(0) ? summary.dayChangeEur.div(prevValue).mul(100) : null;
  const hasQuotes = quotes.length > 0;

  return (
    <>
      <section aria-labelledby="vrednost" className="mt-6">
        <h2 id="vrednost" className="text-sm text-ink-3">
          {hasQuotes ? 'Vrednost portfelja' : 'Nabavna vrednost portfelja'}
        </h2>
        <div className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
          {formatEur(hasQuotes ? summary.valueEur : summary.costEur)}
        </div>
        {hasQuotes ? (
          <div className="mt-2 text-sm">
            <Delta value={summary.dayChangeEur} pct={dayPct} /> <span className="text-ink-3">danes</span>
          </div>
        ) : (
          <div className="mt-2 text-sm text-ink-3">Tržna vrednost bo vidna, ko vklopiva samodejne tečaje.</div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Nerealiziran donos" wide hint={hasQuotes ? undefined : 'potrebni so tečaji'}>
          {hasQuotes ? <Delta value={summary.unrealizedEur} pct={summary.unrealizedPct} /> : <span className="text-ink-3">—</span>}
        </Kpi>
        <Kpi label="Realizirano" hint="iz zaključenih prodaj">
          <Delta value={summary.realizedEur} />
        </Kpi>
        <Kpi label="Nabavna vrednost" hint="vključno s provizijami">
          <span className="num">{formatEur(summary.costEur)}</span>
        </Kpi>
      </section>

      {hasQuotes && summary.missingQuotes.length > 0 ? (
        <div role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
          Ni tečaja za: {summary.missingQuotes.join(', ')} — te pozicije niso vštete v vrednost.
        </div>
      ) : null}

      <section aria-labelledby="pozicije" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="pozicije" className="text-base font-semibold">Pozicije</h2>
          {hasQuotes ? <span className="text-xs text-ink-3">tečaji na dan {formatDateSl(quotes[0]!.date)}</span> : null}
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1fr_1.3fr_1.3fr] gap-x-4 border-b border-line bg-surface-2 px-5 py-2.5 text-xs font-medium text-ink-3 sm:grid">
            <span>Instrument</span>
            <span className="text-right">Količina</span>
            <span className="text-right">Delež</span>
            <span className="text-right">Vrednost (EUR)</span>
            <span className="text-right">Donos (EUR)</span>
          </div>
          <ul className="divide-y divide-line">
            {positions.map((p) => (
              <PositionRow key={p.isin} p={p} inst={instByIsin.get(p.isin)} total={summary.valueEur} today={today} />
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
