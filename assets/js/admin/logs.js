import { listarLogs } from '../db.js';
import { fmtDataHora, esc } from '../format.js';

export async function renderLogs(root, ctx) {
  if (ctx.perfil?.papel !== 'admin') {
    root.innerHTML = '<p class="erro">Apenas administradores podem ver a auditoria.</p>';
    return;
  }
  root.innerHTML = '<p class="carregando">Carregando auditoria…</p>';
  const logs = await listarLogs({ limite: 200 });
  root.innerHTML = `
    <h2>Auditoria</h2>
    <p class="dica">Últimos 200 eventos registrados.</p>
    <div class="tabela-wrap">
      <table>
        <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhe</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td>${fmtDataHora(l.criado_em)}</td>
              <td>${esc(l.user_email || '—')}</td>
              <td><strong>${esc(l.acao)}</strong></td>
              <td>${esc(l.entidade || '—')}${l.entidade_id ? ' #' + esc(l.entidade_id) : ''}</td>
              <td><code>${esc(JSON.stringify(l.detalhe || {}))}</code></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
