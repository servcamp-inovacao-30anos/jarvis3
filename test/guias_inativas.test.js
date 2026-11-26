// Guias inativadas (26/11/2026): Base Virtual (sede), Projetos (prj), Votação e Cartão de Visita.
// Saem do menu, mas a tela e o código ficam para poder voltar; nenhum outro caminho pode abri-las.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const INATIVAS = ["votacao", "cartao", "sede", "prj"];

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
  for (const p of ["visao", "agenda", "config", "faltassup", "checklist"]) assert.equal(ctx.pgInativa(p), false, p);
});

test("as telas continuam no arquivo, prontas para voltar", () => {
  for (const p of ["sede", "prj"]) assert.match(html, new RegExp('<div class="page" id="pg-' + p + '">'));
  assert.match(html, /else if\(p==="sede"\)\{hqLoad\(\);chkLoad\(\);\}/);
  assert.match(html, /else if\(p==="prj"\)\{prjLoad\(\);\}/);
});

test("o aviso de votação aberta não aparece com a guia Votação inativa", () => {
  assert.match(html, /if\(typeof votIniciar==="function"&&!pgInativa\("votacao"\)\)votIniciar\(\);/);
});
