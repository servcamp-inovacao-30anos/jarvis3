// Programação de Férias (Gestão): a rota que liga a plataforma ao banco do Jarvis (api/_ferias.js),
// a página (ferias.html), o banco (docs/ferias-banco.sql) e a ligação com o index.html.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { supabaseFalso, chamar } = require("./_supabase_falso");

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-servico";
process.env.AUTH_SECRET = "segredo-de-teste";
const rh = require("../api/rh");

const JOYCE = "330601ad-3078-4028-a72b-4a22df36c23d", AMAURI = "2613e9d2-99f3-4923-bff1-96e90563008c";
function base() {
  return {
    usuarios: [
      { id: JOYCE, nome: "Joyce Beatriz", papel: "master", ativo: true, dono: true, financeiro: true, permissoes: {}, jarvis_user: "joyce", email: "dp@x" },
      { id: AMAURI, nome: "Amauri Munhoz", papel: "consulta", ativo: true, dono: false, financeiro: false, permissoes: { abas: ["programacao"], acoes: [], campos: [] }, jarvis_user: "amauri" }
    ],
    app_users: [{ user_key: "rosanacristina", nome: "Rosana Cristina", ativo: true }],
    vw_escala: [{ periodo_id: 1, nome: "Fulano" }]
  };
}
// guarda os cabeçalhos que saem para o Supabase
function ambiente(tabelas) {
  const log = supabaseFalso(tabelas);
  const falso = global.fetch, cabs = [];
  global.fetch = (u, i) => { cabs.push({ url: String(u), h: (i && i.headers) || {} }); return falso(u, i); };
  return { log, cabs, tabelas };
}
const pede = (usuario, o = {}) => chamar(rh, { usuario, query: { modulo: "ferias", ...(o.query || {}) }, method: o.method || "GET", body: o.body, headers: o.headers || {} });
const uidDe = h => h["x-fe-uid"];

test("sem login do Jarvis não entra", async () => {
  ambiente(base());
  const r = await chamar(rh, { query: { modulo: "ferias", t: "eu" } });
  assert.strictEqual(r.statusCode, 401);
});

test("t=eu: quem já está ligado recebe o próprio id; quem é novo entra como Consulta, uma vez só", async () => {
  const a = ambiente(base());
  const r = await pede("joyce", { query: { t: "eu" } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.uid, JOYCE);

  const n = await pede("rosanacristina", { query: { t: "eu", nome: "Outro Nome" } });
  assert.strictEqual(n.statusCode, 200);
  const nova = a.tabelas.usuarios.find(u => u.jarvis_user === "rosanacristina");
  assert.ok(nova && nova.id === n.body.uid);
  assert.strictEqual(nova.papel, "consulta");
  assert.strictEqual(nova.nome, "Rosana Cristina", "o nome do Jarvis vale mais que o que a página manda");
  assert.deepStrictEqual(nova.permissoes, { abas: ["programacao", "afastados", "aso"], acoes: [], campos: [] });
  await pede("rosanacristina", { query: { t: "eu" } });
  assert.strictEqual(a.tabelas.usuarios.filter(u => u.jarvis_user === "rosanacristina").length, 1);

  await pede("adrianomacedo", { query: { t: "eu", nome: "  Adriano   Macedo " } });
  assert.strictEqual(a.tabelas.usuarios.find(u => u.jarvis_user === "adrianomacedo").nome, "Adriano Macedo", "sem nome no banco, usa o da sessão");
});

test("repassa ao PostgREST com a chave de sempre e o id da pessoa (a página não escolhe o id)", async () => {
  const a = ambiente(base());
  const r = await pede("amauri", { headers: { "x-fe-path": "/rest/v1/vw_escala?select=*&order=nome.asc", prefer: "count=exact", "x-fe-uid": JOYCE } });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(r.body), [{ periodo_id: 1, nome: "Fulano" }]);
  const ida = a.cabs.find(c => c.url.includes("/rest/v1/vw_escala"));
  assert.strictEqual(ida.url, "https://falso.supabase.co/rest/v1/vw_escala?select=*&order=nome.asc");
  assert.strictEqual(ida.h.apikey, "chave-servico");
  assert.strictEqual(ida.h.Authorization, "Bearer chave-servico");
  assert.strictEqual(ida.h.prefer, "count=exact");
  assert.strictEqual(uidDe(ida.h), AMAURI, "o id é o do login do Jarvis, não o que a página mandou");
});

test("SUPABASE_URL com /rest/v1 no fim também funciona", async () => {
  const a = ambiente(base());
  process.env.SUPABASE_URL = "https://falso.supabase.co/rest/v1/";
  try { await pede("joyce", { headers: { "x-fe-path": "/rest/v1/vw_escala?select=*" } }); }
  finally { process.env.SUPABASE_URL = "https://falso.supabase.co"; }
  assert.ok(a.cabs.some(c => c.url === "https://falso.supabase.co/rest/v1/vw_escala?select=*"));
});

