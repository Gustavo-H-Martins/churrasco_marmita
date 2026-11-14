# Churrasco na Marmita — App administrativo e gestão operacional

**Data:** 2026-11-14
**Status:** desenho validado com o usuário; aguardando revisão do spec
**Substitui:** o painel administrativo embutido no cardápio e a página `/pedidos` atual

---

## 1. Contexto

Hoje o projeto é um site estático publicado no GitHub Pages com:

- `index.html`: cardápio público que monta o pedido e finaliza no WhatsApp;
- `pedidos/index.html`: lista de pedidos com filtros, impressão de etiquetas, marcação de pagamento e cancelamento com justificativa + ciência de três pessoas;
- Supabase como backend: tabelas `pedidos`, `produtos`, `config` e `status`;
- senha administrativa fixa no JavaScript (`bdg2026`) e políticas de banco abertas para a chave publicável;
- bairros e taxas de entrega fixos no código do cardápio.

O negócio cresceu e precisa de operação diária: quadro de pedidos, motoboys, controle financeiro, cadastro de bairros e lançamento manual de pedidos de iFood com faturamento posterior.

### Estado real verificado em 2026-11-14

A tabela `pedidos` já possui: `id`, `created_at`, `cliente`, `telefone`, `bairro`, `endereco`, `pagamento`, `observacao`, `itens`, `subtotal`, `frete`, `total`, `finalizado`, `finalizado_por`, `finalizado_em`, `impresso`, `impresso_por`, `impresso_em`, `cancelado`, `motivo_cancelamento`, `cancelado_por`, `cancelado_ip`, `cancelado_em`.

As tabelas `bairros`, `motoboys`, `financeiro`, `perfis` e `logs` ainda não existem.

---

## 2. Objetivos

1. Quadro Kanban de pedidos com arrastar e soltar entre as esteiras, incluindo coluna de cancelados visível.
2. Cadastro de motoboys, atribuição de entregas e relatório de repasse por período.
3. Aba financeira de entradas e saídas, com lançamentos automáticos a partir dos pedidos e lançamentos manuais.
4. Cadastro, edição, remoção e alteração de preço dos bairros de entrega, gerenciados na aba de Pedidos.
5. Criação manual de pedidos (nome, itens e valor total), com faturamento posterior para pedidos de iFood e cartão, registrando o valor efetivamente recebido.
6. Área administrativa protegida por login real, com papéis de administrador e operador, e registro de auditoria por usuário.
7. Refinar a base: tirar segredos do repositório, reduzir duplicação, separar código por responsabilidade e manter o deploy estático sem etapa de build.

### Fora de escopo

- Integração automática com a API do iFood (o faturamento continua manual).
- Pagamento online ou carteira do cliente.
- Aplicativo nativo.
- Conta de cliente no cardápio.
- Substituição da impressão térmica atual.
- Sincronização em tempo real por WebSocket (será usado polling curto).

---

## 3. Decisões tomadas

| Tema | Decisão |
| --- | --- |
| Arquitetura | App administrativo único em `/admin/`, com abas, mantendo GitHub Pages + Supabase |
| Esteiras | Novo · Em preparo · Pronto · Em entrega · Concluído · Cancelado (visível) |
| Cancelados | Aparecem no quadro, mas não entram em nenhum total ou relatório |
| Motoboy | Pode ser atribuído a partir de "Em entrega"; recebe valor por entrega; relatório com repasse marcável como pago |
| Financeiro | Entradas automáticas dos pedidos pagos + lançamentos manuais de saída; taxas entram como saída |
| Valores | O pedido registra o valor cheio; taxas de iFood/cartão são lançadas como saída no faturamento |
| Segurança | Supabase Auth (e-mail + senha), papéis admin/operador, RLS e log de auditoria |
| Cadastro de usuários | Admin cria operadores e administradores pela própria aplicação, via Edge Function com service role |
| Validação | Local + segundo projeto Supabase de staging; deploy lado a lado; checklist obrigatório antes do cutover |
| Deploy | Push na `main` publica no GitHub Pages; branches de trabalho não publicam |

---

## 4. Arquitetura

