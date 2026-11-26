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
  e repassa ao PostgREST com a `SUPABASE_SERVICE_ROLE_KEY` de sempre e o id da pessoa no cabeçalho `x-fe-uid`.
  A função `public.fe_pre_request` (pré-pedido da API do Supabase) troca o pedido para o papel `fe_app` com esse id;
  sem o cabeçalho, nada muda para o resto do Jarvis. Não apague essa função: a API do Supabase a chama em todo pedido.
  O PostgREST do Jarvis devolve no máximo 1000 linhas por pedido e a página lê as tabelas inteiras: a rota busca
  página a página (desempatando pela chave de cada tabela), senão gente sumiria da Programação sem aviso.
  As políticas, travas de mês, permissões por campo e o Histórico continuam no banco e sabem quem é.
  Também faz o que a função de borda `usuarios` fazia (tela Usuários), com as mesmas regras.
- `docs/ferias-banco.sql` — o banco, gerado do `banco/schema.sql` do pacote, com os nomes originais
  (nenhum existia no Jarvis) e estas correções da reconstrução: sequência antes da tabela, chaves estrangeiras
  depois das primárias, `extensions.unaccent`, sem `auth.users`/`auth.uid()` (virou `public.fe_uid()`),
  `fe_app` no lugar de `authenticated`, nada para `anon`/`authenticated`, e `fe_carga()` para a carga.

- `docs/ferias-banco-2.sql` — a fila `demissoes_pendentes` e a `confirmar_demissao()`, que a tela já usava (pílula
  "Demissões a confirmar") mas nunca existiram no banco antigo. Quem some do relatório de ativos entra na fila
  (pela comparação da `regra-ausente-no-relatorio-de-ativos`); só sai da programação quando a dona confirma,
  pelo mesmo `demitir()` de sempre. Também apaga a `fe_carga`.

## O que a plataforma antiga já tinha pela metade (continua igual)

- Aviso "Férias trabalhadas no Sar2G não lançadas": a tela chama `sar2g_pendentes()`, que nunca existiu — ela
  precisa dos lançamentos do Sar2G, que não estão no banco. A seção fica escondida, como antes.
- Dentro do Jarvis a página não consulta o Histórico (atualização sozinha) enquanto a guia está fechada.

## Quem vê e quem edita

Todos do Jarvis veem. Editam só Joyce (Master, dona dos logins), Jussilene e Marcelo (Administrador).
Quem manda nisso é a tabela `usuarios` da plataforma: a Joyce muda pela tela **Usuários → 🔐 Permissões**.
Supervisor (nome igual ao da coluna supervisor) vê só a própria equipe no ASO, como antes.

## Montar (uma vez)

1. Supabase do Jarvis → SQL Editor → colar `docs/ferias-banco.sql` → Run. (Feito em 25/11/2026.)
2. Carga dos dados do pacote (`dados/*.json`) pela `fe_carga` com service_role, funcionários primeiro;
   (feito em 25/11/2026: 13.294 linhas); depois rodar `docs/ferias-banco-2.sql`.
3. Ligar os logins: `usuarios.jarvis_user` = joyce, jussilenealmeida, carlos, amauri (Consulta); Marcelo novo (Administrador).
