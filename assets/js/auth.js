import { sb } from './db.js';

export async function entrar(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message);
  return data;
}

export async function sair() {
  await sb.auth.signOut();
}

export async function getPerfil() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('perfis').select('*').eq('id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function ehAdmin(perfil) {
  return perfil?.papel === 'admin' && perfil?.ativo !== false;
}

export function ehEquipe(perfil) {
  return ['admin', 'operador'].includes(perfil?.papel) && perfil?.ativo !== false;
}

export async function registrarLog(acao, entidade = null, entidadeId = null, detalhe = null) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('logs').insert({
    user_id: user.id,
    user_email: user.email,
    acao,
    entidade,
    entidade_id: entidadeId == null ? null : String(entidadeId),
    detalhe
  });
}
