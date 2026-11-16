import { SUPABASE, LOJA_FALLBACK } from './config.js';
import { listarBairros } from './db.js';
import { fmtBRL, esc, fmtDataDia } from './format.js';
import { calcularFrete } from './calc.js';

// Cópia local de emergência: mesmos 37 registros de database/003-seed-bairros.sql.
const BAIRROS_FALLBACK = [
  ['Acácias',3,'Bairro'], ['Vila Maria',3,'Bairro'], ['Santa Helena',3,'Bairro'],
  ['Vila Rica',4,'Bairro'], ['Jardim Imperial',4,'Bairro'], ['Por do Sol',4,'Bairro'],
  ['Moradas',4,'Bairro'], ['Vale Verde Ville',4,'Bairro'], ['Portal do Sol',4,'Bairro'],
  ['Jacques Vile',4,'Bairro'], ['Palmital',5,'Bairro'], ['Vale dos Sonhos',5,'Bairro'],
  ['Vila Fagundes',5,'Bairro'], ['Sobradinho',6,'Bairro'], ['Brant',6,'Bairro'],
  ['Campinho',6,'Bairro'], ['Centro',7,'Bairro'], ['Barraginha',7,'Bairro'],
  ['Várzea',8,'Bairro'], ['Bela Vista',8,'Bairro'], ['Joa',9,'Bairro'],
  ['Santos Dumont',9,'Bairro'], ['Ovídeo Guerra',9,'Bairro'], ['Ipê',10,'Bairro'],
  ['Praia Angélica',10,'Bairro'], ['Novo Santos Dumont',10,'Bairro'], ['Recanto',10,'Bairro'],
  ['Aeronautas',15,'Bairro'], ['Visão',15,'Bairro'], ['Lagoinha',15,'Bairro'],
  ['Lundceia',7,'Bairro'], ['Recanto do Poeta',12,'Bairro'],
  ['Amendoeiras',15,'Condomínio'], ['Mirante do Fidalgo',8,'Condomínio'],
  ['Bouganvile',15,'Condomínio'], ['Maripousas',8,'Condomínio'],
  ['Trilhas do Sol',8,'Condomínio']
].map(([nome, taxa, grupo]) => ({ nome, taxa, grupo }));

let bairros = [];
try {
  bairros = await listarBairros();
  if (!bairros.length) bairros = BAIRROS_FALLBACK;
} catch (e) {
  console.warn('Falha ao carregar bairros; usando fallback local.', e);
  bairros = BAIRROS_FALLBACK;
}

let products = [
  { id:'mista', name:'Marmita Mista', price:23, img:'images/marmita_mista.jpg', cls:'meal', desc:'Arroz, farofa, vinagrete e churrasco misto (carne bovina, carne suína e linguiça).' },
  { id:'mista-completa', name:'Marmita Mista Completa', price:25, img:'images/marmita_mista_completa.png', cls:'meal', desc:'Arroz, feijão, farofa, vinagrete e churrasco misto (carne bovina, carne suína e linguiça).' },
  { id:'bovina', name:'Marmita Bovina', price:28, img:'images/marmita_bovina.png', cls:'meal', desc:'Arroz, feijão, farofa, vinagrete e churrasco bovino.' },
  { id:'so-misto', name:'Marmita Só Churrasco Misto', price:79.9, img:'images/marmita_mista.jpg', cls:'meal', desc:'Só o churrasco misto (carne bovina, carne suína e linguiça) — sem acompanhamentos.' },
  { id:'so-bovino', name:'Marmita Só Churrasco Bovino', price:99.9, img:'images/marmita_bovina.png', cls:'meal', desc:'Só o churrasco bovino — sem acompanhamentos.' },
  { id:'refrigerante', name:'Refrigerante Lata 220ml', price:5, img:'images/refrigerante_lata.png', cls:'drink', desc:'Lata 220ml: Coca-Cola, Fanta, Guaraná, Soda Limonada, geladas!' },
  { id:'suco', name:'Sucos Gelados', price:7, img:'images/sucos_gelados.png', cls:'drink', desc:'Diversos sabores, para acompanhar!' },
  { id:'mate-couro', name:'Mate Couro 1L', price:8, img:'images/mate_couro_1l.png', cls:'drink', desc:'Mate Couro 1L gelado.' },
  { id:'guarana-2l', name:'Guaraná 2L', price:12, img:'images/guarana_2l.png', cls:'drink', desc:'Guaraná 2L para compartilhar.' },
  { id:'coca-2l', name:'Coca-Cola 2L', price:14, img:'images/coca_2l.png', cls:'drink', desc:'Coca-Cola 2L bem gelada.' },
];
let cart = {};
const CART_KEY = 'churrasco_cart_v1';

