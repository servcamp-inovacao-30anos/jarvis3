// Testes de api/users.js: login, troca de senha e o que NUNCA pode sair da API.
// Rodar com:  npm test   (ou  node --test test/)
// Só o runner nativo do Node e um Supabase falso em memória (test/supabase_falso.js):
// nenhuma dependência nova, nada toca o banco real.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const _auth = require("../api/_auth");
const _senha = require("../api/_senha");
const handler = require("../api/users");
const { SupabaseFalso } = require("./supabase_falso");

const BASE = "https://falso.supabase.co";
const SEGREDO = "segredo-so-de-teste";
const PADRAO = "padrao-de-teste-2026";
const fetchReal = global.fetch;
let sb, hashPadrao;

// Chama a função como a Vercel chamaria: req.query e req.body já prontos.
async function chamar(method, { query = {}, body, token } = {}) {
  const req = { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} };
  let status = 200, dados;
  const res = {
    status(s) { status = s; return this; },
    json(d) { dados = d; return this; },
    setHeader() {}
  };
  await handler(req, res);
  return { status, dados };
}
const entrar = (userKey, password) => chamar("POST", { body: { action: "authenticate", userKey, password } });
const trocar = (userKey, currentPassword, newPassword) =>
  chamar("POST", { body: { action: "change_password", userKey, currentPassword, newPassword } });

test.before(async () => { hashPadrao = await _senha.hash(PADRAO); });
test.beforeEach(() => {
  sb = new SupabaseFalso(BASE);
  global.fetch = sb.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
  process.env.AUTH_SECRET = SEGREDO;
  process.env.DEFAULT_PASSWORD_HASH = hashPadrao;
  delete process.env.AUTH_ENFORCE;
});
test.after(() => { global.fetch = fetchReal; });

test("item 1: GET ?userKey devolve só has_custom e must_change, nunca a senha", async () => {
  sb.semear("raphaelvictor", { custom_password: "texto-claro-antigo", must_change: false });
  sb.semear("joaoygor", { custom_password: await _senha.hash("outra-senha-1"), must_change: false });
  const casos = [
    ["raphaelvictor", { has_custom: true, must_change: false }],
    ["joaoygor", { has_custom: true, must_change: false }],
    ["testejoao", { has_custom: false, must_change: true }]   // sem linha no banco
  ];
  for (const [userKey, esperado] of casos) {
    const r = await chamar("GET", { query: { userKey } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados, esperado);
  }
});

test("GET ?all=1: só campos seguros, e exige token quando AUTH_ENFORCE=1", async () => {
  sb.semear("raphaelvictor", { custom_password: "texto-claro-antigo", must_change: false, last_login: "2026-09-01T10:00:00Z", login_count: 3 });
  let r = await chamar("GET", { query: { all: "1" } });   // modo graça
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.users, [{ user_key: "raphaelvictor", has_custom: true, must_change: false, last_login: "2026-09-01T10:00:00Z", login_count: 3, updated_at: null }]);
  process.env.AUTH_ENFORCE = "1";
  assert.equal((await chamar("GET", { query: { all: "1" } })).status, 401);
  assert.equal((await chamar("GET", { query: { all: "1" }, token: _auth.sign("joaoygor", SEGREDO, 1) })).status, 200);
});

test("item 2: trocar a senha de alguém sem a senha atual não funciona", async () => {
  const antes = await _senha.hash("senha-da-vitima");
  sb.semear("joaoygor", { custom_password: antes, must_change: false });
  // formato antigo do front: { userKey, newPassword }, sem prova nenhuma
  let r = await chamar("POST", { body: { userKey: "joaoygor", newPassword: "senha-do-atacante" } });
  assert.equal(r.status, 401);
  assert.equal(r.dados.token, undefined);
  assert.equal((await trocar("joaoygor", "chute-errado", "senha-do-atacante")).status, 401);
  // a senha padrão não serve de prova para quem já tem senha própria
  assert.equal((await trocar("joaoygor", PADRAO, "senha-do-atacante")).status, 401);
  assert.equal(sb.linhas.get("joaoygor").custom_password, antes);
  // e quem ainda está na senha padrão também não ganha senha por essa via
  r = await chamar("POST", { body: { userKey: "testejoao", newPassword: "senha-do-atacante" } });
  assert.equal(r.status, 401);
  assert.equal(sb.linhas.has("testejoao"), false);
});

