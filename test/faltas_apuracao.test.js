// Apuração das faltas injustificadas: o que a Ficha de Presença marca como "I" mas não é falta
// injustificada (demitido, atestado e abono lançados no SAR2G, afastamento) fica de fora da cobrança,
// e a falta realmente injustificada continua sendo cobrada. Contra um Supabase falso em memória.
process.env.TZ = "America/Sao_Paulo";
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
process.env.FALTAS_MAIL_USER = "remetente@gruposervcamp.com.br";
process.env.FALTAS_MAIL_PASS = "senha-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const R = require("../api/_faltas_regras");
const P = require("../api/_parse");
const faltas = require("../api/_faltas");
const FE = require("../api/_faltas_email");
const ponto = require("../api/_ponto");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

// ── regra pura ──────────────────────────────────────────────────────────────
// 120 ativos, para a lista valer como "completa"
const ativos120 = () => { const m = new Map(); for (let i = 1; i <= 120; i++) m.set(String(1000 + i), "PESSOA " + (1000 + i)); return m; };
const oc = (RE, COD, INI, FIM, NOME) => ({ RE, NOME: NOME || "KAROLYNE AMARAL", COD, INI, FIM });
const cl = (re, data, ctx, extra) => R.classificarFalta({ re, data, codigo: "I", nome: "KAROLYNE AMARAL", ...extra }, ctx);

test("classificarFalta: só mexe em 'I'", () => {
  const ctx = { ativos: ativos120(), ocorrencias: R.indexarOcorrencias([oc(129, "A", "2026-10-01", "2026-10-31")]) };
  assert.equal(R.classificarFalta({ re: 777, data: "2026-10-05", codigo: "A", nome: "X" }, ctx), "A", "já abonada pelo SAR2G fica como veio");
  assert.equal(R.classificarFalta({ re: 777, data: "2026-10-05", codigo: null, nome: "X" }, ctx), null, "sem código fica sem código");
  assert.equal(R.classificarFalta({ re: 777, data: "2026-10-05", codigo: "j", nome: "X" }, ctx), "J");
});

test("classificarFalta: demitido é quem não está na lista de ativos, com RE e primeiro nome", () => {
  const ativos = ativos120(); ativos.set("129", "KAROLYNE ALEKSANDRA BUENO DO AMARAL");
  const ctx = { ativos };
  assert.equal(cl(129, "2026-10-06", ctx), "I", "está nos ativos: continua injustificada");
  assert.equal(cl(555, "2026-10-06", ctx, { nome: "FULANO" }), "D", "RE fora da lista de ativos: demitido");
  assert.equal(cl(129, "2026-10-06", ctx, { nome: "MARIA OUTRA" }), "D", "RE reaproveitado por outra pessoa: o dono antigo saiu");
  assert.equal(cl(129, "2026-10-06", ctx, { nome: "Karolyne" }), "I", "acento e caixa não contam");
  assert.equal(cl("0129", "2026-10-06", ctx), "I", "RE com zero à esquerda é o mesmo RE");
});

test("classificarFalta: o mesmo RE em duas empresas do grupo — as duas pessoas ativas continuam cobradas; uma terceira não", () => {
  const ativos = ativos120(); ativos.set("2", ["SANDRA TERCEIRIZACAO", "JORGE FACILITES"]);
  assert.equal(cl(2, "2026-10-11", { ativos }, { nome: "JORGE RENATO YOSHIKUNI" }), "I");
  assert.equal(cl(2, "2026-10-11", { ativos }, { nome: "SANDRA MARTINS" }), "I");
  assert.equal(cl(2, "2026-10-11", { ativos }, { nome: "ROBERTO ANTIGO" }), "D");
});

test("classificarFalta: lista de ativos pequena demais não transforma ninguém em demitido", () => {
  const ctx = { ativos: new Map([["1", "A"], ["2", "B"]]) };
  assert.equal(cl(555, "2026-10-06", ctx, { nome: "FULANO" }), "I");
  assert.equal(cl(555, "2026-10-06", { ativos: null }, { nome: "FULANO" }), "I");
});

test("classificarFalta: atestado, justificada e abono legal lançados no SAR2G cobrem o período, inclusive os dois extremos", () => {
  const ocorrencias = R.indexarOcorrencias([oc(129, "A", "2026-10-02", "2026-10-04"), oc(129, "J", "2026-10-10", "2026-10-10"), oc(129, "L", "2026-10-20", "2026-10-21")]);
  assert.equal(cl(129, "2026-10-01", { ocorrencias }), "I", "um dia antes");
  assert.equal(cl(129, "2026-10-02", { ocorrencias }), "A");
  assert.equal(cl(129, "2026-10-04", { ocorrencias }), "A");
  assert.equal(cl(129, "2026-10-05", { ocorrencias }), "I", "um dia depois");
  assert.equal(cl(129, "2026-10-10", { ocorrencias }), "J");
  assert.equal(cl(129, "2026-10-21", { ocorrencias }), "L");
});

test("classificarFalta: a ocorrência de outra pessoa com o mesmo RE (outra empresa do grupo) não cobre", () => {
  const ocorrencias = R.indexarOcorrencias([oc(471, "A", "2026-10-01", "2026-10-31", "ALEXSANDRO FACILITES")]);
  assert.equal(cl(471, "2026-10-05", { ocorrencias }, { nome: "ERINALVA TERCEIRIZACAO" }), "I");
  assert.equal(cl(471, "2026-10-05", { ocorrencias }, { nome: "ALEXSANDRO FACILITES" }), "A");
});

