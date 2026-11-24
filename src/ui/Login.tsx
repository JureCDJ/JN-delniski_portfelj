import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// Prijava z e-naslovom in geslom (deluje tudi v aplikaciji na začetnem zaslonu iPhona, ki ima ločen
// pomnilnik od Safarija — povezava iz e-pošte bi se odprla v Safariju). Povezava po e-pošti ostane
// kot rezervna pot: z njo se prijaviš, ko gesla še nimaš ali si ga pozabil, in ga nato nastaviš.

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string; field: 'email' | 'password' | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  function checkEmail(): string | null {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setState({ kind: 'error', message: 'Vpiši veljaven e-naslov.', field: 'email' });
      return null;
    }
    return value;
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    const value = checkEmail();
    if (!value) return;
    if (!password) {
      setState({ kind: 'error', message: 'Vpiši geslo.', field: 'password' });
      return;
    }
    setState({ kind: 'busy' });
    const { error } = await supabase.auth.signInWithPassword({ email: value, password });
    if (error) {
      setState({
        kind: 'error',
        field: 'password',
        message: /invalid login credentials/i.test(error.message)
          ? 'E-naslov ali geslo ni pravilno. Če gesla še nimaš, spodaj pošlji povezavo po e-pošti in ga nato nastavi pod »Geslo«.'
          : /rate limit|too many/i.test(error.message)
            ? 'Preveč poskusov v kratkem času. Počakaj nekaj minut in poskusi znova.'
            : `Prijava ni uspela: ${error.message}`,
      });
    }
    // Ob uspehu App sam zazna novo sejo (onAuthStateChange) in prikaže portfelj.
  }

  async function sendLink() {
    const value = checkEmail();
    if (!value) return;
    setState({ kind: 'busy' });
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
      setState({ kind: 'error', message, field: 'email' });
      return;
    }
    setState({ kind: 'sent', email: value });
  }

  const err = state.kind === 'error' ? state : null;
  const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base';

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-12 w-12" />
      <h1 className="mt-6 text-2xl font-semibold">Portfelj</h1>

      {state.kind === 'sent' ? (
        <div role="status" className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <p className="font-medium">Preveri e-pošto</p>
          <p className="mt-1 text-sm text-ink-2">
            Na <strong>{state.email}</strong> sva poslala povezavo za prijavo. Odpri jo na tej napravi (na iPhonu v
            Safariju), nato si pod <strong>Geslo</strong> nastavi geslo za prijavo v aplikaciji.
          </p>
          <button type="button" className="mt-4 text-sm text-accent underline" onClick={() => setState({ kind: 'idle' })}>
            Nazaj
          </button>
        </div>
      ) : (
        <form onSubmit={signIn} noValidate className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            E-naslov
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={err?.field === 'email'}
              aria-describedby={err ? 'login-error' : undefined}
              className={field}
            />
          </label>
          <label className="block text-sm font-medium">
            Geslo
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={err?.field === 'password'}
              aria-describedby={err ? 'login-error' : undefined}
              className={field}
            />
          </label>
          {err ? (
            <p id="login-error" role="alert" className="text-sm text-loss">
              {err.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={state.kind === 'busy'}
            className="min-h-11 w-full rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {state.kind === 'busy' ? 'Prijavljam …' : 'Prijava'}
          </button>
          <button
            type="button"
            onClick={() => void sendLink()}
            disabled={state.kind === 'busy'}
            className="min-h-11 w-full rounded-xl px-4 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-60"
          >
            Nimaš gesla? Pošlji povezavo po e-pošti
          </button>
        </form>
      )}

      <button type="button" onClick={onDemo} className="mt-8 text-sm text-ink-3 underline">
        Poglej demo z izmišljenimi podatki
      </button>
    </div>
  );
}
