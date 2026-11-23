// Envio da planilha pela tela (index.html): o pedido principal e, depois, as etapas dos módulos.
// Roda as funções do index.html num contexto vm com fetch, alert e a barra de status de mentira.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function trecho(nome) {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i >= 0, "não achei " + nome);
  let n = 0, j = html.indexOf("{", i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === "{") n++;
    else if (html[k] === "}" && --n === 0) return html.slice(i, k + 1);
  }
  throw new Error("fim de " + nome);
}
const codigo = ["_corpoEnvio", "_postarEnvio", "syncToSupabase", "_syncModulos"].map(trecho).join("\n");

// respostas: (url, corpo) → { status, body }
function montar(respostas) {
  const pedidos = [], alertas = [], aposEnvio = [];
  const status = { textContent: "Base: planilha.xlsx" };
  const ctx = {
    console: { error() {} },
    JSON, Promise, Blob, Response, encodeURIComponent,
    document: { getElementById: id => (id === "dataStatusTxt" ? status : null) },
    alert: m => alertas.push(m),
    fmAposEnvio: (ok, info) => aposEnvio.push({ ok, info }),
    fetch: async (url, init) => {
      const corpo = JSON.parse(init.body);
      pedidos.push({ url, corpo });
      const r = respostas(url, corpo);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  const esperar = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); };
  return { ctx, pedidos, alertas, aposEnvio, status, esperar };
}
const DATA = { ativos: [{ RE: 1 }], hrextra: [{ RE: 1 }], faltas: [{ RE: 1 }], fichaDias: { 1: {} }, ocorrencias: [], disciplina: [], clientes: [{ NOME: "C" }] };

test("tela: salva a planilha, depois Faltas x Medidas, os dias em partes e o ponto, cada um com as suas abas", async () => {
  const t = montar(url => {
    if (url === "/api/import?etapas=cliente") return { status: 200, body: { ok: true, etapas: ["faltas", "dias", "ponto"] } };
    if (url === "/api/import?etapa=faltas") return { status: 200, body: { ok: true, faltas_medidas: { ok: true, faltas: 3, medidas: 1 } } };
    if (url === "/api/import?etapa=dias") return { status: 200, body: { ok: true, dias: { ok: true, proximo: 500 } } };
    if (url === "/api/import?etapa=dias&de=500") return { status: 200, body: { ok: true, dias: { ok: true, proximo: null } } };
    if (url === "/api/import?etapa=ponto") return { status: 200, body: { ok: true, ponto: { ok: true } } };
    return { status: 404, body: {} };
  });
  t.ctx.syncToSupabase(DATA, "planilha.xlsx");
  await t.esperar();
  assert.deepEqual(t.pedidos.map(p => p.url).sort(), ["/api/import?etapa=dias", "/api/import?etapa=dias&de=500", "/api/import?etapa=faltas", "/api/import?etapa=ponto", "/api/import?etapas=cliente"]);
  assert.equal(t.pedidos[0].url, "/api/import?etapas=cliente", "a planilha vai primeiro");
  assert.deepEqual(Object.keys(t.pedidos[0].corpo.data).sort(), Object.keys(DATA).sort(), "a planilha inteira");
  const abas = u => Object.keys(t.pedidos.find(p => p.url === u).corpo.data).sort();
  assert.deepEqual(abas("/api/import?etapa=faltas"), ["ativos", "disciplina", "faltas", "fichaDias", "ocorrencias"]);
  assert.deepEqual(abas("/api/import?etapa=dias"), ["faltas", "fichaDias"]);
  assert.deepEqual(abas("/api/import?etapa=ponto"), ["ativos", "hrextra"]);
  const iFaltas = t.pedidos.findIndex(p => p.url === "/api/import?etapa=faltas"), iDias = t.pedidos.findIndex(p => p.url === "/api/import?etapa=dias");
  assert.ok(iFaltas < iDias, "os dias vão depois de Faltas x Medidas");
  assert.deepEqual(t.alertas, []);
  assert.equal(t.aposEnvio.length, 1);
  assert.deepEqual([t.aposEnvio[0].ok, t.aposEnvio[0].info.faltas_medidas.faltas], [true, 3]);
  assert.match(t.status.textContent, /Sincronizado com Supabase$/);
});

test("tela: só diz que a planilha NÃO foi enviada quando o pedido principal falha", async () => {
  const t = montar(() => ({ status: 504, body: null }));
  t.ctx.syncToSupabase(DATA, "planilha.xlsx");
  await t.esperar();
  assert.equal(t.pedidos.length, 1, "sem planilha salva, nenhuma etapa");
  assert.equal(t.alertas.length, 1);
  assert.match(t.alertas[0], /NÃO foi enviada/);
  assert.match(t.alertas[0], /HTTP 504/);
  assert.equal(t.aposEnvio[0].ok, false);
});

test("tela: etapa que falha não vira 'NÃO foi enviada': o módulo recebe o erro e a planilha conta como salva", async () => {
  const t = montar(url => {
    if (url === "/api/import?etapas=cliente") return { status: 200, body: { ok: true, etapas: ["faltas", "dias", "ponto"] } };
    if (url === "/api/import?etapa=faltas") return { status: 504, body: null };
    return { status: 200, body: { ok: true, ponto: { ok: true } } };
  });
  t.ctx.syncToSupabase(DATA, "planilha.xlsx");
  await t.esperar();
  assert.deepEqual(t.alertas, [], "o aviso fica com o módulo (fmAposEnvio), que diz que a planilha foi salva");
  assert.equal(t.pedidos.filter(p => p.url.startsWith("/api/import?etapa=dias")).length, 0);
  assert.equal(t.aposEnvio[0].ok, true);
  assert.equal(t.aposEnvio[0].info.faltas_medidas.ok, false);
  assert.match(t.aposEnvio[0].info.faltas_medidas.erro, /HTTP 504/);
  assert.match(t.status.textContent, /Faltas x Medidas não atualizou/);
});

test("tela: servidor antigo (sem etapas na resposta) já fez tudo num pedido só", async () => {
  const t = montar(() => ({ status: 200, body: { ok: true, faltas_medidas: { ok: true, faltas: 1, medidas: 0 } } }));
  t.ctx.syncToSupabase(DATA, "planilha.xlsx");
  await t.esperar();
  assert.equal(t.pedidos.length, 1);
  assert.equal(t.aposEnvio[0].info.faltas_medidas.faltas, 1);
});
