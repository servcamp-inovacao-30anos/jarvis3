// Relatório de coberturas do supervisor (BDV): regras puras e servidor.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../api/_bdv_regras");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const bdvApi = require("../api/_bdv");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

const ida = (posto, data, horario, extra) => ({ NOME: "FRANK", DATA: data, DESTINO: posto + "/" + posto, HORARIO: horario, KM: "120", TEMPO: "1/1/00 10:28", MOTIVO: "COBERTURA", ...extra });
const falta = (re, posto, data, extra) => ({ RE: re, NOME: "PESSOA " + re, DATA: data, LOCAL: posto, ABONO: "I", ...extra });
const ativo = (re, posto, jornada) => ({ RE: re, LOCAL: posto, JORNADA: jornada });
const montar = (bdv, faltas, ativos, cob, ref) => R.bdvMontar(bdv, faltas || [], ativos || [], cob || [], ref || {});

test("a referência é o horário de quem faltou: 06:00 e chegou 09:30 = atraso; 10:00 e chegou 09:30 = antes", () => {
  const ativos = [ativo(1, "POSTO A", "12H 06:00 - 18:00"), ativo(2, "POSTO A", "08H 10:00 - 18:00")];
  const [a] = montar([ida("POSTO A", "2026-09-10", "9:30:00")], [falta(1, "POSTO A", "2026-09-10")], ativos);
  assert.deepEqual([a.inicio, a.chegada, a.diferenca_min, a.situacao, a.fonte_inicio], ["06:00", "09:30", 210, "GRAVE", "JORNADA"]);
  const [b] = montar([ida("POSTO A", "2026-09-10", "9:30:00")], [falta(2, "POSTO A", "2026-09-10")], ativos);
  assert.deepEqual([b.inicio, b.diferenca_min, b.situacao], ["10:00", -30, "ANTES"]);
});

test("o horário que vem na própria falta vale antes da jornada dos ativos", () => {
  const [a] = montar([ida("POSTO A", "2026-09-10", "8:20:00")], [falta(1, "POSTO A", "2026-09-10", { HORARIO: "08:00–17:00" })], [ativo(1, "POSTO A", "12H 06:00 - 18:00")]);
  assert.deepEqual([a.inicio, a.fonte_inicio, a.diferenca_min, a.situacao], ["08:00", "FALTA", 20, "NO_PRAZO"]);
});

test("jornada de outro posto não serve (a pessoa estava em outro lugar): usa os turnos do posto", () => {
  const [a] = montar([ida("POSTO A", "2026-09-10", "7:30:00")], [falta(1, "POSTO A", "2026-09-10")], [ativo(1, "POSTO B", "12H 18:00 - 06:00")], [], { "POSTO A": ["07:00"] });
  assert.deepEqual([a.inicio, a.fonte_inicio, a.situacao], ["07:00", "POSTO", "NO_PRAZO"]);
});

test("duas pessoas faltaram no mesmo posto: dois registros, cada um com o seu horário", () => {
  const ativos = [ativo(1, "POSTO A", "12H 06:00 - 18:00"), ativo(2, "POSTO A", "08H 10:00 - 18:00")];
  const out = montar([ida("POSTO A", "2026-09-10", "9:30:00")], [falta(1, "POSTO A", "2026-09-10"), falta(2, "POSTO A", "2026-09-10")], ativos);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(x => [x.falta_re, x.situacao]).sort(), [[1, "GRAVE"], [2, "ANTES"]]);
  assert.equal(new Set(out.map(x => x.chave)).size, 2, "chaves diferentes");
});

