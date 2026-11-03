// Guia Celulares na tela (assets/celulares/celulares.js): como o aparelho acha o cliente do sistema,
// o número formatado igual ao do servidor, a guia Clientes com o celular de cada posto (sem deixar
// HTML do banco passar) e a ligação com o index.html.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const T = require("../assets/celulares/celulares.js");
const R = require("../api/_celulares_regras");
const ARQ_JS = path.join(__dirname, "..", "assets", "celulares", "celulares.js");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("núcleo do nome: tira condomínio na frente e o posto no fim, sem comer o nome do cliente", () => {
  const casos = {
    "AGUAS CLARAS - PORTARIA": "AGUAS CLARAS",
    "COND - SAMANBAIA - ZELADOR - ": "SAMANBAIA",
    "COND - TURQUEZA VILLE - PORTARIA APOIO": "TURQUEZA VILLE",
    "GIARDINO D ITALIA  RONDA 01": "GIARDINO D ITALIA",
    "RUGENDAS PORTARIA II": "RUGENDAS",
    "VILLA FLORA RONDA I APARELHO DO CLIENTE": "VILLA FLORA",
    "IGREJA VIVA - CELULAR SUMIU": "IGREJA VIVA",
    "ILHAS GREGA (DESLIGADO)": "ILHAS GREGA",
    "Cond – Living Celebration (Portaria)": "LIVING CELEBRATION",
    "Pq. Ecológico (RONDA)": "PARQUE ECOLOGICO",
    "AMBIANCE IV - PORTARIA": "AMBIANCE IV",
    "CLINICA ESCALADA UNIDADE 1": "CLINICA ESCALADA UNIDADE 1",
    "SÃO GABRIEL SINDICA": "SAO GABRIEL",
    "COND. RES. AGUAS CLARAS": "AGUAS CLARAS"
  };
  for (const [nome, esperado] of Object.entries(casos)) assert.equal(T.nucleo(nome), esperado, nome);
});

test("vincular: exato, sem o posto, pelo começo do nome, ligado à mão — e na dúvida não liga", () => {
  const nomes = ["AGUAS CLARAS", "GAPLAN CAMPINAS", "GAPLAN INDAIATUBA", "MAISON RENOIR", "ECOWAY", "CLINICA ESCALADA UNIDADE 1",
    "CLINICA ESCALADA UNIDADE 2", "COND. RES. VILA ROMANA", "LAGUNA RESIDENCIAL CLUBE", "ASA", "ASA LIDER"];
  const ap = [
    { id: 1, cliente: "AGUAS CLARAS - PORTARIA" },
    { id: 2, cliente: "GAPLAN - CAMPINAS - PORTARIA" },
    { id: 3, cliente: "MAISON RENOIR PQ PRADO" },
    { id: 4, cliente: "ECO WAY" },
    { id: 5, cliente: "CLINICA ESCALADA UNIDADE 2" },
    { id: 6, cliente: "VILA ROMANA ZELADOR" },
    { id: 7, cliente: "LAGUNA" },
    { id: 8, cliente: "SUP - FRANK", tipo: "INTERNO" },
    { id: 9, cliente: "QUALQUER", cliente_vinculado: "maison  renoir" },
    { id: 10, cliente: "OUTRO", cliente_vinculado: "CLIENTE QUE SAIU" },
    { id: 11, cliente: "NADA PARECIDO" },
    { id: 12, cliente: "ASA RONDA  / LIMPEZA SERVCAMP" },
    { id: 13, cliente: "GAPLAN" },
    { id: 14, cliente: "ASA LIDER" },
    { id: 15, cliente: "ASA - JARDINEIRO" }
  ];
  const v = T.vincular(ap, nomes);
  const nome = id => (v.get(id) || {}).nome;
  assert.equal(nome(1), "AGUAS CLARAS");
  assert.equal(nome(2), "GAPLAN CAMPINAS");
  assert.equal(nome(3), "MAISON RENOIR");
  assert.equal(nome(4), "ECOWAY");
  assert.equal(nome(5), "CLINICA ESCALADA UNIDADE 2");
  assert.equal(nome(6), "COND. RES. VILA ROMANA");
  assert.equal(nome(7), "LAGUNA RESIDENCIAL CLUBE");
  assert.equal(v.has(8), false, "uso interno não procura cliente");
  assert.deepEqual(v.get(9), { nome: "MAISON RENOIR", como: "manual" });
  assert.deepEqual(v.get(10), { nome: null, como: "perdido" });
  assert.equal(v.has(11), false);
  assert.equal(nome(12), "ASA");
  assert.equal(v.has(13), false, "GAPLAN serve para dois clientes: não chuta");
  assert.equal(nome(14), "ASA LIDER", "cliente cujo nome termina numa palavra de posto continua sendo ele mesmo");
  assert.equal(nome(15), "ASA");
});

