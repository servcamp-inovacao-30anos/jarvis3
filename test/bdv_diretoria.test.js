// Visão Diretoria do Relatório de Coberturas: só quatro contas, barrada no servidor, com os mesmos dados do operacional.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const _auth = require("../api/_auth");
const bdvApi = require("../api/_bdv");
const rh = require("../api/rh");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ida = (posto, data, horario) => ({ NOME: "FRANK", DATA: data, DESTINO: posto + "/" + posto, HORARIO: horario, KM: "120", TEMPO: "1/1/00 10:28", MOTIVO: "COBERTURA" });
function tabelas() {
  return { dashboard_snapshots: [{ id: 1, created_at: dia(0) + "T15:00:00Z", data: { bdvCobertura: [ida("POSTO A", dia(-3), "9:30:00"), ida("POSTO B", dia(-2), "6:05:00")], faltas: [{ RE: 1, NOME: "PESSOA 1", DATA: dia(-3), LOCAL: "POSTO A", ABONO: "I" }], ativos: [{ RE: 1, LOCAL: "POSTO A", JORNADA: "12H 06:00 - 18:00" }, { RE: 2, LOCAL: "POSTO B", JORNADA: "12H 06:00 - 18:00" }], cobertura: [] } }], fm_auditoria: [] };
}
const pedir = (t, usuario, extra) => chamar(rh, { method: "GET", query: { modulo: "bdv", t, de: dia(-10), ate: dia(0) }, usuario, ...(extra || {}) });
const QUATRO = ["raphaelvictor", "joaoygor", "ingridycampana", "paulocampana"];

test("as quatro contas abrem a Visão Diretoria e recebem os mesmos dados do operacional", async () => {
  for (const u of QUATRO) {
    bdvApi._zerarCache(); supabaseFalso(tabelas());
    const d = await pedir("diretoria", u), o = await pedir("coberturas", u);
    assert.equal(d.statusCode, 200, u + ": " + JSON.stringify(d.body));
    assert.deepEqual(d.body, o.body, u + ": mesmos dados, para as contas serem iguais nas duas visões");
    assert.equal(d.body.coberturas.length, 2);
  }
});

test("Rafael Andrade foi desligado: as coberturas dele passam para o Carlos Nogueira (qualquer data, operacional e Diretoria)", async () => {
  bdvApi._zerarCache();
  const t = tabelas();
  t.dashboard_snapshots[0].data.bdvCobertura = [
    { ...ida("POSTO A", dia(-3), "9:30:00"), NOME: "RAFAEL ANDRADE DA SILVA" },
    { ...ida("POSTO B", dia(-2), "6:05:00"), NOME: "Rafael  Andrade" },
    { ...ida("POSTO C", dia(-1), "7:00:00"), NOME: "RAFAEL SOUZA" },
    { ...ida("POSTO D", dia(-1), "8:00:00"), NOME: "FRANK" }
  ];
  supabaseFalso(t);
  for (const rota of ["coberturas", "diretoria"]) {
    const r = await pedir(rota, "raphaelvictor");
    const sup = Object.fromEntries(r.body.coberturas.map(x => [x.posto || x.destino, x.supervisor]));
    assert.equal(sup["POSTO A"], "CARLOS NOGUEIRA", rota);
    assert.equal(sup["POSTO B"], "CARLOS NOGUEIRA", rota + ": mesmo com espaços e minúsculas");
    assert.notEqual(sup["POSTO C"], "CARLOS NOGUEIRA", rota + ": outro Rafael não é trocado");
    assert.notEqual(sup["POSTO D"], "CARLOS NOGUEIRA", rota);
  }
});

test("quem lê o relatório operacional mas não está entre as quatro contas é barrado na Visão Diretoria (servidor)", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  for (const u of ["eduardocipriano", "jussilenealmeida", "amauriantonio", "adrianomacedo", "testejoao", "sandraalves"]) {
    const d = await pedir("diretoria", u);
    assert.equal(d.statusCode, 403, u);
    assert.equal(d.body.codigo, "NAO_AUTORIZADO");
    assert.equal(d.body.coberturas, undefined, "nenhum dado vaza na recusa");
  }
  // o operacional deles continua funcionando
  assert.equal((await pedir("coberturas", "eduardocipriano")).statusCode, 200);
  assert.equal((await pedir("coberturas", "jussilenealmeida")).statusCode, 200);
});

