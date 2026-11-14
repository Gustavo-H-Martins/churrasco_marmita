import { criarPedido, atualizarPedido, validarCupom, sb } from '../db.js';
import { calcularFaturamento, validarPedidoManual, calcularDesconto } from '../calc.js';
import { fmtBRL, esc } from '../format.js';
import { registrarLog } from '../auth.js';
import { sincronizarEntradaPedido, sincronizarTaxaFaturamento } from '../financeiro-sync.js';

export function abrirPedidoManual({ ctx, onSalvo }) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-fundo">
      <form id="manualForm" class="modal-caixa form-grid">
        <h3>Novo pedido manual</h3>
        <label>Cliente *<input id="mCliente" required /></label>
        <label>Itens * (um por linha)<textarea id="mItens" rows="4" required placeholder="1x Marmita Mista&#10;2x Coca-Cola lata"></textarea></label>
        <label>Valor total (R$) *<input id="mTotal" type="number" min="0.01" step="0.01" required /></label>
        <label>Cupom de desconto
          <div style="display:flex;gap:8px">
            <input id="mCupom" placeholder="Código do cupom" style="flex:1" />
            <button type="button" id="mAplicarCupom" class="btn-ghost">Aplicar</button>
          </div>
        </label>
        <div id="mCupomMsg" class="msg"></div>
        <p class="dica">Desconto: <strong id="mDesconto">${fmtBRL(0)}</strong> · Total final: <strong id="mTotalFinal">${fmtBRL(0)}</strong></p>
        <label>Canal *<select id="mCanal">
          <option value="ifood">iFood</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="balcao">Balcão</option>
          <option value="outro">Outro</option>
        </select></label>
        <label>Telefone<input id="mTelefone" /></label>
        <label>Bairro<input id="mBairro" /></label>
        <label>Endereço<input id="mEndereco" /></label>
        <label>Pagamento<input id="mPagamento" placeholder="Pix, cartão, dinheiro…" /></label>
        <label>Observação<textarea id="mObs" rows="2"></textarea></label>
        <div id="mErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar pedido</button>
          <button type="button" id="mFechar" class="btn-ghost">Fechar</button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector('#manualForm');
  const erroEl = form.querySelector('#mErro');
  const cupomMsg = form.querySelector('#mCupomMsg');
  const totalInput = form.querySelector('#mTotal');
  const descontoEl = form.querySelector('#mDesconto');
  const totalFinalEl = form.querySelector('#mTotalFinal');
  let cupomAplicado = null;

  function atualizarResumo() {
    const bruto = Number(totalInput.value) || 0;
    const desc = cupomAplicado ? calcularDesconto(bruto, cupomAplicado.percentual).desconto : 0;
    descontoEl.textContent = fmtBRL(desc);
    totalFinalEl.textContent = fmtBRL(bruto - desc);
  }

  totalInput.addEventListener('input', atualizarResumo);
  atualizarResumo();

  root.querySelector('#mFechar').addEventListener('click', () => { root.innerHTML = ''; });

  root.querySelector('#mAplicarCupom').addEventListener('click', async () => {
    const botao = root.querySelector('#mAplicarCupom');
    const codigo = form.querySelector('#mCupom').value.trim();
    cupomMsg.className = 'msg';
    cupomMsg.textContent = '';

    if (!codigo) {
      cupomAplicado = null;
      cupomMsg.className = 'msg erro';
      cupomMsg.textContent = 'Informe o código do cupom.';
      atualizarResumo();
      return;
    }

    botao.disabled = true;
    try {
      const cupom = await validarCupom(codigo);
      if (!cupom) {
        cupomAplicado = null;
        cupomMsg.className = 'msg erro';
        cupomMsg.textContent = 'Cupom inválido ou expirado.';
      } else {
        cupomAplicado = { codigo: cupom.codigo, percentual: cupom.percentual };
        cupomMsg.className = 'msg ok';
        cupomMsg.textContent = `Cupom ${cupom.codigo}: ${cupom.percentual}%`;
      }
    } catch (err) {
      cupomAplicado = null;
      cupomMsg.className = 'msg erro';
      cupomMsg.textContent = `Não foi possível validar o cupom: ${err.message || err}`;
    } finally {
      botao.disabled = false;
      atualizarResumo();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itensTexto = form.querySelector('#mItens').value.trim();
    const bruto = Number(form.querySelector('#mTotal').value);
    const dados = {
      cliente: form.querySelector('#mCliente').value.trim(),
      itens: itensTexto,
      total: bruto,
      canal: form.querySelector('#mCanal').value
    };
    const erros = validarPedidoManual(dados);
    if (erros.length) {
      erroEl.textContent = erros.join(' ');
      return;
    }

    const desc = cupomAplicado ? calcularDesconto(bruto, cupomAplicado.percentual).desconto : 0;
    const totalFinal = bruto - desc;

    const linhas = itensTexto.split('\n').map(l => l.trim()).filter(Boolean);
    const pedido = {
      cliente: dados.cliente,
      telefone: form.querySelector('#mTelefone').value.trim() || null,
      bairro: form.querySelector('#mBairro').value.trim() || null,
      endereco: form.querySelector('#mEndereco').value.trim() || null,
      pagamento: form.querySelector('#mPagamento').value.trim() || null,
      observacao: form.querySelector('#mObs').value.trim() || null,
      itens: linhas.map(l => ({ produto: l, quantidade: 1, preco_unitario: null, subtotal: null })),
      subtotal: bruto,
      frete: 0,
      total: totalFinal,
      valor_bruto: totalFinal,
      cupom: cupomAplicado?.codigo || null,
      desconto: desc,
      canal: dados.canal,
      origem: 'manual',
      status_kanban: 'novo',
      posicao: Date.now()
    };

    erroEl.textContent = '';
    try {
      const criado = await criarPedido(pedido);
      await registrarLog('criar_pedido_manual', 'pedidos', criado.id, { cliente: criado.cliente, total: criado.total, canal: criado.canal, cupom: criado.cupom || null });
      root.innerHTML = '';
      if (onSalvo) await onSalvo();
    } catch (err) {
      erroEl.textContent = 'Falha ao salvar pedido: ' + (err.message || err);
    }
  });
}

