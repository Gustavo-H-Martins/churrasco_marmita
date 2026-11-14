# Churrasco na Marmita — Plano de execução do app administrativo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o app administrativo com Kanban, motoboys, financeiro, bairros e pedidos manuais de iFood, protegido por Supabase Auth e validado em staging antes de ir para produção.

**Architecture:** Site estático no GitHub Pages com JavaScript puro em módulos ES, sem build. O admin é uma SPA leve em `/admin/`; o cardápio público continua em `/index.html`. Os dados ficam no Supabase, com RLS por papel. A validação acontece em um segundo projeto Supabase de staging, e o deploy em produção é feito lado a lado com o `/pedidos` atual até o cutover.

**Tech Stack:** HTML, CSS e JavaScript (ES modules), Node.js 20+ apenas para testes (`node --test`), Supabase (Auth, Postgres, RLS, Edge Functions), SortableJS e `@supabase/supabase-js` vendorizados.

**Spec:** `docs/superpowers/specs/2026-11-14-admin-churrasco-design.md`

## Global Constraints

- Branch de trabalho: `feat/admin-operacao`. **Não fazer push nem merge na `main` antes da Task 16.**
- Todo commit termina com o trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Sem etapa de build, sem bundler e sem dependências npm em produção. Apenas `node --test` para testes.
- Nenhum segredo no front-end. Apenas a chave publicável do Supabase. A service role existe somente na Edge Function.
- Valores monetários: `numeric(10,2)` no banco, formatados em BRL no front, arredondados para 2 casas antes de gravar.
- Fuso horário de relatórios e datas: `America/Sao_Paulo`.
- Os status são exatamente: `novo`, `preparo`, `pronto`, `entrega`, `concluido`, `cancelado`.
- Pedidos cancelados nunca entram em total, contador, relatório ou card. A coluna Cancelado existe apenas para visibilidade e restauração.
- A atribuição de motoboy só é permitida quando `status_kanban = 'entrega'`.
- Testar sempre primeiro no projeto Supabase de staging. Produção só recebe migrações aditivas até o cutover.
- Usuários de teste: um `admin` e um `operador`. O usuário `pendente` não pode ver dados.
- Bibliotecas vendorizadas com versão fixa: `@supabase/supabase-js@2.45.4` e `sortablejs@1.15.6`.
- Não alterar o `/pedidos/index.html` nem remover o painel antigo do cardápio antes da Task 17.

---

## Fase 0 — Preparação

### Task 1: Repositório sem segredos e base de testes

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `README.md`
- Modify: remove `.env` do índice do Git (o arquivo local continua)
- Test: `tests/smoke.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `npm test` funcional; `.env` ignorado pelo Git.

- [ ] **Step 1: Criar `.gitignore`**

```gitignore
node_modules/
.env
.env.*
!.env.example
.DS_Store
Thumbs.db
*.log
.superpowers/
.claude/worktrees/
.worktrees/
```

- [ ] **Step 2: Criar `.env.example` com placeholders, sem valores reais**

```dotenv
# Credenciais do portal do iFood (não versionar o .env real)
user_ifood=
pwd_ifood=
host_ifood=https://portal.ifood.com.br/setup/home
```

- [ ] **Step 3: Parar de rastrear o `.env` sem apagar o arquivo local**

Run:
```bash
git rm --cached .env
git status --short
```
Expected: `.env` aparece como `D` no índice e continua existindo no disco; `git ls-files .env` não retorna nada.

- [ ] **Step 4: Criar `package.json`**

```json
{
  "name": "churrasco-marmita",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test tests/",
    "serve": "npx serve ."
  }
}
```

- [ ] **Step 5: Criar o primeiro teste de fumaça**

`tests/smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('o ambiente de testes está funcional', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: `1 test passed`.

- [ ] **Step 7: Criar `README.md` com o aviso de segurança**

```markdown
# Churrasco na Marmita

Cardápio público em `index.html` e app administrativo em `admin/`.

## Segurança

- O arquivo `.env` nunca deve ser versionado.
- A senha do portal do iFood que ficou exposta no histórico do repositório deve ser trocada.
- O front-end usa somente a chave publicável do Supabase.
- A service role fica exclusivamente na Edge Function `criar-usuario`.

## Desenvolvimento

```bash
npm test
npm run serve
```

Abra `http://localhost:3000/admin/`. Em localhost, o app usa o projeto Supabase de staging.
```

- [ ] **Step 8: Commit**

```bash
git add .gitignore .env.example package.json README.md tests/smoke.test.mjs
git commit -m "chore: remove segredos do repositório e prepara base de testes

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Schema, RLS, seed de bairros e backfill

**Files:**
- Create: `database/001-schema.sql`
- Create: `database/002-rls-base.sql`
- Create: `database/003-seed-bairros.sql`
- Create: `database/004-backfill.sql`
- Create: `database/999-rollback.sql`

**Interfaces:**
- Consumes: projeto Supabase de staging criado no painel.
- Produces: tabelas `bairros`, `motoboys`, `perfis`, `financeiro`, `logs`; novas colunas em `pedidos`; funções `eh_equipe()` e `eh_admin()`.

- [ ] **Step 1: Escrever `database/001-schema.sql`**

```sql
-- Churrasco na Marmita — schema do app administrativo
-- Idempotente. Rodar no SQL Editor do Supabase.

create table if not exists bairros (
  id bigint generated by default as identity primary key,
  nome text not null unique,
  taxa numeric(10,2) not null default 0 check (taxa >= 0),
  grupo text not null default 'Bairro' check (grupo in ('Bairro','Condomínio')),
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists motoboys (
  id bigint generated by default as identity primary key,
  nome text not null,
  telefone text,
  valor_entrega numeric(10,2) not null default 0 check (valor_entrega >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  papel text not null default 'pendente' check (papel in ('admin','operador','pendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists financeiro (
  id bigint generated by default as identity primary key,
  tipo text not null check (tipo in ('entrada','saida')),
  categoria text not null default 'outros',
  descricao text not null,
  valor numeric(10,2) not null check (valor >= 0),
  data date not null default current_date,
  pedido_id bigint references pedidos(id) on delete set null,
  origem text not null default 'manual' check (origem in ('manual','pedido','taxa')),
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  editado_em timestamptz
);

create table if not exists logs (
  id bigint generated by default as identity primary key,
  user_id uuid references auth.users(id),
  user_email text,
  acao text not null,
  entidade text,
  entidade_id text,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);

alter table pedidos
  add column if not exists status_kanban text not null default 'novo'
    check (status_kanban in ('novo','preparo','pronto','entrega','concluido','cancelado')),
  add column if not exists status_anterior text,
  add column if not exists posicao double precision not null default 0,
  add column if not exists canal text not null default 'whatsapp'
    check (canal in ('whatsapp','ifood','balcao','outro')),
  add column if not exists origem text not null default 'cardapio'
    check (origem in ('cardapio','manual')),
  add column if not exists motoboy_id bigint references motoboys(id) on delete set null,
  add column if not exists motoboy_valor_entrega numeric(10,2),
  add column if not exists motoboy_atribuido_em timestamptz,
  add column if not exists entregue_em timestamptz,
  add column if not exists repasse_pago_em timestamptz,
  add column if not exists valor_bruto numeric(10,2),
  add column if not exists valor_recebido numeric(10,2),
  add column if not exists taxa numeric(10,2) not null default 0,
  add column if not exists faturado boolean not null default false,
  add column if not exists faturado_em timestamptz,
  add column if not exists faturado_por uuid references auth.users(id);

create index if not exists pedidos_status_idx on pedidos (status_kanban);
create index if not exists pedidos_created_idx on pedidos (created_at desc);
create index if not exists pedidos_motoboy_idx on pedidos (motoboy_id);
create index if not exists financeiro_data_idx on financeiro (data desc);
create index if not exists logs_criado_idx on logs (criado_em desc);

create unique index if not exists financeiro_pedido_entrada_uq
  on financeiro (pedido_id) where origem = 'pedido';
create unique index if not exists financeiro_pedido_taxa_uq
  on financeiro (pedido_id) where origem = 'taxa';
```

- [ ] **Step 2: Escrever `database/002-rls-base.sql`**

```sql
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
create policy motoboys_select on motoboys for select
  using (eh_equipe());
create policy motoboys_insert on motoboys for insert
  with check (eh_equipe());
create policy motoboys_update on motoboys for update
  using (eh_equipe()) with check (eh_equipe());

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
```

- [ ] **Step 3: Escrever `database/003-seed-bairros.sql`**

```sql
insert into bairros (nome, taxa, grupo, ordem) values
  ('Acácias', 2, 'Bairro', 1),
  ('Vila Maria', 2, 'Bairro', 2),
  ('Santa Helena', 2, 'Bairro', 3),
  ('Vila Rica', 3, 'Bairro', 4),
  ('Jardim Imperial', 3, 'Bairro', 5),
  ('Por do Sol', 3, 'Bairro', 6),
  ('Moradas', 3, 'Bairro', 7),
  ('Vale Verde Ville', 3, 'Bairro', 8),
  ('Portal do Sol', 3, 'Bairro', 9),
  ('Jacques Vile', 3, 'Bairro', 10),
  ('Palmital', 4, 'Bairro', 11),
  ('Vale dos Sonhos', 4, 'Bairro', 12),
  ('Vila Fagundes', 4, 'Bairro', 13),
  ('Sobradinho', 5, 'Bairro', 14),
  ('Brant', 5, 'Bairro', 15),
  ('Campinho', 5, 'Bairro', 16),
  ('Centro', 6, 'Bairro', 17),
  ('Barraginha', 6, 'Bairro', 18),
  ('Várzea', 7, 'Bairro', 19),
  ('Bela Vista', 7, 'Bairro', 20),
  ('Joa', 8, 'Bairro', 21),
  ('Santos Dumont', 8, 'Bairro', 22),
  ('Ovídeo Guerra', 8, 'Bairro', 23),
  ('Ipê', 9, 'Bairro', 24),
  ('Praia Angélica', 9, 'Bairro', 25),
  ('Novo Santos Dumont', 9, 'Bairro', 26),
  ('Recanto', 9, 'Bairro', 27),
  ('Aeronautas', 10, 'Bairro', 28),
  ('Visão', 10, 'Bairro', 29),
  ('Lagoinha', 10, 'Bairro', 30),
  ('Lundceia', 6, 'Bairro', 31),
  ('Recanto do Poeta', 10, 'Bairro', 32),
  ('Amendoeiras', 10, 'Condomínio', 33),
  ('Mirante do Fidalgo', 5, 'Condomínio', 34),
  ('Bouganvile', 10, 'Condomínio', 35),
  ('Maripousas', 5, 'Condomínio', 36),
  ('Trilhas do Sol', 5, 'Condomínio', 37)
on conflict (nome) do nothing;
```

- [ ] **Step 4: Escrever `database/004-backfill.sql`**

```sql
update pedidos
set status_kanban = case
  when cancelado then 'cancelado'
  when finalizado then 'concluido'
  else 'novo'
end
where status_kanban = 'novo' and (cancelado or finalizado);

update pedidos set valor_bruto = total where valor_bruto is null;
```

- [ ] **Step 5: Escrever `database/999-rollback.sql` com aviso destrutivo**

```sql
-- ATENÇÃO: remove colunas e tabelas novas. Exporte financeiro e logs antes.
-- O banco volta às políticas anônimas abertas de pedidos/produtos/config/status.
-- Use apenas se precisar voltar a produção ao estado anterior ao app administrativo.

-- Remove o trigger antes das funções/tabelas que ele referencia.
drop trigger if exists on_auth_user_created on auth.users;

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

drop index if exists public.pedidos_created_idx;

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

-- Remove as funções criadas pelo app depois que as políticas que as usam sumiram.
drop function if exists public.criar_perfil_para_novo_usuario();
drop function if exists public.atualizar_meu_nome(text);
drop function if exists public.eh_admin();
drop function if exists public.eh_equipe();

create policy anon_all_pedidos on pedidos for all using (true) with check (true);
create policy anon_all_produtos on produtos for all using (true) with check (true);
create policy anon_all_config on config for all using (true) with check (true);
create policy anon_all_status on status for all using (true) with check (true);

alter table pedidos enable row level security;
alter table produtos enable row level security;
alter table config enable row level security;
alter table status enable row level security;
```

- [ ] **Step 6: Aplicar no staging**

No SQL Editor do projeto de staging, execute na ordem: `000`, `001`, `002`, `003`, `004`.

`000-base.sql` é **somente para staging/local**: cria as tabelas base (`status`, `pedidos`, `produtos`, `config`) e políticas anônimas permissivas em um projeto vazio. Não rode `000` em produção depois do cutover.

- [ ] **Step 7: Verificar o staging**

Run no SQL Editor:
```sql
select count(*) as bairros from bairros;
select nome, taxa, grupo from bairros order by ordem limit 5;
select column_name from information_schema.columns
where table_name = 'pedidos' and column_name in ('status_kanban','motoboy_id','valor_bruto','faturado');
```
Expected: `37` bairros; as colunas novas presentes.

- [ ] **Step 8: Commit**

```bash
git add database/
git commit -m "feat: adiciona schema, rls base e seed de bairros

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Módulos puros de formatação e cálculo

**Files:**
- Create: `assets/js/format.js`
- Create: `assets/js/calc.js`
- Create: `tests/format.test.mjs`
- Create: `tests/calc.test.mjs`

**Interfaces:**
- Consumes: nada (módulos puros, sem DOM).
- Produces:
  - `fmtBRL(v: number): string`
  - `parseBRL(texto: string): number`
  - `fmtData(iso: string | null): string`
  - `fmtDataHora(iso: string | null): string`
  - `dataBR(iso: string): string` (`YYYY-MM-DD`)
  - `esc(s: unknown): string`
  - `arred2(n: number): number`
  - `calcularTaxa(bruto: number, recebido: number): number`
  - `calcularFrete(bairros: Array<{nome:string,taxa:number}>, nome: string): number`
  - `resumoPedidos(pedidos: Pedido[]): Resumo`
  - `agruparKanban(pedidos: Pedido[]): Record<Etapa, Pedido[]>`
  - `podeAtribuirMotoboy(pedido: Pedido): boolean`
  - `proximaEtapa(etapa: Etapa, direcao: -1 | 1): Etapa`
  - `transicaoPermitida(de: Etapa, para: Etapa): boolean`
  - `relatorioMotoboy(args): Grupo[]`
  - `resumoFinanceiro(lancamentos: Lancamento[]): ResumoFinanceiro`
  - `validarBairro(bairro): string[]`
  - `validarPedidoManual(pedido): string[]`

- [ ] **Step 1: Escrever os testes de formatação**

`tests/format.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBRL, parseBRL, fmtData, fmtDataHora, esc } from '../assets/js/format.js';

const semNbsp = (s) => s.replace(/ /g, ' ');

test('fmtBRL formata reais com duas casas', () => {
  assert.equal(semNbsp(fmtBRL(23)), 'R$ 23,00');
  assert.equal(semNbsp(fmtBRL(1234.5)), 'R$ 1.234,50');
  assert.equal(semNbsp(fmtBRL(null)), 'R$ 0,00');
});

test('parseBRL aceita formato brasileiro e vazio', () => {
  assert.equal(parseBRL('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRL('23,90'), 23.9);
  assert.equal(parseBRL('23.90'), 23.9);
  assert.equal(parseBRL(''), 0);
});

test('fmtData respeita o fuso de São Paulo', () => {
  assert.equal(fmtData('2026-11-14T02:30:00.000Z'), '13/11/2026');
  assert.equal(fmtData(null), '—');
});

test('fmtDataHora mostra data e hora locais', () => {
  assert.equal(fmtDataHora('2026-11-14T15:45:00.000Z'), '14/11/2026 12:45');
});

test('esc escapa HTML', () => {
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module '../assets/js/format.js'`.

- [ ] **Step 3: Implementar `assets/js/format.js`**

```js
const TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2
});

const dataFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric'
});

const horaFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit'
});

export function fmtBRL(v) {
  return brl.format(Number(v || 0));
}