function salvarCarrinho(){
  try {
    const itens = {};
    products.forEach(p => { if(cart[p.id] > 0) itens[p.name] = cart[p.id]; });
    localStorage.setItem(CART_KEY, JSON.stringify(itens));
  } catch(e){}
}
function restaurarCarrinho(){
  try {
    const itens = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {};
    Object.keys(itens).forEach(nome => {
      const p = products.find(x => x.name === nome);
      if(p) cart[p.id] = Math.max(0, Number(itens[nome]) || 0);
    });
  } catch(e){}
}
function limparCarrinhoSalvo(){
  try { localStorage.removeItem(CART_KEY); } catch(e){}
}

// Reconstrói o carrinho a partir dos produtos carregados (mantém quantidades já escolhidas)
function rebuildCart(){
  const prev = cart;
  cart = Object.fromEntries(products.map(p => [p.id, 0]));
  Object.keys(prev).forEach(id => { if(id in cart) cart[id] = prev[id]; });
}
rebuildCart();

let isOpen = true;
let proximaAbertura = null;
let deliveryMode = 'entrega';
let appliedCoupon = null;

// ── Configuração da loja (carregada do Supabase, com padrão local) ──
let storeConfig = { ...LOJA_FALLBACK };

const productsEl = document.getElementById('products');
const cartListEl = document.getElementById('cartList');
const subtotalEl = document.getElementById('subtotal');
const totalEl = document.getElementById('total');
const shippingEl = document.getElementById('shipping');
const cartCountEl = document.getElementById('cartCount');
const statusEl = document.getElementById('status');

// ── Tema claro/escuro ──────────────────────────────────────────────
(function initTema(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  function aplicar(tema){
    document.documentElement.dataset.theme = tema;
    const escuro = tema === 'dark';
    btn.setAttribute('aria-label', escuro ? 'Ativar tema claro' : 'Ativar tema escuro');
    btn.setAttribute('aria-pressed', String(escuro));
    const meta = document.querySelector('meta[name="color-scheme"]');
    if(meta) meta.setAttribute('content', escuro ? 'dark' : 'light');
  }
  let atual = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  aplicar(atual);
  btn.addEventListener('click', () => {
    atual = atual === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('churrasco_theme', atual); } catch(e){}
    aplicar(atual);
  });
})();

const ROTULOS_CAT = { meal: 'Marmita', drink: 'Bebida', dessert: 'Sobremesa' };
let categoriaAtiva = 'todos';

function reportHeight(){
  if (typeof _reportHeight === 'function') _reportHeight();
}

function limparErrosDeCampo(){
  document.querySelectorAll('.campo-erro').forEach(el => el.remove());
  document.querySelectorAll('[aria-describedby^="erro-"]').forEach(el => el.removeAttribute('aria-describedby'));
}

