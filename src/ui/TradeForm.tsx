import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDateSl, type IsoDate } from '../domain/dates';
import { buildLedger } from '../domain/portfolio';
import type { Instrument, Trade } from '../domain/types';
import { validateTradeInput, type FieldErrors, type TradeDraft, type TradeInput } from '../domain/validation';
import { fetchEcbRate } from '../lib/fx';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'DKK', 'SEK', 'NOK', 'PLN', 'CZK', 'HUF', 'CAD', 'JPY'];

interface Props {
  today: IsoDate;
  instruments: Instrument[];
  existingTrades: Trade[];
  onSave: (draft: TradeDraft) => Promise<void>;
  onClose: () => void;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm text-loss">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const inputCls =
  'block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base aria-[invalid=true]:border-loss disabled:bg-surface-2 disabled:text-ink-3';

export function TradeForm({ today, instruments, existingTrades, onSave, onClose }: Props) {
  const [v, setV] = useState<TradeInput>({
    type: 'NAKUP',
    isin: '',
    symbol: '',
    name: '',
    date: today,
    quantity: '',
    price: '',
    fee: '',
    currency: 'EUR',
    ratePerEur: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rateInfo, setRateInfo] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const known = instruments.find((i) => i.isin === v.isin.trim().toUpperCase());

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Znan instrument: prevzemi simbol, ime in valuto.
  useEffect(() => {
    if (known) setV((s) => ({ ...s, symbol: known.symbol, name: known.name, currency: known.currency }));
  }, [known]);

  // Tečaj ECB za tujo valuto na dan posla.
  useEffect(() => {
    if (v.currency === 'EUR' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      setRateInfo(null);
      return;
    }
    let cancelled = false;
    setRateInfo('Pridobivam tečaj ECB …');
    fetchEcbRate(v.date, v.currency)
      .then((r) => {
        if (cancelled) return;
        setV((s) => ({ ...s, ratePerEur: r.ratePerEur.replace('.', ',') }));
        setRateInfo(
          `Referenčni tečaj ECB z dne ${formatDateSl(r.rateDate)}${r.rateDate !== v.date ? ' (zadnji objavljen pred datumom posla)' : ''}. Lahko ga popraviš.`,
        );
      })
      .catch((e: unknown) => !cancelled && setRateInfo(`${e instanceof Error ? e.message : 'Napaka'} Vpiši tečaj ročno.`));
    return () => {
      cancelled = true;
    };
  }, [v.currency, v.date]);

  const set = (k: keyof TradeInput) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const r = validateTradeInput(v, today);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    // Prodaja ne sme preseči količine v lasti — preveri z isto logiko kot izračun portfelja.
    try {
      buildLedger([
        ...existingTrades,
        { ...r.draft, id: 'nov', accountId: 'nov' },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^Posel nov: /, '') : String(err);
      setFormError(msg.charAt(0).toUpperCase() + msg.slice(1));
      return;
    }
    setSaving(true);
    try {
      await onSave(r.draft);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const err = (k: keyof TradeInput) => ({
    'aria-invalid': Boolean(errors[k]),
    'aria-describedby': errors[k] ? `${k}-err` : undefined,
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-bg pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-5 py-4">
          <h2 id="trade-title" className="text-lg font-semibold">
            Nov posel
          </h2>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-ink-2">
            Prekliči
          </button>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4 px-5 pt-4">
          <fieldset>
            <legend className="sr-only">Vrsta posla</legend>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {(['NAKUP', 'PRODAJA'] as const).map((t) => (
                <label
                  key={t}
                  className={`flex min-h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${v.type === t ? 'bg-surface shadow-sm' : 'text-ink-3'}`}
                >
                  <input type="radio" name="type" value={t} checked={v.type === t} onChange={() => setV((s) => ({ ...s, type: t }))} className="sr-only" />
                  {t === 'NAKUP' ? 'Nakup' : 'Prodaja'}
                </label>
              ))}
            </div>
          </fieldset>

          <Field id="isin" label="ISIN" error={errors.isin} hint={known ? `Znan instrument: ${known.name}` : 'Najdeš ga na nakupnem listu ali v aplikaciji posrednika.'}>
            <input id="isin" ref={firstField} value={v.isin} onChange={set('isin')} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="US0378331005" className={`${inputCls} uppercase`} {...err('isin')} />
          </Field>

          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field id="symbol" label="Simbol">
              <input id="symbol" value={v.symbol} onChange={set('symbol')} disabled={Boolean(known)} autoCapitalize="characters" placeholder="AAPL" className={`${inputCls} uppercase`} />
            </Field>
            <Field id="name" label="Ime" error={errors.name}>
              <input id="name" value={v.name} onChange={set('name')} disabled={Boolean(known)} placeholder="Apple Inc." className={inputCls} {...err('name')} />
            </Field>
          </div>

          <Field id="date" label="Datum posla" error={errors.date}>
            <input id="date" type="date" max={today} value={v.date} onChange={set('date')} className={inputCls} {...err('date')} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="quantity" label="Količina" error={errors.quantity}>
              <input id="quantity" inputMode="decimal" value={v.quantity} onChange={set('quantity')} placeholder="10" className={`${inputCls} num`} {...err('quantity')} />
            </Field>
            <Field id="price" label="Cena na enoto" error={errors.price}>
              <input id="price" inputMode="decimal" value={v.price} onChange={set('price')} placeholder="0,00" className={`${inputCls} num`} {...err('price')} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="currency" label="Valuta" error={errors.currency}>
              <select id="currency" value={v.currency} onChange={set('currency')} disabled={Boolean(known)} className={inputCls}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field id="fee" label={`Provizija (${v.currency})`} error={errors.fee}>
              <input id="fee" inputMode="decimal" value={v.fee} onChange={set('fee')} placeholder="0,00" className={`${inputCls} num`} {...err('fee')} />
            </Field>
          </div>

          {v.currency !== 'EUR' ? (
            <Field id="ratePerEur" label={`Tečaj: ${v.currency} za 1 EUR`} error={errors.ratePerEur} hint={rateInfo}>
              <input id="ratePerEur" inputMode="decimal" value={v.ratePerEur} onChange={set('ratePerEur')} className={`${inputCls} num`} {...err('ratePerEur')} />
            </Field>
          ) : null}

          {formError ? (
            <p role="alert" className="rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
              {formError}
            </p>
          ) : null}

          <button type="submit" disabled={saving} className="min-h-12 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60">
            {saving ? 'Shranjujem …' : v.type === 'NAKUP' ? 'Shrani nakup' : 'Shrani prodajo'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