test("classificarFalta: abono vale mais que afastamento no mesmo dia; afastamento vira AF", () => {
  const ocorrencias = R.indexarOcorrencias([oc(129, "AF", "2026-09-01", "2026-10-31"), oc(129, "A", "2026-10-05", "2026-10-05")], { 129: "INSS" });
  assert.equal(cl(129, "2026-10-05", { ocorrencias }), "A");
  assert.equal(cl(129, "2026-10-06", { ocorrencias }), "AF");
});

test("classificarFalta: afastamento sem data de fim vale até a Ficha mostrar a pessoa trabalhando", () => {
  const ocorrencias = R.indexarOcorrencias([oc(4588, "AF", "2026-10-22", null, "JOSEANE MARIA")]);
  const f = { nome: "JOSEANE MARIA" };
  // ela segue ATIVO na planilha (o RH acabou de lançar o afastamento): o que vale é o afastamento lançado
  assert.equal(cl(4588, "2026-10-23", { ocorrencias, dias: () => ({ "2026-10-20": "FALTA", "2026-10-23": "FALTA" }) }, f), "AF");
  assert.equal(cl(4588, "2026-10-23", { ocorrencias }, f), "AF", "sem Ficha para contradizer, vale o afastamento");
  // afastamento aberto desde abril, mas a Ficha mostra a pessoa trabalhando depois: voltou, a falta é cobrada
  const velho = R.indexarOcorrencias([oc(4116, "AF", "2026-04-05", null, "GUSTAVO MARTINS")]);
  assert.equal(cl(4116, "2026-10-18", { ocorrencias: velho, dias: () => ({ "2026-09-01": "TRABALHO", "2026-10-18": "FALTA" }) }, { nome: "GUSTAVO MARTINS" }), "I");
  assert.equal(cl(4116, "2026-03-01", { ocorrencias: velho }, { nome: "GUSTAVO MARTINS" }), "I", "antes do início do afastamento");
});

test("classificarFalta: lacuna entre dois atestados sem nenhum dia trabalhado é o mesmo afastamento", () => {
  const ocorrencias = R.indexarOcorrencias([oc(4566, "A", "2026-07-01", "2026-07-05", "MARYLEEN BEATRIZ"), oc(4566, "A", "2026-07-20", "2026-07-21", "MARYLEEN BEATRIZ")]);
  const f = { nome: "MARYLEEN BEATRIZ" };
  const semTrabalho = () => ({ "2026-07-06": "—", "2026-07-10": "FALTA", "2026-07-18": "—" });
  assert.equal(cl(4566, "2026-07-10", { ocorrencias, dias: semTrabalho }, f), "AF");
  assert.equal(cl(4566, "2026-07-10", { ocorrencias, dias: () => ({ "2026-07-10": "FALTA", "2026-07-12": "TRABALHO" }) }, f), "I", "trabalhou no meio: voltou, a falta é cobrada");
  assert.equal(cl(4566, "2026-07-10", { ocorrencias }, f), "I", "sem Ficha, não dá para provar que ela não voltou");
  assert.equal(cl(4566, "2026-07-03", { ocorrencias, dias: semTrabalho }, f), "A", "dentro do atestado continua sendo atestado");
  assert.equal(cl(4566, "2026-07-25", { ocorrencias, dias: () => ({ "2026-07-25": "FALTA", "2026-07-26": "—" }) }, f), "I", "depois do último atestado não há o que ligar");
  const longe = R.indexarOcorrencias([oc(4566, "A", "2026-07-01", "2026-07-05", "MARYLEEN BEATRIZ"), oc(4566, "A", "2026-08-30", "2026-08-31", "MARYLEEN BEATRIZ")]);
  assert.equal(cl(4566, "2026-07-10", { ocorrencias: longe, dias: () => ({ "2026-07-10": "FALTA" }) }, f), "I", "lacuna maior que " + R.MAX_LACUNA_AFASTAMENTO + " dias: não liga");
});

test("classificarFalta: atraso, saída antecipada ou declaração de horas no dia tiram a falta de injustificada", () => {
  const ocorrencias = R.indexarOcorrencias([{ ...oc(129, "J", "2026-10-15", "2026-10-15"), PARCIAL: true }, { ...oc(129, "A", "2026-10-20", "2026-10-20"), PARCIAL: true }]);
  assert.equal(cl(129, "2026-10-15", { ocorrencias }), "J");
  assert.equal(cl(129, "2026-10-20", { ocorrencias }), "A");
  assert.equal(cl(129, "2026-10-16", { ocorrencias }), "I", "só o dia da declaração");
  // a declaração de um dia não liga dois dias de ausência: não é afastamento contínuo
  const dias = () => ({ "2026-10-16": "FALTA", "2026-10-17": "FALTA", "2026-10-18": "FALTA" });
  assert.equal(cl(129, "2026-10-17", { ocorrencias, dias }), "I");
});

test("classificarFalta: ocorrência com fim antes do início ou código desconhecido é ignorada", () => {
  const ocorrencias = R.indexarOcorrencias([oc(129, "AF", "2026-10-15", "2026-10-14"), oc(129, "X", "2026-10-01", "2026-10-31")]);
  assert.equal(cl(129, "2026-10-16", { ocorrencias }), "I");
});

