import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { normalizePriceSymbol } from '../domain/validation';
import { isTopDialog } from './modal';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'HKD', 'PLN', 'DKK', 'SEK', 'NOK', 'CAD', 'JPY'];

export type PriceSource = { kind: 'YAHOO'; symbol: string; currency: string } | { kind: 'ROCNO' };

interface Props {
  label: string;
  current: PriceSource;
  onSave: (s: PriceSource) => Promise<void>;
  onClose: () => void;
}

/** Vir tržne cene: samodejno (Yahoo Finance, simbol + valuta) ali ročni vnos v EUR. */
export function PriceSourceForm({ label, current, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<PriceSource['kind']>(current.kind);
  const [symbol, setSymbol] = useState(current.kind === 'YAHOO' ? current.symbol : '');
  const [currency, setCurrency] = useState(current.kind === 'YAHOO' ? current.currency : 'USD');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && isTopDialog(dialog.current) && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let s: PriceSource = { kind: 'ROCNO' };
    if (kind === 'YAHOO') {
      const sym = normalizePriceSymbol(symbol);
      if (!sym) return setError('Vpiši simbol, kot ga prikaže finance.yahoo.com (npr. NVDA, SIE.DE, KRK.WA).');
      s = { kind: 'YAHOO', symbol: sym, currency };
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(s);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        className="w-full max-w-sm rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="source-title" className="text-lg font-semibold">
          Vir cene · {label}
        </h2>
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <fieldset>
            <legend className="sr-only">Vir cene</legend>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {(
                [
                  ['YAHOO', 'Samodejno'],
                  ['ROCNO', 'Ročno'],
                ] as const
              ).map(([k, text]) => (
                <label
                  key={k}
                  className={`flex min-h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${kind === k ? 'bg-surface shadow-sm' : 'text-ink-3'}`}
                >
                  <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === 'YAHOO' ? (
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <label className="text-sm font-medium">
                Simbol (Yahoo)
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="KRK.WA"
                  className={`${field} uppercase`}
                />
              </label>
              <label className="text-sm font-medium">
                Valuta cene
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <p className="text-xs text-ink-3">
            {kind === 'YAHOO'
              ? 'Cena se posodobi dvakrat na dan ob delavnikih in pretvori v € po tečaju ECB. Po shranjevanju takoj osvežim cene in preverim simbol.'
              : 'Ceno v € vpisuješ sam (gumb »Vpiši ceno«). Že shranjene cene ostanejo.'}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl px-4 text-sm text-ink-2 hover:bg-surface-2">
              Prekliči
            </button>
            <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60">
              {saving ? 'Shranjujem …' : 'Shrani vir'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
