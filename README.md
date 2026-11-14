# Churrasco na Marmita

Cardápio público em `index.html` e app administrativo em `admin/`.

## Segurança

- O arquivo `.env` nunca deve ser versionado.
- A senha do portal do iFood que ficou exposta no histórico do repositório deve ser trocada.
- O front-end usa somente a chave publicável do Supabase.
- A service role fica exclusivamente na Edge Function `criar-usuario`.

## Desenvolvimento

```bash
npm test
npm run serve
```

Abra `http://localhost:3000/admin/`. Em localhost, o app usa o projeto Supabase de staging.