test("só passa o que a plataforma usa: backups, lixeira, snapshots e funções de carga ficam de fora", async () => {
  ambiente(base());
  for (const p of ["/rest/v1/snapshots?select=*", "/rest/v1/lixeira_29_09", "/rest/v1/rpc/fe_carga", "/rest/v1/app_users",
                   "/rest/v1/../app_users", "/auth/v1/token", "", "/rest/v1/rpc/tirar_snapshot"]) {
    const r = await pede("joyce", { method: "POST", headers: { "x-fe-path": p } });
    assert.strictEqual(r.statusCode, 404, p);
  }
});

test("Consulta só lê: gravar é recusado aqui mesmo; as funções de leitura passam", async () => {
  const a = ambiente(base());
  const w = await pede("amauri", { method: "PATCH", body: { cobertura: "x" }, headers: { "x-fe-path": "/rest/v1/periodos?id=eq.1" } });
  assert.strictEqual(w.statusCode, 403);
  assert.match(w.body.message, /só de consulta/);
  const d = await pede("amauri", { method: "POST", body: { p_codigo: 1 }, headers: { "x-fe-path": "/rest/v1/rpc/demitir" } });
  assert.strictEqual(d.statusCode, 403);
  assert.ok(!a.log.some(l => l.tabela === "periodos" || l.tabela === "rpc/demitir"), "nada saiu para o banco");
  const s = await pede("amauri", { method: "POST", body: {}, headers: { "x-fe-path": "/rest/v1/rpc/supervisor_do_login" } });
  assert.strictEqual(s.statusCode, 200);
});

test("quem edita grava: o corpo vai como veio", async () => {
  const t = base(); t.periodos = [{ id: 1, cobertura: null }];
  const a = ambiente(t);
  const r = await pede("joyce", { method: "PATCH", body: { cobertura: "Fulano" }, headers: { "x-fe-path": "/rest/v1/periodos?id=eq.1", "content-type": "application/json" } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(a.tabelas.periodos[0].cobertura, "Fulano");
  assert.strictEqual(uidDe(a.cabs.find(c => c.url.includes("periodos")).h), JOYCE);
});

test("tela Usuários: mesmas regras da função de borda; login e senha agora são os do Jarvis", async () => {
  const a = ambiente(base());
  const usu = (u, body) => pede(u, { method: "POST", body, headers: { "x-fe-path": "/functions/v1/usuarios" } });
  const l = await usu("joyce", { acao: "listar" });
  assert.strictEqual(l.statusCode, 200);
  assert.strictEqual(l.body.dono, true);
  assert.strictEqual(l.body.usuarios.find(u => u.id === AMAURI).email, "login do Jarvis: amauri");

  assert.strictEqual((await usu("amauri", { acao: "listar" })).statusCode, 403, "consulta sem a aba Usuários não vê");
  assert.match((await usu("joyce", { acao: "criar", nome: "X", email: "x@x", senha: "12345678" })).body.erro, /logins agora são os do Jarvis/);
  assert.match((await usu("joyce", { acao: "senha", id: AMAURI, senha: "12345678" })).body.erro, /senha agora é a do Jarvis/);

  const p = await usu("joyce", { acao: "permissoes", id: AMAURI, papel: "administrador", financeiro: true,
    permissoes: { abas: ["programacao", "invente"], acoes: ["sar2g"], campos: ["datas"] } });
  assert.strictEqual(p.statusCode, 200);
  const am = a.tabelas.usuarios.find(u => u.id === AMAURI);
  assert.strictEqual(am.papel, "administrador");
  assert.strictEqual(am.financeiro, true);
  assert.deepStrictEqual(am.permissoes, { abas: ["programacao"], acoes: ["sar2g"], campos: ["datas"] }, "só o que o painel conhece");
  const h = a.tabelas.historico.at(-1);
  assert.strictEqual(h.autor_nome, "Joyce Beatriz");
  assert.match(h.valor_novo, /Amauri Munhoz → administrador/);

  assert.strictEqual((await usu("joyce", { acao: "ativo", id: JOYCE, ativo: false })).statusCode, 400, "não se bloqueia");
  assert.strictEqual((await usu("joyce", { acao: "permissoes", id: JOYCE, papel: "consulta" })).statusCode, 400);
});

test("quem gerencia sem ser a dona não mexe em Master nem dá Financeiro", async () => {
  const t = base();
  t.usuarios.push({ id: "g", nome: "Gerente", papel: "administrador", ativo: true, dono: false, financeiro: false,
    permissoes: { abas: ["usuarios"], acoes: ["gerenciar_usuarios"], campos: [] }, jarvis_user: "gerente" });
  const a = ambiente(t);
  const usu = body => pede("gerente", { method: "POST", body, headers: { "x-fe-path": "/functions/v1/usuarios" } });
  assert.strictEqual((await usu({ acao: "ativo", id: JOYCE, ativo: false })).statusCode, 403);
  assert.strictEqual((await usu({ acao: "permissoes", id: AMAURI, papel: "master" })).statusCode, 403);
  const ok = await usu({ acao: "permissoes", id: AMAURI, papel: "administrador", financeiro: true, permissoes: { acoes: ["gerenciar_usuarios"] } });
  assert.strictEqual(ok.statusCode, 200);
  const am = a.tabelas.usuarios.find(u => u.id === AMAURI);
  assert.strictEqual(am.financeiro, false);
  assert.deepStrictEqual(am.permissoes.acoes, [], "gerenciar usuários fica só com a dona");
});

// ── a página ─────────────────────────────────────────────────────────────
const RAIZ = path.join(__dirname, "..");
const PAGINA = fs.readFileSync(path.join(RAIZ, "ferias.html"), "utf8");
test("ferias.html: sem o Supabase antigo, tudo pela API do Jarvis, scripts compilam", () => {
  assert.ok(!PAGINA.includes("tvpygcwrefusaxjhgddt"), "nem endereço nem chave do projeto antigo");
  assert.ok(!/document\.write\([^)]*fonts\.googleapis/.test(PAGINA), "letras de fora o CSP bloqueia");
  assert.ok(PAGINA.includes("global:{ fetch: feFetch }"));
  assert.ok(PAGINA.includes("fetch('/api/rh?modulo=ferias', init)"));
  assert.ok(PAGINA.includes("await feFetch(`${SB_URL}/functions/v1/usuarios`"));
  assert.ok(PAGINA.includes("sessionStorage.getItem('authToken')"));
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(PAGINA))) { if (m[1] && /src=/.test(m[1])) continue; n++; new vm.Script(m[2]); }
  assert.ok(n > 10);
});

