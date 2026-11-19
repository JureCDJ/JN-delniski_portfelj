import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDateSl, type IsoDate } from '../domain/dates';
import { formatEur, formatPct, formatQty } from '../domain/format';
import type { Dividend } from '../domain/overview';
import { backupTransactionsCsv, plural, dividendsReport, isBackup, portfolioReport, salesReport, toCsv, type Cell, type ColType, type Report } from '../domain/reports';
import type { TaxSettings } from '../domain/tax';
import { taxYears } from '../domain/taxReturns';
import type { Instrument, Quote, Trade } from '../domain/types';

// Zavihek Izpisi (rezina 8): pregled portfelja, prodaje (FIFO), dividende — PDF (tisk) in CSV;
// varnostna kopija vseh podatkov (JSON) in posli kot CSV.

const NO_TAX: TaxSettings = { capitalGains: [{ fromYears: 0, rate: '0' }], dividendRate: '0', standardCostRate: '0' };

export interface ReportsProps {
  trades: Trade[];
  instruments: Instrument[];
  quotes: Quote[];
  dividends: Dividend[];
  targets: Map<string, Decimal>;
  tax: { settings: TaxSettings; confirmed: boolean } | null;
  today: IsoDate;
  /** Prenos varnostne kopije iz baze (v demu ni na voljo). */
  onBackup?: () => Promise<unknown>;
  onOpenTaxes?: () => void;
}

function display(c: Cell, type: ColType): string {
  if (c === null || c === undefined) return '';
  if (type === 'date' && typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) return formatDateSl(c);
  if (c instanceof Decimal) {
    if (type === 'eur') return formatEur(c);
    if (type === 'pct') return formatPct(c).replace(/^\+/, '');
    if (type === 'int') return c.toFixed(0);
    return formatQty(c);
  }
  return String(c);
}