test("primeiro acesso: senha padrão, troca obrigatória e depois login com a senha própria", async () => {
  // 1) a senha padrão entra, mas sem token e com troca pendente
  let r = await entrar("testejoao", PADRAO);
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.ok, r.dados.must_change, r.dados.has_custom, r.dados.token], [true, true, false, null]);
  // 2) cria a senha com a padrão como prova: grava hash e já devolve o token
  r = await trocar("testejoao", PADRAO, "minha-senha-nova");
  assert.equal(r.status, 200);
  assert.equal(_auth.verify(r.dados.token, SEGREDO).u, "testejoao");
  const linha = sb.linhas.get("testejoao");
  assert.ok(_senha.isHash(linha.custom_password));
  assert.equal(await _senha.verify("minha-senha-nova", linha.custom_password), true);
  assert.equal(linha.must_change, false);
  // 3) a padrão deixa de valer; a própria entra direto, com token
  assert.equal((await entrar("testejoao", PADRAO)).status, 401);
  r = await entrar("testejoao", "minha-senha-nova");
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.must_change, r.dados.has_custom], [false, true]);
  assert.equal(_auth.verify(r.dados.token, SEGREDO).u, "testejoao");
});

test("senha errada ou usuário fora da lista não entram", async () => {
  assert.equal((await entrar("testejoao", "nao-e-a-padrao")).status, 401);
  assert.equal((await entrar("hacker", PADRAO)).status, 401);
  assert.equal((await trocar("hacker", PADRAO, "qualquer-coisa")).status, 401);
  assert.equal(sb.linhas.has("hacker"), false);
  // linha criada pelo buraco antigo para um nome inventado também não vale
  sb.semear("hacker", { custom_password: "criada-pelo-buraco", must_change: false });
  assert.equal((await entrar("hacker", "criada-pelo-buraco")).status, 401);
});

test("troca de senha de quem já tem senha própria exige a atual", async () => {
  sb.semear("raphaelvictor", { custom_password: await _senha.hash("senha-antiga-1"), must_change: false });
  const r = await trocar("raphaelvictor", "senha-antiga-1", "senha-nova-22");
  assert.equal(r.status, 200);
  assert.equal(_auth.verify(r.dados.token, SEGREDO).u, "raphaelvictor");
  assert.equal((await entrar("raphaelvictor", "senha-antiga-1")).status, 401);
  assert.equal((await entrar("raphaelvictor", "senha-nova-22")).status, 200);
});

test("nova senha: tamanho, diferente da atual e nunca a senha padrão", async () => {
  sb.semear("raphaelvictor", { custom_password: await _senha.hash("senha-antiga-1"), must_change: false });
  assert.equal((await trocar("raphaelvictor", "senha-antiga-1", "12345")).status, 400);
  assert.equal((await trocar("raphaelvictor", "senha-antiga-1", "x".repeat(201))).status, 400);
  assert.equal((await trocar("raphaelvictor", "senha-antiga-1", "senha-antiga-1")).status, 400);
  assert.equal((await trocar("raphaelvictor", "senha-antiga-1", PADRAO)).status, 400);
  assert.equal((await trocar("testejoao", PADRAO, PADRAO)).status, 400);
  assert.equal(await _senha.verify("senha-antiga-1", sb.linhas.get("raphaelvictor").custom_password), true);
});

test("must_change marcado no banco: a senha própria entra, mas o token só sai na troca", async () => {
  sb.semear("sandraalves", { custom_password: await _senha.hash("senha-exposta-1"), must_change: true });
  let r = await entrar("sandraalves", "senha-exposta-1");
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.must_change, r.dados.has_custom, r.dados.token], [true, true, null]);
  r = await trocar("sandraalves", "senha-exposta-1", "senha-nova-segura");
  assert.equal(r.status, 200);
  assert.ok(r.dados.token);
  r = await entrar("sandraalves", "senha-nova-segura");
  assert.equal(r.dados.must_change, false);
  assert.ok(r.dados.token);
});