function showStatus(msg, campo){
  limparErrosDeCampo();
  if(campo){
    statusEl.textContent = '';
    statusEl.className = 'status';
    campo.setAttribute('aria-invalid', 'true');
    const erro = document.createElement('p');
    erro.id = 'erro-' + (campo.id || 'campo');
    erro.className = 'campo-erro';
    erro.setAttribute('role', 'alert');
    erro.textContent = msg;
    campo.insertAdjacentElement('afterend', erro);
    campo.setAttribute('aria-describedby', erro.id);
    if(typeof campo.focus === 'function') campo.focus({ preventScroll: true });
    if(typeof campo.scrollIntoView === 'function') campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    statusEl.textContent = msg;
    statusEl.className = 'status error';
    if(typeof statusEl.scrollIntoView === 'function'){
      statusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  reportHeight();
}
function showSuccess(msg){
  limparErrosDeCampo();
  statusEl.textContent = msg;
  statusEl.className = 'status ok';
  reportHeight();
}
function clearStatus(){
  statusEl.textContent = '';
  statusEl.className = 'status';
  limparErrosDeCampo();
  document.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
}

// ── Sincronia com Supabase ─────────────────────────────────────────
// Lê o status do banco (acesso anônimo, sem segredo no código)
async function loadRemoteStatus(){
  if(SUPABASE.url && SUPABASE.key){
    try {
      var resp = await fetch(SUPABASE.url + '/rest/v1/status?id=eq.1&select=*', {
        headers: { 'apikey': SUPABASE.key, 'Authorization': 'Bearer ' + SUPABASE.key }
      });
      if(resp.ok){
        var data = await resp.json();
        if(data && data.length > 0 && typeof data[0].isOpen === 'boolean'){
          isOpen = data[0].isOpen;
          proximaAbertura = data[0].proxima_abertura || null;
          localStorage.setItem('churrasco_open', isOpen ? 'true' : 'false');
          return true;
        }
      }
    } catch(e){}
  }
  // Fallback: tenta ler do status.json público no GitHub Pages
  try {
    var resp = await fetch('status.json');
    if(resp.ok){
      var data = await resp.json();
      if(typeof data.isOpen === 'boolean'){
        isOpen = data.isOpen;
        proximaAbertura = data.proxima_abertura || null;
        localStorage.setItem('churrasco_open', isOpen ? 'true' : 'false');
        return true;
      }
    }
  } catch(e){}
  return false;
}

// Salva um pedido na tabela `pedidos` do Supabase
async function saveOrder(order){
  if(!SUPABASE.url || !SUPABASE.key) return false;
  const enviar = (dados) => fetch(SUPABASE.url + '/rest/v1/pedidos', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE.key,
      'Authorization': 'Bearer ' + SUPABASE.key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(dados)
  });
  try {
    var resp = await enviar(order);
    if(!resp.ok && order.agendado_para){
      // Coluna de agendamento ainda não migrada: salva o pedido sem ela
      // em vez de perder o registro.
      const { agendado_para, ...semAgenda } = order;
      resp = await enviar(semAgenda);
    }
    return resp.ok;
  } catch(e){
    console.error('Falha ao salvar pedido no Supabase:', e);
    return false;
  }
}

// ── Bairros do banco ───────────────────────────────────────────────
function preencherBairros(){
  const select = document.getElementById('neighborhood');
  if(!select) return;
  const grupos = ['Bairro', 'Condomínio'];
  select.innerHTML = '<option value="">Selecione o bairro...</option>' +
    grupos.map(g => {
      const itens = bairros.filter(b => (b.grupo || 'Bairro') === g && b.ativo !== false);
      if(!itens.length) return '';
      const opcoes = itens.map(b => `<option value="${esc(b.nome)}">${esc(b.nome)} — ${esc(fmtBRL(b.taxa))}</option>`).join('');
      return g === 'Condomínio' ? `<optgroup label="Condomínios">${opcoes}</optgroup>` : opcoes;
    }).join('');
}

function updateQty(id, delta){
  cart[id] = Math.max(0, cart[id] + delta);
  salvarCarrinho();
  render();
}

function produtosVisiveis(){
  return categoriaAtiva === 'todos' ? products : products.filter(p => p.cls === categoriaAtiva);
}

function renderProducts(){
  const visiveis = produtosVisiveis();
  productsEl.removeAttribute('aria-busy');
  if(!visiveis.length){
    productsEl.innerHTML = '<div class="products-empty">Nenhum item nesta categoria por enquanto.</div>';
    return;
  }
  productsEl.innerHTML = visiveis.map(p => `
    <article class="produto">
      <div class="produto-img"><img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" /></div>
      <div class="produto-info">
        <div class="produto-topo">
          <h3>${esc(p.name)}</h3>
          <span class="produto-preco">${esc(fmtBRL(p.price))}</span>
        </div>
        <p class="produto-desc">${esc(p.desc)}</p>
        <div class="produto-rodape">
          <span class="produto-cat">${esc(ROTULOS_CAT[p.cls] || 'Item')}</span>
          <div class="qty">
            <button type="button" aria-label="Remover um ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="-1">−</button>
            <span class="qty-value" aria-live="polite">${cart[p.id]}</span>
            <button type="button" aria-label="Adicionar um ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="1">+</button>
          </div>
        </div>
      </div>
    </article>
  `).join('');

  productsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => updateQty(btn.dataset.id, Number(btn.dataset.delta)));
  });
}

