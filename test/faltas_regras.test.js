// Regras do módulo Faltas x Medidas: os exemplos combinados com a coordenação
// (plano, tópico 2) viram testes. Outubro de 2026: 07 é quarta, 10 é sábado.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_faltas_regras");
const S = R.SITUACOES;

const falta = (data, extra) => ({ RE: 521, NOME: "MARIA DA SILVA", DATA: data, ABONO: "I", CARGO: "PORTEIRO (A)", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "5X2 SDF", TIPO: "CONTRATO", ...extra });
const presente = (...datas) => Object.fromEntries(datas.map(d => [d, "TRABALHANDO"]));
const medida = (data, extra) => ({ RE: 521, DATA: data, TIPO: "ADVERTÊNCIA", GRAU: "ESCRITA", DIAS: 0, FASE: "CONCLUIDO", HIST: "P-" + data, MOTIVO: "ATRASO", ...extra });
const casos = e => R.montarCasos({ fichaDias: {}, medidas: [], ...e }).casos;
const unico = e => { const c = casos(e); assert.equal(c.length, 1, "esperava 1 caso, veio " + c.length); return c[0]; };

test("famílias de escala e quem entra no módulo", () => {
  assert.equal(R.familiaEscala("5X2 SDF"), "5X2");
  assert.equal(R.familiaEscala("6X1 T/SD FO/F"), "6X1");
  assert.equal(R.familiaEscala("12X36"), "12X36");
  assert.equal(R.familiaEscala("3X4 FOLGA FIXA"), null);
  assert.equal(R.ehOperacional("DEPARTAMENTO"), false);
  assert.equal(R.ehOperacional("RESERVA"), true);
});

test("situação do dia na Ficha de Presença", () => {
  assert.equal(R.trabalhouNoDia("TRABALHANDO"), true);
  assert.equal(R.trabalhouNoDia("FOLGA"), false);
  assert.equal(R.trabalhouNoDia("FALTA|FT"), true, "a FT no mesmo dia é presença");
  assert.equal(R.trabalhouNoDia(""), null);
  assert.equal(R.trabalhouNoDia(undefined), null);
});

test("exemplo 1 — 5x2, faltou quarta, voltou quinta: prazo quinta, sexta e segunda", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.retorno, "2026-10-08");
  assert.deepEqual(c.prazo, ["2026-10-08", "2026-10-09", "2026-10-12"]);
  assert.equal(c.situacao, S.NO_PRAZO);
});

