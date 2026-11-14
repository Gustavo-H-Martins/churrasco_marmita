const host = location.hostname;
export const IS_STAGING = host === 'localhost' || host === '127.0.0.1';

// Preencha com os dados do projeto Supabase de staging.
// São chaves publicáveis; nunca coloque a service role aqui.
const STAGING = {
  url: 'https://SEU-PROJETO-STAGING.supabase.co',
  key: 'SUA_CHAVE_PUBLICAVEL_DE_STAGING'
};

const PRODUCTION = {
  url: 'https://eszmbpviuhkrmwhemhqn.supabase.co',
  key: 'sb_publishable_ObR_oZX8pJ6dzG69nztXjg_xH3NZSpr'
};

export const SUPABASE = IS_STAGING ? STAGING : PRODUCTION;
export const TZ = 'America/Sao_Paulo';
export const LOJA_FALLBACK = {
  nome: 'Churrasco na Marmita',
  descricao: 'Cardápio digital com pedido rápido no WhatsApp.',
  telefone: '553193817229',
  endereco: 'Rua das Seringueiras Nº 26, Bairro das Acácias, Lagoa Santa',
  instagram: 'https://www.instagram.com/churrasco_marmita/',
  logo: 'images/logo.png',
  banner: 'Bem vindo ao Churrasco na Marmita Lagoa Santa - MG'
};
