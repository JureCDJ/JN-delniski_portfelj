import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDateSl, fullYearsBetween, type IsoDate } from '../domain/dates';
import { formatEur, formatPct, formatQty, formatSignedEur } from '../domain/format';
import { buildOverview, type Dividend } from '../domain/overview';
import type { FxRow, PriceRow } from '../domain/quotes';
import { buildStockCard, priceSeriesEur, tradePriceEur, type PricePoint } from '../domain/stockCard';
import { estimateSaleOfLots, rateForYears, type TaxSettings } from '../domain/tax';
import type { Quote, Trade } from '../domain/types';
import { compact, niceStep, useWidth } from './Charts';
import { isTopDialog, lockScroll } from './modal';
import { Delta, type InstrumentView } from './Overview';

// Kartica delnice (rezina 6): povzetek, ciljna cena, graf cene z nakupi/prodajami,
// nakupni loti z datumom nižje davčne stopnje, zaključene prodaje in dividende.

const NO_TAX: TaxSettings = { capitalGains: [{ fromYears: 0, rate: '0' }], dividendRate: '0', standardCostRate: '0' };

export type CardInstrument = InstrumentView & { priceSymbol?: string | null; priceCurrency?: string | null };

export interface StockCardProps {
  isin: string;
  instruments: CardInstrument[];
  trades: Trade[];
  quotes: (Quote & { source?: string })[];
  dividends: Dividend[];
  targets: Map<string, Decimal>;
  tax: { settings: TaxSettings } | null;
  priceHistory: PriceRow[];
  fxRows: FxRow[];
  brokerByAccount: Map<string, string>;
  today: IsoDate;
  onClose: () => void;
  onSell: (isin: string) => void;
  onEditTarget: (isin: string) => void;
  onEditPriceSource?: (isin: string) => void;
  onManualPrice?: (isin: string) => void;
}

const rate = (r: Decimal) => `${r.mul(100).toDecimalPlaces(1).toString().replace('.', ',')} %`;

function brokerLabel(b: string | undefined): string {
  if (!b) return '—';
  return b === 'ROCNO' ? 'ročno' : b;
}

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3.5 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{children}</div>
      {hint ? <div className="num mt-0.5 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside ? <span className="num text-xs text-ink-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ───────────────────────────── graf cene ─────────────────────────────

const DAY = 86_400_000;
const utc = (d: IsoDate) => {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, dd);
};

interface Marker {
  date: IsoDate;
  priceEur: Decimal;
  kind: 'NAKUP' | 'PRODAJA';
  quantity: Decimal;
}

