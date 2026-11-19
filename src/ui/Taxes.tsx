import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDateSl, type IsoDate } from '../domain/dates';
import { buildDivXml, buildKdvpXml, missingPayerFields, validTaxNumber, type Payer } from '../domain/edavkiXml';
import { formatEur, formatQty, formatSignedEur } from '../domain/format';
import type { Dividend } from '../domain/overview';
import type { TaxSettings } from '../domain/tax';
import { divYear, kdvpInventory, kdvpYear, taxYears } from '../domain/taxReturns';
import type { Instrument, Trade } from '../domain/types';
import { isTopDialog, lockScroll } from './modal';

// Zavihek Davki (rezina 7): Doh-KDVP in Doh-Div po letih, ocena davka, XML za uvoz v eDavki.

export type TaxInstrument = Instrument & { payer?: Payer };

export interface TaxesProps {
  trades: Trade[];
  instruments: TaxInstrument[];
  dividends: Dividend[];
  tax: { settings: TaxSettings; confirmed: boolean } | null;
  today: IsoDate;
  onEditPayer?: (isin: string) => void;
  onConfirmTax?: () => void;
}

function payments(n: number): string {
  const m = n % 100;
  if (m === 1) return `${n} izplačilo`;
  if (m === 2) return `${n} izplačili`;
  if (m === 3 || m === 4) return `${n} izplačila`;
  return `${n} izplačil`;
}

const pctRate = (r: Decimal) => `${r.mul(100).toDecimalPlaces(1).toString().replace('.', ',')} %`;

