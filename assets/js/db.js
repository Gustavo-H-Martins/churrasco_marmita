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

export async function listarCupons() {
  const { data, error } = await sb.from('cupons').select('*')
    .order('criado_em', { ascending: false });
  checar(error);
  return data || [];
}

export async function salvarCupom(c) {
  const payload = {
    codigo: String(c.codigo || '').trim().toUpperCase(),
    percentual: Number(c.percentual),
    ativo: c.ativo !== false,
    validade_inicio: c.validade_inicio || null,
    validade_fim: c.validade_fim || null,
    uso_maximo: c.uso_maximo ? Number(c.uso_maximo) : null
  };
  const q = c.id
    ? sb.from('cupons').update(payload).eq('id', c.id)
    : sb.from('cupons').insert(payload);
  const { error } = await q;
  checar(error);
}

export async function excluirCupom(id) {
  const { error } = await sb.from('cupons').delete().eq('id', id);
  checar(error);
}

export async function validarCupom(codigo) {
  const { data, error } = await sb.rpc('validar_cupom', {
    p_codigo: String(codigo || '').trim().toUpperCase()
  });
  checar(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { codigo: row.codigo, percentual: Number(row.percentual) } : null;
}
