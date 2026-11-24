import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

export function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setState({ kind: 'error', message: 'Vpiši veljaven e-naslov.' });
      return;
    }
    setState({ kind: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) {
      const message = /rate limit/i.test(error.message)
        ? 'Preveč poskusov v kratkem času. Počakaj nekaj minut in poskusi znova.'
        : /signups not allowed/i.test(error.message)
          ? 'Ta e-naslov nima dostopa do aplikacije.'
          : `Pošiljanje ni uspelo: ${error.message}`;
      setState({ kind: 'error', message });
      return;
    }
    setState({ kind: 'sent', email: value });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-12 w-12" />
      <h1 className="mt-6 text-2xl font-semibold">Portfelj</h1>

      {state.kind === 'sent' ? (
        <CodeForm email={state.email} onBack={() => setState({ kind: 'idle' })} />
      ) : (
        <form onSubmit={submit} noValidate className="mt-6">
          <label htmlFor="email" className="text-sm font-medium">
            E-naslov
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={state.kind === 'error'}
            aria-describedby={state.kind === 'error' ? 'login-error' : undefined}
            className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base"
          />
          {state.kind === 'error' ? (
            <p id="login-error" role="alert" className="mt-2 text-sm text-loss">
              {state.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={state.kind === 'sending'}
            className="mt-4 min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {state.kind === 'sending' ? 'Pošiljam …' : 'Pošlji kodo za prijavo'}
          </button>
        </form>
      )}

      <button type="button" onClick={onDemo} className="mt-8 text-sm text-ink-3 underline">
        Poglej demo z izmišljenimi podatki
      </button>
    </div>
  );
}

/**
 * Prijava s kodo iz e-pošte. Na iPhonu se povezava iz e-pošte odpre v Safariju, ne v aplikaciji na
 * začetnem zaslonu (ta ima ločen pomnilnik) — zato je koda edini zanesljiv način prijave tam.
 */
function CodeForm({ email, onBack }: { email: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: FormEvent) {
    e.preventDefault();
    const token = code.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      setError('Koda ima samo števke (običajno 6). Prepiši jo iz e-pošte.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    setBusy(false);
    if (err) {
      setError(
        /expired|invalid/i.test(err.message)
          ? 'Koda ni pravilna ali je potekla. Preveri jo ali pošlji novo.'
          : `Prijava ni uspela: ${err.message}`,
      );
    }
    // Ob uspehu App sam zazna novo sejo (onAuthStateChange) in prikaže portfelj.
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <p role="status" className="font-medium">
        Preveri e-pošto
      </p>
      <p className="mt-1 text-sm text-ink-2">
        Na <strong>{email}</strong> sva poslala kodo za prijavo. Vpiši jo spodaj — ali odpri povezavo iz
        sporočila na tej napravi.
      </p>
      <form onSubmit={verify} noValidate className="mt-4">
        <label htmlFor="code" className="text-sm font-medium">
          Koda iz e-pošte
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? 'code-error' : undefined}
          className="mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-bg px-3.5 text-center text-lg tracking-[0.3em] tabular-nums"
        />
        {error ? (
          <p id="code-error" role="alert" className="mt-2 text-sm text-loss">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {busy ? 'Preverjam …' : 'Prijava'}
        </button>
      </form>
      <button type="button" className="mt-4 text-sm text-accent underline" onClick={onBack}>
        Pošlji znova
      </button>
    </div>
  );
}
