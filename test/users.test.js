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

test("GET ?all=1: só campos seguros, e exige token sempre que há AUTH_SECRET", async () => {
  sb.semear("raphaelvictor", { custom_password: "texto-claro-antigo", must_change: false, last_login: "2026-09-01T10:00:00Z", login_count: 3 });
  assert.equal((await chamar("GET", { query: { all: "1" } })).status, 401, "sem token: recusado, mesmo sem AUTH_ENFORCE");
  const r = await chamar("GET", { query: { all: "1" }, token: _auth.sign("joaoygor", SEGREDO, 1) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.users, [{ user_key: "raphaelvictor", has_custom: true, must_change: false, last_login: "2026-09-01T10:00:00Z", login_count: 3, updated_at: null }]);
  process.env.AUTH_ENFORCE = "0"; // chave de emergência
  assert.equal((await chamar("GET", { query: { all: "1" } })).status, 200, "AUTH_ENFORCE=0 desliga a exigência");
  delete process.env.AUTH_ENFORCE;
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

test("joyce: entra direto com a senha inicial (só o hash está no código), sem a padrão, e o banco manda depois", async () => {
  let r = await entrar("joyce", "Joycedp123");
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.ok, r.dados.must_change], [true, false]);
  assert.equal(_auth.verify(r.dados.token, SEGREDO).u, "joyce");
  assert.equal((await entrar("joyce", PADRAO)).status, 401, "a padrão não abre a conta dela");
  assert.equal((await entrar("joyce", "errada123")).status, 401);
  // a senha gravada no banco passa a valer e a inicial deixa de valer
  sb.semear("joyce", { custom_password: await _senha.hash("nova-do-banco-9"), must_change: false });
  assert.equal((await entrar("joyce", "Joycedp123")).status, 401);
  assert.equal((await entrar("joyce", "nova-do-banco-9")).status, 200);
  // o código guarda só o hash: a senha em texto não aparece no arquivo
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "api", "users.js"), "utf8").includes("Joycedp123"), false);
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

// ── Configurações: redefinir senha e criar usuário (só administrador) ──
const comoAdmin = () => _auth.sign("joaoygor", SEGREDO, 1);
const comoComum = () => _auth.sign("raphaelvictor", SEGREDO, 1);
const acao = (body, token) => chamar("POST", { body, token });

test("admin_reset: só admin; gera senha temporária com troca obrigatória", async () => {
  sb.semear("raphaelvictor", { custom_password: await _senha.hash("senha-antiga-1"), must_change: false });
  assert.equal((await acao({ action: "admin_reset", userKey: "raphaelvictor" })).status, 403, "sem token");
  assert.equal((await acao({ action: "admin_reset", userKey: "raphaelvictor" }, comoComum())).status, 403, "não admin");
  assert.equal((await acao({ action: "admin_reset", userKey: "naoexiste" }, comoAdmin())).status, 404);
  const r = await acao({ action: "admin_reset", userKey: "raphaelvictor" }, comoAdmin());
  assert.equal(r.status, 200);
  assert.match(r.dados.senha, /^[a-z2-9]{8}$/);
  assert.equal((await entrar("raphaelvictor", "senha-antiga-1")).status, 401, "a senha antiga deixa de valer");
  const e = await entrar("raphaelvictor", r.dados.senha);
  assert.equal(e.status, 200);
  assert.equal(e.dados.must_change, true, "troca obrigatória no primeiro acesso");
  assert.equal(e.dados.token, null, "token só depois da troca");
});

test("create_user: só admin; entra com a senha temporária, troca obrigatória e perfil vem do banco", async () => {
  const novo = { action: "create_user", nome: "Maria  da Silva", cargo: "Financeiro", perms: { com: true, admin: false, inventada: true } };
  assert.equal((await acao(novo)).status, 403, "sem token");
  assert.equal((await acao(novo, comoComum())).status, 403, "não admin");
  assert.equal((await acao({ ...novo, nome: "Jo" }, comoAdmin())).status, 400, "nome curto");
  assert.equal((await acao({ ...novo, nome: "Joyce" }, comoAdmin())).status, 409, "chave de usuário fixo");
  const r = await acao(novo, comoAdmin());
  assert.equal(r.status, 200);
  assert.equal(r.dados.userKey, "mariadasilva");
  assert.equal((await acao(novo, comoAdmin())).status, 409, "não cria duas vezes");
  const e = await entrar("mariadasilva", r.dados.senha);
  assert.equal(e.status, 200);
  assert.equal(e.dados.must_change, true);
  assert.deepEqual(e.dados.perfil, { nome: "Maria da Silva", cargo: "Financeiro", perms: { com: true } }, "só permissões válidas e verdadeiras");
  assert.equal((await entrar("mariadasilva", "errada123")).status, 401);
  const t = await trocar("mariadasilva", r.dados.senha, "minha-senha-nova");
  assert.equal(t.status, 200);
  const e2 = await entrar("mariadasilva", "minha-senha-nova");
  assert.equal(e2.dados.must_change, false);
  assert.ok(e2.dados.token, "depois da troca, entra com token");
  // inativo não entra
  sb.semear("mariadasilva", { ...[...sb.linhas.values()].find(l => l.user_key === "mariadasilva"), ativo: false });
  assert.equal((await entrar("mariadasilva", "minha-senha-nova")).status, 403, "inativo não entra (avisa bloqueado só com a senha certa)");
  assert.equal((await entrar("mariadasilva", "senha-errada-9")).status, 401, "senha errada continua genérica");
});

