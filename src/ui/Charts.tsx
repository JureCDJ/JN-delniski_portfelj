import Decimal from 'decimal.js';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { compareIsoDate, formatDateSl, type IsoDate } from '../domain/dates';
import { formatEur, formatPct, formatSignedEur } from '../domain/format';
import { buildValueSeries, type ValuePoint } from '../domain/history';
import { buildPositions } from '../domain/portfolio';
import type { FxRow, PriceRow } from '../domain/quotes';
import type { Instrument, Quote, Trade } from '../domain/types';

// Grafi (rezina 5): razporeditev, donos po pozicijah, vrednost skozi čas.
// Pravila (dataviz): kategorične barve v fiksnem vrstnem redu (7 + »Ostalo«), divergentni modro/rdeče
// za dobiček/izgubo, ena os, tanke oznake, 2 px reže, legenda z besedilom (barva nikoli sama), lebdeči namig.

const SERIES = ['var(--color-s1)', 'var(--color-s2)', 'var(--color-s3)', 'var(--color-s4)', 'var(--color-s5)', 'var(--color-s6)', 'var(--color-s7)'];
const OTHER = 'var(--color-s-other)';
const ZERO = new Decimal(0);

export const compact = new Intl.NumberFormat('sl-SI', { notation: 'compact', maximumFractionDigits: 1 });
const pct1 = (v: Decimal) => `${v.toDecimalPlaces(1).toString().replace('.', ',')} %`;