test("linha antiga em texto claro: entra e vira hash, sem trancar ninguém", async () => {
  sb.semear("raphaelvictor", { custom_password: "senhaAntiga123", must_change: false, updated_at: "2026-07-01T00:00:00Z" });
  assert.equal((await entrar("raphaelvictor", "senha-errada")).status, 401);
  assert.equal(sb.linhas.get("raphaelvictor").custom_password, "senhaAntiga123");   // errou: não mexe
  const r = await entrar("raphaelvictor", "senhaAntiga123");
  assert.equal(r.status, 200);
  assert.ok(r.dados.token);
  const linha = sb.linhas.get("raphaelvictor");
  assert.ok(_senha.isHash(linha.custom_password));
  assert.equal(linha.updated_at, "2026-07-01T00:00:00Z");   // converter não conta como trocar a senha
  assert.equal((await entrar("raphaelvictor", "senhaAntiga123")).status, 200);
  assert.equal((await entrar("raphaelvictor", "senha-errada")).status, 401);
});

test("se a conversão para hash falhar, o login segue e ela é refeita no próximo", async t => {
  t.mock.method(console, "error", () => {});
  sb.semear("raphaelvictor", { custom_password: "senhaAntiga123", must_change: false });
  sb.falhar = metodo => (metodo === "PATCH" ? 500 : 0);
  assert.equal((await entrar("raphaelvictor", "senhaAntiga123")).status, 200);
  assert.equal(sb.linhas.get("raphaelvictor").custom_password, "senhaAntiga123");
  sb.falhar = null;
  assert.equal((await entrar("raphaelvictor", "senhaAntiga123")).status, 200);
  assert.ok(_senha.isHash(sb.linhas.get("raphaelvictor").custom_password));
});

test("a conversão não sobrescreve uma senha trocada nesse meio-tempo", async () => {
  sb.semear("raphaelvictor", { custom_password: "senhaAntiga123", must_change: false });
  const trocadaNoMeio = await _senha.hash("senha-trocada-no-meio");
  // corrida: quando o PATCH da conversão chega, a linha já tem outra senha
  global.fetch = async (url, opt = {}) => {
    if (opt.method === "PATCH") sb.linhas.get("raphaelvictor").custom_password = trocadaNoMeio;
    return sb.fetch(url, opt);
  };
  assert.equal((await entrar("raphaelvictor", "senhaAntiga123")).status, 200);
  assert.equal(sb.linhas.get("raphaelvictor").custom_password, trocadaNoMeio);
});

test("sem DEFAULT_PASSWORD_HASH válida o primeiro acesso fecha; senha própria segue entrando", async () => {
  sb.semear("joaoygor", { custom_password: await _senha.hash("senha-do-admin"), must_change: false });
  // ausente, vazia, ou a senha em texto no lugar do hash
  for (const valor of [undefined, "", "servcamp2026"]) {
    if (valor === undefined) delete process.env.DEFAULT_PASSWORD_HASH;
    else process.env.DEFAULT_PASSWORD_HASH = valor;
    const r = await entrar("testejoao", valor || PADRAO);
    assert.equal(r.status, 503);
    assert.equal(r.dados.ok, false);
    assert.equal((await entrar("joaoygor", "senha-do-admin")).status, 200);
  }
});

test("banco fora do ar não vira 'sem senha própria'", async () => {
  sb.semear("joaoygor", { custom_password: await _senha.hash("senha-do-admin"), must_change: false });
  sb.falhar = metodo => (metodo === "GET" ? 500 : 0);
  // se a leitura falhasse em silêncio, a senha padrão abriria a conta do admin
  const r = await entrar("joaoygor", PADRAO);
  assert.equal(r.status, 502);
  assert.equal(r.dados.token, undefined);
  assert.equal((await trocar("joaoygor", PADRAO, "senha-do-atacante")).status, 502);
  assert.equal((await chamar("GET", { query: { userKey: "joaoygor" } })).status, 502);
});

