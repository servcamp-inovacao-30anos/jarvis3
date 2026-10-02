// Horário da vaga (ex.: "08:00–17:00") nas faltas: gravado em fm_faltas.horario e mostrado na tela da supervisão.
// Se a coluna ainda não existe no Supabase, o módulo segue funcionando sem o horário.
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
const falta = (re, data, extra) => ({ RE: re, DATA: data, NOME: "ANA", CARGO: "PORTEIRO (A)", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "5X2 SDF", TIPO: "CONTRATO", ABONO: "I", ...extra });
const planilha = f => ({ faltas: f, fichaDias: {}, disciplina: [], ativos: [] });

const erroColuna = () => new Error("Supabase 400: {\"code\":\"PGRST204\",\"message\":\"Could not find the 'horario' column of 'fm_faltas' in the schema cache\"}");

test("grava o horário da vaga; texto fora do formato vira nulo", async () => {
  const t = tabelas(); supabaseFalso(t);
  await faltas.materializar(planilha([falta(1, dia(-2), { HORARIO: "08:00–17:00" }), falta(2, dia(-2), { HORARIO: "13:00–01:00" }), falta(3, dia(-2), { HORARIO: "lixo" }), falta(4, dia(-2))]));
  assert.deepEqual(t.fm_faltas.map(f => [f.re, f.horario]), [[1, "08:00–17:00"], [2, "13:00–01:00"], [3, null], [4, null]]);
});

test("a tela recebe o horário no caso", async () => {
  const t = tabelas(); supabaseFalso(t);
  await faltas.materializar(planilha([falta(1, dia(-2), { HORARIO: "08:00–17:00" })]));
  const r = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "supervisor.fulano" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.casos.length, 1);
  assert.equal(r.body.casos[0].horario, "08:00–17:00");
});

test("coluna horario ainda não criada no banco: o envio da planilha NÃO quebra", async () => {
  const t = tabelas(); supabaseFalso(t);
  const real = ponto.conectar();
  const db = Object.assign({}, real, {
    upsert: async (tabela, linhas, conf, o) => {
      if (tabela === "fm_faltas" && linhas.some(l => "horario" in l)) throw erroColuna();
      return real.upsert(tabela, linhas, conf, o);
    }
  });
  const r = await faltas.materializar(planilha([falta(1, dia(-2), { HORARIO: "08:00–17:00" })]), { db });
  assert.equal(r.ok, true);
  assert.equal(t.fm_faltas.length, 1, "a falta foi gravada mesmo sem a coluna");
  assert.ok(!("horario" in t.fm_faltas[0]));
});

test("coluna horario ainda não criada: a leitura dos casos também funciona (sem horário)", async () => {
  const t = tabelas(); supabaseFalso(t);
  t.fm_faltas.push({ re: 1, data: dia(-2), codigo: "I", nome: "ANA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" });
  const orig = ponto.conectar;
  ponto.conectar = () => {
    const real = orig();
    return Object.assign({}, real, { listar: async c => { if (/^fm_faltas\?select=[^&]*horario/.test(c)) throw erroColuna(); return real.listar(c); } });
  };
  try {
    const r = await chamar(rh, { method: "GET", query: { modulo: "faltas", t: "casos" }, usuario: "supervisor.fulano" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.casos.length, 1);
    assert.equal(r.body.casos[0].horario, "");
  } finally { ponto.conectar = orig; }
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
