# JN Delniški portfelj — specifikacija v1

Status: **osnutek za potrditev** · 18.11.2026

## 1. Problem in uporabnik (G0)

| | |
|---|---|
| Problem | Podatki so razpršeni (IBKR, N26, nakupni listi); ni celovitega pregleda; davčna napoved se pripravlja ročno |
| Uporabnik | En sam lastnik portfelja (Jure). Osebni finančni podatki → dostop samo lastnik |
| Naprave | Mac (brskalnik) in iPhone (nameščena PWA) |
| Pogostost | Dnevni pogled na telefonu; tedenski uvozi; letno davčna napoved |
| Instrumenti | Zdaj delnice; kmalu ETF-i |
| Izven v1 | Oddajanje naročil/trgovanje, priporočila za nakup/prodajo, kripto, obveznice, več uporabnikov |

## 2. Arhitektura (ADR-001)

**Odločitev:** spletna aplikacija (PWA) + Supabase. Alternativa (Apps Script + Google Sheet, kot
CDJ) je bila zavrnjena zaradi hitrosti, izkušnje na telefonu, delovanja brez povezave in
omejitev oblikovanja.

```
src/ (React 19 + TypeScript + Tailwind 4, Vite, PWA)
  │  supabase-js (prijava + branje/pisanje, zaščiteno z RLS)
  ▼
Supabase (EU, Irska — eu-west-1)
  ├─ Postgres: tabele + Row Level Security (vsak zapis pripada user_id)
  ├─ Auth: prijava z e-poštno povezavo; registracija zaklenjena po prvi prijavi
  ├─ Edge Functions: ibkr-sync, prices-sync, fx-sync (skrivnosti v Supabase Secrets)
  └─ pg_cron: dnevni zagon sinhronizacij
GitHub Actions → GitHub Pages (objava frontenda)
```

- **Poslovna logika** (FIFO, donosi, davki, razčlenjevanje uvozov) je v `src/domain/` — čiste
  funkcije brez UI in brez baze, v celoti pokrite s testi. Enaka vloga kot `domain.js` v CDJ.
- **Denarni zneski:** v bazi `numeric`, v kodi `decimal.js` — nikoli navadni `number` za denar.
- **Shema baze:** samo prek migracij v `supabase/migrations/` (repozitorij je edini vir resnice).
- Ključ `anon`/publishable in URL projekta sta javna po zasnovi; varnost zagotavlja RLS.
  Ključ `service_role`, geslo baze in žeton IBKR nikoli v repozitoriju.

## 3. Podatkovni model (osnutek)

| Tabela | Namen | Ključna polja |
|---|---|---|
| `accounts` | Računi pri posrednikih | `broker` (IBKR/N26/ROCNO), `base_currency`, `name` |
| `instruments` | Vrednostni papirji | `isin` (unikaten), `symbol`, `exchange`, `currency`, `type` (DELNICA/ETF), `name`, `country` |
| `transactions` | Vsi dogodki na računu | `account_id`, `instrument_id`, `type`, `trade_date`, `settle_date`, `quantity`, `price`, `currency`, `amount`, `fee`, `source`, `source_ref`, `raw` |
| `imports` | Dnevnik uvozov | `source`, `file_hash`, `status`, `rows_new`, `rows_duplicate`, `rows_error` |
| `prices` | Dnevni tečaji instrumentov | `instrument_id`, `date`, `close` |
| `fx_rates` | Referenčni tečaji | `date`, `currency`, `rate_per_eur`, `source` (ECB/BS) |
| `tax_settings` | Davčni parametri | `valid_from`, stopnje po letih imetja, normirani stroški — **vnos/potrditev uporabnika** |

`transactions.type`: `NAKUP`, `PRODAJA`, `DIVIDENDA`, `DAVEK_TUJINA`, `PROVIZIJA`, `POLOG`,
`DVIG`, `MENJAVA`, `RAZDELITEV` (split), `OBRESTI`.