function atualizarCategorias(){
  document.querySelectorAll('#categorias .cat-chip').forEach(btn => {
    const cat = btn.dataset.cat;
    btn.hidden = cat !== 'todos' && !products.some(p => p.cls === cat);
  });
}

function setCategoria(cat){
  categoriaAtiva = cat;
  document.querySelectorAll('#categorias .cat-chip').forEach(btn => {
    const ativo = btn.dataset.cat === cat;
    btn.classList.toggle('ativo', ativo);
    btn.setAttribute('aria-pressed', String(ativo));
  });
  renderProducts();
}

function renderCart(){
  const selected = products.filter(p => cart[p.id] > 0);
  const totalItems = selected.reduce((sum,p) => sum + cart[p.id], 0);
  const subtotal = selected.reduce((sum,p) => sum + (cart[p.id] * p.price), 0);
  const neighborhood = document.getElementById('neighborhood').value;
  const shipping = (deliveryMode === 'retirada') ? 0 : calcularFrete(bairros, neighborhood);
  const desconto = appliedCoupon
    ? Math.min(subtotal, Math.round(subtotal * appliedCoupon.percentual) / 100)
    : 0;
  const total = subtotal + shipping - desconto;
  cartCountEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`;
  subtotalEl.textContent = fmtBRL(subtotal);
  shippingEl.textContent = (deliveryMode === 'retirada') ? 'R$ 0,00' : (neighborhood ? fmtBRL(shipping) : '—');
  totalEl.textContent = fmtBRL(total);

  const discountRow = document.getElementById('discountRow');
  const discountEl = document.getElementById('discount');
  if(desconto > 0){
    discountRow.style.display = '';
    discountEl.textContent = '- ' + fmtBRL(desconto);
  } else {
    discountRow.style.display = 'none';
    discountEl.textContent = '—';
  }

  if(!selected.length){
    cartListEl.innerHTML = '<div class="empty">Seu carrinho está vazio. Escolha os itens acima.</div>';
  } else {
    cartListEl.innerHTML = selected.map(p => `
      <div class="cart-item">
        <div>
          <strong>${esc(p.name)}</strong>
          <small>${cart[p.id]} x ${esc(fmtBRL(p.price))}</small>
        </div>
        <strong>${esc(fmtBRL(cart[p.id] * p.price))}</strong>
      </div>
    `).join('');
  }

  const barra = document.getElementById('barraCarrinho');
  if(barra){
    barra.hidden = totalItems === 0;
    const barraTotal = document.getElementById('barraTotal');
    const barraItens = document.getElementById('barraItens');
    if(barraTotal) barraTotal.textContent = fmtBRL(total);
    if(barraItens) barraItens.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`;
    document.body.classList.toggle('tem-barra', totalItems > 0);
  }
}

