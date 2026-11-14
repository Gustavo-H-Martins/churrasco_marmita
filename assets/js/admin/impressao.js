import { fmtBRL, fmtDataHora, esc } from '../format.js';
import { atualizarPedido } from '../db.js';

export function buildLabel(pedido) {
  const itens = (pedido.itens && pedido.itens.length)
    ? pedido.itens.map(it => `${it.quantidade}x ${esc(it.produto)}`).join('<br>')
    : '—';
  return `<div class="plabel">
    <div class="l-brand">CHURRASCO NA MARMITA</div>
    <div class="l-carinho">Feito com muito carinho, para você!</div>
    <div class="l-num">Pedido #${pedido.seqDia || pedido.id || '—'}</div>
    <div class="l-sub">Lagoa Santa - MG · ${fmtDataHora(pedido.created_at)}</div>
    <div class="l-cust">${esc(pedido.cliente || '—')}</div>
    <div class="l-line">📞 ${esc(pedido.telefone || '—')}</div>
    <div class="l-line">📍 ${esc(pedido.bairro || '—')}${pedido.endereco ? ' — ' + esc(pedido.endereco) : ''}</div>
    <div class="l-sep"></div>
    <div class="l-items">${itens}</div>
    ${pedido.cancelado ? '<div class="l-obs" style="font-weight:800;font-size:14px;color:#c00">❌ CANCELADO</div>' : ''}
    ${pedido.observacao ? `<div class="l-obs">Obs: ${esc(pedido.observacao)}</div>` : ''}
    <div class="l-sep"></div>
    <div class="l-total">TOTAL ${fmtBRL(pedido.total)}</div>
    <div class="l-pay">Pagamento: ${esc(pedido.pagamento || '—')}</div>
    <div class="l-sep2"></div>
    <div class="l-foot">📸 @churrasco_marmita</div>
    <div class="l-foot">📞 +55 (31) 9381-7229</div>
  </div>`;
}

export async function imprimirPedido(pedido) {
  const area = document.getElementById('printArea');
  area.innerHTML = buildLabel(pedido);
  try {
    await atualizarPedido(pedido.id, {
      impresso: true,
      impresso_em: new Date().toISOString()
    });
  } catch (e) {
    console.warn('Falha ao marcar impressão:', e);
  }
  window.print();
}

export async function copiarEndereco(pedido) {
  const texto = [
    `Pedido #${pedido.seqDia || pedido.id}`,
    pedido.cliente || '—',
    pedido.telefone || '—',
    `${pedido.bairro || '—'}${pedido.endereco ? ' - ' + pedido.endereco : ''}`,
    fmtBRL(pedido.total)
  ].join(' | ');
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (e) {
    window.prompt('Copie o endereço:', texto);
    return false;
  }
}
