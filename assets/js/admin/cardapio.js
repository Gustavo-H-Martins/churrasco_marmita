import {
  listarProdutos, salvarProduto, excluirProduto,
  carregarConfig, salvarConfig, definirLojaAberta, sb
} from '../db.js';
import { fmtBRL, esc, fmtDataDia, proximoSabadoISO } from '../format.js';
import { registrarLog } from '../auth.js';

export async function renderCardapio(root, ctx) {
  let produtos;
  let config;
  let aberta;
  let proximaAbertura = null;

  try {
    [produtos, config] = await Promise.all([listarProdutos(), carregarConfig()]);
    // select('*') evita quebrar a tela caso a coluna de agendamento ainda não exista.
    const { data: status, error } = await sb.from('status').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message || String(error));
    aberta = status?.isOpen !== false;
    proximaAbertura = status?.proxima_abertura || null;
  } catch (err) {
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = `Não foi possível carregar o cardápio: ${err.message || err}`;
    root.appendChild(p);
    return;
  }

  config = config || {};

  function textoStatusLoja() {
    if (aberta) return 'Loja aberta para pedidos.';
    return proximaAbertura
      ? `Loja fechada. Pedidos agendados para ${fmtDataDia(proximaAbertura)}.`
      : 'Loja fechada.';
  }

  function pedirDataProxima() {
    const sugestao = proximaAbertura || proximoSabadoISO();
    const entrada = prompt(
      'Data do próximo turno (AAAA-MM-DD ou DD/MM/AAAA):\nPedidos feitos com a loja fechada ficam agendados para esse dia.',
      sugestao
    );
    if (entrada === null) return { cancelado: true };
    const data = normalizarData(entrada);
    if (!data) return { invalido: true };
    return { data };
  }

  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Cardápio e loja</h2>
      <div class="acoes">
        <button type="button" id="definirProxima" class="btn-ghost" ${aberta ? 'hidden' : ''}>Definir próximo turno</button>
        <button type="button" id="toggleLoja" class="btn">${aberta ? 'Fechar loja' : 'Abrir loja'}</button>
      </div>
    </div>
    <p id="lojaStatus" class="dica">${textoStatusLoja()}</p>

    <section class="painel-bairros">
      <div class="painel-topo"><h3>Produtos</h3><button type="button" id="novoProduto" class="btn">+ Novo produto</button></div>
      <div id="produtoMsg" class="msg"></div>
      <div id="produtoFormArea"></div>
      <div id="produtoLista"></div>
    </section>

    <section class="painel-bairros">
      <h3>Configuração da loja</h3>
      <form id="configForm" class="form-grid painel-form">
        <label>Nome<input id="cNome" value="${esc(config.nome_loja || '')}" /></label>
        <label>Descrição<input id="cDesc" value="${esc(config.descricao_loja || '')}" /></label>
        <label>Telefone (só números com DDI)<input id="cTelefone" value="${esc(config.telefone || '')}" /></label>
        <label>Instagram<input id="cInsta" value="${esc(config.instagram || '')}" /></label>
        <label>Endereço<input id="cEndereco" value="${esc(config.endereco || '')}" /></label>
        <label>Banner<input id="cBanner" value="${esc(config.banner || '')}" /></label>
        <label>Logo (URL)<input id="cLogo" value="${esc(config.logo || '')}" /></label>
        <label>Ou enviar logo<input id="cLogoFile" type="file" accept="image/*" /></label>
        <div class="acoes"><button type="submit" class="btn">Salvar configuração</button></div>
        <div id="configMsg" class="msg"></div>
      </form>
      ${ctx.perfil?.papel === 'admin' ? '<button type="button" id="gerenciarCupons" class="btn-ghost">Gerenciar cupons</button>' : ''}
    </section>`;

  const lista = root.querySelector('#produtoLista');
  const formArea = root.querySelector('#produtoFormArea');
  const produtoMsg = root.querySelector('#produtoMsg');
  const lojaStatus = root.querySelector('#lojaStatus');

  function avisoProdutos(texto, tipo = 'erro') {
    produtoMsg.className = tipo ? `msg ${tipo}` : 'msg';
    produtoMsg.textContent = texto;
  }

  function desenhar() {
    const linhas = produtos.length
      ? produtos.map(p => `
              <tr>
                <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.descricao || '')}</small></td>
                <td>${fmtBRL(p.preco)}</td>
                <td>${esc(p.categoria)}</td>
                <td>${p.ativo ? 'Sim' : 'Não'}</td>
                <td class="acoes">
                  <button type="button" class="btn-mini" data-edit="${esc(String(p.id ?? ''))}">Editar</button>
                  <button type="button" class="btn-mini perigo" data-del="${esc(String(p.id ?? ''))}">Excluir</button>
                </td>
              </tr>`).join('')
      : '<tr><td colspan="5">Nenhum produto cadastrado.</td></tr>';

    lista.innerHTML = `
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Produto</th><th>Preço</th><th>Categoria</th><th>Ativo</th><th>Ações</th></tr></thead>
          <tbody>
            ${linhas}
          </tbody>
        </table>
      </div>`;

    lista.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => abrirForm(produtos.find(p => String(p.id) === b.dataset.edit))));
    lista.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => remover(produtos.find(x => String(x.id) === b.dataset.del), b)));
  }

  async function remover(p, botao) {
    if (!p || !confirm(`Excluir ${p.nome}?`)) return;
    botao.disabled = true;
    try {
      await excluirProduto(p.id);
    } catch (err) {
      botao.disabled = false;
      avisoProdutos(`Erro ao excluir: ${err.message || err}`);
      return;
    }
    let logErro = '';
    try {
      await registrarLog('excluir_produto', 'produtos', p.id, { nome: p.nome });
    } catch (err) {
      logErro = `Excluído, mas o log falhou: ${err.message || err}`;
    }
    try {
      produtos = await listarProdutos();
      desenhar();
      if (logErro) avisoProdutos(logErro);
      else avisoProdutos('Produto excluído.', 'ok');
    } catch (err) {
      botao.disabled = false;
      avisoProdutos(`Excluído, mas não foi possível recarregar a lista: ${err.message || err}`);
    }
  }

  function abrirForm(p = {}) {
    formArea.innerHTML = `
      <form id="produtoForm" class="form-grid painel-form">
        <h4>${p.id ? 'Editar' : 'Novo'} produto</h4>
        <label>Nome<input id="pNome" value="${esc(p.nome || '')}" required /></label>
        <label>Preço (R$)<input id="pPreco" type="number" min="0" step="0.01" value="${esc(String(p.preco ?? 0))}" required /></label>
        <label>Descrição<textarea id="pDesc" rows="2">${esc(p.descricao || '')}</textarea></label>
        <label>Categoria<select id="pCat">
          <option value="meal" ${p.categoria === 'meal' ? 'selected' : ''}>Marmita</option>
          <option value="drink" ${p.categoria === 'drink' ? 'selected' : ''}>Bebida</option>
          <option value="dessert" ${p.categoria === 'dessert' ? 'selected' : ''}>Sobremesa</option>
        </select></label>
        <label>Imagem (URL)<input id="pImg" value="${esc(p.imagem || '')}" /></label>
        <label>Ou enviar arquivo<input id="pImgFile" type="file" accept="image/*" /></label>
        <label>Ordem<input id="pOrdem" type="number" value="${esc(String(p.ordem ?? 0))}" /></label>
        <label class="linha-check"><input id="pAtivo" type="checkbox" ${p.ativo !== false ? 'checked' : ''} /> Ativo</label>
        <div id="pErros" class="erro"></div>
        <div class="acoes">
          <button type="submit" class="btn">Salvar</button>
          <button type="button" id="pCancelar" class="btn-ghost">Cancelar</button>
        </div>
      </form>`;

    formArea.querySelector('#pCancelar').addEventListener('click', () => { formArea.innerHTML = ''; });
    formArea.querySelector('#produtoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = formArea.querySelector('#produtoForm button[type="submit"]');
      const erros = formArea.querySelector('#pErros');
      const textoOriginal = botao.textContent;
      erros.textContent = '';
      botao.disabled = true;
      botao.textContent = 'Salvando…';

      let dados;
      try {
        let imagem = formArea.querySelector('#pImg').value.trim();
        const arquivo = formArea.querySelector('#pImgFile').files[0];
        if (arquivo) imagem = await readFileAsDataURL(arquivo);
        dados = {
          id: p.id,
          nome: formArea.querySelector('#pNome').value.trim(),
          preco: Number(formArea.querySelector('#pPreco').value),
          descricao: formArea.querySelector('#pDesc').value.trim(),
          categoria: formArea.querySelector('#pCat').value,
          imagem,
          ordem: Number(formArea.querySelector('#pOrdem').value),
          ativo: formArea.querySelector('#pAtivo').checked
        };
        await salvarProduto(dados);
      } catch (err) {
        erros.textContent = `Erro ao salvar: ${err.message || err}`;
        botao.disabled = false;
        botao.textContent = textoOriginal;
        return;
      }

      let logErro = '';
      try {
        await registrarLog(dados.id ? 'editar_produto' : 'criar_produto', 'produtos', dados.id || null, dados);
      } catch (err) {
        logErro = `Salvo, mas o log falhou: ${err.message || err}`;
      }

      try {
        produtos = await listarProdutos();
        formArea.innerHTML = '';
        desenhar();
        if (logErro) avisoProdutos(logErro);
        else avisoProdutos('Produto salvo.', 'ok');
      } catch (err) {
        formArea.innerHTML = '';
        avisoProdutos(`Salvo, mas não foi possível recarregar a lista: ${err.message || err}`);
      }
    });
  }

  root.querySelector('#novoProduto').addEventListener('click', () => abrirForm());

  const gerenciarCupons = root.querySelector('#gerenciarCupons');
  if (gerenciarCupons) {
    gerenciarCupons.addEventListener('click', () => { location.hash = 'cupons'; });
  }

  root.querySelector('#toggleLoja').addEventListener('click', async () => {
    const botao = root.querySelector('#toggleLoja');
    const novo = !aberta;
    let data = null;

    if (!novo) {
      const escolha = pedirDataProxima();
      if (escolha.cancelado) return;
      if (escolha.invalido) {
        lojaStatus.className = 'msg erro';
        lojaStatus.textContent = 'Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.';
        return;
      }
      data = escolha.data;
    }

    botao.disabled = true;
    try {
      await definirLojaAberta(novo, data);
    } catch (err) {
      lojaStatus.className = 'msg erro';
      lojaStatus.textContent = `Erro ao alterar a loja: ${err.message || err}`;
      botao.disabled = false;
      return;
    }
    aberta = novo;
    proximaAbertura = novo ? null : data;
    botao.textContent = aberta ? 'Fechar loja' : 'Abrir loja';
    const definirBtn = root.querySelector('#definirProxima');
    if(definirBtn) definirBtn.hidden = aberta;
    lojaStatus.className = 'dica';
    lojaStatus.textContent = textoStatusLoja();
    try {
      await registrarLog('alterar_loja', 'status', 1, { aberta, proxima_abertura: proximaAbertura });
    } catch (err) {
      lojaStatus.className = 'msg erro';
      lojaStatus.textContent = `Loja alterada, mas o log falhou: ${err.message || err}`;
    }
    botao.disabled = false;
  });

  const definirProximaBtn = root.querySelector('#definirProxima');
  if(definirProximaBtn){
    definirProximaBtn.addEventListener('click', async () => {
      const escolha = pedirDataProxima();
      if (escolha.cancelado) return;
      if (escolha.invalido) {
        lojaStatus.className = 'msg erro';
        lojaStatus.textContent = 'Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.';
        return;
      }
      definirProximaBtn.disabled = true;
      try {
        await definirLojaAberta(false, escolha.data);
      } catch (err) {
        lojaStatus.className = 'msg erro';
        lojaStatus.textContent = `Erro ao salvar a data: ${err.message || err}`;
        definirProximaBtn.disabled = false;
        return;
      }
      proximaAbertura = escolha.data;
      lojaStatus.className = 'dica';
      lojaStatus.textContent = textoStatusLoja();
      try {
        await registrarLog('alterar_loja', 'status', 1, { aberta: false, proxima_abertura: proximaAbertura });
      } catch (err) {
        lojaStatus.className = 'msg erro';
        lojaStatus.textContent = `Data salva, mas o log falhou: ${err.message || err}`;
      }
      definirProximaBtn.disabled = false;
    });
  }

  root.querySelector('#configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = root.querySelector('#configForm');
    const botao = form.querySelector('button[type="submit"]');
    const msg = root.querySelector('#configMsg');
    const textoOriginal = botao.textContent;
    msg.className = 'msg';
    msg.textContent = '';
    botao.disabled = true;
    botao.textContent = 'Salvando…';

    let patch;
    try {
      let logo = root.querySelector('#cLogo').value.trim();
      const arquivoLogo = root.querySelector('#cLogoFile').files[0];
      if (arquivoLogo) logo = await readFileAsDataURL(arquivoLogo);
      patch = {
        nome_loja: root.querySelector('#cNome').value.trim(),
        descricao_loja: root.querySelector('#cDesc').value.trim(),
        telefone: root.querySelector('#cTelefone').value.replace(/\D/g, ''),
        instagram: root.querySelector('#cInsta').value.trim(),
        endereco: root.querySelector('#cEndereco').value.trim(),
        banner: root.querySelector('#cBanner').value.trim(),
        logo
      };
      await salvarConfig(patch);
    } catch (err) {
      msg.className = 'msg erro';
      msg.textContent = `Erro ao salvar configuração: ${err.message || err}`;
      botao.disabled = false;
      botao.textContent = textoOriginal;
      return;
    }

    msg.className = 'msg ok';
    msg.textContent = 'Configuração salva.';
    try {
      await registrarLog('salvar_config', 'config', 1, patch);
    } catch (err) {
      msg.className = 'msg erro';
      msg.textContent = `Configuração salva, mas o log falhou: ${err.message || err}`;
    }
    botao.disabled = false;
    botao.textContent = textoOriginal;
  });

  desenhar();
}

// Aceita AAAA-MM-DD ou DD/MM/AAAA e devolve AAAA-MM-DD; null se a data não existir.
function normalizarData(entrada) {
  const s = String(entrada || '').trim();
  let y, m, d;
  let mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (mm) {
    [, y, m, d] = mm;
  } else {
    mm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!mm) return null;
    [, d, m, y] = mm;
  }
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(m) - 1 || dt.getDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(file);
  });
}