async function applyCoupon(){
  const msg = document.getElementById('couponMsg');
  const code = document.getElementById('coupon').value.trim();
  if(!code){
    appliedCoupon = null;
    msg.textContent = 'Informe o código do cupom.';
    render();
    return;
  }
  msg.textContent = 'Validando…';
  try {
    const resp = await fetch(SUPABASE.url + '/rest/v1/rpc/validar_cupom', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE.key,
        'Authorization': 'Bearer ' + SUPABASE.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_codigo: code })
    });
    const data = await resp.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!resp.ok || !row) {
      appliedCoupon = null;
      msg.textContent = 'Cupom inválido ou expirado.';
      render();
      return;
    }
    appliedCoupon = { codigo: row.codigo, percentual: Number(row.percentual) };
    msg.textContent = `Cupom ${row.codigo}: ${Number(row.percentual)}% aplicado.`;
    render();
  } catch(e) {
    appliedCoupon = null;
    msg.textContent = 'Não foi possível validar o cupom.';
    render();
  }
}

function textoAgendamento(){
  const data = proximaAbertura ? fmtDataDia(proximaAbertura) : '';
  return data
    ? `📅 Agende seu pedido para o próximo turno — ${data}`
    : '📅 Agende seu pedido para o próximo turno';
}

function render(){
  const banner = document.getElementById('closedBanner');
  if(banner){
    banner.classList.toggle('active', !isOpen);
    if(!isOpen) banner.textContent = textoAgendamento();
  }
  const pill = document.getElementById('statusLoja');
  if(pill){
    pill.dataset.estado = isOpen ? 'aberto' : 'fechado';
    pill.textContent = isOpen
      ? 'Aberto'
      : (proximaAbertura ? `Fechado · ${fmtDataDia(proximaAbertura)}` : 'Fechado');
  }
  const agendaNotice = document.getElementById('agendaNotice');
  if(agendaNotice){
    agendaNotice.textContent = (!isOpen && proximaAbertura)
      ? `Este pedido será agendado para ${fmtDataDia(proximaAbertura)}.`
      : '';
    agendaNotice.style.display = (!isOpen && proximaAbertura) ? '' : 'none';
  }
  const tempoEl = document.getElementById('tempoEstimado');
  if(tempoEl){
    const bairro = bairros.find(b => b.nome === document.getElementById('neighborhood').value);
    const min = Number(bairro?.tempo_medio_min);
    if(deliveryMode === 'entrega' && Number.isFinite(min) && min > 0){
      tempoEl.hidden = false;
      tempoEl.textContent = `Previsão de entrega: ~${min} min · tempo médio, pode variar.`;
    } else {
      tempoEl.hidden = true;
      tempoEl.textContent = '';
    }
  }
  atualizarCategorias();
  renderProducts();
  renderCart();
  reportHeight();
}

function setDeliveryMode(mode){
  deliveryMode = mode;
  const entregaBtn = document.getElementById('deliveryBtn');
  const retiradaBtn = document.getElementById('pickupBtn');
  entregaBtn.classList.toggle('active', mode === 'entrega');
  retiradaBtn.classList.toggle('active', mode === 'retirada');
  entregaBtn.setAttribute('aria-pressed', String(mode === 'entrega'));
  retiradaBtn.setAttribute('aria-pressed', String(mode === 'retirada'));
  const fields = document.getElementById('deliveryFields');
  if(fields) fields.style.display = (mode === 'entrega') ? '' : 'none';
  render();
}

let pendingOrder = null;