test("classificarFalta: quem está na base de demitidos nunca é cobrado, mesmo na lista de ativos", () => {
  const ativos = ativos120(); ativos.set("489", "MATEUS CORREA PINHEIRO");
  const demitidos = new Set(["489|MATEUS"]);
  assert.equal(cl(489, "2026-10-21", { ativos, demitidos }, { nome: "MATEUS CORREA PINHEIRO" }), "D");
  assert.equal(cl(489, "2026-10-21", { ativos }, { nome: "MATEUS CORREA PINHEIRO" }), "I");
  assert.equal(cl(489, "2026-10-21", { demitidos }, { nome: "MARIA OUTRA" }), "I", "outra pessoa com o mesmo RE");
  assert.equal(cl(489, "2026-10-21", { demitidos }, { nome: "MATEUS", codigo: "A" }), "A", "o que o SAR2G já abonou fica como veio");
});

// ── leitura da planilha ─────────────────────────────────────────────────────
function aba(linhas) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const cab = linhas[0], range = XLSX.utils.decode_range(ws["!ref"]);
  cab.forEach((c, j) => {
    if (!/^(DATA|DT)/.test(c)) return;
    for (let i = 1; i <= range.e.r; i++) { const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })]; if (cel && typeof cel.v === "number") cel.z = "m/d/yy"; }
  });
  return ws;
}
const D = (d, m) => Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

function planilhaComOcorrencias() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba([["RE", "NOMEFUNCIONARIO", "DATA", "DESCSITUACAOHOJE", "DESCESCALA", "DESCTPABONO"], [129, "KAROLYNE", D(6, 10), "FALTA", "12X36", "I"]]), "FICHA PRESENCA");
  const cab = ["HISTDISCIPLINAR", "RE", "NOME", "PUNICAO", "DESCRICAO", "TPABONO", "FASEATUAL", "DTINICIOOCORRENCIA", "DTFIMOCORRENCIA", "DTINICIOAFASTAMENTO", "DTFIMAFASTAMENTO"];
  XLSX.utils.book_append_sheet(wb, aba([cab,
    ["O1", 129, "KAROLYNE AMARAL", "", "FALTA ABONADA", "ABONO MÉDICO", "Concluido", D(2, 10), D(4, 10), null, null],
    ["O1", 129, "KAROLYNE AMARAL", "", "FALTA ABONADA", "ABONO MÉDICO", "Concluido", D(2, 10), D(4, 10), null, null],           // mesma ocorrência em outra vaga
    ["O2", 129, "KAROLYNE AMARAL", "", "FALTA ABONADA", "ABONO MÉDICO", "Elaboração", D(8, 10), D(8, 10), null, null],         // ainda não concluída: vale
    ["O3", 129, "KAROLYNE AMARAL", "", "FALTA ABONADA", "ABONO MÉDICO", "Cancelada", D(9, 10), D(9, 10), null, null],          // cancelada: não vale
    ["O4", 129, "KAROLYNE AMARAL", "", "FALTA JUSTIFICADA", "JUSTIFICADA", "Concluido", D(10, 10), null, null, null],           // sem fim: um dia só
    ["O5", 129, "KAROLYNE AMARAL", "", "ÓBITO PAI/MÃE/IRMÃOS E OUTROS", "ABONO LEGAL", "Concluido", D(11, 10), D(12, 10), null, null],
    ["O6", 129, "KAROLYNE AMARAL", "", "AFASTAMENTO INSS", "", "Concluido", D(1, 9), null, D(14, 10), null],                  // afastamento: usa as datas do afastamento
    ["O7", 129, "KAROLYNE AMARAL", "", "ATRASO ABONADO", "ABONO MÉDICO", "Concluido", D(15, 10), D(15, 10), null, null],       // só parte do dia
    ["O8", 129, "KAROLYNE AMARAL", "", "SAÍDA ANTECIPADA ABONADA", "ABONO MÉDICO", "Concluido", D(15, 10), D(15, 10), null, null],
    ["O9", 129, "KAROLYNE AMARAL", "", "DECLARAÇÃO DE HORAS", "JUSTIFICADA", "Concluido", D(15, 10), D(15, 10), null, null],
    ["O10", 129, "KAROLYNE AMARAL", "", "FALTA INJUSTIFICADA", "INJUSTIFICADO", "Concluido", D(16, 10), D(16, 10), null, null], // não é abono
    ["P1", 129, "KAROLYNE AMARAL", "ADVERTENCIA ESCRITA", "FALTA INJUSTIFICADA", "", "Concluido", D(17, 10), null, null, null], // medida: continua indo para data.disciplina
    ["O11", 129, "KAROLYNE AMARAL", "", "AFASTAMENTO POR DOENÇA", "", "Elaboração", D(20, 10), null, D(21, 10), D(19, 10)]   // fim antes do início: ignorada
  ]), "DISCIPLINA");
  return P.buildDataFromWorkbook(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true }));
}

