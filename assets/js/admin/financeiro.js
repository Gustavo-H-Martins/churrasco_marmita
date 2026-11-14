import { listarFinanceiro, criarLancamento, atualizarLancamento, excluirLancamento } from '../db.js';
import { resumoFinanceiro } from '../calc.js';
import { fmtBRL, fmtData, esc, hojeBR } from '../format.js';
import { registrarLog } from '../auth.js';

const CATEGORIAS = ['vendas','taxa_ifood','taxa_cartao','motoboy','carne','gás','embalagem','marketing','outros'];

export async function renderFinanceiro(root, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    root.innerHTML = '<p class="erro">Apenas administradores acessam o financeiro.</p>';
    return;
  }

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Financeiro</h2>
      <div class="acoes">
        <label>De <input id="finInicio" type="date" value="${hojeBR()}" /></label>
        <label>Até <input id="finFim" type="date" value="${hojeBR()}" /></label>
        <button type="button" id="finFiltrar" class="btn">Filtrar</button>
        <button type="button" id="finNovo" class="btn">+ Lançamento</button>
        <button type="button" id="finCsv" class="btn-ghost">Exportar CSV</button>
      </div>
    </div>
    <div id="finErro" class="erro" role="alert"></div>
    <div id="finCards" class="cards-fin"></div>
    <div id="finFormArea"></div>
    <div id="finLista"></div>`;

  let lancamentos = [];

  function mostrarErro(msg) {
    root.querySelector('#finErro').textContent = msg || '';
  }

  async function carregar() {
    mostrarErro('');
    root.querySelector('#finCards').innerHTML = '<p class="carregando">Carregando…</p>';
    root.querySelector('#finLista').innerHTML = '';
    try {
      const de = root.querySelector('#finInicio').value;
      const ate = root.querySelector('#finFim').value;
      lancamentos = await listarFinanceiro({ inicio: de, fim: ate });
      desenhar();
      return true;
    } catch (e) {
      root.querySelector('#finCards').innerHTML = '';
      mostrarErro(`Erro ao carregar financeiro: ${e.message}`);
      return false;
    }
  }

  function desenhar() {
    const r = resumoFinanceiro(lancamentos);
    root.querySelector('#finCards').innerHTML = `
      <div class="card-fin"><span>Entradas</span><strong>${fmtBRL(r.entradas)}</strong></div>
      <div class="card-fin"><span>Saídas</span><strong>${fmtBRL(r.saidas)}</strong></div>
      <div class="card-fin"><span>Saldo</span><strong>${fmtBRL(r.saldo)}</strong></div>
      <div class="card-fin"><span>Taxas</span><strong>${fmtBRL(r.taxas)}</strong></div>
      <div class="card-fin"><span>Líquido</span><strong>${fmtBRL(r.liquido)}</strong></div>`;

    const lista = root.querySelector('#finLista');
    if (!lancamentos.length) {
      lista.innerHTML = '<p class="dica">Nenhum lançamento no período.</p>';
      return;
    }

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Origem</th><th>Valor</th><th>Ações</th></tr></thead>
          <tbody>
            ${lancamentos.map(l => `
              <tr>
                <td>${fmtData(l.data + 'T12:00:00')}</td>
                <td>${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
                <td>${esc(l.categoria)}</td>
                <td>${esc(l.descricao)}</td>
                <td>${l.origem === 'manual' ? 'Manual' : l.origem === 'pedido' ? 'Pedido' : 'Taxa'}</td>
                <td><strong>${fmtBRL(l.valor)}</strong></td>
                <td class="acoes">
                  ${l.origem === 'manual' ? `
                    <button type="button" class="btn-mini" data-edit="${l.id}">Editar</button>
                    <button type="button" class="btn-mini perigo" data-del="${l.id}">Excluir</button>` : '<span class="dica">Automático</span>'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => abrirForm(lancamentos.find(l => String(l.id) === b.dataset.edit)));
    });
    lista.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', async () => {
        const l = lancamentos.find(x => String(x.id) === b.dataset.del);
        if (!l || !confirm(`Excluir "${l.descricao}"?`)) return;
        b.disabled = true;
        try {
          await excluirLancamento(l.id);
        } catch (e) {
          mostrarErro(`Erro ao excluir lançamento: ${e.message}`);
          if (b.isConnected) b.disabled = false;
          return;
        }
        let aviso = '';
        try {
          await registrarLog('excluir_lancamento', 'financeiro', l.id, { descricao: l.descricao, valor: l.valor });
        } catch (e) {
          aviso = `Lançamento excluído, mas o log falhou: ${e.message}`;
        }
        const ok = await carregar();
        if (b.isConnected) b.disabled = false;
        if (ok && aviso) mostrarErro(aviso);
      });
    });
  }

  function abrirForm(l = {}) {
    const area = root.querySelector('#finFormArea');
    area.innerHTML = `
      <form id="finForm" class="form-grid painel-form">
        <h4>${l.id ? 'Editar' : 'Novo'} lançamento</h4>
        <label>Tipo
          <select id="fTipo">
            <option value="entrada" ${l.tipo === 'entrada' ? 'selected' : ''}>Entrada</option>
            <option value="saida" ${l.tipo === 'saida' ? 'selected' : ''}>Saída</option>
          </select>
        </label>
        <label>Categoria
          <select id="fCat">
            ${CATEGORIAS.map(c => `<option value="${esc(c)}" ${l.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label>Descrição<input id="fDesc" value="${esc(l.descricao || '')}" required /></label>
        <label>Valor (R$)<input id="fValor" type="number" min="0" step="0.01" value="${esc(l.valor ?? 0)}" required /></label>
        <label>Data<input id="fData" type="date" value="${esc(l.data || hojeBR())}" required /></label>
        <div id="fErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="fCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    area.querySelector('#fCancelar').addEventListener('click', () => { area.innerHTML = ''; });
    area.querySelector('#finForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = area.querySelector('button[type="submit"]');
      const erroEl = area.querySelector('#fErro');
      erroEl.textContent = '';
      const dados = {
        tipo: area.querySelector('#fTipo').value,
        categoria: area.querySelector('#fCat').value,
        descricao: area.querySelector('#fDesc').value.trim(),
        valor: Number(area.querySelector('#fValor').value),
        data: area.querySelector('#fData').value,
        origem: 'manual'
      };
      if (!dados.descricao || !(dados.valor >= 0)) {
        erroEl.textContent = 'Informe descrição e valor.';
        return;
      }
      botao.disabled = true;
      try {
        if (l.id) await atualizarLancamento(l.id, dados);
        else await criarLancamento(dados);
      } catch (err) {
        erroEl.textContent = `Erro ao salvar lançamento: ${err.message}`;
        if (botao.isConnected) botao.disabled = false;
        return;
      }
      let aviso = '';
      try {
        await registrarLog(l.id ? 'editar_lancamento' : 'criar_lancamento', 'financeiro', l.id || null, dados);
      } catch (err) {
        aviso = `Lançamento salvo, mas o log falhou: ${err.message}`;
      }
      area.innerHTML = '';
      const ok = await carregar();
      if (ok && aviso) mostrarErro(aviso);
    });
  }

  root.querySelector('#finFiltrar').addEventListener('click', carregar);
  root.querySelector('#finNovo').addEventListener('click', () => abrirForm());
  root.querySelector('#finCsv').addEventListener('click', () => {
    const linhas = [
      ['data','tipo','categoria','descricao','valor','origem'],
      ...lancamentos.map(l => [l.data, l.tipo, l.categoria, l.descricao, String(l.valor).replace('.', ','), l.origem])
    ];
    const celula = (c) => {
      let s = String(c);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const csv = '﻿' + linhas.map(linha => linha.map(celula).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-${hojeBR()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  await carregar();
}
