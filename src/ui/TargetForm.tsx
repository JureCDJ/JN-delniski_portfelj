import Decimal from 'decimal.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney } from '../domain/format';
import { parseDecimalInput } from '../domain/validation';

interface Props {
  label: string;
  current: Decimal | null;
  /** Trenutna cena v EUR za izračun »do cilja«. */
  priceEur: Decimal | null;
  onSave: (priceEur: string | null) => Promise<void>;
  onClose: () => void;
}

/** Ciljna (izhodna) prodajna cena v EUR. Prazno polje + Shrani ali »Odstrani cilj« izbriše cilj. */
export function TargetForm({ label, current, priceEur, onSave, onClose }: Props) {
  const [value, setValue] = useState(current ? current.toString().replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = parseDecimalInput(value);
  const toTarget = parsed && priceEur && priceEur.gt(0) ? parsed.div(priceEur).minus(1).mul(100) : null;

  async function save(v: string | null) {
    setSaving(true);
    setError(null);
    try {
      await onSave(v);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim() === '') return void save(null);
    if (!parsed || parsed.lte(0)) return setError('Vpiši ceno, večjo od 0 (npr. 35,00), ali pusti prazno za brez cilja.');
    void save(parsed.toString());
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-title"
        className="w-full max-w-sm rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="target-title" className="text-lg font-semibold">
          Ciljna cena · {label}
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          Cena v EUR na kos, pri kateri bi prodal. {priceEur ? `Trenutna cena ${formatMoney(priceEur)}.` : ''}
        </p>
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Ciljna cena (€)
            <input
              ref={input}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="35,00"
              aria-describedby="target-hint"
              className="num mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base"
            />
          </label>
          <p id="target-hint" className="num min-h-5 text-xs text-ink-3">
            {toTarget ? `${toTarget.gte(0) ? '+' : '−'}${toTarget.abs().toDecimalPlaces(1).toString().replace('.', ',')} % od trenutne cene` : ''}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            {current ? (
              <button type="button" disabled={saving} onClick={() => void save(null)} className="min-h-11 rounded-xl px-3 text-sm text-loss hover:bg-loss-bg">
                Odstrani cilj
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl px-4 text-sm text-ink-2 hover:bg-surface-2">
              Prekliči
            </button>
            <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60">
              {saving ? 'Shranjujem …' : 'Shrani cilj'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