test("criado pela tela com admin no banco também redefine senhas", async () => {
  sb.semear("chefe", { nome: "Chefe", cargo: "Diretoria", perms: { admin: true }, ativo: true, custom_password: await _senha.hash("x1234567") });
  sb.semear("raphaelvictor", { custom_password: await _senha.hash("senha-antiga-1") });
  const r = await acao({ action: "admin_reset", userKey: "raphaelvictor" }, _auth.sign("chefe", SEGREDO, 1));
  assert.equal(r.status, 200);
});

// ── Configurações: bloquear e liberar acesso (só administrador) ──
test("set_active: só admin, nunca a si mesmo nem o admin fixo, e só usuário que existe", async () => {
  const ajusta = (userKey, ativo, token) => acao({ action: "set_active", userKey, ativo }, token);
  assert.equal((await ajusta("raphaelvictor", false)).status, 403, "sem token");
  assert.equal((await ajusta("raphaelvictor", false, comoComum())).status, 403, "não admin");
  assert.equal((await ajusta("raphaelvictor", "false", comoAdmin())).status, 400, "ativo precisa ser booleano");
  assert.equal((await ajusta("joaoygor", false, comoAdmin())).status, 400, "não bloqueia a si mesmo");
  sb.semear("chefe", { nome: "Chefe", perms: { admin: true }, ativo: true, custom_password: await _senha.hash("x1234567") });
  assert.equal((await ajusta("joaoygor", false, _auth.sign("chefe", SEGREDO, 1))).status, 400, "admin fixo não é bloqueado");
  assert.equal((await ajusta("naoexiste", false, comoAdmin())).status, 404);
});

test("bloqueado não entra (aviso só com a senha certa), não troca senha, aparece na lista e volta ao liberar", async () => {
  sb.semear("raphaelvictor", { custom_password: await _senha.hash("senha-dele-1"), must_change: false });
  const b = await acao({ action: "set_active", userKey: "raphaelvictor", ativo: false }, comoAdmin());
  assert.equal(b.status, 200);
  assert.equal(b.dados.ativo, false);
  const e = await entrar("raphaelvictor", "senha-dele-1");
  assert.equal(e.status, 403);
  assert.match(e.dados.error, /bloqueado/i);
  assert.equal(e.dados.token, undefined, "bloqueado não recebe token");
  assert.equal((await entrar("raphaelvictor", "senha-errada-1")).status, 401, "senha errada: mensagem genérica, sem revelar o bloqueio");
  assert.equal((await trocar("raphaelvictor", "senha-dele-1", "outra-senha-2")).status, 403, "bloqueado não troca a senha");
  const lista = await chamar("GET", { query: { all: "1" }, token: comoAdmin() });
  assert.equal(lista.dados.users.find(u => u.user_key === "raphaelvictor").ativo, false, "a Configuração enxerga o bloqueio");
  // senha preservada: bloquear não apaga a senha
  const l = await acao({ action: "set_active", userKey: "raphaelvictor", ativo: true }, comoAdmin());
  assert.equal(l.status, 200);
  const e2 = await entrar("raphaelvictor", "senha-dele-1");
  assert.equal(e2.status, 200, "liberado entra de novo com a mesma senha");
  assert.ok(e2.dados.token);
});

test("bloquear usuário fixo que nunca entrou cria a linha só com o bloqueio", async () => {
  const r = await acao({ action: "set_active", userKey: "sandraalves", ativo: false }, comoAdmin());
  assert.equal(r.status, 200);
  const linha = [...sb.linhas.values()].find(l => l.user_key === "sandraalves");
  assert.equal(linha.ativo, false);
  assert.equal(linha.custom_password, null, "não inventa senha");
  assert.equal((await entrar("sandraalves", PADRAO)).status, 403, "nem com a senha padrão");
});

test("create_user: nome e cargo só com texto (aparecem no painel de todos)", async () => {
  assert.equal((await acao({ action: "create_user", nome: "Maria <img src=x onerror=alert(1)>", cargo: "" }, comoAdmin())).status, 400, "HTML no nome");
  assert.equal((await acao({ action: "create_user", nome: "Maria da Silva", cargo: "<b>Chefe</b>" }, comoAdmin())).status, 400, "HTML no cargo");
  assert.equal((await acao({ action: "create_user", nome: "Ana D'Ávila-Souza", cargo: "Auxiliar ADM (RH) / Financeiro" }, comoAdmin())).status, 200, "acentos, apóstrofo, hífen e parênteses valem");
});

test("GET ?all=1 (com quem está bloqueado) é só para administrador", async () => {
  assert.equal((await chamar("GET", { query: { all: "1" }, token: comoComum() })).status, 403, "não admin");
  assert.equal((await chamar("GET", { query: { all: "1" }, token: comoAdmin() })).status, 200, "admin");
});