test("planilha: abonos, atestados e afastamentos da aba DISCIPLINA viram ocorrências com período", () => {
  const data = planilhaComOcorrencias();
  const lista = data.ocorrencias.map(o => [o.HIST, o.COD, o.INI, o.FIM, o.FASE]);
  assert.deepEqual(lista, [
    ["O1", "A", "2026-10-02", "2026-10-04", "Concluido"],
    ["O2", "A", "2026-10-08", "2026-10-08", "Elaboração"],
    ["O3", "A", "2026-10-09", "2026-10-09", "Cancelada"],   // vai com a fase: quem guardou sabe que caiu, e ela não cobre nada
    ["O4", "J", "2026-10-10", "2026-10-10", "Concluido"],
    ["O5", "L", "2026-10-11", "2026-10-12", "Concluido"],
    ["O6", "AF", "2026-10-14", null, "Concluido"],
    ["O7", "A", "2026-10-15", "2026-10-15", "Concluido"],    // atraso abonado: cobre só parte do dia, mas a pessoa se justificou
    ["O8", "A", "2026-10-15", "2026-10-15", "Concluido"],    // saída antecipada abonada
    ["O9", "J", "2026-10-15", "2026-10-15", "Concluido"],    // declaração de horas
    ["O11", "AF", "2026-10-21", null, "Elaboração"]        // fim um dia antes do início = afastamento ainda aberto
  ]);
  assert.equal(data.disciplina.length, 1, "a advertência continua sendo medida");
  assert.equal(data.disciplina[0].HIST, "P1");
});

test("planilha sem a aba DISCIPLINA: ocorrências vazias", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba([["RE", "NOMEFUNCIONARIO", "DATA", "DESCSITUACAOHOJE", "DESCESCALA", "DESCTPABONO"], [1, "A", D(1, 10), "TRABALHO", "12X36", null]]), "FICHA PRESENCA");
  const data = P.buildDataFromWorkbook(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true }));
  assert.deepEqual(data.ocorrencias, []);
});

// ── gravação ────────────────────────────────────────────────────────────────
const falta = (re, data, extra) => ({ RE: re, NOME: "PESSOA " + re, DATA: data, ABONO: "I", CARGO: "PORTEIRO (A)", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO", ...extra });
const tabelasVazias = () => ({ fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [], dashboard_snapshots: [] });
// 120 pessoas ativas (REs 1001 a 1120) para a lista de ativos valer, mais as que o teste pede
const ativosDoTeste = extra => { const l = []; for (let i = 1; i <= 120; i++) l.push({ RE: 1000 + i, NOME: "PESSOA " + (1000 + i) }); return l.concat(extra || []); };
const codigos = t => Object.fromEntries(t.fm_faltas.map(f => [f.re + "|" + f.data, f.codigo]));

test("materializar: demitido não é falta injustificada; quem está nos ativos continua sendo cobrado", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const r = await faltas.materializar({
    faltas: [falta(1001, "2026-10-10"), falta(555, "2026-10-10"), falta(555, "2026-10-12")],
    ativos: ativosDoTeste()
  });
  assert.equal(r.ok, true);
  assert.deepEqual(codigos(t), { "1001|2026-10-10": "I", "555|2026-10-10": "D", "555|2026-10-12": "D" });
  assert.deepEqual(t.fm_auditoria.map(a => [a.acao, a.chave, a.antes.codigo, a.depois.codigo, a.depois.motivo]).sort(),
    [["FALTA_REAPURADA", "555|2026-10-10", "I", "D", "demitido"], ["FALTA_REAPURADA", "555|2026-10-12", "I", "D", "demitido"]]);
});

test("materializar: atestado lançado e ainda não concluído (e afastamento) deixam de contar; a falta sem cobertura continua", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const data = planilhaComOcorrencias();
  data.faltas = ["2026-09-20", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-16", "2026-10-18"].map(d => falta(129, d, { NOME: "KAROLYNE AMARAL" }));
  data.ativos = ativosDoTeste([{ RE: 129, NOME: "KAROLYNE AMARAL" }]);
  await faltas.materializar(data);
  assert.deepEqual(codigos(t), {
    "129|2026-09-20": "I",   // antes de qualquer atestado: injustificada de verdade
    "129|2026-10-06": "AF",  // entre o atestado de 02-04/10 e o de 08/10, sem dia trabalhado: o mesmo afastamento
    "129|2026-10-08": "A",   // atestado em elaboração
    "129|2026-10-09": "I",   // atestado cancelado
    "129|2026-10-10": "J",
    "129|2026-10-11": "L",
    "129|2026-10-16": "AF",  // afastamento INSS aberto desde 14/10 e ela segue afastada
    "129|2026-10-18": "AF"
  });
  assert.equal(t.fm_faltas.find(f => f.data === "2026-10-08").codigo, "A");
});

test("materializar: falta de um dia que já saiu da planilha também é conferida, uma vez só", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  // setembro ficou guardado como injustificada; a planilha de hoje só traz outubro
  t.fm_faltas.push(
    { re: 129, data: "2026-09-24", codigo: "I", nome: "KAROLYNE AMARAL", escala: "12X36", tipo: "CONTRATO" },
    { re: 129, data: "2026-09-26", codigo: "I", nome: "KAROLYNE AMARAL", escala: "12X36", tipo: "CONTRATO" },
    { re: 700, data: "2026-09-01", codigo: "I", nome: "FULANO", escala: "12X36", tipo: "CONTRATO" }
  );
  const planilha = () => ({
    faltas: [falta(1001, "2026-10-10")],
    ativos: ativosDoTeste([{ RE: 129, NOME: "KAROLYNE AMARAL" }]),
    ocorrencias: [{ RE: "129", NOME: "KAROLYNE AMARAL", COD: "A", INI: "2026-09-26", FIM: "2026-09-29" }]
  });
  const r = await faltas.materializar(planilha());
  assert.deepEqual(codigos(t), { "129|2026-09-24": "I", "129|2026-09-26": "A", "700|2026-09-01": "D", "1001|2026-10-10": "I" });
  assert.equal(r.reapuradas, 2);
  const antes = t.fm_auditoria.length;
  const r2 = await faltas.materializar(planilha());
  assert.equal(r2.reapuradas, 0, "a segunda planilha igual não muda nada");
  assert.equal(t.fm_auditoria.length, antes, "e não anota de novo");
});

