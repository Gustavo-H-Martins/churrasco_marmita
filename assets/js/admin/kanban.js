import { ETAPAS, ROTULOS, agruparKanban, totalColuna, podeAtribuirMotoboy, podeMover, proximaEtapa } from '../calc.js';
import { fmtBRL, fmtDataHora, esc } from '../format.js';

export function montarKanban({ container, pedidos, motoboys, perfil, onMover, onAtribuir, onAbrir, onCancelar, onRestaurar }) {
  const grupos = agruparKanban(pedidos);
  const ativos = motoboys.filter(m => m.ativo !== false);

  container.innerHTML = `
    <div class="kanban">
      ${ETAPAS.map(etapa => `
        <section class="coluna" data-etapa="${etapa}">
          <header class="coluna-topo">
            <h3>${ROTULOS[etapa]}</h3>
            <span>${grupos[etapa].filter(p => !p.cancelado).length} · ${fmtBRL(totalColuna(grupos[etapa]))}</span>
          </header>
          <div class="coluna-cards" data-etapa="${etapa}">
            ${grupos[etapa].map(p => cartao(p, etapa, ativos, perfil)).join('')}
          </div>
        </section>`).join('')}
    </div>`;

  container.querySelectorAll('.cartao').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button,select')) return;
      onAbrir(Number(el.dataset.id));
    });
  });

  container.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const pedido = pedidos.find(p => Number(p.id) === id);
      if (!pedido) return;
      if (btn.dataset.acao === 'prev') onMover(pedido, proximaEtapa(pedido.status_kanban, -1));
      if (btn.dataset.acao === 'next') onMover(pedido, proximaEtapa(pedido.status_kanban, 1));
      if (btn.dataset.acao === 'cancelar') onCancelar(pedido);
      if (btn.dataset.acao === 'restaurar') onRestaurar(pedido);
    });
  });

  container.querySelectorAll('[data-motoboy]').forEach(sel => {
    sel.addEventListener('change', () => {
      const pedido = pedidos.find(p => Number(p.id) === Number(sel.dataset.motoboy));
      if (pedido) onAtribuir(pedido, sel.value ? Number(sel.value) : null);
    });
  });

  if (window.Sortable) {
    container.querySelectorAll('.coluna-cards').forEach(lista => {
      Sortable.create(lista, {
        group: 'pedidos',
        animation: 150,
        ghostClass: 'cartao-fantasma',
        onEnd: async (evt) => {
          const id = Number(evt.item.dataset.id);
          const pedido = pedidos.find(p => Number(p.id) === id);
          const destino = evt.to.dataset.etapa;
          if (!pedido) return;
          const regra = podeMover(pedido, destino);
          if (!regra.ok) {
            alert(regra.motivo);
            return onAbrir(pedido.id);
          }
          if (destino === 'cancelado') {
            return onCancelar(pedido);
          }
          await onMover(pedido, destino);
        }
      });
    });
  }
}

function cartao(p, etapa, motoboys, perfil) {
  const cancelado = p.cancelado;
  const podePrev = etapa !== 'novo' && etapa !== 'cancelado';
  const podeNext = etapa !== 'cancelado' && etapa !== 'concluido';
  const podeAtribuir = podeAtribuirMotoboy(p);
  return `
    <article class="cartao ${cancelado ? 'cancelado' : ''}" data-id="${p.id}">
      <div class="cartao-topo">
        <strong>${esc(p.cliente || 'Sem nome')}</strong>
        <span class="cartao-id">#${p.id}</span>
      </div>
      <div class="cartao-info">${esc(p.bairro || '—')} · ${fmtBRL(p.total)}</div>
      <div class="cartao-info">${fmtDataHora(p.created_at)} · ${esc(p.pagamento || '—')}</div>
      <div class="cartao-tags">
        ${p.canal === 'ifood' ? '<span class="tag-ifood">iFood</span>' : ''}
        ${p.origem === 'manual' ? '<span class="tag-manual">Manual</span>' : ''}
        ${p.faturado ? '<span class="tag-faturado">Faturado</span>' : ''}
        ${cancelado ? '<span class="tag-cancelado">Cancelado</span>' : ''}
      </div>
      ${podeAtribuir ? `
        <label class="cartao-motoboy">Motoboy
          <select data-motoboy="${p.id}">
            <option value="">Atribuir…</option>
            ${motoboys.map(m => `<option value="${m.id}" ${Number(p.motoboy_id) === Number(m.id) ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}
          </select>
        </label>` : ''}
      ${p.motoboy_id && !podeAtribuir ? `<div class="cartao-info">🛵 ${esc(nomeMotoboy(p.motoboy_id, motoboys))}</div>` : ''}
      <div class="cartao-acoes">
        ${podePrev ? `<button type="button" data-acao="prev" data-id="${p.id}" title="Voltar etapa">←</button>` : ''}
        ${podeNext ? `<button type="button" data-acao="next" data-id="${p.id}" title="Avançar etapa">→</button>` : ''}
        ${cancelado && perfil?.papel === 'admin' ? `<button type="button" data-acao="restaurar" data-id="${p.id}">Restaurar</button>` : ''}
        ${!cancelado ? `<button type="button" data-acao="cancelar" data-id="${p.id}" class="perigo">Cancelar</button>` : ''}
      </div>
    </article>`;
}

function nomeMotoboy(id, motoboys) {
  return motoboys.find(m => Number(m.id) === Number(id))?.nome || `Motoboy ${id}`;
}
