# JN Delniški portfelj — navodila za Claude Code

Osebna aplikacija za spremljanje delniškega portfelja (delnice, kasneje ETF-i), uvoz iz IBKR, N26
in nakupnih listov ter pripravo davčnih napovedi Doh-KDVP in Doh-Div.

Uporabnik komunicira v **slovenščini**; odgovarjaj v slovenščini. Lastnik ni razvijalec —
razloži, *kaj* se je spremenilo in *zakaj*. Specifikacija: `docs/SPEC.md`. Koraki, ki jih
opravi uporabnik sam: `docs/NASTAVITEV.md`.

## Arhitektura

React 19 + TypeScript + Tailwind 4 (Vite, PWA) → GitHub Pages. Zaledje: Supabase (Postgres + RLS,
Auth, Edge Functions, pg_cron), regija Frankfurt.

## ⛔ Trda pravila

1. **Izguba ali tiha sprememba finančnih podatkov je najhujša možna napaka.** Uvozi so
   idempotentni (`account_id, source, source_ref`); nič se ne briše brez potrditve.
2. **Denar nikoli kot `number`.** V bazi `numeric`, v kodi `decimal.js`. Zaokroževanje samo ob
   prikazu in na mestih, ki jih predpisuje davčni obrazec.
3. **Poslovna logika samo v `src/domain/`** — čiste funkcije, brez UI in baze, pokrite s testi.
4. **Shema baze samo prek migracij** v `supabase/migrations/`. Nikoli ročne spremembe v
   nadzorni plošči, ki jih ni v repozitoriju.
5. **Vsaka tabela ima RLS** z `user_id = auth.uid()`. Nova tabela brez RLS ne sme v produkcijo.
   Ta projekt Supabase **ne dodeli pravic samodejno** — vsaka nova tabela potrebuje tudi
   `grant select, insert, update, delete … to authenticated` (sicer »permission denied«;
   že se je zgodilo). Preveri s `has_table_privilege('authenticated', …)`. Enako velja za
   `service_role` (Edge Function ob dnevnem klicu) — tudi ta potrebuje izrecen `grant`.
6. **Skrivnosti nikoli v repozitoriju** (repozitorij je javen): ključ `service_role`, geslo baze,
   žeton IBKR. Edge Functions jih berejo iz Supabase Secrets. Uporabnik jih vpiše sam.
7. **Davčne stopnje in pravila niso trdo v kodi** — so v `tax_settings` in jih potrdi uporabnik.
   Ne trdi, kaj je trenutno veljavno, brez preverjenega vira.
8. **Datumi:** datum posla je koledarski datum (brez časovnega pasu). Ne pretvarjaj prek
   `toISOString()` — premakne datum.
9. **Aplikacija nikoli ne oddaja naročil** pri posrednikih — samo bere.
