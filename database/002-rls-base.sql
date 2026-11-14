-- Funções de papel, trigger de perfil e RLS das tabelas novas.
-- Não altera as políticas antigas de pedidos/produtos/config/status.

create or replace function public.eh_equipe()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis
    where id = auth.uid() and ativo and papel in ('admin','operador')
  );
$$;

create or replace function public.eh_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis
    where id = auth.uid() and ativo and papel = 'admin'
  );
$$;

-- Permite que qualquer usuário autenticado altere apenas o próprio nome,
-- sem abrir a possibilidade de mudar o próprio papel ou reativar a conta.
create or replace function public.atualizar_meu_nome(novo_nome text)
returns void
language sql security definer set search_path = public as $$
  update perfis set nome = novo_nome where id = auth.uid();
$$;
grant execute on function public.atualizar_meu_nome(text) to authenticated;
revoke execute on function public.atualizar_meu_nome(text) from public, anon;

create or replace function public.criar_perfil_para_novo_usuario()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'pendente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.criar_perfil_para_novo_usuario();

alter table bairros enable row level security;
alter table motoboys enable row level security;
alter table perfis enable row level security;
alter table financeiro enable row level security;
alter table logs enable row level security;

drop policy if exists bairros_read on bairros;
create policy bairros_read on bairros for select using (true);
drop policy if exists bairros_write on bairros;
create policy bairros_write on bairros for all
  using (eh_equipe()) with check (eh_equipe());

drop policy if exists motoboys_all on motoboys;
drop policy if exists motoboys_select on motoboys;
drop policy if exists motoboys_insert on motoboys;
drop policy if exists motoboys_update on motoboys;
create policy motoboys_select on motoboys for select using (eh_equipe());
create policy motoboys_insert on motoboys for insert with check (eh_equipe());
create policy motoboys_update on motoboys for update using (eh_equipe()) with check (eh_equipe());

drop policy if exists perfis_select on perfis;
create policy perfis_select on perfis for select
  using (id = auth.uid() or eh_admin());
drop policy if exists perfis_update on perfis;
create policy perfis_update on perfis for update
  using (eh_admin()) with check (eh_admin());

drop policy if exists financeiro_all on financeiro;
create policy financeiro_all on financeiro for all
  using (eh_admin()) with check (eh_admin());

-- Operador pode remover somente lançamentos automáticos de pedidos já cancelados.
-- Isso permite que o cancelamento no Kanban não deixe receita/taxa órfãs.
drop policy if exists financeiro_delete_auto on financeiro;
create policy financeiro_delete_auto on financeiro for delete
  using (
    eh_equipe()
    and origem in ('pedido','taxa')
    and exists (
      select 1 from pedidos p
      where p.id = financeiro.pedido_id and p.cancelado
    )
  );

drop policy if exists logs_insert on logs;
create policy logs_insert on logs for insert
  with check (eh_equipe());
drop policy if exists logs_select on logs;
create policy logs_select on logs for select
  using (eh_admin());