export function parseBRL(texto) {
  if (typeof texto === 'number') return texto;
  const s = String(texto || '').trim();
  if (!s) return 0;
  if (s.includes(',')) {
    const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function fmtData(iso) {
  if (!iso) return '—';
  return dataFmt.format(new Date(iso));
}

export function fmtDataHora(iso) {
  if (!iso) return '—';
  return `${fmtData(iso)} ${horaFmt.format(new Date(iso))}`;
}

export function dataBR(iso) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const get = (tipo) => partes.find(p => p.type === tipo)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function hojeBR() {
  return dataBR(new Date().toISOString());
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
```

- [ ] **Step 4: Rodar os testes de formatação**

Run: `npm test`
Expected: PASS nos testes de formatação.

- [ ] **Step 5: Escrever os testes de cálculo**

`tests/calc.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularTaxa, calcularFrete, resumoPedidos, agruparKanban,
  podeAtribuirMotoboy, proximaEtapa, transicaoPermitida,
  relatorioMotoboy, resumoFinanceiro, validarBairro, validarPedidoManual
} from '../assets/js/calc.js';

const pedidos = [
  { id: 1, status_kanban: 'novo', cancelado: false, finalizado: false, total: 30, cancelado: false },
  { id: 2, status_kanban: 'concluido', cancelado: false, finalizado: true, total: 50, entregue_em: '2026-11-14T15:00:00.000Z', motoboy_id: 7, motoboy_valor_entrega: 5, repasse_pago_em: null },
  { id: 3, status_kanban: 'cancelado', cancelado: true, finalizado: false, total: 999 },
  { id: 4, status_kanban: 'concluido', cancelado: true, finalizado: true, total: 888, entregue_em: '2026-11-14T16:00:00.000Z', motoboy_id: 7, motoboy_valor_entrega: 5 }
];

test('calcularTaxa devolve a diferença e nunca fica negativa', () => {
  assert.equal(calcularTaxa(100, 85), 15);
  assert.equal(calcularTaxa(100, 100), 0);
  assert.equal(calcularTaxa(100, 120), 0);
});

test('calcularFrete encontra o bairro e devolve 0 quando não existe', () => {
  const bairros = [{ nome: 'Centro', taxa: 6 }, { nome: 'Acácias', taxa: 2 }];
  assert.equal(calcularFrete(bairros, 'Centro'), 6);
  assert.equal(calcularFrete(bairros, ''), 0);
  assert.equal(calcularFrete(bairros, 'Inexistente'), 0);
});

test('resumoPedidos exclui cancelados do total', () => {
  const r = resumoPedidos(pedidos);
  assert.equal(r.quantidade, 2);
  assert.equal(r.total, 80);
  assert.equal(r.pago, 50);
  assert.equal(r.aberto, 30);
  assert.equal(r.cancelado, 1887);
});

test('agruparKanban coloca cada pedido na sua coluna', () => {
  const g = agruparKanban(pedidos);
  assert.deepEqual(g.novo.map(p => p.id), [1]);
  assert.deepEqual(g.concluido.map(p => p.id), [2, 4]);
  assert.deepEqual(g.cancelado.map(p => p.id), [3]);
});

test('podeAtribuirMotoboy só em Em entrega e fora de retirada', () => {
  assert.equal(podeAtribuirMotoboy({ status_kanban: 'entrega', bairro: 'Centro', cancelado: false }), true);
  assert.equal(podeAtribuirMotoboy({ status_kanban: 'entrega', bairro: 'Retirada no local', cancelado: false }), false);
  assert.equal(podeAtribuirMotoboy({ status_kanban: 'pronto', bairro: 'Centro', cancelado: false }), false);
  assert.equal(podeAtribuirMotoboy({ status_kanban: 'entrega', bairro: 'Centro', cancelado: true }), false);
});

test('navegação entre etapas e transições', () => {
  assert.equal(proximaEtapa('novo', 1), 'preparo');
  assert.equal(proximaEtapa('concluido', 1), 'concluido');
  assert.equal(proximaEtapa('cancelado', 1), 'cancelado');
  assert.equal(transicaoPermitida('novo', 'concluido'), true);
  assert.equal(transicaoPermitida('concluido', 'novo'), true);
  assert.equal(transicaoPermitida('invalido', 'novo'), false);
});

test('relatorioMotoboy ignora cancelados e usa o snapshot', () => {
  const motoboys = [{ id: 7, nome: 'Diego' }];
  const r = relatorioMotoboy({
    pedidos, motoboys,
    inicio: '2026-11-14T00:00:00.000Z',
    fim: '2026-11-15T00:00:00.000Z'
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].motoboyId, 7);
  assert.equal(r[0].quantidade, 1);
  assert.equal(r[0].total, 5);
  assert.equal(r[0].pendente, 5);
  assert.equal(r[0].pago, 0);
});

test('resumoFinanceiro calcula entradas, saídas, saldo, taxas e líquido', () => {
  const r = resumoFinanceiro([
    { tipo: 'entrada', valor: 100, origem: 'pedido' },
    { tipo: 'saida', valor: 15, origem: 'taxa' },
    { tipo: 'saida', valor: 10, origem: 'manual' }
  ]);
  assert.deepEqual(r, { entradas: 100, saidas: 25, saldo: 75, taxas: 15, liquido: 85 });
});

test('validações de bairro e pedido manual', () => {
  assert.deepEqual(validarBairro({ nome: '', taxa: -1 }), ['Informe o nome do bairro.', 'A taxa não pode ser negativa.']);
  assert.deepEqual(validarBairro({ nome: 'Centro', taxa: 6 }), []);
  assert.deepEqual(validarPedidoManual({ cliente: '', itens: '', total: 0 }), ['Informe o cliente.', 'Informe pelo menos um item.', 'Informe um valor total maior que zero.']);
  assert.deepEqual(validarPedidoManual({ cliente: 'Ana', itens: '1 marmita', total: 30, canal: 'ifood' }), []);
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module '../assets/js/calc.js'`.

- [ ] **Step 7: Implementar `assets/js/calc.js`**

```js
export const ETAPAS = ['novo', 'preparo', 'pronto', 'entrega', 'concluido', 'cancelado'];
export const ETAPAS_ABERTAS = ['novo', 'preparo', 'pronto', 'entrega'];
export const ROTULOS = {
  novo: 'Novo', preparo: 'Em preparo', pronto: 'Pronto',
  entrega: 'Em entrega', concluido: 'Concluído', cancelado: 'Cancelado'
};

export function arred2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function calcularTaxa(bruto, recebido) {
  return arred2(Math.max(0, (Number(bruto) || 0) - (Number(recebido) || 0)));
}

export function calcularFrete(bairros, nome) {
  const b = (bairros || []).find(x => x.nome === nome);
  return b ? arred2(b.taxa) : 0;
}

export function resumoPedidos(pedidos) {
  const r = { quantidade: 0, total: 0, pago: 0, aberto: 0, cancelado: 0 };
  for (const p of pedidos || []) {
    const valor = Number(p.total || 0);
    if (p.cancelado) { r.cancelado += valor; continue; }
    r.quantidade += 1;
    r.total += valor;
    if (p.finalizado) r.pago += valor; else r.aberto += valor;
  }
  return {
    ...r,
    total: arred2(r.total), pago: arred2(r.pago),
    aberto: arred2(r.aberto), cancelado: arred2(r.cancelado)
  };
}

export function agruparKanban(pedidos) {
  const grupos = Object.fromEntries(ETAPAS.map(e => [e, []]));
  for (const p of pedidos || []) {
    const etapa = ETAPAS.includes(p.status_kanban) ? p.status_kanban : 'novo';
    grupos[etapa].push(p);
  }
  for (const e of ETAPAS) {
    grupos[e].sort((a, b) => Number(a.posicao || 0) - Number(b.posicao || 0));
  }
  return grupos;
}

export function podeAtribuirMotoboy(pedido) {
  return Boolean(
    pedido && !pedido.cancelado &&
    pedido.status_kanban === 'entrega' &&
    pedido.bairro !== 'Retirada no local'
  );
}

export function proximaEtapa(etapa, direcao) {
  if (etapa === 'cancelado') return 'cancelado';
  const fluxo = ['novo', 'preparo', 'pronto', 'entrega', 'concluido'];
  const idx = fluxo.indexOf(etapa);
  if (idx === -1) return 'novo';
  const alvo = idx + (direcao > 0 ? 1 : -1);
  return fluxo[Math.min(Math.max(alvo, 0), fluxo.length - 1)];
}

export function transicaoPermitida(de, para) {
  return ETAPAS.includes(de) && ETAPAS.includes(para) && de !== para;
}

function noPeriodo(iso, inicio, fim) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(inicio).getTime() && t <= new Date(fim).getTime();
}

export function relatorioMotoboy({ pedidos, motoboys, inicio, fim }) {
  const nomes = new Map((motoboys || []).map(m => [Number(m.id), m.nome]));
  const grupos = new Map();

  for (const p of pedidos || []) {
    if (p.cancelado) continue;
    if (p.status_kanban !== 'concluido') continue;
    if (!p.motoboy_id) continue;
    if (!noPeriodo(p.entregue_em, inicio, fim)) continue;

    const id = Number(p.motoboy_id);
    if (!grupos.has(id)) {
      grupos.set(id, {
        motoboyId: id,
        nome: nomes.get(id) || `Motoboy ${id}`,
        quantidade: 0,
        total: 0,
        pendente: 0,
        pago: 0,
        pedidos: []
      });
    }
    const g = grupos.get(id);
    const valor = arred2(p.motoboy_valor_entrega);
    g.quantidade += 1;
    g.total = arred2(g.total + valor);
    g.pedidos.push(p);
    if (p.repasse_pago_em) g.pago = arred2(g.pago + valor);
    else g.pendente = arred2(g.pendente + valor);
  }

  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function resumoFinanceiro(lancamentos) {
  const r = { entradas: 0, saidas: 0, saldo: 0, taxas: 0, liquido: 0 };
  for (const l of lancamentos || []) {
    const v = Number(l.valor || 0);
    if (l.tipo === 'entrada') r.entradas += v;
    else if (l.tipo === 'saida') {
      r.saidas += v;
      if (l.origem === 'taxa') r.taxas += v;
    }
  }
  return {
    entradas: arred2(r.entradas),
    saidas: arred2(r.saidas),
    saldo: arred2(r.entradas - r.saidas),
    taxas: arred2(r.taxas),
    liquido: arred2(r.entradas - r.taxas)
  };
}

export function validarBairro(b) {
  const erros = [];
  if (!String(b?.nome || '').trim()) erros.push('Informe o nome do bairro.');
  if (Number(b?.taxa) < 0) erros.push('A taxa não pode ser negativa.');
  return erros;
}

export function validarPedidoManual(p) {
  const erros = [];
  if (!String(p?.cliente || '').trim()) erros.push('Informe o cliente.');
  if (!String(p?.itens || '').trim()) erros.push('Informe pelo menos um item.');
  if (!(Number(p?.total) > 0)) erros.push('Informe um valor total maior que zero.');
  return erros;
}
```

- [ ] **Step 8: Rodar todos os testes**

Run: `npm test`
Expected: todos os testes PASS.

- [ ] **Step 9: Commit**

```bash
git add assets/js/format.js assets/js/calc.js tests/format.test.mjs tests/calc.test.mjs
git commit -m "feat: adiciona formatação e cálculos puros com testes

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Configuração de ambiente, cliente Supabase e bibliotecas vendorizadas

**Files:**
- Create: `assets/js/config.js`
- Create: `assets/js/db.js`
- Create: `assets/vendor/supabase-js.umd.js`
- Create: `assets/vendor/sortable.min.js`

**Interfaces:**
- Consumes: `format.js`, `calc.js`.
- Produces:
  - `IS_STAGING: boolean`
  - `SUPABASE: { url: string, key: string }`
  - `sb` (cliente Supabase)
  - `listarBairros()`, `salvarBairro()`, `excluirBairro()`
  - `listarMotoboys()`, `salvarMotoboy()`
  - `listarPedidos()`, `criarPedido()`, `atualizarPedido()`
  - `listarFinanceiro()`, `criarLancamento()`, `atualizarLancamento()`, `excluirLancamento()`
  - `listarPerfis()`, `atualizarPerfil()`, `listarLogs()`

- [ ] **Step 1: Baixar as bibliotecas com versão fixa**

Run:
```bash
mkdir -p assets/vendor
curl -L -o assets/vendor/supabase-js.umd.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js
curl -L -o assets/vendor/sortable.min.js https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js
```
Expected: dois arquivos não vazios em `assets/vendor/`.

- [ ] **Step 2: Criar `assets/js/config.js`**

```js
const host = location.hostname;
export const IS_STAGING = host === 'localhost' || host === '127.0.0.1';

// Preencha com os dados do projeto Supabase de staging.
// São chaves publicáveis; nunca coloque a service role aqui.
const STAGING = {
  url: 'https://SEU-PROJETO-STAGING.supabase.co',
  key: 'SUA_CHAVE_PUBLICAVEL_DE_STAGING'
};

const PRODUCTION = {
  url: 'https://eszmbpviuhkrmwhemhqn.supabase.co',
  key: 'sb_publishable_ObR_oZX8pJ6dzG69nztXjg_xH3NZSpr'
};

export const SUPABASE = IS_STAGING ? STAGING : PRODUCTION;
export const TZ = 'America/Sao_Paulo';
export const LOJA_FALLBACK = {
  nome: 'Churrasco na Marmita',
  descricao: 'Cardápio digital com pedido rápido no WhatsApp.',
  telefone: '553193817229',
  endereco: 'Rua das Seringueiras Nº 26, Bairro das Acácias, Lagoa Santa',
  instagram: 'https://www.instagram.com/churrasco_marmita/',
  logo: 'images/logo.png',
  banner: 'Bem vindo ao Churrasco na Marmita Lagoa Santa - MG'
};
```

- [ ] **Step 3: Criar `assets/js/db.js`**

```js
import { SUPABASE } from './config.js';

const { createClient } = window.supabase;
export const sb = createClient(SUPABASE.url, SUPABASE.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function checar(error) {
  if (error) throw new Error(error.message || String(error));
  return null;
}

export async function listarBairros() {
  const { data, error } = await sb.from('bairros')
    .select('*').order('ordem', { ascending: true }).order('nome', { ascending: true });
  checar(error);
  return data || [];
}

export async function salvarBairro(bairro) {
  const payload = {
    nome: bairro.nome.trim(),
    taxa: Number(bairro.taxa || 0),
    grupo: bairro.grupo || 'Bairro',
    ativo: bairro.ativo !== false,
    ordem: Number(bairro.ordem || 0)
  };
  const q = bairro.id
    ? sb.from('bairros').update(payload).eq('id', bairro.id)
    : sb.from('bairros').insert(payload);
  const { error } = await q;
  checar(error);
}

export async function excluirBairro(id) {
  const { error } = await sb.from('bairros').delete().eq('id', id);
  checar(error);
}

export async function listarMotoboys() {
  const { data, error } = await sb.from('motoboys').select('*').order('nome');
  checar(error);
  return data || [];
}

export async function salvarMotoboy(m) {
  const payload = {
    nome: m.nome.trim(),
    telefone: m.telefone || null,
    valor_entrega: Number(m.valor_entrega || 0),
    ativo: m.ativo !== false
  };
  const q = m.id
    ? sb.from('motoboys').update(payload).eq('id', m.id)
    : sb.from('motoboys').insert(payload);
  const { error } = await q;
  checar(error);
}

export async function listarPedidos({ inicio, fim } = {}) {
  let q = sb.from('pedidos').select('*').order('created_at', { ascending: false });
  if (inicio) q = q.gte('created_at', inicio);
  if (fim) q = q.lte('created_at', fim);
  const { data, error } = await q;
  checar(error);
  return data || [];
}

export async function listarPedidosKanban(inicioDia) {
  const [abertos, fechados] = await Promise.all([
    sb.from('pedidos').select('*')
      .in('status_kanban', ['novo','preparo','pronto','entrega'])
      .order('created_at', { ascending: true }),
    sb.from('pedidos').select('*')
      .in('status_kanban', ['concluido','cancelado'])
      .gte('created_at', inicioDia)
      .order('created_at', { ascending: true })
  ]);
  checar(abertos.error);
  checar(fechados.error);
  const mapa = new Map();
  for (const p of [...(abertos.data || []), ...(fechados.data || [])]) {
    mapa.set(String(p.id), p);
  }
  return [...mapa.values()];
}

export async function listarPedidosEntregues(inicio, fim) {
  const { data, error } = await sb.from('pedidos').select('*')
    .eq('status_kanban', 'concluido')
    .gte('entregue_em', inicio)
    .lte('entregue_em', fim)
    .order('entregue_em', { ascending: true });
  checar(error);
  return data || [];
}

export async function contarPedidosBairro(nome, desdeISO) {
  const { count, error } = await sb.from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('bairro', nome)
    .gte('created_at', desdeISO);
  checar(error);
  return count || 0;
}

export async function criarPedido(dados) {
  const { data, error } = await sb.from('pedidos').insert(dados).select().single();
  checar(error);
  return data;
}

export async function atualizarPedido(id, patch) {
  const { error } = await sb.from('pedidos').update(patch).eq('id', id);
  checar(error);
}

export async function listarFinanceiro({ inicio, fim } = {}) {
  let q = sb.from('financeiro').select('*').order('data', { ascending: false })
    .order('criado_em', { ascending: false });
  if (inicio) q = q.gte('data', inicio);
  if (fim) q = q.lte('data', fim);
  const { data, error } = await q;
  checar(error);
  return data || [];
}

export async function criarLancamento(l) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('financeiro').insert({ ...l, criado_por: user?.id || null });
  checar(error);
}

export async function atualizarLancamento(id, patch) {
  const { error } = await sb.from('financeiro').update({ ...patch, editado_em: new Date().toISOString() }).eq('id', id);
  checar(error);
}

export async function excluirLancamento(id) {
  const { error } = await sb.from('financeiro').delete().eq('id', id);
  checar(error);
}

export async function listarPerfis() {
  const { data, error } = await sb.from('perfis').select('*').order('nome');
  checar(error);
  return data || [];
}

export async function atualizarPerfil(id, patch) {
  const { error } = await sb.from('perfis').update(patch).eq('id', id);
  checar(error);
}

export async function listarLogs({ limite = 200 } = {}) {
  const { data, error } = await sb.from('logs').select('*')
    .order('criado_em', { ascending: false }).limit(limite);
  checar(error);
  return data || [];
}
```

- [ ] **Step 4: Verificar no navegador**

Crie temporariamente uma página ou use o console do navegador em `http://localhost:3000/`:
```js
const { sb } = await import('/assets/js/db.js');
console.log(await sb.auth.getSession());
```
Expected: sessão nula, sem erro de rede. Confirme no DevTools que a requisição vai para a URL de staging.

- [ ] **Step 5: Commit**

```bash
git add assets/js/config.js assets/js/db.js assets/vendor/
git commit -m "feat: adiciona configuração de ambiente e cliente supabase

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Fase 1 — Base do admin

### Task 5: Login, sessão, papéis e shell com abas

**Files:**
- Create: `assets/css/base.css`
- Create: `assets/css/admin.css`
- Create: `assets/js/auth.js`
- Create: `assets/js/admin/app.js`
- Create: `admin/index.html`

**Interfaces:**
- Consumes: `sb`, `perfis`.
- Produces:
  - `entrar(email, senha)`, `sair()`, `getPerfil()`, `registrarLog(acao, entidade, entidadeId, detalhe)`
  - `iniciarAdmin()` e o contrato de aba: `renderX(root, ctx)` retornando opcionalmente uma função de limpeza.

- [ ] **Step 1: Copiar os tokens de design para `assets/css/base.css`**

Copie o bloco `:root` e os overrides de `html[data-theme="dark"]` de `index.html` (linhas 9-121) para `assets/css/base.css`, mantendo os mesmos nomes de variáveis. Inclua reset básico:

```css
[hidden] { display: none !important; }
*, *::before, *::after { box-sizing: inherit; }
html { color-scheme: dark; }
html, body { margin: 0; padding: 0; background: var(--color-bg-page); }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Arial, sans-serif; color: var(--color-text-primary); }
button, input, select, textarea { font-family: inherit; }
```

- [ ] **Step 2: Criar `assets/js/auth.js`**

```js
import { sb } from './db.js';

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message);
  return data;
}

export async function sair() {
  await sb.auth.signOut();
}

export async function getPerfil() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('perfis').select('*').eq('id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function ehAdmin(perfil) {
  return perfil?.papel === 'admin' && perfil?.ativo !== false;
}

export function ehEquipe(perfil) {
  return ['admin', 'operador'].includes(perfil?.papel) && perfil?.ativo !== false;
}

export async function registrarLog(acao, entidade = null, entidadeId = null, detalhe = null) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('logs').insert({
    user_id: user.id,
    user_email: user.email,
    acao,
    entidade,
    entidade_id: entidadeId == null ? null : String(entidadeId),
    detalhe
  });
}
```

- [ ] **Step 3: Criar `admin/index.html`**

```html
<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — Churrasco na Marmita</title>
  <link rel="stylesheet" href="../assets/css/base.css" />
  <link rel="stylesheet" href="../assets/css/admin.css" />
</head>
<body>
  <section id="loginView" class="login-view" hidden>
    <form id="loginForm" class="login-card">
      <h1>Churrasco na Marmita</h1>
      <p>Acesso administrativo</p>
      <label for="loginEmail">E-mail</label>
      <input id="loginEmail" type="email" autocomplete="username" required />
      <label for="loginSenha">Senha</label>
      <input id="loginSenha" type="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
      <div id="loginErro" class="erro" role="alert"></div>
    </form>
  </section>

  <div id="appView" hidden>
    <header class="admin-header">
      <div>
        <strong>Churrasco na Marmita</strong>
        <span id="stagingBadge" class="badge-staging" hidden>STAGING</span>
      </div>
      <div class="admin-user">
        <span id="usuarioInfo"></span>
        <button id="sairBtn" type="button" class="btn-ghost">Sair</button>
      </div>
    </header>
    <nav id="tabs" class="admin-tabs" aria-label="Seções do admin"></nav>
    <main id="tabRoot" class="admin-main"></main>
  </div>

  <div id="modalRoot"></div>

  <script src="../assets/vendor/supabase-js.umd.js"></script>
  <script src="../assets/vendor/sortable.min.js"></script>
  <script type="module" src="../assets/js/admin/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Criar `assets/js/admin/app.js`**

