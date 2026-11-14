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
  const resultados = await Promise.allSettled([
    removerLancamento(pedidoId, 'pedido'),
    removerLancamento(pedidoId, 'taxa')
  ]);
  const falhas = resultados.filter(r => r.status === 'rejected');
  if (falhas.length) {
    throw new Error(falhas.map(f => f.reason?.message || String(f.reason)).join('; '));
  }
}