test("materializar: a conferência não apaga o que a planilha traz — o criado_em e os demais dados ficam", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  t.fm_faltas.push({ re: 700, data: "2026-09-01", codigo: "I", nome: "FULANO", posto: "POSTO Z", supervisor: "FRANK", escala: "12X36", tipo: "CONTRATO", criado_em: "2026-09-02T12:00:00Z" });
  await faltas.materializar({ faltas: [falta(1001, "2026-10-10")], ativos: ativosDoTeste() });
  const f = t.fm_faltas.find(x => x.re === 700);
  assert.equal(f.codigo, "D");
  assert.equal(f.posto, "POSTO Z");
  assert.equal(f.criado_em, "2026-09-02T12:00:00Z");
});

test("materializar: dois ativos com o mesmo RE (empresas diferentes) não viram demitidos um do outro", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar({
    faltas: [falta(2, "2026-10-11", { NOME: "JORGE RENATO" }), falta(2, "2026-10-13", { NOME: "SANDRA MARTINS" }), falta(2, "2026-10-14", { NOME: "ROBERTO ANTIGO" })],
    ativos: ativosDoTeste([{ RE: 2, NOME: "SANDRA MARTINS" }, { RE: 2, NOME: "JORGE RENATO" }])
  });
  assert.deepEqual(codigos(t), { "2|2026-10-11": "I", "2|2026-10-13": "I", "2|2026-10-14": "D" });
});

test("materializar: ativos incompletos (aba cortada) não transformam ninguém em demitido", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar({ faltas: [falta(555, "2026-10-10")], ativos: [{ RE: 1, NOME: "SO UM" }] });
  assert.deepEqual(codigos(t), { "555|2026-10-10": "I" });
  assert.equal(t.fm_auditoria.length, 0);
});

test("materializar: quem volta aos ativos (mesmo RE e nome) volta a ser cobrado nas faltas que a planilha traz", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar({ faltas: [falta(555, "2026-10-10")], ativos: ativosDoTeste() });
  assert.equal(t.fm_faltas[0].codigo, "D");
  await faltas.materializar({ faltas: [falta(555, "2026-10-10")], ativos: ativosDoTeste([{ RE: 555, NOME: "PESSOA 555" }]) });
  assert.equal(t.fm_faltas[0].codigo, "I");
  assert.ok(t.fm_auditoria.some(a => a.acao === "FALTA_VIROU_INJUSTIFICADA" && a.chave === "555|2026-10-10"), "a volta a injustificada fica anotada, como qualquer outra");
});

const registro = (acao, re, nome1) => ({ ator: "aprovador", acao, entidade: "fm_demitidos", chave: re + "|" + nome1, antes: null, depois: { re, nome1, nome: nome1 } });

test("base de demitidos: o registrado à mão nunca é cobrado, mesmo na lista de ativos; desfeito volta a ser", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  t.fm_auditoria.push(registro("DEMITIDO_REGISTRADO", 489, "MATEUS"), registro("DEMITIDO_REGISTRADO", 555, "FULANO"), registro("DEMITIDO_DESFEITO", 555, "FULANO"));
  await faltas.materializar({
    faltas: [falta(489, "2026-10-10", { NOME: "MATEUS CORREA" }), falta(555, "2026-10-10", { NOME: "FULANO SILVA" }), falta(1001, "2026-10-10")],
    ativos: ativosDoTeste([{ RE: 489, NOME: "MATEUS CORREA" }, { RE: 555, NOME: "FULANO SILVA" }])
  });
  assert.deepEqual(codigos(t), { "489|2026-10-10": "D", "555|2026-10-10": "I", "1001|2026-10-10": "I" });
});

test("sem acesso ao log de registros a apuração continua, só pela lista de ativos", async () => {
  const t = tabelasVazias(); supabaseFalso(t, { falhar: (m, c) => m === "GET" && c.startsWith("fm_auditoria") });
  const r = await faltas.materializar({ faltas: [falta(555, "2026-10-10"), falta(1001, "2026-10-10")], ativos: ativosDoTeste() });
  assert.equal(r.ok, true);
  assert.deepEqual(codigos(t), { "555|2026-10-10": "D", "1001|2026-10-10": "I" });
});