```js
import { IS_STAGING } from '../config.js';
import { entrar, sair, getPerfil, ehAdmin, ehEquipe } from '../auth.js';
import { sb } from '../db.js';
import { renderPedidos } from './pedidos.js';
import { renderMotoboys } from './motoboys.js';
import { renderFinanceiro } from './financeiro.js';
import { renderCardapio } from './cardapio.js';
import { renderSeguranca } from './seguranca.js';

const TABS = [
  { id: 'pedidos', rotulo: 'Pedidos', render: renderPedidos, acesso: ehEquipe },
  { id: 'motoboys', rotulo: 'Motoboys', render: renderMotoboys, acesso: ehEquipe },
  { id: 'financeiro', rotulo: 'Financeiro', render: renderFinanceiro, acesso: ehAdmin },
  { id: 'cardapio', rotulo: 'Cardápio/Loja', render: renderCardapio, acesso: ehEquipe },
  { id: 'seguranca', rotulo: 'Segurança', render: renderSeguranca, acesso: ehEquipe }
];

let perfil = null;
let limparAba = null;

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const tabRoot = document.getElementById('tabRoot');
const tabsEl = document.getElementById('tabs');

function mostrarLogin(erro = '') {
  loginView.hidden = false;
  appView.hidden = true;
  document.getElementById('loginErro').textContent = erro;
}

async function iniciar() {
  document.getElementById('stagingBadge').hidden = !IS_STAGING;
  loginView.hidden = false;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  try {
    perfil = await getPerfil();
  } catch (e) {
    perfil = null;
  }
  if (!perfil || perfil.ativo === false || perfil.papel === 'pendente') {
    await sair();
    mostrarLogin('Seu acesso ainda não foi liberado por um administrador.');
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  document.getElementById('usuarioInfo').textContent = `${perfil.nome || perfil.email} · ${perfil.papel}`;

  const visiveis = TABS.filter(t => t.acesso(perfil));
  tabsEl.innerHTML = visiveis.map(t =>
    `<button type="button" class="tab" data-tab="${t.id}">${t.rotulo}</button>`
  ).join('');
  tabsEl.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.tab; });
  });

  const alvo = location.hash.replace('#', '') || 'pedidos';
  await abrirAba(visiveis.some(t => t.id === alvo) ? alvo : 'pedidos');
}

async function abrirAba(id) {
  const tab = TABS.find(t => t.id === id && t.acesso(perfil));
  if (!tab) return;
  if (typeof limparAba === 'function') limparAba();
  limparAba = null;
  tabsEl.querySelectorAll('.tab').forEach(b => b.classList.toggle('ativo', b.dataset.tab === id));
  tabRoot.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    limparAba = await tab.render(tabRoot, { perfil }) || null;
  } catch (e) {
    tabRoot.innerHTML = `<p class="erro">Erro ao carregar: ${e.message}</p>`;
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('loginErro').textContent = '';
  try {
    await entrar(
      document.getElementById('loginEmail').value.trim(),
      document.getElementById('loginSenha').value
    );
    await iniciar();
  } catch (err) {
    document.getElementById('loginErro').textContent = err.message;
  }
});

document.getElementById('sairBtn').addEventListener('click', async () => {
  if (typeof limparAba === 'function') limparAba();
  await sair();
  perfil = null;
  mostrarLogin();
});

window.addEventListener('hashchange', () => {
  if (perfil) abrirAba(location.hash.replace('#', '') || 'pedidos');
});

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { perfil = null; mostrarLogin(); }
});

iniciar();
```

- [ ] **Step 5: Criar módulos de aba temporários para o shell compilar**

Crie `assets/js/admin/pedidos.js`, `motoboys.js`, `financeiro.js`, `cardapio.js` e `seguranca.js` com o mesmo contrato, retornando um placeholder funcional. Exemplo de `pedidos.js`:
```js
export async function renderPedidos(root, ctx) {
  root.innerHTML = `<h2>Pedidos</h2><p>Em construção.</p>`;
}
```
Repita o padrão nos demais, trocando o título. `seguranca.js` exporta `renderSeguranca`.

- [ ] **Step 6: Criar `assets/css/admin.css` mínimo**

```css
.login-view { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card { width: min(380px, 100%); display: grid; gap: 10px; padding: 28px; border: 1px solid var(--color-border-default); border-radius: 12px; background: var(--color-bg-surface); }
.login-card h1 { margin: 0; font-size: 22px; }
.login-card p { margin: 0 0 8px; color: var(--color-text-secondary); font-size: 14px; }
.login-card label { font-size: 13px; font-weight: 600; }
.login-card input { padding: 12px; border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-page); color: var(--color-text-primary); }
.login-card button { padding: 12px; border: none; border-radius: 8px; background: var(--color-brand-primary); color: var(--color-text-on-brand); font-weight: 700; cursor: pointer; }
.erro { color: var(--color-error); font-size: 13px; min-height: 18px; }
.admin-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--color-border-default); background: var(--color-bg-surface); flex-wrap: wrap; }
.admin-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 8px 16px; border-bottom: 1px solid var(--color-border-default); background: var(--color-bg-page); }
.tab { white-space: nowrap; padding: 9px 14px; border: 1px solid transparent; border-radius: 8px; background: none; color: var(--color-text-secondary); font-weight: 600; cursor: pointer; }
.tab.ativo { background: var(--color-bg-subtle); border-color: var(--color-border-default); color: var(--color-text-primary); }
.admin-main { padding: 20px; max-width: 1300px; margin: 0 auto; }
.badge-staging { margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(245,158,11,.18); color: var(--color-warning); font-size: 11px; font-weight: 800; }
.carregando { color: var(--color-text-tertiary); }
.btn-ghost { padding: 8px 12px; border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-page); color: var(--color-text-primary); cursor: pointer; }
```

- [ ] **Step 7: Testar login e papéis no staging**

Pré-requisito: crie no painel do Supabase de staging, em Authentication > Users, um usuário admin (e-mail confirmado) e um operador. Rode no SQL Editor:
```sql
update perfis set papel = 'admin', ativo = true where email = 'EMAIL_DO_ADMIN';
update perfis set papel = 'operador', ativo = true where email = 'EMAIL_DO_OPERADOR';
```
Depois:
1. Rode `npm run serve`.
2. Abra `http://localhost:3000/admin/`.
3. Faça login com o admin: veja as abas Pedidos, Motoboys, Financeiro, Cardápio/Loja e Segurança.
4. Saia e entre com o operador: Financeiro não aparece; Segurança aparece apenas com o próprio perfil (a subaba de usuários/auditoria será restrita na Task 14).
5. Tente uma senha errada: mensagem de erro visível.

- [ ] **Step 8: Commit**

```bash
git add admin/ assets/css/ assets/js/auth.js assets/js/admin/app.js assets/js/admin/pedidos.js assets/js/admin/motoboys.js assets/js/admin/financeiro.js assets/js/admin/cardapio.js assets/js/admin/seguranca.js
git commit -m "feat: adiciona login, papéis e shell do admin

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Auditoria (registro e tela)

**Files:**
- Create: `assets/js/admin/logs.js`
- Modify: `assets/js/admin/seguranca.js`
- Modify: `assets/js/admin/app.js` (registrar login/logout)
- Test: manual

**Interfaces:**
- Consumes: `registrarLog`, `listarLogs`, `ehAdmin`.
- Produces: `renderLogs(root, ctx)`.

- [ ] **Step 1: Criar `assets/js/admin/logs.js`**

```js
import { listarLogs } from '../db.js';
import { fmtDataHora, esc } from '../format.js';

export async function renderLogs(root, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    root.innerHTML = '<p class="erro">Apenas administradores podem ver a auditoria.</p>';
    return;
  }
  root.innerHTML = '<p class="carregando">Carregando auditoria…</p>';
  const logs = await listarLogs({ limite: 200 });
  root.innerHTML = `
    <h2>Auditoria</h2>
    <p class="dica">Últimos 200 eventos registrados.</p>
    <div class="tabela-wrap">
      <table>
        <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhe</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td>${fmtDataHora(l.criado_em)}</td>
              <td>${esc(l.user_email || '—')}</td>
              <td><strong>${esc(l.acao)}</strong></td>
              <td>${esc(l.entidade || '—')}${l.entidade_id ? ' #' + esc(l.entidade_id) : ''}</td>
              <td><code>${esc(JSON.stringify(l.detalhe || {}))}</code></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
```

- [ ] **Step 2: Criar a aba Segurança com subabas**

`assets/js/admin/seguranca.js`:
```js
import { ehAdmin, registrarLog } from '../auth.js';
import { sb } from '../db.js';
import { esc } from '../format.js';
import { renderLogs } from './logs.js';
import { renderUsuarios } from './usuarios.js';

const SUBABAS = [
  { id: 'perfil', rotulo: 'Meu perfil' },
  { id: 'usuarios', rotulo: 'Usuários', admin: true },
  { id: 'logs', rotulo: 'Auditoria', admin: true }
];

export async function renderSeguranca(root, ctx) {
  const admin = ehAdmin(ctx.perfil);
  const visiveis = SUBABAS.filter(s => !s.admin || admin);
  const alvo = location.hash.split('/')[1] || 'perfil';

  root.innerHTML = `
    <h2>Segurança</h2>
    <nav class="subabas">
      ${visiveis.map(s => `<button type="button" class="subaba ${s.id === alvo ? 'ativo' : ''}" data-sub="${s.id}">${s.rotulo}</button>`).join('')}
    </nav>
    <div id="subRoot"></div>`;

  const subRoot = root.querySelector('#subRoot');

  async function abrir(id) {
    root.querySelectorAll('.subaba').forEach(b => b.classList.toggle('ativo', b.dataset.sub === id));
    if (id === 'usuarios' && admin) return renderUsuarios(subRoot, ctx);
    if (id === 'logs' && admin) return renderLogs(subRoot, ctx);
    return renderPerfil(subRoot, ctx);
  }

  root.querySelectorAll('.subaba').forEach(b => {
    b.addEventListener('click', () => abrir(b.dataset.sub));
  });

  await abrir(visiveis.some(s => s.id === alvo) ? alvo : 'perfil');
}

async function renderPerfil(root, ctx) {
  const { data: { user } } = await sb.auth.getUser();
  root.innerHTML = `
    <form id="perfilForm" class="form-grid">
      <h3>Meu perfil</h3>
      <label>Nome<input id="perfilNome" value="${esc(ctx.perfil?.nome || '')}" /></label>
      <label>E-mail<input value="${esc(ctx.perfil?.email || user?.email || '')}" disabled /></label>
      <label>Nova senha<input id="perfilSenha" type="password" autocomplete="new-password" placeholder="Deixe em branco para manter" /></label>
      <div class="acoes">
        <button type="submit" class="btn">Salvar</button>
      </div>
      <div id="perfilMsg" class="msg"></div>
    </form>`;

  root.querySelector('#perfilForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = root.querySelector('#perfilMsg');
    try {
      const nome = root.querySelector('#perfilNome').value.trim();
      const senha = root.querySelector('#perfilSenha').value;
      if (!nome && !senha) {
        msg.textContent = 'Nada para salvar.';
        msg.className = 'msg';
        return;
      }
      if (nome) {
        const { error } = await sb.rpc('atualizar_meu_nome', { novo_nome: nome });
        if (error) throw new Error(error.message);
      }
      if (senha) {
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw new Error(error.message);
      }
      await registrarLog('atualizar_perfil', 'perfis', user.id, { nome, trocou_senha: Boolean(senha) });
      msg.textContent = 'Perfil atualizado.';
      msg.className = 'msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'msg erro';
    }
  });
}
```

Crie também `assets/js/admin/usuarios.js` com um placeholder funcional (a Task 14 substitui):
```js
export async function renderUsuarios(root) {
  root.innerHTML = '<h3>Usuários</h3><p>Em construção.</p>';
}
```

- [ ] **Step 3: Registrar login e logout em `app.js`**

No handler de login, após `await iniciar()`:
```js
await registrarLog('login', 'auth', null, { email: document.getElementById('loginEmail').value.trim() });
```
Importe `registrarLog` de `../auth.js`. No handler de logout, antes de `await sair()`:
```js
await registrarLog('logout', 'auth', null, { email: perfil?.email });
```

- [ ] **Step 4: Adicionar estilos de tabela e subabas em `admin.css`**

```css
.subabas { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.subaba { padding: 8px 12px; border: 1px solid var(--color-border-default); border-radius: 999px; background: var(--color-bg-page); color: var(--color-text-secondary); cursor: pointer; }
.subaba.ativo { background: var(--color-brand-primary); color: var(--color-text-on-brand); border-color: var(--color-brand-primary); }
.tabela-wrap { overflow-x: auto; border: 1px solid var(--color-border-default); border-radius: 12px; background: var(--color-bg-surface); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 10px 12px; border-bottom: 1px solid var(--color-border-subtle); text-align: left; vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--color-text-tertiary); }
td code { font-size: 12px; word-break: break-all; }
.form-grid { display: grid; gap: 12px; max-width: 520px; }
.form-grid label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
.form-grid input, .form-grid select, .form-grid textarea { padding: 10px 12px; border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-page); color: var(--color-text-primary); }
.btn { padding: 10px 16px; border: none; border-radius: 8px; background: var(--color-brand-primary); color: var(--color-text-on-brand); font-weight: 700; cursor: pointer; }
.msg { font-size: 13px; min-height: 18px; }
.msg.ok { color: var(--color-success); }
.msg.erro { color: var(--color-error); }
.dica { color: var(--color-text-secondary); font-size: 13px; }
```

- [ ] **Step 5: Testar a auditoria**

1. Faça login com o admin.
2. Abra Segurança > Auditoria.
3. Confirme os eventos `login` e `atualizar_perfil`.
4. Saia e entre com o operador: as subabas Usuários e Auditoria não aparecem.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin/logs.js assets/js/admin/seguranca.js assets/js/admin/usuarios.js assets/js/admin/app.js assets/css/admin.css
git commit -m "feat: adiciona auditoria e tela de segurança

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Fase 2 — Operação

### Task 7: CRUD de bairros dentro da aba Pedidos

**Files:**
- Create: `assets/js/admin/bairros.js`
- Modify: `assets/js/admin/pedidos.js`
- Modify: `assets/css/admin.css`
- Test: manual

**Interfaces:**
- Consumes: `listarBairros`, `salvarBairro`, `excluirBairro`, `validarBairro`, `registrarLog`.
- Produces: `renderBairros(container, ctx)`.

- [ ] **Step 1: Criar `assets/js/admin/bairros.js`**