document.getElementById('finishBtn').addEventListener('click', () => {
  clearStatus();
  const nameEl = document.getElementById('name');
  const phoneEl = document.getElementById('phone');
  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();
  const address = document.getElementById('address').value.trim();
  const isRetirada = deliveryMode === 'retirada';
  const neighborhoodEl = document.getElementById('neighborhood');
  const neighborhood = isRetirada ? 'Retirada no local' : neighborhoodEl.value;
  const paymentEl = document.getElementById('payment');
  const payment = paymentEl.value;
  const observacao = document.getElementById('obs').value.trim();
  const selected = products.filter(p => cart[p.id] > 0);

  if(!name) return showStatus('Preencha o nome do cliente.', nameEl);
  if(phone.replace(/\D/g, '').length < 10) return showStatus('Informe um telefone com DDD.', phoneEl);
  if(!isRetirada && !neighborhood) return showStatus('Selecione o bairro para calcular o frete.', neighborhoodEl);
  if(!payment) return showStatus('Selecione a forma de pagamento.', paymentEl);
  if(!selected.length) return showStatus('Adicione pelo menos um item ao pedido.');

  const subtotal = selected.reduce((sum,p) => sum + (cart[p.id] * p.price), 0);
  const shipping = isRetirada ? 0 : calcularFrete(bairros, neighborhood);

  pendingOrder = {
    name, phone, address, isRetirada, neighborhood, payment, observacao, shipping,
    items: selected.map(p => ({ name: p.name, qty: cart[p.id], price: p.price }))
  };
  openDrinkModal();
});

// ── Sugestão de bebida antes de finalizar ──────────────────────────
let drinkCart = {};

function openDrinkModal(){
  const drinks = products.filter(p => p.cls === 'drink');
  // Se o pedido já contém bebida, não mostra a sugestão
  const hasDrink = drinks.some(p => cart[p.id] > 0);
  if(!drinks.length || hasDrink){ finalizeOrder([]); return; }
  drinkCart = Object.fromEntries(drinks.map(p => [p.id, 0]));
  renderDrinkList(drinks);
  document.getElementById('drinkModal').classList.add('active');
}

function renderDrinkList(drinks){
  document.getElementById('drinkList').innerHTML = drinks.map(p => `
    <div class="drink-item">
      <span><strong>${esc(p.name)}</strong><br /><small style="color:var(--menu-muted)">${esc(fmtBRL(p.price))}</small></span>
      <div class="qty">
        <button type="button" aria-label="Diminuir ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="-1">−</button>
        <span class="qty-value" aria-live="polite">${drinkCart[p.id]}</span>
        <button type="button" aria-label="Adicionar ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="1">+</button>
      </div>
    </div>`).join('');
  document.getElementById('drinkList').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      drinkCart[b.dataset.id] = Math.max(0, drinkCart[b.dataset.id] + Number(b.dataset.delta));
      renderDrinkList(drinks);
    });
  });
}

