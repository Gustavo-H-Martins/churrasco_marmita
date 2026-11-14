import { listarBairros, salvarBairro, excluirBairro, contarPedidosBairro } from '../db.js';
import { validarBairro } from '../calc.js';
import { fmtBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderBairros(container, ctx) {
  let bairros = await listarBairros();

  container.innerHTML = `
    <section class="painel-bairros">
      <div class="painel-topo">
        <h3>Bairros e taxas</h3>
        <button type="button" id="novoBairroBtn" class="btn">+ Novo bairro</button>
      </div>
      <div id="bairroFormArea"></div>
      <div id="bairroLista"></div>
    </section>`;

  const lista = container.querySelector('#bairroLista');
  const formArea = container.querySelector('#bairroFormArea');

  function desenharLista() {
    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Ordem</th><th>Bairro</th><th>Grupo</th><th>Taxa</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${bairros.map(b => `
              <tr>
                <td>${b.ordem}</td>
                <td><strong>${esc(b.nome)}</strong></td>
                <td>${esc(b.grupo)}</td>
                <td>${fmtBRL(b.taxa)}</td>
                <td>${b.ativo ? 'Sim' : 'Não'}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${b.id}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${b.id}">Excluir</button>
                </td>
              </tr>`).join('')}
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
        <label>Taxa (R$)<input id="bTaxa" type="number" min="0" step="0.01" value="${bairro.taxa ?? 0}" required /></label>
        <label>Grupo
          <select id="bGrupo">
            <option value="Bairro" ${bairro.grupo === 'Bairro' ? 'selected' : ''}>Bairro</option>
            <option value="Condomínio" ${bairro.grupo === 'Condomínio' ? 'selected' : ''}>Condomínio</option>
          </select>
        </label>
        <label>Ordem<input id="bOrdem" type="number" step="1" value="${bairro.ordem ?? 0}" /></label>
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
        ativo: formArea.querySelector('#bAtivo').checked
      };
      const erros = validarBairro(dados);
      if (erros.length) {
        formArea.querySelector('#bErros').textContent = erros.join(' ');
        return;
      }
      await salvarBairro(dados);
      await registrarLog(dados.id ? 'editar_bairro' : 'criar_bairro', 'bairros', dados.id || null, dados);
      bairros = await listarBairros();
      formArea.innerHTML = '';
      desenharLista();
    });
  }

  async function remover(b) {
    if (!b) return;
    const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentes = await contarPedidosBairro(b.nome, desde);
    if (recentes > 0) {
      alert(`"${b.nome}" aparece em ${recentes} pedido(s) nos últimos 90 dias. Desative o bairro em vez de excluir.`);
      return;
    }
    if (!confirm(`Excluir o bairro "${b.nome}"?`)) return;
    await excluirBairro(b.id);
    await registrarLog('excluir_bairro', 'bairros', b.id, { nome: b.nome });
    bairros = await listarBairros();
    desenharLista();
  }

  container.querySelector('#novoBairroBtn').addEventListener('click', () => abrirForm());
  desenharLista();
}