test("vincular: erro de digitação e nome mais curto, sempre com um candidato só (nomes reais do sistema)", () => {
  const nomes = ["COLOMARTI", "COLOMARTI INDAITUBA", "COND - SAMAMBAIA", "COND - VILLAGE MONET", "COND - PORTAL DAS AMOREIRAS",
    "COND - SANTOS DUMONT II", "COND - SANTOS DUMONT II SD", "COND - LONDON PARK", "COND - LONDON LOFT", "CCL PARANA"];
  const casos = {
    "COLOMARTI - INDAIATUBA": "COLOMARTI INDAITUBA", // o do sistema está com erro de digitação; o prefixo "COLOMARTI" não pode ganhar
    "COND - SAMANBAIA - PORTARIA": "COND - SAMAMBAIA",
    "MONET - PORTARIA": "COND - VILLAGE MONET",
    "PORTAL AMOREIRAS RONDA": "COND - PORTAL DAS AMOREIRAS",
    "COND - SANTOS DUMONT - PORTARIA": undefined, // "II" e "II SD": dois candidatos, e "II" a mais não é erro de digitação
    "LONDON PERK": "COND - LONDON PARK",
    "LONDON": undefined,
    "CCL - CAMPINAS": undefined
  };
  const ap = Object.keys(casos).map((cliente, i) => ({ id: i + 1, cliente }));
  const v = T.vincular(ap, nomes);
  ap.forEach(a => assert.equal((v.get(a.id) || {}).nome, casos[a.cliente], a.cliente));
});

test("vincular: unidade diferente nunca é parecida, e o que é só parecido não vai para o supervisor (revisão)", () => {
  const nomes = ["COND. SANTOS DUMONT", "COND. SANTOS DUMONT 2", "COND. SANTOS DUMONT SAN DIEGO", "COND. AMBIANCE", "COND. AMBIANCE III",
    "COND - MAISON RENOIR", "COND - MAISON RENOIR P. PRADO", "CLINICA ESCALADA", "COND - RESIDENCIAL LUGANO", "COND - VILLAGE MONET"];
  const ap = [
    { id: 1, cliente: "SANTOS DUMONT II LIMPEZA" },
    { id: 2, cliente: "SANTOS DUMONT S. DIEGO" },
    { id: 3, cliente: "AMBIANCE 3 - LIMPEZA" },
    { id: 4, cliente: "MAISON RENOIR PQ PRADO" },
    { id: 5, cliente: "CLINICA ESCALADA UNIDADE 2" },
    { id: 6, cliente: "LAGO DI LUGANO LIMPEZA" },
    { id: 7, cliente: "PLUTÃO - ZELADOR" },
    { id: 8, cliente: "MONET - PORTARIA" },
    { id: 9, cliente: "SANTOS DUMONT - PORTARIA" }
  ];
  const v = T.vincular(ap, nomes);
  assert.deepEqual(v.get(1), { nome: "COND. SANTOS DUMONT 2", como: "nome" }, "II = 2");
  assert.deepEqual(v.get(2), { nome: "COND. SANTOS DUMONT SAN DIEGO", como: "parecido" });
  assert.deepEqual(v.get(3), { nome: "COND. AMBIANCE III", como: "nome" }, "3 = III");
  assert.deepEqual(v.get(4), { nome: "COND - MAISON RENOIR P. PRADO", como: "parecido" }, "P. de PARQUE, e não o MAISON RENOIR");
  assert.equal(v.has(5), false, "UNIDADE 2 não vira a CLINICA ESCALADA");
  assert.equal(v.has(6), false, "LAGO DI LUGANO não é o RESIDENCIAL LUGANO");
  assert.equal(v.has(7), false, "um P sozinho não vira PLUTÃO");
  assert.deepEqual(v.get(8), { nome: "COND - VILLAGE MONET", como: "parecido" });
  assert.deepEqual(v.get(9), { nome: "COND. SANTOS DUMONT", como: "nome" });
  const m = T.contatosPorCliente([
    { id: 1, cliente: "MONET - PORTARIA", numero: "19900000001", login_zello: "a" },
    { id: 2, cliente: "MONET - PORTARIA", cliente_vinculado: "COND - VILLAGE MONET", numero: "19900000002", login_zello: "b" }
  ], nomes);
  assert.deepEqual(m.get(T.chave("COND - VILLAGE MONET")).map(c => c.numero), ["19900000002"], "só o confirmado aparece");
});

