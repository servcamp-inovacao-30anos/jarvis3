// Horário da vaga (ex.: "08:00–17:00") nas faltas, mostrado na tela da supervisão.
// Vem do registro da última planilha enviada (dashboard_snapshots): não usa coluna nova no banco.
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
const faltas = require("../api/_faltas");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const tabelas = () => ({ fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] });
const fm = (re, d, tipo) => ({ re, data: d, codigo: "I", nome: "ANA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: tipo || "CONTRATO" });
const registro = (criado, faltasDoRegistro) => ({ created_at: criado, data: { faltas: faltasDoRegistro } });
const casos = async () => (await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "supervisor.fulano" }));

test("o horário da vaga vem do registro da última planilha (sem coluna nova no banco)", async () => {
  const t = tabelas();
  t.fm_faltas.push(fm(1, dia(-2)));
  t.dashboard_snapshots = [registro("2026-10-01T10:00:00Z", [{ RE: 1, DATA: dia(-2), HORARIO: "08:00–17:00" }])];
  supabaseFalso(t);
  const r = await casos();
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.casos[0].horario, "08:00–17:00");
});

test("vale só o registro MAIS RECENTE e horário fora do formato é ignorado", async () => {
  const t = tabelas();
  t.fm_faltas.push(fm(1, dia(-2)), fm(2, dia(-2)));
  t.dashboard_snapshots = [
    registro("2026-09-01T10:00:00Z", [{ RE: 1, DATA: dia(-2), HORARIO: "06:00–15:00" }]),
    registro("2026-10-01T10:00:00Z", [{ RE: 1, DATA: dia(-2), HORARIO: "08:00–17:00" }, { RE: 2, DATA: dia(-2), HORARIO: "lixo" }])
  ];
  supabaseFalso(t);
  const c = Object.fromEntries((await casos()).body.casos.map(x => [x.re, x.horario]));
  assert.deepEqual(c, { 1: "08:00–17:00", 2: "" });
});

test("dia que não está no registro: o efetivo mantém o horário da vaga; a reserva técnica não (ela muda de vaga)", async () => {
  const t = tabelas();
  t.fm_faltas.push(fm(1, dia(-5), "CONTRATO"), fm(2, dia(-5), "RESERVA"));
  t.dashboard_snapshots = [registro("2026-10-01T10:00:00Z", [{ RE: 1, DATA: dia(-1), HORARIO: "08:00–17:00" }, { RE: 2, DATA: dia(-1), HORARIO: "13:00–01:00" }])];
  supabaseFalso(t);
  const c = Object.fromEntries((await casos()).body.casos.map(x => [x.re, x.horario]));
  assert.deepEqual(c, { 1: "08:00–17:00", 2: "" });
});

test("sem registro de planilha (ou sem o campo): os casos aparecem normalmente, sem horário", async () => {
  const t = tabelas();
  t.fm_faltas.push(fm(1, dia(-2)));
  t.dashboard_snapshots = [registro("2026-10-01T10:00:00Z", [{ RE: 1, DATA: dia(-2) }])];
  supabaseFalso(t);
  const a = await casos();
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.casos[0].horario, "");
  t.dashboard_snapshots = [];
  const b = await casos();
  assert.equal(b.statusCode, 200);
  assert.equal(b.body.casos[0].horario, "");
});

// leitura do horário na planilha (função da tela, lida direto do index.html)
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const ini = html.indexOf("function fmHoraDe("), fim = html.indexOf("/*fim fmHorarioDe*/");
assert.ok(ini > 0 && fim > ini, "fmHorarioDe não encontrada no index.html");
const { fmHorarioDe } = new Function(html.slice(ini, fim) + "\nreturn{fmHoraDe,fmHorarioDe};")();

test("planilha: horário vem como data com hora, número do Excel ou texto, e sempre sai HH:MM–HH:MM", () => {
  // data com hora, com os 28 segundos que a biblioteca do Excel costuma deixar
  const d = (h, m) => new Date(2026, 8, 29, h, m, 28);
  assert.equal(fmHorarioDe(d(8, 0), d(17, 0)), "08:00–17:00");
  assert.equal(fmHorarioDe(d(10, 0), d(22, 0)), "10:00–22:00");
  assert.equal(fmHorarioDe(8 / 24, 17 / 24), "08:00–17:00", "número do Excel (fração do dia)");
  assert.equal(fmHorarioDe(46294.333333333336, 46294.708333333336), "08:00–17:00", "número com a data junto");
  assert.equal(fmHorarioDe("07:30", "16:30:00"), "07:30–16:30");
  assert.equal(fmHorarioDe(null, null), "");
  assert.equal(fmHorarioDe("08:00", null), "", "só com entrada e saída juntas");
  assert.equal(fmHorarioDe("sem horario", "x"), "");
});

// o leitor de planilha do servidor também traz o horário da vaga (mesma regra do navegador)
test("leitor de planilha: a falta traz o horário da vaga (entrada–saída), como o Excel grava", () => {
  process.env.TZ = "America/Sao_Paulo";
  const XLSX = require("xlsx");
  const P = require("../api/_parse");
  const serial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  const cab = ["RE", "NOMEFUNCIONARIO", "DATA", "DESCSITUACAOHOJE", "DESCESCALA", "DESCTPABONO", "NOMELOCAL", "DESC_CARGO", "AREASUPERVISAO", "TPCLIENTE", "HRENTRADA", "HRSAIDA"];
  const ws = XLSX.utils.aoa_to_sheet([cab,
    [521, "ANA", serial(2026, 10, 10), "FALTA", "6X1 FOLGA DOM/FER", "I", "POSTO A", "PORTEIRO (A)", "FRANK", "CONTRATO", 8 / 24, 17 / 24],
    [522, "BIA", serial(2026, 10, 10), "FALTA", "12X36", "I", "POSTO B", "PORTEIRO (A)", "CARLOS", "RESERVA", 19 / 24, 7 / 24]
  ]);
  ws["C2"].z = "m/d/yy"; ws["C3"].z = "m/d/yy";
  ["K2", "L2", "K3", "L3"].forEach(c => { ws[c].z = "h:mm"; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "FICHA PRESENCA");
  const lido = P.buildDataFromWorkbook(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true }));
  assert.deepEqual(lido.faltas.map(f => [f.RE, f.HORARIO]), [[521, "08:00–17:00"], [522, "19:00–07:00"]]);
});
