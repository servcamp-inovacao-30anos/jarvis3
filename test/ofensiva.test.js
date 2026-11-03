// Ofensiva (dias seguidos de uso): regras (api/_ofensiva_regras.js), API (api/_ofensiva.js, via
// /api/rh?modulo=ofensiva) contra um Supabase falso, e o módulo da tela (assets/ofensiva).
// O que mais importa: só dias úteis, só com 3 guias diferentes por clique de verdade, congelamento de 2 por mês,
// e o ranking sem nada além de nome e sequência.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const _auth = require("../api/_auth");
const R = require("../api/_ofensiva_regras");
const rh = require("../api/rh");
const { supabaseFalso, chamar } = require("./_supabase_falso");

// 2026-11-04 é quarta-feira
const QUARTA = "2026-11-04";

// ── regras ──────────────────────────────────────────────────────────────────

test("dia de Brasília e dia útil", () => {
  // 01:30 UTC de 5/11 ainda é 4/11 à noite em Brasília
  assert.equal(R.hojeBR(Date.parse("2026-11-05T01:30:00Z")), "2026-11-04");
  assert.equal(R.ehUtil("2026-11-06"), true, "sexta");
  assert.equal(R.ehUtil("2026-11-07"), false, "sábado");
  assert.equal(R.ehUtil("2026-11-08"), false, "domingo");
  assert.equal(R.somaDias("2026-11-01", -1), "2026-10-31");
});

test("sequência: dias úteis seguidos, fim de semana não quebra e hoje em aberto não zera", () => {
  const c = R.calcular(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"], QUARTA);
  assert.equal(c.sequencia, 7, "sexta e segunda são dias úteis seguidos: o fim de semana no meio não conta");
  assert.equal(c.hojeOk, false);
  assert.equal(c.congelamentosRestantes, 2);
  const c2 = R.calcular(["2026-10-30", "2026-11-02", "2026-11-03", QUARTA], QUARTA);
  assert.equal(c2.sequencia, 4);
  assert.equal(c2.hojeOk, true);
});

test("fim de semana trabalhado não conta (e não muda nada)", () => {
  const c = R.calcular(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], QUARTA);
  assert.equal(c.sequencia, 2, "só sexta e segunda");
});

