const TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2
});

const dataFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric'
});

const horaFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit'
});

export function fmtBRL(v) {
  return brl.format(Number(v || 0));
}

export function parseBRL(texto) {
  if (typeof texto === 'number') return texto;
  const s = String(texto || '').trim();
  if (!s) return 0;
  if (s.includes(',')) {
    const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function fmtData(iso) {
  if (!iso) return '—';
  return dataFmt.format(new Date(iso));
}

export function fmtDataHora(iso) {
  if (!iso) return '—';
  return `${fmtData(iso)} ${horaFmt.format(new Date(iso))}`;
}

// Datas "só dia" (YYYY-MM-DD) não devem passar pelo fuso: new Date('2026-11-21')
// vira meia-noite UTC e, em São Paulo, apareceria como 20/11.
export function fmtDataDia(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return fmtData(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Próximo sábado no fuso local. Se hoje já é sábado, devolve o sábado seguinte.
export function proximoSabadoISO(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const diff = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

// Link universal do Google Maps para o motoboy abrir o endereço no GPS.
export function linkMapa(endereco, bairro, cidade = 'Lagoa Santa - MG') {
  if (/retirada/i.test(String(bairro || ''))) return null;
  const base = [endereco, bairro]
    .map(p => String(p || '').trim())
    .filter(Boolean);
  if (!base.length) return null;
  const partes = [...base, String(cidade || '').trim()].filter(Boolean);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes.join(', '))}`;
}

export function dataBR(iso) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const get = (tipo) => partes.find(p => p.type === tipo)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function hojeBR() {
  return dataBR(new Date().toISOString());
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