function Kpi({ label, children, hint, tone }: { label: string; children: ReactNode; hint?: ReactNode; tone?: 'gain' | 'loss' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      <div className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</div>
      <div className={`num mt-2 text-lg font-semibold sm:text-xl ${tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : ''}`}>{children}</div>
      {hint ? <div className="mt-1 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
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

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TAX_NO_KEY = 'portfelj.davcna';

function readTaxNo(): string {
  try {
    return localStorage.getItem(TAX_NO_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Davčna številka za glavo XML. Shrani se samo v tem brskalniku, če uporabnik to izbere (ne v bazo). */
function ExportDialog({ title, onExport, onClose }: { title: string; onExport: (taxNo: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [taxNo, setTaxNo] = useState(readTaxNo);
  const [remember, setRemember] = useState(() => readTaxNo() !== '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && isTopDialog(dialog.current) && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = taxNo.replace(/\s/g, '');
    if (!validTaxNumber(v)) return setError('Davčna številka ima 8 števk (npr. 12345678).');
    try {
      if (remember) localStorage.setItem(TAX_NO_KEY, v);
      else localStorage.removeItem(TAX_NO_KEY);
    } catch {
      /* zasebno okno */
    }
    try {
      onExport(v);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="w-full max-w-sm rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="export-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-3">eDavki zahteva tvojo davčno številko v datoteki. Ne shrani se v bazo.</p>
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Davčna številka
            <input
              ref={input}
              inputMode="numeric"
              autoComplete="off"
              value={taxNo}
              onChange={(e) => setTaxNo(e.target.value)}
              placeholder="12345678"
              className="num mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base"
              aria-invalid={Boolean(error)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
            Zapomni si na tej napravi
          </label>
          {error ? (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl px-4 text-sm text-ink-2 hover:bg-surface-2">
              Prekliči
            </button>
            <button type="submit" className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-bg">
              Prenesi XML
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export function Taxes({ trades, instruments, dividends, tax, today, onEditPayer, onConfirmTax }: TaxesProps) {
  const years = useMemo(() => taxYears(trades, dividends), [trades, dividends]);
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? years[0] ?? Number(today.slice(0, 4));
  const [exporting, setExporting] = useState<'kdvp' | 'div' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const instByIsin = useMemo(() => new Map(instruments.map((i) => [i.isin, i])), [instruments]);
  const label = (isin: string) => instByIsin.get(isin)?.symbol ?? isin;
  const nameOf = (isin: string) => instByIsin.get(isin)?.name ?? '';

  const data = useMemo(() => {
    if (!tax) return null;
    try {
      return { k: kdvpYear(trades, tax.settings, y), d: divYear(dividends, tax.settings, y), error: null };
    } catch (e) {
      return { k: null, d: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [trades, dividends, tax, y]);

  if (!tax) {
    return (
      <p className="mt-8 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
        Davčne nastavitve niso nastavljene — brez njih ocene davka ni mogoče izračunati.
      </p>
    );
  }
  if (!data || data.error || !data.k || !data.d) {
    return (
      <p role="alert" className="mt-8 rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
        <strong>Podatki niso skladni:</strong> {data?.error}
      </p>
    );
  }
  const { k, d } = data;
  const currentYear = Number(today.slice(0, 4));
  const payerOf = (isin: string): Payer => {
    const p = instByIsin.get(isin)?.payer;
    return { name: p?.name ?? null, address: p?.address ?? null, country: p?.country ?? null, id: p?.id ?? null };
  };
  const payers = new Map(d.byIsin.map((x) => [x.isin, payerOf(x.isin)]));
  const incompletePayers = d.byIsin.filter((x) => missingPayerFields(payers.get(x.isin)).length > 0);

  function exportXml(kind: 'kdvp' | 'div', taxNo: string) {
    if (kind === 'kdvp') {
      const names = new Map(
        [...instByIsin.values()].map((i) => [i.isin, { code: i.symbol.slice(0, 10), name: i.name, isFund: i.type === 'ETF' }]),
      );
      download(`Doh-KDVP_${y}.xml`, buildKdvpXml({ taxNumber: taxNo, year: y, sheets: kdvpInventory(trades, y), names }));
      setNotice(`Datoteka Doh-KDVP_${y}.xml je prenesena. V eDavkih: Dokumenti → Uvoz.`);
    } else {
      download(`Doh-Div_${y}.xml`, buildDivXml({ taxNumber: taxNo, div: d, payers }));
      setNotice(`Datoteka Doh-Div_${y}.xml je prenesena. V eDavkih: Dokumenti → Uvoz.`);
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-3">Leto</span>
          <select
            value={y}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setNotice(null);
            }}
            className="min-h-10 rounded-lg border border-line bg-surface px-3 font-semibold"
          >
            {(years.length ? years : [y]).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ink-3">
          {y >= currentYear ? `Leto še ni zaključeno — napovedi za ${y} oddaš do 28. 2. ${y + 1}.` : `Rok za oddajo: 28. 2. ${y + 1}.`}
        </span>
      </div>

      {!tax.confirmed ? (
        <div role="note" className="mt-4 flex flex-col gap-3 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn sm:flex-row sm:items-center sm:justify-between">
          <span>
            <strong>Davčne stopnje še niso potrjene.</strong> Ocene spodaj temeljijo na stopnjah iz tvoje Apps Script aplikacije — preveri jih pri FURS.
          </span>
          {onConfirmTax ? (
            <button type="button" onClick={onConfirmTax} className="min-h-10 shrink-0 rounded-lg border border-current px-3 font-medium">
              Potrjujem stopnje
            </button>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 rounded-xl bg-gain-bg px-4 py-2.5 text-sm text-gain">
          {notice}
        </p>
      ) : null}

      {/* ───────── Doh-KDVP ───────── */}
      <Panel
        title="Doh-KDVP · prodaje"
        subtitle="Dobiček od odsvojitve vrednostnih papirjev, po FIFO lotih"
        actions={
          k.rows.length ? (
            <button type="button" onClick={() => setExporting('kdvp')} className="min-h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-bg">
              XML za eDavki
            </button>
          ) : null
        }
      >
        {k.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-3">V letu {y} ni prodaj.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Dobički (osnova)" tone="gain">
                {formatEur(k.gainsBaseEur)}
              </Kpi>
              <Kpi label="Izgube (osnova)" tone={k.lossesBaseEur.gt(0) ? 'loss' : undefined}>
                {k.lossesBaseEur.gt(0) ? `−${formatEur(k.lossesBaseEur)}` : formatEur(k.lossesBaseEur)}
              </Kpi>
              <Kpi label="Neto po pobotu">{formatEur(k.netBaseEur)}</Kpi>
              <Kpi label="Davek (ocena)" hint="po stopnjah, sorazmerni pobot izgub">
                {formatEur(k.taxEur)}
              </Kpi>
            </div>
            <p className="num mt-2 text-xs text-ink-3">
              {k.rows.length} vrstic po lotih · kupnina {formatEur(k.proceedsEur)} · nabavna {formatEur(k.costEur)} · dobiček {formatSignedEur(k.gainEur)}
            </p>

            {k.byRate.length > 1 || k.lossesBaseEur.gt(0) ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="grid grid-cols-4 gap-x-3 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-ink-3">
                  <span>Stopnja</span>
                  <span className="text-right">Dobički</span>
                  <span className="text-right">Po pobotu</span>
                  <span className="text-right">Davek</span>
                </div>
                {k.byRate.map((r) => (
                  <div key={r.rate.toString()} className="num grid grid-cols-4 gap-x-3 border-b border-line px-4 py-2 text-sm last:border-b-0">
                    <span>{pctRate(r.rate)}</span>
                    <span className="text-right">{formatEur(r.gainsEur)}</span>
                    <span className="text-right">{formatEur(r.baseAfterOffsetEur)}</span>
                    <span className="text-right">{formatEur(r.taxEur)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {k.washCount ? (
              <p role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
                <strong>{k.washCount === 1 ? '1 lot' : `${k.washCount} lotov`} z izgubo ima nakup istega papirja v ±30 dneh</strong> — taka izguba se morda ne prizna.
                Preveri pred oddajo.
              </p>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="hidden grid-cols-[1fr_1.4fr_1fr_0.8fr_1fr_1fr_0.8fr] gap-x-3 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-ink-3 md:grid">
                <span>Prodaja</span>
                <span>Papir</span>
                <span>Nakup (lot)</span>
                <span className="text-right">Kos</span>
                <span className="text-right">Dobiček</span>
                <span className="text-right">Osnova (1 %)</span>
                <span className="text-right">Stopnja</span>
              </div>
              <ul className="divide-y divide-line">
                {k.rows.map((r, i) => (
                  <li key={`${r.sellTradeId}-${r.buyTradeId}-${i}`} className="num grid grid-cols-2 gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm md:grid-cols-[1fr_1.4fr_1fr_0.8fr_1fr_1fr_0.8fr] md:items-center">
                    <span>{formatDateSl(r.sellDate)}</span>
                    <span className="truncate text-right md:text-left">
                      <span className="font-semibold">{label(r.isin)}</span> <span className="text-ink-3">{nameOf(r.isin)}</span>
                    </span>
                    <span className="text-xs text-ink-3 md:text-sm md:text-ink-2">
                      <span className="md:hidden">lot </span>
                      {formatDateSl(r.buyDate)} · {r.years} l.
                    </span>
                    <span className="text-right text-xs text-ink-3 md:text-sm md:text-ink">{formatQty(r.quantity)} kos</span>
                    <span className={`md:text-right ${r.gainEur.isNegative() ? 'text-loss' : 'text-gain'}`}>{formatSignedEur(r.gainEur)}</span>
                    <span className="text-right">
                      <span className="text-xs text-ink-3 md:hidden">osnova </span>
                      {formatSignedEur(r.baseEur)}
                    </span>
                    <span className="col-span-2 text-xs text-ink-3 md:col-span-1 md:text-right md:text-sm md:text-ink">
                      {pctRate(r.rate)}
                      {r.washBuys.length ? (
                        <span className="ml-1.5 rounded-md bg-warn-bg px-1.5 py-0.5 text-xs text-warn">nakup {r.washBuys.map(formatDateSl).join(', ')}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Ocena: davčna osnova vsakega lota z 1 % normiranimi stroški ob nakupu in prodaji, stopnja po letih imetništva, izgube pobotane z
              dobički istega leta sorazmerno po stopnjah. Končni izračun naredi FURS. XML vsebuje popisni list za vsak prodan papir: vse nakupe in
              prodaje do konca leta z vrednostjo na enoto v EUR in zalogo po vsaki vrstici.
            </p>
          </>
        )}
      </Panel>

      {/* ───────── Doh-Div ───────── */}
      <Panel
        title="Doh-Div · dividende"
        subtitle="Vsako izplačilo je svoja vrstica napovedi"
        actions={
          d.rows.length ? (
            <button
              type="button"
              onClick={() => setExporting('div')}
              disabled={incompletePayers.length > 0}
              title={incompletePayers.length ? 'Najprej dopolni podatke izplačevalcev' : undefined}
              className="min-h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-40"
            >
              XML za eDavki
            </button>
          ) : null
        }
      >
        {d.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-3">
            V letu {y} ni dividend tujih izplačevalcev{d.domesticRows.length ? ` (${payments(d.domesticRows.length)} slovenskih družb — davek že odtegnjen)` : ''}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Bruto dividende" hint={payments(d.rows.length)}>
                {formatEur(d.grossEur)}
              </Kpi>
              <Kpi label="Tuji davek">{formatEur(d.foreignTaxEur)}</Kpi>
              <Kpi label={`SI davek ${pctRate(d.rate)}`}>{formatEur(d.siTaxEur)}</Kpi>
              <Kpi label="Doplačilo (ocena)" hint="po izplačilu: SI davek − tuji, ne manj kot 0">
                {formatEur(d.topUpEur)}
              </Kpi>
            </div>

            {incompletePayers.length ? (
              <p role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
                <strong>Za XML manjkajo podatki {incompletePayers.length === 1 ? '1 izplačevalca' : `${incompletePayers.length} izplačevalcev`}.</strong> FURS
                zahteva naziv, naslov in državo izplačevalca, za tujega še njegovo identifikacijsko številko (npr. ameriški EIN).
              </p>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="hidden grid-cols-[1.6fr_0.5fr_1fr_1fr_1fr_1.4fr] gap-x-3 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-ink-3 md:grid">
                <span>Izplačevalec</span>
                <span className="text-right">Št.</span>
                <span className="text-right">Bruto</span>
                <span className="text-right">Tuji davek</span>
                <span className="text-right">Doplačilo</span>
                <span className="text-right">Podatki za XML</span>
              </div>
              <ul className="divide-y divide-line">
                {d.byIsin.map((x) => {
                  const miss = missingPayerFields(payers.get(x.isin));
                  return (
                    <li key={x.isin} className="num grid grid-cols-2 gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm md:grid-cols-[1.6fr_0.5fr_1fr_1fr_1fr_1.4fr] md:items-center">
                      <span className="col-span-2 truncate md:col-span-1">
                        <span className="font-semibold">{label(x.isin)}</span> <span className="text-ink-3">{nameOf(x.isin)}</span>
                      </span>
                      <span className="text-xs text-ink-3 md:text-right md:text-sm md:text-ink">{x.count}×</span>
                      <span className="text-right">{formatEur(x.grossEur)}</span>
                      <span className="text-xs text-ink-3 md:text-right md:text-sm md:text-ink">
                        <span className="md:hidden">tuji </span>
                        {formatEur(x.foreignTaxEur)}
                      </span>
                      <span className="text-right text-xs text-ink-3 md:text-sm md:text-ink">
                        <span className="md:hidden">doplačilo </span>
                        {formatEur(x.topUpEur)}
                      </span>
                      <span className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:justify-end">
                        {miss.length ? (
                          <span className="text-xs text-warn">manjka: {miss.join(', ')}</span>
                        ) : (
                          <span className="text-xs text-gain">✓ popolno</span>
                        )}
                        {onEditPayer ? (
                          <button type="button" onClick={() => onEditPayer(x.isin)} className="min-h-9 text-xs text-accent underline">
                            {miss.length ? 'Dopolni' : 'Uredi'}
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {d.domesticRows.length ? (
              <p className="mt-3 rounded-xl bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
                Izpuščeno iz Doh-Div: {payments(d.domesticRows.length)} slovenskih družb ({[...new Set(d.domesticRows.map((r) => label(r.isin)))].join(', ')}) — slovenski
                izplačevalec davek odtegne sam.
              </p>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-ink-2">Posamezna izplačila ({d.rows.length})</summary>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                {d.rows.map((r, i) => (
                  <li key={`${r.isin}-${r.date}-${i}`} className="num grid grid-cols-[1fr_1fr_auto] gap-x-3 px-4 py-2 text-sm">
                    <span>{formatDateSl(r.date)}</span>
                    <span className="truncate font-semibold">{label(r.isin)}</span>
                    <span className="text-right">
                      {formatEur(r.grossEur)}
                      {r.foreignTaxEur.gt(0) ? <span className="text-xs text-ink-3"> · tuji −{formatEur(r.foreignTaxEur)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            <p className="mt-3 text-xs text-ink-3">
              Zneski v EUR po tečaju na dan izplačila (FURS: tečaj Banke Slovenije). Tuji davek se prizna največ do stopnje iz konvencije o
              izogibanju dvojnega obdavčenja (npr. ZDA 15 % z obrazcem W-8BEN). Doplačilo je ocena; odmero izda FURS.
            </p>
          </>
        )}
      </Panel>

      {exporting ? (
        <ExportDialog
          title={exporting === 'kdvp' ? `Doh-KDVP ${y} · XML` : `Doh-Div ${y} · XML`}
          onExport={(taxNo) => exportXml(exporting, taxNo)}
          onClose={() => setExporting(null)}
        />
      ) : null}
    </>
  );
}
