import { listarPerfis, atualizarPerfil, sb } from '../db.js';
import { esc } from '../format.js';
import { ehAdmin, registrarLog } from '../auth.js';

const PAPEIS = ['admin', 'operador', 'pendente'];

async function mensagemDeErro(error, data) {
  if (data?.error) return String(data.error);

  const resposta = error?.context;
  let detalhe = '';
  if (resposta && typeof resposta.clone === 'function') {
    try {
      const corpo = await resposta.clone().json();
      if (corpo?.error) detalhe = String(corpo.error);
    } catch {
      // Corpo não é JSON ou já foi consumido.
    }
  }

  if (resposta?.status === 404) {
    return 'A Edge Function "criar-usuario" ainda não foi publicada. '
      + 'Publique com "supabase functions deploy criar-usuario" ou crie o usuário em '
      + 'Authentication > Users no painel do Supabase (com e-mail confirmado) e defina o papel aqui.';
  }
  if (detalhe) return detalhe;
  if (error?.name === 'FunctionsFetchError' || !resposta) {
    return 'Não foi possível chamar a Edge Function "criar-usuario". '
      + 'Confirme se ela está publicada ("supabase functions deploy criar-usuario") ou crie o usuário em '
      + 'Authentication > Users no painel do Supabase (com e-mail confirmado) e defina o papel aqui.';
  }
  return error?.message || 'Não foi possível criar o usuário.';
}

