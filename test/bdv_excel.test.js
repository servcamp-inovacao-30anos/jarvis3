// Excel conectado do relatório de Coberturas do supervisor (BDV): a chave só abre a planilha do BDV,
// vence, pode ser cancelada; e a tabela que o Excel lê traz as idas em número e texto certos.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const _auth = require("../api/_auth");
const bdvApi = require("../api/_bdv");
const XL = require("../api/_bdv_excel");
const rh = require("../api/rh");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ida = (posto, data, horario, extra) => ({ NOME: "FRANK", DATA: data, DESTINO: posto + "/" + posto, HORARIO: horario, KM: "120,5", TEMPO: "1/1/00 10:28", MOTIVO: "COBERTURA", ...extra });
const falta = (re, posto, data) => ({ RE: re, NOME: "PESSOA " + re, DATA: data, LOCAL: posto, ABONO: "I" });
const ativo = (re, posto, jornada) => ({ RE: re, LOCAL: posto, JORNADA: jornada });
function tabelas() {
  const bdv = [ida("POSTO A", dia(-3), "9:30:00"), ida("POSTO A", dia(-3), "9:40:00", { DESTINO: "POSTO B/POSTO B" }), ida("POSTO B", dia(-2), "6:05:00", { NOME: "PAULO" }),
    ida("SERV CAMP TERCEIRIZACAO/BASE", dia(-2), "6:10:00")];
  return { dashboard_snapshots: [{ id: 1, created_at: dia(0) + "T15:00:00Z", data: { bdvCobertura: bdv, faltas: [falta(1, "POSTO A", dia(-3))], ativos: [ativo(1, "POSTO A", "12H 06:00 - 18:00"), ativo(2, "POSTO B", "12H 06:00 - 18:00")], cobertura: [] } }], fm_auditoria: [] };
}
const planilha = extra => chamar(rh, { ...extra, method: "GET", query: { modulo: "bdv", t: "planilha", ...(extra && extra.query) } });
const chave = async usuario => (await chamar(rh, { method: "POST", query: { modulo: "bdv", t: "chave_excel" }, usuario })).body;

test("a tabela de idas traz o que o Excel precisa: números, textos e a folha de cada ida", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const r = await planilha({ usuario: "raphaelvictor", query: { formato: "json" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const t = r.body.tabelas.idas;
  assert.deepEqual(t.cab, XL.IDAS_CAB);
  assert.equal(t.cab.length, 15);
  assert.equal(t.linhas.length, 3, "a ida à sede não é posto e não vem");
  const l = t.linhas[0];
  assert.equal(l[0], XL.serial(dia(-3)), "data em número de série");
  assert.equal(l[2], "FRANK");
  assert.equal(l[3], "POSTO A");
  assert.equal(l[4], "Falta");
  assert.equal(l[7], "06:00", "início da vaga de quem faltou");
  assert.equal(l[8], "09:30");
  assert.equal(l[9], 210, "minutos de atraso, inteiro");
  assert.equal(l[10], "Mais de 3h de atraso");
  assert.equal(l[12], XL.folhaDe(dia(-3)).rotulo);
  assert.equal(l[13], 120500, "km vai em metros (inteiro), para não depender do decimal do Excel");
  assert.equal(l[14], 628, "tempo do dia em minutos");
  assert.ok(t.linhas.every(x => x.every(c => typeof c === "number" || typeof c === "string")), "nada de objeto ou nulo");
});

test("listas: 'Todos' primeiro, folha de hoje logo depois, supervisores e postos em ordem", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const r = await planilha({ usuario: "raphaelvictor", query: { formato: "json" } });
  const L = r.body.tabelas.listas.linhas;
  assert.deepEqual([L[0][0], L[0][3], L[0][4], L[0][5]], ["Todas as folhas", "Todos", "Todos", "Todos os motivos"]);
  assert.equal(L[1][0], XL.folhaDe(hoje).rotulo, "a folha de hoje vem logo depois");
  assert.deepEqual(L.slice(1).map(l => l[3]).filter(Boolean), ["FRANK", "PAULO"]);
  assert.deepEqual(L.slice(1).map(l => l[4]).filter(Boolean), ["POSTO A", "POSTO B"]);
  assert.deepEqual(L.map(l => l[5]).filter(Boolean), XL.MOTIVOS);
});

test("folha: do dia 26 ao dia 25, também na virada do ano", () => {
  assert.deepEqual(XL.folhaDe("2026-10-05"), { inicio: "2026-09-26", fim: "2026-10-25", rotulo: "26/09/2026 a 25/10/2026" });
  assert.equal(XL.folhaDe("2026-10-26").rotulo, "26/10/2026 a 25/11/2026");
  assert.equal(XL.folhaDe("2026-12-26").rotulo, "26/12/2026 a 25/01/2027");
  assert.equal(XL.folhaDe("2027-01-10").rotulo, "26/12/2026 a 25/01/2027");
});

test("o endereço do Excel devolve HTML com uma tabela só, e escapa o que vier do banco", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const r = await planilha({ usuario: "raphaelvictor", query: { tabela: "idas" } });
  assert.equal(r.statusCode, 200);
  assert.match(r.cab["Content-Type"], /text\/html/);
  assert.equal((r.body.match(/<table>/g) || []).length, 1);
  assert.match(r.body, /<th>Supervisor<\/th>/);
  assert.match(r.body, /<td>POSTO A<\/td>/);
  assert.equal((await planilha({ usuario: "raphaelvictor", query: { tabela: "inexistente" } })).statusCode, 400);
  assert.ok(XL.html({ cab: ["A"], linhas: [["<b>&\"x\"</b>"]] }).includes("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;"));
});