test("exemplo 2 — 5x2, faltou sexta: aguarda o retorno na segunda e o prazo vai de segunda a quarta", async t => {
  await t.test("antes de voltar", () => {
    const c = unico({ faltas: [falta("2026-10-09")], hoje: "2026-10-09", dataBase: "2026-10-09" });
    assert.equal(c.situacao, S.AGUARDANDO_RETORNO);
    assert.equal(c.retornoPrevisto, "2026-10-12");
  });
  await t.test("depois de voltar", () => {
    const c = unico({ faltas: [falta("2026-10-09")], fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-12", dataBase: "2026-10-12" });
    assert.deepEqual(c.prazo, ["2026-10-12", "2026-10-13", "2026-10-14"]);
  });
});

test("exemplo 3 — 5x2, faltou quinta, voltou sexta: prazo sexta, segunda e terça", () => {
  const c = unico({ faltas: [falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.deepEqual(c.prazo, ["2026-10-09", "2026-10-12", "2026-10-13"]);
});

test("exemplo 4 — 12x36, faltou no plantão do dia 10, voltou dia 12: prazo nos plantões 12 e 14", () => {
  const c = unico({ faltas: [falta("2026-10-10", { ESCALA: "12X36" })], fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-12", dataBase: "2026-10-12" });
  assert.deepEqual(c.prazo, ["2026-10-12", "2026-10-14"]);
  assert.equal(c.prazoFim, "2026-10-14");
});

test("exemplo 5 — qualquer medida dentro do prazo cobre, mesmo por outro motivo", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08", "2026-10-09") }, medidas: [medida("2026-10-09", { MOTIVO: "ATRASO" })], hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.equal(c.situacao, S.TRATADA);
  assert.equal(c.medida.HIST, "P-2026-10-09");
});

test("exemplo 6 — faltou de novo dentro do prazo: mesmo caso, prazo não muda", () => {
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-09")], fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.deepEqual(c.faltas, ["2026-10-07", "2026-10-09"]);
  assert.deepEqual(c.prazo, ["2026-10-08", "2026-10-09", "2026-10-12"]);
});

test("exemplo 7 — 5x2, faltou quarta, quinta, sexta e segunda: coordenação decide", () => {
  const c = unico({ faltas: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"].map(d => falta(d)), hoje: "2026-10-13", dataBase: "2026-10-12" });
  assert.equal(c.situacao, S.COORDENACAO);
  assert.deepEqual(c.faltas, ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]);
  assert.equal(c.motivo, "Continua faltando: faltou em qua 07/10 e em mais 3 dias de trabalho seguidos sem voltar (qui 08/10, sex 09/10 e seg 12/10).");
});

test("exemplo 8 — 12x36, faltou nos plantões 10, 12 e 14: coordenação decide", () => {
  const c = unico({ faltas: ["2026-10-10", "2026-10-12", "2026-10-14"].map(d => falta(d, { ESCALA: "12X36" })), hoje: "2026-10-15", dataBase: "2026-10-14" });
  assert.equal(c.situacao, S.COORDENACAO);
  assert.match(c.motivo, /faltou em sáb 10\/10 e em mais 2 plantões seguidos sem voltar \(seg 12\/10 e qua 14\/10\)/);
});

test("exemplo 9 — voltou e o prazo acabou sem medida: aplicar no mínimo advertência", async t => {
  const base = { faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13") }, dataBase: "2026-10-13" };
  await t.test("no último dia do prazo ainda está no prazo", () => {
    assert.equal(unico({ ...base, hoje: "2026-10-12" }).situacao, S.NO_PRAZO);
  });
  await t.test("no dia seguinte vence", () => {
    const c = unico({ ...base, hoje: "2026-10-13" });
    assert.equal(c.situacao, S.PRAZO_VENCIDO);
    assert.match(c.motivo, /Aplicar no mínimo uma advertência/);
  });
  await t.test("medida depois do prazo resolve, marcada como fora do prazo", () => {
    const c = unico({ ...base, medidas: [medida("2026-10-13")], hoje: "2026-10-13" });
    assert.equal(c.situacao, S.TRATADA_FORA_DO_PRAZO);
  });
});

test("exemplo 10 — falta com atestado (A ou J) não vira caso e vai para as abonadas", () => {
  const r = R.montarCasos({ faltas: [falta("2026-10-07", { ABONO: "A" })], fichaDias: {}, medidas: [], hoje: "2026-10-08" });
  assert.equal(r.casos.length, 0);
  assert.deepEqual(r.abonadas.map(a => [a.data, a.codigo]), [["2026-10-07", "A"]]);
});

test("exemplo 11 — medida de antes da falta não cobre (reset)", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, medidas: [medida("2026-10-01")], hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.situacao, S.NO_PRAZO);
  assert.equal(c.medida, null);
});

test("exemplo 12 — medida com a pessoa ausente: verificar, com o motivo por extenso", async t => {
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, medidas: [medida("2026-10-08")], hoje: "2026-10-09", dataBase: "2026-10-09" });
  await t.test("situação", () => assert.equal(c.situacao, S.VERIFICAR));
  await t.test("o texto conta o que aconteceu", () => {
    assert.match(c.motivo, /MARIA DA SILVA \(RE 521\) faltou em 07\/10 e 08\/10, e só voltou em 09\/10/);
    assert.match(c.motivo, /advertência escrita com data de 08\/10/);
    assert.match(c.motivo, /supervisor da equipe: FRANK/);
    assert.match(c.motivo, /punida duas vezes/);
    assert.match(c.motivo, /O que conferir/);
  });
  await t.test("se já houver uma segunda medida, o texto avisa a possível dupla punição", () => {
    const d = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, medidas: [medida("2026-10-08"), medida("2026-10-09", { TIPO: "SUSPENSÃO", DIAS: 1 })], hoje: "2026-10-09", dataBase: "2026-10-09" });
    assert.match(d.motivo, /Depois, em 09\/10, foi lançada outra medida \(suspensão de 1 dia\(s\)\)/);
  });
});

test("medida cancelada não cobre", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, medidas: [medida("2026-10-08", { FASE: "CANCELADA" })], hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.situacao, S.NO_PRAZO);
});

