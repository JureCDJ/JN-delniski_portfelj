// Enkratni uvoz iz tabele »JN Delnice«: predogled in priprava SQL.
// Bere samo iz mape uvozi/ (ni v Gitu). V bazo NE piše — ustvari uvozi/uvoz-tabela.sql,
// ki se izvede šele po lastnikovi potrditvi predogleda.
//
// Zagon: npm run uvoz:tabela
import { readFileSync, writeFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { buildSheetTrades, parseCsv, parseIsinMap, type SheetTrade } from '../src/domain/importSheet';
import { buildLedger, buildPositions } from '../src/domain/portfolio';
import { formatDateSl } from '../src/domain/dates';

const DIR = 'uvozi';
const read = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

const purchases = parseCsv(read('JN Delnice - DELNICE.csv'));
const sales = parseCsv(read('JN Delnice - PRODAJE.csv'));
const isinMap = parseIsinMap(read('isin-preslikava.csv'));
const { trades, skipped } = buildSheetTrades(purchases, sales, isinMap);

const eur = (d: Decimal) =>
  new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(
    d.toDecimalPlaces(2).toNumber(),
  );
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.plus(x), new Decimal(0));

console.log(`Vrstic v tabeli: ${purchases.length} nakupov, ${sales.length} prodaj`);
console.log(`Pripravljenih poslov: ${trades.length}  ·  izpuščenih: ${skipped.length}`);
for (const s of skipped) console.log(`  ⚠ ${s.ref}: ${s.reason}`);

const { disposals } = buildLedger(trades);
const positions = buildPositions(trades, []);
const open = positions.filter((p) => p.quantity.gt(0));
const names = new Map(trades.map((t) => [t.isin, `${t.ticker} ${t.name}`]));

console.log('\n— Kontrolne vsote —');
console.log(`Nakupi skupaj (tabela):     ${eur(sum(trades.filter((t) => t.type === 'NAKUP').map((t) => new Decimal(t.totalEur))))}`);
console.log(`Prodaje skupaj (tabela):    ${eur(sum(trades.filter((t) => t.type === 'PRODAJA').map((t) => new Decimal(t.totalEur))))}`);
const sheetGain = sum(sales.map((r) => new Decimal((r['Dobiček/izguba (€)'] ?? '0').replace(/€|\s| /g, '').replace('−', '-').replace(/\./g, '').replace(',', '.'))));
const appGain = sum(disposals.map((d) => d.gainEur));
console.log(`Realiziran dobiček — tabela: ${eur(sheetGain)}  ·  aplikacija (FIFO): ${eur(appGain)}  ·  razlika ${eur(appGain.minus(sheetGain))}`);
console.log(`Odprte pozicije: ${open.length}  ·  nabavna vrednost ${eur(sum(open.map((p) => p.costEur)))}`);

console.log('\n— Odprte pozicije —');
for (const p of open.sort((a, b) => b.costEur.cmp(a.costEur))) {
  console.log(`  ${(names.get(p.isin) ?? p.isin).padEnd(34)} ${p.isin}  ${p.quantity.toString().padStart(10)} kos  ${eur(p.costEur).padStart(12)}`);
}
console.log('\n— Zaprte prodaje (FIFO) —');
for (const d of disposals) {
  console.log(`  ${formatDateSl(d.sellDate)} ${(names.get(d.isin) ?? d.isin).padEnd(30)} ${d.quantity.toString().padStart(8)} kos  nakup ${formatDateSl(d.buyDate)}  dobiček ${eur(d.gainEur).padStart(11)}  let ${d.holdingYears}`);
}

// ---------- SQL (izvede se šele po potrditvi) ----------
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const instruments = new Map<string, SheetTrade>();
for (const t of trades) if (!instruments.has(t.isin)) instruments.set(t.isin, t);

const sql = `-- Uvoz iz tabele »JN Delnice« · ${trades.length} poslov · ustvarjeno ${new Date().toISOString()}
-- Idempotentno: ponovni zagon ne ustvari dvojnikov (account_id, source, source_ref).
begin;
-- Aplikacija ima enega samega uporabnika (registracija zaklenjena); če jih je več, se uvoz ustavi.
create temp table _u on commit drop as
  select id as user_id from auth.users;
do $$ begin
  if (select count(*) from _u) <> 1 then raise exception 'Pričakovan je natanko en uporabnik'; end if;
end $$;

insert into public.accounts (user_id, broker, name)
select u.user_id, b.broker::public.broker, b.name from _u u,
  (values ('N26', 'N26'), ('IBKR', 'Interactive Brokers')) as b(broker, name)
where not exists (select 1 from public.accounts a where a.user_id = u.user_id and a.broker = b.broker::public.broker);

insert into public.instruments (user_id, isin, symbol, name, currency, country)
select u.user_id, i.isin, i.symbol, i.name, 'EUR', left(i.isin, 2) from _u u, (values
${[...instruments.values()].map((t) => `  (${q(t.isin)}, ${q(t.ticker)}, ${q(t.name)})`).join(',\n')}
) as i(isin, symbol, name)
on conflict (user_id, isin) do nothing;

insert into public.transactions
  (user_id, account_id, instrument_id, type, trade_date, quantity, price, amount, fee, currency, rate_per_eur, source, source_ref, raw, note)
select u.user_id, a.id, ins.id, x.type::public.tx_type, x.d::date, x.q::numeric, x.p::numeric, x.amt::numeric, 0, 'EUR', 1,
       'TABELA', x.ref, jsonb_build_object('izvirna_valuta', x.cur), x.note
from _u u
join (values
${trades
  .map(
    (t) =>
      `  (${q(t.broker)}, ${q(t.isin)}, ${q(t.type)}, ${q(t.date)}, ${q(t.quantity)}, ${q(t.price)}, ${q(t.totalEur)}, ${q(t.sourceRef)}, ${q(t.originalCurrency)}, ${q(t.originalCurrency !== 'EUR' ? `Posel v ${t.originalCurrency}; znesek v EUR iz tabele` : null)})`,
  )
  .join(',\n')}
) as x(broker, isin, type, d, q, p, amt, ref, cur, note) on true
join public.accounts a on a.user_id = u.user_id and a.broker = x.broker::public.broker
join public.instruments ins on ins.user_id = u.user_id and ins.isin = x.isin
on conflict (account_id, source, source_ref) do nothing;

commit;
`;
writeFileSync(`${DIR}/uvoz-tabela.sql`, sql);
console.log(`\nSQL pripravljen: ${DIR}/uvoz-tabela.sql (še NI izveden)`);
