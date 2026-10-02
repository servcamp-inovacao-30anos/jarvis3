// Painel da supervisão: turno pelo supervisor e calendário das faltas abonadas.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const R = require("../api/_faltas_regras");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pedir = (method, t, body) => chamar(rh, { method, query: { modulo: "faltas", t }, usuario: "aprovador", body });

test("turno: só os supervisores Paulo e Ronaldo são da noite; todos os outros são diurnos", () => {
  // nomes como vêm da planilha real
  assert.equal(R.turnoDoSupervisor("PAULO SÉRGIO"), "NOTURNO");
  assert.equal(R.turnoDoSupervisor("RONALDO CIMADOM"), "NOTURNO");
  assert.equal(R.turnoDoSupervisor("  ronaldo cimadon "), "NOTURNO", "maiúsculas, espaços e grafia não importam");
  ["CARLOS NOGUEIRA", "EDNEY FERRAZ", "FRANK PIMENTEL", "ADRIANO MACEDO", "DIURNO RT", "OSEAS - DIURNO", "JUSSILENE COORDENAÇÃO", "", null, undefined]
    .forEach(n => assert.equal(R.turnoDoSupervisor(n), "DIURNO", String(n)));
  assert.equal(R.turnoDoSupervisor("PAULINHO SOUZA"), "DIURNO", "só o primeiro nome inteiro vale");
});

function tabelas() {
  const t = { fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] };
  const f = (re, data, sup, codigo) => t.fm_faltas.push({ re, data, codigo: codigo || "I", nome: "P" + re, cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: sup, escala: "5X2 SDF", tipo: "CONTRATO" });
  f(1, dia(-1), "PAULO SÉRGIO"); f(2, dia(-1), "CARLOS NOGUEIRA");
  // atestado de 3 dias que o SAR2G já mostra como abonado
  [-6, -5, -4].forEach(n => f(3, dia(n), "RONALDO CIMADOM", "A"));
  t.fm_dias.push({ re: 3, data: dia(-3), situacao: "TRABALHO" });
  return t;
}

test("GET casos: cada caso e cada abonada vêm com o turno do supervisor", async () => {
  supabaseFalso(tabelas());
  const r = await pedir("GET", "casos");
  const turno = re => (r.body.casos.find(c => String(c.re) === String(re)) || r.body.abonos.find(a => String(a.re) === String(re))).turno;
  assert.equal(turno(1), "NOTURNO");
  assert.equal(turno(2), "DIURNO");
  assert.equal(turno(3), "NOTURNO");
});

test("GET casos: a abonada vem com o calendário, marcando a falta abonada e os dias do atestado", async () => {
  const t = tabelas(); supabaseFalso(t);
  await pedir("POST", "atestado", { re: 3, tem: true, inicio: dia(-6), dias: 4, envio: dia(-6) });
  const r = await pedir("GET", "casos");
  const ab = r.body.abonos.find(a => String(a.re) === "3");
  assert.ok(R.expandirCalendario(ab.cal).length >= 28, "meses cheios");
  assert.ok(ab.folha && ab.folha.inicio && ab.folha.fim);
  const cal = R.expandirCalendario(ab.cal);
  const d = x => cal.find(c => c.data === dia(x));
  assert.equal(d(-6).tipo, "ABONADA");
  assert.equal(d(-5).tipo, "ABONADA");
  assert.equal(d(-4).tipo, "ABONADA");
  assert.equal(d(-3).tipo, "TRABALHOU", "o 4º dia do atestado: a pessoa consta como trabalhando");
  assert.deepEqual([-7, -6, -3, -2].map(x => d(x).atestado), [false, true, true, false], "o período informado (4 dias) fica marcado");
  assert.equal(ab.primeiraFalta, dia(-6));
});

test("calendário: sem atestado registrado, marca o período das faltas abonadas", async () => {
  supabaseFalso(tabelas());
  const ab = (await pedir("GET", "casos")).body.abonos.find(a => String(a.re) === "3");
  assert.equal(ab.atestado, null);
  assert.deepEqual([-7, -6, -4, -3].map(x => R.expandirCalendario(ab.cal).find(c => c.data === dia(x)).atestado), [false, true, true, false]);
});

test("GET casos: o vínculo (efetivo no posto / reserva técnica) vai junto, nos casos e nas abonadas", async () => {
  const t = tabelas();
  t.fm_faltas.find(f => f.re === 1).tipo = "RESERVA";
  supabaseFalso(t);
  const r = await pedir("GET", "casos");
  assert.equal(r.body.casos.find(c => String(c.re) === "1").tipo, "RESERVA");
  assert.equal(r.body.casos.find(c => String(c.re) === "2").tipo, "CONTRATO");
  assert.equal(r.body.abonos.find(a => String(a.re) === "3").tipo, "CONTRATO");
});
