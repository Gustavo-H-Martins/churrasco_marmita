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
