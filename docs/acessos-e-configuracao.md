# Acessos do Jarvis: como está ligado e como configurar um PC novo

Guia para quem vai trabalhar no Jarvis (mudar, testar e publicar) em um computador novo.
Situação conferida em 12/11/2026.

## Como cada parte está ligada

| Parte | Para que serve | Como se acessa |
|---|---|---|
| **GitHub** | Guarda o código. Branch, commit, push e PR. | Conta própria de cada pessoa, convidada na organização `servcamp-inovacao-30anos`. |
| **Vercel** | Publica o sistema. | Não precisa de acesso. A Vercel publica sozinha quando o código chega no GitHub. |
| **Supabase** | Banco de dados do sistema. | Conta própria, convidada na organização do projeto. Para o Claude, um arquivo `.env` com duas chaves. |
| **Jarvis** | O sistema em si. | Usuário e senha do próprio Jarvis. |

### Publicação (Vercel)

- **Prévia:** todo push numa branch gera um endereço de teste. Ele aparece no PR, no item "Vercel".
- **Produção:** quando um PR é juntado ao `main`, o sistema publicado é atualizado.
- As prévias **abrem sem login da Vercel**. Basta entrar com o usuário e a senha do Jarvis.
- O projeto da Vercel fica na conta do João (plano gratuito, uma pessoa só). Mudar variáveis ou configurações na Vercel só é possível pela conta dele.

### Banco de dados (Supabase)

- Projeto: **Projeto de Joãoygor660**, na organização `Joãoygor660`.
- Endereço do projeto: `https://agahqqlhajwhklurcjlc.supabase.co`
- **Criar tabelas:** no site do Supabase, abrir o **Editor SQL**, colar o SQL e clicar em **Run**. O cargo de Desenvolvedor permite.
- O **conector do Supabase no Claude não funciona** com o cargo de Desenvolvedor: autorizar o conector exige Proprietário ou Administrador. Por isso o Claude acessa o banco pelo `.env`.

## Configurar um PC novo

### 1. GitHub

1. Instalar o Git e o GitHub CLI (`gh`).
2. No terminal: `gh auth login`, entrando com a **sua** conta do GitHub.
3. Baixar o projeto: `gh repo clone servcamp-inovacao-30anos/jarvis3`
4. Entrar na pasta e rodar `npm install` e depois `npm test`.

### 2. Acesso do Claude ao banco (`.env`)

1. Na pasta do projeto, criar um arquivo chamado `.env` com duas linhas:

   ```text
   SUPABASE_URL=https://agahqqlhajwhklurcjlc.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=cole_a_chave_aqui
   ```

2. A chave fica no Supabase: **Configurações do projeto**, **Chaves de API**, **Veja as chaves de API legadas**, linha **service_role**, **Revelar**, **Copiar**.
3. Atenção:
   - A URL termina em `.supabase.co`, **sem** `/rest/v1/` no final.
   - Use a **service_role**, não a `anon`.
   - O `.env` já é ignorado pelo git: ele nunca sobe para o GitHub.
4. Teste: peça ao Claude "liste as tabelas do banco". Devem aparecer `fm_faltas` e `pt_contatos`.

### 3. Entrar no sistema

- Abra o endereço de produção ou o endereço de prévia de um PR.
- Entre com o **seu** usuário e senha do Jarvis.

## Regras de segurança

- A chave `service_role` dá **acesso total** ao banco de produção, com dados reais de colaboradores.
  - Nunca cole a chave em conversas, mensagens, prints ou arquivos que vão para o GitHub.
  - Passe a chave por um meio seguro e apague a mensagem depois.
  - Se a chave vazar: gerar uma nova no Supabase e atualizar no `.env` de cada PC e na Vercel (`SUPABASE_SERVICE_ROLE_KEY`).
- Prévias e produção usam o **mesmo banco**. O que for salvo ou apagado numa prévia afeta o sistema em uso.
- Nunca altere o `main` direto: crie uma branch, abra um PR e só junte depois de testar na prévia.

## Problemas conhecidos

| Sintoma | Causa | Solução |
|---|---|---|
| Login numa prévia dá erro | Prévia criada antes de 12/11/2026, sem `SUPABASE_URL` | Fazer um push novo na branch, para gerar outra prévia. |
| Redeploy pela Vercel pede código por e-mail | A conta da Vercel é do João | Fazer um push na branch (pode ser commit vazio) em vez do Redeploy. |
| Conector do Supabase: "Somente proprietários e administradores..." | Cargo de Desenvolvedor | Usar o `.env`, ou pedir ao João o cargo de Administrador. |
| Conector: "Incompatibilidade de conta" | Navegador e aplicativo do Claude em contas diferentes | Entrar no navegador com a mesma conta do Claude do aplicativo. |
