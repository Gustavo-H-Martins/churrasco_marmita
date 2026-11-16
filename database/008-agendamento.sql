-- Agendamento para o próximo turno
-- Idempotente. Rodar no SQL Editor do Supabase.

alter table status
  add column if not exists proxima_abertura date;

alter table pedidos
  add column if not exists agendado_para date;

create index if not exists pedidos_agendado_idx on pedidos (agendado_para);