```js
import { listarBairros, salvarBairro, excluirBairro, contarPedidosBairro } from '../db.js';
import { validarBairro } from '../calc.js';
import { fmtBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderBairros(container, ctx) {
  let bairros = await listarBairros();

  container.innerHTML = `
    <section class="painel-bairros">
      <div class="painel-topo">
        <h3>Bairros e taxas</h3>
        <button type="button" id="novoBairroBtn" class="btn">+ Novo bairro</button>
      </div>
      <div id="bairroFormArea"></div>
      <div id="bairroLista"></div>
    </section>`;

  const lista = container.querySelector('#bairroLista');
  const formArea = container.querySelector('#bairroFormArea');

  function desenharLista() {
    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Ordem</th><th>Bairro</th><th>Grupo</th><th>Taxa</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${bairros.map(b => `
              <tr>
                <td>${b.ordem}</td>
                <td><strong>${esc(b.nome)}</strong></td>
                <td>${esc(b.grupo)}</td>
                <td>${fmtBRL(b.taxa)}</td>
                <td>${b.ativo ? 'Sim' : 'Não'}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${b.id}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${b.id}">Excluir</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirForm(bairros.find(b => String(b.id) === btn.dataset.edit)));
    });
    lista.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => remover(bairros.find(b => String(b.id) === btn.dataset.del)));
    });
  }

  function abrirForm(bairro = {}) {
    formArea.innerHTML = `
      <form id="bairroForm" class="form-grid painel-form">
        <h4>${bairro.id ? 'Editar' : 'Novo'} bairro</h4>
        <label>Nome<input id="bNome" value="${esc(bairro.nome || '')}" required /></label>
        <label>Taxa (R$)<input id="bTaxa" type="number" min="0" step="0.01" value="${bairro.taxa ?? 0}" required /></label>
        <label>Grupo
          <select id="bGrupo">
            <option value="Bairro" ${bairro.grupo === 'Bairro' ? 'selected' : ''}>Bairro</option>
            <option value="Condomínio" ${bairro.grupo === 'Condomínio' ? 'selected' : ''}>Condomínio</option>
          </select>
        </label>
        <label>Ordem<input id="bOrdem" type="number" step="1" value="${bairro.ordem ?? 0}" /></label>
        <label class="linha-check"><input id="bAtivo" type="checkbox" ${bairro.ativo !== false ? 'checked' : ''} /> Ativo no cardápio</label>
        <div id="bErros" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="bCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#bCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#bairroForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = {
        id: bairro.id,
        nome: formArea.querySelector('#bNome').value,
        taxa: Number(formArea.querySelector('#bTaxa').value),
        grupo: formArea.querySelector('#bGrupo').value,
        ordem: Number(formArea.querySelector('#bOrdem').value),
        ativo: formArea.querySelector('#bAtivo').checked
      };
      const erros = validarBairro(dados);
      if (erros.length) {
        formArea.querySelector('#bErros').textContent = erros.join(' ');
        return;
      }
      await salvarBairro(dados);
      await registrarLog(dados.id ? 'editar_bairro' : 'criar_bairro', 'bairros', dados.id || null, dados);
      bairros = await listarBairros();
      formArea.innerHTML = '';
      desenharLista();
    });
  }

  async function remover(b) {
    if (!b) return;
    const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentes = await contarPedidosBairro(b.nome, desde);
    if (recentes > 0) {
      alert(`"${b.nome}" aparece em ${recentes} pedido(s) nos últimos 90 dias. Desative o bairro em vez de excluir.`);
      return;
    }
    if (!confirm(`Excluir o bairro "${b.nome}"?`)) return;
    await excluirBairro(b.id);
    await registrarLog('excluir_bairro', 'bairros', b.id, { nome: b.nome });
    bairros = await listarBairros();
    desenharLista();
  }

  container.querySelector('#novoBairroBtn').addEventListener('click', () => abrirForm());
  desenharLista();
}
```

**Nota de robustez (R28):** envolva `listarBairros`, `salvarBairro` e `excluirBairro` em try/catch e, quando a gravação der certo, trate `registrarLog` em um try/catch separado. Uma falha de auditoria não pode fazer uma gravação bem-sucedida parecer falha: recarregue a lista e limpe o formulário mesmo assim. Inclua estado vazio (`Nenhum bairro cadastrado.`) e recarregue o painel cada vez que ele for aberto.

- [ ] **Step 2: Integrar o painel na aba Pedidos**

Em `assets/js/admin/pedidos.js`, importe e renderize um botão que abre/fecha o painel:
```js
import { renderBairros } from './bairros.js';

export async function renderPedidos(root, ctx) {
  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Pedidos</h2>
      <button type="button" id="toggleBairros" class="btn-ghost">Bairros e taxas</button>
    </div>
    <div id="bairrosArea" hidden></div>
    <div id="kanbanArea"><p class="carregando">Carregando pedidos…</p></div>`;

  const area = root.querySelector('#bairrosArea');
  root.querySelector('#toggleBairros').addEventListener('click', async () => {
    area.hidden = !area.hidden;
    if (!area.hidden && !area.dataset.carregado) {
      await renderBairros(area, ctx);
      area.dataset.carregado = '1';
    }
  });
}
```

- [ ] **Step 3: Adicionar estilos**

```css
.barra-pedidos { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.painel-bairros { border: 1px solid var(--color-border-default); border-radius: 12px; padding: 16px; background: var(--color-bg-surface); margin-bottom: 16px; }
.painel-topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.painel-form { margin-bottom: 16px; padding: 16px; border: 1px dashed var(--color-border-strong); border-radius: 10px; }
.linha-check { display: flex !important; align-items: center; gap: 8px; font-weight: 400 !important; }
.acoes { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-mini { padding: 6px 10px; border: 1px solid var(--color-border-default); border-radius: 6px; background: var(--color-bg-page); color: var(--color-text-primary); cursor: pointer; font-size: 12px; }
.btn-mini.perigo { color: var(--color-error); border-color: var(--color-border-error); }
```

- [ ] **Step 4: Testar no staging**

1. Abra Pedidos > Bairros e taxas.
2. Adicione um bairro de teste com taxa 12.
3. Edite a taxa para 15.
4. Desative e reative.
5. Exclua o bairro de teste.
6. Confirme na tabela `bairros` do staging.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/bairros.js assets/js/admin/pedidos.js assets/css/admin.css
git commit -m "feat: adiciona CRUD de bairros na aba de pedidos

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Lógica do Kanban (pura, com testes)

**Files:**
- Modify: `assets/js/calc.js`
- Create: `tests/kanban.test.mjs`

**Interfaces:**
- Consumes: `ETAPAS`, `agruparKanban`.
- Produces:
  - `totalColuna(pedidos): number` (exclui cancelados)
  - `podeMover(pedido, destino): { ok: boolean, motivo?: string }`
  - `ordenarPorPosicao(pedidos): Pedido[]`
  - `rotuloEtapa(etapa): string`

- [ ] **Step 1: Escrever os testes**

`tests/kanban.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalColuna, podeMover, ordenarPorPosicao, rotuloEtapa, ETAPAS } from '../assets/js/calc.js';

test('totalColuna ignora cancelados', () => {
  const col = [
    { total: 10, cancelado: false },
    { total: 20, cancelado: true },
    { total: 5, cancelado: false }
  ];
  assert.equal(totalColuna(col), 15);
});

test('podeMover aceita todas as etapas válidas', () => {
  for (const destino of ETAPAS) {
    assert.equal(podeMover({ cancelado: false }, destino).ok, true);
  }
});

test('podeMover rejeita etapa inválida e cancelado', () => {
  assert.equal(podeMover({ cancelado: false }, 'inexistente').ok, false);
  assert.equal(podeMover({ cancelado: true }, 'novo').ok, false);
});

test('ordenarPorPosicao ordena crescente', () => {
  const r = ordenarPorPosicao([{ posicao: 3 }, { posicao: 1 }, { posicao: 2 }]);
  assert.deepEqual(r.map(p => p.posicao), [1, 2, 3]);
});

test('rotuloEtapa devolve o texto humano', () => {
  assert.equal(rotuloEtapa('preparo'), 'Em preparo');
  assert.equal(rotuloEtapa('entrega'), 'Em entrega');
  assert.equal(rotuloEtapa('cancelado'), 'Cancelado');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL nos novos testes.

- [ ] **Step 3: Implementar em `calc.js`**

Adicione:
```js
export function totalColuna(pedidos) {
  return arred2((pedidos || [])
    .filter(p => !p.cancelado)
    .reduce((s, p) => s + Number(p.total || 0), 0));
}

export function podeMover(pedido, destino) {
  if (!ETAPAS.includes(destino)) return { ok: false, motivo: 'Etapa inválida.' };
  if (pedido?.cancelado) return { ok: false, motivo: 'Restaure o pedido antes de movê-lo.' };
  return { ok: true };
}

export function ordenarPorPosicao(pedidos) {
  return [...(pedidos || [])].sort((a, b) => Number(a.posicao || 0) - Number(b.posicao || 0));
}

export function rotuloEtapa(etapa) {
  return ROTULOS[etapa] || 'Novo';
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/calc.js tests/kanban.test.mjs
git commit -m "feat: adiciona lógica pura do kanban com testes

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Kanban com arrastar e soltar, cancelamento, restauração e impressão

**Files:**
- Create: `assets/js/admin/kanban.js`
- Create: `assets/js/admin/impressao.js`
- Create: `assets/js/financeiro-sync.js`
- Modify: `assets/js/admin/pedidos.js`
- Modify: `assets/css/admin.css`
- Modify: `admin/index.html`
- Test: manual

**Interfaces:**
- Consumes: `listarPedidosKanban`, `atualizarPedido`, `listarMotoboys`, `agruparKanban`, `totalColuna`, `rotuloEtapa`, `podeAtribuirMotoboy`, `podeMover`, `fmtBRL`, `fmtDataHora`, `dataBR`, `registrarLog`, `sincronizarEntradaPedido`, `removerLancamentosAutomaticos`.
- Produces: `montarKanban({ container, pedidos, motoboys, perfil, onMover, onAtribuir, onAbrir, onCancelar, onRestaurar })`; `imprimirPedido(pedido, opts)`; `copiarEndereco(pedido)`; `sincronizarEntradaPedido(pedido)`; `removerLancamentosAutomaticos(pedidoId)`.

- [ ] **Step 0: Criar `assets/js/financeiro-sync.js`**

O Kanban precisa remover lançamentos automáticos ao cancelar um pedido. Crie o módulo agora; a Task 10 o reutiliza no faturamento.

```js
import { sb } from './db.js';
import { dataBR } from './format.js';

async function usuarioAtualId() {
  const { data: { user } } = await sb.auth.getUser();
  return user?.id || null;
}

async function lancamentoDoPedido(pedidoId, origem) {
  const { data, error } = await sb.from('financeiro')
    .select('id').eq('pedido_id', pedidoId).eq('origem', origem).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function sincronizarEntradaPedido(pedido) {
  if (!pedido) return;
  if (pedido.cancelado || !pedido.finalizado) {
    return removerLancamento(pedido.id, 'pedido');
  }
  const valor = Number(pedido.valor_bruto ?? pedido.total ?? 0);
  const existente = await lancamentoDoPedido(pedido.id, 'pedido');
  const payload = {
    tipo: 'entrada',
    categoria: 'vendas',
    descricao: `Pedido #${pedido.id} — ${pedido.cliente || 'cliente'}`,
    valor,
    data: dataBR(pedido.created_at || new Date().toISOString()),
    pedido_id: pedido.id,
    origem: 'pedido',
    criado_por: await usuarioAtualId()
  };
  if (existente) {
    const { error } = await sb.from('financeiro').update(payload).eq('id', existente.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from('financeiro').insert(payload);
    if (error) throw new Error(error.message);
  }
}

export async function sincronizarTaxaFaturamento(pedidoId, valorTaxa, descricao) {
  if (!valorTaxa || valorTaxa <= 0) return removerLancamento(pedidoId, 'taxa');
  const existente = await lancamentoDoPedido(pedidoId, 'taxa');
  const payload = {
    tipo: 'saida',
    categoria: 'taxa_ifood',
    descricao: descricao || `Taxa do pedido #${pedidoId}`,
    valor: Number(valorTaxa),
    data: dataBR(new Date().toISOString()),
    pedido_id: pedidoId,
    origem: 'taxa',
    criado_por: await usuarioAtualId()
  };
  if (existente) {
    const { error } = await sb.from('financeiro').update(payload).eq('id', existente.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from('financeiro').insert(payload);
    if (error) throw new Error(error.message);
  }
}

export async function removerLancamento(pedidoId, origem) {
  const { error } = await sb.from('financeiro')
    .delete().eq('pedido_id', pedidoId).eq('origem', origem);
  if (error) throw new Error(error.message);
}

export async function removerLancamentosAutomaticos(pedidoId) {
  await removerLancamento(pedidoId, 'pedido');
  await removerLancamento(pedidoId, 'taxa');
}
```

- [ ] **Step 1: Criar `assets/js/admin/impressao.js`**

```js
import { fmtBRL, fmtDataHora, esc } from '../format.js';
import { atualizarPedido } from '../db.js';

export function buildLabel(pedido) {
  const itens = (pedido.itens && pedido.itens.length)
    ? pedido.itens.map(it => `${it.quantidade}x ${esc(it.produto)}`).join('<br>')
    : '—';
  return `<div class="plabel">
    <div class="l-brand">CHURRASCO NA MARMITA</div>
    <div class="l-carinho">Feito com muito carinho, para você!</div>
    <div class="l-num">Pedido #${pedido.seqDia || pedido.id || '—'}</div>
    <div class="l-sub">Lagoa Santa - MG · ${fmtDataHora(pedido.created_at)}</div>
    <div class="l-cust">${esc(pedido.cliente)}</div>
    <div class="l-line">📞 ${esc(pedido.telefone)}</div>
    <div class="l-line">📍 ${esc(pedido.bairro)}${pedido.endereco ? ' — ' + esc(pedido.endereco) : ''}</div>
    <div class="l-sep"></div>
    <div class="l-items">${itens}</div>
    ${pedido.cancelado ? '<div class="l-obs" style="font-weight:800;font-size:14px;color:#c00">❌ CANCELADO</div>' : ''}
    ${pedido.observacao ? `<div class="l-obs">Obs: ${esc(pedido.observacao)}</div>` : ''}
    <div class="l-sep"></div>
    <div class="l-total">TOTAL ${fmtBRL(pedido.total)}</div>
    <div class="l-pay">Pagamento: ${esc(pedido.pagamento)}</div>
    <div class="l-sep2"></div>
    <div class="l-foot">📸 @churrasco_marmita</div>
    <div class="l-foot">📞 +55 (31) 9381-7229</div>
  </div>`;
}

export async function imprimirPedido(pedido) {
  const area = document.getElementById('printArea');
  area.innerHTML = buildLabel(pedido);
  try {
    await atualizarPedido(pedido.id, {
      impresso: true,
      impresso_em: new Date().toISOString()
    });
  } catch (e) {
    console.warn('Falha ao marcar impressão:', e);
  }
  window.print();
}

export async function copiarEndereco(pedido) {
  const texto = [
    `Pedido #${pedido.seqDia || pedido.id}`,
    pedido.cliente,
    pedido.telefone,
    `${pedido.bairro || '—'}${pedido.endereco ? ' - ' + pedido.endereco : ''}`,
    fmtBRL(pedido.total)
  ].join(' | ');
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (e) {
    window.prompt('Copie o endereço:', texto);
    return false;
  }
}
```

- [ ] **Step 2: Criar `assets/js/admin/kanban.js`**


```js
import { ETAPAS, ROTULOS, agruparKanban, totalColuna, podeAtribuirMotoboy, podeMover, proximaEtapa } from '../calc.js';
import { fmtBRL, fmtDataHora, esc } from '../format.js';

export function montarKanban({ container, pedidos, motoboys, perfil, onMover, onAtribuir, onAbrir, onCancelar, onRestaurar }) {
  const grupos = agruparKanban(pedidos);
  const ativos = motoboys.filter(m => m.ativo !== false);

  container.innerHTML = `
    <div class="kanban">
      ${ETAPAS.map(etapa => `
        <section class="coluna" data-etapa="${etapa}">
          <header class="coluna-topo">
            <h3>${ROTULOS[etapa]}</h3>
            <span>${grupos[etapa].filter(p => !p.cancelado).length} · ${fmtBRL(totalColuna(grupos[etapa]))}</span>
          </header>
          <div class="coluna-cards" data-etapa="${etapa}">
            ${grupos[etapa].map(p => cartao(p, etapa, ativos, perfil)).join('')}
          </div>
        </section>`).join('')}
    </div>`;

  container.querySelectorAll('.cartao').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button,select')) return;
      onAbrir(Number(el.dataset.id));
    });
  });

  container.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const pedido = pedidos.find(p => Number(p.id) === id);
      if (!pedido) return;
      if (btn.dataset.acao === 'prev') onMover(pedido, proximaEtapa(pedido.status_kanban, -1));
      if (btn.dataset.acao === 'next') onMover(pedido, proximaEtapa(pedido.status_kanban, 1));
      if (btn.dataset.acao === 'cancelar') onCancelar(pedido);
      if (btn.dataset.acao === 'restaurar') onRestaurar(pedido);
    });
  });

  container.querySelectorAll('[data-motoboy]').forEach(sel => {
    sel.addEventListener('change', () => {
      const pedido = pedidos.find(p => Number(p.id) === Number(sel.dataset.motoboy));
      if (pedido) onAtribuir(pedido, sel.value ? Number(sel.value) : null);
    });
  });

  if (window.Sortable) {
    container.querySelectorAll('.coluna-cards').forEach(lista => {
      Sortable.create(lista, {
        group: 'pedidos',
        animation: 150,
        ghostClass: 'cartao-fantasma',
        onEnd: async (evt) => {
          const id = Number(evt.item.dataset.id);
          const pedido = pedidos.find(p => Number(p.id) === id);
          const destino = evt.to.dataset.etapa;
          if (!pedido) return;
          const regra = podeMover(pedido, destino);
          if (!regra.ok) {
            alert(regra.motivo);
            return onAbrir(pedido.id);
          }
          if (destino === 'cancelado') {
            return onCancelar(pedido);
          }
          await onMover(pedido, destino);
        }
      });
    });
  }
}

function cartao(p, etapa, motoboys, perfil) {
  const cancelado = p.cancelado;
  const podePrev = etapa !== 'novo' && etapa !== 'cancelado';
  const podeNext = etapa !== 'cancelado' && etapa !== 'concluido';
  const podeAtribuir = podeAtribuirMotoboy(p);
  return `
    <article class="cartao ${cancelado ? 'cancelado' : ''}" data-id="${p.id}">
      <div class="cartao-topo">
        <strong>${esc(p.cliente || 'Sem nome')}</strong>
        <span class="cartao-id">#${p.id}</span>
      </div>
      <div class="cartao-info">${esc(p.bairro || '—')} · ${fmtBRL(p.total)}</div>
      <div class="cartao-info">${fmtDataHora(p.created_at)} · ${esc(p.pagamento || '—')}</div>
      <div class="cartao-tags">
        ${p.canal === 'ifood' ? '<span class="tag-ifood">iFood</span>' : ''}
        ${p.origem === 'manual' ? '<span class="tag-manual">Manual</span>' : ''}
        ${p.faturado ? '<span class="tag-faturado">Faturado</span>' : ''}
        ${cancelado ? '<span class="tag-cancelado">Cancelado</span>' : ''}
      </div>
      ${podeAtribuir ? `
        <label class="cartao-motoboy">Motoboy
          <select data-motoboy="${p.id}">
            <option value="">Atribuir…</option>
            ${motoboys.map(m => `<option value="${m.id}" ${Number(p.motoboy_id) === Number(m.id) ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}
          </select>
        </label>` : ''}
      ${p.motoboy_id && !podeAtribuir ? `<div class="cartao-info">🛵 ${esc(nomeMotoboy(p.motoboy_id, motoboys))}</div>` : ''}
      <div class="cartao-acoes">
        ${podePrev ? `<button type="button" data-acao="prev" data-id="${p.id}" title="Voltar etapa">←</button>` : ''}
        ${podeNext ? `<button type="button" data-acao="next" data-id="${p.id}" title="Avançar etapa">→</button>` : ''}
        ${cancelado && perfil?.papel === 'admin' ? `<button type="button" data-acao="restaurar" data-id="${p.id}">Restaurar</button>` : ''}
        ${!cancelado ? `<button type="button" data-acao="cancelar" data-id="${p.id}" class="perigo">Cancelar</button>` : ''}
      </div>
    </article>`;
}

function nomeMotoboy(id, motoboys) {
  return motoboys.find(m => Number(m.id) === Number(id))?.nome || `Motoboy ${id}`;
}
```

- [ ] **Step 3: Substituir o placeholder de `pedidos.js` pelo Kanban real**

```js
import { listarPedidosKanban, atualizarPedido, listarMotoboys } from '../db.js';
import { registrarLog } from '../auth.js';
import { montarKanban } from './kanban.js';
import { renderBairros } from './bairros.js';
import { imprimirPedido, copiarEndereco } from './impressao.js';
import { sincronizarEntradaPedido, removerLancamento, removerLancamentosAutomaticos } from '../financeiro-sync.js';
import { fmtBRL, esc, dataBR } from '../format.js';

export async function renderPedidos(root, ctx) {
  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Pedidos</h2>
      <div class="acoes">
        <button type="button" id="toggleBairros" class="btn-ghost">Bairros e taxas</button>
        <span id="statusKanban" class="dica"></span>
      </div>
    </div>
    <div id="bairrosArea" hidden></div>
    <div id="kanbanArea"><p class="carregando">Carregando pedidos…</p></div>`;

  const kanbanArea = root.querySelector('#kanbanArea');
  const statusEl = root.querySelector('#statusKanban');
  let pedidos = [];
  let motoboys = [];
  let parado = false;
  let timer = null;

  async function carregar() {
    const [lista, m] = await Promise.all([
      listarPedidosKanban(inicioDoDiaISO()),
      listarMotoboys()
    ]);
    motoboys = m;
    pedidos = comSequenciaDia(lista);
    desenhar();
  }

  function desenhar() {
    montarKanban({
      container: kanbanArea,
      pedidos,
      motoboys,
      perfil: ctx.perfil,
      onMover: mover,
      onAtribuir: atribuir,
      onAbrir: (id) => abrirDetalhe(id),
      onCancelar: (pedido) => abrirCancelamento(pedido),
      onRestaurar: restaurar
    });
  }

  async function mover(pedido, destino) {
    if (destino === pedido.status_kanban) return;
    const patch = { status_kanban: destino, posicao: Date.now() };
    if (destino === 'concluido') patch.entregue_em = new Date().toISOString();
    try {
      await atualizarPedido(pedido.id, patch);
      await registrarLog('mover_pedido', 'pedidos', pedido.id, { de: pedido.status_kanban, para: destino });
      if (destino === 'concluido' && pedido.bairro !== 'Retirada no local' && !pedido.motoboy_id) {
        statusEl.textContent = 'Pedido concluído sem motoboy atribuído.';
      }
      await carregar();
    } catch (e) {
      statusEl.textContent = 'Erro ao mover: ' + e.message;
      await carregar();
    }
  }

  async function atribuir(pedido, motoboyId) {
    if (!motoboyId) return;
    const motoboy = motoboys.find(m => Number(m.id) === Number(motoboyId));
    if (!motoboy) return;
    await atualizarPedido(pedido.id, {
      motoboy_id: motoboy.id,
      motoboy_valor_entrega: Number(motoboy.valor_entrega || 0),
      motoboy_atribuido_em: new Date().toISOString()
    });
    await registrarLog('atribuir_motoboy', 'pedidos', pedido.id, { motoboy: motoboy.nome, valor: motoboy.valor_entrega });
    await carregar();
  }

  function abrirDetalhe(id) {
    const pedido = pedidos.find(p => Number(p.id) === Number(id));
    if (!pedido) return;
    abrirModalDetalhe(pedido, ctx, carregar);
  }

  function abrirCancelamento(pedido) {
    const rootModal = document.getElementById('modalRoot');
    rootModal.innerHTML = `
      <div class="modal-fundo">
        <form id="cancelForm" class="modal-caixa form-grid">
          <h3>Cancelar pedido #${pedido.seqDia || pedido.id}</h3>
          <p>${esc(pedido.cliente)} · ${fmtBRL(pedido.total)}</p>
          <label>Justificativa do cancelamento *<textarea id="cancelMotivo" rows="3" required></textarea></label>
          <fieldset class="ciencia">
            <legend>Ciência do cancelamento *</legend>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Bruno" /> Bruno</label>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Diego" /> Diego</label>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Gustavo" /> Gustavo</label>
          </fieldset>
          <div id="cancelErro" class="erro"></div>
          <div class="acoes">
            <button type="submit" class="btn">Confirmar cancelamento</button>
            <button type="button" id="cancelFechar" class="btn-ghost">Fechar</button>
          </div>
        </form>
      </div>`;

    rootModal.querySelector('#cancelFechar').addEventListener('click', () => {
      rootModal.innerHTML = '';
      carregar();
    });
    rootModal.querySelector('#cancelForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = rootModal.querySelector('#cancelMotivo').value.trim();
      const ciencia = [...rootModal.querySelectorAll('.ciencia-check:checked')].map(c => c.value);
      const erro = rootModal.querySelector('#cancelErro');
      if (!motivo) { erro.textContent = 'Informe a justificativa do cancelamento.'; return; }
      if (!ciencia.length) { erro.textContent = 'Selecione pelo menos uma pessoa para a ciência.'; return; }
      try {
        await atualizarPedido(pedido.id, {
          cancelado: true,
          status_kanban: 'cancelado',
          status_anterior: pedido.status_kanban === 'cancelado'
            ? (pedido.status_anterior || 'novo')
            : pedido.status_kanban,
          motivo_cancelamento: motivo,
          cancelado_por: ciencia.join(', '),
          cancelado_em: new Date().toISOString()
        });
        await removerLancamentosAutomaticos(pedido.id);
        await registrarLog('cancelar_pedido', 'pedidos', pedido.id, { motivo, ciencia });
        rootModal.innerHTML = '';
        await carregar();
      } catch (err) {
        erro.textContent = 'Falha ao cancelar: ' + err.message;
      }
    });
  }

  async function restaurar(pedido) {
    if (ctx.perfil?.papel !== 'admin') return alert('Apenas administradores podem restaurar.');
    const destino = pedido.status_anterior || 'novo';
    await atualizarPedido(pedido.id, {
      cancelado: false,
      status_kanban: destino,
      status_anterior: null,
      motivo_cancelamento: null,
      cancelado_por: null,
      cancelado_em: null,
      cancelado_ip: null
    });
    await registrarLog('restaurar_pedido', 'pedidos', pedido.id, { destino });
    await carregar();
  }

  const area = root.querySelector('#bairrosArea');
  root.querySelector('#toggleBairros').addEventListener('click', async () => {
    area.hidden = !area.hidden;
    if (!area.hidden && !area.dataset.carregado) {
      await renderBairros(area, ctx);
      area.dataset.carregado = '1';
    }
  });

  await carregar();
  timer = setInterval(() => {
    if (!parado && document.getElementById('kanbanArea')) carregar();
  }, 30000);

  return () => {
    parado = true;
    clearInterval(timer);
  };
}