```text
GitHub Pages (estático, sem build)
├── /index.html              cardápio público
├── /admin/index.html        app administrativo com abas
├── /assets/                 CSS, JS, bibliotecas vendorizadas
└── /pedidos/index.html      redirect para /admin/#pedidos após o cutover

Supabase (produção)
├── Auth (e-mail + senha, signup desativado)
├── Postgres + RLS
└── Edge Function criar-usuario (service role, só para admin)

Supabase (staging)
└── mesmo schema, dados de teste; usado por localhost
```

O app administrativo é uma SPA leve em JavaScript puro, com módulos ES. Não há bundler, transpilador nem npm em produção. As dependências de navegador são vendorizadas com versão fixa:

- `@supabase/supabase-js` (UMD) para autenticação e acesso REST;
- `SortableJS` para arrastar e soltar com suporte a toque.

### Seleção de ambiente

`assets/js/config.js` escolhe as chaves pelo hostname:

- `localhost` e `127.0.0.1` → projeto Supabase de **staging**;
- qualquer outro host → projeto de **produção**.

A interface administrativa exibe um selo visível **STAGING** quando roda em staging, para evitar confusão em testes. Nenhuma chave secreta (service role) é incluída no front-end.

---

## 5. Autenticação, papéis e RLS

### 5.1 Autenticação

- Login com e-mail e senha via Supabase Auth.
- Sessão persistida pelo SDK; botão "Sair" encerra a sessão.
- Signup público desativado no projeto Supabase. Usuários são criados pelo administrador.
- O primeiro administrador é criado manualmente no painel do Supabase com o e-mail indicado pelo responsável e promovido por SQL. O e-mail não é gravado no repositório.
- Troca de senha pelo próprio usuário na aba Segurança; recuperação por e-mail do Supabase.

### 5.2 Papéis

| Papel | Acesso |
| --- | --- |
| `admin` | Tudo: pedidos, motoboys, financeiro, cardápio, usuários e auditoria |
| `operador` | Pedidos, motoboys, relatórios operacionais e cardápio/loja; sem financeiro, sem usuários, sem auditoria |
| `pendente` | Nenhum dado; aguarda aprovação do admin |

Marcar pedido como pago, faturar, desfaturar e lançar/editar valores no financeiro são ações exclusivas do `admin`. O operador pode cancelar pedidos; a remoção dos lançamentos automáticos de um pedido cancelado é permitida por uma política estreita, mesmo sem acesso de leitura ao financeiro.

A tabela `perfis` espelha `auth.users`:

```sql
create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  papel text not null default 'pendente'
    check (papel in ('admin','operador','pendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
```

Um trigger em `auth.users` cria o perfil como `pendente`. A Edge Function `criar-usuario` e o SQL de bootstrap promovem o papel.

### 5.3 Funções auxiliares de RLS

```sql
create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis
    where id = auth.uid() and ativo and papel in ('admin','operador')
  );
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfis
    where id = auth.uid() and ativo and papel = 'admin'
  );
$$;
```

### 5.4 Matriz de permissões

| Tabela | anônimo | operador | admin |
| --- | --- | --- | --- |
| `produtos` | SELECT | SELECT/INSERT/UPDATE/DELETE | idem |
| `config` | SELECT | SELECT/UPDATE | idem |
| `status` | SELECT | SELECT/UPDATE | idem |
| `bairros` | SELECT | SELECT/INSERT/UPDATE/DELETE | idem |
| `pedidos` | INSERT | SELECT/UPDATE | SELECT/UPDATE/DELETE |
| `motoboys` | — | SELECT/INSERT/UPDATE | idem |
| `financeiro` | — | — | SELECT/INSERT/UPDATE/DELETE |
| `perfis` | — | SELECT do próprio perfil | SELECT/UPDATE de todos |
| `logs` | — | INSERT | SELECT/INSERT |

Regras:

- O cardápio público continua criando pedidos anonimamente. O INSERT anônimo não permite leitura, alteração ou exclusão.
- O painel antigo usa a chave anônima com escrita aberta; essas políticas só são removidas no cutover, depois que o novo admin estiver validado. Isso mantém o `/pedidos` funcionando durante a validação lado a lado.
- Após o cutover, nenhuma escrita anônima permanece fora do INSERT de pedidos.
- A Edge Function usa service role e não depende de RLS; ela valida o JWT do chamador e confirma `eh_admin()` antes de criar o usuário.
- Operadores podem excluir lançamentos automáticos (`origem` `pedido` ou `taxa`) apenas quando o pedido vinculado já está cancelado. Sem essa política, o cancelamento por operador deixaria receita e taxa órfãs no financeiro.