test("duas idas ao posto no dia: cada falta fica com a chegada mais perto do início da sua vaga", () => {
  const ativos = [ativo(1, "POSTO A", "12H 06:00 - 18:00"), ativo(2, "POSTO A", "12H 18:00 - 06:00")];
  const out = montar([ida("POSTO A", "2026-09-10", "6:20:00"), ida("POSTO A", "2026-09-10", "17:50:00")], [falta(1, "POSTO A", "2026-09-10"), falta(2, "POSTO A", "2026-09-10")], ativos);
  const por = Object.fromEntries(out.map(x => [x.falta_re, x]));
  assert.deepEqual([por[1].chegada, por[1].situacao, por[2].chegada, por[2].situacao], ["06:20", "NO_PRAZO", "17:50", "ANTES"]);
});

test("ida sem falta: turnos do posto (último já começado; antes de todos = antes do horário) e motivo da aba de coberturas", () => {
  const ref = { "POSTO A": ["06:00", "10:00"] };
  const cob = [{ LOCAL: "POSTO A", DATA: "2026-09-10", MOTIVO: "COBERTURA DE FÉRIAS" }, { LOCAL: "POSTO A", DATA: "2026-09-10", MOTIVO: "COBERTURA DE FÉRIAS" }];
  const [a] = montar([ida("POSTO A", "2026-09-10", "9:30:00")], [], [], cob, ref);
  assert.deepEqual([a.inicio, a.diferenca_min, a.situacao, a.motivo], ["06:00", 210, "GRAVE", "FÉRIAS"]);
  const [b] = montar([ida("POSTO A", "2026-09-10", "5:40:00")], [], [], [], ref);
  assert.deepEqual([b.inicio, b.situacao, b.motivo], ["06:00", "ANTES", "SEM MOTIVO REGISTRADO"]);
  const [c] = montar([ida("POSTO A", "2026-09-10", "9:30:00")], [], [], [{ LOCAL: "POSTO A", DATA: "2026-09-10", MOTIVO: "COBERTURA DE FALTAS" }], ref);
  assert.equal(c.motivo, "FALTA SEM REGISTRO");
});

test("sede e texto livre não são posto: ficam à parte, sem horário", () => {
  const out = montar([ida("SERV CAMP TERCEIRIZACAO", "2026-09-10", "8:00:00"), { ...ida("X", "2026-09-10", "9:00:00"), DESTINO: "Deixar colaborador em casa" }], [], [], [], { "POSTO A": ["06:00"] });
  assert.deepEqual(out.map(x => [x.situacao, x.inicio, x.diferenca_min]), [["NAO_E_POSTO", null, null], ["NAO_E_POSTO", null, null]]);
});

test("limites: até 60 min no prazo, até 3h atraso, depois grave; virada da meia-noite conta como depois", () => {
  assert.equal(R.bdvClassifica(-1), "ANTES"); assert.equal(R.bdvClassifica(0), "NO_PRAZO"); assert.equal(R.bdvClassifica(60), "NO_PRAZO");
  assert.equal(R.bdvClassifica(61), "ATRASO"); assert.equal(R.bdvClassifica(180), "ATRASO"); assert.equal(R.bdvClassifica(181), "GRAVE");
  assert.equal(R.bdvClassifica(null), "SEM_HORARIO");
  assert.equal(R.bdvDiferenca(R.bdvHoraMin("00:30"), R.bdvHoraMin("22:00")), 150);
  assert.equal(R.bdvTempoMin("1/1/00 10:28"), 628); assert.equal(R.bdvTempoMin("10:28"), 628); assert.equal(R.bdvTempoMin("—"), null);
  assert.equal(R.bdvJornadaIni("09H 06:30 - 15:30 C/ 1H INT"), 390);
  assert.equal(R.bdvNorm(" cond -  Água  branca "), "COND - AGUA BRANCA");
});