test("rótulo do posto e contatos agrupados por cliente", () => {
  assert.equal(T.rotuloPosto("AGUAS CLARAS - PORTARIA", "AGUAS CLARAS"), "PORTARIA");
  assert.equal(T.rotuloPosto("COND - TURQUEZA VILLE - PORTARIA APOIO", "TURQUEZA VILLE"), "PORTARIA APOIO");
  assert.equal(T.rotuloPosto("AGUAS LINDOIA", "AGUAS LINDOIA"), "");
  const m = T.contatosPorCliente([
    { id: 1, cliente: "AGUAS CLARAS - ZELADOR", numero: "(19) 92222-0088", login_zello: "teste224" },
    { id: 2, cliente: "AGUAS CLARAS - PORTARIA", numero: "19911112073", login_zello: "teste225" },
    { id: 3, cliente: "SEM CLIENTE", numero: "1", login_zello: "x" }
  ], ["AGUAS CLARAS", "OUTRO"]);
  assert.deepEqual(m.get("AGUAS CLARAS").map(c => c.posto), ["PORTARIA", "ZELADOR"]);
  assert.equal(m.size, 1);
});

test("número formatado e link de ligar: a tela e o servidor dão o mesmo resultado", () => {
  for (const n of ["19912346713", "(19) 91234-6713", "+55 19 91234-6713", "(19) 9740-14489", "(19) 3254-1234", "91234 6417", "1234-6417", "123", "", "X", "019 91234 6713"]) {
    assert.equal(T.formatarNumero(n), R.formatarNumero(n), n);
  }
  assert.equal(T.telHref("(19) 91234-6713"), "tel:+5519912346713");
  assert.equal(T.telHref("91234 6417"), "tel:912346417");
  assert.equal(T.telHref("X"), "");
});

test("sugestões para ligar à mão: o mais parecido primeiro", () => {
  const s = T.sugestoes("COND - TONS DO MORUMBI - LIMPEZA", ["TONS DO MORUMBI", "MORUMBI SUL", "AGUAS CLARAS"], 3);
  assert.equal(s[0], "TONS DO MORUMBI");
  assert.ok(!s.includes("AGUAS CLARAS"));
});