test("a planilha só abre para a diretoria e a coordenação (sessão) ou com a chave do Excel", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  assert.equal((await planilha({ query: { tabela: "idas" } })).statusCode, 401, "sem login");
  assert.equal((await planilha({ usuario: "adrianomacedo", query: { tabela: "idas" } })).statusCode, 401, "supervisor comum: não está entre quem lê o relatório");
  assert.equal((await planilha({ usuario: "eduardocipriano", query: { tabela: "idas" } })).statusCode, 200);
});

test("chave do Excel das Coberturas: só quem lê gera; vale só na planilha do BDV; a do Faltas não abre esta e vice-versa", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  const negada = await chamar(rh, { method: "POST", query: { modulo: "bdv", t: "chave_excel" }, usuario: "adrianomacedo" });
  assert.equal(negada.statusCode, 403);
  const g = await chave("raphaelvictor");
  assert.ok(g.ok && g.dias === 90);
  const p = _auth.verify(g.chave, process.env.AUTH_SECRET);
  assert.equal(p.s, "xlb", "chave de escopo restrito, só do BDV");
  assert.ok(p.exp - Date.now() > 89 * 86400000);
  assert.equal((await planilha({ query: { tabela: "idas", k: g.chave } })).statusCode, 200, "no endereço, como o Excel manda");
  assert.equal((await planilha({ token: g.chave, query: { formato: "json" } })).statusCode, 200, "no cabeçalho também");
  // em qualquer outra rota ela é recusada
  for (const q of [{ modulo: "bdv", t: "coberturas", de: dia(-5), ate: dia(0) }, { modulo: "faltas", t: "casos" }, { modulo: "faltas", t: "planilha", tabela: "casos" }, { t: "vagas" }]) {
    assert.equal((await chamar(rh, { method: "GET", query: q, token: g.chave })).statusCode, 401, "recusa em " + JSON.stringify(q));
    assert.equal((await chamar(rh, { method: "GET", query: { ...q, k: g.chave } })).statusCode, 401, "recusa com ?k= em " + JSON.stringify(q));
  }
  assert.equal((await chamar(rh, { method: "POST", query: { modulo: "bdv", t: "chave_excel" }, token: g.chave })).statusCode, 401, "nem gera outra chave com ela");
  // a chave do Faltas x Medidas (escopo xl) não abre a planilha do BDV
  const doFaltas = _auth.sign("raphaelvictor", process.env.AUTH_SECRET, 24, { s: "xl", i: Date.now() });
  assert.equal((await planilha({ query: { tabela: "idas", k: doFaltas } })).statusCode, 401);
});

