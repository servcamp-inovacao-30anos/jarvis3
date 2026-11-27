// Guias inativadas: Base Virtual (sede), Projetos (prj), Votação e Cartão de Visita (26/11/2026)
// e Saúde do Cliente (saude, 27/11/2026), mais o card Turnover da Visão Geral (27/11/2026).
// Saem do menu, mas a tela e o código ficam para poder voltar; nenhum outro caminho pode abri-las.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const INATIVAS = ["votacao", "cartao", "sede", "prj", "saude"];

test("as guias inativas não aparecem no menu, nem a categoria Inovação vazia", () => {
  const ini = html.indexOf('<nav id="navRoot">'), fim = html.indexOf("</nav>", ini);
  assert.ok(ini > 0 && fim > ini, "menu não encontrado");
  const menu = html.slice(ini, fim);
  for (const p of INATIVAS) assert.doesNotMatch(menu, new RegExp('data-pg="' + p + '"'), p + " ainda está no menu");
  assert.doesNotMatch(menu, /data-cat="inov"/);
});

test("navTo manda para a Visão Geral quem tenta abrir uma guia inativa", () => {
  // a trava é a primeira coisa do navTo: vale para a volta depois de atualização, cards, avisos e favoritos antigos
  assert.match(html, /function navTo\(p,btn\)\{\n  if\(pgInativa\(p\)\)\{p="visao";btn=null;\}\n/);
  const m = html.match(/var PG_INATIVAS=\[[^\]]*\];\nfunction pgInativa\(p\)\{[^\n]*\}\n/);
  assert.ok(m, "lista de guias inativas não encontrada");
  const ctx = {};
  vm.runInNewContext(m[0] + "this.pgInativa=pgInativa;this.lista=PG_INATIVAS;", ctx);
  assert.deepEqual([...ctx.lista].sort(), [...INATIVAS].sort());
  for (const p of INATIVAS) assert.equal(ctx.pgInativa(p), true, p);
  for (const p of ["visao", "agenda", "config", "faltassup", "checklist", "celulares"]) assert.equal(ctx.pgInativa(p), false, p);
});

test("as telas continuam no arquivo, prontas para voltar", () => {
  for (const p of ["sede", "prj", "saude"]) assert.match(html, new RegExp('<div class="page" id="pg-' + p + '">'));
  assert.match(html, /else if\(p==="sede"\)\{hqLoad\(\);chkLoad\(\);\}/);
  assert.match(html, /else if\(p==="prj"\)\{prjLoad\(\);\}/);
  assert.match(html, /else if\(p==="saude"\)\{sauRender\(\);\}/);
});

test("o aviso de votação aberta não aparece com a guia Votação inativa", () => {
  assert.match(html, /if\(typeof votIniciar==="function"&&!pgInativa\("votacao"\)\)votIniciar\(\);/);
});

test("Visão Geral: o card Turnover saiu e a fileira de RH usa a grade de 3, como o SAC", () => {
  assert.doesNotMatch(html, /id="ocTurn"/);
  const ini = html.indexOf('<div class="vg-sec-lbl vg-s-rh">');
  assert.ok(ini > 0, "fileira de RH não encontrada");
  const fileira = html.slice(ini, html.indexOf('<div class="vg-sec">', ini));
  assert.match(fileira, /<div class="oc-row oc-row-3">/);
  assert.deepEqual([...fileira.matchAll(/<div class="oc [^"]*" id="(oc\w+)"/g)].map(x => x[1]), ["ocVagas", "ocEntrev", "ocDesl"]);
});

test("vgCardsMes continua preenchendo os outros cards do mês sem o card Turnover", () => {
  const m = html.match(/\nfunction vgCardsMes\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "vgCardsMes não encontrada");
  const els = {};
  for (const id of ["ocEntrevV", "ocEntrevSub", "ocDeslV", "ocDeslSub", "ocPropV", "ocPropSub", "ocVisComV", "ocVisComSub"]) els[id] = { textContent: "—" };
  const ctx = {
    VG: { extras: { mes: "11/2026", entrevistas: 42, desligamentos: 10, efetivo: 552, turnover: 1.81, propostas: 5, visitas: 7 } },
    document: { getElementById: id => els[id] || null },
  };
  vm.runInNewContext(m[0] + "vgCardsMes();", ctx);
  assert.equal(els.ocEntrevV.textContent, 42);
  assert.equal(els.ocDeslV.textContent, 10);
  assert.equal(els.ocDeslSub.textContent, "no mês 11/2026");
  assert.equal(els.ocVisComV.textContent, 7);
});
