# Edge Function criar-usuario

## Pré-requisitos

- Supabase CLI instalada (`npm i -g supabase`).
- Login feito (`supabase login`).
- Projeto vinculado (`supabase link --project-ref SEU_PROJECT_REF`).

## Deploy

```bash
supabase functions deploy criar-usuario --project-ref SEU_PROJECT_REF
```

A função usa automaticamente `SUPABASE_SERVICE_ROLE_KEY` do ambiente do projeto.
Nunca coloque essa chave no front-end.

## Fallback

Se a função não puder ser publicada, crie usuários em Authentication > Users no
painel do Supabase (com e-mail confirmado) e defina o papel pela aba Segurança.