test("POST demitido: o aprovador registra, as faltas saem da cobrança na hora; desfazer devolve", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(reg(489, dia(-3), "I", { nome: "MATEUS CORREA" }), reg(489, dia(-1), "I", { nome: "MATEUS CORREA" }), reg(489, dia(-2), "A", { nome: "MATEUS CORREA" }), reg(490, dia(-3), "I", { nome: "OUTRO" }));
  supabaseFalso(t);
  const pedir = (body, usuario) => chamar(rh, { method: "POST", query: { modulo: "faltas", t: "demitido" }, usuario: usuario === undefined ? "aprovador" : usuario, body });
  assert.equal((await pedir({ re: 489, nome: "MATEUS CORREA" }, "supervisor.fulano")).statusCode, 403, "só aprovador");
  assert.equal((await pedir({ re: 489 })).statusCode, 400, "sem nome");
  const r = await pedir({ re: 489, nome: "Mateus Correa Pinheiro" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.faltas, 2);
  assert.deepEqual(t.fm_auditoria.filter(a => a.acao === "DEMITIDO_REGISTRADO").map(a => [a.chave, a.ator]), [["489|MATEUS", "aprovador"]]);
  assert.deepEqual(t.fm_faltas.map(f => [f.re, f.codigo]).sort(), [[489, "A"], [489, "D"], [489, "D"], [490, "I"]]);
  assert.equal(t.fm_auditoria.filter(a => a.acao === "FALTA_REAPURADA" && a.ator === "aprovador").length, 2);
  const volta = await pedir({ re: 489, nome: "Mateus Correa Pinheiro", remover: true });
  assert.equal(volta.body.faltas, 2);
  assert.equal(t.fm_auditoria.filter(a => a.acao === "DEMITIDO_DESFEITO").length, 1);
  // a base é o último registro de cada pessoa: desfeito, o RE volta a ser cobrado na próxima planilha
  await faltas.materializar({ faltas: [falta(489, dia(-1), { NOME: "MATEUS CORREA" })], ativos: ativosDoTeste([{ RE: 489, NOME: "MATEUS CORREA" }, { RE: 490, NOME: "OUTRO" }]) });
  assert.equal(t.fm_faltas.find(f => f.re === 489 && f.data === dia(-1)).codigo, "I");
  assert.deepEqual(t.fm_faltas.map(f => [f.re, f.codigo]).sort(), [[489, "A"], [489, "I"], [489, "I"], [490, "I"]]);
});

test("ocorrências ficam guardadas: a planilha seguinte, que já não traz o atestado, continua dando baixa", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const atestado = { HIST: "O9", RE: "129", NOME: "KAROLYNE AMARAL", COD: "A", INI: "2026-10-05", FIM: "2026-10-07", FASE: "Elaboração" };
  await faltas.materializar({ faltas: [falta(129, "2026-10-06", { NOME: "KAROLYNE AMARAL" })], ocorrencias: [atestado], ativos: ativosDoTeste([{ RE: 129, NOME: "KAROLYNE AMARAL" }]) });
  const guardadas = () => t.fm_auditoria.filter(a => a.acao === "OCORRENCIA_SAR2G");
  assert.deepEqual(guardadas().map(o => [o.chave, o.depois.RE, o.depois.COD, o.depois.INI, o.depois.FIM, o.depois.FASE]), [["O9", "129", "A", "2026-10-05", "2026-10-07", "Elaboração"]]);
  assert.equal(codigos(t)["129|2026-10-06"], "A");
  // a janela da aba DISCIPLINA andou e o atestado saiu dela; a Ficha ainda diz "I"
  await faltas.materializar({ faltas: [falta(129, "2026-10-06", { NOME: "KAROLYNE AMARAL" })], ocorrencias: [], ativos: ativosDoTeste([{ RE: 129, NOME: "KAROLYNE AMARAL" }]) });
  assert.equal(codigos(t)["129|2026-10-06"], "A", "o atestado guardado continua valendo");
  assert.equal(guardadas().length, 1, "e nada se grava de novo quando nada mudou");
  // o SAR2G cancelou o atestado: a planilha traz a fase nova e a falta volta a ser cobrada
  await faltas.materializar({ faltas: [falta(129, "2026-10-06", { NOME: "KAROLYNE AMARAL" })], ocorrencias: [{ ...atestado, FASE: "Cancelada" }], ativos: ativosDoTeste([{ RE: 129, NOME: "KAROLYNE AMARAL" }]) });
  assert.equal(codigos(t)["129|2026-10-06"], "I");
  assert.equal(guardadas().length, 2, "a mudança de fase fica registrada");
});

test("Enviar histórico com o relatório de ocorrências: dá baixa nas faltas já guardadas e anota o que mudou", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(reg(129, "2026-08-04", "I", { nome: "KAROLYNE AMARAL" }), reg(129, "2026-09-24", "I", { nome: "KAROLYNE AMARAL" }), reg(700, "2026-08-04", "I", { nome: "OUTRA PESSOA" }));
  supabaseFalso(t);
  const r = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "historico" }, usuario: "aprovador", body: { ocorrencias: [
    { HIST: "A1", RE: "129", NOME: "KAROLYNE AMARAL", COD: "A", INI: "2026-08-03", FIM: "2026-08-09", FASE: "Concluido" },
    { HIST: "A2", RE: "700", NOME: "OUTRA PESSOA", COD: "AF", INI: "2026-07-01", FIM: null, FASE: "Concluido" },
    { RE: "abc", COD: "A", INI: "2026-08-03" }
  ] } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ocorrencias, 2, "a linha sem RE válido fica de fora");
  assert.equal(r.body.reapuradas, 2);
  assert.deepEqual(codigos(t), { "129|2026-08-04": "A", "129|2026-09-24": "I", "700|2026-08-04": "AF" });
  assert.equal((await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "historico" }, usuario: "aprovador", body: {} })).statusCode, 400);
});

