// Histórico de medidas (advertências e suspensões desde janeiro), para controlar
// reincidência. Vem do relatório de ocorrências do SAR2G, enviado uma vez, e daí
// em diante da aba DISCIPLINA da planilha diária.
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
const R = require("../api/_faltas_regras");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const ano = hoje.slice(0, 4);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pedir = (method, t, extra) => chamar(rh, { method, query: { modulo: "faltas", t }, usuario: extra && "usuario" in extra ? extra.usuario : "aprovador", body: extra && extra.body });
const tabelas = () => ({ fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] });

// leitura do arquivo (função da tela, lida direto do index.html)
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const ini = html.indexOf("function fmHistData("), fim = html.indexOf("/*fim fmHistLer*/");
assert.ok(ini > 0 && fim > ini, "fmHistLer não encontrada no index.html");
const fmHistLer = new Function(html.slice(ini, fim) + "\nreturn fmHistLer;")();

const CAB = ["RE", "NOME", "DESCRICAO", "DTINICIOOCORRENCIA", "DTFIMOCORRENCIA", "FASEATUAL", "CLIENTE", "PUNICAO"];

test("leitura do relatório: só advertências e suspensões, olhando DESCRICAO e PUNICAO juntas", () => {
  const r = fmHistLer([
    ["Relatório de ocorrências"],
    CAB,
    [10, "ANA", "FALTA ABONADA", new Date(2026, 4, 2), null, "CONCLUÍDO", "POSTO A", null],
    [10, "ANA", "ADVERTTENCIA ESCRITA", new Date(2026, 1, 9), null, "CONCLUÍDO", "POSTO A", "ADVERTENCIA ESCRITA"],
    [10, "ANA", "SUSPENSÃO", "21/07/2026", null, "CONCLUÍDO", "POSTO A", "SUSPENSÃO 03 SERV CAMP"],
    [11, "BIA", "SAÍDA ANTECIPADA INJUSTIFICADA", "2026-07-28", null, "CONCLUÍDO", "POSTO B", "ADVERTENCIA VERBAL"],
    [12, "CAU", "ADVERTENCIA ESCRITA", new Date(2026, 2, 3), null, "APROVAÇÃO CANCEL. OCORRÊNCIA", "POSTO C", null],
    [13, "DUDA", "SUSPENSÃO", null, null, "CONCLUÍDO", "POSTO D", "SUSPENSÃO 01 SERV CAMP"]
  ]);
  assert.equal(r.semData, 1, "sem data não entra");
  assert.deepEqual(r.medidas.map(m => [m.re, m.data, m.tipo, m.grau, m.dias]), [
    ["10", "2026-02-09", "ADVERTÊNCIA", "ESCRITA", 0],
    ["10", "2026-07-21", "SUSPENSÃO", "SUSPENSÃO", 3],
    ["11", "2026-07-28", "ADVERTÊNCIA", "VERBAL", 0],
    ["12", "2026-03-03", "ADVERTÊNCIA", "ESCRITA", 0]
  ]);
  assert.equal(r.medidas[3].fase, "APROVAÇÃO CANCEL. OCORRÊNCIA");
});

test("leitura do relatório: arquivo sem as colunas certas é recusado com uma explicação", () => {
  assert.match(fmHistLer([["NOME", "DATA"], ["ANA", "2026-01-01"]]).erro, /RE e DTINICIOOCORRENCIA/);
});

test("regra: valida a linha e monta a chave do histórico (começa com HIST|)", () => {
  const ok = R.medidaDoHistorico({ re: "0120", data: "2026-03-10", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 3, fase: "CONCLUÍDO", motivo: "SUSPENSÃO" });
  assert.equal(ok.linha.chave, "HIST|120|2026-03-10|SUSPENSÃO|SUSPENSÃO|3");
  assert.equal(ok.linha.re, 120);
  assert.equal(R.medidaDoHistorico({ re: "120", data: "x", tipo: "SUSPENSÃO", grau: "SUSPENSÃO" }).erro, "data inválida");
  assert.equal(R.medidaDoHistorico({ re: "abc", data: "2026-03-10", tipo: "SUSPENSÃO", grau: "SUSPENSÃO" }).erro, "RE inválido");
  assert.equal(R.medidaDoHistorico({ re: "1", data: "2026-03-10", tipo: "ELOGIO", grau: "VERBAL" }).erro, "tipo de medida desconhecido");
  assert.equal(R.medidaDoHistorico({ re: "1", data: "2026-03-10", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 90 }).erro, "dias de suspensão inválidos");
  assert.equal(R.medidaDoHistorico({ re: "1", data: "2026-03-10", tipo: "ADVERTÊNCIA", grau: "ESCRITA", hist: "P-77" }).linha.chave, "P-77", "com número do processo, usa o número");
});

