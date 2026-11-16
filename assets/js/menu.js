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

function reportHeight(){
  if (typeof _reportHeight === 'function') _reportHeight();
}

function showStatus(msg){
  statusEl.textContent = msg;
  statusEl.className = 'status error';
  reportHeight();
}
function clearStatus(){
  statusEl.textContent = '';
  statusEl.className = 'status';
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
  render();
}

function renderProducts(){
  productsEl.innerHTML = products.map(p => `
    <div class="product">
      <div class="thumb ${esc(p.cls)}"><img src="${esc(p.img)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" /></div>
      <div>
        <h3>${esc(p.name)}</h3>
        <p class="desc">${esc(p.desc)}</p>
        <div class="row">
          <div class="price">${esc(fmtBRL(p.price))}</div>
          <div class="qty">
            <button aria-label="Diminuir ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="-1">−</button>
            <div class="qty-value">${cart[p.id]}</div>
            <button aria-label="Adicionar ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="1">+</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  productsEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => updateQty(btn.dataset.id, Number(btn.dataset.delta)));
  });
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
    cartListEl.innerHTML = '<div class="empty">Seu carrinho está vazio. Escolha os itens e finalize em segundos.</div>';
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
  const agendaNotice = document.getElementById('agendaNotice');
  if(agendaNotice){
    agendaNotice.textContent = (!isOpen && proximaAbertura)
      ? `Este pedido será agendado para ${fmtDataDia(proximaAbertura)}.`
      : '';
    agendaNotice.style.display = (!isOpen && proximaAbertura) ? '' : 'none';
  }
  renderProducts();
  renderCart();
  reportHeight();
}

function setDeliveryMode(mode){
  deliveryMode = mode;
  document.getElementById('deliveryBtn').classList.toggle('active', mode === 'entrega');
  document.getElementById('pickupBtn').classList.toggle('active', mode === 'retirada');
  const fields = document.getElementById('deliveryFields');
  if(fields) fields.style.display = (mode === 'entrega') ? '' : 'none';
  render();
}

let pendingOrder = null;

document.getElementById('finishBtn').addEventListener('click', () => {
  clearStatus();
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const address = document.getElementById('address').value.trim();
  const isRetirada = deliveryMode === 'retirada';
  const neighborhoodEl = document.getElementById('neighborhood');
  const neighborhood = isRetirada ? 'Retirada no local' : neighborhoodEl.value;
  const paymentEl = document.getElementById('payment');
  const payment = paymentEl.value;
  const observacao = document.getElementById('obs').value.trim();
  const selected = products.filter(p => cart[p.id] > 0);

  if(!name) return showStatus('Preencha o nome do cliente.');
  if(!phone) return showStatus('Preencha o telefone do cliente.');
  if(!isRetirada && !neighborhood) return showStatus('Selecione o bairro para calcular o frete.');
  if(!payment) return showStatus('Selecione a forma de pagamento.');
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
      <span><strong>${esc(p.name)}</strong><br /><small style="color:var(--color-text-tertiary)">${esc(fmtBRL(p.price))}</small></span>
      <div class="qty">
        <button aria-label="Diminuir ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="-1">−</button>
        <strong>${drinkCart[p.id]}</strong>
        <button aria-label="Adicionar ${esc(p.name)}" data-id="${esc(p.id)}" data-delta="1">+</button>
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
  render();
}

document.getElementById('drinkNoBtn').addEventListener('click', () => finalizeOrder([]));
document.getElementById('drinkYesBtn').addEventListener('click', () => {
  const drinks = products.filter(p => p.cls === 'drink');
  finalizeOrder(drinks.map(p => ({ product: p, qty: drinkCart[p.id] || 0 })));
});

document.getElementById('neighborhood').addEventListener('change', () => render());
document.getElementById('applyCoupon').addEventListener('click', applyCoupon);
document.getElementById('deliveryBtn').addEventListener('click', () => setDeliveryMode('entrega'));
document.getElementById('pickupBtn').addEventListener('click', () => setDeliveryMode('retirada'));

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
  const banner = document.querySelector('.welcome-banner');
  if(banner) banner.textContent = storeConfig.banner;
  const h1 = document.querySelector('.hero .brand h1');
  if(h1) h1.textContent = storeConfig.nome;
  const p = document.querySelector('.hero .brand p');
  if(p) p.textContent = storeConfig.descricao;
  const logoImg = document.querySelector('.hero .brand .logo img');
  if(logoImg) logoImg.src = storeConfig.logo;
  const waLink = document.querySelector('.hero .chips a[href*="wa.me"]');
  if(waLink){ waLink.href = 'https://wa.me/' + storeConfig.telefone; waLink.textContent = formatPhone(storeConfig.telefone); }
  const instaLink = document.querySelector('.hero .chips a[href*="instagram"]');
  if(instaLink) instaLink.href = storeConfig.instagram;
  const addrChip = document.querySelector('.hero .chips span.chip');
  if(addrChip) addrChip.textContent = storeConfig.endereco;
  document.title = storeConfig.nome;
}

function formatPhone(num){
  const d = String(num).replace(/\D/g,'');
  if(d.length === 13) return '+'+d.slice(0,2)+' ('+d.slice(2,4)+') '+d.slice(4,9)+'-'+d.slice(9);
  if(d.length === 12) return '+'+d.slice(0,2)+' ('+d.slice(2,4)+') '+d.slice(4,8)+'-'+d.slice(8);
  return '+'+d;
}

// ── Inicialização assíncrona ───────────────────────────────────────
(async function(){
  await Promise.all([loadProductsFromDB(), loadConfigFromDB()]);
  rebuildCart();
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
