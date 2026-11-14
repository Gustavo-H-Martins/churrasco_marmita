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