### 5.5 Auditoria

Tabela `logs`:

```sql
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
```

Eventos registrados: login/logout, criação de pedido manual, mudança de etapa, atribuição de motoboy, conclusão, cancelamento, restauração, marcação de pagamento, faturamento, lançamento/edição/exclusão financeira, CRUD de bairros e motoboys, criação/desativação de usuário e troca de papel.

---

## 6. Modelo de dados

### 6.1 Alterações em `pedidos`

```sql
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
```

Backfill:

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

### 6.2 Bairros

```sql
create table if not exists bairros (
  id bigint generated by default as identity primary key,
  nome text not null unique,
  taxa numeric(10,2) not null default 0 check (taxa >= 0),
  grupo text not null default 'Bairro'
    check (grupo in ('Bairro','Condomínio')),
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);
```

Seed: os 37 bairros e valores hoje fixos no cardápio, com `ordem` preservando a ordem atual e `grupo = 'Condomínio'` nos cinco condomínios (Amendoeiras, Mirante do Fidalgo, Bouganvile, Maripousas e Trilhas do Sol). O agrupamento do cardápio passa a vir do banco.

### 6.3 Motoboys

```sql
create table if not exists motoboys (
  id bigint generated by default as identity primary key,
  nome text not null,
  telefone text,
  valor_entrega numeric(10,2) not null default 0 check (valor_entrega >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
```

`pedidos.motoboy_valor_entrega` guarda o valor vigente no momento da atribuição. Mudanças futuras no cadastro não reescrevem relatórios passados.

### 6.4 Financeiro

```sql
create table if not exists financeiro (
  id bigint generated by default as identity primary key,
  tipo text not null check (tipo in ('entrada','saida')),
  categoria text not null default 'outros',
  descricao text not null,
  valor numeric(10,2) not null check (valor >= 0),
  data date not null default current_date,
  pedido_id bigint references pedidos(id) on delete set null,
  origem text not null default 'manual'
    check (origem in ('manual','pedido','taxa')),
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  editado_em timestamptz
);

create unique index if not exists financeiro_pedido_entrada_uq
  on financeiro (pedido_id) where origem = 'pedido';
create unique index if not exists financeiro_pedido_taxa_uq
  on financeiro (pedido_id) where origem = 'taxa';
```

Os índices únicos parciais impedem duplicidade quando dois dispositivos marcam o mesmo pedido como pago ou faturado.

Categorias sugeridas: `vendas`, `taxa_ifood`, `taxa_cartao`, `motoboy`, `carne`, `gás`, `embalagem`, `marketing`, `outros`. Categorias são texto livre com sugestões na interface.

---

## 7. Telas e fluxos

### 7.1 Shell administrativo

- Cabeçalho com nome da loja, usuário logado, papel e botão Sair.
- Abas: **Pedidos**, **Motoboys**, **Financeiro**, **Cardápio/Loja**, **Segurança**.
- Abas financeiras e de segurança só aparecem para `admin`; o bloqueio real é feito pela RLS.
- Abas com rolagem horizontal no celular.
- Selo STAGING em ambiente de teste.
- Sem login válido, qualquer URL do admin exibe a tela de login.

### 7.2 Aba Pedidos — Kanban

**Colunas:** Novo, Em preparo, Pronto, Em entrega, Concluído, Cancelado.

**Comportamento:**

- Arrastar e soltar entre colunas; também botões "←" e "→" no card para teclado e acessibilidade.
- Reordenar dentro da coluna atualiza `posicao`.
- Ao soltar em **Cancelado**, abre o modal de cancelamento existente (justificativa obrigatória + ciência de pelo menos uma pessoa). Só move após confirmar.
- Cancelar grava `cancelado = true`, `status_kanban = 'cancelado'`, `status_anterior` com a etapa de origem, motivo, ciência, IP e data.
- Restaurar um cancelado (admin) volta para `status_anterior` ou `novo`, limpa os campos de cancelamento e registra o log. Se existir lançamento automático no financeiro, ele é removido.
- Ao entrar em **Em entrega**, o card mostra o seletor de motoboy. Pedidos de retirada (`bairro = 'Retirada no local'`) não exigem motoboy.
- Ao entrar em **Concluído**, grava `entregue_em`. Se for entrega sem motoboy, mostra aviso, mas não bloqueia.
- A coluna Cancelado fica visível; seus cards e valores são excluídos de todos os totais, contadores e relatórios.

