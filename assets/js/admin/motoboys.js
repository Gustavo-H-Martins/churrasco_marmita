import { listarMotoboys, salvarMotoboy, listarPedidosEntregues, atualizarPedido } from '../db.js';
import { relatorioMotoboy } from '../calc.js';
import { fmtBRL, fmtDataHora, esc, hojeBR } from '../format.js';
import { registrarLog } from '../auth.js';

function mostrarErro(el, texto) {
  el.className = 'msg erro';
  el.textContent = texto;
}

function limparMsg(el) {
  el.className = 'msg';
  el.textContent = '';
}

export async function renderMotoboys(root, ctx) {
  root.innerHTML = '<p class="dica">Carregando motoboys…</p>';

  let motoboys;
  try {
    motoboys = await listarMotoboys();
  } catch (err) {
    root.textContent = '';
    const titulo = document.createElement('h2');
    titulo.textContent = 'Motoboys';
    const erro = document.createElement('p');
    erro.className = 'erro';
    erro.textContent = `Não foi possível carregar os motoboys: ${err.message || err}`;
    root.append(titulo, erro);
    return;
  }

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Motoboys</h2>
      <button type="button" id="novoMotoboyBtn" class="btn">+ Novo motoboy</button>
    </div>
    <section class="painel-bairros">
      <h3>Cadastro</h3>
      <div id="motoboyMsg" class="msg"></div>
      <div id="motoboyFormArea"></div>
      <div id="motoboyLista"></div>
    </section>
    <section class="painel-bairros">
      <h3>Relatório de repasse</h3>
      <div class="acoes" style="margin-bottom:12px">
        <label>De <input id="repInicio" type="date" value="${hojeBR()}" /></label>
        <label>Até <input id="repFim" type="date" value="${hojeBR()}" /></label>
        <button type="button" id="gerarRelatorio" class="btn">Gerar</button>
        <button type="button" id="copiarRelatorio" class="btn-ghost">Copiar relatório</button>
      </div>
      <div id="repMsg" class="msg"></div>
      <div id="repResultado"></div>
    </section>`;

  const lista = root.querySelector('#motoboyLista');
  const formArea = root.querySelector('#motoboyFormArea');
  const cadastroMsg = root.querySelector('#motoboyMsg');
  const repMsg = root.querySelector('#repMsg');
  const repResultado = root.querySelector('#repResultado');

  function desenharLista() {
    const linhas = motoboys.length
      ? motoboys.map(m => `
              <tr>
                <td><strong>${esc(m.nome)}</strong></td>
                <td>${esc(m.telefone || '—')}</td>
                <td>${fmtBRL(m.valor_entrega)}</td>
                <td>${m.ativo ? 'Sim' : 'Não'}</td>
                <td><button type="button" class="btn-mini" data-edit="${esc(String(m.id ?? ''))}">Editar</button></td>
              </tr>`).join('')
      : '<tr><td colspan="5">Nenhum motoboy cadastrado.</td></tr>';

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>Valor/entrega</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirForm(motoboys.find(m => String(m.id) === btn.dataset.edit)));
    });
  }

  function abrirForm(m = {}) {
    formArea.innerHTML = `
      <form id="motoboyForm" class="form-grid painel-form">
        <h4>${m.id ? 'Editar' : 'Novo'} motoboy</h4>
        <label>Nome<input id="mNome" value="${esc(m.nome || '')}" required /></label>
        <label>Telefone<input id="mTelefone" value="${esc(m.telefone || '')}" /></label>
        <label>Valor por entrega (R$)<input id="mValor" type="number" min="0" step="0.01" value="${esc(String(m.valor_entrega ?? 0))}" required /></label>
        <label class="linha-check"><input id="mAtivo" type="checkbox" ${m.ativo !== false ? 'checked' : ''} /> Ativo</label>
        <div id="mErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="mCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    const form = formArea.querySelector('#motoboyForm');
    const erroEl = formArea.querySelector('#mErro');
    const salvarBtn = form.querySelector('button[type="submit"]');

    formArea.querySelector('#mCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erroEl.textContent = '';

      const dados = {
        id: m.id,
        nome: formArea.querySelector('#mNome').value.trim(),
        telefone: formArea.querySelector('#mTelefone').value.trim(),
        valor_entrega: Number(formArea.querySelector('#mValor').value),
        ativo: formArea.querySelector('#mAtivo').checked
      };

      if (!dados.nome) {
        erroEl.textContent = 'Informe o nome.';
        return;
      }
      if (!Number.isFinite(dados.valor_entrega) || dados.valor_entrega < 0) {
        erroEl.textContent = 'Informe um valor por entrega válido.';
        return;
      }

      salvarBtn.disabled = true;
      try {
        await salvarMotoboy(dados);
      } catch (err) {
        erroEl.textContent = `Erro ao salvar: ${err.message || err}`;
        return;
      } finally {
        salvarBtn.disabled = false;
      }

      formArea.innerHTML = '';
      try {
        await registrarLog(dados.id ? 'editar_motoboy' : 'criar_motoboy', 'motoboys', dados.id || null, dados);
        limparMsg(cadastroMsg);
      } catch (err) {
        mostrarErro(cadastroMsg, `Motoboy salvo, mas o log falhou: ${err.message || err}`);
      }

      try {
        motoboys = await listarMotoboys();
        desenharLista();
      } catch (err) {
        mostrarErro(cadastroMsg, `Motoboy salvo, mas não foi possível recarregar a lista: ${err.message || err}`);
      }
    });
  }

  let ultimoRelatorio = [];

  async function gerar() {
    const de = root.querySelector('#repInicio').value;
    const ate = root.querySelector('#repFim').value;
    limparMsg(repMsg);

    if (!de || !ate) {
      mostrarErro(repMsg, 'Informe o período do relatório.');
      return;
    }
    if (de > ate) {
      mostrarErro(repMsg, 'A data inicial não pode ser posterior à data final.');
      return;
    }

    const inicio = `${de}T00:00:00-03:00`;
    const fim = `${ate}T23:59:59.999-03:00`;

    repResultado.innerHTML = '<p class="dica">Carregando relatório…</p>';

    let pedidos;
    try {
      pedidos = await listarPedidosEntregues(inicio, fim);
    } catch (err) {
      ultimoRelatorio = [];
      repResultado.textContent = '';
      mostrarErro(repMsg, `Não foi possível gerar o relatório: ${err.message || err}`);
      return;
    }

    ultimoRelatorio = relatorioMotoboy({ pedidos, motoboys, inicio, fim });

    if (!ultimoRelatorio.length) {
      repResultado.innerHTML = '<p class="dica">Nenhuma entrega no período.</p>';
      return;
    }

    repResultado.innerHTML = ultimoRelatorio.map(g => `
      <div class="painel-bairros" style="margin-bottom:12px">
        <div class="painel-topo">
          <h4>${esc(g.nome)} — ${g.quantidade} entrega(s)</h4>
          <strong>${fmtBRL(g.total)}</strong>
        </div>
        <p class="dica">Pendente: ${fmtBRL(g.pendente)} · Pago: ${fmtBRL(g.pago)}</p>
        <table>
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Entregue em</th><th>Valor</th><th>Repasse</th></tr></thead>
          <tbody>
            ${g.pedidos.map(p => `
              <tr>
                <td>#${p.id}</td>
                <td>${esc(p.cliente)}</td>
                <td>${esc(p.bairro || '—')}</td>
                <td>${fmtDataHora(p.entregue_em)}</td>
                <td>${fmtBRL(p.motoboy_valor_entrega)}</td>
                <td>${p.repasse_pago_em ? 'Pago' : 'Pendente'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="acoes" style="margin-top:8px">
          <button type="button" class="btn" data-pagar="${esc(String(g.motoboyId))}">Marcar repasse como pago</button>
        </div>
      </div>`).join('');

    repResultado.querySelectorAll('[data-pagar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const grupo = ultimoRelatorio.find(x => String(x.motoboyId) === btn.dataset.pagar);
        if (!grupo) return;

        const pendentes = grupo.pedidos.filter(p => !p.repasse_pago_em);
        if (!pendentes.length) {
          limparMsg(repMsg);
          return;
        }

        if (!confirm(`Marcar ${pendentes.length} entrega(s) de ${grupo.nome} como pagas?`)) return;

        limparMsg(repMsg);
        btn.disabled = true;
        const agora = new Date().toISOString();

        try {
          for (const p of pendentes) {
            await atualizarPedido(p.id, { repasse_pago_em: agora });
          }
        } catch (err) {
          btn.disabled = false;
          mostrarErro(repMsg, `Erro ao marcar o repasse como pago: ${err.message || err}. Gere o relatório novamente para conferir o estado atual.`);
          return;
        }

        let avisoLog = '';
        try {
          await registrarLog('pagar_repasse', 'motoboys', grupo.motoboyId, {
            quantidade: pendentes.length,
            valor: grupo.pendente
          });
        } catch (err) {
          avisoLog = `Repasse marcado, mas o log falhou: ${err.message || err}`;
        }

        btn.disabled = false;
        await gerar();
        if (avisoLog && !repMsg.textContent) mostrarErro(repMsg, avisoLog);
      });
    });
  }

  root.querySelector('#novoMotoboyBtn').addEventListener('click', () => abrirForm());
  root.querySelector('#gerarRelatorio').addEventListener('click', gerar);
  root.querySelector('#copiarRelatorio').addEventListener('click', async () => {
    const texto = ultimoRelatorio.map(g =>
      `${g.nome}: ${g.quantidade} entrega(s) · total ${fmtBRL(g.total)} · pendente ${fmtBRL(g.pendente)}`
    ).join('\n');

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Área de transferência indisponível.');
      await navigator.clipboard.writeText(texto || 'Nenhuma entrega no período.');
      alert('Relatório copiado.');
    } catch {
      alert(texto || 'Nenhuma entrega no período.');
    }
  });

  desenharLista();
  await gerar();
}
