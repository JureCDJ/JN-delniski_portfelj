import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isTopDialog } from './modal';
import { compareIsoDate, parseIsoDate, type IsoDate } from '../domain/dates';
import { parseDecimalInput } from '../domain/validation';

interface Props {
  label: string;
  today: IsoDate;
  onSave: (date: IsoDate, priceEur: string) => Promise<void>;
  onClose: () => void;
}

/** Ročni vnos tržne cene v EUR (za instrumente brez samodejnega vira, npr. Krka). */
export function PriceForm({ label, today, onSave, onClose }: Props) {
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && isTopDialog(dialog.current) && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = parseDecimalInput(price);
    if (!p || p.lte(0)) return setError('Vpiši ceno, večjo od 0 (npr. 250,00).');
    try {
      parseIsoDate(date);
      if (compareIsoDate(date, today) > 0) return setError('Datum ne more biti v prihodnosti.');
    } catch {
      return setError('Izberi datum.');
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(date, p.toString());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-title"
        className="w-full max-w-sm rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="price-title" className="text-lg font-semibold">
          Cena · {label}
        </h2>
        <p className="mt-1 text-sm text-ink-3">Za instrumente brez samodejnega vira cen. Cena v EUR za en kos.</p>
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Cena (€)
              <input
                ref={input}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="250,00"
                className="num mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base"
              />
            </label>
            <label className="text-sm font-medium">
              Datum
              <input
                type="date"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base"
              />
            </label>
          </div>
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
              {saving ? 'Shranjujem …' : 'Shrani ceno'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