**Cards mostram:** número do dia, nome do cliente, bairro, total, hora do pedido, forma de pagamento, canal (iFood/manual) e motoboy atribuído. Clique abre o detalhe com itens, endereço, histórico e ações (imprimir etiqueta no layout atual, copiar endereço, marcar como pago [admin], faturar [admin], cancelar, restaurar).

**Filtros:** busca por cliente/telefone, canal, motoboy. As colunas Concluído e Cancelado mostram por padrão o dia atual; um seletor de período permite consultar outra data sem carregar todo o histórico.

**Atualização:** polling a cada 30 segundos, pausado enquanto houver arrasto, modal aberto ou alterações não salvas. As ações do Kanban são salvas imediatamente (sem botão "Salvar alterações"), com indicador visual de sucesso/erro e log.

**Bairros:** painel recolhível "Bairros e taxas" dentro da aba Pedidos. Lista com nome, grupo (Bairro/Condomínio), taxa, ativo, ordem e ações de editar/excluir; formulário para adicionar. Alterações refletem no cardápio público na próxima carga. Exclusão exige confirmação e é bloqueada se houver pedido recente usando o bairro; nesse caso, orienta desativar em vez de excluir.

### 7.3 Pedido manual e faturamento

**+ Novo pedido** na aba Pedidos. Campos:

- Cliente (obrigatório);
- Itens em linhas livres (obrigatório);
- Valor total (obrigatório, digitado pelo operador);
- Canal: iFood, WhatsApp, Balcão, Outro (obrigatório);
- Telefone, bairro, endereço, forma de pagamento e observação (opcionais);
- Aviso de que o pedido nasce em **Novo** e o valor digitado é o valor cheio.

O pedido grava `origem = 'manual'`, `valor_bruto = total` e `itens` como uma linha por item, com `quantidade = 1`, `preco_unitario = null` e `subtotal = null`. O campo `total` é a fonte de verdade do valor; o detalhe e a etiqueta exibem as linhas sem tentar somá-las.

**Faturar** (card/detalhe, disponível para pedidos com canal iFood, cartão ou balcão):

- Pede o valor efetivamente recebido (padrão: valor cheio);
- Calcula a taxa como `valor_bruto - valor_recebido`, editável;
- Grava `valor_recebido`, `taxa`, `faturado`, `faturado_em`, `faturado_por`;
- Cria/atualiza a entrada automática do valor cheio e a saída automática da taxa.

O detalhe exibe: valor cheio, taxa, valor líquido recebido e a data do faturamento. Reabrir o faturamento atualiza os valores. **Desfaturar** (admin) remove a saída da taxa, limpa `valor_recebido` e `faturado` e registra log. Desmarcar o pagamento de um pedido faturado exige desfaturar antes, para não deixar receita e taxa inconsistentes.

### 7.4 Aba Motoboys

- Cadastro: nome, telefone, valor por entrega, ativo.
- Relatório por período (padrão: hoje), agrupado por motoboy:
  - quantidade de entregas;
  - valor por entrega usado em cada pedido (snapshot);
  - total a receber;
  - lista dos pedidos com número do dia, cliente e bairro;
  - separação entre pendente e já repassado.
- Botão **Marcar repasse como pago** grava `repasse_pago_em` nos pedidos do grupo.
- Botão **Copiar relatório** gera texto para enviar no WhatsApp.
- Critério de inclusão: `status_kanban = 'concluido'`, `motoboy_id` preenchido, `cancelado = false`, `entregue_em` dentro do período.
- Cancelados nunca entram, mesmo que tenham sido concluídos antes.

### 7.5 Aba Financeiro (admin)