test("congelamento: um dia útil perdido gasta 1 e a sequência segue; 2 por mês", () => {
  // quinta 29/10 perdida
  const c = R.calcular(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-03", QUARTA], QUARTA);
  assert.equal(c.sequencia, 7, "7 dias feitos: a quinta congelada não soma, mas não quebra");
  assert.equal(c.congeladosNoMes, 0, "o congelamento foi de outubro; novembro está inteiro");
  assert.equal(c.congelamentosRestantes, 2);
  // ontem perdido
  const d = R.calcular(["2026-11-02", QUARTA], QUARTA);
  assert.equal(d.sequencia, 2);
  assert.equal(d.congeladosNoMes, 1);
  assert.equal(d.congelamentosRestantes, 1);
  assert.equal(d.congeladoRecente, true, "terça foi congelada");
});

test("acabaram os congelamentos do mês: a sequência zera e volta a contar do recomeço", () => {
  // 26 e 27 feitos; 28, 29 e 30 perdidos (2 congelamentos e o 3º quebra); 2/11 feito; 3/11 perdido (congelamento de novembro)
  const c = R.calcular(["2026-10-26", "2026-10-27", "2026-11-02"], QUARTA);
  assert.equal(c.melhor, 2);
  assert.equal(c.sequencia, 1);
  assert.equal(c.congeladosNoMes, 1);
  assert.equal(c.congelamentosRestantes, 1);
});

test("sem nenhum dia, ou só com dia futuro/inválido: tudo zerado", () => {
  for (const dias of [[], null, ["2026-11-05"], ["lixo"], ["2026-11-07"]]) {
    const c = R.calcular(dias, QUARTA);
    assert.equal(c.sequencia, 0);
    assert.equal(c.melhor, 0);
    assert.equal(c.congelamentosRestantes, 2);
  }
});

test("hoje no fim de semana: não quebra nada e não pede guia", () => {
  const c = R.calcular(["2026-11-05", "2026-11-06"], "2026-11-07");
  assert.equal(c.sequencia, 2);
  assert.equal(c.hojeOk, false);
});

test("ranking: maior sequência primeiro, empate pelo recorde e depois pelo nome; sequência zero fica de fora", () => {
  const r = R.ranking({
    ana: ["2026-11-02", "2026-11-03", QUARTA],
    beto: ["2026-11-03", QUARTA],
    caio: ["2026-11-03", QUARTA],
    dina: ["2026-09-01"]
  }, QUARTA, { ana: "Ana", beto: "Beto", caio: "Caio" });
  assert.deepEqual(r.map(x => x.user_key), ["ana", "beto", "caio"]);
  assert.equal(r[0].sequencia, 3);
  assert.equal(r[0].nome, "Ana");
  assert.deepEqual(Object.keys(r[0]).sort(), ["guiasHoje", "hojeOk", "melhor", "nome", "sequencia", "user_key"], "só nome, sequência e o andamento de hoje");
});

test("ranking com todos: quem tem 0 também aparece, e durante o dia sobe quem já abriu mais guias", () => {
  const r = R.ranking({ ana: ["2026-11-03"] }, QUARTA, {}, { todos: ["ana", "beto", "caio", "dina"], guiasHoje: { beto: 2, caio: 1 } });
  assert.deepEqual(r.map(x => x.user_key), ["ana", "beto", "caio", "dina"], "sequência 1 de ontem primeiro; os de 0 por guias abertas hoje");
  assert.equal(r[1].guiasHoje, 2);
  assert.equal(r[3].guiasHoje, 0);
  // beto completa o dia: passa a ter sequência 1 e hojeOk; empata com ana e sobe por ter completado hoje
  const depois = R.ranking({ ana: ["2026-11-03"], beto: [QUARTA] }, QUARTA, {}, { todos: ["ana", "beto", "caio", "dina"], guiasHoje: { caio: 1 } });
  assert.deepEqual(depois.map(x => x.user_key), ["beto", "ana", "caio", "dina"]);
  assert.equal(depois[0].guiasHoje, 3);
});

test("só guia com nome de guia vale", () => {
  assert.equal(R.guiaValida("clientes"), true);
  assert.equal(R.guiaValida("rh-vagas_2"), true);
  for (const g of ["", " ", "a b", "<script>", "x".repeat(31), null, 5, "../x"]) assert.equal(R.guiaValida(g), false, String(g));
});

// ── API ─────────────────────────────────────────────────────────────────────

function comRelogio(isoUtc, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(isoUtc);
  return Promise.resolve().then(fn).finally(() => { Date.now = real; });
}
const QUARTA_15H = "2026-11-04T18:00:00Z";
const pedir = (opts) => chamar(rh, Object.assign({ query: { modulo: "ofensiva" } }, opts));
const abrir = (usuario, guia) => pedir({ method: "POST", usuario, body: { guia } });

test("API: 3 guias diferentes completam o dia; a mesma guia de novo não soma", async () => {
  const tabelas = {};
  supabaseFalso(tabelas);
  await comRelogio(QUARTA_15H, async () => {
    let r = await abrir("carlos", "visao");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.guiasHoje, 1);
    assert.equal(r.body.hojeOk, false);
    r = await abrir("carlos", "visao");
    assert.equal(r.body.guiasHoje, 1, "repetir a guia não soma");
    r = await abrir("carlos", "clientes");
    assert.equal(r.body.guiasHoje, 2);
    r = await abrir("carlos", "celulares");
    assert.equal(r.body.guiasHoje, 3);
    assert.equal(r.body.hojeOk, true);
    assert.equal(r.body.sequencia, 1);
    r = await abrir("carlos", "restec");
    assert.equal(r.body.guiasHoje, 3, "passou da meta: nada a mais é guardado");
    assert.equal(tabelas.ofensiva_visitas.length, 3);
    assert.equal(tabelas.ofensiva_dias.length, 1);
    const meu = await pedir({ usuario: "carlos" });
    assert.equal(meu.body.sequencia, 1);
    assert.equal(meu.body.guiasHoje, 3);
    const outro = await pedir({ usuario: "ana" });
    assert.equal(outro.body.sequencia, 0, "cada um tem a sua");
  });
});