function comSequenciaDia(pedidos) {
  const porDia = new Map();
  const ordenados = [...pedidos].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const p of ordenados) {
    const dia = dataBR(p.created_at);
    const n = (porDia.get(dia) || 0) + 1;
    porDia.set(dia, n);
    p.seqDia = n;
  }
  return pedidos;
}

function inicioDoDiaISO() {
  const agora = new Date();
  const br = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  br.setHours(0, 0, 0, 0);
  return new Date(br.getTime() + 3 * 60 * 60 * 1000).toISOString();
}

function abrirModalDetalhe(pedido, ctx, aoAtualizar) {
  const rootModal = document.getElementById('modalRoot');
  const admin = ctx.perfil?.papel === 'admin';
  const itens = (pedido.itens || []).map(it => `
    <tr>
      <td>${esc(it.produto)}</td>
      <td>${it.quantidade}x</td>
      <td>${it.subtotal == null ? '—' : fmtBRL(it.subtotal)}</td>
    </tr>`).join('');

  rootModal.innerHTML = `
    <div class="modal-fundo">
      <div class="modal-caixa">
        <h3>${esc(pedido.cliente)} · #${pedido.seqDia || pedido.id}</h3>
        <p><strong>Total:</strong> ${fmtBRL(pedido.total)}</p>
        <p><strong>Bairro:</strong> ${esc(pedido.bairro || '—')}</p>
        <p><strong>Endereço:</strong> ${esc(pedido.endereco || '—')}</p>
        <p><strong>Pagamento:</strong> ${esc(pedido.pagamento || '—')}</p>
        <p><strong>Canal:</strong> ${esc(pedido.canal || '—')}</p>
        <p><strong>Observação:</strong> ${esc(pedido.observacao || '—')}</p>
        <table class="detalhe-itens">
          <thead><tr><th>Produto</th><th>Qtd</th><th>Subtotal</th></tr></thead>
          <tbody>${itens || '<tr><td colspan="3">—</td></tr>'}</tbody>
        </table>
        <label class="linha-check">
          <input type="checkbox" id="pagoCheck" ${pedido.finalizado ? 'checked' : ''} ${admin ? '' : 'disabled'} />
          Pago${admin ? '' : ' (somente admin)'}
        </label>
        <div class="acoes">
          <button type="button" id="btnImprimir" class="btn-ghost">Imprimir etiqueta</button>
          <button type="button" id="btnCopiar" class="btn-ghost">Copiar endereço</button>
          ${admin && pedido.faturado ? '<button type="button" id="btnDesfaturar" class="btn-ghost">Desfaturar</button>' : ''}
          <button type="button" id="btnFechar" class="btn-ghost">Fechar</button>
        </div>
        <div id="detalheMsg" class="msg"></div>
      </div>
    </div>`;

  rootModal.querySelector('#btnFechar').addEventListener('click', () => { rootModal.innerHTML = ''; });
  rootModal.querySelector('#btnImprimir').addEventListener('click', () => imprimirPedido(pedido));
  rootModal.querySelector('#btnCopiar').addEventListener('click', async () => {
    const ok = await copiarEndereco(pedido);
    rootModal.querySelector('#detalheMsg').textContent = ok ? 'Endereço copiado.' : '';
  });

  rootModal.querySelector('#pagoCheck').addEventListener('change', async (e) => {
    if (!admin) return;
    const msg = rootModal.querySelector('#detalheMsg');
    if (!e.target.checked && pedido.faturado) {
      e.target.checked = true;
      msg.textContent = 'Desfature o pedido antes de desmarcar o pagamento.';
      return;
    }
    try {
      await atualizarPedido(pedido.id, {
        finalizado: e.target.checked,
        finalizado_em: e.target.checked ? new Date().toISOString() : null,
        finalizado_por: ctx.perfil?.email || 'painel'
      });
      await sincronizarEntradaPedido({ ...pedido, finalizado: e.target.checked });
      await registrarLog('marcar_pagamento', 'pedidos', pedido.id, { pago: e.target.checked });
      msg.textContent = 'Pagamento atualizado.';
      await aoAtualizar();
    } catch (err) {
      e.target.checked = !e.target.checked;
      msg.textContent = 'Falha ao atualizar pagamento: ' + err.message;
    }
  });

  const btnDesfaturar = rootModal.querySelector('#btnDesfaturar');
  if (btnDesfaturar) {
    btnDesfaturar.addEventListener('click', async () => {
      const msg = rootModal.querySelector('#detalheMsg');
      if (!confirm('Desfaturar este pedido? A taxa será removida do financeiro.')) return;
      try {
        await removerLancamento(pedido.id, 'taxa');
        await atualizarPedido(pedido.id, {
          faturado: false,
          valor_recebido: null,
          taxa: 0,
          faturado_em: null,
          faturado_por: null
        });
        await registrarLog('desfaturar_pedido', 'pedidos', pedido.id, {});
        msg.textContent = 'Pedido desfaturado.';
        await aoAtualizar();
      } catch (err) {
        msg.textContent = 'Falha ao desfaturar: ' + err.message;
      }
    });
  }
}
```

**Nota de robustez (R29–R35):** a restauração reconcilia o financeiro (recria entrada se pago; recria taxa se faturado). `podeMover` é validado dentro de `mover()`, não só no arrasto. `removerLancamentosAutomaticos` tenta as duas origens com `Promise.allSettled` e o catch do cancelamento recarrega o Kanban e mostra o erro. `carregar` tem try/catch, botão "Tentar novamente" e trava contra cargas sobrepostas. O início do dia usa `dataBR` + `T00:00:00-03:00`. O arrasto para a mesma coluna retorna cedo, e um movimento rejeitado restaura o card na coluna de origem. Desfaturar atualiza o pedido antes de remover a taxa; falha no toggle de pagamento recarrega; campos nulos usam `—`.

- [ ] **Step 4: Adicionar estilos do Kanban, modais e impressão**

```css
.kanban { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(260px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 12px; align-items: start; }
.coluna { background: var(--color-bg-surface); border: 1px solid var(--color-border-default); border-radius: 12px; min-height: 200px; }
.coluna-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--color-border-default); }
.coluna-topo h3 { margin: 0; font-size: 14px; }
.coluna-topo span { font-size: 11px; color: var(--color-text-tertiary); }
.coluna-cards { display: grid; gap: 8px; padding: 10px; min-height: 120px; }
.cartao { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--color-border-default); border-radius: 10px; background: var(--color-bg-page); cursor: grab; }
.cartao.cancelado { opacity: .6; border-color: var(--color-border-error); }
.cartao-fantasma { opacity: .4; }
.cartao-topo { display: flex; justify-content: space-between; gap: 8px; }
.cartao-id { color: var(--color-text-tertiary); font-size: 11px; }
.cartao-info { font-size: 12px; color: var(--color-text-secondary); }
.cartao-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.cartao-tags span { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 999px; }
.tag-ifood { background: rgba(239,68,68,.15); color: var(--color-error); }
.tag-manual { background: rgba(139,92,246,.15); color: var(--color-cat-purple-200, #B59AF8); }
.tag-faturado { background: rgba(16,185,129,.15); color: var(--color-success); }
.tag-cancelado { background: rgba(239,68,68,.15); color: var(--color-error); }
.cartao-motoboy { display: grid; gap: 4px; font-size: 12px; }
.cartao-motoboy select { padding: 6px; border: 1px solid var(--color-border-default); border-radius: 6px; background: var(--color-bg-page); color: var(--color-text-primary); }
.cartao-acoes { display: flex; gap: 4px; flex-wrap: wrap; }
.cartao-acoes button { padding: 4px 8px; border: 1px solid var(--color-border-default); border-radius: 6px; background: var(--color-bg-surface); color: var(--color-text-primary); cursor: pointer; font-size: 11px; }
.cartao-acoes .perigo { color: var(--color-error); border-color: var(--color-border-error); }
.modal-fundo { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; padding: 16px; z-index: 1000; }
.modal-caixa { width: min(560px, 100%); max-height: 90vh; overflow: auto; padding: 20px; border: 1px solid var(--color-border-default); border-radius: 12px; background: var(--color-bg-surface); }
.detalhe-itens { width: 100%; border-collapse: collapse; margin: 10px 0; }
.detalhe-itens th, .detalhe-itens td { padding: 6px 8px; border-bottom: 1px solid var(--color-border-subtle); text-align: left; font-size: 13px; }
fieldset.ciencia { border: 1px solid var(--color-border-default); border-radius: 8px; padding: 10px; display: grid; gap: 6px; }
@media (max-width: 700px) { .kanban { grid-auto-columns: 84vw; } }

/* Etiqueta térmica 100 x 150 mm — mesmo layout do /pedidos atual */
#printArea { display: none; }
@media print {
  body > *:not(#printArea) { display: none !important; }
  #printArea { display: block !important; position: absolute; left: 0; top: 0; width: 100mm; }
  @page { size: 100mm 150mm; margin: 0; }
  .plabel { box-sizing: border-box; width: 100mm; height: 150mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; background: #fff; color: #000; padding: 6mm; font-family: Verdana, Arial, sans-serif; font-size: 10px; line-height: 1.25; }
  .plabel:last-child { page-break-after: auto; break-after: auto; }
}
.plabel { box-sizing: border-box; width: 100mm; height: 150mm; background: #fff; color: #000; padding: 6mm; font-family: Verdana, Arial, sans-serif; font-size: 10px; line-height: 1.25; }
.l-brand { font-size: 14px; font-weight: 800; text-align: center; letter-spacing: .5px; }
.l-carinho { font-size: 9.5px; font-style: italic; text-align: center; color: #555; margin-bottom: 2mm; }
.l-num { text-align: center; font-size: 13px; font-weight: 800; margin-bottom: 2mm; }
.l-sub { text-align: center; font-size: 9px; margin-bottom: 3mm; color: #333; }
.l-cust { font-size: 13px; font-weight: 800; margin: 2mm 0 1mm 0; }
.l-line { font-size: 12px; }
.l-sep { border-top: 1px dashed #999; margin: 3mm 0; }
.l-items { font-size: 12px; font-weight: 700; }
.l-obs { font-size: 10px; color: #333; margin-top: 2mm; font-style: italic; }
.l-total { font-size: 16px; font-weight: 900; margin-top: 3mm; }
.l-pay { font-size: 12px; margin-top: 1mm; }
.l-sep2 { border-top: 1px solid #999; margin: 3mm 0; }
.l-foot { font-size: 11px; margin-top: 2mm; text-align: center; color: #333; }
```

- [ ] **Step 5: Atualizar `admin/index.html`**

Inclua o Sortable antes do módulo e a área de impressão ao final do `body`:

```html
<script src="../assets/vendor/sortable.min.js"></script>
<script type="module" src="../assets/js/admin/app.js"></script>
...
<div id="printArea"></div>
```

- [ ] **Step 6: Testar no staging**

1. Crie pedidos de teste no staging (ou use o cardápio de staging).
2. Abra o Kanban e confirme as seis colunas.
3. Arraste um pedido de Novo até Concluído.
4. Arraste para a coluna Cancelado: o pedido só deve mudar após informar motivo e marcar pelo menos uma ciência.
5. Confirme que o total da coluna Cancelado mostra `0 · R$ 0,00` mesmo com cards ali.
6. Restaure o pedido como admin.
7. Teste os botões ← e →.
8. Abra o detalhe, marque como pago (admin) e confirme a entrada no financeiro.
9. Desmarque o pagamento e confirme a remoção da entrada.
10. Imprima uma etiqueta e confira o layout de 100 × 150 mm.
11. Copie o endereço e cole em um editor.
12. Entre como operador: o checkbox Pago deve estar desabilitado, mas impressão e cópia funcionam.

- [ ] **Step 7: Commit**

```bash
git add assets/js/admin/kanban.js assets/js/admin/impressao.js assets/js/financeiro-sync.js assets/js/admin/pedidos.js assets/css/admin.css admin/index.html
git commit -m "feat: adiciona kanban com arrastar e soltar, cancelamento, restauração e impressão

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Pedidos manuais, faturamento e sincronização financeira

**Files:**
- Create: `assets/js/admin/pedido-form.js`
- Modify: `assets/js/admin/pedidos.js`
- Modify: `assets/css/admin.css`
- Modify: `tests/calc.test.mjs`

**Interfaces:**
- Consumes: `calcularTaxa`, `calcularFaturamento`, `validarPedidoManual`, `fmtBRL`, `criarPedido`, `atualizarPedido`, `sb`, `registrarLog`, `sincronizarEntradaPedido`, `sincronizarTaxaFaturamento` (criados na Task 9).
- Produces:
  - `abrirPedidoManual({ ctx, onSalvo })`
  - `abrirFaturamento(pedido, { ctx, onSalvo })`

- [ ] **Step 1: Adicionar testes de faturamento**

Em `tests/calc.test.mjs`, acrescente:
```js
import { calcularFaturamento } from '../assets/js/calc.js';

test('calcularFaturamento devolve taxa e líquido', () => {
  assert.deepEqual(calcularFaturamento(100, 85), { bruto: 100, recebido: 85, taxa: 15, liquido: 85 });
  assert.deepEqual(calcularFaturamento(100, 100), { bruto: 100, recebido: 100, taxa: 0, liquido: 100 });
  assert.deepEqual(calcularFaturamento(100, 120), { bruto: 100, recebido: 120, taxa: 0, liquido: 120 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL porque `calcularFaturamento` não existe.

- [ ] **Step 3: Implementar `calcularFaturamento` em `calc.js`**

```js
export function calcularFaturamento(bruto, recebido) {
  const b = arred2(bruto);
  const r = arred2(recebido);
  const taxa = arred2(Math.max(0, b - r));
  return { bruto: b, recebido: r, taxa, liquido: arred2(b - taxa) };
}
```

- [ ] **Step 4: Conferir o módulo de sincronização criado na Task 9**

Run:
```bash
grep -n "export async function" assets/js/financeiro-sync.js
```
Expected: `sincronizarEntradaPedido`, `sincronizarTaxaFaturamento`, `removerLancamento` e `removerLancamentosAutomaticos`.

- [ ] **Step 5: Criar `assets/js/admin/pedido-form.js`**

```js
import { criarPedido, atualizarPedido, sb } from '../db.js';
import { calcularTaxa, validarPedidoManual } from '../calc.js';
import { fmtBRL, parseBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';
import { sincronizarEntradaPedido, sincronizarTaxaFaturamento } from '../financeiro-sync.js';

export function abrirPedidoManual({ ctx, onSalvo }) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-fundo">
      <form id="manualForm" class="modal-caixa form-grid">
        <h3>Novo pedido manual</h3>
        <label>Cliente *<input id="mCliente" required /></label>
        <label>Itens * (um por linha)<textarea id="mItens" rows="4" required placeholder="1x Marmita Mista&#10;2x Coca-Cola lata"></textarea></label>
        <label>Valor total (R$) *<input id="mTotal" type="number" min="0.01" step="0.01" required /></label>
        <label>Canal *<select id="mCanal">
          <option value="ifood">iFood</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="balcao">Balcão</option>
          <option value="outro">Outro</option>
        </select></label>
        <label>Telefone<input id="mTelefone" /></label>
        <label>Bairro<input id="mBairro" /></label>
        <label>Endereço<input id="mEndereco" /></label>
        <label>Pagamento<input id="mPagamento" placeholder="Pix, cartão, dinheiro…" /></label>
        <label>Observação<textarea id="mObs" rows="2"></textarea></label>
        <div id="mErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar pedido</button>
          <button type="button" id="mFechar" class="btn-ghost">Fechar</button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector('#manualForm');
  root.querySelector('#mFechar').addEventListener('click', () => { root.innerHTML = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itensTexto = form.querySelector('#mItens').value.trim();
    const dados = {
      cliente: form.querySelector('#mCliente').value.trim(),
      itens: itensTexto,
      total: Number(form.querySelector('#mTotal').value),
      canal: form.querySelector('#mCanal').value
    };
    const erros = validarPedidoManual(dados);
    if (erros.length) {
      form.querySelector('#mErro').textContent = erros.join(' ');
      return;
    }

    const linhas = itensTexto.split('\n').map(l => l.trim()).filter(Boolean);
    const pedido = {
      cliente: dados.cliente,
      telefone: form.querySelector('#mTelefone').value.trim() || null,
      bairro: form.querySelector('#mBairro').value.trim() || null,
      endereco: form.querySelector('#mEndereco').value.trim() || null,
      pagamento: form.querySelector('#mPagamento').value.trim() || null,
      observacao: form.querySelector('#mObs').value.trim() || null,
      itens: linhas.map(l => ({ produto: l, quantidade: 1, preco_unitario: null, subtotal: null })),
      subtotal: dados.total,
      frete: 0,
      total: dados.total,
      valor_bruto: dados.total,
      canal: dados.canal,
      origem: 'manual',
      status_kanban: 'novo',
      posicao: Date.now()
    };

    const criado = await criarPedido(pedido);
    await registrarLog('criar_pedido_manual', 'pedidos', criado.id, { cliente: criado.cliente, total: criado.total, canal: criado.canal });
    root.innerHTML = '';
    if (onSalvo) await onSalvo();
  });
}

export function abrirFaturamento(pedido, { ctx, onSalvo }) {
  const root = document.getElementById('modalRoot');
  const bruto = Number(pedido.valor_bruto ?? pedido.total ?? 0);
  root.innerHTML = `
    <div class="modal-fundo">
      <form id="faturamentoForm" class="modal-caixa form-grid">
        <h3>Faturar pedido #${pedido.id}</h3>
        <p>Valor cheio: <strong>${fmtBRL(bruto)}</strong></p>
        <label>Valor efetivamente recebido (R$)
          <input id="fRecebido" type="number" min="0" step="0.01" value="${bruto}" required />
        </label>
        <p class="dica">Taxa calculada: <strong id="fTaxa">${fmtBRL(0)}</strong></p>
        <div id="fErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Confirmar faturamento</button>
          <button type="button" id="fFechar" class="btn-ghost">Fechar</button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector('#faturamentoForm');
  const input = form.querySelector('#fRecebido');
  const taxaEl = form.querySelector('#fTaxa');

  function atualizarTaxa() {
    taxaEl.textContent = fmtBRL(calcularTaxa(bruto, Number(input.value || 0)));
  }
  input.addEventListener('input', atualizarTaxa);
  atualizarTaxa();

  root.querySelector('#fFechar').addEventListener('click', () => { root.innerHTML = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const recebido = Number(input.value);
    if (!(recebido >= 0)) {
      form.querySelector('#fErro').textContent = 'Informe um valor recebido válido.';
      return;
    }
    const taxa = calcularTaxa(bruto, recebido);
    const agora = new Date().toISOString();
    const { data: { user } } = await sb.auth.getUser();
    await atualizarPedido(pedido.id, {
      finalizado: true,
      finalizado_em: agora,
      finalizado_por: ctx.perfil?.email || 'painel',
      valor_recebido: recebido,
      taxa,
      faturado: true,
      faturado_em: agora,
      faturado_por: user?.id || null
    });
    await sincronizarEntradaPedido({ ...pedido, finalizado: true, valor_bruto: bruto });
    await sincronizarTaxaFaturamento(pedido.id, taxa, `Taxa do pedido #${pedido.id}`);
    await registrarLog('faturar_pedido', 'pedidos', pedido.id, { bruto, recebido, taxa });
    root.innerHTML = '';
    if (onSalvo) await onSalvo();
  });
}
```

- [ ] **Step 6: Integrar o botão de novo pedido e o faturamento na aba Pedidos**

Em `pedidos.js`, adicione os imports:
```js
import { abrirPedidoManual, abrirFaturamento } from './pedido-form.js';
```

Na barra de ferramentas, inclua o botão:
```html
<button type="button" id="novoPedidoBtn" class="btn">+ Novo pedido</button>
```

Depois de renderizar a barra, registre:
```js
root.querySelector('#novoPedidoBtn').addEventListener('click', () => {
  abrirPedidoManual({ ctx, onSalvo: carregar });
});
```

No `abrirModalDetalhe`, acrescente o botão Faturar ao bloco de ações (somente admin e pedido não cancelado):
```js
${admin && !pedido.cancelado ? '<button type="button" id="btnFaturar" class="btn">Faturar</button>' : ''}
```

E o handler, logo após os demais:
```js
const btnFaturar = rootModal.querySelector('#btnFaturar');
if (btnFaturar) {
  btnFaturar.addEventListener('click', () => {
    rootModal.innerHTML = '';
    abrirFaturamento(pedido, { ctx, onSalvo: aoAtualizar });
  });
}
```

O `abrirFaturamento` já grava `finalizado`, `faturado_por` e as datas no código acima.

- [ ] **Step 7: Testar no staging**

1. Crie um pedido manual iFood de R$ 100.
2. Ele aparece em Novo no Kanban.
3. Abra o detalhe e clique em Faturar; informe R$ 85.
4. Confirme no banco: `valor_recebido = 85`, `taxa = 15`, `faturado = true`, `faturado_por` preenchido.
5. Confirme em `financeiro`: uma entrada de 100 (`origem='pedido'`) e uma saída de 15 (`origem='taxa'`).
6. Reabra o faturamento com R$ 90: a saída deve virar 10, sem duplicar.
7. Clique em Desfaturar: a saída some e `faturado` volta a falso.
8. Cancele o pedido: os lançamentos automáticos devem sumir.
9. Restaure o pedido; eles não voltam até o pedido ser marcado como pago/faturado novamente.
10. Entre como operador: o botão Faturar não deve aparecer.

- [ ] **Step 8: Commit**

```bash
git add assets/js/admin/pedido-form.js assets/js/admin/pedidos.js assets/js/calc.js tests/calc.test.mjs assets/css/admin.css
git commit -m "feat: adiciona pedidos manuais e faturamento com taxas

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Motoboys, atribuição e relatório de repasse

**Files:**
- Modify: `assets/js/admin/motoboys.js`
- Modify: `assets/js/admin/pedidos.js` (já integra atribuição)
- Modify: `assets/js/admin/kanban.js` (já mostra seletor)
- Modify: `assets/js/calc.js`
- Create: `tests/motoboy.test.mjs`
- Modify: `assets/css/admin.css`

**Interfaces:**
- Consumes: `listarMotoboys`, `salvarMotoboy`, `listarPedidos`, `atualizarPedido`, `relatorioMotoboy`, `fmtBRL`, `fmtDataHora`.
- Produces: `renderMotoboys(root, ctx)`.

- [ ] **Step 1: Escrever os testes do relatório**

`tests/motoboy.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatorioMotoboy } from '../assets/js/calc.js';

const pedidos = [
  { id: 1, status_kanban: 'concluido', cancelado: false, motoboy_id: 2, motoboy_valor_entrega: 5, entregue_em: '2026-11-14T15:00:00.000Z', repasse_pago_em: null },
  { id: 2, status_kanban: 'concluido', cancelado: false, motoboy_id: 2, motoboy_valor_entrega: 5, entregue_em: '2026-11-14T16:00:00.000Z', repasse_pago_em: '2026-11-14T20:00:00.000Z' },
  { id: 3, status_kanban: 'cancelado', cancelado: true, motoboy_id: 2, motoboy_valor_entrega: 5, entregue_em: '2026-11-14T17:00:00.000Z' },
  { id: 4, status_kanban: 'entrega', cancelado: false, motoboy_id: 2, motoboy_valor_entrega: 5, entregue_em: null },
  { id: 5, status_kanban: 'concluido', cancelado: false, motoboy_id: 3, motoboy_valor_entrega: 8, entregue_em: '2026-11-15T10:00:00.000Z' }
];

test('relatório agrupa por motoboy, ignora cancelados e separa pago/pendente', () => {
  const r = relatorioMotoboy({
    pedidos,
    motoboys: [{ id: 2, nome: 'Diego' }, { id: 3, nome: 'Bruno' }],
    inicio: '2026-11-14T00:00:00.000Z',
    fim: '2026-11-14T23:59:59.999Z'
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].nome, 'Diego');
  assert.equal(r[0].quantidade, 2);
  assert.equal(r[0].total, 10);
  assert.equal(r[0].pendente, 5);
  assert.equal(r[0].pago, 5);
});

test('relatório considera o período de entregue_em', () => {
  const r = relatorioMotoboy({
    pedidos,
    motoboys: [{ id: 3, nome: 'Bruno' }],
    inicio: '2026-11-15T00:00:00.000Z',
    fim: '2026-11-15T23:59:59.999Z'
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].nome, 'Bruno');
  assert.equal(r[0].total, 8);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL se `relatorioMotoboy` ainda não existir (já implementado na Task 3; o teste deve passar). Se passar, avance.

- [ ] **Step 3: Implementar `renderMotoboys`**

```js
import { listarMotoboys, salvarMotoboy, listarPedidosEntregues, atualizarPedido } from '../db.js';
import { relatorioMotoboy } from '../calc.js';
import { fmtBRL, fmtDataHora, esc, hojeBR, dataBR } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderMotoboys(root, ctx) {
  let motoboys = await listarMotoboys();

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Motoboys</h2>
      <button type="button" id="novoMotoboyBtn" class="btn">+ Novo motoboy</button>
    </div>
    <section class="painel-bairros">
      <h3>Cadastro</h3>
      <div id="motoboyFormArea"></div>
      <div id="motoboyLista"></div>
    </section>
    <section class="painel-bairros">
      <h3>Relatório de repasse</h3>
      <div class="acoes" style="margin-bottom:12px">
        <label>De <input id="repInicio" type="date" value="${hojeBR()}" /></label>
        <label>Até <input id="repFim" type="date" value="${hojeBR()}" /></label>
        <button type="button" id="gerarRelatorio" class="btn">Gerar</button>
        <button type="button" id="copiarRelatorio" class="btn-ghost">Copiar relatório</button>
      </div>
      <div id="repResultado"></div>
    </section>`;

  const lista = root.querySelector('#motoboyLista');
  const formArea = root.querySelector('#motoboyFormArea');

  function desenharLista() {
    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>Valor/entrega</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${motoboys.map(m => `
              <tr>
                <td><strong>${esc(m.nome)}</strong></td>
                <td>${esc(m.telefone || '—')}</td>
                <td>${fmtBRL(m.valor_entrega)}</td>
                <td>${m.ativo ? 'Sim' : 'Não'}</td>
                <td><button type="button" class="btn-mini" data-edit="${m.id}">Editar</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirForm(motoboys.find(m => String(m.id) === btn.dataset.edit)));
    });
  }

  function abrirForm(m = {}) {
    formArea.innerHTML = `
      <form id="motoboyForm" class="form-grid painel-form">
        <h4>${m.id ? 'Editar' : 'Novo'} motoboy</h4>
        <label>Nome<input id="mNome" value="${esc(m.nome || '')}" required /></label>
        <label>Telefone<input id="mTelefone" value="${esc(m.telefone || '')}" /></label>
        <label>Valor por entrega (R$)<input id="mValor" type="number" min="0" step="0.01" value="${m.valor_entrega ?? 0}" required /></label>
        <label class="linha-check"><input id="mAtivo" type="checkbox" ${m.ativo !== false ? 'checked' : ''} /> Ativo</label>
        <div id="mErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="mCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#mCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#motoboyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = {
        id: m.id,
        nome: formArea.querySelector('#mNome').value.trim(),
        telefone: formArea.querySelector('#mTelefone').value.trim(),
        valor_entrega: Number(formArea.querySelector('#mValor').value),
        ativo: formArea.querySelector('#mAtivo').checked
      };
      if (!dados.nome) {
        formArea.querySelector('#mErro').textContent = 'Informe o nome.';
        return;
      }
      await salvarMotoboy(dados);
      await registrarLog(dados.id ? 'editar_motoboy' : 'criar_motoboy', 'motoboys', dados.id || null, dados);
      motoboys = await listarMotoboys();
      formArea.innerHTML = '';
      desenharLista();
    });
  }

  let ultimoRelatorio = [];

  async function gerar() {
    const de = root.querySelector('#repInicio').value;
    const ate = root.querySelector('#repFim').value;
    const inicio = `${de}T00:00:00-03:00`;
    const fim = `${ate}T23:59:59.999-03:00`;
    const pedidos = await listarPedidosEntregues(inicio, fim);
    ultimoRelatorio = relatorioMotoboy({ pedidos, motoboys, inicio, fim });
    const alvo = root.querySelector('#repResultado');

    if (!ultimoRelatorio.length) {
      alvo.innerHTML = '<p class="dica">Nenhuma entrega no período.</p>';
      return;
    }

    alvo.innerHTML = ultimoRelatorio.map(g => `
      <div class="painel-bairros" style="margin-bottom:12px">
        <div class="painel-topo">
          <h4>${esc(g.nome)} — ${g.quantidade} entrega(s)</h4>
          <strong>${fmtBRL(g.total)}</strong>
        </div>
        <p class="dica">Pendente: ${fmtBRL(g.pendente)} · Pago: ${fmtBRL(g.pago)}</p>
        <table>
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Entregue em</th><th>Valor</th><th>Repasse</th></tr></thead>
          <tbody>
            ${g.pedidos.map(p => `
              <tr>
                <td>#${p.id}</td>
                <td>${esc(p.cliente)}</td>
                <td>${esc(p.bairro || '—')}</td>
                <td>${fmtDataHora(p.entregue_em)}</td>
                <td>${fmtBRL(p.motoboy_valor_entrega)}</td>
                <td>${p.repasse_pago_em ? 'Pago' : 'Pendente'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="acoes" style="margin-top:8px">
          <button type="button" class="btn" data-pagar="${g.motoboyId}">Marcar repasse como pago</button>
        </div>
      </div>`).join('');

    alvo.querySelectorAll('[data-pagar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const g = ultimoRelatorio.find(x => String(x.motoboyId) === btn.dataset.pagar);
        const pendentes = g.pedidos.filter(p => !p.repasse_pago_em);
        if (!pendentes.length) return;
        if (!confirm(`Marcar ${pendentes.length} entrega(s) de ${g.nome} como pagas?`)) return;
        const agora = new Date().toISOString();
        for (const p of pendentes) {
          await atualizarPedido(p.id, { repasse_pago_em: agora });
        }
        await registrarLog('pagar_repasse', 'motoboys', g.motoboyId, {
          quantidade: pendentes.length,
          valor: g.pendente
        });
        await gerar();
      });
    });
  }

  root.querySelector('#novoMotoboyBtn').addEventListener('click', () => abrirForm());
  root.querySelector('#gerarRelatorio').addEventListener('click', gerar);
  root.querySelector('#copiarRelatorio').addEventListener('click', async () => {
    const texto = ultimoRelatorio.map(g =>
      `${g.nome}: ${g.quantidade} entrega(s) · total ${fmtBRL(g.total)} · pendente ${fmtBRL(g.pendente)}`
    ).join('\n');
    try {
      await navigator.clipboard.writeText(texto || 'Nenhuma entrega no período.');
      alert('Relatório copiado.');
    } catch {
      alert(texto);
    }
  });

  desenharLista();
  await gerar();
}
```

- [ ] **Step 4: Testar no staging**

1. Cadastre um motoboy com valor de entrega R$ 5.
2. Crie um pedido de entrega, mova até Em entrega e atribua o motoboy.
3. Mova para Concluído.
4. Gere o relatório de hoje: 1 entrega, R$ 5 pendente.
5. Marque o repasse como pago: pendente 0, pago 5.
6. Cancele um pedido concluído e confirme que ele some do relatório.
7. Teste o botão Copiar relatório.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/motoboys.js assets/js/calc.js tests/motoboy.test.mjs assets/css/admin.css
git commit -m "feat: adiciona cadastro de motoboys e relatório de repasse

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: Aba Financeiro

**Files:**
- Modify: `assets/js/admin/financeiro.js`
- Modify: `assets/css/admin.css`
- Modify: `tests/calc.test.mjs` (já cobre `resumoFinanceiro`)

**Interfaces:**
- Consumes: `listarFinanceiro`, `criarLancamento`, `atualizarLancamento`, `excluirLancamento`, `resumoFinanceiro`, `fmtBRL`, `hojeBR`, `dataBR`.
- Produces: `renderFinanceiro(root, ctx)`.

- [ ] **Step 1: Implementar `renderFinanceiro`**

```js
import { listarFinanceiro, criarLancamento, atualizarLancamento, excluirLancamento } from '../db.js';
import { resumoFinanceiro } from '../calc.js';
import { fmtBRL, fmtData, esc, hojeBR } from '../format.js';
import { registrarLog } from '../auth.js';

const CATEGORIAS = ['vendas','taxa_ifood','taxa_cartao','motoboy','carne','gás','embalagem','marketing','outros'];

export async function renderFinanceiro(root, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    root.innerHTML = '<p class="erro">Apenas administradores acessam o financeiro.</p>';
    return;
  }

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Financeiro</h2>
      <div class="acoes">
        <label>De <input id="finInicio" type="date" value="${hojeBR()}" /></label>
        <label>Até <input id="finFim" type="date" value="${hojeBR()}" /></label>
        <button type="button" id="finFiltrar" class="btn">Filtrar</button>
        <button type="button" id="finNovo" class="btn">+ Lançamento</button>
        <button type="button" id="finCsv" class="btn-ghost">Exportar CSV</button>
      </div>
    </div>
    <div id="finCards" class="cards-fin"></div>
    <div id="finFormArea"></div>
    <div id="finLista"></div>`;

  let lancamentos = [];

  async function carregar() {
    const de = root.querySelector('#finInicio').value;
    const ate = root.querySelector('#finFim').value;
    lancamentos = await listarFinanceiro({ inicio: de, fim: ate });
    desenhar();
  }

  function desenhar() {
    const r = resumoFinanceiro(lancamentos);
    root.querySelector('#finCards').innerHTML = `
      <div class="card-fin"><span>Entradas</span><strong>${fmtBRL(r.entradas)}</strong></div>
      <div class="card-fin"><span>Saídas</span><strong>${fmtBRL(r.saidas)}</strong></div>
      <div class="card-fin"><span>Saldo</span><strong>${fmtBRL(r.saldo)}</strong></div>
      <div class="card-fin"><span>Taxas</span><strong>${fmtBRL(r.taxas)}</strong></div>
      <div class="card-fin"><span>Líquido</span><strong>${fmtBRL(r.liquido)}</strong></div>`;

    const lista = root.querySelector('#finLista');
    if (!lancamentos.length) {
      lista.innerHTML = '<p class="dica">Nenhum lançamento no período.</p>';
      return;
    }

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Origem</th><th>Valor</th><th>Ações</th></tr></thead>
          <tbody>
            ${lancamentos.map(l => `
              <tr>
                <td>${fmtData(l.data + 'T12:00:00')}</td>
                <td>${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
                <td>${esc(l.categoria)}</td>
                <td>${esc(l.descricao)}</td>
                <td>${l.origem === 'manual' ? 'Manual' : l.origem === 'pedido' ? 'Pedido' : 'Taxa'}</td>
                <td><strong>${fmtBRL(l.valor)}</strong></td>
                <td class="acoes">
                  ${l.origem === 'manual' ? `
                    <button type="button" class="btn-mini" data-edit="${l.id}">Editar</button>
                    <button type="button" class="btn-mini perigo" data-del="${l.id}">Excluir</button>` : '<span class="dica">Automático</span>'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => abrirForm(lancamentos.find(l => String(l.id) === b.dataset.edit)));
    });
    lista.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const l = lancamentos.find(x => String(x.id) === b.dataset.del);
        if (!l || !confirm(`Excluir "${l.descricao}"?`)) return;
        await excluirLancamento(l.id);
        await registrarLog('excluir_lancamento', 'financeiro', l.id, { descricao: l.descricao, valor: l.valor });
        await carregar();
      });
    });
  }

  function abrirForm(l = {}) {
    const area = root.querySelector('#finFormArea');
    area.innerHTML = `
      <form id="finForm" class="form-grid painel-form">
        <h4>${l.id ? 'Editar' : 'Novo'} lançamento</h4>
        <label>Tipo
          <select id="fTipo">
            <option value="entrada" ${l.tipo === 'entrada' ? 'selected' : ''}>Entrada</option>
            <option value="saida" ${l.tipo === 'saida' ? 'selected' : ''}>Saída</option>
          </select>
        </label>
        <label>Categoria
          <select id="fCat">
            ${CATEGORIAS.map(c => `<option value="${c}" ${l.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <label>Descrição<input id="fDesc" value="${esc(l.descricao || '')}" required /></label>
        <label>Valor (R$)<input id="fValor" type="number" min="0" step="0.01" value="${l.valor ?? 0}" required /></label>
        <label>Data<input id="fData" type="date" value="${l.data || hojeBR()}" required /></label>
        <div id="fErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="fCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    area.querySelector('#fCancelar').addEventListener('click', () => { area.innerHTML = ''; });
    area.querySelector('#finForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = {
        tipo: area.querySelector('#fTipo').value,
        categoria: area.querySelector('#fCat').value,
        descricao: area.querySelector('#fDesc').value.trim(),
        valor: Number(area.querySelector('#fValor').value),
        data: area.querySelector('#fData').value,
        origem: 'manual'
      };
      if (!dados.descricao || !(dados.valor >= 0)) {
        area.querySelector('#fErro').textContent = 'Informe descrição e valor.';
        return;
      }
      if (l.id) await atualizarLancamento(l.id, dados);
      else await criarLancamento(dados);
      await registrarLog(l.id ? 'editar_lancamento' : 'criar_lancamento', 'financeiro', l.id || null, dados);
      area.innerHTML = '';
      await carregar();
    });
  }

  root.querySelector('#finFiltrar').addEventListener('click', carregar);
  root.querySelector('#finNovo').addEventListener('click', () => abrirForm());
  root.querySelector('#finCsv').addEventListener('click', () => {
    const linhas = [
      ['data','tipo','categoria','descricao','valor','origem'],
      ...lancamentos.map(l => [l.data, l.tipo, l.categoria, l.descricao, String(l.valor).replace('.', ','), l.origem])
    ];
    const celula = (c) => {
      let s = String(c);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const csv = '﻿' + linhas.map(linha => linha.map(celula).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-${hojeBR()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  await carregar();
}
```

- [ ] **Step 2: Adicionar estilos dos cards**

```css
.cards-fin { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.card-fin { display: grid; gap: 4px; padding: 14px; border: 1px solid var(--color-border-default); border-radius: 12px; background: var(--color-bg-surface); }
.card-fin span { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--color-text-tertiary); }
.card-fin strong { font-size: 20px; }
```

- [ ] **Step 3: Testar no staging**

1. Como admin, abra Financeiro.
2. Confirme as entradas dos pedidos faturados e as saídas das taxas.
3. Crie uma saída manual de R$ 50 em `carne`.
4. Confirme saldo e líquido.
5. Edite o lançamento manual e exclua.
6. Exporte o CSV e abra no Excel/Sheets.
7. Entre como operador: a aba Financeiro não deve aparecer.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/financeiro.js assets/css/admin.css
git commit -m "feat: adiciona aba financeira com lançamentos automáticos e manuais

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Fase 3 — Cardápio e segurança avançada

### Task 13: Cardápio/Loja dentro do admin

**Files:**
- Modify: `assets/js/admin/cardapio.js`
- Modify: `assets/js/db.js`
- Modify: `assets/css/admin.css`

**Interfaces:**
- Consumes: `sb`, `registrarLog`.
- Produces: `renderCardapio(root, ctx)`; funções de dados `listarProdutos`, `salvarProduto`, `excluirProduto`, `carregarConfig`, `salvarConfig`, `definirLojaAberta`.

- [ ] **Step 1: Adicionar funções de dados em `db.js`**

```js
export async function listarProdutos() {
  const { data, error } = await sb.from('produtos').select('*').order('ordem').order('id');
  checar(error);
  return data || [];
}

export async function salvarProduto(p) {
  const payload = {
    nome: p.nome.trim(),
    preco: Number(p.preco || 0),
    descricao: p.descricao || null,
    imagem: p.imagem || null,
    categoria: p.categoria || 'meal',
    ativo: p.ativo !== false,
    ordem: Number(p.ordem || 0)
  };
  const q = p.id
    ? sb.from('produtos').update(payload).eq('id', p.id)
    : sb.from('produtos').insert(payload);
  const { error } = await q;
  checar(error);
}

export async function excluirProduto(id) {
  const { error } = await sb.from('produtos').delete().eq('id', id);
  checar(error);
}

export async function carregarConfig() {
  const { data, error } = await sb.from('config').select('*').eq('id', 1).maybeSingle();
  checar(error);
  return data;
}

export async function salvarConfig(patch) {
  const { error } = await sb.from('config').update(patch).eq('id', 1);
  checar(error);
}

export async function definirLojaAberta(aberta) {
  const { error } = await sb.from('status').update({ isOpen: aberta }).eq('id', 1);
  checar(error);
}
```

- [ ] **Step 2: Implementar `renderCardapio`**

```js
import {
  listarProdutos, salvarProduto, excluirProduto,
  carregarConfig, salvarConfig, definirLojaAberta, sb
} from '../db.js';
import { fmtBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderCardapio(root, ctx) {
  let produtos = await listarProdutos();
  const config = await carregarConfig() || {};
  const { data: status } = await sb.from('status').select('isOpen').eq('id', 1).maybeSingle();
  let aberta = status?.isOpen !== false;

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Cardápio e loja</h2>
      <button type="button" id="toggleLoja" class="btn">${aberta ? 'Fechar loja' : 'Abrir loja'}</button>
    </div>
    <p id="lojaStatus" class="dica">${aberta ? 'Loja aberta para pedidos.' : 'Loja fechada.'}</p>

    <section class="painel-bairros">
      <div class="painel-topo"><h3>Produtos</h3><button type="button" id="novoProduto" class="btn">+ Novo produto</button></div>
      <div id="produtoFormArea"></div>
      <div id="produtoLista"></div>
    </section>

    <section class="painel-bairros">
      <h3>Configuração da loja</h3>
      <form id="configForm" class="form-grid painel-form">
        <label>Nome<input id="cNome" value="${esc(config.nome_loja || '')}" /></label>
        <label>Descrição<input id="cDesc" value="${esc(config.descricao_loja || '')}" /></label>
        <label>Telefone (só números com DDI)<input id="cTelefone" value="${esc(config.telefone || '')}" /></label>
        <label>Instagram<input id="cInsta" value="${esc(config.instagram || '')}" /></label>
        <label>Endereço<input id="cEndereco" value="${esc(config.endereco || '')}" /></label>
        <label>Banner<input id="cBanner" value="${esc(config.banner || '')}" /></label>
        <label>Logo (URL)<input id="cLogo" value="${esc(config.logo || '')}" /></label>
        <label>Ou enviar logo<input id="cLogoFile" type="file" accept="image/*" /></label>
        <div class="acoes"><button type="submit" class="btn">Salvar configuração</button></div>
        <div id="configMsg" class="msg"></div>
      </form>
    </section>`;

  const lista = root.querySelector('#produtoLista');
  const formArea = root.querySelector('#produtoFormArea');

  function desenhar() {
    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Produto</th><th>Preço</th><th>Categoria</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${produtos.map(p => `
              <tr>
                <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.descricao || '')}</small></td>
                <td>${fmtBRL(p.preco)}</td>
                <td>${esc(p.categoria)}</td>
                <td>${p.ativo ? 'Sim' : 'Não'}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${p.id}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${p.id}">Excluir</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    lista.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => abrirForm(produtos.find(p => String(p.id) === b.dataset.edit))));
    lista.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', async () => {
        const p = produtos.find(x => String(x.id) === b.dataset.del);
        if (!p || !confirm(`Excluir ${p.nome}?`)) return;
        await excluirProduto(p.id);
        await registrarLog('excluir_produto', 'produtos', p.id, { nome: p.nome });
        produtos = await listarProdutos();
        desenhar();
      }));
  }

  function abrirForm(p = {}) {
    formArea.innerHTML = `
      <form id="produtoForm" class="form-grid painel-form">
        <h4>${p.id ? 'Editar' : 'Novo'} produto</h4>
        <label>Nome<input id="pNome" value="${esc(p.nome || '')}" required /></label>
        <label>Preço (R$)<input id="pPreco" type="number" min="0" step="0.01" value="${p.preco ?? 0}" required /></label>
        <label>Descrição<textarea id="pDesc" rows="2">${esc(p.descricao || '')}</textarea></label>
        <label>Categoria<select id="pCat">
          <option value="meal" ${p.categoria === 'meal' ? 'selected' : ''}>Marmita</option>
          <option value="drink" ${p.categoria === 'drink' ? 'selected' : ''}>Bebida</option>
          <option value="dessert" ${p.categoria === 'dessert' ? 'selected' : ''}>Sobremesa</option>
        </select></label>
        <label>Imagem (URL)<input id="pImg" value="${esc(p.imagem || '')}" /></label>
        <label>Ou enviar arquivo<input id="pImgFile" type="file" accept="image/*" /></label>
        <label>Ordem<input id="pOrdem" type="number" value="${p.ordem ?? 0}" /></label>
        <label class="linha-check"><input id="pAtivo" type="checkbox" ${p.ativo !== false ? 'checked' : ''} /> Ativo</label>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="pCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#pCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#produtoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      let imagem = formArea.querySelector('#pImg').value.trim();
      const arquivo = formArea.querySelector('#pImgFile').files[0];
      if (arquivo) imagem = await readFileAsDataURL(arquivo);
      const dados = {
        id: p.id,
        nome: formArea.querySelector('#pNome').value.trim(),
        preco: Number(formArea.querySelector('#pPreco').value),
        descricao: formArea.querySelector('#pDesc').value.trim(),
        categoria: formArea.querySelector('#pCat').value,
        imagem,
        ordem: Number(formArea.querySelector('#pOrdem').value),
        ativo: formArea.querySelector('#pAtivo').checked
      };
      await salvarProduto(dados);
      await registrarLog(dados.id ? 'editar_produto' : 'criar_produto', 'produtos', dados.id || null, dados);
      produtos = await listarProdutos();
      formArea.innerHTML = '';
      desenhar();
    });
  }

  root.querySelector('#novoProduto').addEventListener('click', () => abrirForm());

  root.querySelector('#toggleLoja').addEventListener('click', async () => {
    aberta = !aberta;
    await definirLojaAberta(aberta);
    await registrarLog('alterar_loja', 'status', 1, { aberta });
    root.querySelector('#toggleLoja').textContent = aberta ? 'Fechar loja' : 'Abrir loja';
    root.querySelector('#lojaStatus').textContent = aberta ? 'Loja aberta para pedidos.' : 'Loja fechada.';
  });

  root.querySelector('#configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let logo = root.querySelector('#cLogo').value.trim();
    const arquivoLogo = root.querySelector('#cLogoFile').files[0];
    if (arquivoLogo) logo = await readFileAsDataURL(arquivoLogo);
    const patch = {
      nome_loja: root.querySelector('#cNome').value.trim(),
      descricao_loja: root.querySelector('#cDesc').value.trim(),
      telefone: root.querySelector('#cTelefone').value.replace(/\D/g, ''),
      instagram: root.querySelector('#cInsta').value.trim(),
      endereco: root.querySelector('#cEndereco').value.trim(),
      banner: root.querySelector('#cBanner').value.trim(),
      logo
    };
    await salvarConfig(patch);
    await registrarLog('salvar_config', 'config', 1, patch);
    const msg = root.querySelector('#configMsg');
    msg.textContent = 'Configuração salva.';
    msg.className = 'msg ok';
  });

  desenhar();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(file);
  });
}
```

- [ ] **Step 3: Testar no staging**

1. Edite o preço de um produto e confirme no cardápio de staging.
2. Feche a loja e confirme o banner no cardápio.
3. Abra a loja novamente.
4. Altere o telefone e o banner.
5. Entre como operador: a aba Cardápio/Loja deve funcionar conforme a RLS.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/cardapio.js assets/js/db.js assets/css/admin.css
git commit -m "feat: move gestão de cardápio e loja para o admin

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 14: Usuários, papéis e Edge Function de criação

**Files:**
- Create: `supabase/functions/criar-usuario/index.ts`
- Modify: `assets/js/admin/usuarios.js`
- Modify: `assets/js/db.js`
- Create: `supabase/README.md` (instruções de deploy)

**Interfaces:**
- Consumes: `listarPerfis`, `atualizarPerfil`, `sb.functions.invoke`.
- Produces: `renderUsuarios(root, ctx)`.

- [ ] **Step 1: Criar a Edge Function**

`supabase/functions/criar-usuario/index.ts`:
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const chamador = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user } } = await chamador.auth.getUser();
  if (!user) return json({ error: 'Não autenticado.' }, 401);

  const admin = createClient(url, service);
  const { data: perfil } = await admin.from('perfis')
    .select('papel, ativo').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.ativo || perfil.papel !== 'admin') {
    return json({ error: 'Sem permissão para criar usuários.' }, 403);
  }

  const { email, senha, nome, papel } = await req.json();
  if (!email || !senha) return json({ error: 'Informe e-mail e senha.' }, 400);
  if (!['admin', 'operador'].includes(papel)) return json({ error: 'Papel inválido.' }, 400);
  if (String(senha).length < 8) return json({ error: 'A senha deve ter ao menos 8 caracteres.' }, 400);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome: nome || email }
  });
  if (error) return json({ error: error.message }, 400);

  const { error: erroPerfil } = await admin.from('perfis').upsert({
    id: data.user.id,
    nome: nome || email,
    email,
    papel,
    ativo: true
  });
  if (erroPerfil) return json({ error: erroPerfil.message }, 500);

  await admin.from('logs').insert({
    user_id: user.id,
    user_email: user.email,
    acao: 'criar_usuario',
    entidade: 'perfis',
    entidade_id: data.user.id,
    detalhe: { email, papel }
  });

  return json({ id: data.user.id });
});
```

- [ ] **Step 2: Escrever `supabase/README.md`**

```markdown
# Edge Function criar-usuario

