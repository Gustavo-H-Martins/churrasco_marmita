import { listarBairros, salvarBairro, excluirBairro, contarPedidosBairro } from '../db.js';
import { validarBairro } from '../calc.js';
import { fmtBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderBairros(container, ctx) {
  container.innerHTML = `
    <section class="painel-bairros">
      <div class="painel-topo">
        <h3>Bairros e taxas</h3>
        <button type="button" id="novoBairroBtn" class="btn">+ Novo bairro</button>
      </div>
      <div id="bairroMsg" class="msg"></div>
      <div id="bairroFormArea"></div>
      <div id="bairroLista"></div>
    </section>`;

  const lista = container.querySelector('#bairroLista');
  const formArea = container.querySelector('#bairroFormArea');
  const msg = container.querySelector('#bairroMsg');

  function aviso(texto, tipo = 'erro') {
    msg.className = tipo ? `msg ${tipo}` : 'msg';
    msg.textContent = texto;
  }

  let bairros;
  try {
    bairros = await listarBairros();
  } catch (err) {
    aviso(`Não foi possível carregar os bairros: ${err.message || err}`);
    return;
  }

  function desenharLista() {
    const linhas = bairros.length
      ? bairros.map(b => `
              <tr>
                <td>${esc(String(b.ordem ?? ''))}</td>
                <td><strong>${esc(b.nome)}</strong></td>
                <td>${esc(b.grupo)}</td>
                <td>${fmtBRL(b.taxa)}</td>
                <td>${b.tempo_medio_min ? esc(String(b.tempo_medio_min)) + ' min' : '—'}</td>
                <td>${b.ativo ? 'Sim' : 'Não'}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${esc(String(b.id ?? ''))}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${esc(String(b.id ?? ''))}">Excluir</button>
                </td>
              </tr>`).join('')
      : '<tr><td colspan="7">Nenhum bairro cadastrado.</td></tr>';

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Ordem</th><th>Bairro</th><th>Grupo</th><th>Taxa</th><th>Tempo</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirForm(bairros.find(b => String(b.id) === btn.dataset.edit)));
    });
    lista.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => remover(bairros.find(b => String(b.id) === btn.dataset.del)));
    });
  }

  function abrirForm(bairro = {}) {
    formArea.innerHTML = `
      <form id="bairroForm" class="form-grid painel-form">
        <h4>${bairro.id ? 'Editar' : 'Novo'} bairro</h4>
        <label>Nome<input id="bNome" value="${esc(bairro.nome || '')}" required /></label>
        <label>Taxa (R$)<input id="bTaxa" type="number" min="0" step="0.01" value="${esc(String(bairro.taxa ?? 0))}" required /></label>
        <label>Tempo médio de preparo + entrega (min)<input id="bTempo" type="number" min="0" max="240" step="5" value="${esc(String(bairro.tempo_medio_min ?? ''))}" placeholder="ex.: 45" /></label>
        <label>Grupo
          <select id="bGrupo">
            <option value="Bairro" ${bairro.grupo === 'Bairro' ? 'selected' : ''}>Bairro</option>
            <option value="Condomínio" ${bairro.grupo === 'Condomínio' ? 'selected' : ''}>Condomínio</option>
          </select>
        </label>
        <label>Ordem<input id="bOrdem" type="number" step="1" value="${esc(String(bairro.ordem ?? 0))}" /></label>
        <label class="linha-check"><input id="bAtivo" type="checkbox" ${bairro.ativo !== false ? 'checked' : ''} /> Ativo no cardápio</label>
        <div id="bErros" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="bCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#bCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#bairroForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = {
        id: bairro.id,
        nome: formArea.querySelector('#bNome').value,
        taxa: Number(formArea.querySelector('#bTaxa').value),
        grupo: formArea.querySelector('#bGrupo').value,
        ordem: Number(formArea.querySelector('#bOrdem').value),
        tempo_medio_min: formArea.querySelector('#bTempo').value === ''
          ? null
          : Number(formArea.querySelector('#bTempo').value),
        ativo: formArea.querySelector('#bAtivo').checked
      };
      const erros = validarBairro(dados);
      if (erros.length) {
        formArea.querySelector('#bErros').textContent = erros.join(' ');
        return;
      }
      try {
        await salvarBairro(dados);
      } catch (err) {
        formArea.querySelector('#bErros').textContent = `Erro ao salvar: ${err.message || err}`;
        return;
      }
      formArea.innerHTML = '';
      try {
        await registrarLog(dados.id ? 'editar_bairro' : 'criar_bairro', 'bairros', dados.id || null, dados);
        aviso('');
      } catch (err) {
        aviso(`Salvo, mas o log falhou: ${err.message || err}`);
      }
      try {
        bairros = await listarBairros();
        desenharLista();
      } catch (err) {
        aviso(`Salvo, mas não foi possível recarregar a lista: ${err.message || err}`);
      }
    });
  }

  async function remover(b) {
    if (!b) return;
    const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    let recentes;
    try {
      recentes = await contarPedidosBairro(b.nome, desde);
    } catch (err) {
      aviso(`Não foi possível verificar os pedidos do bairro: ${err.message || err}`);
      return;
    }
    if (recentes > 0) {
      alert(`"${b.nome}" aparece em ${recentes} pedido(s) nos últimos 90 dias. Desative o bairro em vez de excluir.`);
      return;
    }
    if (!confirm(`Excluir o bairro "${b.nome}"?`)) return;
    try {
      await excluirBairro(b.id);
    } catch (err) {
      aviso(`Erro ao excluir: ${err.message || err}`);
      return;
    }
    try {
      await registrarLog('excluir_bairro', 'bairros', b.id, { nome: b.nome });
      aviso('');
    } catch (err) {
      aviso(`Excluído, mas o log falhou: ${err.message || err}`);
    }
    try {
      bairros = await listarBairros();
      desenharLista();
    } catch (err) {
      aviso(`Excluído, mas não foi possível recarregar a lista: ${err.message || err}`);
    }
  }

  container.querySelector('#novoBairroBtn').addEventListener('click', () => abrirForm());
  desenharLista();
}