test("regra: a mesma medida no histórico e na planilha diária fica uma vez só (a da planilha)", () => {
  const l = R.dedupMedidas([
    { chave: "HIST|5|2026-08-01|ADVERTÊNCIA|ESCRITA|0", re: 5, data: "2026-08-01", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0 },
    { chave: "P-1", re: 5, data: "2026-08-01", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0 },
    { chave: "P-2", re: 5, data: "2026-08-01", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 1 }
  ]);
  assert.deepEqual(l.map(m => m.chave), ["P-1", "P-2"]);
});

test("envio do histórico: só aprovador", async () => {
  supabaseFalso(tabelas());
  const r = await pedir("POST", "historico", { usuario: "supervisor.fulano", body: { medidas: [{ re: 1, data: ano + "-02-01", tipo: "ADVERTÊNCIA", grau: "ESCRITA" }] } });
  assert.equal(r.statusCode, 403);
});

test("envio do histórico grava as medidas, ignora a repetida e conta as recusadas", async () => {
  const t = tabelas(); supabaseFalso(t);
  const m = { re: 30, nome: "ANA", data: ano + "-02-09", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUÍDO", motivo: "ADVERTTENCIA ESCRITA", local: "POSTO A" };
  const r = await pedir("POST", "historico", { body: { medidas: [m, { ...m }, { ...m, data: ano + "-05-20", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 3 }, { ...m, re: "x" }] } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.body.recebidas, r.body.gravadas, r.body.recusadas["RE inválido"]], [4, 2, 1]);
  assert.equal(t.fm_medidas.length, 2);
  assert.ok(t.fm_medidas.every(x => x.chave.startsWith("HIST|")));
  assert.equal(t.fm_auditoria[0].acao, "HISTORICO_IMPORTADO");
  assert.equal(t.fm_auditoria[0].depois.gravadas, 2);
  assert.equal(JSON.stringify(t.fm_auditoria[0]).indexOf("ANA"), -1, "a auditoria não guarda nome de ninguém");

  // enviar de novo o mesmo arquivo não duplica
  await pedir("POST", "historico", { body: { medidas: [m] } });
  assert.equal(t.fm_medidas.length, 2);

  const h = await pedir("GET", "historico", { usuario: "supervisor.fulano" });
  assert.equal(h.statusCode, 200);
  assert.equal(h.body.desde, ano + "-01-01");
  assert.deepEqual(h.body.medidas.map(x => [x.re, x.data, x.tipo, x.dias, x.origem]), [[30, ano + "-02-09", "ADVERTÊNCIA", 0, "historico"], [30, ano + "-05-20", "SUSPENSÃO", 3, "historico"]]);
  assert.equal(h.body.importacao.por, "aprovador");
});

test("medida antiga do histórico não fecha caso de agora (a medida tem que ser depois da falta)", async () => {
  const t = tabelas();
  [-6, -5].forEach(n => t.fm_faltas.push({ re: 700, data: dia(n), codigo: "I", nome: "CARLA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" }));
  t.fm_dias.push({ re: 700, data: dia(-4), situacao: "TRABALHOU" });
  t.fm_medidas.push({ chave: `HIST|700|${dia(-40)}|ADVERTÊNCIA|ESCRITA|0`, re: 700, data: dia(-40), tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUÍDO" });
  supabaseFalso(t);
  const r = await pedir("GET", "casos");
  assert.equal(r.body.casos.length, 1);
  assert.equal(r.body.casos[0].medida, null);
});

test("o histórico traz o supervisor da área: pelo RE de quem faltou há pouco, ou pelo posto da medida", async () => {
  const t = tabelas();
  t.fm_faltas.push({ re: 40, data: dia(-3), codigo: "I", nome: "BIA", cargo: "PORTEIRO (A)", posto: "POSTO X", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" });
  const m = (re, posto) => ({ chave: `HIST|${re}|${ano}-03-03|ADVERTÊNCIA|ESCRITA|0`, re, data: `${ano}-03-03`, tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUÍDO", nome: "X", local: posto });
  t.fm_medidas.push(m(40, "POSTO QUALQUER"), m(41, "POSTO X"), m(42, "POSTO SEM DONO"));
  supabaseFalso(t);
  const h = await pedir("GET", "historico", { usuario: "supervisor.fulano" });
  const sup = Object.fromEntries(h.body.medidas.map(x => [x.re, x.supervisor]));
  assert.deepEqual(sup, { 40: "FRANK", 41: "FRANK", 42: "" });
});