- Cards do período: entradas, saídas, saldo, taxas e faturamento líquido.
- Filtro: hoje, últimos 7 dias, mês atual e intervalo personalizado.
- Lista de lançamentos com data, tipo, categoria, descrição, valor, origem (manual, pedido ou taxa) e vínculo com o pedido.
- Lançamento manual: tipo, categoria, descrição, valor e data.
- Edição/exclusão apenas de lançamentos manuais. Lançamentos automáticos são alterados pelo pedido que os originou.
- Exportação CSV do período.
- Fuso horário dos relatórios: `America/Sao_Paulo`.

**Regras de geração automática:**

- Pedido marcado como pago (`finalizado = true`) e não cancelado → entrada `origem = 'pedido'`, valor `valor_bruto` (ou `total` quando nulo), vínculo `pedido_id`. A marcação de pagamento é exclusiva do admin no novo app; o `/pedidos` antigo continua podendo fazê-la até o cutover.
- Pedido desmarcado como pago ou cancelado → lançamento automático correspondente é removido.
- Faturamento → entrada do valor cheio (se ainda não existir) + saída `origem = 'taxa'` com o valor da taxa. Faturar e desfaturar são exclusivos do admin.
- As operações usam upsert pelos índices únicos para evitar duplicidade.

### 7.6 Aba Cardápio/Loja

Absorve o painel antigo do cardápio:

- Abrir/fechar a loja;
- CRUD de produtos (nome, preço, descrição, categoria, imagem, ativo, ordem);
- Configuração da loja (nome, descrição, telefone, Instagram, endereço, banner, logo).

Após o cutover, o painel embutido no cardápio e a senha fixa são removidos. O botão "Admin" do cardápio passa a apontar para `/admin/`.

### 7.7 Aba Segurança

- **Meu perfil:** nome e troca de senha.
- **Usuários (admin):** lista com nome, e-mail, papel e ativo. Ações: criar usuário, alterar papel, desativar/reativar.
- Criação de usuário chama a Edge Function `criar-usuario`, que valida o JWT do admin, cria o usuário com e-mail confirmado e define o papel.
- Exclusão de usuário não é feita pela interface; desativa-se o perfil para preservar o histórico de auditoria.
- **Auditoria (admin):** últimos eventos com usuário, ação, entidade, detalhe e data; filtros por usuário e período.

---

## 8. Regras de negócio

1. **Pagamento e entrega são independentes.** `finalizado` indica dinheiro recebido; `status_kanban` indica a etapa da operação. Um pedido pode estar concluído e não pago.
2. **Cancelado não conta.** Nenhum total, contador, card ou relatório soma pedidos cancelados; a coluna Cancelado existe apenas para visibilidade e restauração.
3. **Motoboy só a partir de Em entrega.** A interface impede a atribuição antes disso. A regra é reforçada na camada de dados do app; o banco não impõe constraint para não travar correções manuais do admin.
4. **Valor cheio + taxa = líquido.** O financeiro registra a receita cheia e a taxa como saída. O líquido é sempre calculado, nunca gravado como receita.
5. **Taxa do cartão segue o mesmo fluxo do iFood.** Canal, faturamento e taxa são independentes da forma de pagamento.
6. **Relatório de motoboy usa o snapshot.** O valor pago é o que estava cadastrado no momento da atribuição.
7. **Cancelamento exige justificativa e ciência.** Mantém o fluxo atual, agora com registro do usuário logado.
8. **Restauração de cancelado é exclusiva do admin.**
9. **Moeda em centavos.** Valores são `numeric(10,2)`; cálculos no front arredondam para duas casas antes de exibir e gravar.

---

## 9. Validação e deploy

### 9.1 Ambientes

| Ambiente | Front-end | Banco | Uso |
| --- | --- | --- | --- |
| Local | servidor estático local | Supabase staging | desenvolvimento e checklist |
| Produção | GitHub Pages | Supabase produção | operação real |

O projeto de staging é um segundo projeto Supabase gratuito, com o mesmo schema e dados fictícios. As chaves publicáveis de staging ficam em `config.js`; nenhuma chave secreta entra no repositório.

### 9.2 Ordem de migração