## Pré-requisitos

- Supabase CLI instalada (`npm i -g supabase`).
- Login feito (`supabase login`).
- Projeto vinculado (`supabase link --project-ref SEU_PROJECT_REF`).

## Deploy

```bash
supabase functions deploy criar-usuario --project-ref SEU_PROJECT_REF
```

A função usa automaticamente `SUPABASE_SERVICE_ROLE_KEY` do ambiente do projeto.
Nunca coloque essa chave no front-end.

## Fallback

Se a função não puder ser publicada, crie usuários em Authentication > Users no
painel do Supabase (com e-mail confirmado) e defina o papel pela aba Segurança.
```

- [ ] **Step 3: Implementar `renderUsuarios`**

```js
import { listarPerfis, atualizarPerfil, sb } from '../db.js';
import { fmtData, esc } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderUsuarios(root, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    root.innerHTML = '<p class="erro">Apenas administradores gerenciam usuários.</p>';
    return;
  }

  let perfis = await listarPerfis();

  root.innerHTML = `
    <div class="painel-topo">
      <h3>Usuários</h3>
      <button type="button" id="novoUsuarioBtn" class="btn">+ Novo usuário</button>
    </div>
    <div id="usuarioFormArea"></div>
    <div id="usuarioLista"></div>`;

  const lista = root.querySelector('#usuarioLista');
  const formArea = root.querySelector('#usuarioFormArea');

  function desenhar() {
    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${perfis.map(p => `
              <tr>
                <td><strong>${esc(p.nome || '—')}</strong></td>
                <td>${esc(p.email || '—')}</td>
                <td>
                  <select data-papel="${p.id}" ${String(p.id) === String(ctx.perfil.id) ? 'disabled' : ''}>
                    <option value="admin" ${p.papel === 'admin' ? 'selected' : ''}>admin</option>
                    <option value="operador" ${p.papel === 'operador' ? 'selected' : ''}>operador</option>
                    <option value="pendente" ${p.papel === 'pendente' ? 'selected' : ''}>pendente</option>
                  </select>
                </td>
                <td>${p.ativo ? 'Sim' : 'Não'}</td>
                <td>
                  ${String(p.id) === String(ctx.perfil.id) ? '<span class="dica">Você</span>' : `
                    <button type="button" class="btn-mini" data-toggle="${p.id}">${p.ativo ? 'Desativar' : 'Ativar'}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-papel]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.papel;
        const papel = sel.value;
        await atualizarPerfil(id, { papel });
        await registrarLog('alterar_papel', 'perfis', id, { papel });
        perfis = await listarPerfis();
        desenhar();
      });
    });

    lista.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const p = perfis.find(x => String(x.id) === btn.dataset.toggle);
        await atualizarPerfil(p.id, { ativo: !p.ativo });
        await registrarLog(p.ativo ? 'desativar_usuario' : 'ativar_usuario', 'perfis', p.id, { email: p.email });
        perfis = await listarPerfis();
        desenhar();
      });
    });
  }

  function abrirForm() {
    formArea.innerHTML = `
      <form id="usuarioForm" class="form-grid painel-form">
        <h4>Novo usuário</h4>
        <label>Nome<input id="uNome" required /></label>
        <label>E-mail<input id="uEmail" type="email" required /></label>
        <label>Senha inicial<input id="uSenha" type="password" minlength="8" required /></label>
        <label>Papel
          <select id="uPapel">
            <option value="operador">operador</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <div id="uErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Criar usuário</button>
          <button type="button" id="uCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#uCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#usuarioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        nome: formArea.querySelector('#uNome').value.trim(),
        email: formArea.querySelector('#uEmail').value.trim(),
        senha: formArea.querySelector('#uSenha').value,
        papel: formArea.querySelector('#uPapel').value
      };
      const { data, error } = await sb.functions.invoke('criar-usuario', { body });
      if (error || data?.error) {
        formArea.querySelector('#uErro').textContent = data?.error || error.message;
        return;
      }
      await registrarLog('criar_usuario', 'perfis', data.id, { email: body.email, papel: body.papel });
      formArea.innerHTML = '';
      perfis = await listarPerfis();
      desenhar();
    });
  }

  root.querySelector('#novoUsuarioBtn').addEventListener('click', abrirForm);
  desenhar();
}
```

- [ ] **Step 4: Publicar a função no staging**

Run:
```bash
supabase login
supabase link --project-ref REF_DO_STAGING
supabase functions deploy criar-usuario --project-ref REF_DO_STAGING
```
Expected: função publicada sem erro.

- [ ] **Step 5: Testar no staging**

1. Como admin, crie um operador novo pela aba Segurança > Usuários.
2. Saia e entre com o operador: Financeiro e Usuários não aparecem.
3. Como admin, mude o papel do operador para admin e confirme que ele passa a ver o Financeiro após novo login.
4. Desative o usuário e confirme que ele é bloqueado no login (`perfil.ativo = false`).
5. Reative.
6. Confirme os eventos na Auditoria.

- [ ] **Step 6: Commit**

```bash
git add supabase/
git add assets/js/admin/usuarios.js assets/js/db.js
git commit -m "feat: adiciona gestão de usuários com edge function

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Fase 4 — Validação e deploy

### Task 15: Validação completa no staging

**Files:**
- Create: `docs/superpowers/validation/2026-11-14-checklist.md`
- Test: manual + automatizado

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: checklist assinado e correções aplicadas.

- [ ] **Step 1: Rodar a suíte automatizada**

Run: `npm test`
Expected: todos os testes PASS.

- [ ] **Step 2: Subir o servidor local**

Run: `npm run serve`
Expected: servidor em `http://localhost:3000`.

- [ ] **Step 3: Criar o checklist de validação**

`docs/superpowers/validation/2026-11-14-checklist.md`:
```markdown
# Checklist de validação — app administrativo

Ambiente: staging
Data:
Responsável:

- [ ] Login correto entra; senha errada é rejeitada; logout encerra a sessão.
- [ ] Operador não acessa Financeiro, Usuários nem Auditoria; admin acessa.
- [ ] Usuário pendente não vê dados.
- [ ] Pedido feito no cardápio de staging aparece no Kanban em até 30 s.
- [ ] Arrastar entre todas as colunas funciona no desktop.
- [ ] Arrastar funciona no celular (toque).
- [ ] Cancelar exige motivo e ciência; card fica em Cancelado.
- [ ] Total da coluna Cancelado é sempre R$ 0,00.
- [ ] Restaurar cancelado volta para a etapa anterior e registra log.
- [ ] Motoboy só é atribuído em Em entrega; retirada não exige.
- [ ] Relatório de motoboy soma apenas concluídos do período e ignora cancelados.
- [ ] Marcar repasse como pago separa pendente de pago.
- [ ] Pedido manual de iFood é criado e aparece no Kanban.
- [ ] Faturar com valor recebido menor gera entrada cheia + saída da taxa.
- [ ] Reabrir faturamento com outro valor atualiza a taxa sem duplicar.
- [ ] Desmarcar pagamento ou cancelar remove o lançamento automático.
- [ ] Bairro adicionado/editado/removido grava e lê corretamente no staging (a integração com o cardápio é validada na Task 17).
- [ ] Lançamento manual de entrada e saída altera os cards do período.
- [ ] CSV do financeiro abre corretamente.
- [ ] Auditoria registra as ações com o usuário logado.
- [ ] Anônimo lê produtos/config/bairros, insere pedido, mas não lê pedidos nem financeiro.
- [ ] Layout utilizável em celular (abas, Kanban, modais, tabelas).
- [ ] Console sem erros.
```

- [ ] **Step 4: Executar o checklist no staging**

Antes do teste de RLS, simule o estado final no staging rodando `database/005-rls-cutover.sql` no SQL Editor. O cardápio continua criando pedidos porque o INSERT anônimo é mantido.

Percorra cada item no navegador e no celular. Para o teste de RLS anônima, rode:
```bash
KEY="CHAVE_PUBLICAVEL_DE_STAGING"
URL="https://SEU-PROJETO-STAGING.supabase.co/rest/v1"
for t in pedidos financeiro perfis logs; do
  echo -n "$t: "
  curl -s "$URL/$t?select=id&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
  echo
done
for t in bairros produtos config; do
  echo -n "$t: "
  curl -s -o /dev/null -w "%{http_code}\n" "$URL/$t?select=id&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
done
```
Expected: `[]` em `pedidos`, `financeiro`, `perfis` e `logs`; `200` em `bairros`, `produtos` e `config`. RLS devolve lista vazia, não erro HTTP.

- [ ] **Step 5: Corrigir o que falhar e repetir**

Cada correção ganha teste (quando for lógica pura) ou entrada no checklist. Rode `npm test` e o checklist novamente.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/validation/2026-11-14-checklist.md
git add -A
git commit -m "test: valida app administrativo no staging

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 16: Migração aditiva de produção e deploy do `/admin` lado a lado

**Files:**
- nenhum arquivo novo; execução operacional
- Modify: `README.md` (instruções de produção)

**Interfaces:**
- Consumes: SQL validado no staging; branch `feat/admin-operacao`.
- Produces: `/admin/` publicado em produção, com `/pedidos` e cardápio antigos intactos.

- [ ] **Step 1: Fazer backup das tabelas de produção**

No painel do Supabase de produção, use Database > Backups (se disponível) ou exporte via SQL Editor:
```sql
-- Exporte o resultado para CSV pelo próprio painel
select * from pedidos;
select * from produtos;
select * from config;
select * from status;
```
Guarde os arquivos fora do repositório.

- [ ] **Step 2: Aplicar as migrações aditivas em produção**

No SQL Editor de produção, rode na ordem: `001-schema.sql`, `002-rls-base.sql`, `003-seed-bairros.sql`, `004-backfill.sql`.

Não rode `005`/cutover nesta etapa.

- [ ] **Step 3: Verificar produção sem alterar o comportamento antigo**

Run no SQL Editor:
```sql
select count(*) from bairros;
select count(*) from pedidos where status_kanban = 'novo';
```
Abra o cardápio público e o `/pedidos`: ambos devem continuar funcionando como antes.

- [ ] **Step 4: Criar o administrador inicial em produção**

1. Authentication > Users > Add user: e-mail do responsável, senha forte, e-mail confirmado.
2. No SQL Editor:
```sql
update perfis
set papel = 'admin', ativo = true, nome = 'Administrador'
where email = 'EMAIL_DO_ADMIN';
```
3. Confirme em `select id, email, papel, ativo from perfis;`.

- [ ] **Step 5: Fazer merge da branch e publicar o admin**

```bash
git checkout main
git pull --ff-only
git merge --no-ff feat/admin-operacao
git push origin main
```
Expected: o GitHub Actions publica o site. O `/admin/` passa a existir; `/index.html` e `/pedidos/` continuam com o código antigo porque ainda não foram alterados.

- [ ] **Step 6: Validar o admin em produção com pedidos de teste**

1. Abra `https://gustavo-h-martins.github.io/churrasco_marmita/admin/`.
2. Faça login com o admin.
3. Crie um pedido manual "TESTE — NÃO PRODUZIR" de R$ 1.
4. Mova pelo Kanban, atribua um motoboy de teste e fature com R$ 0,90.
5. Confirme financeiro e relatório.
6. Exclua o pedido e os lançamentos de teste pelo SQL Editor:
```sql
delete from financeiro where pedido_id in (select id from pedidos where cliente like 'TESTE%');
delete from pedidos where cliente like 'TESTE%';
```
7. Confirme que o cardápio público e o `/pedidos` antigo continuam funcionando.

- [ ] **Step 7: Atualizar o README com o estado de produção**

```markdown
## Produção

- Cardápio: `/index.html`
- Admin novo: `/admin/` (em validação)
- Pedidos antigos: `/pedidos/` (será redirecionado no cutover)
- Projeto Supabase de produção: `eszmbpviuhkrmwhemhqn`
- Projeto Supabase de staging: preencher com o ref usado nos testes
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: registra deploy lado a lado do admin

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git push origin main
```

---

### Task 17: Refatoração do cardápio público e cutover

> **Antes de começar:** a Task 16 já levou a branch `feat/admin-operacao` para a `main`. Atualize a branch antes de mexer no cardápio:
>
> ```bash
> git checkout feat/admin-operacao
> git merge main
> ```
>
> As alterações desta task são commitadas nessa branch e só entram em produção no Step 7.

**Files:**
- Modify: `index.html`
- Create: `assets/css/menu.css`
- Create: `assets/js/menu.js`
- Modify: `assets/js/db.js` (se necessário para bairros)
- Modify: `pedidos/index.html` (redirect)
- Create: `database/005-rls-cutover.sql`

**Interfaces:**
- Consumes: `listarBairros`, `calcularFrete`, `fmtBRL`, `parseBRL`.
- Produces: cardápio lendo bairros do banco; `/admin/` como único acesso administrativo; RLS final.

- [ ] **Step 1: Extrair CSS do cardápio para `assets/css/menu.css`**

Mova o bloco `<style>` interno de `index.html` (a partir de `.menu-app`) para `assets/css/menu.css`. Mantenha `base.css` para tokens e reset. O `<head>` do cardápio passa a ter:
```html
<link rel="stylesheet" href="assets/css/base.css" />
<link rel="stylesheet" href="assets/css/menu.css" />
```

- [ ] **Step 2: Extrair o JavaScript para `assets/js/menu.js`**

Mova o script do cardápio para um módulo ES. Importe:
```js
import { SUPABASE, LOJA_FALLBACK } from './config.js';
import { sb, listarBairros } from './db.js';
import { fmtBRL, esc } from './format.js';
import { calcularFrete } from './calc.js';
```
Substitua a constante `shippingRates` por:
```js
// Cópia local de emergência: mesmos 37 registros de database/003-seed-bairros.sql.
const BAIRROS_FALLBACK = [
  ['Acácias',2,'Bairro'], ['Vila Maria',2,'Bairro'], ['Santa Helena',2,'Bairro'],
  ['Vila Rica',3,'Bairro'], ['Jardim Imperial',3,'Bairro'], ['Por do Sol',3,'Bairro'],
  ['Moradas',3,'Bairro'], ['Vale Verde Ville',3,'Bairro'], ['Portal do Sol',3,'Bairro'],
  ['Jacques Vile',3,'Bairro'], ['Palmital',4,'Bairro'], ['Vale dos Sonhos',4,'Bairro'],
  ['Vila Fagundes',4,'Bairro'], ['Sobradinho',5,'Bairro'], ['Brant',5,'Bairro'],
  ['Campinho',5,'Bairro'], ['Centro',6,'Bairro'], ['Barraginha',6,'Bairro'],
  ['Várzea',7,'Bairro'], ['Bela Vista',7,'Bairro'], ['Joa',8,'Bairro'],
  ['Santos Dumont',8,'Bairro'], ['Ovídeo Guerra',8,'Bairro'], ['Ipê',9,'Bairro'],
  ['Praia Angélica',9,'Bairro'], ['Novo Santos Dumont',9,'Bairro'], ['Recanto',9,'Bairro'],
  ['Aeronautas',10,'Bairro'], ['Visão',10,'Bairro'], ['Lagoinha',10,'Bairro'],
  ['Lundceia',6,'Bairro'], ['Recanto do Poeta',10,'Bairro'],
  ['Amendoeiras',10,'Condomínio'], ['Mirante do Fidalgo',5,'Condomínio'],
  ['Bouganvile',10,'Condomínio'], ['Maripousas',5,'Condomínio'],
  ['Trilhas do Sol',5,'Condomínio']
].map(([nome, taxa, grupo]) => ({ nome, taxa, grupo }));

let bairros = [];
try {
  bairros = await listarBairros();
  if (!bairros.length) bairros = BAIRROS_FALLBACK;
} catch (e) {
  console.warn('Falha ao carregar bairros; usando fallback local.', e);
  bairros = BAIRROS_FALLBACK;
}
```
Substitua o literal de `storeConfig` por `{ ...LOJA_FALLBACK }` e mantenha a função `loadConfigFromDB` sobrescrevendo os campos com os valores do banco.

Preencha o `<select id="neighborhood">` dinamicamente:
```js
function preencherBairros() {
  const select = document.getElementById('neighborhood');
  const grupos = ['Bairro', 'Condomínio'];
  select.innerHTML = '<option value="">Selecione o bairro...</option>' +
    grupos.map(g => {
      const itens = bairros.filter(b => (b.grupo || 'Bairro') === g && b.ativo !== false);
      if (!itens.length) return '';
      const opcoes = itens.map(b => `<option value="${esc(b.nome)}">${esc(b.nome)} — ${fmtBRL(b.taxa)}</option>`).join('');
      return g === 'Condomínio' ? `<optgroup label="Condomínios">${opcoes}</optgroup>` : opcoes;
    }).join('');
}
```

Chame `preencherBairros()` antes de `render()` na inicialização assíncrona do cardápio.

No `index.html`, carregue o SDK antes do módulo:
```html
<script src="assets/vendor/supabase-js.umd.js"></script>
<script type="module" src="assets/js/menu.js"></script>
```
No cálculo do frete:
```js
const shipping = deliveryMode === 'retirada' ? 0 : calcularFrete(bairros, neighborhood);
```

- [ ] **Step 3: Remover o painel administrativo antigo do cardápio**

Remova de `index.html` e de `menu.js`:
- o modal `adminModal` e a senha `ADMIN_PASSWORD`;
- o painel `adminPanel`, modais `productsModal` e `configModal`;
- funções `adminLogin`, `adminSubmit`, `adminCancel`, CRUD de produtos/config/loja;
- o botão `⚙️ Admin` do rodapé.

Substitua o rodapé por:
```html
<div class="footer-admin">
  <a href="admin/">⚙️ Admin</a>
  <a href="admin/#pedidos">📋 Pedidos</a>
</div>
```

- [ ] **Step 4: Transformar `/pedidos` em redirect**

Substitua `pedidos/index.html` por:
```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0; url=../admin/#pedidos" />
  <title>Redirecionando…</title>
</head>
<body>
  <p>Redirecionando para o <a href="../admin/#pedidos">painel administrativo</a>…</p>
</body>
</html>
```

- [ ] **Step 5: Criar `database/005-rls-cutover.sql`**

```sql
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
```

- [ ] **Step 6: Testar o cardápio refatorado no staging**

1. Confirme que os produtos, o banner e a logo carregam do Supabase.
2. Adicione um pedido escolhendo bairro e confirme que o frete aparece no resumo.
3. Confirme que o pedido cai em `pedidos` com `status_kanban = 'novo'`.
4. Confirme que retirada não cobra frete.
5. Confirme que o rodapé leva ao `/admin/`.

- [ ] **Step 7: Fazer o cutover em produção**

```bash
git checkout main
git pull --ff-only
git merge --no-ff feat/admin-operacao
git push origin main
```
Depois, no SQL Editor de produção, rode `005-rls-cutover.sql`.

- [ ] **Step 8: Verificar o cutover**

1. Abra o cardápio público e faça um pedido de teste real (pode cancelar depois).
2. Confirme que o pedido aparece no `/admin/`.
3. Abra `/pedidos/`: deve redirecionar para `/admin/#pedidos`.
4. Confirme que a senha antiga `bdg2026` não existe mais no código:
```bash
rg -n "bdg2026|ADMIN_PASSWORD" --glob '!docs/**' .
```
Expected: nenhuma ocorrência.
5. Rode o teste de RLS anônima da Task 15 contra produção.

- [ ] **Step 9: Commit**

```bash
git add index.html assets/css/menu.css assets/js/menu.js pedidos/index.html database/005-rls-cutover.sql
git commit -m "feat: cutover do admin, cardápio com bairros do banco e rls final

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git push origin main
```

---

### Task 18: Verificação pós-cutover e documentação

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/validation/2026-11-14-pos-cutover.md`
- Test: manual + automatizado

**Interfaces:**
- Consumes: produção publicada.
- Produces: operação documentada e checklist final assinado.

- [ ] **Step 1: Rodar a suíte automatizada novamente**

Run: `npm test`
Expected: todos os testes PASS.

- [ ] **Step 2: Reexecutar o checklist crítico em produção**

Crie `docs/superpowers/validation/2026-11-14-pos-cutover.md`:
```markdown
# Verificação pós-cutover

Data:
Responsável:

- [ ] Login admin e operador.
- [ ] Pedido real do cardápio aparece no Kanban.
- [ ] Arrastar e soltar no desktop e no celular.
- [ ] Cancelamento com motivo e ciência; cancelados fora dos totais.
- [ ] Atribuição de motoboy em Em entrega.
- [ ] Relatório de motoboy confere com as entregas do dia.
- [ ] Pedido manual de iFood faturado com valor recebido menor.
- [ ] Financeiro com entrada cheia e saída da taxa.
- [ ] Bairro novo/editado reflete no cardápio.
- [ ] `/pedidos` redireciona.
- [ ] Senha antiga ausente do código.
- [ ] RLS anônima bloqueando pedidos, financeiro, perfis e logs.
- [ ] Nenhum erro no console.
```

- [ ] **Step 3: Atualizar o README com operação e recuperação**

Inclua:
```markdown
## Operação diária

1. Pedidos do cardápio entram na coluna Novo.
2. Arraste para Em preparo, Pronto e Em entrega.
3. Em Em entrega, atribua o motoboy.
4. Ao entregar, arraste para Concluído.
5. Para cancelar, arraste para Cancelado e informe motivo + ciência.
6. Pedidos de iFood são lançados em "+ Novo pedido" e faturados depois com o valor recebido.

## Recuperação

- Se o admin falhar após um deploy, reverta o merge na `main`; o GitHub Pages republica a versão anterior.
- Se a RLS bloquear a operação, rode `database/999-rollback.sql` somente após exportar financeiro e logs.
- O histórico do Git ainda contém o `.env` antigo; a senha do iFood deve ser trocada.
```

- [ ] **Step 4: Confirmar o estado final do repositório**

Run:
```bash
git status --short
git log --oneline -10
rg -n "bdg2026|ADMIN_PASSWORD|pwd_ifood=Churrasco" --glob '!docs/**' .
```
Expected: árvore limpa; nenhuma ocorrência de senha antiga ou credencial real fora de documentação histórica.

- [ ] **Step 5: Commit final**

```bash
git add README.md docs/superpowers/validation/2026-11-14-pos-cutover.md
git commit -m "docs: registra operação e verificação pós-cutover

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git push origin main
```

---

## Auto-revisão do plano

**Cobertura do spec:**

| Requisito do spec | Task |
| --- | --- |
| Remover `.env` e segredos | 1 |
| Schema, RLS, seed e backfill | 2 |
| Supabase Auth, papéis e RLS | 2, 5, 14 |
| Kanban com seis colunas e drag & drop | 8, 9 |
| Cancelado visível e fora de relatórios | 8, 9, 11 |
| Motoboy a partir de Em entrega | 9, 11 |
| Relatório de motoboy com repasse | 11 |
| Pedidos manuais e faturamento iFood | 10 |
| Financeiro automático e manual | 10, 12 |
| Bairros na aba Pedidos | 7 |
| Cardápio lendo bairros do banco | 17 |
| Cardápio/Loja no admin | 13 |
| Usuários e auditoria | 6, 14 |
| Validação em staging | 15 |
| Deploy lado a lado | 16 |
| Cutover e RLS final | 17 |
| Verificação pós-cutover | 18 |

**Consistência de tipos e nomes:** status e colunas usados nas Tasks 5–18 batem com o SQL da Task 2. O módulo `financeiro-sync.js` é criado na Task 9 e consumido por `pedidos.js` na mesma task e pela Task 10. A Task 9 já implementa o modal de cancelamento completo com justificativa e ciência, além de preservar a impressão térmica e a cópia de endereço. A Task 10 só acrescenta o faturamento e o botão de pedido manual.
