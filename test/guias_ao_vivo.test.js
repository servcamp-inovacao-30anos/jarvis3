// Guias liberadas em Configurações valem sem sair e entrar (assets/sessao/guias.js): roda o script num navegador de mentira.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "assets", "sessao", "guias.js"), "utf8");

function abrir({ sessao = {}, resposta }) {
  const ss = new Map(Object.entries(sessao)), pedidos = [], chamadas = { menu: 0, copia: 0, avisos: [] };
  const win = {
    applyUserUI() { chamadas.menu++; }, sessaoAtualizar() { chamadas.copia++; }, hqToast(m) { chamadas.avisos.push(m); }
  };
  const ctx = vm.createContext({
    window: win,
    sessionStorage: { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)) },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    fetch: async (url, opt) => { pedidos.push({ url, opt }); return { ok: resposta.status < 400, json: async () => resposta.json }; },
    setInterval() { return 1; }, JSON, Date, Object
  });
  vm.runInContext(SCRIPT, ctx);
  return { ss, pedidos, chamadas };
}
const espera = () => new Promise(ok => setImmediate(ok));

test("guia liberada pelo administrador aparece sem sair e entrar: guarda, refaz o menu e a cópia da sessão", async () => {
  const a = abrir({ sessao: { logged: "1", authToken: "t", userGuias: "{}" }, resposta: { status: 200, json: { ok: true, guias: { agenda: true } } } });
  await espera(); await espera();
  assert.equal(a.pedidos.length, 1);
  assert.equal(JSON.parse(a.pedidos[0].opt.body).action, "minhas_guias");
  assert.equal(a.ss.get("userGuias"), '{"agenda":true}');
  assert.equal(a.chamadas.menu, 1);
  assert.equal(a.chamadas.copia, 1);
  assert.equal(a.chamadas.avisos.length, 1);
});

test("nada mudou: não refaz o menu nem avisa; sem login ou com erro, não mexe em nada", async () => {
  const igual = abrir({ sessao: { logged: "1", authToken: "t", userGuias: '{"b":false,"a":true}' }, resposta: { status: 200, json: { ok: true, guias: { a: true, b: false } } } });
  await espera(); await espera();
  assert.equal(igual.chamadas.menu, 0, "mesma lista em outra ordem não é mudança");
  const fora = abrir({ sessao: {}, resposta: { status: 200, json: { ok: true, guias: { x: true } } } });
  await espera();
  assert.equal(fora.pedidos.length, 0, "sem login nem pergunta");
  const erro = abrir({ sessao: { logged: "1", authToken: "t", userGuias: '{"a":true}' }, resposta: { status: 401, json: {} } });
  await espera(); await espera();
  assert.equal(erro.ss.get("userGuias"), '{"a":true}');
  assert.equal(erro.chamadas.menu, 0);
});

test("o painel carrega o atualizador de guias", () => {
  const H = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(H.includes('<script src="/assets/sessao/guias.js"></script>'));
});
