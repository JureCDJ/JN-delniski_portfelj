-- Strežniška vloga (Edge Function ob dnevnem klicu) potrebuje pravice za branje portfelja in
-- zapis cen/tečajev. Projekt pravic ne dodeli samodejno (glej CLAUDE.md, pravilo 5).
grant usage on schema public to service_role;
grant select on public.accounts, public.instruments, public.transactions to service_role;
grant select, insert, update on public.prices, public.fx_rates to service_role;