1. Exportar/backup das tabelas `pedidos`, `produtos`, `config` e `status` de produção.
2. Rodar schema, RLS e seed primeiro no staging; executar o checklist completo.
3. Aplicar em produção apenas migrações aditivas: novas tabelas, novas colunas e backfill. Nada é removido nesta etapa.
4. Manter temporariamente as políticas anônimas antigas e o cardápio atual intactos.
5. Publicar apenas `/admin/` lado a lado. O `/pedidos` e o cardápio antigo continuam operando normalmente.
6. Validar em produção com pedidos de teste identificáveis, depois removê-los.
7. No cutover: publicar o cardápio novo (lendo bairros do banco), atualizar links, transformar `/pedidos` em redirect, remover o painel antigo e apertar a RLS.
8. Reexecutar o checklist crítico após o cutover.

### 9.3 Checklist de aceite

Executado primeiro no staging e repetido em produção antes do cutover:

- [ ] Login correto entra; senha errada é rejeitada; logout encerra a sessão.
- [ ] Operador não acessa Financeiro, Usuários nem Auditoria; admin acessa.
- [ ] Usuário `pendente` não vê dados.
- [ ] Pedido feito no cardápio aparece no Kanban em até 30 segundos.
- [ ] Arrastar entre todas as colunas funciona no desktop e no celular.
- [ ] Cancelar exige motivo e ciência; card fica na coluna Cancelado e não entra em nenhum total.
- [ ] Restaurar cancelado volta para a etapa anterior e registra log.
- [ ] Motoboy só pode ser atribuído em Em entrega; pedido de retirada não exige.
- [ ] Relatório de motoboy soma apenas concluídos do período, ignora cancelados e usa o valor do snapshot.
- [ ] Marcar repasse como pago separa pendente de pago.
- [ ] Pedido manual de iFood é criado, aparece no Kanban e pode ser faturado.
- [ ] Faturar com valor recebido menor gera entrada cheia + saída da taxa; o líquido confere.
- [ ] Desmarcar pagamento ou cancelar remove o lançamento automático.
- [ ] Bairro adicionado/editado/removido reflete no cardápio e no cálculo do frete.
- [ ] Lançamento manual de entrada e saída altera os cards do período.
- [ ] Auditoria registra as ações com o usuário logado.
- [ ] RLS: anônimo lê produtos/config/bairros, insere pedido, mas não lê pedidos nem financeiro.
- [ ] Layout utilizável em celular (abas, Kanban, modais, tabelas).
- [ ] Console sem erros e sem segredos no repositório.

### 9.4 Rollback

- **Código:** reverter o merge na `main`; o GitHub Pages republica a versão anterior. O `/pedidos` antigo permanece disponível até o cutover.
- **Banco:** as migrações são aditivas; a versão antiga do código ignora as colunas e tabelas novas. O script `database/999-rollback.sql` remove apenas objetos novos e só é usado se necessário, depois de exportar `financeiro` e `logs`.
- **RLS:** o aperto final só acontece depois do checklist aprovado. Em caso de falha, as políticas antigas são restauradas pelo script de rollback.

---

## 10. Estrutura de arquivos

```text
index.html
admin/index.html
pedidos/index.html                  (redirect após o cutover)

assets/css/base.css                 tokens, reset e componentes comuns
assets/css/menu.css                 cardápio público
assets/css/admin.css                shell, Kanban, tabelas e modais

assets/js/config.js                 ambiente e chaves publicáveis
assets/js/format.js                 moeda, datas, escape
assets/js/calc.js                   cálculos puros (testáveis)
assets/js/db.js                     cliente Supabase e consultas
assets/js/auth.js                   sessão, papéis e guardas
assets/js/menu.js                   cardápio público

assets/js/admin/app.js              shell, abas e inicialização
assets/js/admin/pedidos.js          lista, filtros e ações
assets/js/admin/kanban.js           colunas, arrastar e soltar
assets/js/admin/impressao.js        etiqueta térmica e cópia de endereço
assets/js/admin/pedido-form.js      criação manual e faturamento
assets/js/admin/bairros.js          CRUD de bairros
assets/js/admin/motoboys.js         cadastro e relatório
assets/js/admin/financeiro.js       cards, lista e lançamentos
assets/js/admin/cardapio.js         produtos, config e loja
assets/js/admin/usuarios.js         usuários e papéis
assets/js/admin/logs.js             auditoria

assets/vendor/supabase-js.umd.js
assets/vendor/sortable.min.js

supabase/functions/criar-usuario/index.ts

database/001-schema.sql
database/002-rls.sql
database/003-seed-bairros.sql
database/004-backfill.sql
database/999-rollback.sql

tests/format.test.mjs
tests/calc.test.mjs
tests/kanban.test.mjs

package.json                        apenas scripts de teste, sem build
README.md                           setup, staging, deploy e operação
.gitignore
.env.example
```

