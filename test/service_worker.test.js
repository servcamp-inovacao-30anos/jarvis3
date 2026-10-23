// Service worker (sw.js): o que vem do cache e o que vai sempre à rede.
// Estava em test/avisos.test.js; ficou aqui quando os avisos no celular (push) saíram.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("service worker: só ícones e manifesto vêm do cache; scripts, estilos, fontes e /api/ vão sempre à rede", () => {
  const ouvintes = {};
  const self = { location: { origin: "https://painel.exemplo" }, addEventListener: (t, fn) => { ouvintes[t] = fn; }, skipWaiting() {}, clients: { claim: async () => {} }, registration: {} };
  const codigo = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  vm.runInNewContext(codigo, { self, caches: { match: async () => null, open: async () => ({ put() {} }) }, fetch: async () => ({ status: 200, type: "basic", clone() { return this; } }), URL, Response: { error: () => null }, console });
  const respondeu = (caminho, mode) => { let r = false; ouvintes.fetch({ request: { method: "GET", url: "https://painel.exemplo" + caminho, mode: mode || "no-cors" }, respondWith: () => { r = true; } }); return r; };
  assert.equal(respondeu("/icon-192.png"), true, "ícone pode vir do cache");
  assert.equal(respondeu("/site.webmanifest"), true);
  for (const c of ["/assets/faltas-email/faltas-email.js", "/assets/faltas-email/faltas-email.css", "/assets/tv/modo-tv.css", "/fonts/Rajdhani700.woff2", "/api/rh?modulo=faltasemail&t=painel"]) {
    assert.equal(respondeu(c), false, c + " não pode ficar preso no cache");
  }
  assert.equal(respondeu("/", "navigate"), true, "a página continua rede primeiro, com o cache só de reserva");
  assert.match(codigo, /const VERSAO = "jarvis-v\d+";/, "o cache tem versão: trocar o nome apaga o antigo");
  assert.ok(!ouvintes.push && !ouvintes.notificationclick, "sem push desde 23/10/2026");
});
