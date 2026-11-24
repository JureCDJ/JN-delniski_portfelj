import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { isTopDialog, lockScroll } from './modal';

const MIN_LENGTH = 8;

/** Nastavitev ali sprememba gesla za prijavo (prijavljen uporabnik). */
export function PasswordForm({ email, onClose }: { email: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_LENGTH) return setError(`Geslo mora imeti vsaj ${MIN_LENGTH} znakov.`);
    if (pw !== pw2) return setError('Gesli se ne ujemata.');
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (err) {
      setError(
        /same.*password|different from the old/i.test(err.message)
          ? 'Novo geslo je enako trenutnemu.'
          : /weak|password should/i.test(err.message)
            ? `Geslo je prešibko: ${err.message}`
            : /reauthenticat/i.test(err.message)
              ? 'Za spremembo gesla se odjavi in znova prijavi, nato poskusi še enkrat.'
              : `Shranjevanje ni uspelo: ${err.message}`,
      );
      return;
    }
    setDone(true);
  }

  const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="password-title" className="text-lg font-semibold">
          Geslo za prijavo
        </h2>
        {done ? (
          <div role="status" className="mt-3 space-y-4">
            <p className="text-sm text-ink-2">
              Geslo je shranjeno. Na telefonu se v aplikaciji prijaviš z e-naslovom <strong>{email}</strong> in tem geslom.
            </p>
            <button type="button" onClick={onClose} className="min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-bg">
              Zapri
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-3 space-y-4">
            <p className="text-sm text-ink-2">
              Z geslom se prijaviš tudi v aplikaciji na začetnem zaslonu telefona. Vsaj {MIN_LENGTH} znakov; brskalnik ali
              iCloud Keychain ti ga lahko shrani.
            </p>
            {/* Skrito polje z e-naslovom: upravljalnik gesel shrani geslo k pravemu računu. */}
            <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
            <label className="block text-sm font-medium">
              Novo geslo
              <input
                ref={first}
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className={field}
              />
            </label>
            <label className="block text-sm font-medium">
              Ponovi geslo
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} />
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
              <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60">
                {saving ? 'Shranjujem …' : 'Shrani geslo'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
