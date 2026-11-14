-- ATENÇÃO: remove colunas e tabelas novas. Exporte financeiro e logs antes.
-- Use apenas se precisar voltar a produção ao estado anterior ao app administrativo.

alter table pedidos
  drop column if exists status_kanban,
  drop column if exists status_anterior,
  drop column if exists posicao,
  drop column if exists canal,
  drop column if exists origem,
  drop column if exists motoboy_id,
  drop column if exists motoboy_valor_entrega,
  drop column if exists motoboy_atribuido_em,
  drop column if exists entregue_em,
  drop column if exists repasse_pago_em,
  drop column if exists valor_bruto,
  drop column if exists valor_recebido,
  drop column if exists taxa,
  drop column if exists faturado,
  drop column if exists faturado_em,
  drop column if exists faturado_por;

drop table if exists logs;
drop table if exists financeiro;
drop table if exists perfis;
drop table if exists motoboys;
drop table if exists bairros;

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

create policy anon_all_pedidos on pedidos for all using (true) with check (true);
create policy anon_all_produtos on produtos for all using (true) with check (true);
create policy anon_all_config on config for all using (true) with check (true);
create policy anon_all_status on status for all using (true) with check (true);

alter table pedidos enable row level security;
alter table produtos enable row level security;
alter table config enable row level security;
alter table status enable row level security;
