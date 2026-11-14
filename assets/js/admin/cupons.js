import { listarCupons, salvarCupom, excluirCupom } from '../db.js';
import { esc } from '../format.js';
import { registrarLog } from '../auth.js';

function dia(v) {
  return v ? String(v).slice(0, 10) : '';
}

function validadeTexto(c) {
  const inicio = dia(c.validade_inicio);
  const fim = dia(c.validade_fim);
  if (!inicio && !fim) return '—';
  return `${inicio || '—'} – ${fim || '—'}`;
}

export async function renderCupons(container, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    container.innerHTML = '<p class="erro">Apenas administradores acessam os cupons.</p>';
    return;
  }

  container.innerHTML = `
    <section class="painel-bairros">
      <div class="painel-topo">
        <h3>Cupons de desconto</h3>
        <button type="button" id="novoCupomBtn" class="btn">+ Novo cupom</button>
      </div>
      <div id="cupomMsg" class="msg"></div>
      <div id="cupomFormArea"></div>
      <div id="cupomLista"></div>
    </section>`;

  const lista = container.querySelector('#cupomLista');
  const formArea = container.querySelector('#cupomFormArea');
  const msg = container.querySelector('#cupomMsg');

  function aviso(texto, tipo = 'erro') {
    msg.className = tipo ? `msg ${tipo}` : 'msg';
    msg.textContent = texto;
  }

  let cupons = [];
  try {
    cupons = await listarCupons();
  } catch (err) {
    aviso(`Não foi possível carregar os cupons: ${err.message || err}`);
    return;
  }

  function desenharLista() {
    const linhas = cupons.length
      ? cupons.map(c => `
              <tr>
                <td><strong>${esc(c.codigo)}</strong></td>
                <td>${esc(String(c.percentual))}%</td>
                <td>${c.ativo ? 'Sim' : 'Não'}</td>
                <td>${esc(validadeTexto(c))}</td>
                <td>${esc(String(c.usos ?? 0))} / ${c.uso_maximo == null ? '∞' : esc(String(c.uso_maximo))}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${esc(String(c.id ?? ''))}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${esc(String(c.id ?? ''))}">Excluir</button>
                </td>
              </tr>`).join('')
      : '<tr><td colspan="6">Nenhum cupom cadastrado.</td></tr>';

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Código</th><th>Percentual</th><th>Ativo</th><th>Validade</th><th>Usos</th><th>Ações</th></tr></thead>
          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirForm(cupons.find(c => String(c.id) === btn.dataset.edit)));
    });
    lista.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => remover(cupons.find(c => String(c.id) === btn.dataset.del)));
    });
  }

  function abrirForm(cupom = {}) {
    formArea.innerHTML = `
      <form id="cupomForm" class="form-grid painel-form">
        <h4>${cupom.id ? 'Editar' : 'Novo'} cupom</h4>
        <label>Código<input id="cCodigo" value="${esc(cupom.codigo || '')}" required /></label>
        <label>Percentual (%)<input id="cPercentual" type="number" min="0.01" max="100" step="0.01" value="${esc(String(cupom.percentual ?? ''))}" required /></label>
        <label>Validade início<input id="cInicio" type="date" value="${esc(dia(cupom.validade_inicio))}" /></label>
        <label>Validade fim<input id="cFim" type="date" value="${esc(dia(cupom.validade_fim))}" /></label>
        <label>Uso máximo<input id="cUsoMaximo" type="number" min="1" step="1" value="${cupom.uso_maximo == null ? '' : esc(String(cupom.uso_maximo))}" placeholder="Sem limite" /></label>
        <label class="linha-check"><input id="cAtivo" type="checkbox" ${cupom.ativo !== false ? 'checked' : ''} /> Ativo</label>
        <div id="cErros" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="cCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#cCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#cupomForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = formArea.querySelector('#cupomForm button[type="submit"]');
      const erros = formArea.querySelector('#cErros');
      erros.textContent = '';

      const dados = {
        id: cupom.id,
        codigo: formArea.querySelector('#cCodigo').value.trim().toUpperCase(),
        percentual: Number(formArea.querySelector('#cPercentual').value),
        validade_inicio: formArea.querySelector('#cInicio').value || null,
        validade_fim: formArea.querySelector('#cFim').value || null,
        uso_maximo: formArea.querySelector('#cUsoMaximo').value
          ? Number(formArea.querySelector('#cUsoMaximo').value) : null,
        ativo: formArea.querySelector('#cAtivo').checked
      };

      const problemas = [];
      if (!dados.codigo) problemas.push('Informe o código do cupom.');
      if (!(dados.percentual >= 0.01 && dados.percentual <= 100)) {
        problemas.push('Informe um percentual entre 0,01 e 100.');
      }
      if (dados.uso_maximo != null && !(dados.uso_maximo > 0)) {
        problemas.push('O uso máximo deve ser maior que zero.');
      }
      if (dados.validade_inicio && dados.validade_fim && dados.validade_fim < dados.validade_inicio) {
        problemas.push('A validade final não pode ser anterior à inicial.');
      }
      if (problemas.length) {
        erros.textContent = problemas.join(' ');
        return;
      }

      botao.disabled = true;
      botao.textContent = 'Salvando…';
      try {
        await salvarCupom(dados);
      } catch (err) {
        erros.textContent = `Erro ao salvar: ${err.message || err}`;
        botao.disabled = false;
        botao.textContent = 'Salvar';
        return;
      }

      let logErro = '';
      try {
        await registrarLog(dados.id ? 'editar_cupom' : 'criar_cupom', 'cupons', dados.id || null, dados);
      } catch (err) {
        logErro = `Salvo, mas o log falhou: ${err.message || err}`;
      }

      try {
        cupons = await listarCupons();
        formArea.innerHTML = '';
        desenharLista();
        if (logErro) aviso(logErro);
        else aviso('Cupom salvo.', 'ok');
      } catch (err) {
        formArea.innerHTML = '';
        aviso(`Salvo, mas não foi possível recarregar a lista: ${err.message || err}`);
      }
    });
  }

  async function remover(cupom) {
    if (!cupom) return;
    if (!confirm(`Excluir o cupom "${cupom.codigo}"?`)) return;
    try {
      await excluirCupom(cupom.id);
    } catch (err) {
      aviso(`Erro ao excluir: ${err.message || err}`);
      return;
    }

    let logErro = '';
    try {
      await registrarLog('excluir_cupom', 'cupons', cupom.id, { codigo: cupom.codigo });
    } catch (err) {
      logErro = `Excluído, mas o log falhou: ${err.message || err}`;
    }

    try {
      cupons = await listarCupons();
      desenharLista();
      if (logErro) aviso(logErro);
      else aviso('Cupom excluído.', 'ok');
    } catch (err) {
      aviso(`Excluído, mas não foi possível recarregar a lista: ${err.message || err}`);
    }
  }

  container.querySelector('#novoCupomBtn').addEventListener('click', () => abrirForm());
  desenharLista();
}
