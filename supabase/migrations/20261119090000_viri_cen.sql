-- Viri cen: vsak instrument pove, od kod in v kateri valuti dobi tržno ceno.
-- currency na instrumentu je valuta poslov (pri uvozu iz tabele EUR); valuta CENE je ločena.

alter table public.instruments
  add column price_symbol   text,
  add column price_currency char(3) check (price_currency ~ '^[A-Z]{3}$'),
  add column price_source   text not null default 'YAHOO' check (price_source in ('YAHOO', 'ROCNO'));

alter table public.prices
  add column currency   char(3) check (currency ~ '^[A-Z]{3}$'),
  add column fetched_at timestamptz not null default now();

-- Kronsko opravilo potrebuje razširitvi (dnevni klic funkcije prices-sync).
create extension if not exists pg_cron;
create extension if not exists pg_net;