function finalizeOrder(drinks){
  const o = pendingOrder;
  if(!o) return;
  const drinkItems = (drinks || []).filter(d => d.qty > 0);
  const items = o.items.concat(drinkItems.map(d => ({ name: d.product.name, qty: d.qty, price: d.product.price })));
  const subtotal = items.reduce((s,it) => s + it.qty*it.price, 0);
  const desconto = appliedCoupon
    ? Math.min(subtotal, Math.round(subtotal * appliedCoupon.percentual) / 100)
    : 0;
  const total = subtotal + o.shipping - desconto;
  const agendadoPara = isOpen ? null : (proximaAbertura || null);
  const itemsText = items.map(it => `- ${it.name} x${it.qty} = ${fmtBRL(it.qty * it.price)}`).join('%0A');
  const message = [
    `*Novo pedido - ${storeConfig.nome}*`,
    '',
    `*Nome:* ${o.name}`,
    `*Telefone:* ${o.phone}`,
    `*Bairro:* ${o.neighborhood}`,
    o.isRetirada ? '*Endereço:* Retirada no local' : (o.address ? `*Endereço:* ${o.address}` : '*Endereço:* não informado'),
    `*Pagamento:* ${o.payment}`,
    !isOpen ? `*Agendado para:* ${agendadoPara ? fmtDataDia(agendadoPara) : 'próximo turno'}` : '',
    o.observacao ? `*Observação:* ${o.observacao}` : '',
    '',
    '*Pedido:*',
    itemsText.replace(/%0A/g,'\n'),
    '',
    `*Subtotal:* ${fmtBRL(subtotal)}`,
    `*Frete:* ${fmtBRL(o.shipping)}`,
    (appliedCoupon && desconto > 0) ? `*Cupom:* ${appliedCoupon.codigo} (- ${fmtBRL(desconto)})` : '',
    `*Total:* ${fmtBRL(total)}`
  ].join('\n').replace(/\n{3,}/g, '\n\n');

  const url = `https://wa.me/${storeConfig.telefone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  if (typeof sendPrompt === 'function') {
    sendPrompt(`Pedido iniciado no WhatsApp para ${storeConfig.nome}. Cliente: ${o.name}.`);
  }

  // Salva o pedido na tabela `pedidos` do Supabase (silencioso — falhas só vão ao console)
  const pedido = {
    cliente: o.name,
    telefone: o.phone,
    bairro: o.neighborhood,
    endereco: o.isRetirada ? null : (o.address || null),
    pagamento: o.payment,
    observacao: o.observacao || null,
    itens: items.map(it => ({
      produto: it.name,
      quantidade: it.qty,
      preco_unitario: it.price,
      subtotal: it.qty * it.price
    })),
    subtotal: subtotal,
    frete: o.shipping,
    desconto: desconto,
    cupom: appliedCoupon?.codigo || null,
    total: total
  };
  if(agendadoPara) pedido.agendado_para = agendadoPara;
  saveOrder(pedido);

  document.getElementById('drinkModal').classList.remove('active');
  pendingOrder = null;
  appliedCoupon = null;
  document.getElementById('coupon').value = '';
  document.getElementById('couponMsg').textContent = '';
  cart = Object.fromEntries(products.map(p => [p.id, 0]));
  limparCarrinhoSalvo();
  render();
  showSuccess('Pedido enviado para o WhatsApp. Confira e envie a mensagem.');
}

document.getElementById('drinkNoBtn').addEventListener('click', () => finalizeOrder([]));
document.getElementById('drinkYesBtn').addEventListener('click', () => {
  const drinks = products.filter(p => p.cls === 'drink');
  finalizeOrder(drinks.map(p => ({ product: p, qty: drinkCart[p.id] || 0 })));
});

document.getElementById('neighborhood').addEventListener('change', () => render());
document.getElementById('applyCoupon').addEventListener('click', applyCoupon);
document.getElementById('coupon').addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); applyCoupon(); }
});
document.getElementById('deliveryBtn').addEventListener('click', () => setDeliveryMode('entrega'));
document.getElementById('pickupBtn').addEventListener('click', () => setDeliveryMode('retirada'));

document.querySelectorAll('#categorias .cat-chip').forEach(btn => {
  btn.addEventListener('click', () => setCategoria(btn.dataset.cat));
});

const barraBtn = document.getElementById('barraBtn');
if(barraBtn) barraBtn.addEventListener('click', () => {
  const checkout = document.getElementById('checkout');
  if(checkout) checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const nome = document.getElementById('name');
  if(nome) window.setTimeout(() => nome.focus({ preventScroll: true }), 350);
});

// Máscara simples de telefone brasileiro: (31) 99999-9999
const phoneInput = document.getElementById('phone');
if(phoneInput){
  phoneInput.addEventListener('input', () => {
    const d = phoneInput.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if(d.length > 6){
      const corte = d.length > 10 ? 7 : 6;
      out = `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
    } else if(d.length > 2){
      out = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    } else if(d.length){
      out = `(${d}`;
    }
    phoneInput.value = out;
  });
}

['name', 'phone', 'neighborhood', 'payment', 'address'].forEach(id => {
  const el = document.getElementById(id);
  if(!el) return;
  const limpar = () => {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    const erro = document.getElementById('erro-' + id);
    if(erro) erro.remove();
  };
  el.addEventListener('input', limpar);
  el.addEventListener('change', limpar);
});

// ── Produtos (Supabase) ────────────────────────────────────────────
function sbBase(){ return SUPABASE.url + '/rest/v1/'; }

