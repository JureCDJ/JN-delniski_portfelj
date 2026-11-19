import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import {
  confirmTaxSettings,
  fetchBackup,
  loadPortfolio,
  refreshPrices,
  saveManualPrice,
  saveManualTrade,
  savePayer,
  savePriceSource,
  saveTarget,
  type PortfolioData,
} from './data/repo';
import {
  demoBrokers,
  demoDividends,
  demoFxRows,
  demoInstruments,
  demoPriceHistory,
  demoQuotes,
  demoTargets,
  demoTax,
  demoTrades,
  demoUsdRates,
} from './demo/demoData';
import type { IsoDate } from './domain/dates';
import { supabase } from './lib/supabase';
import { Charts } from './ui/Charts';
import { Login } from './ui/Login';
import { Overview } from './ui/Overview';
import { PriceForm } from './ui/PriceForm';
import { PayerForm } from './ui/PayerForm';
import { PriceSourceForm } from './ui/PriceSourceForm';
import { Reports } from './ui/Reports';
import { Taxes } from './ui/Taxes';
import type { Payer } from './domain/edavkiXml';
import { StockCard } from './ui/StockCard';
import { TargetForm } from './ui/TargetForm';
import { TradeForm } from './ui/TradeForm';

export const APP_VERSION = 'v0.8';

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

type Tab = 'pregled' | 'grafi' | 'davki' | 'izpisi';

function readTab(): Tab {
  try {
    const t = localStorage.getItem('portfelj.zavihek');
    return t === 'grafi' || t === 'davki' || t === 'izpisi' ? t : 'pregled';
  } catch {
    return 'pregled';
  }
}

