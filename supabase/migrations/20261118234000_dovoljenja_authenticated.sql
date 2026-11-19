-- Novejši projekti Supabase ne dodelijo samodejno pravic na novih tabelah.
-- Prijavljeni uporabnik dobi osnovne pravice; KATERE vrstice vidi in spreminja,
-- še vedno določa RLS (politika "lastnik": samo user_id = auth.uid()).
-- Vloga anon (neprijavljen) ostane brez pravic.

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.accounts,
  public.instruments,
  public.imports,
  public.transactions,
  public.prices,
  public.fx_rates,
  public.tax_settings
to authenticated;

-- Pravilo za prihodnje: vsaka nova tabela v migraciji mora imeti
-- (1) enable row level security, (2) politiko lastnik, (3) grant za authenticated.