---

## 11. Testes

- **Unitários (`node --test`)**: formatação de moeda e data, cálculo de taxa, resumo financeiro com cancelados excluídos, relatório de motoboy com snapshot, transições válidas do Kanban, cálculo do total do pedido.
- **Integração manual no staging**: checklist da seção 9.3, com dois usuários (admin e operador) e um pedido de cada canal.
- **Teste de RLS**: requisições com a chave publicável sem sessão devem falhar ao ler `pedidos`, `financeiro`, `perfis` e `logs`.
- **Teste no celular**: acesso ao servidor local pelo IP da rede e validação do arrasto por toque.
- Não será introduzido framework de teste de navegador nesta fase; o checklist cobre o fluxo ponta a ponta.

---

## 12. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| `.env` com credenciais do iFood está no repositório público | Remover o arquivo, adicionar `.gitignore`, trocar a senha do iFood; documentar que o histórico do Git mantém o conteúdo antigo |
| Chave anônima com escrita aberta permite alterar dados | Apertar a RLS após o cutover; durante a validação, manter o `/pedidos` funcionando |
| Erro de RLS derruba o recebimento de pedidos | Testar no staging; manter INSERT anônimo em `pedidos`; rollback de políticas documentado |
| Migração quebrar produção | Apenas mudanças aditivas; backup antes; ordem de aplicação documentada |
| Arrastar e soltar falhar no celular | SortableJS + botões de mover como alternativa |
| Dois operadores agirem no mesmo pedido | Upsert com índices únicos; polling de 30 s; log de quem alterou |
| Fuso horário distorcer relatórios | Cálculos de período em `America/Sao_Paulo` |
| Edge Function não publicada | Fallback documentado: criar usuários pelo painel do Supabase e definir o papel pela aba Segurança |
| Mudança de valor do motoboy alterar relatórios antigos | Snapshot do valor no pedido |
| Exclusão de bairro com histórico | Bloquear exclusão com pedidos recentes e sugerir desativar |

---

## 13. Critérios de sucesso

1. O quadro Kanban substitui a tabela atual na operação diária, com arrasto funcionando em desktop e celular.
2. Nenhum pedido cancelado aparece em total ou relatório.
3. O relatório de motoboy fecha o repasse do período sem planilha externa.
4. O financeiro mostra entradas, saídas e líquido, incluindo taxas de iFood e cartão.
5. Bairros e taxas são geridos pela aba Pedidos e refletem no cardápio.
6. Pedidos de iFood lançados manualmente são faturados com o valor realmente recebido.
7. O admin controla operadores e administradores, e toda ação relevante fica registrada com o usuário.
8. Nenhum segredo fica no repositório e a área administrativa usa login real.
9. O checklist de aceite passa no staging e em produção antes do cutover.
10. O deploy continua sendo um push na `main`, sem build.

---

## 14. Fases de implementação

| Fase | Entrega |
| --- | --- |
| 0 | Segurança e limpeza: `.env` fora do repo, `.gitignore`, README, projeto de staging, schema/RLS/seed/backfill, admin inicial |
| 1 | Base compartilhada: CSS/JS modulares, cliente Supabase, autenticação, shell com abas e guardas de papel |
| 2 | Bairros: CRUD na aba Pedidos e cardápio lendo do banco com fallback |
| 3 | Kanban: colunas, arrastar e soltar, cancelamento/restauração, filtros e polling |
| 4 | Pedidos manuais e faturamento com taxas |
| 5 | Motoboys: cadastro, atribuição e relatório de repasse |
| 6 | Financeiro: lançamentos automáticos e manuais, cards e CSV |
| 7 | Cardápio/Loja no admin, usuários, papéis e auditoria |
| 8 | Validação completa, cutover lado a lado e aperto final da RLS |

O detalhamento em tarefas, arquivos e critérios de aceite por fase será produzido no plano de execução.
