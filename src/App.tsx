import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { loadPortfolio, saveManualTrade, type PortfolioData } from './data/repo';
import { demoInstruments, demoQuotes, demoTrades } from './demo/demoData';
import type { IsoDate } from './domain/dates';
import { supabase } from './lib/supabase';
import { Login } from './ui/Login';
import { Overview } from './ui/Overview';
import { TradeForm } from './ui/TradeForm';

export const APP_VERSION = 'v0.2';

/** Današnji koledarski datum v lokalnem času (ne prek toISOString). */
function localToday(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-2.5">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-8 w-8" />
        <h1 className="text-lg font-semibold">Portfelj</h1>
        <span className="num text-xs text-ink-3">{APP_VERSION}</span>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

const shell = 'mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12 sm:px-6';
const btnSecondary = 'min-h-11 whitespace-nowrap rounded-xl px-3 text-sm text-ink-2 hover:bg-surface-2';
const btnPrimary = 'min-h-11 whitespace-nowrap rounded-xl bg-ink px-4 text-sm font-semibold text-bg';

function Demo({ onExit }: { onExit: () => void }) {
  // Demo posli živijo samo v pomnilniku tega zavihka — nič se ne shrani v bazo.
  const [trades, setTrades] = useState(demoTrades);
  const [adding, setAdding] = useState(false);
  const closeForm = useCallback(() => setAdding(false), []);
  const today = localToday();
  return (
    <div className={shell}>
      <Header>
        <button type="button" onClick={() => setAdding(true)} className={btnPrimary}>
          <span aria-hidden="true">＋ </span>Dodaj<span className="hidden sm:inline"> posel</span>
        </button>
        <button type="button" onClick={onExit} className={btnSecondary}>
          Zapri demo
        </button>
      </Header>
      <div role="note" className="mt-2 rounded-xl bg-warn-bg px-4 py-2.5 text-sm text-warn">
        <strong>Demo podatki.</strong> Izmišljeni posli in tečaji samo za prikaz vmesnika. Kar dodaš tukaj, se ne shrani.
      </div>
      <Overview trades={trades} instruments={demoInstruments} quotes={demoQuotes} today={today} />
      {adding ? (
        <TradeForm
          today={today}
          instruments={demoInstruments}
          existingTrades={trades}
          onClose={closeForm}
          onSave={async (d) => {
            setTrades((t) => [...t, { ...d, id: `demo-${t.length + 1}`, accountId: 'demo' }]);
          }}
        />
      ) : null}
    </div>
  );
}

function Portfolio({ session }: { session: Session }) {
  const today = localToday();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      setData(await loadPortfolio());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const closeForm = useCallback(() => setAdding(false), []);

  return (
    <div className={shell}>
      <Header>
        <button type="button" onClick={() => setAdding(true)} disabled={!data} className={`${btnPrimary} disabled:opacity-50`}>
          <span aria-hidden="true">＋ </span>Dodaj<span className="hidden sm:inline"> posel</span>
        </button>
        <button type="button" onClick={() => void supabase.auth.signOut()} className={btnSecondary} title={session.user.email ?? ''}>
          Odjava
        </button>
      </Header>

      {loadError ? (
        <div role="alert" className="mt-6 rounded-xl bg-loss-bg px-4 py-3 text-sm text-loss">
          {loadError}{' '}
          <button type="button" onClick={() => void reload()} className="underline">
            Poskusi znova
          </button>
        </div>
      ) : !data ? (
        <p role="status" className="mt-10 text-center text-sm text-ink-3">
          Nalagam portfelj …
        </p>
      ) : (
        <Overview trades={data.trades} instruments={data.instruments} quotes={data.quotes} today={today} onAddTrade={() => setAdding(true)} />
      )}

      {adding && data ? (
        <TradeForm
          today={today}
          instruments={data.instruments}
          existingTrades={data.trades}
          onClose={closeForm}
          onSave={async (draft) => {
            await saveManualTrade(draft);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (demo) return <Demo onExit={() => setDemo(false)} />;
  if (session === undefined) return null;
  if (!session) return <Login onDemo={() => setDemo(true)} />;
  return <Portfolio session={session} />;
}
