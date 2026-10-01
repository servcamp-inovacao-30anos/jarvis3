// Rede de segurança: um erro de sintaxe em qualquer <script> do index.html
// derruba o painel inteiro (a tela fica sem nenhuma função). Este teste compila
// cada script da página sem executar nada.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("todos os scripts do index.html compilam", () => {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    n++;
    assert.doesNotThrow(() => new Function(m[1]), `script nº ${n} do index.html tem erro de sintaxe`);
  }
  assert.ok(n > 0, "nenhum script encontrado");
});