function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const pick = (t: Tab) => {
    onChange(t);
    try {
      localStorage.setItem('portfelj.zavihek', t);
    } catch {
      /* zasebno okno */
    }
  };
  return (
    <nav aria-label="Pogledi" className="mt-4 flex gap-1 border-b border-line">
      {(
        [
          ['pregled', 'Pregled'],
          ['grafi', 'Grafi'],
          ['davki', 'Davki'],
          ['izpisi', 'Izpisi'],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          aria-current={value === k ? 'page' : undefined}
          onClick={() => pick(k)}
          className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-semibold ${value === k ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

const shell ='mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-12 sm:px-6';
const btnSecondary = 'min-h-11 whitespace-nowrap rounded-xl px-3 text-sm text-ink-2 hover:bg-surface-2';
const btnPrimary = 'min-h-11 whitespace-nowrap rounded-xl bg-ink px-4 text-sm font-semibold text-bg';

function Demo({ onExit }: { onExit: () => void }) {
  // Demo posli živijo samo v pomnilniku tega zavihka — nič se ne shrani v bazo.
  const [trades, setTrades] = useState(demoTrades);
  const [adding, setAdding] = useState(false);
  const closeForm = useCallback(() => setAdding(false), []);
  const [targets, setTargets] = useState(demoTargets);
  const [tab, setTab] = useState<Tab>(readTab);
  const [targeting, setTargeting] = useState<string | null>(null);
  const closeTarget = useCallback(() => setTargeting(null), []);
  const targetInst = demoInstruments.find((i) => i.isin === targeting);
  const targetQuote = demoQuotes.find((q) => q.isin === targeting);
  const today = localToday();
  const [card, setCard] = useState<string | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  const [selling, setSelling] = useState<string | null>(null);
  const closeSale = useCallback(() => setSelling(null), []);
  const [payers, setPayers] = useState(new Map<string, Payer>());
  const [editingPayer, setEditingPayer] = useState<string | null>(null);
  const closePayer = useCallback(() => setEditingPayer(null), []);
  const payerInst = demoInstruments.find((i) => i.isin === editingPayer);
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
      <Tabs value={tab} onChange={setTab} />
      {tab === 'izpisi' ? (
        <Reports
          trades={trades}
          instruments={demoInstruments}
          quotes={demoQuotes}
          dividends={demoDividends}
          targets={targets}
          tax={demoTax}
          today={today}
          onOpenTaxes={() => setTab('davki')}
        />
      ) : tab === 'davki' ? (
        <Taxes
          trades={trades}
          instruments={demoInstruments.map((i) => ({ ...i, payer: payers.get(i.isin) }))}
          dividends={demoDividends}
          tax={demoTax}
          today={today}
          onEditPayer={setEditingPayer}
        />
      ) : tab === 'grafi' ? (
        <Charts trades={trades} instruments={demoInstruments} quotes={demoQuotes} priceHistory={demoPriceHistory} fxRows={demoFxRows} today={today} />
      ) : (
        <Overview
          trades={trades}
          instruments={demoInstruments}
          quotes={demoQuotes}
          today={today}
          dividends={demoDividends}
          targets={targets}
          tax={demoTax}
          usdRates={demoUsdRates}
          onEditTarget={setTargeting}
          onOpen={setCard}
        />
      )}
      {payerInst ? (
        <PayerForm
          label={`${payerInst.symbol} ${payerInst.name}`}
          suggested={{ name: payerInst.name, country: payerInst.isin.slice(0, 2) }}
          current={payers.get(payerInst.isin) ?? { name: null, address: null, country: null, id: null }}
          onClose={closePayer}
          onSave={async (p) => {
            setPayers((m) => new Map(m).set(payerInst.isin, p));
          }}
        />
      ) : null}
      {card ? (
        <StockCard
          isin={card}
          instruments={demoInstruments}
          trades={trades}
          quotes={demoQuotes}
          dividends={demoDividends}
          targets={targets}
          tax={demoTax}
          priceHistory={demoPriceHistory}
          fxRows={demoFxRows}
          brokerByAccount={demoBrokers}
          today={today}
          onClose={closeCard}
          onSell={setSelling}
          onEditTarget={setTargeting}
        />
      ) : null}
      {targetInst ? (
        <TargetForm
          label={`${targetInst.symbol} ${targetInst.name}`}
          current={targets.get(targetInst.isin) ?? null}
          priceEur={targetQuote ? new Decimal(targetQuote.price).div(targetQuote.ratePerEur) : null}
          onClose={closeTarget}
          onSave={async (price) => {
            setTargets((m) => {
              const n = new Map(m);
              if (price) n.set(targetInst.isin, new Decimal(price));
              else n.delete(targetInst.isin);
              return n;
            });
          }}
        />
      ) : null}
      {adding || selling ? (
        <TradeForm
          today={today}
          instruments={demoInstruments}
          existingTrades={trades}
          initial={selling ? { type: 'PRODAJA', isin: selling } : undefined}
          taxSettings={demoTax.settings}
          onClose={selling ? closeSale : closeForm}
          onSave={async (d) => {
            setTrades((t) => [...t, { ...d, id: `demo-${t.length + 1}`, accountId: 'rocno' }]);
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
  const [pricing, setPricing] = useState<string | null>(null);
  const closePrice = useCallback(() => setPricing(null), []);
  const [refresh, setRefresh] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string; warn: boolean } | { kind: 'error'; text: string }
  >({ kind: 'idle' });

  async function onRefresh() {
    setRefresh({ kind: 'busy' });
    try {
      const r = await refreshPrices();
      await reload();
      const parts = [`Posodobljenih ${r.posodobljeno} / ${r.posodobljeno + r.napake.length}`];
      if (r.napake.length) parts.push(`brez cene: ${r.napake.map((n) => n.symbol).join(', ')}`);
      setRefresh({ kind: 'done', text: parts.join(' · '), warn: r.napake.length > 0 });
    } catch (e) {
      setRefresh({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const pricesToolbar = (
    <>
      {refresh.kind === 'done' || refresh.kind === 'error' ? (
        <span role="status" className={`text-xs ${refresh.kind === 'error' || refresh.warn ? 'text-warn' : 'text-gain'}`}>
          {refresh.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={refresh.kind === 'busy'}
        className="min-h-9 whitespace-nowrap rounded-lg border border-line px-3 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-60"
      >
        {refresh.kind === 'busy' ? 'Osvežujem …' : 'Osveži cene'}
      </button>
    </>
  );
  const pricingInst = pricing && data ? data.instruments.find((i) => i.isin === pricing) : undefined;
  const [targeting, setTargeting] = useState<string | null>(null);
  const closeTarget = useCallback(() => setTargeting(null), []);
  const targetInst = targeting && data ? data.instruments.find((i) => i.isin === targeting) : undefined;
  const [tab, setTab] = useState<Tab>(readTab);
  const [card, setCard] = useState<string | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  const [selling, setSelling] = useState<string | null>(null);
  const closeSale = useCallback(() => setSelling(null), []);
  const [sourcing, setSourcing] = useState<string | null>(null);
  const closeSource = useCallback(() => setSourcing(null), []);
  const sourceInst = sourcing && data ? data.instruments.find((i) => i.isin === sourcing) : undefined;
  const [editingPayer, setEditingPayer] = useState<string | null>(null);
  const closePayer = useCallback(() => setEditingPayer(null), []);
  const payerInst = editingPayer && data ? data.instruments.find((i) => i.isin === editingPayer) : undefined;
  const confirmTax =
    data?.tax
      ? () => {
          if (window.confirm('Potrjuješ, da si davčne stopnje preveril in veljajo za tvoj izračun?')) {
            void confirmTaxSettings(data.tax!.id).then(reload, (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
          }
        }
      : undefined;

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
        <>
        <Tabs value={tab} onChange={setTab} />
        {tab === 'izpisi' ? (
          <Reports
            trades={data.trades}
            instruments={data.instruments}
            quotes={data.quotes}
            dividends={data.dividends}
            targets={data.targets}
            tax={data.tax}
            today={today}
            onBackup={fetchBackup}
            onOpenTaxes={() => setTab('davki')}
          />
        ) : tab === 'davki' ? (
          <Taxes
            trades={data.trades}
            instruments={data.instruments}
            dividends={data.dividends}
            tax={data.tax}
            today={today}
            onEditPayer={setEditingPayer}
            onConfirmTax={confirmTax}
          />
        ) : tab === 'grafi' ? (
          <Charts
            trades={data.trades}
            instruments={data.instruments}
            quotes={data.quotes}
            priceHistory={data.priceHistory}
            fxRows={data.fxRows}
            today={today}
          />
        ) : (
        <Overview
          trades={data.trades}
          instruments={data.instruments}
          quotes={data.quotes}
          pricesDate={data.pricesDate}
          missingFx={data.missingFx}
          pricesToolbar={pricesToolbar}
          today={today}
          dividends={data.dividends}
          targets={data.targets}
          tax={data.tax}
          usdRates={data.usdRates}
          onAddTrade={() => setAdding(true)}
          onManualPrice={setPricing}
          onEditTarget={setTargeting}
          onOpen={setCard}
          onConfirmTax={confirmTax}
        />
        )}
        </>
      )}

      {card && data ? (
        <StockCard
          isin={card}
          instruments={data.instruments}
          trades={data.trades}
          quotes={data.quotes}
          dividends={data.dividends}
          targets={data.targets}
          tax={data.tax}
          priceHistory={data.priceHistory}
          fxRows={data.fxRows}
          brokerByAccount={data.brokerByAccount}
          today={today}
          onClose={closeCard}
          onSell={setSelling}
          onEditTarget={setTargeting}
          onEditPriceSource={setSourcing}
          onManualPrice={setPricing}
        />
      ) : null}

      {payerInst ? (
        <PayerForm
          label={`${payerInst.symbol} ${payerInst.name}`}
          suggested={{ name: payerInst.name, country: payerInst.isin.slice(0, 2) }}
          current={payerInst.payer}
          onClose={closePayer}
          onSave={async (p) => {
            await savePayer(payerInst.id, p);
            await reload();
          }}
        />
      ) : null}

      {sourceInst ? (
        <PriceSourceForm
          label={`${sourceInst.symbol} ${sourceInst.name}`}
          current={
            sourceInst.priceSource === 'YAHOO' && sourceInst.priceSymbol
              ? { kind: 'YAHOO', symbol: sourceInst.priceSymbol, currency: sourceInst.priceCurrency ?? 'EUR' }
              : { kind: 'ROCNO' }
          }
          onClose={closeSource}
          onSave={async (src) => {
            await savePriceSource(sourceInst.id, src);
            if (src.kind === 'ROCNO') return reload();
            // Takoj preveri simbol: osveži cene in poglej, ali je Yahoo za ta papir vrnil ceno.
            const r = await refreshPrices();
            await reload();
            const bad = r.napake.find((n) => n.symbol === sourceInst.symbol || n.symbol === src.symbol);
            if (bad) throw new Error(`Vir je shranjen, a Yahoo za ${src.symbol} ni vrnil cene (${bad.reason}). Preveri simbol in valuto.`);
          }}
        />
      ) : null}

      {targetInst && data ? (
        <TargetForm
          label={`${targetInst.symbol} ${targetInst.name}`}
          current={data.targets.get(targetInst.isin) ?? null}
          priceEur={(() => {
            const q = data.quotes.find((x) => x.isin === targetInst.isin);
            return q ? new Decimal(q.price).div(q.ratePerEur) : null;
          })()}
          onClose={closeTarget}
          onSave={async (price) => {
            await saveTarget(targetInst.id, price);
            await reload();
          }}
        />
      ) : null}

      {pricingInst ? (
        <PriceForm
          label={`${pricingInst.symbol} ${pricingInst.name}`}
          today={today}
          onClose={closePrice}
          onSave={async (date, price) => {
            await saveManualPrice(pricingInst.id, date, price);
            await reload();
          }}
        />
      ) : null}

      {(adding || selling) && data ? (
        <TradeForm
          today={today}
          instruments={data.instruments}
          existingTrades={data.trades}
          initial={selling ? { type: 'PRODAJA', isin: selling } : undefined}
          taxSettings={data.tax?.settings ?? null}
          onClose={selling ? closeSale : closeForm}
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
