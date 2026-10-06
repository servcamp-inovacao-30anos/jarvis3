// Excel conectado do Faltas x Medidas: a chave só abre a planilha, vence, pode ser cancelada,
// e a tabela que o Excel lê traz os casos (com datas em número de série e sem "26/09" solto).
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const _auth = require("../api/_auth");
const XL = require("../api/_faltas_excel");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const planilha = extra => chamar(rh, { ...extra, method: "GET", query: { modulo: "faltas", t: "planilha", ...(extra && extra.query) } });
const faltas = (re, nome, posto, sup, dias) => dias.map(n => ({ re, data: dia(n), codigo: "I", nome, cargo: "PORTEIRO (A)", posto, supervisor: sup, escala: "5X2 SDF", tipo: "CONTRATO" }));
function tabelas() {
  const t = { fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] };
  t.fm_faltas.push(...faltas(700, "CARLA", "POSTO A", "FRANK", [-6, -5, -4]), ...faltas(701, "JOAO", "POSTO B", "PAULO", [-3]));
  t.fm_medidas.push({ chave: "HIST|1", re: 700, data: dia(-100), tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO", nome: "CARLA", local: "POSTO A" },
    { chave: "HIST|2", re: 700, data: dia(-60), tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 2, fase: "CONCLUIDO", nome: "CARLA", local: "POSTO A" });
  return t;
}

test("a tabela de casos traz o que o Excel precisa, em número e texto certos", async () => {
  supabaseFalso(tabelas());
  const r = await planilha({ usuario: "qualquer", query: { formato: "json" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const c = r.body.tabelas.casos;
  assert.deepEqual(c.cab, XL.CASOS_CAB);
  assert.equal(c.cab.length, 19);
  assert.equal(c.linhas.length, 2);
  const carla = c.linhas.find(l => l[0] === 700);
  assert.equal(carla[1], "CARLA");
  assert.equal(typeof carla[9], "number", "1ª falta é número de série do Excel");
  assert.equal(carla[9], XL.serial(dia(-6)));
  assert.equal(carla[10], 3, "3 faltas");
  assert.match(carla[11], /^(dom|seg|ter|qua|qui|sex|sáb) \d\d\/\d\d( · |$)/, "datas com dia da semana, para não virar data no Excel");
  assert.equal(carla[16], 2, "duas medidas no ano");
  assert.ok(["", "COORD"].includes(carla[17]), "sem medida: ou segue em aberto (sem regra especial) ou, se a falta continuou, vai para a coordenação (depende do dia da semana de hoje)");
  assert.equal(carla[18] !== "", carla[17] === "COORD", "só o caso que a coordenação decide traz motivo");
});

test("listas e reincidência: caixas de escolha começam com 'Todos' e a reincidente aparece", async () => {
  supabaseFalso(tabelas());
  const r = await planilha({ usuario: "qualquer", query: { formato: "json" } });
  const L = r.body.tabelas.listas.linhas;
  assert.equal(L[0][0], "Todas as folhas");
  assert.equal(L[0][3], "Todos");
  assert.ok(L.some(l => l[3] === "FRANK") && L.some(l => l[3] === "PAULO"));
  assert.ok(L.some(l => l[4] === "POSTO A" && l[5] === "FRANK"), "posto com o supervisor dele");
  assert.ok(L[1][0] && /\d\d\/\d\d a \d\d\/\d\d/.test(L[1][0]), "a folha de hoje vem logo depois");
  const rein = r.body.tabelas.reinc.linhas;
  assert.equal(rein.length, 1);
  assert.equal(rein[0][1], 700);
  assert.equal(rein[0][4], 2);
  assert.equal(rein[0][5], "Suspensão de 2 dia(s)", "a última medida é a mais recente");
});

test("o endereço do Excel devolve HTML com uma tabela só", async () => {
  supabaseFalso(tabelas());
  const r = await planilha({ usuario: "qualquer", query: { tabela: "casos" } });
  assert.equal(r.statusCode, 200);
  assert.match(r.cab["Content-Type"], /text\/html/);
  assert.equal((r.body.match(/<table>/g) || []).length, 1);
  assert.match(r.body, /<th>Colaborador<\/th>/);
  assert.match(r.body, /<td>CARLA<\/td>/);
  const x = await planilha({ usuario: "qualquer", query: { tabela: "inexistente" } });
  assert.equal(x.statusCode, 400);
});

test("HTML escapa o que vier do banco", () => {
  const h = XL.html({ cab: ["A"], linhas: [["<b>&\"x\"</b>"]] });
  assert.ok(!h.includes("<b>"));
  assert.ok(h.includes("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;"));
});

test("chave do Excel: só aprovador gera; vale na planilha e em nenhuma outra rota", async () => {
  supabaseFalso(tabelas());
  const negada = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "chave_excel" }, usuario: "supervisor.fulano" });
  assert.equal(negada.statusCode, 403);
  const g = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "chave_excel" }, usuario: "aprovador" });
  assert.equal(g.statusCode, 200);
  const chave = g.body.chave;
  assert.ok(chave && g.body.dias === 90);
  const p = _auth.verify(chave, process.env.AUTH_SECRET);
  assert.equal(p.s, "xl", "chave de escopo restrito");
  assert.ok(p.exp - Date.now() > 89 * 86400000);
  // no endereço (como o Excel manda)
  const ok = await planilha({ query: { tabela: "casos", k: chave } });
  assert.equal(ok.statusCode, 200);
  // no cabeçalho também
  const ok2 = await planilha({ token: chave, query: { formato: "json" } });
  assert.equal(ok2.statusCode, 200);
  // em qualquer outra rota ela é recusada, no cabeçalho ou no endereço
  for (const q of [{ modulo: "faltas", t: "casos" }, { modulo: "faltas", t: "historico" }, { modulo: "bdv", t: "coberturas" }, { t: "vagas" }]) {
    const a = await chamar(rh, { method: "GET", query: q, token: chave });
    assert.equal(a.statusCode, 401, "recusa em " + JSON.stringify(q));
    const b = await chamar(rh, { method: "GET", query: { ...q, k: chave } });
    assert.equal(b.statusCode, 401, "recusa com ?k= em " + JSON.stringify(q));
  }
  // nem dá para gerar outra chave com ela
  const outra = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "chave_excel" }, token: chave });
  assert.equal(outra.statusCode, 401);
});

