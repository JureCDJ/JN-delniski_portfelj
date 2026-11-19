-- Ciljne prodajne cene in davčne nastavitve.

create table public.targets (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instrument_id uuid not null,
  price_eur     numeric(28, 10) not null check (price_eur > 0),
  note          text,
  updated_at    timestamptz not null default now(),
  primary key (instrument_id),
  foreign key (instrument_id, user_id) references public.instruments (id, user_id) on delete cascade
);

alter table public.targets enable row level security;
create policy lastnik on public.targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.targets from anon;
grant select, insert, update, delete on public.targets to authenticated;

create trigger targets_updated_at before update on public.targets
  for each row execute function public.set_updated_at();

-- tax_settings.settings (jsonb) ima obliko:
--   {"capitalGains":[{"fromYears":0,"rate":"0.25"},...],"dividendRate":"0.25","standardCostRate":"0.01"}
-- confirmed_at = kdaj jih je lastnik potrdil; dokler ni potrjeno, aplikacija prikaže opozorilo.
alter table public.tax_settings
  add constraint tax_settings_shape check (
    settings ? 'capitalGains' and settings ? 'dividendRate' and settings ? 'standardCostRate'
  );
grant select, insert, update on public.tax_settings to authenticated;
