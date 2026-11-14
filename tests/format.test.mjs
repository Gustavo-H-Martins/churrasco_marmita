import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBRL, parseBRL, fmtData, fmtDataHora, esc } from '../assets/js/format.js';

const semNbsp = (s) => s.replace(/ /g, ' ');

test('fmtBRL formata reais com duas casas', () => {
  assert.equal(semNbsp(fmtBRL(23)), 'R$ 23,00');
  assert.equal(semNbsp(fmtBRL(1234.5)), 'R$ 1.234,50');
  assert.equal(semNbsp(fmtBRL(null)), 'R$ 0,00');
});

test('parseBRL aceita formato brasileiro e vazio', () => {
  assert.equal(parseBRL('R$ 1.234,56'), 1234.56);
  assert.equal(parseBRL('23,90'), 23.9);
  assert.equal(parseBRL('23.90'), 23.9);
  assert.equal(parseBRL(''), 0);
});

test('fmtData respeita o fuso de São Paulo', () => {
  assert.equal(fmtData('2026-11-14T02:30:00.000Z'), '13/11/2026');
  assert.equal(fmtData(null), '—');
});

test('fmtDataHora mostra data e hora locais', () => {
  assert.equal(fmtDataHora('2026-11-14T15:45:00.000Z'), '14/11/2026 12:45');
});

test('esc escapa HTML', () => {
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