test("o bloco de regras é igual no servidor e na tela", () => {
  const corta = s => { s = s.replace(/\r\n/g, "\n"); const a = s.indexOf("/*ini bdvRegras*/"), b = s.indexOf("/*fim bdvRegras*/"); assert.ok(a >= 0 && b > a); return s.slice(a, b); };
  assert.equal(corta(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")), corta(fs.readFileSync(path.join(__dirname, "..", "api", "_bdv_regras.js"), "utf8")));
});

// ── servidor ────────────────────────────────────────────────────────────────
const planilha = bdv => ({ bdvCobertura: bdv, faltas: [falta(1, "POSTO A", "2026-09-10")], ativos: [ativo(1, "POSTO A", "12H 06:00 - 18:00")], cobertura: [] });
const pedir = (method, t, query, usuario) => chamar(rh, { method, query: { modulo: "bdv", t, ...query }, usuario });

test("materializar guarda, atualiza e tira o que sumiu no período da planilha; sem aba do BDV não apaga nada", async () => {
  const t = { bdv_coberturas: [] }; supabaseFalso(t);
  let r = await bdvApi.materializar(planilha([ida("POSTO A", "2026-09-10", "6:30:00"), ida("POSTO A", "2026-09-11", "7:00:00")]));
  assert.equal(r.ok, true); assert.equal(t.bdv_coberturas.length, 2);
  r = await bdvApi.materializar(planilha([ida("POSTO A", "2026-09-10", "6:30:00")]));
  assert.equal(r.removidos, 0, "o dia 11 está fora do período desta planilha: fica");
  r = await bdvApi.materializar(planilha([ida("POSTO A", "2026-09-10", "6:45:00"), ida("POSTO A", "2026-09-11", "7:00:00")]));
  assert.equal(r.removidos, 1, "a ida das 06:30 foi corrigida para 06:45");
  assert.deepEqual(t.bdv_coberturas.map(x => x.chegada).sort(), ["06:45", "07:00"]);
  r = await bdvApi.materializar(planilha([ida("POSTO A", "2026-09-10", "6:45:00"), ida("POSTO A", "2026-09-11", "7:00:00")]));
  assert.equal(r.gravados, 0, "nada mudou: nada vai ao banco");
  r = await bdvApi.materializar(planilha([]));
  assert.equal(r.ignorado, "SEM_BDV_NA_PLANILHA"); assert.equal(t.bdv_coberturas.length, 2);
});

test("GET coberturas: só diretoria e coordenação, com período obrigatório", async () => {
  const t = { bdv_coberturas: [] }; supabaseFalso(t);
  await bdvApi.materializar(planilha([ida("POSTO A", "2026-09-10", "6:30:00"), ida("POSTO A", "2026-09-20", "7:00:00")]));
  let r = await pedir("GET", "coberturas", { de: "2026-09-01", ate: "2026-09-15" }, "raphaelvictor");
  assert.equal(r.statusCode, 200); assert.equal(r.body.coberturas.length, 1);
  assert.deepEqual(r.body.disponivel, { primeiro: "2026-09-10", ultimo: "2026-09-20" });
  assert.deepEqual(r.body.limites, { noPrazo: 60, grave: 180 });
  r = await pedir("GET", "coberturas", { de: "2026-09-01", ate: "2026-09-15" }, "adrianomacedo");
  assert.equal(r.statusCode, 403, "supervisor não lê o relatório");
  r = await pedir("GET", "coberturas", { de: "2026-09-01", ate: "2026-09-15" });
  assert.equal(r.statusCode, 403, "sem login também não");
  r = await pedir("GET", "coberturas", { de: "2026-09-15", ate: "2026-09-01" }, "raphaelvictor");
  assert.equal(r.statusCode, 400);
});

test("POST reprocessar: só aprovadores, a partir da última planilha", async () => {
  const t = { bdv_coberturas: [], dashboard_snapshots: [{ id: 1, created_at: "2026-09-21T10:00:00Z", data: planilha([ida("POSTO A", "2026-09-10", "6:30:00")]) }] };
  supabaseFalso(t);
  let r = await pedir("POST", "reprocessar", {}, "jussilenealmeida");
  assert.equal(r.statusCode, 403);
  r = await pedir("POST", "reprocessar", {}, "aprovador");
  assert.equal(r.statusCode, 200); assert.equal(r.body.registros, 1); assert.equal(t.bdv_coberturas.length, 1);
});
