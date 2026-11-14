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