// ── no navegador de mentira: guia Clientes ────────────────────────────────
function navegador(contatos, clientes, opcoes) {
  const o = opcoes || {};
  const pedidos = [];
  const store = new Map([["userKey", "carlos"], ["logged", "1"]]);
  const pagina = { innerHTML: "", addEventListener() {}, contains: () => true };
  const janela = { id: "cel-ov", removido: false, remove() { this.removido = true; } };
  const ouvintes = {};
  let menu = null;
  const ctx = {
    console, Promise, setTimeout, clearTimeout, Date, JSON, Map, Set, encodeURIComponent,
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), clear: () => store.clear() },
    document: {
      addEventListener(t, f) { (ouvintes[t] = ouvintes[t] || []).push(f); }, querySelector: () => null,
      body: { contains: () => false, appendChild(m) { menu = m; } },
      documentElement: { clientWidth: 1000 },
      createElement: () => ({ style: {}, dataset: {}, offsetWidth: 250, offsetHeight: 100, innerHTML: "", remove() { menu = null; } }),
      getElementById: id => (id === "cel-content" ? pagina : id === "cel-ov" && !janela.removido ? janela : id === "cel-endm" ? menu : null)
    },
    scrollY: 0, scrollX: 0, innerHeight: 800,
    fetch: async url => {
      pedidos.push(String(url));
      if (String(url).startsWith("/api/hq")) return { ok: true, status: 200, json: async () => ({ pinos: o.pinos || [] }) };
      const corpo = String(url).includes("t=contatos") ? { contatos } : (o.lista ? o.lista(store.get("userKey")) : { aparelhos: [] });
      return { ok: corpo.status ? false : true, status: corpo.status || 200, json: async () => corpo };
    },
    ST: { pg: o.pg || "clientes" }, rTblChamado: 0, expirou: 0,
    _sessaoExpirou() { ctx.expirou++; }
  };
  ctx.window = ctx;
  ctx.rTbl = () => { ctx.rTblChamado++; };
  ctx.pagina = pagina; ctx.janela = janela; ctx.ouvintes = ouvintes; ctx.menu = () => menu;
  vm.createContext(ctx);
  vm.runInContext("var DASHBOARD_DATA=" + JSON.stringify({ clientes }) + ";var CL_EXCL=new Set(['RESERVA TECNICA']);", ctx);
  vm.runInContext(fs.readFileSync(ARQ_JS, "utf8"), ctx, { filename: "celulares.js" });
  return { ctx, pedidos };
}
const espera = () => new Promise(r => setTimeout(r, 10));

test("guia Clientes: busca os contatos uma vez, desenha o número com link e escapa o que vem do banco", async () => {
  const contatos = [
    { id: 1, cliente: "AGUAS CLARAS - PORTARIA", cliente_vinculado: "", numero: "(19) 91111-2073", login_zello: "teste225" },
    { id: 2, cliente: "AGUAS CLARAS - <img src=x onerror=alert(1)>", cliente_vinculado: "", numero: "\"><script>x</script>", login_zello: "<b>zello</b>" },
    { id: 3, cliente: "RESERVA TECNICA", cliente_vinculado: "", numero: "19999999999", login_zello: "r" }
  ];
  const { ctx, pedidos } = navegador(contatos, [{ NOME: "AGUAS CLARAS" }, { NOME: "RESERVA TECNICA" }]);
  assert.equal(ctx.celCelularHtml({ NOME: "AGUAS CLARAS" }), '<span class="cel-sem">—</span>', "antes de carregar: traço");
  ctx.celContatosCarregar();
  ctx.celContatosCarregar(); // a segunda chamada não pede de novo
  await espera();
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0], "/api/rh?modulo=celulares&t=contatos");
  assert.equal(ctx.rTblChamado, 1, "redesenha a tabela de clientes quando chegam os contatos");
  const cel = ctx.celCelularHtml({ NOME: "AGUAS CLARAS" });
  const zel = ctx.celZelloHtml({ NOME: "AGUAS CLARAS" });
  assert.ok(cel.includes('href="tel:+5519911112073"'));
  assert.ok(cel.includes("(19) 91111-2073"));
  assert.ok(cel.includes(">PORTARIA<"));
  assert.ok(zel.includes("teste225"));
  for (const h of [cel, zel]) {
    assert.ok(!/<img|<script|<b>/i.test(h), "nada do banco vira HTML: " + h);
  }
  assert.equal(ctx.celCelularHtml({ NOME: "RESERVA TECNICA" }), '<span class="cel-sem">—</span>', "reserva técnica não é cliente");
  const txt = ctx.celContatosTexto("AGUAS CLARAS");
  assert.ok(txt.numeros.includes("19911112073"), "a busca acha pelo número sem máscara");
  assert.ok(txt.zellos.includes("teste225"));
});

test("guia Clientes: outra pessoa na mesma aba não usa os contatos da anterior", async () => {
  const { ctx, pedidos } = navegador([{ id: 1, cliente: "AGUAS CLARAS", numero: "19911112073", login_zello: "z" }], [{ NOME: "AGUAS CLARAS" }]);
  ctx.celContatosCarregar(); await espera();
  ctx.sessionStorage.setItem("userKey", "outra");
  assert.equal(ctx.celContatosDe("AGUAS CLARAS"), null);
  ctx.celContatosCarregar(); await espera();
  assert.equal(pedidos.length, 2);
});

