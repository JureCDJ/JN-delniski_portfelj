import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { missingPayerFields, type Payer } from '../domain/edavkiXml';
import { isTopDialog, lockScroll } from './modal';

interface Props {
  label: string;
  /** Predlog ob praznih poljih: naziv instrumenta in država iz ISIN. */
  suggested: { name: string; country: string };
  current: Payer;
  onSave: (p: Payer) => Promise<void>;
  onClose: () => void;
}

/** Izplačevalec dividend za Doh-Div (naziv, naslov, država, identifikacijska številka). */
export function PayerForm({ label, suggested, current, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<Payer>({
    name: current.name ?? suggested.name,
    address: current.address ?? '',
    country: current.country ?? suggested.country,
    id: current.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    first.current?.focus();
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && isTopDialog(dialog.current) && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [onClose]);

  const country = (v.country ?? '').trim().toUpperCase();
  const miss = missingPayerFields({ ...v, country });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (country && !/^[A-Z]{2}$/.test(country)) return setError('Država: dvomestna oznaka, npr. US, DE, FR.');
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...v, country: country || null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base';
  const set = (k: keyof Payer) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payer-title"
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="payer-title" className="text-lg font-semibold">
          Izplačevalec dividend · {label}
        </h2>
        <p className="mt-1 text-sm text-ink-3">Za Doh-Div. Podatke najdeš v letnem poročilu podjetja ali na potrdilu posrednika.</p>
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            Naziv
            <input ref={first} value={v.name ?? ''} onChange={set('name')} className={field} />
          </label>
          <label className="block text-sm font-medium">
            Naslov (sedež)
            <input value={v.address ?? ''} onChange={set('address')} placeholder="npr. 1 Apple Park Way, Cupertino, CA 95014" className={field} />
          </label>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <label className="block text-sm font-medium">
              Država
              <input value={v.country ?? ''} onChange={set('country')} maxLength={2} autoCapitalize="characters" placeholder="US" className={`${field} uppercase`} />
            </label>
            <label className="block text-sm font-medium">
              Identifikacijska št.
              <input value={v.id ?? ''} onChange={set('id')} autoComplete="off" placeholder={country === 'US' ? 'EIN, npr. 12-3456789' : 'davčna št. v državi'} className={field} />
            </label>
          </div>
          <p className="text-xs text-ink-3">
            {country === 'SI'
              ? 'Slovenski izplačevalec: identifikacijska številka ni potrebna.'
              : 'Tuji izplačevalec: FURS zahteva številko, ki jo podjetje uporablja za davčne namene v svoji državi (v ZDA EIN).'}
          </p>
          {miss.length ? <p className="text-xs text-warn">Za XML še manjka: {miss.join(', ')}. Shraniš lahko tudi delno.</p> : null}
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
              {saving ? 'Shranjujem …' : 'Shrani'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