test("sem AUTH_SECRET (modo graça): confere a senha, mas não emite token", async () => {
  delete process.env.AUTH_SECRET;
  sb.semear("joaoygor", { custom_password: await _senha.hash("senha-do-admin"), must_change: false });
  let r = await entrar("joaoygor", "senha-do-admin");
  assert.deepEqual([r.status, r.dados.ok, r.dados.token, r.dados.grace], [200, true, null, true]);
  assert.equal((await entrar("joaoygor", "errada")).status, 401);
  r = await trocar("joaoygor", "senha-do-admin", "senha-nova-admin");
  assert.deepEqual([r.status, r.dados.token], [200, null]);
});

test("último acesso é registrado só no login certo", async () => {
  sb.semear("joaoygor", { custom_password: await _senha.hash("senha-do-admin"), must_change: false, login_count: 4 });
  await entrar("joaoygor", "errada");
  assert.equal(sb.linhas.get("joaoygor").login_count, 4);
  await entrar("joaoygor", "senha-do-admin");
  const linha = sb.linhas.get("joaoygor");
  assert.equal(linha.login_count, 5);
  assert.ok(Date.now() - new Date(linha.last_login).getTime() < 60000);
  // a ação "login" antiga (registrava acesso de qualquer um, sem senha) saiu
  assert.equal((await chamar("POST", { body: { action: "login", userKey: "joaoygor" } })).status, 400);
  assert.equal(sb.linhas.get("joaoygor").login_count, 5);
});

test("senha nunca vai para URL do Supabase, nunca é gravada em texto e nunca volta na resposta", async () => {
  sb.semear("raphaelvictor", { custom_password: "senhaAntiga123", must_change: false });
  const respostas = [
    await entrar("raphaelvictor", "senhaAntiga123"),
    await trocar("raphaelvictor", "senhaAntiga123", "senhaNova456"),
    await entrar("testejoao", PADRAO),
    await trocar("testejoao", PADRAO, "outraNova789"),
    await chamar("GET", { query: { userKey: "raphaelvictor" } }),
    await chamar("GET", { query: { all: "1" } })
  ];
  const senhas = /senhaAntiga123|senhaNova456|outraNova789|padrao-de-teste/;
  for (const c of sb.chamadas) {
    assert.doesNotMatch(c.url, senhas);
    if (c.corpo) assert.doesNotMatch(c.corpo, senhas);
  }
  assert.doesNotMatch(JSON.stringify(respostas), /senhaAntiga123|senhaNova456|outraNova789|padrao-de-teste|scrypt:/);
});

test("pedidos malformados", async () => {
  assert.equal((await chamar("GET", { query: {} })).status, 400);
  assert.equal((await entrar("testejoao", "")).status, 400);
  assert.equal((await chamar("POST", { body: { action: "outra", userKey: "testejoao" } })).status, 400);
  assert.equal((await chamar("PUT", {})).status, 405);
});

test("_senha: sal aleatório, formato, texto claro antigo e hash malformado", async () => {
  const a = await _senha.hash("mesma-senha"), b = await _senha.hash("mesma-senha");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt:16384:8:1:/);
  assert.equal(await _senha.verify("mesma-senha", a), true);
  assert.equal(await _senha.verify("outra", a), false);
  assert.equal(await _senha.verify("texto", "texto"), true);   // linha antiga em texto claro
  assert.equal(await _senha.verify("", null), false);
  assert.equal(_senha.isHash("servcamp2026"), false);
  // hash truncado não pode virar "qualquer senha serve"
  assert.equal(await _senha.verify("qualquer", "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:A"), false);
  assert.equal(await _senha.verify("qualquer", "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:AAAA"), false);
});

test("index.html: USERS sem senha e com as mesmas chaves da lista do servidor", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ini = html.indexOf("const USERS={");
  const bloco = html.slice(ini, html.indexOf("};", ini));
  const chaves = [...bloco.matchAll(/^\s*"([a-z0-9]+)":\{/gm)].map(m => m[1]);
  assert.ok(chaves.length > 0);
  assert.deepEqual([...chaves].sort(), [...handler.USUARIOS].sort());
  assert.doesNotMatch(bloco, /senha/i);
});

test("as senhas padrão antigas não aparecem em nenhum arquivo servido", () => {
  for (const arq of ["index.html", "email_convite.html", "apresentacao.html"]) {
    const txt = fs.readFileSync(path.join(__dirname, "..", arq), "utf8");
    assert.doesNotMatch(txt, /servcamp2026|Joaoygor1/, arq);
  }
});
