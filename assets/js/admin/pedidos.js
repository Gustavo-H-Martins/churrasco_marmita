import { listarPedidosKanban, atualizarPedido, listarMotoboys } from '../db.js';
import { registrarLog } from '../auth.js';
import { montarKanban } from './kanban.js';
import { abrirPedidoManual, abrirFaturamento } from './pedido-form.js';
import { renderBairros } from './bairros.js';
import { imprimirPedido, copiarEndereco } from './impressao.js';
import { sincronizarEntradaPedido, sincronizarTaxaFaturamento, removerLancamento, removerLancamentosAutomaticos } from '../financeiro-sync.js';
import { fmtBRL, esc, dataBR } from '../format.js';
import { podeMover } from '../calc.js';

export async function renderPedidos(root, ctx) {
  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Pedidos</h2>
      <div class="acoes">
        <button type="button" id="novoPedidoBtn" class="btn">+ Novo pedido</button>
        <button type="button" id="toggleBairros" class="btn-ghost">Bairros e taxas</button>
        <span id="statusKanban" class="dica"></span>
      </div>
    </div>
    <div id="bairrosArea" hidden></div>
    <div id="kanbanArea"><p class="carregando">Carregando pedidos…</p></div>`;

  const kanbanArea = root.querySelector('#kanbanArea');
  const statusEl = root.querySelector('#statusKanban');
  root.querySelector('#novoPedidoBtn').addEventListener('click', () => {
    abrirPedidoManual({ ctx, onSalvo: carregar });
  });
  let pedidos = [];
  let motoboys = [];
  let parado = false;
  let timer = null;
  let carregando = false;

  async function carregar() {
    if (carregando) return;
    carregando = true;
    try {
      const [lista, m] = await Promise.all([
        listarPedidosKanban(inicioDoDiaISO()),
        listarMotoboys()
      ]);
      motoboys = m;
      pedidos = comSequenciaDia(lista);
      desenhar();
    } catch (e) {
      kanbanArea.innerHTML = `
        <div class="erro">
          Não foi possível carregar os pedidos: ${esc(e.message || e)}
          <button type="button" id="recarregarKanban" class="btn-ghost">Tentar novamente</button>
        </div>`;
      kanbanArea.querySelector('#recarregarKanban').addEventListener('click', () => { carregar(); });
    } finally {
      carregando = false;
    }
  }

  function desenhar() {
    montarKanban({
      container: kanbanArea,
      pedidos,
      motoboys,
      perfil: ctx.perfil,
      onMover: mover,
      onAtribuir: atribuir,
      onAbrir: (id) => abrirDetalhe(id),
      onCancelar: (pedido) => abrirCancelamento(pedido),
      onRestaurar: restaurar
    });
  }

  async function mover(pedido, destino) {
    if (destino === pedido.status_kanban) return;
    const regra = podeMover(pedido, destino);
    if (!regra.ok) {
      statusEl.textContent = regra.motivo;
      return;
    }
    statusEl.textContent = '';
    const patch = { status_kanban: destino, posicao: Date.now() };
    if (destino === 'concluido') patch.entregue_em = new Date().toISOString();
    try {
      await atualizarPedido(pedido.id, patch);
      await registrarLog('mover_pedido', 'pedidos', pedido.id, { de: pedido.status_kanban, para: destino });
      if (destino === 'concluido' && pedido.bairro !== 'Retirada no local' && !pedido.motoboy_id) {
        statusEl.textContent = 'Pedido concluído sem motoboy atribuído.';
      }
      await carregar();
    } catch (e) {
      statusEl.textContent = 'Erro ao mover: ' + e.message;
      await carregar();
    }
  }

  async function atribuir(pedido, motoboyId) {
    if (!motoboyId) return;
    const motoboy = motoboys.find(m => Number(m.id) === Number(motoboyId));
    if (!motoboy) return;
    try {
      await atualizarPedido(pedido.id, {
        motoboy_id: motoboy.id,
        motoboy_valor_entrega: Number(motoboy.valor_entrega || 0),
        motoboy_atribuido_em: new Date().toISOString()
      });
      await registrarLog('atribuir_motoboy', 'pedidos', pedido.id, { motoboy: motoboy.nome, valor: motoboy.valor_entrega });
      await carregar();
    } catch (e) {
      statusEl.textContent = 'Falha ao atribuir motoboy: ' + e.message;
      await carregar();
    }
  }

  function abrirDetalhe(id) {
    const pedido = pedidos.find(p => String(p.id) === String(id));
    if (!pedido) return;
    abrirModalDetalhe(pedido, ctx, carregar);
  }

  function abrirCancelamento(pedido) {
    const rootModal = document.getElementById('modalRoot');
    rootModal.innerHTML = `
      <div class="modal-fundo">
        <form id="cancelForm" class="modal-caixa form-grid">
          <h3>Cancelar pedido #${pedido.seqDia || pedido.id}</h3>
          <p>${esc(pedido.cliente)} · ${fmtBRL(pedido.total)}</p>
          <label>Justificativa do cancelamento *<textarea id="cancelMotivo" rows="3" required></textarea></label>
          <fieldset class="ciencia">
            <legend>Ciência do cancelamento *</legend>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Bruno" /> Bruno</label>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Diego" /> Diego</label>
            <label class="linha-check"><input type="checkbox" class="ciencia-check" value="Gustavo" /> Gustavo</label>
          </fieldset>
          <div id="cancelErro" class="erro"></div>
          <div class="acoes">
            <button type="submit" class="btn">Confirmar cancelamento</button>
            <button type="button" id="cancelFechar" class="btn-ghost">Fechar</button>
          </div>
        </form>
      </div>`;

    rootModal.querySelector('#cancelFechar').addEventListener('click', () => {
      rootModal.innerHTML = '';
      carregar();
    });
    rootModal.querySelector('#cancelForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = rootModal.querySelector('#cancelMotivo').value.trim();
      const ciencia = [...rootModal.querySelectorAll('.ciencia-check:checked')].map(c => c.value);
      const erro = rootModal.querySelector('#cancelErro');
      if (!motivo) { erro.textContent = 'Informe a justificativa do cancelamento.'; return; }
      if (!ciencia.length) { erro.textContent = 'Selecione pelo menos uma pessoa para a ciência.'; return; }
      try {
        await atualizarPedido(pedido.id, {
          cancelado: true,
          status_kanban: 'cancelado',
          status_anterior: pedido.status_kanban === 'cancelado'
            ? (pedido.status_anterior || 'novo')
            : pedido.status_kanban,
          motivo_cancelamento: motivo,
          cancelado_por: ciencia.join(', '),
          cancelado_em: new Date().toISOString()
        });
        await removerLancamentosAutomaticos(pedido.id);
        await registrarLog('cancelar_pedido', 'pedidos', pedido.id, { motivo, ciencia });
        rootModal.innerHTML = '';
        await carregar();
      } catch (err) {
        erro.textContent = 'Falha ao cancelar: ' + err.message;
        statusEl.textContent = 'Falha ao cancelar o pedido #' + pedido.id + ': ' + err.message;
        await carregar();
      }
    });
  }

  async function restaurar(pedido) {
    if (ctx.perfil?.papel !== 'admin') return alert('Apenas administradores podem restaurar.');
    const destino = pedido.status_anterior || 'novo';
    try {
      await atualizarPedido(pedido.id, {
        cancelado: false,
        status_kanban: destino,
        status_anterior: null,
        motivo_cancelamento: null,
        cancelado_por: null,
        cancelado_em: null,
        cancelado_ip: null
      });
      await registrarLog('restaurar_pedido', 'pedidos', pedido.id, { destino });
      try {
        if (pedido.finalizado) {
          await sincronizarEntradaPedido({ ...pedido, cancelado: false, status_kanban: destino });
        }
        if (pedido.faturado && Number(pedido.taxa) > 0) {
          await sincronizarTaxaFaturamento(pedido.id, Number(pedido.taxa), `Taxa do pedido #${pedido.id}`);
        }
      } catch (errFinanceiro) {
        statusEl.textContent = 'Pedido restaurado, mas a sincronização financeira falhou: ' + errFinanceiro.message;
      }
      await carregar();
    } catch (err) {
      statusEl.textContent = 'Falha ao restaurar: ' + err.message;
    }
  }

  const area = root.querySelector('#bairrosArea');
  root.querySelector('#toggleBairros').addEventListener('click', async () => {
    area.hidden = !area.hidden;
    if (!area.hidden && !area.dataset.carregado) {
      await renderBairros(area, ctx);
      area.dataset.carregado = '1';
    }
  });

  await carregar();
  timer = setInterval(() => {
    if (!parado && document.getElementById('kanbanArea')) carregar();
  }, 30000);

  return () => {
    parado = true;
    clearInterval(timer);
  };
}

