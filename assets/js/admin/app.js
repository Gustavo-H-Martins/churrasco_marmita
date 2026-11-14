import { IS_STAGING } from '../config.js';
import { entrar, sair, getPerfil, ehAdmin, ehEquipe, registrarLog } from '../auth.js';
import { sb } from '../db.js';
import { renderPedidos } from './pedidos.js';
import { renderMotoboys } from './motoboys.js';
import { renderFinanceiro } from './financeiro.js';
import { renderCardapio } from './cardapio.js';
import { renderCupons } from './cupons.js';
import { renderSeguranca } from './seguranca.js';

const TABS = [
  { id: 'pedidos', rotulo: 'Pedidos', render: renderPedidos, acesso: ehEquipe },
  { id: 'motoboys', rotulo: 'Motoboys', render: renderMotoboys, acesso: ehEquipe },
  { id: 'financeiro', rotulo: 'Financeiro', render: renderFinanceiro, acesso: ehAdmin },
  { id: 'cardapio', rotulo: 'Cardápio/Loja', render: renderCardapio, acesso: ehEquipe },
  { id: 'cupons', rotulo: 'Cupons', render: renderCupons, acesso: ehAdmin },
  { id: 'seguranca', rotulo: 'Segurança', render: renderSeguranca, acesso: ehEquipe }
];

let perfil = null;
let limparAba = null;

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const tabRoot = document.getElementById('tabRoot');
const tabsEl = document.getElementById('tabs');

function mostrarLogin(erro = '') {
  loginView.hidden = false;
  appView.hidden = true;
  document.getElementById('loginErro').textContent = erro;
}

async function iniciar() {
  document.getElementById('stagingBadge').hidden = !IS_STAGING;
  loginView.hidden = false;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  try {
    perfil = await getPerfil();
  } catch (e) {
    perfil = null;
  }
  if (!perfil || perfil.ativo === false || perfil.papel === 'pendente') {
    await sair();
    mostrarLogin('Seu acesso ainda não foi liberado por um administrador.');
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  document.getElementById('usuarioInfo').textContent = `${perfil.nome || perfil.email || '—'} · ${perfil.papel}`;

  const visiveis = TABS.filter(t => t.acesso(perfil));
  tabsEl.innerHTML = visiveis.map(t =>
    `<button type="button" class="tab" data-tab="${t.id}">${t.rotulo}</button>`
  ).join('');
  tabsEl.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.tab; });
  });

  const alvo = location.hash.replace('#', '') || 'pedidos';
  await abrirAba(visiveis.some(t => t.id === alvo) ? alvo : 'pedidos');
}

function pararAba() {
  if (typeof limparAba === 'function') limparAba();
  limparAba = null;
}

async function abrirAba(id) {
  const tab = TABS.find(t => t.id === id && t.acesso(perfil));
  if (!tab) return;
  pararAba();
  tabsEl.querySelectorAll('.tab').forEach(b => b.classList.toggle('ativo', b.dataset.tab === id));
  tabRoot.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    limparAba = await tab.render(tabRoot, { perfil }) || null;
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = `Erro ao carregar: ${e.message}`;
    tabRoot.replaceChildren(p);
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('loginErro').textContent = '';
  try {
    await entrar(
      document.getElementById('loginEmail').value.trim(),
      document.getElementById('loginSenha').value
    );
    await iniciar();
    await registrarLog('login', 'auth', null, {
      email: document.getElementById('loginEmail').value.trim()
    });
  } catch (err) {
    document.getElementById('loginErro').textContent = err.message;
  }
});

document.getElementById('sairBtn').addEventListener('click', async () => {
  pararAba();
  await registrarLog('logout', 'auth', null, { email: perfil?.email });
  await sair();
  perfil = null;
  document.getElementById('loginSenha').value = '';
  mostrarLogin();
});

window.addEventListener('hashchange', () => {
  if (perfil) abrirAba(location.hash.replace('#', '') || 'pedidos');
});

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { pararAba(); perfil = null; document.getElementById('loginSenha').value = ''; mostrarLogin(); }
});

iniciar();
