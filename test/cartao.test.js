// Cartão de visita digital (cartao.html + guia "Cartão de Visita" do painel).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ler = f => fs.readFileSync(path.join(RAIZ, f), "utf8");
const C = require("../assets/cartao/cartoes.js");

test("o contato (.vcf) de cada cartão está igual aos dados de cartoes.js", () => {
  for (const [apelido, p] of Object.entries(C.CARTOES)) {
    const foto = fs.readFileSync(path.join(RAIZ, p.foto)).toString("base64");
    const atual = fs.readFileSync(path.join(RAIZ, p.contato), "utf8");
    assert.equal(atual, C.vcard(apelido, foto), `${p.contato} desatualizado: rode  node assets/cartao/gerar-contatos.js`);
  }
});

test("vCard: linhas de até 75 bytes, CRLF, campos que o celular precisa", () => {
  const v = C.vcard("gabi", "A".repeat(500));
  assert.ok(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
  assert.ok(v.endsWith("END:VCARD\r\n"));
  v.split("\r\n").forEach(l => assert.ok(Buffer.byteLength(l) <= 75, "linha longa: " + l));
  assert.match(v, /\r\nFN:Gabriela Alvarenga\r\n/);
  assert.match(v, /\r\nTEL;TYPE=WORK,VOICE:\+551931143778\r\n/);
  assert.match(v, /\r\nEMAIL;TYPE=INTERNET,WORK:comercial@gruposervcamp\.com\.br\r\n/);
  assert.match(v.replace(/\r\n /g, ""), /ADR;TYPE=WORK:;;Av\. Dermival Bernardes Siqueira\\, 3\.582/);
});

test("telefones viram links internacionais; celular vazio não gera WhatsApp", () => {
  assert.equal(C.telLink("(19) 3114-3778"), "tel:+551931143778");
  assert.equal(C.zapLink("(19) 99999-0000", "oi"), "https://wa.me/5519999990000?text=oi");
  assert.equal(C.zapLink(""), "");
});

test("o link do QR usa o endereço próprio quando ele existir", () => {
  assert.equal(C.urlCartao("gabi", "https://painel.exemplo"), "https://painel.exemplo/cartao/gabi");
  const antes = C.EMPRESA.enderecoCartao;
  try {
    C.EMPRESA.enderecoCartao = "https://cartao.gruposervcamp.com.br/";
    assert.equal(C.urlCartao("gabi", "https://painel.exemplo"), "https://cartao.gruposervcamp.com.br/cartao/gabi");
  } finally { C.EMPRESA.enderecoCartao = antes; }
});

test("/cartao/<apelido> abre a página do cartão e o .vcf sai como contato", () => {
  const v = JSON.parse(ler("vercel.json"));
  assert.ok((v.rewrites || []).some(r => r.source === "/cartao/:apelido" && r.destination === "/cartao.html"));
  const h = (v.headers || []).find(x => x.source === "/assets/cartao/contato/(.*)");
  assert.ok(h && h.headers.some(x => x.key === "Content-Type" && /^text\/vcard/.test(x.value)));
  const pg = ler("cartao.html");
  assert.match(pg, /<script src="\/assets\/cartao\/cartoes\.js"><\/script>\s*<script src="\/assets\/cartao\/cartao\.js"><\/script>/);
  assert.match(pg, /noindex/);
});

test("a guia do painel fica no menu Comercial, com a permissão do comercial", () => {
  const html = ler("index.html");
  assert.match(html, /<div class="ni" data-pg="cartao" data-perm="com" onclick="navTo\('cartao',this\)">/);
  assert.match(html, /<div class="page" id="pg-cartao">[\s\S]*?<div id="cv-content">/);
  assert.match(html, /else if\(p==="cartao"\)\{if\(typeof cvLoad==="function"\)cvLoad\(\);\}/);
  // painel.js precisa do gerador de QR, que é carregado antes
  const qr = html.indexOf('src="/assets/vendor/qrcode-generator.js"'), dados = html.indexOf('src="/assets/cartao/cartoes.js"'), tela = html.indexOf('src="/assets/cartao/painel.js"');
  assert.ok(qr > 0 && dados > qr && tela > dados);
});

test("todo cartão tem os dados e os arquivos que a página usa", () => {
  for (const [apelido, p] of Object.entries(C.CARTOES)) {
    assert.match(apelido, /^[a-z0-9-]+$/);
    ["nome", "primeiro", "sobrenome", "cargo", "email", "foto", "contato"].forEach(k => assert.ok(p[k], `${apelido}: falta ${k}`));
    assert.ok(fs.existsSync(path.join(RAIZ, p.foto)), `${apelido}: foto não existe`);
  }
  assert.ok(fs.existsSync(path.join(RAIZ, "assets/cartao/logo-servcamp-30.svg")));
});