// ── o banco ──────────────────────────────────────────────────────────────
const SQL = fs.readFileSync(path.join(RAIZ, "docs", "ferias-banco.sql"), "utf8");
test("docs/ferias-banco.sql: papel próprio, nada para anon/authenticated, tudo ou nada", () => {
  assert.match(SQL, /^begin;$/m);
  assert.match(SQL, /^commit;$/m);
  assert.ok(!/ TO authenticated\b/.test(SQL), "um login do Supabase Auth no Jarvis não herda nada");
  assert.ok(!/auth\.uid\(\)/.test(SQL.replace(/--[^\n]*/g, "")), "sem depender do schema auth");
  assert.ok(!/REFERENCES auth\.users/.test(SQL));
  assert.match(SQL, /CREATE POLICY "periodos_master_escreve" ON public\.periodos AS PERMISSIVE FOR ALL TO fe_app/);
  assert.match(SQL, /current_user = 'fe_app' and public\.papel_atual\(\) = 'administrador'/);
  assert.match(SQL, /alter table public\.usuarios add column jarvis_user text unique;/);
  assert.match(SQL, /revoke all on public\.afastamentos, .*public\.vw_escala.* from anon, authenticated;/);
  assert.match(SQL, /grant fe_app to service_role;/);
  assert.ok(!/grant fe_app to authenticator/.test(SQL), "ninguém troca de papel por token: só a pré-pedido");
  assert.match(SQL, /if current_user <> 'service_role' then return; end if;/, "só a chave do servidor troca de papel");
  assert.match(SQL, /alter role authenticator set pgrst\.db_pre_request to 'public\.fe_pre_request';/);
  assert.match(SQL, /like 'pgrst\.db_pre_request=%'/, "não passa por cima de outra pré-pedido");
  assert.match(SQL, /grant execute on function public\.fe_carga\(text, jsonb\) to service_role;/);
  assert.ok(SQL.indexOf("CREATE SEQUENCE IF NOT EXISTS public.folha_13_import_id_seq") < SQL.indexOf("CREATE TABLE IF NOT EXISTS public.folha_13_import"));
  assert.ok(SQL.indexOf("afastamentos_funcionario_id_fkey") > SQL.indexOf("funcionarios_pkey PRIMARY KEY"));
});

// ── ligação com o index.html ─────────────────────────────────────────────
const HTML = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
test("index.html: guia em Gestão para todos, página com a plataforma, carrega só ao abrir", () => {
  assert.ok(HTML.includes(`<div class="ni" data-pg="ferias" onclick="navTo('ferias',this)">`), "sem data-perm: todos veem");
  assert.ok(HTML.includes('<div class="page" id="pg-ferias">'));
  assert.ok(HTML.includes('<iframe id="fe-frame" title="Programação de Férias" allow="fullscreen"></iframe>'));
  assert.ok(HTML.includes('else if(p==="ferias"){const f=document.getElementById("fe-frame");if(f&&!f.getAttribute("src"))f.setAttribute("src","/ferias.html");}'));
  assert.ok(HTML.includes('ferias:"Programação de Férias"'));
  assert.ok(HTML.includes('fb.style.display=rel||lig||p==="ferias"?"none":""'));
  assert.ok(HTML.indexOf('data-pg="ferias"') > HTML.indexOf('data-cat="gestao"') && HTML.indexOf('data-pg="ferias"') < HTML.indexOf('data-cat="rh"'), "dentro de Gestão");
});

test("service worker: a página no iframe não vira a cópia offline do painel", () => {
  const sw = fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8");
  assert.ok(sw.includes('if (req.mode === "navigate" && req.destination !== "iframe") {'));
});
