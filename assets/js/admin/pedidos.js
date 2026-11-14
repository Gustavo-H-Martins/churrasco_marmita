import { renderBairros } from './bairros.js';

export async function renderPedidos(root, ctx) {
  root.innerHTML = `
    <div class="barra-pedidos">
      <h2>Pedidos</h2>
      <button type="button" id="toggleBairros" class="btn-ghost">Bairros e taxas</button>
    </div>
    <div id="bairrosArea" hidden></div>
    <div id="kanbanArea"><p class="carregando">Carregando pedidos…</p></div>`;

  const area = root.querySelector('#bairrosArea');
  root.querySelector('#toggleBairros').addEventListener('click', async () => {
    area.hidden = !area.hidden;
    if (!area.hidden) {
      await renderBairros(area, ctx);
    }
  });
}
