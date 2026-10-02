// Login nas APIs: com AUTH_SECRET definida, exige token; e o index.html (público) não leva dados reais.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const _auth = require("../api/_auth");

const pedido = token => ({ headers: token ? { authorization: "Bearer " + token } : {} });

test("com AUTH_SECRET: sem token ou com token inválido/vencido é recusado; com token válido passa", () => {
  const antes = { s: process.env.AUTH_SECRET, e: process.env.AUTH_ENFORCE };
  try {
    process.env.AUTH_SECRET = "segredo-de-teste"; delete process.env.AUTH_ENFORCE;
    assert.equal(_auth.requireAuth(pedido()).ok, false, "sem token");
    assert.equal(_auth.requireAuth(pedido("abc.def")).ok, false, "token inventado");
    assert.equal(_auth.requireAuth(pedido(_auth.sign("raphaelvictor", "outro-segredo", 1))).ok, false, "assinado com outra chave");
    assert.equal(_auth.requireAuth(pedido(_auth.sign("raphaelvictor", "segredo-de-teste", -1))).ok, false, "vencido");
    const ok = _auth.requireAuth(pedido(_auth.sign("raphaelvictor", "segredo-de-teste", 1)));
    assert.equal(ok.ok, true); assert.equal(ok.user.u, "raphaelvictor");
    process.env.AUTH_ENFORCE = "0";
    assert.equal(_auth.requireAuth(pedido()).ok, true, "AUTH_ENFORCE=0: chave de emergência");
    delete process.env.AUTH_SECRET; delete process.env.AUTH_ENFORCE;
    assert.equal(_auth.requireAuth(pedido()).ok, true, "sem AUTH_SECRET o login nem emite token: não dá para exigir");
  } finally {
    if (antes.s === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = antes.s;
    if (antes.e === undefined) delete process.env.AUTH_ENFORCE; else process.env.AUTH_ENFORCE = antes.e;
  }
});

test("index.html é público: a cópia embutida da planilha vai vazia", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/let DASHBOARD_DATA = (\{.*?\});/);
  assert.ok(m, "DASHBOARD_DATA não encontrado");
  const d = JSON.parse(m[1]);
  Object.entries(d).forEach(([k, v]) => assert.deepEqual(v, [], k + " deveria ir vazio"));
  assert.ok(html.length < 1500000, "o arquivo voltou a crescer: conferir se não entrou dado embutido");
});

test("sessão vencida volta para o login, e depois do login a planilha é buscada de novo", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(html.includes('if(r&&r.status===401&&sessionStorage.getItem("logged")==="1")_sessaoExpirou();'));
  assert.ok(html.includes('"Sua sessão expirou. Entre de novo."'));
  assert.ok(html.includes("if(!_dadosDoServidor&&typeof loadFromSupabase===\"function\")loadFromSupabase()"));
});