test("Enviar histórico também confere os demitidos com a lista de ativos da última planilha recebida", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(reg(555, "2026-08-04", "I", { nome: "FULANO SILVA" }), reg(1001, "2026-08-04", "I", { nome: "PESSOA 1001" }));
  t.dashboard_snapshots.push({ created_at: "2026-10-23T15:00:00Z", data: { ativos: ativosDoTeste() } });
  supabaseFalso(t);
  const r = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "historico" }, usuario: "aprovador", body: { ocorrencias: [{ HIST: "X1", RE: "9999", NOME: "QUALQUER", COD: "A", INI: "2026-01-01", FIM: "2026-01-02" }] } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(codigos(t), { "555|2026-08-04": "D", "1001|2026-08-04": "I" });
});

test("histórico: cada medida traz o motivo escrito e cada colaborador as faltas injustificadas do ano", async () => {
  const t = tabelasVazias();
  const ano = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 4);
  t.fm_faltas.push(reg(129, ano + "-03-10", "I", { nome: "KAROLYNE AMARAL" }), reg(129, ano + "-04-02", "I", { nome: "KAROLYNE AMARAL" }), reg(129, ano + "-04-05", "A", { nome: "KAROLYNE AMARAL" }), reg(555, ano + "-03-11", "D", { nome: "FULANO" }), reg(129, (Number(ano) - 1) + "-12-20", "I", { nome: "KAROLYNE AMARAL" }));
  supabaseFalso(t);
  const env = await chamar(rh, { method: "POST", query: { modulo: "faltas", t: "historico" }, usuario: "aprovador", body: { medidas: [{ re: 129, nome: "KAROLYNE AMARAL", data: ano + "-04-03", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "Concluido", motivo: "ADVERTTENCIA ESCRITA", obs: "POR FALTA NÃO JUSTIFICADA EM 02/04" }] } });
  assert.equal(env.statusCode, 200);
  const r = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "historico" }, usuario: "aprovador" });
  assert.equal(r.body.medidas[0].obs, "POR FALTA NÃO JUSTIFICADA EM 02/04");
  assert.deepEqual(r.body.faltas.map(p => [p.re, p.datas]), [["129", [ano + "-03-10", ano + "-04-02"]]], "só as injustificadas do ano: a abonada, a de demitido e a do ano passado não contam");
});

// ── leitura e e-mail ────────────────────────────────────────────────────────
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const reg = (re, data, codigo, extra) => ({ re, data, codigo, nome: "PESSOA " + re, cargo: "PORTEIRO (A)", posto: "POSTO " + re, supervisor: "FRANK PIMENTEL", escala: "12X36", tipo: "CONTRATO", criado_em: "2026-01-01T12:00:00Z", ...extra });

test("GET casos: demitido e afastado não viram caso; aviso prévio, férias e INSS aparecem como marca do card", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(reg(10, dia(-12), "I"), reg(11, dia(-12), "I"), reg(12, dia(-12), "I"), reg(13, dia(-12), "D"), reg(13, dia(-10), "D"), reg(14, dia(-12), "AF"));
  t.dashboard_snapshots.push({ created_at: "2026-10-20T00:00:00Z", data: { presenca: [
    { RE: 10, NOME: "PESSOA 10", DESCSITUACAO: "AVISO TRAB." },
    { RE: 11, NOME: "PESSOA 11", DESCSITUACAO: "FÉRIAS" },
    { RE: 12, NOME: "OUTRA PESSOA", DESCSITUACAO: "INSS" },   // mesmo RE, outra pessoa: sem marca
    { RE: 15, NOME: "PESSOA 15", DESCSITUACAO: "ATIVO" }
  ] } });
  supabaseFalso(t);
  const r = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "aprovador" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.casos.map(c => [c.re, c.situacaoFunc]).sort(), [["10", "AVISO_PREVIO"], ["11", ""], ["12", ""]], "só o aviso prévio vira marca");
  assert.deepEqual(r.body.abonadas.map(a => [a.re, a.codigo]), [["14", "AF"]], "demitido não aparece em lugar nenhum; afastamento entra nas abonadas");
  assert.equal(r.body.foraDaCobranca, undefined, "o painel só mostra o que é injustificada");
});

test("GET casos: afastamento entra na lista de abonadas (tudo o que não é falta injustificada), férias e INSS não viram marca", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(reg(10, dia(-6), "I"), reg(11, dia(-6), "AF"), reg(11, dia(-5), "AF"), reg(12, dia(-6), "A"));
  t.dashboard_snapshots.push({ created_at: "2026-10-20T00:00:00Z", data: { presenca: [{ RE: 10, NOME: "PESSOA 10", DESCSITUACAO: "FÉRIAS" }, { RE: 11, NOME: "PESSOA 11", DESCSITUACAO: "INSS" }] } });
  supabaseFalso(t);
  const r = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "aprovador" });
  assert.deepEqual(r.body.casos.map(c => [c.re, c.situacaoFunc]), [["10", ""]], "quem tem falta injustificada e está de férias: caso normal, sem marca");
  assert.deepEqual(r.body.abonos.map(a => [a.re, a.codigo, a.faltas.length]).sort(), [["11", "AF", 2], ["12", "A", 1]]);
});