test("sem login, com token vencido, forjado ou de escopo restrito (Excel): não passa", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  assert.equal((await pedir("diretoria")).statusCode, 401);
  const forjado = _auth.sign("raphaelvictor", "outro-segredo", 1);
  assert.equal((await pedir("diretoria", undefined, { token: forjado })).statusCode, 401);
  const vencido = _auth.sign("raphaelvictor", process.env.AUTH_SECRET, -1);
  assert.equal((await pedir("diretoria", undefined, { token: vencido })).statusCode, 401);
  const doExcel = _auth.sign("raphaelvictor", process.env.AUTH_SECRET, 24, { s: "xlb", i: Date.now() });
  assert.equal((await pedir("diretoria", undefined, { token: doExcel })).statusCode, 401, "a chave do Excel só abre a planilha");
  const doFaltas = _auth.sign("raphaelvictor", process.env.AUTH_SECRET, 24, { s: "xl", i: Date.now() });
  assert.equal((await pedir("diretoria", undefined, { token: doFaltas })).statusCode, 401);
});

test("sem AUTH_SECRET não há como saber quem pede: a Visão Diretoria nega (e o resto segue como antes)", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const seg = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const d = await chamar(rh, { method: "GET", query: { modulo: "bdv", t: "diretoria", de: dia(-10), ate: dia(0) } });
    assert.equal(d.statusCode, 403);
  } finally { process.env.AUTH_SECRET = seg; }
});