const right = (t: ColType) => t !== 'text' && t !== 'date';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Izpis za tisk: prikaže se samo ob tisku (CSS @media print), nato se odstrani. */
function PrintView({ report, today, onDone }: { report: Report; today: IsoDate; onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [report, onDone]);
  return createPortal(
    <div className="print-root">
      <h1 style={{ fontSize: '14pt', fontWeight: 600, margin: 0 }}>{report.title}</h1>
      <p style={{ margin: '2pt 0 8pt', color: '#444' }}>
        {report.subtitle} · izpis {formatDateSl(today)} · JN Delniški portfelj
      </p>
      <table>
        <thead>
          <tr>
            {report.columns.map((c) => (
              <th key={c.label} style={{ textAlign: right(c.type) ? 'right' : 'left', fontWeight: 600 }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="num" style={{ textAlign: right(report.columns[j]!.type) ? 'right' : 'left' }}>
                  {display(c, report.columns[j]!.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {report.totals ? (
          <tfoot>
            <tr>
              {report.totals.map((c, j) => (
                <td key={j} className="num" style={{ textAlign: right(report.columns[j]!.type) ? 'right' : 'left', fontWeight: 600 }}>
                  {display(c, report.columns[j]!.type)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {report.notes?.length ? (
        <ul style={{ marginTop: '8pt', color: '#444', paddingLeft: '12pt' }}>
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>,
    document.body,
  );
}

function Item({ title, hint, controls, children }: { title: string; hint: ReactNode; controls?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-ink-3">{hint}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {controls}
        {children}
      </div>
    </li>
  );
}

const btn = 'min-h-10 rounded-xl border border-line px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-40';

function YearSelect({ years, value, onChange, label }: { years: number[]; value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value ?? 'vse'}
      onChange={(e) => onChange(e.target.value === 'vse' ? null : Number(e.target.value))}
      className="min-h-10 rounded-xl border border-line bg-surface px-3 text-sm"
    >
      <option value="vse">Vsa leta</option>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

export function Reports({ trades, instruments, quotes, dividends, targets, tax, today, onBackup, onOpenTaxes }: ReportsProps) {
  const settings = tax?.settings ?? NO_TAX;
  const saleYears = useMemo(() => taxYears(trades, []), [trades]);
  const divYears = useMemo(() => [...new Set(dividends.map((d) => Number(d.date.slice(0, 4))))].sort((a, b) => b - a), [dividends]);
  const [saleYear, setSaleYear] = useState<number | null>(null);
  const [divYearSel, setDivYearSel] = useState<number | null>(null);
  const [printing, setPrinting] = useState<Report | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const donePrint = useCallback(() => setPrinting(null), []);

  function build(kind: 'portfelj' | 'prodaje' | 'dividende'): Report {
    if (kind === 'portfelj') return portfolioReport({ trades, quotes, instruments, targets, settings, today });
    if (kind === 'prodaje') return salesReport({ trades, instruments, settings, year: saleYear });
    return dividendsReport({ dividends, instruments, settings, year: divYearSel });
  }

  function fileBase(kind: 'portfelj' | 'prodaje' | 'dividende') {
    if (kind === 'portfelj') return `portfelj_${today}`;
    if (kind === 'prodaje') return `prodaje_${saleYear ?? 'vsa-leta'}`;
    return `dividende_${divYearSel ?? 'vsa-leta'}`;
  }

  function run(kind: 'portfelj' | 'prodaje' | 'dividende', out: 'pdf' | 'csv') {
    try {
      const r = build(kind);
      if (out === 'pdf') setPrinting(r);
      else {
        download(`${fileBase(kind)}.csv`, toCsv(r), 'text/csv;charset=utf-8');
        setStatus({ kind: 'ok', text: `Prenesena datoteka ${fileBase(kind)}.csv (${plural(r.rows.length, 'vrstica', 'vrstici', 'vrstice', 'vrstic')}).` });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function backup(out: 'json' | 'csv') {
    if (!onBackup) return;
    setStatus({ kind: 'busy', text: 'Pripravljam varnostno kopijo …' });
    try {
      const b = await onBackup();
      if (!isBackup(b)) throw new Error('Baza ni vrnila pričakovane varnostne kopije.');
      if (out === 'json') {
        download(`portfelj-varnostna-kopija_${today}.json`, JSON.stringify(b, null, 1), 'application/json');
        const counts = ['transactions', 'instruments', 'prices', 'fx_rates']
          .map((k) => `${(b[k] as unknown[] | undefined)?.length ?? 0} ${{ transactions: 'transakcij', instruments: 'instrumentov', prices: 'cen', fx_rates: 'tečajev' }[k]}`)
          .join(', ');
        setStatus({ kind: 'ok', text: `Varnostna kopija prenesena: ${counts}.` });
      } else {
        download(`portfelj-posli_${today}.csv`, backupTransactionsCsv(b), 'text/csv;charset=utf-8');
        setStatus({ kind: 'ok', text: `Prenesenih ${b.transactions.length} transakcij (posli, dividende, davki) v CSV.` });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      {status ? (
        <p
          role="status"
          className={`mt-6 rounded-xl px-4 py-2.5 text-sm ${status.kind === 'error' ? 'bg-loss-bg text-loss' : status.kind === 'busy' ? 'bg-surface-2 text-ink-2' : 'bg-gain-bg text-gain'}`}
        >
          {status.text}
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold">Izpisi</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <Item title="Pregled portfelja na dan" hint={`Pozicije, vrednost, donos, delež, cilj in davek danes · ${formatDateSl(today)}`}>
            <button type="button" className={btn} onClick={() => run('portfelj', 'pdf')}>
              PDF
            </button>
            <button type="button" className={btn} onClick={() => run('portfelj', 'csv')}>
              CSV
            </button>
          </Item>
          <Item
            title="Prodaje in dobički (FIFO)"
            hint="Po nakupnih lotih: nabavna in prodajna vrednost, osnova z 1 %, stopnja, davek"
            controls={<YearSelect years={saleYears} value={saleYear} onChange={setSaleYear} label="Leto prodaj" />}
          >
            <button type="button" className={btn} disabled={!saleYears.length} onClick={() => run('prodaje', 'pdf')}>
              PDF
            </button>
            <button type="button" className={btn} disabled={!saleYears.length} onClick={() => run('prodaje', 'csv')}>
              CSV
            </button>
          </Item>
          <Item
            title="Dividende in tuji davek"
            hint="Vsako izplačilo: bruto, tuji davek, neto, SI davek, doplačilo"
            controls={<YearSelect years={divYears} value={divYearSel} onChange={setDivYearSel} label="Leto dividend" />}
          >
            <button type="button" className={btn} disabled={!divYears.length} onClick={() => run('dividende', 'pdf')}>
              PDF
            </button>
            <button type="button" className={btn} disabled={!divYears.length} onClick={() => run('dividende', 'csv')}>
              CSV
            </button>
          </Item>
          <Item title="Doh-KDVP in Doh-Div za eDavki" hint="XML za uvoz v eDavki pripraviš v zavihku Davki">
            {onOpenTaxes ? (
              <button type="button" className={btn} onClick={onOpenTaxes}>
                Odpri Davki
              </button>
            ) : null}
          </Item>
        </ul>
        <p className="mt-2 text-xs text-ink-3">
          PDF: odpre se okno za tiskanje — izberi »Shrani kot PDF« (na iPhonu: Deli → Shrani v Datoteke). CSV se odpre v Excelu s slovenskimi
          nastavitvami (podpičje, decimalna vejica).
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Varnostna kopija</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <Item
            title="Vsi podatki (JSON)"
            hint="Računi, instrumenti, vse transakcije, cilji, davčne nastavitve, cene in tečaji — natančna števila"
          >
            <button type="button" className={btn} disabled={!onBackup || status?.kind === 'busy'} onClick={() => void backup('json')}>
              JSON
            </button>
          </Item>
          <Item title="Posli, dividende in davki (CSV)" hint="Vse transakcije v eni tabeli za Excel">
            <button type="button" className={btn} disabled={!onBackup || status?.kind === 'busy'} onClick={() => void backup('csv')}>
              CSV
            </button>
          </Item>
        </ul>
        <p className="mt-2 text-xs text-ink-3">
          {onBackup
            ? 'Shrani datoteko na varno mesto (npr. iCloud Drive). Kopija vsebuje tvoje finančne podatke — ne pošiljaj je naprej.'
            : 'V demu varnostna kopija ni na voljo.'}
        </p>
      </section>

      {printing ? <PrintView report={printing} today={today} onDone={donePrint} /> : null}
    </>
  );
}