export function abrirFaturamento(pedido, { ctx, onSalvo }) {
  const root = document.getElementById('modalRoot');
  const bruto = Number(pedido.valor_bruto ?? pedido.total ?? 0);
  root.innerHTML = `
    <div class="modal-fundo">
      <form id="faturamentoForm" class="modal-caixa form-grid">
        <h3>Faturar pedido #${esc(String(pedido.id))}</h3>
        <p>Valor cheio: <strong>${fmtBRL(bruto)}</strong></p>
        <label>Valor efetivamente recebido (R$)
          <input id="fRecebido" type="number" min="0" step="0.01" value="${bruto}" required />
        </label>
        <p class="dica">Taxa calculada: <strong id="fTaxa">${fmtBRL(0)}</strong> · Líquido: <strong id="fLiquido">${fmtBRL(bruto)}</strong></p>
        <div id="fErro" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Confirmar faturamento</button>
          <button type="button" id="fFechar" class="btn-ghost">Fechar</button>
        </div>
      </form>
    </div>`;

  const form = root.querySelector('#faturamentoForm');
  const input = form.querySelector('#fRecebido');
  const taxaEl = form.querySelector('#fTaxa');
  const liquidoEl = form.querySelector('#fLiquido');
  const erroEl = form.querySelector('#fErro');

  function atualizarTaxa() {
    const { taxa, liquido } = calcularFaturamento(bruto, Number(input.value || 0));
    taxaEl.textContent = fmtBRL(taxa);
    liquidoEl.textContent = fmtBRL(liquido);
  }
  input.addEventListener('input', atualizarTaxa);
  atualizarTaxa();

  root.querySelector('#fFechar').addEventListener('click', () => { root.innerHTML = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const recebido = Number(input.value);
    if (!(recebido >= 0)) {
      erroEl.textContent = 'Informe um valor recebido válido.';
      return;
    }
    const { taxa } = calcularFaturamento(bruto, recebido);
    const agora = new Date().toISOString();
    erroEl.textContent = '';
    try {
      const { data: { user } } = await sb.auth.getUser();
      await atualizarPedido(pedido.id, {
        finalizado: true,
        finalizado_em: agora,
        finalizado_por: ctx.perfil?.email || 'painel',
        valor_recebido: recebido,
        taxa,
        faturado: true,
        faturado_em: agora,
        faturado_por: user?.id || null
      });
      await sincronizarEntradaPedido({ ...pedido, finalizado: true, valor_bruto: bruto });
      await sincronizarTaxaFaturamento(pedido.id, taxa, `Taxa do pedido #${pedido.id}`);
      await registrarLog('faturar_pedido', 'pedidos', pedido.id, { bruto, recebido, taxa });
      root.innerHTML = '';
      if (onSalvo) await onSalvo();
    } catch (err) {
      erroEl.textContent = 'Falha ao faturar: ' + (err.message || err);
    }
  });
}