test("sessão que cai: fecha a janela aberta (pode ser a das senhas) e esquece lista e contatos", async () => {
  const lista = () => ({ aparelhos: [{ id: 1, cliente: "POSTO SECRETO", tipo: "POSTO", situacao: "ATIVO", com: [], pend: [] }] });
  const { ctx } = navegador([{ id: 1, cliente: "AGUAS CLARAS", numero: "19911112073", login_zello: "z" }], [{ NOME: "AGUAS CLARAS" }], { pg: "celulares", lista });
  ctx.sessionStorage.setItem("userKey", "joaoygor");
  ctx.celContatosCarregar(); ctx.celLoad(); await espera();
  assert.ok(ctx.pagina.innerHTML.includes("POSTO SECRETO"));
  ctx._sessaoExpirou("Sua sessão expirou.");
  assert.equal(ctx.expirou, 1, "o aviso original continua acontecendo");
  assert.equal(ctx.janela.removido, true, "a janela some antes da tela de login aparecer");
  assert.equal(ctx.pagina.innerHTML, "");
  assert.equal(ctx.celContatosDe("AGUAS CLARAS"), null);
});

test("outra pessoa entra na mesma aba parada em Celulares: o redesenho não mostra a lista anterior", async () => {
  const lista = quem => quem === "joaoygor"
    ? { aparelhos: [{ id: 1, cliente: "POSTO SECRETO", tipo: "POSTO", situacao: "ATIVO", com: [], pend: [] }] }
    : { status: 403, error: "Só quem tem a guia Celulares." };
  const { ctx } = navegador([], [], { pg: "celulares", lista });
  ctx.sessionStorage.setItem("userKey", "joaoygor");
  ctx.celLoad(); await espera();
  assert.ok(ctx.pagina.innerHTML.includes("POSTO SECRETO"));
  ctx.sessionStorage.setItem("userKey", "carlos"); // entrou sem recarregar a página
  ctx.celRender();
  assert.ok(!ctx.pagina.innerHTML.includes("POSTO SECRETO"));
  await espera();
  assert.ok(!ctx.pagina.innerHTML.includes("POSTO SECRETO"));
  assert.ok(ctx.pagina.innerHTML.includes("só para administradores"), ctx.pagina.innerHTML);
});

test("a janela da guia fica abaixo da tela de login", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "assets", "celulares", "celulares.css"), "utf8");
  const z = +(css.match(/\.cel-ov\{[^}]*z-index:(\d+)/) || [])[1];
  const login = +(HTML.match(/\.login-overlay\{[^}]*z-index:(\d+)/) || [])[1];
  assert.ok(z > 0 && login > 0 && z < login, z + " < " + login);
});

// ── ligação com o index.html ─────────────────────────────────────────────
test("index.html: guia no menu só para administrador, página, navegação e o módulo no fim", () => {
  assert.ok(HTML.includes(`<div class="ni" data-pg="celulares" data-perm="admin" onclick="navTo('celulares',this)">`));
  assert.ok(HTML.includes('<div class="page" id="pg-celulares">'));
  assert.ok(HTML.includes('<div id="cel-content">'));
  assert.ok(HTML.includes(`else if(p==="celulares"){if(typeof celLoad==="function")celLoad();}`));
  assert.ok(HTML.includes(`celulares:()=>{if(typeof celRender==="function")celRender();}`));
  assert.ok(HTML.includes('celulares:"Celulares — Controle dos Aparelhos"'));
  const css = HTML.indexOf('<link rel="stylesheet" href="/assets/celulares/celulares.css"><script src="/assets/celulares/celulares.js"></script>');
  assert.ok(css > HTML.indexOf('<script src="/assets/comunicado/comunicado.js"></script>'), "depois dos outros módulos");
});

test("index.html: guia Clientes ganha Celular e Login Zello, com desenho próprio e busca pelo texto", () => {
  assert.ok(HTML.includes('cols:["NOME","TURNO","AREA","EMPRESA","ENDERECO","CELULAR","ZELLO"],hdrs:["Cliente","Turno","Supervisor/Área","Empresa","Endereço","Celular","Login Zello"]'));
  assert.ok(HTML.includes('ENDERECO:(typeof celEnderecoTexto==="function"&&celEnderecoTexto(c.NOME))||""'));
  assert.ok(HTML.includes('if(typeof celEnderecosCarregar==="function")celEnderecosCarregar();'));
  assert.ok(HTML.includes(`if(cfg.fmt&&cfg.fmt[c])return '<td>'+cfg.fmt[c](r)+'</td>';`));
  assert.ok(HTML.includes('CELULAR:ct?ct.numeros:"",ZELLO:ct?ct.zellos:""'));
  assert.ok(HTML.includes('if(typeof celContatosCarregar==="function")celContatosCarregar();'));
});