test("sem chave ou com chave inventada, a planilha não abre", async () => {
  supabaseFalso(tabelas());
  assert.equal((await planilha({ query: { tabela: "casos" } })).statusCode, 401);
  assert.equal((await planilha({ query: { tabela: "casos", k: "abc.def" } })).statusCode, 401);
  const forjada = _auth.sign("aprovador", "outro-segredo", 24, { s: "xl", i: Date.now() });
  assert.equal((await planilha({ query: { tabela: "casos", k: forjada } })).statusCode, 401);
});

test("chave vencida não abre", async () => {
  supabaseFalso(tabelas());
  const vencida = _auth.sign("aprovador", process.env.AUTH_SECRET, -1, { s: "xl", i: Date.now() - 2 * 3600000 });
  assert.equal((await planilha({ query: { tabela: "casos", k: vencida } })).statusCode, 401);
});

test("cancelar as chaves: as emitidas antes deixam de valer; as novas valem", async () => {
  const t = tabelas(); supabaseFalso(t);
  const g = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "chave_excel" }, usuario: "aprovador" });
  const velha = g.body.chave;
  assert.equal((await planilha({ query: { tabela: "casos", k: velha } })).statusCode, 200);
  assert.equal((await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "revogar_excel" }, usuario: "supervisor.fulano" })).statusCode, 403, "só aprovador cancela");
  await new Promise(r => setTimeout(r, 15));
  const rv = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "revogar_excel" }, usuario: "aprovador" });
  assert.equal(rv.statusCode, 200);
  // o falso grava criado_em na hora; garante que o corte é depois da emissão
  const ev = t.fm_auditoria.filter(e => e.acao === "XL_REVOGAR");
  assert.equal(ev.length, 1);
  if (!ev[0].criado_em) ev[0].criado_em = new Date().toISOString();
  assert.equal((await planilha({ query: { tabela: "casos", k: velha } })).statusCode, 401, "a chave antiga foi cancelada");
  await new Promise(r => setTimeout(r, 15));
  const g2 = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "chave_excel" }, usuario: "aprovador" });
  assert.equal((await planilha({ query: { tabela: "casos", k: g2.body.chave } })).statusCode, 200, "a chave nova vale");
});

