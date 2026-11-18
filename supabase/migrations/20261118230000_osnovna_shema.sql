-- Osnovna shema portfelja.
-- Pravila: vsaka tabela ima user_id in RLS (dostop samo lastnik); denar je numeric;
-- datumi poslov so 'date' (brez časovnega pasu); uvozi so idempotentni.

create type public.broker as enum ('IBKR', 'N26', 'ROCNO');
create type public.instrument_type as enum ('DELNICA', 'ETF');
create type public.tx_type as enum (
  'NAKUP', 'PRODAJA', 'DIVIDENDA', 'DAVEK_TUJINA', 'PROVIZIJA',
  'POLOG', 'DVIG', 'MENJAVA', 'RAZDELITEV', 'OBRESTI'
);

-- Samodejno posodabljanje updated_at
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- računi
create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  broker        public.broker not null,
  name          text not null check (length(trim(name)) > 0),
  base_currency char(3) not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------------------------------------------------------- instrumenti
create table public.instruments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  isin       text not null check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  symbol     text,
  name       text not null check (length(trim(name)) > 0),
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  type       public.instrument_type not null default 'DELNICA',
  country    char(2) check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, isin),
  unique (id, user_id)
);

-- ------------------------------------------------------------- uvozi
create table public.imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source         text not null,
  file_name      text,
  file_hash      text,
  status         text not null default 'V_TEKU' check (status in ('V_TEKU', 'USPESNO', 'NAPAKA')),
  rows_new       integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_error     integer not null default 0,
  message        text,
  created_at     timestamptz not null default now(),
  unique (id, user_id)
);

-- --------------------------------------------------------- transakcije
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id    uuid not null,
  instrument_id uuid,
  type          public.tx_type not null,
  trade_date    date not null,
  settle_date   date,
  quantity      numeric(28, 10),
  price         numeric(28, 10),
  amount        numeric(20, 6),
  fee           numeric(20, 6) not null default 0 check (fee >= 0),
  currency      char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Enot valute za 1 EUR na dan posla (konvencija ECB); za EUR = 1.
  rate_per_eur  numeric(20, 10) check (rate_per_eur > 0),
  source        text not null default 'ROCNO',
  source_ref    text not null default gen_random_uuid()::text,
  import_id     uuid,
  raw           jsonb,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Račun, instrument in uvoz morajo pripadati istemu uporabniku.
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  foreign key (instrument_id, user_id) references public.instruments (id, user_id) on delete restrict,
  foreign key (import_id, user_id) references public.imports (id, user_id) on delete set null (import_id),

  -- Idempotentnost: isti zapis iz istega vira se ne more vnesti dvakrat.
  unique (account_id, source, source_ref),

  -- Nakup/prodaja: instrument, pozitivna količina, nenegativna cena, tečaj.
  constraint trade_fields check (
    type not in ('NAKUP', 'PRODAJA')
    or (instrument_id is not null and quantity > 0 and price >= 0 and rate_per_eur is not null)
  ),
  constraint trade_date_sane check (trade_date >= date '1990-01-01')
);

create index transactions_user_date_idx on public.transactions (user_id, trade_date);
create index transactions_instrument_idx on public.transactions (instrument_id);

-- -------------------------------------------------------------- tečaji
create table public.prices (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id uuid not null,
  date          date not null,
  close         numeric(28, 10) not null check (close >= 0),
  source        text not null,
  created_at    timestamptz not null default now(),
  primary key (instrument_id, date),
  foreign key (instrument_id, user_id) references public.instruments (id, user_id) on delete cascade
);

create table public.fx_rates (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date         date not null,
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_per_eur numeric(20, 10) not null check (rate_per_eur > 0),
  source       text not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, currency, date)
);

-- ---------------------------------------------------- davčne nastavitve
-- Stopnje in pravila vnese/potrdi uporabnik — niso trdo v kodi.
create table public.tax_settings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  valid_from   date not null,
  settings     jsonb not null,
  source_note  text,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, valid_from)
);

-- -------------------------------------------------------- updated_at
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger instruments_updated_at before update on public.instruments
  for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------ RLS: samo lastnik
do $$
declare t text;
begin
  foreach t in array array['accounts', 'instruments', 'imports', 'transactions', 'prices', 'fx_rates', 'tax_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy lastnik on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;