function PriceChart({ points, markers, target, avgCost }: { points: PricePoint[]; markers: Marker[]; target: Decimal | null; avgCost: Decimal | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth(640);
  const H = W < 480 ? 180 : 220;
  const pad = { l: 48, r: 12, t: 12, b: 24 };
  // Časovna os pokrije cene in vse posle (prvi nakup je lahko pred prvo shranjeno ceno).
  const t0 = Math.min(utc(points[0]!.date), ...markers.map((m) => utc(m.date)));
  const t1 = Math.max(utc(points.at(-1)!.date), ...markers.map((m) => utc(m.date)), t0 + DAY);
  const vals = [...points.map((p) => p.priceEur.toNumber()), ...markers.map((m) => m.priceEur.toNumber())];
  if (target) vals.push(target.toNumber());
  if (avgCost) vals.push(avgCost.toNumber());
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep((hi - lo) / 4 || hi / 4 || 1);
  const yMin = Math.max(0, Math.floor(lo / step) * step);
  const yMax = Math.ceil(hi / step) * step || step;
  const x = (d: IsoDate) => pad.l + ((utc(d) - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.priceEur.toNumber())}`).join(' ');
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v);
  const months: { d: IsoDate; label: string }[] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.date.slice(0, 7) !== points[i - 1]!.date.slice(0, 7)) months.push({ d: p.date, label: `${Number(p.date.slice(5, 7))}/${p.date.slice(2, 4)}` });
  });
  const every = Math.ceil(months.length / Math.max(3, Math.floor(W / 90)));
  const h = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(utc(p.date) - t) < Math.abs(utc(points[best]!.date) - t)) best = i;
    });
    setHover(best);
  }

  const hline = (v: Decimal, color: string, label: string) => (
    <g>
      <line x1={pad.l} x2={W - pad.r} y1={y(v.toNumber())} y2={y(v.toNumber())} stroke={color} strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={W - pad.r - 2} y={y(v.toNumber()) - 5} textAnchor="end" className="num text-[11px]" fill={color}>
        {label}
      </text>
    </g>
  );

  return (
    <div className="relative" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Cena od ${formatDateSl(points[0]!.date)} (${formatEur(points[0]!.priceEur)}) do ${formatDateSl(points.at(-1)!.date)} (${formatEur(points.at(-1)!.priceEur)}); ${markers.length} poslov označenih na grafu.`}
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
            <text key={m.d} x={x(m.d)} y={H - 7} textAnchor="middle" className="num fill-ink-3 text-[11px]">
              {m.label}
            </text>
          ))}
        {avgCost ? hline(avgCost, 'var(--color-ink-3)', `povp. nabavna ${formatEur(avgCost)}`) : null}
        {target ? hline(target, 'var(--color-gain)', `cilj ${formatEur(target)}`) : null}
        <path d={path} fill="none" stroke="var(--color-up)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {markers.map((m, i) =>
          m.kind === 'NAKUP' ? (
            <circle key={i} cx={x(m.date)} cy={y(m.priceEur.toNumber())} r={5} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} />
          ) : (
            <circle key={i} cx={x(m.date)} cy={y(m.priceEur.toNumber())} r={4.5} fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth={2} />
          ),
        )}
        {h ? (
          <g>
            <line x1={x(h.date)} x2={x(h.date)} y1={pad.t} y2={H - pad.b} stroke="var(--color-axis)" strokeWidth={1} />
            <circle cx={x(h.date)} cy={y(h.priceEur.toNumber())} r={4.5} fill="var(--color-up)" stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {h ? (
        <div
          role="status"
          className="num pointer-events-none absolute top-0 z-10 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-bg"
          style={{ left: `clamp(0px, calc(${(x(h.date) / W) * 100}% - 60px), calc(100% - 130px))` }}
        >
          <div className="font-semibold">{formatDateSl(h.date)}</div>
          <div>{formatEur(h.priceEur)}</div>
          {markers
            .filter((m) => m.date === h.date)
            .map((m, i) => (
              <div key={i} className="opacity-80">
                {m.kind === 'NAKUP' ? 'Nakup' : 'Prodaja'} {formatQty(m.quantity)} kos po {formatEur(m.priceEur)}
              </div>
            ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded bg-[var(--color-up)]" /> cena (€)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-ink" /> nakup
        </span>
        {markers.some((m) => m.kind === 'PRODAJA') ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-ink" /> prodaja
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── kartica ─────────────────────────────

export function StockCard(props: StockCardProps) {
  const { isin, instruments, trades, quotes, dividends, targets, tax, priceHistory, fxRows, brokerByAccount, today } = props;
  const { onClose, onSell, onEditTarget, onEditPriceSource, onManualPrice } = props;
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const settings = tax?.settings ?? NO_TAX;
  const showTax = Boolean(tax);

  useEffect(() => {
    closeBtn.current?.focus();
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && isTopDialog(dialog.current) && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [onClose]);

  const data = useMemo(() => {
    try {
      const own = trades.filter((t) => t.isin === isin);
      const overview = buildOverview({ trades: own, quotes, dividends: [], targets, settings, today });
      return {
        position: overview.positions.find((p) => p.isin === isin) ?? null,
        card: buildStockCard({ trades, isin, dividends, settings }),
        series: priceSeriesEur(priceHistory, fxRows, isin),
        own,
        error: null,
      };
    } catch (e) {
      return { position: null, card: null, series: [], own: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [trades, quotes, dividends, targets, settings, today, isin, priceHistory, fxRows]);

  const inst = instruments.find((i) => i.isin === isin);
  const quote = quotes.find((q) => q.isin === isin);
  const { position: p, card } = data;
  const tradeById = new Map(trades.map((t) => [t.id, t]));
  const brokers = [...new Set(data.own.map((t) => brokerLabel(brokerByAccount.get(t.accountId))))].filter((b) => b !== '—');
  const manual = inst?.priceSource === 'ROCNO';
  const sourceText = !inst?.priceSource
    ? null
    : manual
      ? 'cena: ročni vnos'
      : inst.priceSymbol
        ? `cena: Yahoo ${inst.priceSymbol}${inst.priceCurrency ? ` (${inst.priceCurrency})` : ''}`
        : 'cena: vir ni nastavljen';
  const markers: Marker[] = data.own.map((t) => ({ date: t.date, priceEur: tradePriceEur(t), kind: t.type, quantity: new Decimal(t.quantity) }));
  const firstMarker = markers.reduce<IsoDate | null>((m, x) => (!m || x.date < m ? x.date : m), null);
  // Graf od prvega posla naprej (pred tem cene niso shranjene ali niso zanimive).
  const series = firstMarker ? data.series.filter((s) => s.date >= firstMarker) : data.series;
  const chartMarkers = markers;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-title"
        className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-bg pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-line bg-bg px-5 py-4">
          <div className="min-w-0">
            <h2 id="card-title" className="truncate text-lg font-semibold">
              {inst?.symbol ?? isin} <span className="font-normal text-ink-3">· {inst?.name}</span>
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
              <span className="num">{isin}</span>
              {sourceText ? <span>· {sourceText}</span> : null}
              {onEditPriceSource ? (
                <button type="button" onClick={() => onEditPriceSource(isin)} className="text-accent underline">
                  uredi vir
                </button>
              ) : null}
              {brokers.length ? <span>· {brokers.join(' + ')}</span> : null}
            </p>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-ink-2">
            Zapri
          </button>
        </div>

        <div className="px-5 pt-4">
          {data.error ? (
            <p role="alert" className="rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
              <strong>Podatki niso skladni:</strong> {data.error}
            </p>
          ) : null}

          {p ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="V lasti" hint={`povp. FIFO ${formatEur(p.avgCostEur)}`}>
                  {formatQty(p.quantity)} kos
                </Stat>
                <Stat
                  label="Vrednost"
                  hint={
                    p.priceEur && quote ? (
                      <>
                        {formatEur(p.priceEur)} · {formatDateSl(quote.date)}
                      </>
                    ) : (
                      'ni cene'
                    )
                  }
                >
                  {p.valueEur ? formatEur(p.valueEur) : '—'}
                </Stat>
                <Stat label="Donos" hint={`vloženo ${formatEur(p.costEur)}`}>
                  <Delta value={p.unrealizedEur} pct={p.unrealizedPct} stacked />
                </Stat>
                <Stat
                  label="Ciljna cena"
                  hint={
                    p.target ? (
                      <>
                        {p.target.toTargetPct ? `${formatPct(p.target.toTargetPct)} · ` : ''}
                        {showTax ? `neto ${formatSignedEur(p.target.atTarget.netEur)}` : ''}
                      </>
                    ) : (
                      'ni cilja'
                    )
                  }
                >
                  {p.target ? formatEur(p.target.priceEur) : '—'}
                </Stat>
              </div>
              {showTax && p.taxToday ? (
                <p className="num mt-2 text-xs text-ink-3">
                  Ob prodaji vsega danes: dobiček {formatSignedEur(p.taxToday.gainEur)} · davek {formatEur(p.taxToday.taxEur)} · neto{' '}
                  {formatSignedEur(p.taxToday.netEur)}
                </p>
              ) : null}
            </>
          ) : !data.error ? (
            <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">Pozicija je zaprta — v lasti ni več nobenega kosa.</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {p ? (
              <button type="button" onClick={() => onSell(isin)} className="min-h-11 rounded-xl bg-ink px-4 text-sm font-semibold text-bg">
                Vpiši prodajo
              </button>
            ) : null}
            {p ? (
              <button type="button" onClick={() => onEditTarget(isin)} className="min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">
                {p.target ? 'Uredi cilj' : 'Dodaj cilj'}
              </button>
            ) : null}
            {manual && onManualPrice ? (
              <button type="button" onClick={() => onManualPrice(isin)} className="min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">
                Vpiši ceno
              </button>
            ) : null}
          </div>

          <Section title="Graf cene" aside={series.length ? `${formatDateSl(series[0]!.date)} – ${formatDateSl(series.at(-1)!.date)}` : undefined}>
            {series.length >= 2 ? (
              <PriceChart points={series} markers={chartMarkers} target={p?.target?.priceEur ?? null} avgCost={p ? p.avgCostEur : null} />
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">
                Za graf še ni dovolj shranjenih cen.
              </p>
            )}
          </Section>

          {p ? (
            <Section title="Nakupni loti (FIFO)" aside={`prodaja najprej zapre najstarejšega`}>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <div className="hidden grid-cols-[1.3fr_0.7fr_0.9fr_0.6fr_1.5fr_0.9fr] gap-x-3 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-ink-3 sm:grid">
                  <span>Nakup</span>
                  <span className="text-right">Kos</span>
                  <span className="text-right">Nabavna / kos</span>
                  <span className="text-right">Stopnja</span>
                  <span className="text-right">Nižja stopnja od</span>
                  <span className="text-right">{showTax ? 'Davek danes' : 'Donos'}</span>
                </div>
                <ul className="divide-y divide-line">
                  {p.lotsView.map((l) => {
                    const years = fullYearsBetween(l.buyDate, today);
                    const est = p.priceEur ? estimateSaleOfLots([l], p.priceEur, today, settings) : null;
                    const broker = brokerLabel(brokerByAccount.get(tradeById.get(l.tradeId)?.accountId ?? ''));
                    const rateNow = rateForYears(settings, years);
                    return (
                      <li key={l.tradeId} className="num grid grid-cols-2 gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:grid-cols-[1.3fr_0.7fr_0.9fr_0.6fr_1.5fr_0.9fr] sm:items-center">
                        <span>
                          {formatDateSl(l.buyDate)} <span className="text-xs text-ink-3">· {broker}</span>
                        </span>
                        <span className="text-right">{formatQty(l.quantity)} kos</span>
                        <span className="text-ink-2 sm:text-right">
                          <span className="text-xs text-ink-3 sm:hidden">nabavna </span>
                          {formatEur(l.costEur.div(l.quantity))}
                        </span>
                        <span className="text-right">
                          {showTax ? (
                            <>
                              <span className="text-xs text-ink-3 sm:hidden">stopnja </span>
                              {rate(rateNow)}
                            </>
                          ) : (
                            <span className="text-ink-3">{years} l.</span>
                          )}
                        </span>
                        <span className="text-xs whitespace-nowrap text-ink-3 sm:text-right sm:text-sm sm:text-ink-2">
                          {showTax ? (l.nextLower ? `${formatDateSl(l.nextLower.date)} → ${rate(l.nextLower.rate)}` : 'najnižja stopnja') : ''}
                        </span>
                        <span className="text-right">
                          {est ? (
                            showTax ? (
                              <>
                                <span className="text-xs text-ink-3 sm:hidden">davek </span>
                                {formatEur(est.taxEur)}
                              </>
                            ) : (
                              <Delta value={est.gainEur} />
                            )
                          ) : (
                            '—'
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Section>
          ) : null}

          {card ? (
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Section
                title="Zaključene prodaje"
                aside={card.disposals.length ? `${formatSignedEur(card.realizedEur)}${showTax ? ` · davek ${formatEur(card.realizedTaxEur)}` : ''}` : undefined}
              >
                {card.disposals.length ? (
                  <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                    {card.disposals.map((d, i) => (
                      <li key={`${d.sellTradeId}-${d.buyTradeId}-${i}`} className="num flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                        <span>
                          {formatDateSl(d.sellDate)} · {formatQty(d.quantity)} kos
                          <span className="block text-xs text-ink-3">
                            lot {formatDateSl(d.buyDate)} · {d.holdingYears} l.{showTax ? ` · ${rate(d.tax.rate)}` : ''}
                          </span>
                        </span>
                        <span className="text-right">
                          <Delta value={d.gainEur} />
                          {showTax ? <span className="block text-xs text-ink-3">davek {formatEur(d.tax.taxEur)}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Ni prodaj.</p>
                )}
              </Section>
              <Section
                title="Dividende"
                aside={card.dividends.length ? `neto ${formatEur(card.dividendsNetEur)}` : undefined}
              >
                {card.dividends.length ? (
                  <>
                    <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
                      {card.dividends.map((d, i) => (
                        <li key={`${d.date}-${i}`} className="num flex items-center justify-between gap-3 px-4 py-2 text-sm">
                          <span>{formatDateSl(d.date)}</span>
                          <span className="text-right">
                            {d.grossEur.gt(0) ? formatEur(d.grossEur) : null}
                            {d.foreignTaxEur.gt(0) ? <span className="text-xs text-ink-3"> tuji davek −{formatEur(d.foreignTaxEur)}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="num mt-1.5 text-xs text-ink-3">
                      Bruto {formatEur(card.dividendsGrossEur)} · tuji davek {formatEur(card.dividendsForeignTaxEur)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-3">Ni izplačil.</p>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