function comSequenciaDia(pedidos) {
  const porDia = new Map();
  const ordenados = [...pedidos].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const p of ordenados) {
    const dia = dataBR(p.created_at);
    const n = (porDia.get(dia) || 0) + 1;
    porDia.set(dia, n);
    p.seqDia = n;
  }
  return pedidos;
}

function inicioDoDiaISO() {
  const dia = dataBR(new Date().toISOString());
  return `${dia}T00:00:00-03:00`;
}

function abrirModalDetalhe(pedido, ctx, aoAtualizar) {
  const rootModal = document.getElementById('modalRoot');
  const admin = ctx.perfil?.papel === 'admin';
  const itens = (pedido.itens || []).map(it => `
    <tr>
      <td>${esc(it.produto)}</td>
      <td>${it.quantidade}x</td>
      <td>${it.subtotal == null ? '—' : fmtBRL(it.subtotal)}</td>
    </tr>`).join('');

  rootModal.innerHTML = `
    <div class="modal-fundo">
      <div class="modal-caixa">
        <h3>${esc(pedido.cliente || '—')} · #${pedido.seqDia || pedido.id}</h3>
        <p><strong>Total:</strong> ${fmtBRL(pedido.total)}</p>
        <p><strong>Bairro:</strong> ${esc(pedido.bairro || '—')}</p>
        <p><strong>Endereço:</strong> ${esc(pedido.endereco || '—')}</p>
        <p><strong>Pagamento:</strong> ${esc(pedido.pagamento || '—')}</p>
        <p><strong>Canal:</strong> ${esc(pedido.canal || '—')}</p>
        <p><strong>Observação:</strong> ${esc(pedido.observacao || '—')}</p>
        <table class="detalhe-itens">
          <thead><tr><th>Produto</th><th>Qtd</th><th>Subtotal</th></tr></thead>
          <tbody>${itens || '<tr><td colspan="3">—</td></tr>'}</tbody>
        </table>
        <label class="linha-check">
          <input type="checkbox" id="pagoCheck" ${pedido.finalizado ? 'checked' : ''} ${admin ? '' : 'disabled'} />
          Pago${admin ? '' : ' (somente admin)'}
        </label>
        <div class="acoes">
          <button type="button" id="btnImprimir" class="btn-ghost">Imprimir etiqueta</button>
          <button type="button" id="btnCopiar" class="btn-ghost">Copiar endereço</button>
          ${admin && pedido.faturado ? '<button type="button" id="btnDesfaturar" class="btn-ghost">Desfaturar</button>' : ''}
          ${admin && !pedido.cancelado ? '<button type="button" id="btnFaturar" class="btn">Faturar</button>' : ''}
          <button type="button" id="btnFechar" class="btn-ghost">Fechar</button>
        </div>
        <div id="detalheMsg" class="msg"></div>
      </div>
    </div>`;

  rootModal.querySelector('#btnFechar').addEventListener('click', () => { rootModal.innerHTML = ''; });
  rootModal.querySelector('#btnImprimir').addEventListener('click', () => imprimirPedido(pedido));
  rootModal.querySelector('#btnCopiar').addEventListener('click', async () => {
    const ok = await copiarEndereco(pedido);
    rootModal.querySelector('#detalheMsg').textContent = ok ? 'Endereço copiado.' : '';
  });

  rootModal.querySelector('#pagoCheck').addEventListener('change', async (e) => {
    if (!admin) return;
    const msg = rootModal.querySelector('#detalheMsg');
    if (!e.target.checked && pedido.faturado) {
      e.target.checked = true;
      msg.textContent = 'Desfature o pedido antes de desmarcar o pagamento.';
      return;
    }
    try {
      await atualizarPedido(pedido.id, {
        finalizado: e.target.checked,
        finalizado_em: e.target.checked ? new Date().toISOString() : null,
        finalizado_por: ctx.perfil?.email || 'painel'
      });
      await sincronizarEntradaPedido({ ...pedido, finalizado: e.target.checked });
      await registrarLog('marcar_pagamento', 'pedidos', pedido.id, { pago: e.target.checked });
      msg.textContent = 'Pagamento atualizado.';
      await aoAtualizar();
    } catch (err) {
      e.target.checked = !e.target.checked;
      msg.textContent = 'Falha ao atualizar pagamento: ' + err.message;
      await aoAtualizar();
    }
  });

  const btnDesfaturar = rootModal.querySelector('#btnDesfaturar');
  if (btnDesfaturar) {
    btnDesfaturar.addEventListener('click', async () => {
      const msg = rootModal.querySelector('#detalheMsg');
      if (!confirm('Desfaturar este pedido? A taxa será removida do financeiro.')) return;
      try {
        await atualizarPedido(pedido.id, {
          faturado: false,
          valor_recebido: null,
          taxa: 0,
          faturado_em: null,
          faturado_por: null
        });
        await removerLancamento(pedido.id, 'taxa');
        await registrarLog('desfaturar_pedido', 'pedidos', pedido.id, {});
        rootModal.innerHTML = '';
        await aoAtualizar();
      } catch (err) {
        msg.textContent = 'Falha ao desfaturar: ' + err.message;
      }
    });
  }

  const btnFaturar = rootModal.querySelector('#btnFaturar');
  if (btnFaturar) {
    btnFaturar.addEventListener('click', () => {
      rootModal.innerHTML = '';
      abrirFaturamento(pedido, { ctx, onSalvo: aoAtualizar });
    });
  }
}
