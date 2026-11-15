import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')!;

  const chamador = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user } } = await chamador.auth.getUser();
  if (!user) return json({ error: 'Não autenticado.' }, 401);

  const admin = createClient(url, service);
  const { data: perfil } = await admin.from('perfis')
    .select('papel, ativo').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.ativo || perfil.papel !== 'admin') {
    return json({ error: 'Sem permissão para criar usuários.' }, 403);
  }

  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }

  const { email, senha, nome, papel } = corpo;
  if (!email || !senha) return json({ error: 'Informe e-mail e senha.' }, 400);
  if (!['admin', 'operador'].includes(papel)) return json({ error: 'Papel inválido.' }, 400);
  if (String(senha).length < 8) return json({ error: 'A senha deve ter ao menos 8 caracteres.' }, 400);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome: nome || email }
  });
  if (error) return json({ error: error.message }, 400);

  const { error: erroPerfil } = await admin.from('perfis').upsert({
    id: data.user.id,
    nome: nome || email,
    email,
    papel,
    ativo: true
  });
  if (erroPerfil) return json({ error: erroPerfil.message }, 500);

  const { error: logError } = await admin.from('logs').insert({
    user_id: user.id,
    user_email: user.email,
    acao: 'criar_usuario',
    entidade: 'perfis',
    entidade_id: data.user.id,
    detalhe: { email, papel }
  });
  if (logError) console.error('log criar_usuario:', logError.message);

  return json({ id: data.user.id });
});