test("API: no fim de semana a guia aberta não é guardada", async () => {
  const tabelas = {};
  supabaseFalso(tabelas);
  await comRelogio("2026-11-07T15:00:00Z", async () => {
    const r = await abrir("carlos", "visao");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.util, false);
    assert.equal(r.body.guiasHoje, 0);
    assert.equal((tabelas.ofensiva_visitas || []).length, 0);
  });
});

test("API: guia inválida é recusada e não grava nada", async () => {
  const tabelas = {};
  supabaseFalso(tabelas);
  await comRelogio(QUARTA_15H, async () => {
    for (const guia of ["", "<img onerror=x>", "a".repeat(40), undefined]) {
      const r = await abrir("carlos", guia);
      assert.equal(r.statusCode, 400, String(guia));
    }
    assert.equal((tabelas.ofensiva_visitas || []).length, 0);
  });
});

test("API: o dia é o de Brasília, não o do servidor (UTC)", async () => {
  const tabelas = {};
  supabaseFalso(tabelas);
  // 01:30 UTC de quinta = 22:30 de quarta em Brasília
  await comRelogio("2026-11-05T01:30:00Z", async () => {
    await abrir("carlos", "visao");
    assert.equal(tabelas.ofensiva_visitas[0].dia, QUARTA);
  });
});

test("API: ranking só traz nome e sequência, sem bloqueados, e diz a posição de quem pede", async () => {
  const tabelas = {
    app_users: [{ user_key: "carlos", nome: "Carlos Silva", ativo: true }, { user_key: "ana", nome: "Ana", ativo: true }, { user_key: "fora", nome: "Fora", ativo: false }],
    ofensiva_dias: [
      { user_key: "ana", dia: "2026-11-03" }, { user_key: "ana", dia: QUARTA },
      { user_key: "carlos", dia: QUARTA },
      { user_key: "fora", dia: "2026-11-03" }, { user_key: "fora", dia: QUARTA }
    ]
  };
  supabaseFalso(tabelas);
  await comRelogio(QUARTA_15H, async () => {
    const r = await pedir({ query: { modulo: "ofensiva", t: "ranking" }, usuario: "carlos" });
    assert.equal(r.statusCode, 200);
    const chaves = r.body.ranking.map(x => x.user_key);
    assert.deepEqual(chaves.slice(0, 2), ["ana", "carlos"]);
    assert.ok(!chaves.includes("fora"), "bloqueado não aparece");
    const todosOsAcessos = new Set(require("../api/users").USUARIOS.concat(["ana"]));
    assert.equal(new Set(chaves).size, todosOsAcessos.size, "todo mundo que pode entrar está na lista, mesmo sem nenhum dia");
    assert.ok(r.body.ranking.slice(2).every(x => x.sequencia === 0));
    assert.deepEqual(r.body.voce, { posicao: 2, sequencia: 1 });
    assert.equal(r.body.participantes, todosOsAcessos.size);
    assert.deepEqual(Object.keys(r.body.ranking[0]).sort(), ["guiasHoje", "hojeOk", "melhor", "nome", "sequencia", "user_key"], "só nome, sequência e o andamento de hoje");
  });
});