async function loadProductsFromDB(){
  if(!SUPABASE.url || !SUPABASE.key) return;
  try {
    const resp = await fetch(sbBase() + 'produtos?select=*&order=ordem.asc', {
      headers: { 'apikey': SUPABASE.key, 'Authorization': 'Bearer ' + SUPABASE.key }
    });
    if(!resp.ok) return;
    const data = await resp.json();
    if(data && data.length){
      products = data.filter(p => p.ativo !== false).map(p => ({
        id: String(p.id),
        name: p.nome,
        price: Number(p.preco),
        img: p.imagem || 'images/logo.png',
        cls: p.categoria || 'meal',
        desc: p.descricao || '',
        dbId: p.id
      }));
      rebuildCart();
    }
  } catch(e){}
}

// ── Configuração da loja (Supabase) ────────────────────────────────
async function loadConfigFromDB(){
  if(!SUPABASE.url || !SUPABASE.key) return;
  try {
    const resp = await fetch(sbBase() + 'config?id=eq.1&select=*', {
      headers: { 'apikey': SUPABASE.key, 'Authorization': 'Bearer ' + SUPABASE.key }
    });
    if(!resp.ok) return;
    const data = await resp.json();
    if(data && data.length){
      const c = data[0];
      if(c.nome_loja) storeConfig.nome = c.nome_loja;
      if(c.descricao_loja) storeConfig.descricao = c.descricao_loja;
      if(c.telefone) storeConfig.telefone = c.telefone;
      if(c.endereco) storeConfig.endereco = c.endereco;
      if(c.instagram) storeConfig.instagram = c.instagram;
      if(c.logo) storeConfig.logo = c.logo;
      if(c.banner) storeConfig.banner = c.banner;
    }
  } catch(e){}
}

function applyConfig(){
  const nome = document.querySelector('.marca-texto strong');
  if(nome) nome.textContent = storeConfig.nome;
  const logoImg = document.querySelector('.marca-logo img');
  if(logoImg) logoImg.src = storeConfig.logo;
  const waLink = document.getElementById('linkWhats');
  if(waLink) waLink.href = 'https://wa.me/' + storeConfig.telefone;
  const instaLink = document.getElementById('linkInsta');
  if(instaLink) instaLink.href = storeConfig.instagram;
  const endereco = document.getElementById('enderecoLoja');
  if(endereco) endereco.textContent = storeConfig.endereco;
  document.title = storeConfig.nome;
}

function formatPhone(num){
  const d = String(num).replace(/\D/g,'');
  if(d.length === 13) return '+'+d.slice(0,2)+' ('+d.slice(2,4)+') '+d.slice(4,9)+'-'+d.slice(9);
  if(d.length === 12) return '+'+d.slice(0,2)+' ('+d.slice(2,4)+') '+d.slice(4,8)+'-'+d.slice(8);
  return '+'+d;
}

// ── Inicialização assíncrona ───────────────────────────────────────
function renderSkeletons(){
  productsEl.setAttribute('aria-busy', 'true');
  productsEl.innerHTML = Array.from({ length: 4 }).map(() => `
    <div class="produto esqueleto" aria-hidden="true">
      <div class="esq-img"></div>
      <div class="esq-info">
        <div class="esq-linha" style="width:62%"></div>
        <div class="esq-linha" style="width:92%"></div>
        <div class="esq-linha" style="width:40%"></div>
      </div>
    </div>`).join('');
}

renderSkeletons();

(async function(){
  await Promise.all([loadProductsFromDB(), loadConfigFromDB()]);
  rebuildCart();
  restaurarCarrinho();
  var s = new URLSearchParams(window.location.search).get('status');
  if(s === 'fechado') isOpen = false;
  else if(s === 'aberto') isOpen = true;
  else if(!(await loadRemoteStatus())){
    isOpen = localStorage.getItem('churrasco_open') !== 'false';
  }
  preencherBairros();
  applyConfig();
  render();
})();
