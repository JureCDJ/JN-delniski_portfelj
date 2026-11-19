-- Varnostna kopija vseh podatkov prijavljenega uporabnika v enem JSON (rezina 8).
-- security invoker: velja RLS (user_id = auth.uid()) — funkcija vidi samo lastnikove vrstice.
-- Številska polja na prvi ravni vrstice so zapisana kot besedilo, da se ob branju v JavaScriptu
-- (double) ne izgubi natančnost (CLAUDE.md: denar nikoli kot number).

create or replace function public._stevila_v_besedilo(j jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(k, case when jsonb_typeof(v) = 'number' then to_jsonb(v #>> '{}') else v end),
    '{}'::jsonb
  )
  from jsonb_each(j) as e(k, v)
$$;

create or replace function public.varnostna_kopija()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'format', 'jn-portfelj-varnostna-kopija',
    'verzija', 1,
    'ustvarjeno', now(),
    'accounts',     (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.created_at), '[]') from public.accounts x),
    'instruments',  (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.isin), '[]') from public.instruments x),
    'imports',      (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.created_at), '[]') from public.imports x),
    'transactions', (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.trade_date, x.created_at), '[]') from public.transactions x),
    'targets',      (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x))), '[]') from public.targets x),
    'tax_settings', (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.valid_from), '[]') from public.tax_settings x),
    'prices',       (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.instrument_id, x.date), '[]') from public.prices x),
    'fx_rates',     (select coalesce(jsonb_agg(public._stevila_v_besedilo(to_jsonb(x)) order by x.currency, x.date), '[]') from public.fx_rates x)
  )
$$;

revoke all on function public.varnostna_kopija() from public, anon;
revoke all on function public._stevila_v_besedilo(jsonb) from public, anon;
grant execute on function public.varnostna_kopija() to authenticated;
grant execute on function public._stevila_v_besedilo(jsonb) to authenticated;