test("API: sem login é recusado; chave de Excel não vale; sem exigência de token a tela só não mostra", async () => {
  supabaseFalso({});
  assert.equal((await pedir({})).statusCode, 401);
  const chaveXl = _auth.sign("carlos", process.env.AUTH_SECRET, 1, { s: "xl" });
  const comChave = await pedir({ token: chaveXl });
  assert.notEqual(comChave.body && comChave.body.ativo, true, "a chave de planilha não identifica ninguém");
  process.env.AUTH_ENFORCE = "0";
  try {
    const r = await pedir({ usuario: "carlos" });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body, { ativo: false });
  } finally { delete process.env.AUTH_ENFORCE; }
});

test("API: tabela ainda não criada no banco não derruba o painel", async () => {
  supabaseFalso({}, { falhar: (m, c) => /ofensiva_/.test(c) });
  const r = await pedir({ usuario: "carlos" });
  assert.equal(r.statusCode === 200 || r.statusCode === 500, true);
  assert.ok(r.body.ativo === false || r.body.codigo === "ERRO_BANCO", JSON.stringify(r.body));
});

// ── tela ────────────────────────────────────────────────────────────────────

const ARQ_JS = path.join(__dirname, "..", "assets", "ofensiva", "ofensiva.js");
function navegador(evento) {
  const pedidos = [];
  const store = new Map([["userKey", "carlos"], ["logged", "1"]]);
  const els = {};
  const el = id => (els[id] = els[id] || { hidden: true, innerHTML: "", className: "" });
  const ctx = {
    console, Promise, setTimeout, clearTimeout, Date, JSON, Map, Set, Intl,
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: { readyState: "complete", addEventListener() {}, getElementById: id => (id === "sbOfensiva" || id === "of-ranking" || id === "welOfensiva" ? el(id) : null) },
    fetch: async (url, init) => {
      pedidos.push({ url: String(url), metodo: (init && init.method) || "GET", corpo: init && init.body ? JSON.parse(init.body) : null });
      const t = /[?&]t=ranking/.test(String(url));
      const corpo = t ? { util: true, ranking: [{ user_key: "carlos", nome: "<b>Carlos</b>", sequencia: 4, melhor: 4, hojeOk: true, guiasHoje: 3 }, { user_key: "ana", nome: "Ana", sequencia: 0, melhor: 0, hojeOk: false, guiasHoje: 2 }], participantes: 2, voce: { posicao: 1, sequencia: 4 } }
        : { ativo: true, util: true, meta: 3, guiasHoje: 3, sequencia: 4, melhor: 6, hojeOk: true, congelamentosRestantes: 2, congeladosNoMes: 0, congeladoRecente: false };
      return { ok: true, status: 200, json: async () => corpo };
    },
    event: evento, toasts: [], ST: { pg: "visao" },
    setInterval: f => { ctx.tick = f; return 0; }
  };
  ctx.hqToast = t => ctx.toasts.push(t);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ARQ_JS, "utf8"), ctx, { filename: "ofensiva.js" });
  return { ctx, pedidos, els, el };
}
const espera = () => new Promise(r => setTimeout(r, 15));

test("tela: troca de guia por temporizador (Modo TV) não avisa o servidor; clique de verdade avisa uma vez por guia", async () => {
  const tv = navegador(undefined);
  tv.ctx.ofRegistrar("clientes"); await espera();
  assert.equal(tv.pedidos.filter(p => p.metodo === "POST").length, 0, "sem evento do usuário = nada");
  const sintetico = navegador({ isTrusted: false });
  sintetico.ctx.ofRegistrar("clientes"); await espera();
  assert.equal(sintetico.pedidos.filter(p => p.metodo === "POST").length, 0, "evento criado por script também não vale");
  const real = navegador({ isTrusted: true });
  real.ctx.ofRegistrar("clientes"); real.ctx.ofRegistrar("clientes"); real.ctx.ofRegistrar("visao"); await espera();
  const posts = real.pedidos.filter(p => p.metodo === "POST");
  assert.deepEqual(posts.map(p => p.corpo.guia), ["clientes", "visao"], "a mesma guia no mesmo dia vai uma vez só");
});

