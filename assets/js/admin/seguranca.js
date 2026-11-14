import { ehAdmin, registrarLog } from '../auth.js';
import { sb } from '../db.js';
import { esc } from '../format.js';
import { renderLogs } from './logs.js';
import { renderUsuarios } from './usuarios.js';

const SUBABAS = [
  { id: 'perfil', rotulo: 'Meu perfil' },
  { id: 'usuarios', rotulo: 'Usuários', admin: true },
  { id: 'logs', rotulo: 'Auditoria', admin: true }
];

export async function renderSeguranca(root, ctx) {
  const admin = ehAdmin(ctx.perfil);
  const visiveis = SUBABAS.filter(s => !s.admin || admin);
  const alvo = location.hash.split('/')[1] || 'perfil';

  root.innerHTML = `
    <h2>Segurança</h2>
    <nav class="subabas">
      ${visiveis.map(s => `<button type="button" class="subaba ${s.id === alvo ? 'ativo' : ''}" data-sub="${s.id}">${s.rotulo}</button>`).join('')}
    </nav>
    <div id="subRoot"></div>`;

  const subRoot = root.querySelector('#subRoot');

  async function abrir(id) {
    root.querySelectorAll('.subaba').forEach(b => b.classList.toggle('ativo', b.dataset.sub === id));
    if (id === 'usuarios' && admin) return renderUsuarios(subRoot, ctx);
    if (id === 'logs' && admin) return renderLogs(subRoot, ctx);
    return renderPerfil(subRoot, ctx);
  }

  root.querySelectorAll('.subaba').forEach(b => {
    b.addEventListener('click', () => abrir(b.dataset.sub));
  });

  await abrir(visiveis.some(s => s.id === alvo) ? alvo : 'perfil');
}

async function renderPerfil(root, ctx) {
  const { data: { user } } = await sb.auth.getUser();
  root.innerHTML = `
    <form id="perfilForm" class="form-grid">
      <h3>Meu perfil</h3>
      <label>Nome<input id="perfilNome" value="${esc(ctx.perfil?.nome || '')}" /></label>
      <label>E-mail<input value="${esc(ctx.perfil?.email || user?.email || '')}" disabled /></label>
      <label>Nova senha<input id="perfilSenha" type="password" autocomplete="new-password" placeholder="Deixe em branco para manter" /></label>
      <div class="acoes">
        <button type="submit" class="btn">Salvar</button>
      </div>
      <div id="perfilMsg" class="msg"></div>
    </form>`;

  root.querySelector('#perfilForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = root.querySelector('#perfilMsg');
    try {
      const nome = root.querySelector('#perfilNome').value.trim();
      const senha = root.querySelector('#perfilSenha').value;
      if (!nome && !senha) {
        msg.textContent = 'Nada para salvar.';
        msg.className = 'msg';
        return;
      }
      if (nome) {
        const { error } = await sb.rpc('atualizar_meu_nome', { novo_nome: nome });
        if (error) throw new Error(error.message);
      }
      if (senha) {
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw new Error(error.message);
      }
      await registrarLog('atualizar_perfil', 'perfis', user.id, { nome, trocou_senha: Boolean(senha) });
      msg.textContent = 'Perfil atualizado.';
      msg.className = 'msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'msg erro';
    }
  });
}