test("a lista de contas é uma só no servidor e na tela, com as chaves do login (nunca o nome)", () => {
  assert.deepEqual([...bdvApi.DIRETORIA].sort(), [...QUATRO].sort());
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const m = h.match(/const BR_DIR=\[([^\]]*)\]/);
  assert.ok(m, "lista na tela");
  assert.deepEqual(m[1].split(",").map(s => s.trim().replace(/"/g, "")).sort(), [...QUATRO].sort());
  // todas existem entre os usuários do login
  const usuarios = require("fs").readFileSync(path.join(__dirname, "..", "api", "users.js"), "utf8");
  QUATRO.forEach(u => assert.ok(usuarios.includes(`"${u}"`), u + " existe no login"));
});

test("tela: a aba só aparece para as quatro contas; os dados vêm da rota exclusiva; o operacional segue igual", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(h.includes('brPedir("GET","diretoria"'), "a Visão Diretoria busca os dados na rota exclusiva");
  assert.ok(/function brAbasHtml\(\)\{\s*if\(!brDirPermitido\(\)\)return"";/.test(h), "sem permissão, nenhuma aba");
  assert.ok(h.includes('if((BR.aba||"op")==="dir"&&brDirPermitido()){vdPinta();return;}'), "o painel operacional só é trocado para quem pode");
  // o painel operacional continua com os mesmos blocos
  ["brKpis(R,A)", "brResumo(f)", 'id="brVis"'].forEach(t => assert.ok(h.includes(t), "operacional preservado: " + t));
});

test("os estilos novos ficam isolados: todo seletor vd- está dentro de #pg-bdvrel", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const i = h.indexOf("\n", h.indexOf("Visão Diretoria: tudo com prefixo vd-")), j = h.indexOf("#pg-bdvrel .br-top{display:flex");
  assert.ok(i > 0 && j > i);
  const linhas = h.slice(i, j).split("\n").filter(l => l.trim() && !l.trim().startsWith("/*") && !l.includes("@keyframes") && !l.trim().startsWith("@media"));
  linhas.forEach(l => assert.ok(/^\s*(html\[data-theme="dark"\] )?#pg-bdvrel /.test(l), "seletor fora do escopo: " + l.slice(0, 80)));
});

test("a resposta informa quando os dados foram atualizados (a Visão Diretoria mostra isso, separado do período)", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const d = await pedir("diretoria", "raphaelvictor");
  assert.equal(d.body.atualizado_em, dia(0) + "T15:00:00Z");
  bdvApi._zerarCache(); supabaseFalso({ dashboard_snapshots: [] });
  assert.equal((await pedir("diretoria", "raphaelvictor")).body.atualizado_em, null, "sem planilha guardada: nulo, nunca uma data inventada");
});

test("excedentes e treinamentos saíram: a rota diretoria_os não existe mais e a Visão Diretoria não pede OS", async () => {
  bdvApi._zerarCache(); supabaseFalso({ dashboard_snapshots: [], fm_auditoria: [] });
  const r = await chamar(rh, { method: "GET", query: { modulo: "bdv", t: "diretoria_os", de: dia(-10), ate: dia(0) }, usuario: "raphaelvictor" });
  assert.ok(r.statusCode >= 400, "rota removida (status " + r.statusCode + ")");
  assert.equal(r.body.os, undefined, "nenhum dado de OS sai");
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const vd = h.slice(h.indexOf("VISÃO DIRETORIA (aba do Relatório de Coberturas)"), h.indexOf("/* ── Excel da diretoria: capa com os números"));
  ["diretoria_os", "xcedente", "reinamento", "Deixado no posto", "vdLig", "osIdx", "cobIdx"].forEach(x => assert.ok(!vd.includes(x), "ainda aparece na tela: " + x));
  assert.ok(!h.includes("brOsParaExcel") && !h.includes("OSX"), "o Excel não busca nem classifica OS");
});

test("Excel: Por supervisor e Por posto trazem o detalhamento (cada cobertura) na mesma aba", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const a = h.indexOf("async function brXlsxMontar("), b = h.indexOf("/* ── Imprimir: prévia em folha A4");
  const x = h.slice(a, b);
  ["const detalhe=(w,dim,gr,r0)", "detalhe(w,dim,gr,tl+4)", "Detalhamento: cada cobertura de cada supervisor", "Detalhamento: cada cobertura de cada posto", "Supervisor (quem cobriu)", "w.addTable({name:dim===\"sup\"?\"DetalheSupervisor\":\"DetalhePosto\"", "filterButton:true"].forEach(t => assert.ok(x.includes(t), "falta no Excel: " + t));
  assert.ok(!/ysplit/i.test(x.slice(x.indexOf("const tabela="), x.indexOf("const tabela=") + 400)), "o cabeçalho do resumo não fica congelado em cima do detalhamento");
});

test("Excel conectado: abas Detalhe por supervisor e Detalhe por posto, ligadas às chaves V e W da aba Dados", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const x = h.slice(h.indexOf("async function brXlsxConectado("), h.indexOf("/* ═════════ PAINEL DA SUPERVISÃO"));
  ["addWorksheet(\"Detalhe por supervisor\"", "addWorksheet(\"Detalhe por posto\"", "const detalhe=(ws,porPosto)=>", "detalhe(wsDS,false)", "detalhe(wsDO,true)", "Chave detalhe sup.", "Chave detalhe posto", "put(22,", "put(23,", "SMALL(${KEY},ROW()-"].forEach(t => assert.ok(x.includes(t), "falta no Excel conectado: " + t));
  assert.ok(!x.includes("diretoria_os"), "o Excel conectado não leva OS: a chave dele não pode abrir dado da Diretoria");
});

test("tela: busca em cada coluna (nome ou RE, sem acento); número casa com o começo da palavra", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const a = h.indexOf("function vdBuscaFn(q){"), b = h.indexOf("const vdTxtCob");
  assert.ok(a > 0 && b > a);
  const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const f = new Function("bdvNorm", h.slice(a, b) + "; return vdBuscaFn;")(norm);
  assert.equal(f(""), null, "sem texto: sem filtro");
  const m = f("jose  nogu");
  assert.ok(m("CARLOS NOGUEIRA JOSÉ DA SILVA") && !m("CARLOS NOGUEIRA"), "todas as palavras, sem acento");
  const re = f("110");
  assert.ok(re("JULIANA 110 POSTO 01") && re("X 1100") && !re("X 2110") && !re("POSTO 01"), "número: começo de palavra");
  ["vdBusca(", "vdLimpa(", "vdBuscaHtml(", 'id="vdQ${c}"', 'vdBuscaHtml("p"', 'vdBuscaHtml("s"'].forEach(x => assert.ok(h.includes(x), "falta: " + x));
});