test("tela: contador no cartão e ranking com o nome escapado; outra pessoa na aba não vê o da anterior", async () => {
  const { ctx, els } = navegador({ isTrusted: true });
  ctx.ofIniciar(); await espera();
  assert.equal(els["of-ranking"].hidden, true, "o ranking não é buscado fora da Base Virtual");
  ctx.ofRankingCarregar(); await espera(); // o navTo('sede') chama isto
  assert.equal(els.sbOfensiva.hidden, false);
  assert.ok(els.sbOfensiva.innerHTML.includes("<b>4</b> dias seguidos"));
  assert.ok(els.sbOfensiva.innerHTML.includes("hoje feito"));
  assert.equal(els["of-ranking"].hidden, false);
  assert.ok(!els["of-ranking"].innerHTML.includes("<b>Carlos</b>"), "nada do banco vira HTML");
  assert.ok(els["of-ranking"].innerHTML.includes("&lt;b&gt;Carlos&lt;/b&gt;"));
  assert.ok(els["of-ranking"].innerHTML.includes("2/3"), "quem tem 0 aparece, com as guias de hoje");
  assert.ok(els["of-ranking"].innerHTML.includes("of-it zero"));
  ctx.sessionStorage.setItem("userKey", "outra");
  ctx.sessionStorage.setItem("logged", "0");
  ctx.ofIniciar();
  assert.equal(els.sbOfensiva.hidden, true);
  assert.equal(els["of-ranking"].hidden, true);
});

test("index.html: ganchos da ofensiva (clique de verdade, cartão do usuário e ranking só na primeira tela)", () => {
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(HTML.includes('if(typeof ofRegistrar==="function")ofRegistrar(p);'));
  assert.ok(HTML.includes('id="sbOfensiva"'));
  assert.ok(HTML.includes('if(typeof ofIniciar==="function")ofIniciar();'));
  assert.equal((HTML.match(/id="of-ranking"/g) || []).length, 1, "o ranking existe em um lugar só");
  assert.ok(HTML.indexOf('id="of-ranking"') > HTML.indexOf('id="pg-sede"') && HTML.indexOf('id="of-ranking"') < HTML.indexOf('id="hq-content"'), "dentro da Base Virtual");
  assert.ok(HTML.includes('if(p==="sede"&&typeof ofRankingCarregar==="function")ofRankingCarregar();'));
  assert.ok(HTML.includes('/assets/ofensiva/ofensiva.js'));
});

test("tela: a ofensiva aparece na tela de boas-vindas, mesmo quando o estado chega depois dela abrir", async () => {
  const { ctx, els } = navegador({ isTrusted: true });
  ctx.ofBoasVindas(); // a tela abriu antes de o servidor responder: nada para mostrar ainda
  assert.equal(els.welOfensiva.innerHTML, "");
  ctx.ofIniciar(); await espera(); // o estado chega e a tela aberta se atualiza
  assert.ok(els.welOfensiva.innerHTML.includes("4 dias seguidos"));
  assert.ok(els.welOfensiva.innerHTML.includes("Hoje já está feito"));
});

test("index.html: a tela de boas-vindas tem o lugar da ofensiva e fica tempo para ler", () => {
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(HTML.includes('<div id="welOfensiva"></div>'));
  assert.ok(HTML.includes('if(typeof ofBoasVindas==="function")ofBoasVindas();'));
});

test("tela: com a Base Virtual aberta o ranking se atualiza sozinho; em outra guia não busca nada", async () => {
  const { ctx, pedidos } = navegador({ isTrusted: true });
  await espera();
  const antes = () => pedidos.filter(p => /t=ranking/.test(p.url)).length;
  ctx.tick(); await espera();
  assert.equal(antes(), 0, "fora da Base Virtual não busca");
  ctx.ST.pg = "sede";
  ctx.tick(); await espera();
  assert.equal(antes(), 1);
  ctx.tick(); await espera();
  assert.equal(antes(), 2, "a cada volta do relógio busca de novo");
});
