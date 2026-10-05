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

test("exemplo 1 — 5x2, faltou quarta, voltou quinta: o prazo é até o próximo plantão, quinta", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.retorno, "2026-10-08");
  assert.deepEqual(c.prazo, ["2026-10-08"]);
  assert.equal(c.prazoFim, "2026-10-08");
  assert.equal(c.situacao, S.NO_PRAZO, "no dia do próximo plantão ainda está no prazo (vence hoje)");
});

test("exemplo 2 — 5x2, faltou sexta: o prazo é até o próximo plantão, segunda, mesmo antes de a pessoa voltar", async t => {
  await t.test("antes de voltar o prazo já tem data", () => {
    const c = unico({ faltas: [falta("2026-10-09")], hoje: "2026-10-09", dataBase: "2026-10-09" });
    assert.equal(c.situacao, S.NO_PRAZO);
    assert.equal(c.semRetorno, true, "ainda não voltou");
    assert.equal(c.retornoPrevisto, "2026-10-12");
    assert.equal(c.prazoFim, "2026-10-12");
    assert.deepEqual(c.prazo, ["2026-10-12"]);
  });
  await t.test("depois de voltar", () => {
    const c = unico({ faltas: [falta("2026-10-09")], fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-12", dataBase: "2026-10-12" });
    assert.deepEqual(c.prazo, ["2026-10-12"]);
    assert.equal(c.semRetorno, undefined);
  });
});

test("exemplo 3 — 5x2, faltou quinta, voltou sexta: prazo só na sexta", () => {
  const c = unico({ faltas: [falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.deepEqual(c.prazo, ["2026-10-09"]);
});

test("exemplo 4 — 12x36, faltou no plantão do dia 10, voltou dia 12: o prazo é o próximo plantão, dia 12", () => {
  const c = unico({ faltas: [falta("2026-10-10", { ESCALA: "12X36" })], fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-12", dataBase: "2026-10-12" });
  assert.deepEqual(c.prazo, ["2026-10-12"]);
  assert.equal(c.prazoFim, "2026-10-12");
});

test("o prazo é até o próximo plantão em todas as escalas, já na hora da falta (sem esperar a volta)", () => {
  const prazo = (escala, dia) => unico({ faltas: [falta(dia, { ESCALA: escala })], hoje: dia, dataBase: dia }).prazoFim;
  assert.equal(prazo("5X2 SDF", "2026-10-07"), "2026-10-08", "5x2: quarta → quinta");
  assert.equal(prazo("5X2 SDF", "2026-10-09"), "2026-10-12", "5x2: sexta → segunda (fim de semana é folga)");
  assert.equal(prazo("6X1 T/SD FO/F", "2026-10-10"), "2026-10-12", "6x1: sábado → segunda (domingo é folga)");
  assert.equal(prazo("12X36", "2026-10-10"), "2026-10-12", "12x36: o plantão seguinte é daqui a 2 dias");
});

test("exemplo 5 — qualquer medida dentro do prazo cobre, mesmo por outro motivo", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08", "2026-10-09") }, medidas: [medida("2026-10-08", { MOTIVO: "ATRASO" })], hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.equal(c.situacao, S.TRATADA);
  assert.equal(c.medida.HIST, "P-2026-10-08");
});

test("exemplo 6 — faltou de novo depois de voltar: é outro caso, com o prazo do próximo plantão dele", () => {
  const cs = casos({ faltas: [falta("2026-10-07"), falta("2026-10-09")], fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0].faltas, ["2026-10-07"]);
  assert.deepEqual(cs[0].prazo, ["2026-10-08"]);
  assert.equal(cs[0].situacao, S.PRAZO_VENCIDO, "voltou quinta, hoje é sexta e não há medida");
  assert.deepEqual(cs[1].faltas, ["2026-10-09"]);
  assert.equal(cs[1].prazoFim, "2026-10-12", "sexta → próximo plantão, segunda");
  assert.equal(cs[1].situacao, S.NO_PRAZO);
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

test("exemplo 9 — voltou e o prazo acabou sem medida: prazo vencido", async t => {
  const base = { faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13") }, dataBase: "2026-10-13" };
  await t.test("no dia do próximo plantão ainda está no prazo", () => {
    assert.equal(unico({ ...base, hoje: "2026-10-08" }).situacao, S.NO_PRAZO);
  });
  await t.test("no dia seguinte vence", () => {
    const c = unico({ ...base, hoje: "2026-10-09" });
    assert.equal(c.situacao, S.PRAZO_VENCIDO);
    assert.match(c.motivo, /^O prazo era até o próximo plantão, qui 08\/10, e ainda não há medida\.$/);
    assert.doesNotMatch(c.motivo, /advertência/, "não sugere um tipo de medida");
  });
  await t.test("medida depois do prazo resolve, marcada como fora do prazo", () => {
    const c = unico({ ...base, medidas: [medida("2026-10-09")], hoje: "2026-10-09" });
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

test("exemplo 12 — medida lançada enquanto a pessoa ainda faltava conta como medida aplicada", async t => {
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, medidas: [medida("2026-10-08")], hoje: "2026-10-09", dataBase: "2026-10-09" });
  await t.test("situação", () => assert.equal(c.situacao, S.TRATADA));
  await t.test("a medida é a do dia 08/10", () => assert.equal(c.medida.DATA, "2026-10-08"));
  await t.test("o texto diz que foi antes do retorno", () => assert.match(c.motivo, /advertência escrita em 08\/10, antes do retorno/i));
  await t.test("ainda sem voltar: também conta", () => {
    const d = unico({ faltas: [falta("2026-10-07")], fichaDias: {}, medidas: [medida("2026-10-08")], hoje: "2026-10-08", dataBase: "2026-10-08" });
    assert.equal(d.situacao, S.TRATADA);
  });
});

test("medida cancelada não cobre", () => {
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08") }, medidas: [medida("2026-10-08", { FASE: "CANCELADA" })], hoje: "2026-10-08", dataBase: "2026-10-08" });
  assert.equal(c.situacao, S.NO_PRAZO);
});

test("feriado só conta como próximo plantão se a pessoa trabalhou nele", async t => {
  const base = { faltas: [falta("2026-10-08")], feriados: ["2026-10-09"], hoje: "2026-10-08" };
  await t.test("feriado sem presença não é o próximo plantão: vai para segunda", () => {
    const c = unico({ ...base, dataBase: "2026-10-08" });
    assert.equal(c.prazoFim, "2026-10-12");
  });
  await t.test("feriado com presença: o prazo é o próprio feriado", () => {
    const c = unico({ ...base, fichaDias: { 521: presente("2026-10-09") }, dataBase: "2026-10-09", hoje: "2026-10-09" });
    assert.deepEqual(c.prazo, ["2026-10-09"]);
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
  assert.match(c.motivo, /abandono/i);
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
  assert.equal(tipo("2026-10-08"), "PRAZO", "o dia da volta é o próximo plantão: o último dia para aplicar a medida");
  assert.equal(cal.find(x => x.data === "2026-10-08").retorno, true, "e continua marcado como o dia em que voltou");
  assert.equal(cal.find(x => x.data === "2026-10-08").fimDoPrazo, true);
  assert.equal(tipo("2026-10-09"), "MEDIDA");
  assert.equal(tipo("2026-10-12"), "", "depois do plantão não há mais dia de prazo");
  assert.ok(cal.find(x => x.data === "2026-10-09").hoje);
  assert.ok(cal.find(x => x.data === "2026-10-12").futuro);
});

test("calendário: falta no último dia da folha mostra o prazo que cai na folha seguinte", () => {
  const dias = presente("2026-10-26");
  const c = unico({ faltas: [falta("2026-10-23")], fichaDias: { 521: dias }, hoje: "2026-10-26", dataBase: "2026-10-26" });
  const cal = R.calendario(c, { dias, hoje: "2026-10-26" });
  assert.equal(cal[0].data, "2026-09-26");
  assert.equal(cal[cal.length - 1].data, "2026-10-26", "vai até o fim do prazo (o próximo plantão, seg 26)");
  assert.equal(cal.find(x => x.data === "2026-10-26").tipo, "PRAZO");
});

test("calendário: feriado sem presença é feriado; com presença é dia trabalhado com a marca de feriado", () => {
  const dias = { ...presente("2026-10-06", "2026-10-08", "2026-10-14"), "2026-10-02": "FOLGA" };
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: dias }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  const cal = R.calendario(c, { dias, feriados: ["2026-10-02", "2026-10-14", "2026-10-20"], hoje: "2026-10-15" });
  const dia = d => cal.find(x => x.data === d);
  assert.equal(dia("2026-10-02").tipo, "FERIADO", "folga no feriado: aparece o feriado");
  assert.equal(dia("2026-10-14").tipo, "TRABALHOU");
  assert.equal(dia("2026-10-14").feriado, true);
  assert.equal(dia("2026-10-20").tipo, "FERIADO", "feriado futuro, ainda sem registro");
  assert.equal(dia("2026-10-06").feriado, false);
  assert.equal(cal.filter(x => x.fimDoPrazo).map(x => x.data).join(), c.prazoFim);
});

test("calendário em meses cheios: do mês anterior à falta até o mês seguinte, marcando a folha", () => {
  const dias = presente("2026-10-08");
  const c = unico({ faltas: [falta("2026-10-07")], fichaDias: { 521: dias }, hoje: "2026-10-09", dataBase: "2026-10-09" });
  const cal = R.calendario(c, { dias, hoje: "2026-10-09", meses: true });
  assert.equal(cal[0].data, "2026-09-01");
  assert.equal(cal[cal.length - 1].data, "2026-11-30", "fim da folha (25/10) → outubro inteiro + novembro");
  const dia = d => cal.find(x => x.data === d);
  assert.equal(dia("2026-09-25").naFolha, false);
  assert.equal(dia("2026-09-26").naFolha, true);
  assert.equal(dia("2026-10-25").naFolha, true);
  assert.equal(dia("2026-10-26").naFolha, false);
  assert.equal(dia("2026-10-07").tipo, "FALTA");
  assert.equal(dia("2026-10-08").tipo, "PRAZO");
  assert.equal(dia("2026-10-08").retorno, true);
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
  assert.deepEqual(c.prazo, ["2026-10-10"], "o prazo é o sábado, o próximo plantão");
  const sexta = unico({ faltas: [falta("2026-10-10", esc)], hoje: "2026-10-10", dataBase: "2026-10-10" });
  assert.equal(sexta.prazoFim, "2026-10-13", "faltou no sábado: o próximo plantão é terça (domingo e segunda são folga)");
});

test("abonadas: juntadas pelo período que o atestado cobriu (lido da ficha)", () => {
  const ab = (re, data, codigo) => ({ re, data, codigo: codigo || "A", nome: "P" + re, cargo: "", posto: "X", supervisor: "S", escala: "5X2 SDF" });
  const lista = [
    ab(1, "2026-09-25"), ab(1, "2026-09-28"), ab(1, "2026-09-29"),  // sex + seg/ter: o fim de semana (folga) fica no meio
    ab(2, "2026-09-21"), ab(2, "2026-09-23"),                       // trabalhou no dia 22: são dois períodos
    ab(3, "2026-09-22", "J"), ab(3, "2026-09-23", "A")              // códigos diferentes não se juntam
  ];
  const ficha = { 1: { "2026-09-26": "FOLGA", "2026-09-27": "FOLGA" }, 2: { "2026-09-22": "TRABALHO" } };
  const p = R.periodosDeAbono(lista, ficha);
  const de = re => p.filter(x => x.re === re).map(x => `${x.codigo}:${x.inicio}>${x.fim}:${x.dias}:${x.faltas.length}`).sort();
  assert.deepEqual(de(1), ["A:2026-09-25>2026-09-29:5:3"]);
  assert.deepEqual(de(2), ["A:2026-09-21>2026-09-21:1:1", "A:2026-09-23>2026-09-23:1:1"]);
  assert.deepEqual(de(3), ["A:2026-09-23>2026-09-23:1:1", "J:2026-09-22>2026-09-22:1:1"]);
});

// ── correções da revisão (30/09) ─────────────────────────────────────────────
test("revisão: uma medida cobre as faltas anteriores de mais de um caso (regra combinada)", () => {
  const dias = presente("2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-12");
  const cs = casos({ faltas: [falta("2026-10-01"), falta("2026-10-08")], fichaDias: { 521: dias }, medidas: [medida("2026-10-12")], hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.deepEqual(cs.map(c => c.situacao), [S.TRATADA_FORA_DO_PRAZO, S.TRATADA_FORA_DO_PRAZO], "a medida de 12/10 resolve os dois casos (os dois prazos já tinham passado)");
});

test("revisão: medida atrasada de um caso, lançada no dia da falta do caso seguinte, não vira alerta no caso seguinte", () => {
  const dias = presente("2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09");
  const cs = casos({ faltas: [falta("2026-10-01"), falta("2026-10-08")], fichaDias: { 521: dias }, medidas: [medida("2026-10-08")], hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs[0].situacao, S.TRATADA_FORA_DO_PRAZO, "a medida é do 1º caso");
  assert.equal(cs[1].situacao, S.PRAZO_VENCIDO, "o 2º caso continua sem medida");
  assert.equal(cs[1].medida, null);
});

test("revisão: medida lançada com a pessoa ausente, sem caso anterior, conta como medida aplicada", () => {
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08")], fichaDias: { 521: presente("2026-10-09") }, medidas: [medida("2026-10-08")], hoje: "2026-10-09", dataBase: "2026-10-09" });
  assert.equal(c.situacao, S.TRATADA);
});

test("supervisor: o caso mostra quem cuida da área hoje (o antigo saiu, o novo assumiu)", () => {
  const cs = casos({ faltas: [falta("2026-09-01", { AREA: "RAFAEL", LOCAL: "POSTO A" }), falta("2026-10-01", { AREA: "CARLOS", LOCAL: "POSTO A" })], fichaDias: { 521: presente("2026-09-02", "2026-09-03", "2026-09-04", "2026-10-02") }, hoje: "2026-10-02", dataBase: "2026-10-02" });
  assert.deepEqual(cs.map(c => c.supervisor), ["CARLOS", "CARLOS"], "os dois casos ficam com o supervisor atual");
});

test("revisão: 12x36 que volta num dia trocado — o prazo é o dia em que ela realmente voltou", () => {
  const c = unico({ faltas: [falta("2026-10-10", { ESCALA: "12X36" })], fichaDias: { 521: presente("2026-10-11") }, hoje: "2026-10-11", dataBase: "2026-10-11" });
  assert.equal(c.retorno, "2026-10-11");
  assert.deepEqual(c.prazo, ["2026-10-11"]);
});

// ── faltas seguidas depois do retorno (opção B, definida pela coordenação) ──────
test("volta um dia e falta de novo 4 dias seguidos: o 1º caso é da primeira falta, o 2º vai para a coordenação", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0].faltas, ["2026-10-07"]);
  assert.equal(cs[0].situacao, S.PRAZO_VENCIDO);
  assert.equal(cs[1].situacao, S.COORDENACAO);
  assert.deepEqual(cs[1].faltas, ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.match(cs[1].motivo, /^Continua faltando: faltou em sex 09\/10 e em mais 3 dias de trabalho seguidos sem voltar/);
});

test("faltas seguidas que ainda não chegam a 4: ficam no mesmo caso e o prazo é o próximo plantão depois da última", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-14") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[1].faltas, ["2026-10-09", "2026-10-12", "2026-10-13"]);
  assert.equal(cs[1].retorno, "2026-10-14");
  assert.equal(cs[1].prazoFim, "2026-10-14", "voltou quarta, o próximo plantão depois da última falta");
  assert.equal(cs[1].situacao, S.PRAZO_VENCIDO);
});

test("falta depois da pessoa trabalhar de novo (não é seguida): caso novo", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-14"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-12", "2026-10-13") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[0].faltas, ["2026-10-07"]);
  assert.deepEqual(cs[1].faltas, ["2026-10-09"]);
  assert.deepEqual(cs[2].faltas, ["2026-10-14"]);
});

test("12x36: faltar 3 plantões seguidos depois do retorno vai para a coordenação", () => {
  const cs = casos({ faltas: ["2026-10-10", "2026-10-14", "2026-10-16", "2026-10-18"].map(d => falta(d, { ESCALA: "12X36" })), fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-19", dataBase: "2026-10-19" });
  assert.equal(cs.length, 2);
  assert.equal(cs[1].situacao, S.COORDENACAO);
  assert.deepEqual(cs[1].faltas, ["2026-10-14", "2026-10-16", "2026-10-18"]);
});

test("sequência que fecha coordenação não atrapalha o caso seguinte da pessoa", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-21"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20") }, hoje: "2026-10-22", dataBase: "2026-10-22" });
  assert.equal(cs.length, 3);
  assert.equal(cs[1].situacao, S.COORDENACAO);
  assert.deepEqual(cs[2].faltas, ["2026-10-21"]);
});

test("volta prevista que já passou sem a pessoa aparecer: continua faltando, na coordenação (e sai sozinho quando a planilha mostrar a volta)", async t => {
  // faltou sexta 09/10; a volta prevista é segunda 12/10
  await t.test("no dia do próximo plantão ainda está no prazo (vence hoje)", () => {
    const c = unico({ faltas: [falta("2026-10-09")], hoje: "2026-10-12", dataBase: "2026-10-09" });
    assert.equal(c.situacao, S.NO_PRAZO);
    assert.equal(c.semRetorno, true);
    assert.equal(c.retornoPrevisto, "2026-10-12");
    assert.equal(c.prazoFim, "2026-10-12");
  });
  await t.test("passou o dia previsto e a planilha não mostra a volta: coordenação, uma situação só", () => {
    const c = unico({ faltas: [falta("2026-10-09")], hoje: "2026-10-13", dataBase: "2026-10-09" });
    assert.equal(c.situacao, S.COORDENACAO);
    assert.match(c.motivo, /^Continua faltando/);
    assert.match(c.motivo, /seg 12\/10/);
  });
  await t.test("planilha atualizada mostra a volta: o caso sai da coordenação e ganha prazo", () => {
    const c = unico({ faltas: [falta("2026-10-09")], fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-13", dataBase: "2026-10-13" });
    assert.notEqual(c.situacao, S.COORDENACAO);
    assert.equal(c.retorno, "2026-10-12");
  });
  await t.test("se já tem medida aplicada, não vai para a coordenação", () => {
    const c = unico({ faltas: [falta("2026-10-09")], medidas: [medida("2026-10-13")], hoje: "2026-10-13", dataBase: "2026-10-09" });
    assert.notEqual(c.situacao, S.COORDENACAO);
  });
});

test("abandono: a data só vale se a ficha marcar abandono; senão a planilha não informa (o SAR2G troca o posto de todas as faltas)", () => {
  const base = { faltas: [falta("2026-10-05"), falta("2026-10-06", { LOCAL: "ABANDONO" }), falta("2026-10-07", { LOCAL: "ABANDONO" })], hoje: "2026-10-09", dataBase: "2026-10-09" };
  const sem = unico(base);
  assert.equal(sem.situacao, S.COORDENACAO);
  assert.equal(sem.abandono, true);
  assert.equal(sem.abandonoDesde, "", "sem a ficha não dá para saber quando o abandono foi marcado");
  assert.equal(sem.primeiraFalta, "2026-10-05");
  assert.equal(sem.postoAnterior, "POSTO A");
  assert.ok(sem.motivo.includes("a planilha não informa a data). Faltando desde seg 05/10."));
  const com = unico({ ...base, fichaDias: { 521: { "2026-10-08": "ABANDONO" } } });
  assert.equal(com.abandonoDesde, "2026-10-08");
  assert.equal(com.motivo, "Abandono marcado no SAR2G em qui 08/10. Faltando desde seg 05/10.");
  const cal = R.calendario(com, { dias: {}, hoje: "2026-10-09" });
  const t = d => cal.find(x => x.data === d).tipo;
  assert.equal(t("2026-10-07"), "FALTA");
  assert.equal(t("2026-10-08"), "ABANDONO");
});

test("abandono: falta injustificada num dia e ficha com ABANDONO no dia seguinte (posto da falta normal)", () => {
  const c = unico({ faltas: [falta("2026-09-29")], fichaDias: { 521: { "2026-09-30": "ABANDONO" } }, hoje: "2026-10-02", dataBase: "2026-10-02" });
  assert.equal(c.abandono, true);
  assert.equal(c.primeiraFalta, "2026-09-29");
  assert.equal(c.abandonoDesde, "2026-09-30");
});

test("continua faltando: calendário mostra as faltas seguidas, as folgas e o dia em que devia ter voltado", () => {
  // 5x2: faltou qua 07, qui 08, sex 09 e seg 12 sem voltar; sáb 10 e dom 11 são folga
  const c = unico({ faltas: [falta("2026-10-07"), falta("2026-10-08"), falta("2026-10-09"), falta("2026-10-12")], hoje: "2026-10-13", dataBase: "2026-10-12" });
  assert.equal(c.situacao, S.COORDENACAO);
  assert.equal(c.continua, true);
  assert.equal(c.deveriaTerVoltado, "2026-10-08", "o primeiro dia de trabalho depois da 1ª falta");
  assert.deepEqual(c.folgas, ["2026-10-10", "2026-10-11"]);
  const cal = R.calendario(c, { dias: {}, hoje: "2026-10-13" });
  const t = d => cal.find(x => x.data === d).tipo;
  assert.equal(t("2026-10-07"), "FALTA", "a 1ª falta continua sendo falta");
  assert.equal(t("2026-10-08"), "DEVIA_VOLTAR");
  assert.equal(t("2026-10-09"), "CONTINUOU");
  assert.equal(t("2026-10-10"), "FOLGA", "folga pela escala, mesmo sem registro na ficha");
  assert.equal(t("2026-10-12"), "CONTINUOU");
});

test("continua faltando por volta que não apareceu: devia ter voltado na volta prevista e os dias seguintes sem volta ficam marcados", () => {
  const c = unico({ faltas: [falta("2026-10-07")], hoje: "2026-10-14", dataBase: "2026-10-08" });
  assert.equal(c.situacao, S.COORDENACAO);
  assert.equal(c.continua, true);
  assert.equal(c.deveriaTerVoltado, c.retornoPrevisto);
  const cal = R.calendario(c, { dias: {}, hoje: "2026-10-14" });
  const t = d => cal.find(x => x.data === d).tipo;
  assert.equal(t(c.retornoPrevisto), "DEVIA_VOLTAR");
  assert.equal(t("2026-10-13"), "CONTINUOU", "dia de trabalho depois da volta prevista, sem a pessoa de volta");
  assert.equal(t("2026-10-11"), "FOLGA");
});

test("os tipos novos do calendário passam pelo formato compacto", () => {
  const cal = [{ data: "2026-10-07", tipo: "CONTINUOU" }, { data: "2026-10-08", tipo: "DEVIA_VOLTAR" }, { data: "2026-10-09", tipo: "ABANDONO", medida: true }];
  const volta = R.expandirCalendario(R.compactarCalendario(cal));
  assert.deepEqual(volta.map(x => x.tipo), ["CONTINUOU", "DEVIA_VOLTAR", "ABANDONO"]);
  assert.equal(volta[2].medida, true);
});

test("calendário: o dia do retorno que é o fim do prazo vai com a marca de retorno; o formato compacto guarda essa marca", () => {
  const cal = [{ data: "2026-10-08", tipo: "PRAZO", fimDoPrazo: true, retorno: true }, { data: "2026-10-09", tipo: "MEDIDA", medida: true }];
  const volta = R.expandirCalendario(R.compactarCalendario(cal));
  assert.equal(volta[0].tipo, "PRAZO");
  assert.equal(volta[0].retorno, true);
  assert.equal(volta[0].fimDoPrazo, true);
  assert.equal(volta[1].retorno, false);
  assert.equal(volta[1].medida, true);
});
