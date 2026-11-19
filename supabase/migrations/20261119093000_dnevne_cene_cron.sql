-- Dnevna posodobitev cen: ob delavnikih po zaprtju evropskih (17:00 UTC) in ameriških borz (22:30 UTC).
-- Žeton se bere iz Supabase Vault (ime 'prices_cron_secret'); vrednost ni v repozitoriju.

create or replace function public.klic_prices_sync() returns void
language plpgsql security definer set search_path = '' as $$
declare
  zeton text;
begin
  select decrypted_secret into zeton from vault.decrypted_secrets where name = 'prices_cron_secret';
  if zeton is null then
    raise warning 'prices_cron_secret ni nastavljen — dnevna posodobitev cen preskočena';
    return;
  end if;
  perform net.http_post(
    url := 'https://ghovfrslfajbebhyszsd.supabase.co/functions/v1/prices-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', zeton),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.klic_prices_sync() from public, anon, authenticated;

select cron.schedule('cene-eu', '0 17 * * 1-5', 'select public.klic_prices_sync()');
select cron.schedule('cene-us', '30 22 * * 1-5', 'select public.klic_prices_sync()');