test("o aviso por e-mail reflete a correção sem mudar nada nele: só leva as faltas ainda injustificadas", async () => {
  const t = tabelasVazias();
  t.fm_faltas.push(
    reg(10, "2026-10-20", "I", { supervisor: "JEAN KLEBER" }),
    reg(13, "2026-10-21", "D", { supervisor: "JEAN KLEBER" }),
    reg(14, "2026-10-21", "AF", { supervisor: "JEAN KLEBER" }),
    reg(15, "2026-10-22", "A", { supervisor: "JEAN KLEBER" })
  );
  supabaseFalso(t);
  const l = await FE.faltasDoPeriodo(ponto.conectar(), "2026-10-19", "2026-10-25", FE.fimDoDiaSP("2026-10-25"));
  assert.deepEqual(l.map(f => f.re), [10]);
});

// ── contratação nova que a lista de ativos ainda não tem ─────────────────────
test("classificarFalta: confirmado (contratação nova) não vira demitido por faltar na lista de ativos", () => {
  const ativos = ativos120();
  assert.equal(cl(4990, "2026-10-20", { ativos }, { nome: "NOVATA CONTRATADA" }), "D", "sem confirmação, fora da lista = demitido");
  assert.equal(cl(4990, "2026-10-20", { ativos, confirmados: new Set(["4990|NOVATA"]) }, { nome: "NOVATA CONTRATADA" }), "I");
  assert.equal(cl(4990, "2026-10-20", { ativos, confirmados: new Set(["4990|NOVATA"]), demitidos: new Set(["4990|NOVATA"]) }, { nome: "NOVATA CONTRATADA" }), "D", "a base de demitidos vale mais");
});

test("trabalhandoRecente: só dia trabalhado nos últimos 7 dias conta; falta e folga não", () => {
  assert.equal(R.trabalhandoRecente({ "2026-10-20": "FALTA", "2026-10-24": "TRABALHO" }, "2026-10-26"), true);
  assert.equal(R.trabalhandoRecente({ "2026-10-20": "FALTA", "2026-10-24": "FALTA", "2026-10-25": "FOLGA" }, "2026-10-26"), false);
  assert.equal(R.trabalhandoRecente({ "2026-10-10": "TRABALHO" }, "2026-10-26"), false, "trabalhou, mas faz mais de 7 dias");
  assert.equal(R.trabalhandoRecente(undefined, "2026-10-26"), false);
});

test("materializar: quem trabalha na Ficha e não está na lista de ativos é contratação nova (continua cobrado e fica registrado); quem faltou até sair é demitido", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const dados = () => ({
    faltas: [falta(4990, "2026-10-20", { NOME: "NOVATA CONTRATADA" }), falta(556, "2026-10-20", { NOME: "FULANO ABANDONO" })],
    fichaDias: { 4990: { "2026-10-20": "FALTA", "2026-10-24": "TRABALHO" }, 556: { "2026-10-20": "FALTA", "2026-10-24": "FALTA" } },
    ativos: ativosDoTeste()
  });
  await faltas.materializar(dados());
  assert.deepEqual(codigos(t), { "4990|2026-10-20": "I", "556|2026-10-20": "D" });
  const ev = t.fm_auditoria.filter(a => a.acao === "DEMITIDO_DESFEITO");
  assert.deepEqual(ev.map(a => [a.ator, a.chave, a.depois.nome1]), [["sistema", "4990|NOVATA", "NOVATA"]]);

  // semanas depois, sem dia trabalhado na janela: continua cobrada, porque a confirmação ficou guardada
  const depois = dados(); depois.fichaDias[4990] = { "2026-10-20": "FALTA" };
  await faltas.materializar(depois);
  assert.equal(codigos(t)["4990|2026-10-20"], "I");
  assert.equal(t.fm_auditoria.filter(a => a.acao === "DEMITIDO_DESFEITO").length, 1, "não registra de novo");
});

// ── toda pessoa tem supervisor ──────────────────────────────────────────────
test("falta que veio sem área na planilha herda o supervisor do cadastro (lista de ativos), no import e nas já guardadas", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  // já guardada sem supervisor (planilha de outro dia veio sem área)
  t.fm_faltas.push({ re: 1005, data: "2026-10-08", codigo: "I", nome: "PESSOA 1005", escala: "12X36", tipo: "CONTRATO", supervisor: null });
  const ativos = ativosDoTeste().map(a => a.RE === 1005 ? { ...a, AREA: "FRANK PIMENTEL" } : a.RE === 1006 ? { ...a, AREA: "EDNEY FERRAZ" } : a);
  await faltas.materializar({
    faltas: [falta(1006, "2026-10-10", { AREA: "" }), falta(1001, "2026-10-10", { AREA: "" })],
    fichaDias: {}, ativos
  });
  const sup = Object.fromEntries(t.fm_faltas.map(f => [f.re + "|" + f.data, f.supervisor]));
  assert.equal(sup["1006|2026-10-10"], "JEAN KLEBER", "do cadastro, com a regra de quem assumiu a área (Edney passou para o Jean)");
  assert.equal(sup["1005|2026-10-08"], "FRANK PIMENTEL", "a já guardada sem supervisor foi consertada");
  assert.equal(sup["1001|2026-10-10"], null, "sem área em lugar nenhum: continua vazio (a tela mostra o que o cadastro disser)");
});