test("sem chave, chave inventada, forjada ou vencida: não abre", async () => {
  bdvApi._zerarCache(); supabaseFalso(tabelas());
  assert.equal((await planilha({ query: { tabela: "idas", k: "abc.def" } })).statusCode, 401);
  assert.equal((await planilha({ query: { tabela: "idas", k: _auth.sign("raphaelvictor", "outro-segredo", 24, { s: "xlb", i: Date.now() }) } })).statusCode, 401);
  assert.equal((await planilha({ query: { tabela: "idas", k: _auth.sign("raphaelvictor", process.env.AUTH_SECRET, -1, { s: "xlb", i: Date.now() - 2 * 3600000 }) } })).statusCode, 401);
  // chave de quem não lê o relatório (ex.: o acesso foi tirado)
  assert.equal((await planilha({ query: { tabela: "idas", k: _auth.sign("adrianomacedo", process.env.AUTH_SECRET, 24, { s: "xlb", i: Date.now() }) } })).statusCode, 401);
});

test("cancelar as chaves: as emitidas antes deixam de valer; as novas valem", async () => {
  bdvApi._zerarCache(); const t = tabelas(); supabaseFalso(t);
  const velha = (await chave("raphaelvictor")).chave;
  assert.equal((await planilha({ query: { tabela: "idas", k: velha } })).statusCode, 200);
  assert.equal((await chamar(rh, { method: "POST", query: { modulo: "bdv", t: "revogar_excel" }, usuario: "adrianomacedo" })).statusCode, 403, "quem não lê o relatório não cancela");
  await new Promise(r => setTimeout(r, 15));
  assert.equal((await chamar(rh, { method: "POST", query: { modulo: "bdv", t: "revogar_excel" }, usuario: "raphaelvictor" })).statusCode, 200);
  const ev = t.fm_auditoria.filter(e => e.acao === "BDV_XL_REVOGAR");
  assert.equal(ev.length, 1);
  if (!ev[0].criado_em) ev[0].criado_em = new Date().toISOString();
  assert.equal((await planilha({ query: { tabela: "idas", k: velha } })).statusCode, 401, "a chave antiga foi cancelada");
  await new Promise(r => setTimeout(r, 15));
  const nova = (await chave("raphaelvictor")).chave;
  assert.equal((await planilha({ query: { tabela: "idas", k: nova } })).statusCode, 200, "a nova vale");
  // cancelar chaves do BDV não mexe nas do Faltas x Medidas
  assert.equal(t.fm_auditoria.filter(e => e.acao === "XL_REVOGAR").length, 0);
});

test("montar traz todas as idas que recebe (o corte em MAX_IDAS, as mais recentes, é feito na rota)", async () => {
  bdvApi._zerarCache();
  const muitas = Array.from({ length: XL.MAX_IDAS + 25 }, (_, i) => ({ data: dia(-(XL.MAX_IDAS + 25 - i)), supervisor: "FRANK", posto: "POSTO A", destino: "POSTO A", motivo: "COBERTURA", situacao: "NO_PRAZO", chegada: "07:00", inicio: "06:30", diferenca_min: 30, fonte_inicio: "FALTA" }));
  const d = XL.montar(muitas, hoje, {});
  assert.equal(d.tabelas.idas.linhas.length, XL.MAX_IDAS + 25, "o corte é na rota, não no montar");
});

test("o botão e o texto do Excel conectado das Coberturas existem na tela, e as consultas não deslocam células", () => {
  const h = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(h.includes("brConectadoAbrir()"), "botão na tela do relatório");
  assert.ok(h.includes("modulo=bdv&t=planilha&k="), "endereço da consulta");
  assert.ok(h.includes('growShrinkType="overwriteClear"'), "ao encolher o resultado, o Excel limpa sem puxar as fórmulas ao lado (senão viram #REF!)");
});