test("tela da Visão Diretoria: só o que foi pedido (sem comparações com período anterior); dados pelas rotas exclusivas", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const vd = h.slice(h.indexOf("VISÃO DIRETORIA (aba do Relatório de Coberturas)"), h.indexOf("/* ── Excel da diretoria: capa com os números")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(vd.includes('brPedir("GET","diretoria"'), "a rota exclusiva");
  ["Postos que mais precisaram de cobertura", "Supervisores que mais fizeram coberturas", "Coberturas mês a mês"].forEach(t => assert.ok(vd.includes(t), "falta: " + t));
  assert.ok(vd.includes("slice(0,5)"), "só os 5 primeiros postos");
  assert.ok(!/canvas|Período anterior|Comparado com/.test(vd), "sem comparações com período anterior");
});

test("tela: lista → detalhe → dia. Clicar num item abre o calendário dele (o mesmo do Faltas x Medidas); clicar num dia abre a tela ao lado", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const vd = h.slice(h.indexOf("VISÃO DIRETORIA (aba do Relatório de Coberturas)"), h.indexOf("/* ── Excel da diretoria: capa com os números"));
  ["vdSel(", "vdDetalhe(", "vdCalItem(", "vdGaveta(", "vdDia(", "vdFecha", "fm-mg", "fm-mes-h", "vdModo('folha')", "vdModo('mes')", "Folha a folha", "Mês a mês", "3 ou mais"].forEach(x => assert.ok(vd.includes(x), "falta: " + x));
  ["Supervisor que fez", "Quem faltou", "Chegada", "vaga às"].forEach(x => assert.ok(vd.includes(x), "o dia mostra: " + x));
  assert.ok(!vd.includes("vdCalHtml("), "sem calendário solto na coluna: só ao clicar no item");
});

test("períodos do gráfico: meses vão do dia 1 ao último; folhas vão do dia 26 ao dia 25 e levam o nome do mês em que fecham", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const a = h.indexOf("function vdPerGraf(modo){"), b = h.indexOf("/* Pede os dados pela rota exclusiva");
  assert.ok(a > 0 && b > a);
  const mk = hoje => new Function("brHoje", "VD_MESES", h.slice(a, b) + "; return vdPerGraf;")(() => hoje, ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]);
  let f = mk("2026-10-06")("folha");
  assert.equal(f.length, 6);
  assert.deepEqual([f[5].ini, f[5].fimCheio, f[5].rot, f[5].atual, f[5].fim], ["2026-09-26", "2026-10-25", "folha out/26", true, "2026-10-06"], "em 06/10 a folha atual é 26/09 a 25/10, contada só até hoje");
  assert.deepEqual([f[4].ini, f[4].fimCheio], ["2026-08-26", "2026-09-25"]);
  assert.deepEqual([f[0].ini, f[0].fimCheio, f[0].rot], ["2026-04-26", "2026-05-25", "folha mai/26"], "seis folhas, da que fecha em maio à que fecha em outubro");
  f = mk("2026-10-26")("folha");
  assert.deepEqual([f[5].ini, f[5].fimCheio, f[5].rot], ["2026-10-26", "2026-11-25", "folha nov/26"], "a partir do dia 26 já é a folha seguinte");
  f = mk("2027-01-10")("folha");
  assert.deepEqual([f[5].ini, f[5].fimCheio], ["2026-12-26", "2027-01-25"], "virada do ano");
  const m = mk("2026-10-06")("mes");
  assert.deepEqual([m[5].ini, m[5].fimCheio, m[5].fim, m[5].rot], ["2026-10-01", "2026-10-31", "2026-10-06", "out/26"]);
  assert.deepEqual([m[0].ini, m[0].fimCheio], ["2026-05-01", "2026-05-31"]);
});
