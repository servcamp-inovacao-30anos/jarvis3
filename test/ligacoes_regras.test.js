// Regras puras do Feedback de Faltas (api/_lig_regras.js) e o código "T" na apuração (api/_faltas_regras.js).
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../api/_lig_regras");
const R = require("../api/_faltas_regras");
const { supabaseFalso } = require("./_supabase_falso");
const faltas = require("../api/_faltas");

const ev = (id, acao, chave, depois, extra) => ({ id, acao, chave: String(chave), depois, ator: "raphaelvictor", criado_em: "2026-11-05T10:00:00Z", ...extra });

test("baixa: o último evento de cada contato vale; janela de 30 dias para cada lado", () => {
  const b = L.baixasAtivas([
    ev(1, L.ACAO_BAIXA, 5, { re: 10, nome1: "ANA", nome: "ANA SOUZA", dataContato: "2026-11-05" }),
    ev(2, L.ACAO_BAIXA, 6, { re: 11, nome1: "BIA", nome: "BIA", dataContato: "2026-11-01" }),
    ev(3, L.ACAO_BAIXA_FIM, 6, { motivo: "x" })
  ]);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].contato, b[0].de, b[0].ate], ["5", "2026-10-06", "2026-12-05"]);
  const m = L.tratadasParaApuracao(b);
  assert.deepEqual(m.get("10|ANA"), [{ de: "2026-10-06", ate: "2026-12-05" }]);
});

test("classificarFalta: T só para o que seria I; abono, afastamento e demissão valem mais; RE igual com outro nome não é a mesma pessoa", () => {
  const tratadas = new Map([["10|ANA", [{ de: "2026-10-06", ate: "2026-12-05" }]]]);
  const c = { tratadas };
  assert.equal(R.classificarFalta({ re: 10, data: "2026-11-02", codigo: "I", nome: "ANA SOUZA" }, c), "T");
  assert.equal(R.classificarFalta({ re: 10, data: "2026-12-06", codigo: "I", nome: "ANA SOUZA" }, c), "I", "fora da janela");
  assert.equal(R.classificarFalta({ re: 10, data: "2026-11-02", codigo: "I", nome: "BIA OUTRA" }, c), "I", "outra pessoa com o mesmo RE");
  assert.equal(R.classificarFalta({ re: 10, data: "2026-11-02", codigo: "A", nome: "ANA SOUZA" }, c), "A");
  assert.equal(R.classificarFalta({ re: 10, data: "2026-11-02", codigo: "I", nome: "ANA SOUZA" }, { tratadas, demitidos: new Set(["10|ANA"]) }), "D");
  const oc = R.indexarOcorrencias([{ RE: 10, NOME: "ANA SOUZA", COD: "A", INI: "2026-11-01", FIM: "2026-11-03" }]);
  assert.equal(R.classificarFalta({ re: 10, data: "2026-11-02", codigo: "I", nome: "ANA SOUZA" }, { tratadas, ocorrencias: oc }), "A", "atestado vale mais que o feedback");
  assert.ok(R.NAO_COBRADAS.has("T"));
});

test("montarCasos: falta T não abre caso nem cai em 'sem código'", () => {
  const r = R.montarCasos({
    hoje: "2026-11-05", feriados: [], admissoes: {}, fichaDias: {}, medidas: [],
    faltas: [{ RE: 10, NOME: "ANA", DATA: "2026-11-02", ABONO: "T", CARGO: "X", LOCAL: "P", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }]
  });
  assert.equal(r.casos.length, 0);
  assert.equal(r.semCodigo.length, 0);
});

test("sem acesso ao log de baixas a planilha continua e as faltas T continuam T", async () => {
  const t = { fm_faltas: [{ re: 10, data: "2026-11-02", codigo: "T", nome: "ANA SOUZA" }], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] };
  supabaseFalso(t, { falhar: (m, caminho) => caminho === "fm_auditoria" && m === "GET" });
  const planilha = { faltas: [{ RE: 10, NOME: "ANA SOUZA", DATA: "2026-11-02", ABONO: "I", CARGO: "X", LOCAL: "P", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }], fichaDias: {} };
  const r = await faltas.materializar(planilha);
  assert.equal(r.ok, true);
  assert.equal(t.fm_faltas[0].codigo, "T", "o alarme falso não volta só porque o log caiu");
});

test("sem posicionamento: conta só injustificadas, ignora quem já teve contato desde a 1ª falta", () => {
  const f = (re, data, nome) => ({ re, data, nome: nome || "P" + re, posto: "X", supervisor: "Y" });
  const r = L.semPosicionamento(
    [f(1, "2026-11-01"), f(1, "2026-11-03"), f(2, "2026-11-01"), f(3, "2026-11-01"), f(3, "2026-11-04"), f(4, "2026-11-02"), f(4, "2026-11-02")],
    [{ colaborador: "p3", data_contato: "2026-11-02" }, { colaborador: "P2", data_contato: "2026-10-01" }],
    [{ chave: "1|P1", depois: { ok: true }, criado_em: "2026-11-02T10:00:00Z" }, { chave: "1|P1", depois: { ok: false }, criado_em: "2026-11-02T11:00:00Z" }]
  );
  assert.deepEqual(r.map(x => [x.re, x.tentativas]), [["1", 1]], "P3 tem contato; P2 e P4 só 1 falta (P4 repete o mesmo dia)");
  assert.equal(r[0].ultimaTentativa, "2026-11-02");
});

test("validação: aceita o normal, recusa o resto, limpa texto", () => {
  const ok = L.sanitizarContato({ colaborador: "  Ana \n Souza ", telefone: "(19) 99999-8888", abono: "j", canal: "whatsapp", duracao_min: "7", motivo: "Saúde" }, { completo: true, hoje: "2026-11-05" });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.row.colaborador, ok.row.abono, ok.row.canal, ok.row.duracao_min, ok.row.data_contato], ["Ana Souza", "J", "WHATSAPP", 7, "2026-11-05"]);
  assert.equal(L.sanitizarContato({ colaborador: "A", telefone: "abc" }, { completo: true }).ok, false);
  assert.equal(L.sanitizarContato({ colaborador: "A", duracao_min: 1.5 }, { completo: true }).ok, false);
  assert.equal(L.sanitizarContato({ colaborador: "A", motivo: "Inventado" }, { completo: true }).ok, false);
  assert.equal(L.sanitizarContato({ motivo: "Saúde" }, { completo: false }).ok, true, "edição parcial não exige o nome");
  assert.equal(L.sanitizarContato({ colaborador: "" }, { completo: false }).ok, false, "mas não deixa apagar o nome");
  assert.equal(L.sanitizarContato({ colaborador: "A", justificativa: "x".repeat(5000) }, { completo: true }).row.justificativa.length, 1000);
});

test("celular: só celular brasileiro com DDD", () => {
  assert.equal(L.celular("(19) 99999-8888"), "5519999998888");
  assert.equal(L.celular("+55 19 99999-8888"), "5519999998888");
  assert.equal(L.celular("1933334444"), null);
  assert.equal(L.celular("99999"), null);
  assert.equal(L.celular(""), null);
});
