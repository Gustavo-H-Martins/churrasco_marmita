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
