import Decimal from 'decimal.js';
import { useMemo } from 'react';
import { demoInstruments, demoQuotes, demoTrades } from './demo/demoData';
import { formatDateSl, fullYearsBetween } from './domain/dates';
import { formatEur, formatPct, formatQty, formatSignedEur } from './domain/format';
import { buildPositions, summarize, type Position } from './domain/portfolio';
import type { Instrument } from './domain/types';

export const APP_VERSION = 'v0.1';
const TODAY = '2026-11-18';

function Delta({ value, pct, stacked }: { value: Decimal | null; pct?: Decimal | null; stacked?: boolean }) {
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

function Kpi({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <div className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="mt-2 text-lg font-semibold sm:text-xl">{children}</div>
      {hint ? <div className="mt-1 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

/** Kdaj najstarejša odprta lota dopolni naslednje polno leto imetja. */
function holdingInfo(p: Position): string {
  const first = p.lots[0];
  if (!first) return '';
  const years = fullYearsBetween(first.buyDate, TODAY);
  return `od ${formatDateSl(first.buyDate)} · ${years} ${years === 1 ? 'leto' : years === 2 ? 'leti' : years < 5 ? 'leta' : 'let'}`;
}

function PositionRow({ p, inst, total }: { p: Position; inst: Instrument | undefined; total: Decimal }) {
  const weight = p.valueEur && total.gt(0) ? p.valueEur.div(total).mul(100) : null;
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3.5 sm:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1.3fr_1.3fr] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{inst?.symbol ?? p.isin}</span>
          <span className="truncate text-sm text-ink-3">{inst?.name}</span>
        </div>
        <div className="mt-0.5 text-xs text-ink-3">{holdingInfo(p)}</div>
      </div>
      <div className="num text-right font-semibold sm:order-4">{p.valueEur ? formatEur(p.valueEur) : '—'}</div>
      <div className="num text-sm text-ink-2 sm:order-2 sm:text-right">
        {formatQty(p.quantity)} kos
        <span className="sm:hidden"> · {weight ? formatPct(weight).replace('+', '') : '—'}</span>
      </div>
      <div className="text-right text-sm sm:order-5">
        <Delta value={p.unrealizedEur} pct={p.unrealizedPct} stacked />
      </div>
      <div className="num hidden text-right text-sm text-ink-2 sm:order-3 sm:block">
        {weight ? formatPct(weight).replace('+', '') : '—'}
      </div>
    </li>
  );
}

export default function App() {
  const { positions, summary } = useMemo(() => {
    const positions = buildPositions(demoTrades, demoQuotes)
      .filter((p) => p.quantity.gt(0))
      .sort((a, b) => (b.valueEur ?? new Decimal(0)).cmp(a.valueEur ?? new Decimal(0)));
    return { positions, summary: summarize(buildPositions(demoTrades, demoQuotes)) };
  }, []);
  const instByIsin = new Map(demoInstruments.map((i) => [i.isin, i]));
  const prevValue = summary.valueEur.minus(summary.dayChangeEur);
  const dayPct = prevValue.gt(0) ? summary.dayChangeEur.div(prevValue).mul(100) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12 sm:px-6">
      <header className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-8 w-8" />
          <h1 className="text-lg font-semibold">Portfelj</h1>
        </div>
        <span className="num text-xs text-ink-3">{APP_VERSION}</span>
      </header>

      <div role="note" className="mt-2 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
        <strong>Demo podatki.</strong> Izmišljeni posli in tečaji za prikaz vmesnika — povezava z
        bazo in uvozi sledijo.
      </div>

      <section aria-labelledby="vrednost" className="mt-6">
        <h2 id="vrednost" className="text-sm text-ink-3">Vrednost portfelja</h2>
        <div className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">{formatEur(summary.valueEur)}</div>
        <div className="mt-2 text-sm">
          <Delta value={summary.dayChangeEur} pct={dayPct} /> <span className="text-ink-3">danes</span>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Nerealiziran donos" wide>
          <Delta value={summary.unrealizedEur} pct={summary.unrealizedPct} />
        </Kpi>
        <Kpi label="Realizirano" hint="iz zaključenih prodaj">
          <Delta value={summary.realizedEur} />
        </Kpi>
        <Kpi label="Nabavna vrednost" hint="vključno s provizijami">
          <span className="num">{formatEur(summary.costEur)}</span>
        </Kpi>
      </section>

      {summary.missingQuotes.length > 0 ? (
        <div role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
          Ni tečaja za: {summary.missingQuotes.join(', ')} — te pozicije niso vštete v vrednost.
        </div>
      ) : null}

      <section aria-labelledby="pozicije" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="pozicije" className="text-base font-semibold">Pozicije</h2>
          <span className="text-xs text-ink-3">tečaji na dan {formatDateSl(TODAY)}</span>
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
              <PositionRow key={p.isin} p={p} inst={instByIsin.get(p.isin)} total={summary.valueEur} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