test("Excel conectado: as colunas que o servidor entrega são as que o arquivo espera ler", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  const ref = nome => { const m = html.match(new RegExp('nome:"' + nome + '",ref:"[$]A[$][0-9]+:[$]([A-Z])[$]')); assert.ok(m, "consulta " + nome + " não achada"); return m[1]; };
  const col = n => String.fromCharCode(64 + n);
  assert.equal(ref("FM_Casos"), col(XL.CASOS_CAB.length), "aba Dados: colunas da consulta");
  assert.equal(ref("FM_Reincidencia"), col(XL.REINC_CAB.length));
  assert.equal(ref("FM_Listas"), col(XL.LISTAS_CAB.length));
  assert.equal(ref("FM_Medidas"), col(XL.MEDIDAS_CAB.length), "aba Histórico: colunas da consulta");
  // as fórmulas novas leem a aba Dados por letra: Situação é a T, a ordem dos casos em aberto a X e o rótulo do caso a AA
  assert.ok(html.includes('SIT=dr("T")'));
  assert.ok(html.includes('{t:"Situação",w:23},{t:"Dias de atraso",w:9,n:1},{t:"No filtro do Painel"'));
  assert.ok(html.includes('{aba:"Histórico",nome:"FM_Medidas"'));
  // as fórmulas da aba Dados leem estas colunas pelo nome da letra: se a ordem mudar no servidor, isto avisa
  const letra = n => col(XL.CASOS_CAB.indexOf(n) + 1);
  assert.equal(letra("Posto"), "D"); assert.equal(letra("Supervisor"), "E"); assert.equal(letra("Folha"), "I");
  assert.equal(letra("Faltas (nº)"), "K"); assert.equal(letra("Retorno"), "M"); assert.equal(letra("Prazo até"), "N");
  assert.equal(letra("Data da medida"), "P"); assert.equal(letra("Medidas no ano"), "Q"); assert.equal(letra("Regra"), "R"); assert.equal(letra("Motivo"), "S");
  assert.equal(col(XL.REINC_CAB.indexOf("RE") + 1), "B", "a coluna RE da reincidência é a B");
  // a chave vai no endereço e a consulta é gravada dentro do arquivo
  assert.match(html, /&k="\+encodeURIComponent\(k\.chave\)\+"&tabela="/);
  assert.match(html, /type="4" refreshedVersion="6" refreshOnLoad="1" saveData="1"/);
});

test("Histórico para o Excel: todas as medidas do ano, o posto da época e a reserva técnica nunca aparece como traço", async () => {
  const t = tabelas();
  t.fm_medidas.push({ chave: "PLAN|9", re: 700, data: dia(-20), tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CANCELADA", nome: "CARLA", local: "—", motivo_sar2g: "FALTA INJUSTIFICADA" });
  supabaseFalso(t);
  const r = await planilha({ usuario: "qualquer", query: { formato: "json" } });
  const M = r.body.tabelas.medidas;
  assert.deepEqual(M.cab, XL.MEDIDAS_CAB);
  assert.equal(M.linhas.length, 3);
  const canc = M.linhas.find(l => l[8] === "Cancelada");
  assert.ok(canc, "a medida cancelada vem marcada (não conta nos rankings)");
  assert.equal(canc[2], "POSTO A", "posto da época: o da falta mais próxima, não o traço");
  assert.equal(canc[5], "Advertência escrita");
  const susp = M.linhas.find(l => l[5] === "Suspensão");
  assert.equal(susp[6], 2, "dias da suspensão em coluna própria");
  // ordenado da mais recente para a mais antiga
  const datas = M.linhas.map(l => l[4]);
  assert.deepEqual(datas, datas.slice().sort((a, b) => b - a));
  // postos e supervisores com medida (para os rankings): do que tem mais para o que tem menos
  const L = r.body.tabelas.listas.linhas;
  assert.equal(L[0][6], "POSTO A");
  assert.ok(L.some(l => l[7] === "FRANK") || L.every(l => l[7] === ""), "supervisor da medida entra na lista quando conhecido");
});

test("quem não está em posto efetivo aparece como reserva técnica do supervisor, no caso e no histórico", async () => {
  const t = { fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] };
  t.fm_faltas.push(...faltas(710, "RESERVA UM", null, "PAULO", [-5]));
  t.fm_medidas.push({ chave: "PLAN|7", re: 710, data: dia(-2), tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO", nome: "RESERVA UM", local: "—" });
  supabaseFalso(t);
  const c = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "qualquer" });
  assert.equal(c.statusCode, 200, JSON.stringify(c.body));
  assert.equal(c.body.casos[0].posto, "Reserva técnica · PAULO");
  const h = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "historico" }, usuario: "qualquer" });
  assert.equal(h.body.medidas[0].local, "Reserva técnica · PAULO");
  assert.equal(h.body.medidas[0].supervisor, "PAULO");
});