export async function renderUsuarios(root, ctx) {
  if (!ehAdmin(ctx.perfil)) {
    root.innerHTML = '<p class="erro">Apenas administradores gerenciam usuários.</p>';
    return;
  }

  root.innerHTML = `
    <section class="painel-bairros">
      <div class="painel-topo">
        <h3>Usuários</h3>
        <button type="button" id="novoUsuarioBtn" class="btn">+ Novo usuário</button>
      </div>
      <div id="usuarioMsg" class="msg"></div>
      <div id="usuarioFormArea"></div>
      <div id="usuarioLista"><p class="dica">Carregando usuários…</p></div>
    </section>`;

  const lista = root.querySelector('#usuarioLista');
  const formArea = root.querySelector('#usuarioFormArea');
  const msg = root.querySelector('#usuarioMsg');

  function aviso(texto) {
    msg.className = 'msg erro';
    msg.textContent = texto;
  }

  function limparMsg() {
    msg.className = 'msg';
    msg.textContent = '';
  }

  function euMesmo(p) {
    return String(p.id) === String(ctx.perfil?.id);
  }

  let perfis = [];
  try {
    perfis = await listarPerfis();
  } catch (err) {
    lista.innerHTML = '';
    aviso(`Não foi possível carregar os usuários: ${err.message || err}`);
    return;
  }

  async function recarregar() {
    try {
      perfis = await listarPerfis();
    } catch (err) {
      aviso(`Não foi possível recarregar a lista: ${err.message || err}`);
    }
    desenhar();
  }

  function desenhar() {
    const linhas = perfis.length
      ? perfis.map(p => `
              <tr>
                <td><strong>${esc(p.nome || '—')}</strong></td>
                <td>${esc(p.email || '—')}</td>
                <td>
                  <select data-papel="${esc(String(p.id ?? ''))}" ${euMesmo(p) ? 'disabled' : ''}>
                    ${PAPEIS.map(papel => `<option value="${papel}" ${p.papel === papel ? 'selected' : ''}>${papel}</option>`).join('')}
                  </select>
                </td>
                <td>${p.ativo ? 'Sim' : 'Não'}</td>
                <td>
                  ${euMesmo(p)
                    ? '<span class="dica">Você</span>'
                    : `<button type="button" class="btn-mini${p.ativo ? ' perigo' : ''}" data-toggle="${esc(String(p.id ?? ''))}">${p.ativo ? 'Desativar' : 'Ativar'}</button>`}
                </td>
              </tr>`).join('')
      : '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-papel]').forEach(sel => {
      sel.addEventListener('change', async () => {
        if (sel.disabled) return;
        const p = perfis.find(x => String(x.id) === sel.dataset.papel);
        if (!p || sel.value === p.papel) return;

        const papel = sel.value;
        sel.disabled = true;
        limparMsg();
        try {
          await atualizarPerfil(p.id, { papel });
        } catch (err) {
          aviso(`Não foi possível alterar o papel: ${err.message || err}`);
          desenhar();
          return;
        }

        try {
          await registrarLog('alterar_papel', 'perfis', p.id, { de: p.papel, para: papel });
        } catch (err) {
          aviso(`Papel alterado, mas o log falhou: ${err.message || err}`);
        }

        await recarregar();
      });
    });

    lista.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const p = perfis.find(x => String(x.id) === btn.dataset.toggle);
        if (!p || euMesmo(p)) return;

        const ativo = !p.ativo;
        if (!ativo && !confirm(`Desativar o acesso de ${p.nome || p.email || 'este usuário'}?`)) return;

        btn.disabled = true;
        limparMsg();
        try {
          await atualizarPerfil(p.id, { ativo });
        } catch (err) {
          btn.disabled = false;
          aviso(`Não foi possível ${ativo ? 'ativar' : 'desativar'} o usuário: ${err.message || err}`);
          return;
        }

        try {
          await registrarLog(ativo ? 'ativar_usuario' : 'desativar_usuario', 'perfis', p.id, { email: p.email });
        } catch (err) {
          aviso(`Usuário ${ativo ? 'ativado' : 'desativado'}, mas o log falhou: ${err.message || err}`);
        }

        await recarregar();
      });
    });
  }

  function abrirForm() {
    formArea.innerHTML = `
      <form id="usuarioForm" class="form-grid painel-form">
        <h4>Novo usuário</h4>
        <label>Nome<input id="uNome" autocomplete="off" required /></label>
        <label>E-mail<input id="uEmail" type="email" autocomplete="off" required /></label>
        <label>Senha inicial<input id="uSenha" type="password" minlength="8" autocomplete="new-password" required /></label>
        <label>Papel
          <select id="uPapel">
            <option value="operador">operador</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <div id="uErro" class="msg erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Criar usuário</button>
          <button type="button" id="uCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    const form = formArea.querySelector('#usuarioForm');
    const erroEl = formArea.querySelector('#uErro');
    const botao = form.querySelector('button[type="submit"]');

    formArea.querySelector('#uCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erroEl.textContent = '';
      limparMsg();

      const body = {
        nome: formArea.querySelector('#uNome').value.trim(),
        email: formArea.querySelector('#uEmail').value.trim(),
        senha: formArea.querySelector('#uSenha').value,
        papel: formArea.querySelector('#uPapel').value
      };

      if (!body.nome) { erroEl.textContent = 'Informe o nome.'; return; }
      if (!body.email) { erroEl.textContent = 'Informe o e-mail.'; return; }
      if (body.senha.length < 8) { erroEl.textContent = 'A senha deve ter ao menos 8 caracteres.'; return; }
      if (!['admin', 'operador'].includes(body.papel)) { erroEl.textContent = 'Papel inválido.'; return; }

      botao.disabled = true;
      try {
        const { data, error } = await sb.functions.invoke('criar-usuario', { body });
        if (error || data?.error) {
          erroEl.textContent = await mensagemDeErro(error, data);
          return;
        }

        formArea.innerHTML = '';
        msg.className = 'msg ok';
        msg.textContent = 'Usuário criado.';
        await recarregar();
      } catch (err) {
        erroEl.textContent = await mensagemDeErro(err, null);
      } finally {
        botao.disabled = false;
      }
    });
  }

  root.querySelector('#novoUsuarioBtn').addEventListener('click', abrirForm);
  desenhar();
}
