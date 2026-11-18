# Nastavitev — koraki, ki jih opraviš sam

Te korake opraviš ti, ker zahtevajo tvoje geslo, prijavo ali račun. Vse ostalo (koda, baza,
objava) naredi Claude. Ko končaš korak, ga odkljukaj in Claudu napiši »korak N narejen«.

> **Nikoli ne pošiljaj Claudu (ne v klepet ne v datoteke):** gesla za Mac, gesla baze Supabase,
> ključa `service_role` / `secret`, žetona IBKR. Te vrednosti vpišeš sam v terminal ali v
> nadzorno ploščo, ko te Claude na to opozori.

---

## Korak 1 — Homebrew (upravitelj programov za Mac)

- [ ] V terminalu že teče namestitev. Vpiši **geslo za Mac** (znaki se ne izpisujejo) → Enter.
- [ ] Ko vpraša, pritisni **Enter** za potrditev. Počakaj nekaj minut.
- [ ] Ko konča, zaženi (vsak ukaz posebej):

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## Korak 2 — Orodja za razvoj

```bash
brew install node gh
```

- `node` — gradnja aplikacije (Vite, React)
- `gh` — povezava z GitHubom
- orodje `supabase` je nameščeno v projektu (`npx supabase …`), ker namestitev prek Homebrew
  zahteva novejša Applova razvijalska orodja

## Korak 3 — Prijava v GitHub

```bash
gh auth login
```

Izberi: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git) → **Login with a web browser**.
Skopiraj enkratno kodo in jo potrdi v brskalniku.

## Korak 4 — Račun in projekt Supabase (baza in prijava)

1. - [ ] Odpri <https://supabase.com> → **Start your project** → **Continue with GitHub**
   (najpreprosteje, brez novega gesla).
2. - [ ] Ustvari organizacijo: ime npr. `JN`, tip **Personal**, paket **Free**.
3. - [ ] **New project**:
   - Name: `jn-portfelj`
   - Database password: klikni **Generate a password** in ga **shrani v upravitelja gesel**
     (npr. Apple Gesla). Claudu ga ne pošiljaj.
   - Region: **Central EU (Frankfurt)** — podatki ostanejo v EU.
   - Klikni **Create new project** in počakaj ~2 minuti.

## Korak 5 — Poveži Supabase s terminalom

Orodje Supabase je nameščeno v projektu, zato ukaze zaganjaš z `npx` iz mape projekta.

```bash
cd ~/Developer/JN-delniski_portfelj && npx supabase login
```

(Odpre brskalnik, potrdiš prijavo.)

```bash
npx supabase link
```

Izberi projekt `jn-portfelj`. Ko vpraša za **database password**, ga prilepi iz upravitelja gesel
(znaki se ne izpisujejo). S tem lahko Claude ustvarja tabele in varnostna pravila.

## Korak 6 — GitHub Pages (objava aplikacije)

Opravi **šele, ko Claude potisne prvo verzijo** (povedal ti bo).

- [ ] Na GitHubu odpri repozitorij → **Settings** → **Pages** → pri **Source** izberi
  **GitHub Actions**.

Aplikacija bo nato dosegljiva na <https://jurecdj.github.io/JN-delniski_portfelj/>.

## Korak 7 — Prijava v aplikacijo in zaklep registracije

Opravi, ko je aplikacija objavljena.

1. - [ ] V Supabase: **Authentication** → **URL Configuration**:
   - Site URL: `https://jurecdj.github.io/JN-delniski_portfelj/`
   - Redirect URLs: dodaj še `http://localhost:5173/**`
2. - [ ] Odpri aplikacijo, vpiši svoj e-naslov, klikni povezavo iz e-pošte → prijavljen si.
3. - [ ] **Takoj nato** v Supabase: **Authentication** → **Sign In / Providers** → izklopi
   **Allow new users to sign up**. Od tu naprej se lahko prijaviš samo ti.

## Korak 8 — Aplikacija na telefonu (iPhone)

- [ ] V **Safariju** odpri naslov aplikacije → gumb **Deli** → **Dodaj na začetni zaslon**.
  Aplikacija se odpira celozaslonsko, z lastno ikono.

---

## Kasneje (ko prideva do uvozov)

- **IBKR Flex Query** — ločena navodila pripravi Claude, ko začneva z uvozom IBKR.
  Žeton IBKR boš vpisal sam v Supabase (Edge Function Secrets).
- **Vzorčne datoteke** — po en primer: izvoz IBKR, izpisek N26, nakupni list (PDF).
  Lahko anonimizirane.

> Opomba: imena gumbov v nadzornih ploščah (Supabase, GitHub) se občasno spremenijo. Če česa ne
> najdeš, pošlji Claudu posnetek zaslona.
