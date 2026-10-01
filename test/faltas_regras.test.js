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

test("exemplo 9 — voltou e o prazo acabou sem medida: prazo vencido", async t => {
  const base = { faltas: [falta("2026-10-07")], fichaDias: { 521: presente("2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13") }, dataBase: "2026-10-13" };
  await t.test("no último dia do prazo ainda está no prazo", () => {
    assert.equal(unico({ ...base, hoje: "2026-10-12" }).situacao, S.NO_PRAZO);
  });
  await t.test("no dia seguinte vence", () => {
    const c = unico({ ...base, hoje: "2026-10-13" });
    assert.equal(c.situacao, S.PRAZO_VENCIDO);
    assert.match(c.motivo, /o prazo acabou em 12\/10 sem medida\.$/);
    assert.doesNotMatch(c.motivo, /advertência/, "não sugere um tipo de medida");
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
  assert.equal(dia("2026-10-08").tipo, "RETORNO");
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
  assert.deepEqual(cs.map(c => c.situacao), [S.TRATADA_FORA_DO_PRAZO, S.TRATADA]);
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

test("revisão: 12x36 que volta num dia trocado — os plantões do prazo contam a partir do retorno", () => {
  const c = unico({ faltas: [falta("2026-10-10", { ESCALA: "12X36" })], fichaDias: { 521: presente("2026-10-11") }, hoje: "2026-10-11", dataBase: "2026-10-11" });
  assert.equal(c.retorno, "2026-10-11");
  assert.deepEqual(c.prazo, ["2026-10-11", "2026-10-13"]);
});

// ── faltas seguidas depois do retorno (opção B, definida pela coordenação) ──────
test("volta um dia e falta de novo 4 dias seguidos: um caso só, na coordenação", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 1, "não abre um segundo caso");
  assert.equal(cs[0].situacao, S.COORDENACAO);
  assert.deepEqual(cs[0].faltas, ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.match(cs[0].motivo, /^Continua faltando: voltou em qui 08\/10, mas faltou de novo em sex 09\/10 e em mais 3 dias de trabalho seguidos sem voltar/);
});

test("faltas seguidas que passam do fim do prazo, mas ainda não chegam a 4: entram no mesmo caso (sem coordenação)", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-14") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].situacao, S.PRAZO_VENCIDO, "o prazo continua o do 1º retorno");
  assert.deepEqual(cs[0].faltas, ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13"]);
});

test("falta depois da pessoa trabalhar de novo (não é seguida): caso novo", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-14"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-12", "2026-10-13") }, hoje: "2026-10-15", dataBase: "2026-10-15" });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0].faltas, ["2026-10-07", "2026-10-09"]);
  assert.deepEqual(cs[1].faltas, ["2026-10-14"]);
});

test("12x36: faltar 3 plantões seguidos depois do retorno vai para a coordenação", () => {
  const cs = casos({ faltas: ["2026-10-10", "2026-10-14", "2026-10-16", "2026-10-18"].map(d => falta(d, { ESCALA: "12X36" })), fichaDias: { 521: presente("2026-10-12") }, hoje: "2026-10-19", dataBase: "2026-10-19" });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].situacao, S.COORDENACAO);
  assert.deepEqual(cs[0].faltas, ["2026-10-10", "2026-10-14", "2026-10-16", "2026-10-18"]);
});

test("sequência que fecha coordenação não atrapalha o caso seguinte da pessoa", () => {
  const cs = casos({ faltas: ["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-21"].map(d => falta(d)), fichaDias: { 521: presente("2026-10-08", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20") }, hoje: "2026-10-22", dataBase: "2026-10-22" });
  assert.equal(cs.length, 2);
  assert.equal(cs[0].situacao, S.COORDENACAO);
  assert.deepEqual(cs[1].faltas, ["2026-10-21"]);
});
