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
        <div role="status" className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <p className="font-medium">Preveri e-pošto</p>
          <p className="mt-1 text-sm text-ink-2">
            Na <strong>{state.email}</strong> sva poslala povezavo za prijavo. Odpri jo na tej napravi.
          </p>
          <button type="button" className="mt-4 text-sm text-accent underline" onClick={() => setState({ kind: 'idle' })}>
            Pošlji znova
          </button>
        </div>
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
            {state.kind === 'sending' ? 'Pošiljam …' : 'Pošlji povezavo za prijavo'}
          </button>
        </form>
      )}

      <button type="button" onClick={onDemo} className="mt-8 text-sm text-ink-3 underline">
        Poglej demo z izmišljenimi podatki
      </button>
    </div>
  );
}