**Idempotentnost:** unikaten ključ `(account_id, source, source_ref)` — ponovni uvoz iste
datoteke ne ustvari dvojnikov. Uvoz datoteke z istim `file_hash` uporabnika opozori.

**Lote (FIFO)** se ne shranjujejo, ampak izračunajo iz transakcij v `src/domain/` — tako ni
neskladja med shranjenimi lotami in transakcijami.

## 4. Uporabniške zgodbe v1

| REQ | Zgodba | Sprejemni kriterij |
|---|---|---|
| REQ-01 | Kot lastnik se prijavim samo jaz | Prijava z e-poštno povezavo; drug račun ne vidi nobenega zapisa (test RLS) |
| REQ-02 | Ročno vnesem nakup/prodajo | Validacija: količina > 0, datum ≤ danes, valuta; pozicija se takoj posodobi |
| REQ-03 | Vidim pregled portfelja | Skupna vrednost v EUR, dnevna sprememba, nerealiziran in realiziran donos, seznam pozicij |
| REQ-04 | Uvozim podatke iz IBKR | Flex Query: nakupi, prodaje, dividende, tuji davek, provizije; ponovni uvoz = 0 novih vrstic |
| REQ-05 | Tečaji in valute se posodobijo sami | Dnevni zagon; zadnji tečaj in datum vidna pri poziciji |
| REQ-06 | Pripravim Doh-Div | Za izbrano leto: dividende po izplačevalcu in državi, bruto v EUR, tuji davek; izvoz XML za eDavki |
| REQ-07 | Pripravim Doh-KDVP | FIFO po ISIN, nabavna in odsvojitvena vrednost v EUR na dan posla, leta imetja; izvoz XML za eDavki |
| REQ-08 | Uvozim N26 izpisek in nakupni list (PDF) | Predogled razbranih podatkov → potrditev → shranjevanje |

## 5. Davki — pravila in odprta vprašanja

Podatki pripravljajo napoved; odgovornost za oddajo je lastnikova.

**Preveriti pred prvo pravo oddajo (pri FURS / davčnem svetovalcu) — ne sme biti trdo v kodi:**
- veljavne stopnje davka od dobička glede na leta imetja,
- normirani stroški pri odsvojitvi vrednostnih papirjev,
- kateri referenčni tečaj velja za preračun (Banka Slovenije / ECB) in na kateri datum (dan posla),
- rok oddaje Doh-KDVP in Doh-Div,
- uveljavljanje tujega davka (npr. ZDA 15 % z W-8BEN) in potrebna dokazila,
- obravnava razdelitev (split), prenosov med posredniki, menjav valut,
- trenutna shema XML za eDavki (Doh-KDVP, Doh-Div).

## 6. Zasloni (osnutek)

1. **Pregled** — KPI (vrednost, sprememba danes, donos skupaj, dividende letos), seznam pozicij.
2. **Pozicija** — graf, lote z datumom in letom imetja (kdaj preide v nižji davčni razred), dividende.
3. **Transakcije** — iskanje in filtri; ročni vnos.
4. **Uvoz** — IBKR, N26, PDF; predogled → potrditev; dnevnik uvozov.
5. **Davki** — izbor leta → pregled → izvoz XML.
6. **Nastavitve** — računi, davčni parametri, izvoz varnostne kopije.

Telefon: spodnja navigacija (Pregled, Transakcije, Uvoz, Davki). Formati sl-SI: `1.234,56 €`,
`DD.MM.YYYY`. Svetla in temna tema.

## 7. Vrstni red gradnje (navpične rezine)

1. Osnova: projekt, testi, prijava, shema baze, ročni vnos → seznam pozicij (REQ-01–03).
2. Uvoz IBKR (REQ-04).
3. Tečaji in valute (REQ-05).
4. Dividende in Doh-Div (REQ-06).
5. FIFO in Doh-KDVP (REQ-07).
6. N26 in PDF (REQ-08).
7. Dodelava videza, grafi, mobilni pogled, PWA brez povezave.
