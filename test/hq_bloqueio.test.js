// Bloqueio pela tela de Configurações: quem está com o painel aberto cai no
// próximo batimento do /api/hq (401 com bloqueado:true, e o front volta ao login).
const test = require("node:test");
const assert = require("node:assert/strict");
const _auth = require("../api/_auth");
const handler = require("../api/hq");

const SEGREDO = "segredo-de-teste-hq";
const BASE = "https://falso.supabase.co";
const fetchReal = global.fetch;
let usuarios = [];
let pedidos = [];

async function chamar(token) {
  const req = { method: "GET", query: { me: "x" }, body: null, headers: token ? { authorization: "Bearer " + token } : {} };
  let status = 200, dados;
  const res = { status(s) { status = s; return this; }, json(d) { dados = d; return this; }, setHeader() {} };
  await handler(req, res);
  return { status, dados };
}

test.beforeEach(() => {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
  process.env.AUTH_SECRET = SEGREDO;
  delete process.env.AUTH_ENFORCE;
  pedidos = [];
  _auth.esquecerBloqueio();
  global.fetch = async url => {
    const u = String(url);
    pedidos.push(u);
    const corpo = u.includes("/rest/v1/app_users") ? usuarios : (u.includes("/rpc/vg_extras") ? {} : []);
    return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
  };
});
test.after(() => { global.fetch = fetchReal; });

test("bloqueado com o painel aberto recebe 401 bloqueado no batimento", async () => {
  usuarios = [{ user_key: "raphaelvictor", presence_page: "visao", presence_at: null, ativo: false }];
  const r = await chamar(_auth.sign("raphaelvictor", SEGREDO, 1));
  assert.equal(r.status, 401);
  assert.equal(r.dados.bloqueado, true);
});

test("liberado segue normal, e a presença não expõe quem está bloqueado", async () => {
  usuarios = [
    { user_key: "joaoygor", presence_page: "visao", presence_at: null, ativo: true },
    { user_key: "raphaelvictor", presence_page: "faltas", presence_at: null, ativo: false }
  ];
  const r = await chamar(_auth.sign("joaoygor", SEGREDO, 1));
  assert.equal(r.status, 200);
  assert.equal(r.dados.presenca.length, 2);
  assert.ok(pedidos.some(u => u.includes("/rest/v1/app_users?select=user_key,presence_page,presence_at") && !u.includes("ativo")), "a presença não pede o campo ativo");
});

test("sem token continua 401 de sessão (não de bloqueio)", async () => {
  usuarios = [];
  const r = await chamar(null);
  assert.equal(r.status, 401);
  assert.equal(r.dados.bloqueado, undefined);
});

// O bloqueio vale no servidor em todas as rotas, e não só na tela (revisão de 30/10).
async function chamarRota(mod, { query = {}, token, method = "GET" } = {}) {
  const req = { method, query, body: null, headers: token ? { authorization: "Bearer " + token } : {} };
  let status = 200, dados;
  const res = { status(s) { status = s; return this; }, json(d) { dados = d; return this; }, setHeader() {}, send(d) { dados = d; return this; }, end() { return this; } };
  await mod(req, res);
  return { status, dados };
}

test("token de bloqueado é recusado em outra rota (/api/latest), e liberado volta a valer", async () => {
  usuarios = [{ user_key: "raphaelvictor", ativo: false }];
  const latest = require("../api/latest");
  const r = await chamarRota(latest, { token: _auth.sign("raphaelvictor", SEGREDO, 1) });
  assert.equal(r.status, 401);
  assert.equal(r.dados.bloqueado, true);
  usuarios = [{ user_key: "raphaelvictor", ativo: true }];
  _auth.esquecerBloqueio("raphaelvictor");
  const r2 = await chamarRota(latest, { token: _auth.sign("raphaelvictor", SEGREDO, 1) });
  assert.notEqual(r2.status, 401, "liberado passa da conferência");
});

test("chave do Excel de quem foi bloqueado deixa de valer (api/rh.js)", async () => {
  usuarios = [{ user_key: "raphaelvictor", ativo: false }];
  const rh = require("../api/rh");
  const chave = _auth.sign("raphaelvictor", SEGREDO, 24, { s: "xl" });
  const r = await chamarRota(rh, { query: { modulo: "faltas", t: "planilha", k: chave } });
  assert.equal(r.status, 401);
  assert.equal(r.dados.bloqueado, true);
});

test("banco fora do ar não derruba ninguém (sem estado conhecido, deixa passar)", async () => {
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  assert.equal(await _auth.estaBloqueado("joaoygor"), false);
});
