# Programação de Férias (Gestão)

A plataforma de férias que rodava num Supabase próprio, agora dentro do Jarvis, com as mesmas
regras e o mesmo desenho. Origem: pacote de migração de 24/11/2026 (`programacao-ferias-repositorio-25-11.zip`).

## Como está montado

- `ferias.html` — a plataforma inteira, aberta num iframe pela guia **Gestão → Programação de Férias**.
  Só mudou o que a ligava ao Supabase antigo: o cliente supabase-js agora fala com `/api/rh?modulo=ferias`
  (o caminho do PostgREST vai no cabeçalho `x-fe-path`), o login é o do Jarvis (`sessionStorage.authToken`),
  sem Trocar senha/Sair/Novo login, e sem as letras do Google (o CSP bloqueia; a Inter embutida cobre).
  O "quem mais está na tela" (Realtime) virou: a atualização sozinha olha só o Histórico.
- `api/_ferias.js` — descobre quem é o login do Jarvis em `usuarios.jarvis_user` (primeira vez: Consulta),
  e repassa ao PostgREST com um token do papel `fe_app` e o id da pessoa, assinado com `SUPABASE_JWT_SECRET`.
  As políticas, travas de mês, permissões por campo e o Histórico continuam no banco e sabem quem é.
  Também faz o que a função de borda `usuarios` fazia (tela Usuários), com as mesmas regras.
- `docs/ferias-banco.sql` — o banco, gerado do `banco/schema.sql` do pacote, com os nomes originais
  (nenhum existia no Jarvis) e estas correções da reconstrução: sequência antes da tabela, chaves estrangeiras
  depois das primárias, `extensions.unaccent`, sem `auth.users`/`auth.uid()` (virou `public.fe_uid()`),
  `fe_app` no lugar de `authenticated`, nada para `anon`/`authenticated`, e `fe_carga()` para a carga.

## Quem vê e quem edita

Todos do Jarvis veem. Editam só Joyce (Master, dona dos logins), Jussilene e Marcelo (Administrador).
Quem manda nisso é a tabela `usuarios` da plataforma: a Joyce muda pela tela **Usuários → 🔐 Permissões**.
Supervisor (nome igual ao da coluna supervisor) vê só a própria equipe no ASO, como antes.

## Montar (uma vez)

1. Supabase do Jarvis → SQL Editor → colar `docs/ferias-banco.sql` → Run.
2. Vercel → Settings → Environment Variables → `SUPABASE_JWT_SECRET` (Production e Preview) → Redeploy.
3. Carga dos dados do pacote (`dados/*.json`) pela `fe_carga` com service_role, funcionários primeiro;
   depois `drop function public.fe_carga(text, jsonb);`.
4. Ligar os logins: `usuarios.jarvis_user` = joyce, jussilenealmeida, carlos, amauri (Consulta); Marcelo novo (Administrador).