test("feriado só conta como dia de trabalho se a pessoa trabalhou nele", async t => {
  const base = { faltas: [falta("2026-10-07")], feriados: ["2026-10-09"], hoje: "2026-10-08" };
  await t.test("feriado sem presença fica fora do prazo", () => {
    const c = unico({ ...base, fichaDias: { 521: presente("2026-10-08") }, dataBase: "2026-10-08" });
    assert.deepEqual(c.prazo, ["2026-10-08", "2026-10-12", "2026-10-13"]);
  });
  await t.test("feriado com presença conta", () => {
    const c = unico({ ...base, fichaDias: { 521: presente("2026-10-08", "2026-10-09") }, dataBase: "2026-10-09" });
    assert.deepEqual(c.prazo, ["2026-10-08", "2026-10-09", "2026-10-12"]);
  });
});

test("fora do módulo: departamento e escalas que não são 5x2, 6x1 nem 12x36", () => {
  const r = R.montarCasos({ faltas: [falta("2026-10-07", { TIPO: "DEPARTAMENTO" }), falta("2026-10-07", { RE: 530, ESCALA: "3X4 FOLGA FIXA" })], hoje: "2026-10-08" });
  assert.equal(r.casos.length, 0);
  assert.equal(r.foraDoModulo, 2);
});

test("RE reaproveitado: falta e medida de antes da admissão não contam", () => {
  const c = unico({ faltas: [falta("2026-09-01"), falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, medidas: [medida("2026-09-02")], admissoes: { 521: "2026-09-20" }, hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.primeiraFalta, "2026-10-07");
  assert.equal(c.medida, null);
});

test("abandono marcado no SAR2G vai direto para a coordenação", () => {
  const c = unico({ faltas: [falta("2026-10-07", { LOCAL: "ABANDONO" })], hoje: "2026-10-07", dataBase: "2026-10-07" });
  assert.equal(c.situacao, S.COORDENACAO);
  assert.match(c.motivo, /ABANDONO/);
});

test("faltas separadas por mais que o prazo viram dois casos, e uma medida cobre os dois", () => {
  const dias = presente("2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16");
  const lista = casos({ faltas: [falta("2026-10-07"), falta("2026-10-14")], fichaDias: { 521: dias }, medidas: [medida("2026-10-15")], hoje: "2026-10-16", dataBase: "2026-10-16" });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].situacao, S.TRATADA_FORA_DO_PRAZO, "a 1ª já tinha vencido em 12/10");
  assert.equal(lista[1].situacao, S.TRATADA, "a 2ª estava no prazo");
});

test("competência: do dia 26 ao dia 25 do mês seguinte", () => {
  assert.deepEqual(R.competenciaDe("2026-10-07"), { inicio: "2026-09-26", fim: "2026-10-25" });
  assert.deepEqual(R.competenciaDe("2026-10-26"), { inicio: "2026-10-26", fim: "2026-11-25" });
  assert.deepEqual(R.competenciaDe("2026-12-30"), { inicio: "2026-12-26", fim: "2027-01-25" });
});

