-- Aperto final das políticas. Rodar somente após validar o /admin em produção.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('pedidos','produtos','config','status')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table pedidos enable row level security;
create policy pedidos_anon_insert on pedidos for insert to anon, authenticated with check (true);
create policy pedidos_equipe_select on pedidos for select to authenticated using (eh_equipe());
create policy pedidos_equipe_update on pedidos for update to authenticated using (eh_equipe()) with check (eh_equipe());
create policy pedidos_admin_delete on pedidos for delete to authenticated using (eh_admin());

alter table produtos enable row level security;
create policy produtos_anon_select on produtos for select to anon, authenticated using (true);
create policy produtos_equipe_write on produtos for all to authenticated using (eh_equipe()) with check (eh_equipe());

alter table config enable row level security;
create policy config_anon_select on config for select to anon, authenticated using (true);
create policy config_equipe_write on config for all to authenticated using (eh_equipe()) with check (eh_equipe());

alter table status enable row level security;
create policy status_anon_select on status for select to anon, authenticated using (true);
create policy status_equipe_write on status for all to authenticated using (eh_equipe()) with check (eh_equipe());
