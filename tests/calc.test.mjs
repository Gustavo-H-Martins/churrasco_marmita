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