test("calendário do card: cada dia com a cor que a regra decidiu", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: { ...presente("2026-10-06", "2026-10-08", "2026-10-09"), "2026-10-04": "FOLGA" } }, medidas: [medida("2026-10-09")], hoje: "2026-10-09", dataBase: "2026-10-09" });
  const cal = R.calendario(c, { dias: { ...presente("2026-10-06", "2026-10-08", "2026-10-09"), "2026-10-04": "FOLGA" }, abonadas: ["2026-10-05"], hoje: "2026-10-09" });
  const tipo = d => cal.find(x => x.data === d).tipo;
  assert.equal(cal.length, 30, "26/09 a 25/10");
  assert.equal(tipo("2026-10-04"), "FOLGA");
  assert.equal(tipo("2026-10-05"), "ABONADA");
  assert.equal(tipo("2026-10-06"), "TRABALHOU");
  assert.equal(tipo("2026-10-07"), "FALTA");
  assert.equal(tipo("2026-10-08"), "RETORNO");
  assert.equal(tipo("2026-10-09"), "MEDIDA");
  assert.equal(tipo("2026-10-12"), "PRAZO");
  assert.ok(cal.find(x => x.data === "2026-10-09").hoje);
  assert.ok(cal.find(x => x.data === "2026-10-12").futuro);
});

test("calendário: falta no último dia da folha mostra o prazo que cai na folha seguinte", () => {
  const dias = presente("2026-10-26");
  const c = unico({ faltas: [falta("2026-10-23")], fichaDias: { 521: dias }, hoje: "2026-10-26", dataBase: "2026-10-26" });
  const cal = R.calendario(c, { dias, hoje: "2026-10-26" });
  assert.equal(cal[0].data, "2026-09-26");
  assert.equal(cal[cal.length - 1].data, "2026-10-28", "vai até o fim do prazo (seg 26, ter 27, qua 28)");
  assert.equal(cal.find(x => x.data === "2026-10-28").tipo, "PRAZO");
});

test("calendário: medida lançada num dia de falta mostra a falta, com a marca da medida", () => {
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, medidas: [medida("2026-10-08")], hoje: "2026-10-09", dataBase: "2026-10-09" });
  const d = R.calendario(c, { dias: presente("2026-10-09"), hoje: "2026-10-09" }).find(x => x.data === "2026-10-08");
  assert.equal(d.tipo, "FALTA");
  assert.equal(d.medida, true);
});

test("planilha real (29/09): liberação total não é dia trabalhado; liberação parcial é", () => {
  assert.equal(R.trabalhouNoDia("LIB. TOTAL"), false);
  assert.equal(R.trabalhouNoDia("LIB. PAR. FUNC."), true);
  assert.equal(R.trabalhouNoDia("LIB. PAR. COB."), true);
  assert.equal(R.trabalhouNoDia("TRABALHO"), true);
});

test("falta sem código de abono: nem vira caso nem entra nas abonadas", () => {
  const r = R.montarCasos({ faltas: [falta("2026-10-07", { ABONO: "—" })], fichaDias: {}, medidas: [], hoje: "2026-10-08" });
  assert.equal(r.casos.length, 0);
  assert.equal(r.abonadas.length, 0);
  assert.deepEqual(r.semCodigo.map(x => x.data), ["2026-10-07"]);
});

test("5X2 DSF folga domingo e segunda: faltou sexta, volta terça", () => {
  const esc = { ESCALA: "5X2 FOLGA DOM/SEG/FER" };
  const antes = unico({ faltas: [falta("2026-10-09", esc)], hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.equal(antes.retornoPrevisto, "2026-10-10", "sábado é dia de trabalho nessa escala");
  const c = unico({ faltas: [falta("2026-10-09", esc)], fichaDias: { 521: presente("2026-10-10") }, hoje: "2026-10-10", dataBase: "2026-10-10" });
  assert.deepEqual(c.prazo, ["2026-10-10", "2026-10-13", "2026-10-14"], "sábado, terça e quarta (domingo e segunda são folga)");
});