function Card({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`min-h-8 rounded-md px-2.5 ${value === k ? 'bg-ink text-bg' : 'text-ink-3'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── razporeditev (krog) ─────────────────────────────

interface Slice {
  key: string;
  label: string;
  name: string;
  value: Decimal;
  other: Decimal; // vrednost v drugem načinu (za spremembo deleža)
  color: string;
}

function arcPath(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
  const p = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)] as const;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r, a0);
  const [x1, y1] = p(r, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

function Allocation({ slices, total, otherTotal, mode }: { slices: Slice[]; total: Decimal; otherTotal: Decimal; mode: 'value' | 'cost' }) {
  const [hl, setHl] = useState<number | null>(null);
  const size = 200;
  const c = size / 2;
  let a = 0;
  const arcs = slices.map((s, i) => {
    const sweep = total.gt(0) ? s.value.div(total).toNumber() * Math.PI * 2 : 0;
    const d = arcPath(c, c, hl === i ? 96 : 92, 58, a, a + Math.max(sweep - 0.012, 0.001));
    a += sweep;
    return { d, i };
  });
  const h = hl !== null ? slices[hl] : null;

  return (
    <div className="grid items-center gap-5 sm:grid-cols-[200px_1fr]">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[200px] w-[200px]" role="img" aria-label={`Razporeditev: ${slices.map((s) => `${s.label} ${pct1(s.value.div(total).mul(100))}`).join(', ')}`}>
        {arcs.map(({ d, i }) => (
          <path
            key={slices[i]!.key}
            d={d}
            fill={slices[i]!.color}
            opacity={hl === null || hl === i ? 1 : 0.35}
            onMouseEnter={() => setHl(i)}
            onMouseLeave={() => setHl(null)}
          />
        ))}
        <text x={c} y={c - 2} textAnchor="middle" className="num fill-ink text-[15px] font-semibold">
          {h ? pct1(h.value.div(total).mul(100)) : `${compact.format(total.toNumber())} €`}
        </text>
        <text x={c} y={c + 16} textAnchor="middle" className="fill-ink-3 text-[11px]">
          {h ? h.label : mode === 'value' ? 'trenutno' : 'investirano'}
        </text>
      </svg>

      <ul className="min-w-0 space-y-0.5 text-sm">
        {slices.map((s, i) => {
          const share = total.gt(0) ? s.value.div(total).mul(100) : ZERO;
          const otherShare = otherTotal.gt(0) ? s.other.div(otherTotal).mul(100) : ZERO;
          const delta = mode === 'value' ? share.minus(otherShare) : null;
          return (
            <li
              key={s.key}
              onMouseEnter={() => setHl(i)}
              onMouseLeave={() => setHl(null)}
              className={`grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 rounded-md px-1.5 py-1 ${hl === i ? 'bg-surface-2' : ''}`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">
                <span className="font-medium">{s.label}</span> <span className="text-ink-3">{s.name}</span>
              </span>
              <span className="num text-right text-ink-2">{formatEur(s.value)}</span>
              <span className="num w-[86px] text-right">
                <span className="font-medium">{pct1(share)}</span>
                {delta && delta.abs().gte(0.05) ? (
                  <span className={`block text-[11px] ${delta.gt(0) ? 'text-gain' : 'text-loss'}`}>
                    {delta.gt(0) ? '+' : '−'}
                    {delta.abs().toDecimalPlaces(1).toString().replace('.', ',')} o. t.
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────────────────────────── donos po pozicijah ─────────────────────────────

interface Bar {
  key: string;
  label: string;
  name: string;
  value: Decimal;
  pct: Decimal | null;
}

function PnlBars({ bars }: { bars: Bar[] }) {
  const [hl, setHl] = useState<number | null>(null);
  const max = bars.reduce((m, b) => Decimal.max(m, b.value.abs()), new Decimal(1));
  const hasNeg = bars.some((b) => b.value.lt(0));
  const hasPos = bars.some((b) => b.value.gt(0));
  // Os nič: na sredini, če so obe smeri; sicer ob robu.
  const zero = hasNeg && hasPos ? 50 : hasNeg ? 100 : 0;
  const span = hasNeg && hasPos ? 50 : 100;

  return (
    <ul className="space-y-1" role="list" aria-label="Nerealiziran donos po pozicijah">
      {bars.map((b, i) => {
        // 25 % prostora ob koncu ostane za oznako vrednosti, da ne pade čez rob.
        const w = b.value.abs().div(max).mul(span * 0.75).toNumber();
        const pos = b.value.gte(0);
        return (
          <li
            key={b.key}
            onMouseEnter={() => setHl(i)}
            onMouseLeave={() => setHl(null)}
            className={`grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 rounded-md px-1 ${hl === i ? 'bg-surface-2' : ''}`}
            title={`${b.label} ${b.name}: ${formatSignedEur(b.value)}${b.pct ? ` (${formatPct(b.pct)})` : ''}`}
          >
            <span className="truncate text-xs font-medium">{b.label}</span>
            <div className="relative h-6">
              <div className="absolute inset-y-0 w-px bg-axis" style={{ left: `${zero}%` }} aria-hidden="true" />
              <div
                className="absolute top-1 h-4"
                style={{
                  left: pos ? `${zero}%` : `${zero - w}%`,
                  width: `${Math.max(w, 0.4)}%`,
                  background: pos ? 'var(--color-up)' : 'var(--color-down)',
                  borderRadius: pos ? '0 4px 4px 0' : '4px 0 0 4px',
                }}
                aria-hidden="true"
              />
              <span
                className="num absolute top-1/2 -translate-y-1/2 text-[11px] whitespace-nowrap text-ink-2"
                style={pos ? { left: `calc(${zero + w}% + 4px)` } : { right: `calc(${100 - zero + w}% + 4px)` }}
              >
                {formatSignedEur(b.value)}
                {hl === i && b.pct ? <span className="text-ink-3"> · {formatPct(b.pct)}</span> : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────────── vrednost skozi čas ─────────────────────────────

type Range = '3M' | '6M' | '1L' | 'VSE';

function startFor(range: Range, last: IsoDate): IsoDate | null {
  if (range === 'VSE') return null;
  const months = range === '3M' ? 3 : range === '6M' ? 6 : 12;
  const [y, m, d] = last.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 - months, d));
  return t.toISOString().slice(0, 10);
}

/** Širina elementa v px (graf se riše v pravi širini, da pisava ostane berljiva tudi na telefonu). */
export function useWidth(fallback: number): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(fallback);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
  }, []);
  return [ref, w];
}

function ValueLine({ points }: { points: ValuePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth(640);
  const H = W < 480 ? 200 : 240;
  const pad = { l: 52, r: 12, t: 12, b: 26 };
  const vals = points.flatMap((p) => [p.valueEur.toNumber(), p.investedEur.toNumber()]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep((hi - lo) / 4 || hi / 4 || 1);
  const yMin = Math.max(0, Math.floor(lo / step) * step);
  const yMax = Math.ceil(hi / step) * step || step;
  const x = (i: number) => pad.l + (points.length > 1 ? (i / (points.length - 1)) * (W - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const line = (f: (p: ValuePoint) => number, stepped = false) =>
    points
      .map((p, i) => {
        const cmd = i === 0 ? 'M' : 'L';
        if (stepped && i > 0) return `L${x(i)},${y(f(points[i - 1]!))} L${x(i)},${y(f(p))}`;
        return `${cmd}${x(i)},${y(f(p))}`;
      })
      .join(' ');
  const valuePath = line((p) => p.valueEur.toNumber());
  const area = `${valuePath} L${x(points.length - 1)},${y(yMin)} L${x(0)},${y(yMin)} Z`;
  const ticks = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
  // Oznake mesecev: prvi petek v mesecu.
  const months: { i: number; label: string }[] = [];
  points.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (i === 0 || m !== points[i - 1]!.date.slice(0, 7)) months.push({ i, label: `${Number(p.date.slice(5, 7))}/${p.date.slice(2, 4)}` });
  });
  const every = Math.ceil(months.length / Math.max(3, Math.floor(W / 90)));
  const h = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  }

  return (
    <div className="relative" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Vrednost portfelja od ${formatDateSl(points[0]!.date)} do ${formatDateSl(points.at(-1)!.date)}: od ${formatEur(points[0]!.valueEur)} do ${formatEur(points.at(-1)!.valueEur)}; vloženo ${formatEur(points.at(-1)!.investedEur)}.`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
              {compact.format(v)}
            </text>
          </g>
        ))}
        {months
          .filter((_, k) => k % every === 0)
          .map((m) => (
            <text key={m.i} x={x(m.i)} y={H - 8} textAnchor="middle" className="num fill-ink-3 text-[11px]">
              {m.label}
            </text>
          ))}
        <path d={area} fill="var(--color-up)" opacity={0.1} />
        <path d={line((p) => p.investedEur.toNumber(), true)} fill="none" stroke="var(--color-ink-3)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={valuePath} fill="none" stroke="var(--color-up)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--color-axis)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.valueEur.toNumber())} r={4.5} fill="var(--color-up)" stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        ) : (
          <circle cx={x(points.length - 1)} cy={y(points.at(-1)!.valueEur.toNumber())} r={4.5} fill="var(--color-up)" stroke="var(--color-surface)" strokeWidth={2} />
        )}
      </svg>
      {h && hover !== null ? (
        <div
          role="status"
          className="num pointer-events-none absolute top-0 z-10 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-bg"
          style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <div className="font-semibold">{formatDateSl(h.date)}</div>
          <div>Vrednost {formatEur(h.valueEur)}</div>
          <div className="opacity-80">Vloženo {formatEur(h.investedEur)}</div>
          <div className="opacity-80">
            Donos {formatSignedEur(h.valueEur.minus(h.investedEur))}
            {h.complete ? '' : ' · delno brez cen'}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// ───────────────────────────── zaslon ─────────────────────────────

export interface ChartsProps {
  trades: Trade[];
  instruments: Instrument[];
  quotes: Quote[];
  priceHistory: PriceRow[];
  fxRows: FxRow[];
  today: IsoDate;
}

export function Charts({ trades, instruments, quotes, priceHistory, fxRows, today }: ChartsProps) {
  const [mode, setMode] = useState<'value' | 'cost'>('value');
  const [range, setRange] = useState<Range>('VSE');
  const inst = useMemo(() => new Map(instruments.map((i) => [i.isin, i])), [instruments]);

  const positions = useMemo(() => buildPositions(trades, quotes).filter((p) => p.quantity.gt(0)), [trades, quotes]);
  const series = useMemo(() => buildValueSeries(trades, priceHistory, fxRows, today), [trades, priceHistory, fxRows, today]);

  const priced = positions.filter((p) => p.valueEur);
  const byMode = (p: (typeof positions)[number]) => (mode === 'value' ? (p.valueEur ?? ZERO) : p.costEur);
  const other = (p: (typeof positions)[number]) => (mode === 'value' ? p.costEur : (p.valueEur ?? ZERO));
  const ranked = [...(mode === 'value' ? priced : positions)].sort((a, b) => byMode(b).cmp(byMode(a)));
  const top = ranked.slice(0, 7);
  const rest = ranked.slice(7);
  const slices: Slice[] = top.map((p, i) => ({
    key: p.isin,
    label: inst.get(p.isin)?.symbol ?? p.isin,
    name: inst.get(p.isin)?.name ?? '',
    value: byMode(p),
    other: other(p),
    color: SERIES[i]!,
  }));
  if (rest.length) {
    slices.push({
      key: 'ostalo',
      label: 'Ostalo',
      name: `${rest.length} pozicij`,
      value: rest.reduce((s, p) => s.plus(byMode(p)), ZERO),
      other: rest.reduce((s, p) => s.plus(other(p)), ZERO),
      color: OTHER,
    });
  }
  const total = slices.reduce((s, x) => s.plus(x.value), ZERO);
  const otherTotal = slices.reduce((s, x) => s.plus(x.other), ZERO);

  const bars: Bar[] = priced
    .map((p) => ({
      key: p.isin,
      label: inst.get(p.isin)?.symbol ?? p.isin,
      name: inst.get(p.isin)?.name ?? '',
      value: p.unrealizedEur!,
      pct: p.unrealizedPct,
    }))
    .sort((a, b) => b.value.cmp(a.value));

  const last = series.at(-1)?.date ?? today;
  const start = startFor(range, last);
  const shown = start ? series.filter((p) => compareIsoDate(p.date, start) >= 0) : series;
  const first = shown[0];
  const end = shown.at(-1);
  const change = first && end ? end.valueEur.minus(end.investedEur).minus(first.valueEur.minus(first.investedEur)) : null;
  const incomplete = shown.some((p) => !p.complete);

  return (
    <div className="mt-6 space-y-4">
      <Card
        title="Vrednost skozi čas"
        subtitle={
          <>
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-up" /> vrednost
            </span>
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-ink-3" /> vloženo (odprte pozicije)
            </span>
            {change ? <span className="num">donos v obdobju {formatSignedEur(change)}</span> : null}
          </>
        }
        actions={<Segmented label="Obdobje" value={range} onChange={setRange} options={[['3M', '3M'], ['6M', '6M'], ['1L', '1 L'], ['VSE', 'Vse']]} />}
      >
        {shown.length >= 2 ? (
          <>
            <ValueLine points={shown} />
            <p className="mt-2 text-xs text-ink-3">
              Tedenske vrednosti (petek) po zaključnih cenah in tečajih ECB tistega dne; zadnja točka je današnja.
              {incomplete ? ' Kjer cene ni bilo, je upoštevana nabavna vrednost.' : ''}
            </p>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-ink-3">Za graf je potrebna zgodovina cen. Klikni »Osveži cene« na pregledu.</p>
        )}
      </Card>

      <Card
        title="Razporeditev"
        subtitle={mode === 'value' ? 'po trenutni vrednosti · o. t. = sprememba deleža glede na investirano' : 'po nabavni vrednosti (FIFO)'}
        actions={<Segmented label="Osnova" value={mode} onChange={setMode} options={[['value', 'Trenutno'], ['cost', 'Investirano']]} />}
      >
        {total.gt(0) ? <Allocation slices={slices} total={total} otherTotal={otherTotal} mode={mode} /> : <p className="text-sm text-ink-3">Ni podatkov.</p>}
      </Card>

      <Card title="Nerealiziran donos po pozicijah" subtitle="v EUR · modro dobiček, rdeče izguba">
        {bars.length ? <PnlBars bars={bars} /> : <p className="text-sm text-ink-3">Ni pozicij s ceno.</p>}
      </Card>
    </div>
  );
}
