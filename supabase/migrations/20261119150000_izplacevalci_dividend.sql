-- Podatki o izplačevalcu dividend za Doh-Div (FURS: naziv in naslov obvezna,
-- za tujega izplačevalca tudi identifikacijska številka, država kot dvomestna oznaka).
-- Stolpci na obstoječi tabeli instruments: RLS (user_id = auth.uid()) in pravice že veljajo.

alter table public.instruments
  add column if not exists payer_name text,
  add column if not exists payer_address text,
  add column if not exists payer_country char(2) check (payer_country is null or payer_country ~ '^[A-Z]{2}$'),
  add column if not exists payer_id text;

comment on column public.instruments.payer_name is 'Doh-Div: naziv izplačevalca dividend';
comment on column public.instruments.payer_address is 'Doh-Div: naslov izplačevalca dividend';
comment on column public.instruments.payer_country is 'Doh-Div: država izplačevalca (ISO 3166-1 alfa-2)';
comment on column public.instruments.payer_id is 'Doh-Div: identifikacijska številka izplačevalca za davčne namene v njegovi državi';