test("guia Clientes: endereço do mapa vira botão com Waze e Google Maps (ponto exato por coordenada, aproximado pelo texto)", async () => {
  const pinos = [
    { cliente: "AGUAS CLARAS", lat: -22.95, lon: -47.11, precisao: "rua+numero", logradouro: "RUA DA CERAMICA", numero: "100", bairro: "JD SAO JOSE", cidade: "CAMPINAS" },
    { cliente: "POSTO LONGE", lat: -22.9, lon: -47.0, precisao: "cidade", logradouro: "RUA <b>X</b>", numero: "", bairro: "", cidade: "INDAIATUBA" }
  ];
  const { ctx, pedidos } = navegador([], [{ NOME: "AGUAS CLARAS" }, { NOME: "POSTO LONGE" }, { NOME: "SEM PINO" }], { pinos });
  assert.equal(ctx.celEnderecoHtml({ NOME: "AGUAS CLARAS" }), '<span class="cel-sem">—</span>', "antes de carregar: traço");
  ctx.celEnderecosCarregar(); ctx.celEnderecosCarregar(); await espera();
  assert.equal(pedidos.filter(p => p.startsWith("/api/hq?mapa=1")).length, 1, "busca uma vez só");
  assert.equal(ctx.rTblChamado, 1);
  const h = ctx.celEnderecoHtml({ NOME: "AGUAS CLARAS" });
  assert.ok(h.includes("RUA DA CERAMICA, 100") && h.includes("JD SAO JOSE - CAMPINAS"));
  assert.ok(!h.includes("aproximado"));
  const ap = ctx.celEnderecoHtml({ NOME: "POSTO LONGE" });
  assert.ok(ap.includes("local aproximado"));
  assert.ok(!/<b>/.test(ap), "nada do banco vira HTML");
  assert.equal(ctx.celEnderecoHtml({ NOME: "SEM PINO" }), '<span class="cel-sem">—</span>');
  assert.ok(ctx.celEnderecoTexto("AGUAS CLARAS").includes("CAMPINAS"), "a busca acha pelo endereço");
  const clique = (chave) => ctx.ouvintes.click.forEach(f => f({ target: { closest: s => (s === "[data-cel-end]" ? { dataset: { celEnd: chave }, getBoundingClientRect: () => ({ left: 10, top: 50, bottom: 70 }) } : null) } }));
  clique("AGUAS CLARAS");
  const m = ctx.menu();
  assert.ok(m, "o clique abre o menu");
  assert.ok(m.innerHTML.includes('href="https://waze.com/ul?ll=-22.95,-47.11&amp;navigate=yes"'));
  assert.ok(m.innerHTML.includes('href="https://www.google.com/maps/search/?api=1&amp;query=-22.95,-47.11"'));
  clique("AGUAS CLARAS");
  assert.equal(ctx.menu(), null, "clicar de novo fecha");
  clique("POSTO LONGE");
  assert.ok(ctx.menu().innerHTML.includes("https://waze.com/ul?q=RUA%20%3Cb%3EX%3C%2Fb%3E%20-%20INDAIATUBA%2C%20Brasil&amp;navigate=yes"), "aproximado: vai pelo texto");
});

test("guia Clientes: outra pessoa na mesma aba não usa os endereços da anterior", async () => {
  const { ctx } = navegador([], [{ NOME: "A" }], { pinos: [{ cliente: "A", lat: 1, lon: 2, precisao: "rua+numero", logradouro: "RUA", numero: "1", bairro: "", cidade: "X" }] });
  ctx.celEnderecosCarregar(); await espera();
  assert.ok(ctx.celEnderecoTexto("A"));
  ctx.sessionStorage.setItem("userKey", "outra");
  assert.equal(ctx.celEnderecoTexto("A"), null);
});
