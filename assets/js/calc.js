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

export function calcularFaturamento(bruto, recebido) {
  const b = arred2(bruto);
  const r = arred2(recebido);
  const taxa = arred2(Math.max(0, b - r));
  return { bruto: b, recebido: r, taxa, liquido: r };
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
