-- Tempo médio de preparo + entrega por bairro (em minutos)
-- Idempotente. Rodar no SQL Editor do Supabase.

alter table bairros
  add column if not exists tempo_medio_min integer
    check (tempo_medio_min is null or tempo_medio_min between 0 and 240);
