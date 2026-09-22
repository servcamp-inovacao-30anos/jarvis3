// Testes do motor de regras do monitoramento de ponto.
// Rodar com:  npm test   (ou  node --test test/)
// Usa só o runner nativo do Node — nenhuma dependência nova.

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_ponto_regras");

test("tabela obrigatória do plano", async t => {
  await t.test("entrada 18:00, marcada 17:55 → NORMAL", () => {
    assert.equal(R.classificar("18:00", "17:55", "EXTRA ENTRADA", 5), null);
  });
  await t.test("entrada 18:00, marcada 17:54 → EARLY_ENTRY, 6 min", () => {
    assert.deepEqual(R.classificar("18:00", "17:54", "EXTRA ENTRADA", 5), { tipo: "EARLY_ENTRY", minutos: 6 });
  });
  await t.test("entrada 07:00, marcada 07:05 → NORMAL", () => {
    assert.equal(R.classificar("07:00", "07:05", "EXTRA ENTRADA", 5), null);
  });
  await t.test("saída 17:00, marcada 17:05 → NORMAL", () => {
    assert.equal(R.classificar("17:00", "17:05", "EXTRA SAIDA", 5), null);
  });
  await t.test("saída 17:00, marcada 17:06 → LATE_EXIT, 6 min", () => {
    assert.deepEqual(R.classificar("17:00", "17:06", "EXTRA SAIDA", 5), { tipo: "LATE_EXIT", minutos: 6 });
  });
  await t.test("25/09/2026 → competência 26/08 a 25/09", () => {
    assert.deepEqual(R.competenciaDe("2026-09-25"), { inicio: "2026-08-26", fim: "2026-09-25" });
  });
  await t.test("26/09/2026 → competência 26/09 a 25/10", () => {
    assert.deepEqual(R.competenciaDe("2026-09-26"), { inicio: "2026-09-26", fim: "2026-10-25" });
  });
  await t.test("jornada 24/09 22:00 → 25/09 06:00, saída 25/09 06:30 → pertence a 24/09", () => {
    const dia = R.dataDaJornada({ marcacao: "2026-09-25T06:30", tipo: "EXTRA SAIDA", entradaPrevista: "22:00", saidaPrevista: "06:00" });
    assert.equal(dia, "2026-09-24");
  });
  await t.test("MINUTOS = 4680 (segundos) → 78 minutos, não 4680", () => {
    assert.equal(R.minutosDeSegundos(4680), 78);
    assert.notEqual(R.minutosDeSegundos(4680), 4680);
  });
});

test("classificar — tolerância e diferença completa", async t => {
  await t.test("ultrapassou a tolerância: conta a diferença inteira, não desconta os 5", () => {
    assert.deepEqual(R.classificar("08:00", "07:30", "EXTRA ENTRADA", 5), { tipo: "EARLY_ENTRY", minutos: 30 });
    assert.deepEqual(R.classificar("17:00", "17:45", "EXTRA SAIDA", 5), { tipo: "LATE_EXIT", minutos: 45 });
  });
  await t.test("tolerância é configurável", () => {
    assert.equal(R.classificar("18:00", "17:50", "EXTRA ENTRADA", 10), null);
    assert.deepEqual(R.classificar("18:00", "17:49", "EXTRA ENTRADA", 10), { tipo: "EARLY_ENTRY", minutos: 11 });
  });
  await t.test("sem tolerância informada, usa 5", () => {
    assert.equal(R.classificar("17:00", "17:05", "EXTRA SAIDA"), null);
    assert.deepEqual(R.classificar("17:00", "17:06", "EXTRA SAIDA"), { tipo: "LATE_EXIT", minutos: 6 });
  });
  await t.test("atraso na entrada e saída antecipada ficam fora da v1", () => {
    assert.equal(R.classificar("07:00", "07:30", "EXTRA ENTRADA", 5), null);
    assert.equal(R.classificar("17:00", "16:30", "EXTRA SAIDA", 5), null);
  });
  await t.test("tipo com acento e em minúsculas", () => {
    assert.deepEqual(R.classificar("17:00", "17:20", "extra saída", 5), { tipo: "LATE_EXIT", minutos: 20 });
  });
  await t.test("segundos são descartados", () => {
    assert.equal(R.classificar("18:00:00", "17:55:59", "EXTRA ENTRADA", 5), null);
    assert.deepEqual(R.classificar("18:00:00", "17:54:10", "EXTRA ENTRADA", 5), { tipo: "EARLY_ENTRY", minutos: 6 });
  });
  await t.test("marcação que atravessa a meia-noite (só hora)", () => {
    assert.deepEqual(R.classificar("00:10", "23:55", "EXTRA ENTRADA", 5), { tipo: "EARLY_ENTRY", minutos: 15 });
    assert.deepEqual(R.classificar("23:50", "00:20", "EXTRA SAIDA", 5), { tipo: "LATE_EXIT", minutos: 30 });
  });
  await t.test("com data dos dois lados, a diferença é exata", () => {
    assert.deepEqual(R.classificar("2026-09-25T06:00", "2026-09-25T06:30", "EXTRA SAIDA", 5), { tipo: "LATE_EXIT", minutos: 30 });
  });
  await t.test("entrada inválida não gera ocorrência", () => {
    assert.equal(R.classificar("", "17:54", "EXTRA ENTRADA", 5), null);
    assert.equal(R.classificar("18:00", "25:00", "EXTRA ENTRADA", 5), null);
    assert.equal(R.classificar("18:00", "17:00", "FT", 5), null);
    assert.equal(R.classificar("18:00", "17:00", "EXTRA ENTRADA", -1), null);
  });
});

test("competenciaDe — viradas de ano", () => {
  assert.deepEqual(R.competenciaDe("2026-12-26"), { inicio: "2026-12-26", fim: "2027-01-25" });
  assert.deepEqual(R.competenciaDe("2027-01-10"), { inicio: "2026-12-26", fim: "2027-01-25" });
  assert.deepEqual(R.competenciaDe("2026-01-25"), { inicio: "2025-12-26", fim: "2026-01-25" });
  assert.equal(R.competenciaDe("sem data"), null);
});

test("dataDaJornada — outros casos", async t => {
  await t.test("entrada antecipada em jornada noturna fica no próprio dia", () => {
    assert.equal(R.dataDaJornada({ marcacao: "2026-09-24T21:40", tipo: "EXTRA ENTRADA", entradaPrevista: "22:00", saidaPrevista: "06:00" }), "2026-09-24");
  });
  await t.test("entrada às 23:55 para jornada das 00:10 pertence ao dia seguinte", () => {
    assert.equal(R.dataDaJornada({ marcacao: "2026-09-24T23:55", tipo: "EXTRA ENTRADA", entradaPrevista: "00:10", saidaPrevista: "08:10" }), "2026-09-25");
  });
  await t.test("jornada diurna", () => {
    assert.equal(R.dataDaJornada({ marcacao: "2026-09-25T17:30", tipo: "EXTRA SAIDA", entradaPrevista: "08:00", saidaPrevista: "17:00" }), "2026-09-25");
  });
  await t.test("virada de mês", () => {
    assert.equal(R.dataDaJornada({ marcacao: "2026-10-01T06:20", tipo: "EXTRA SAIDA", entradaPrevista: "18:00", saidaPrevista: "06:00" }), "2026-09-30");
  });
  await t.test("marcação só com hora usa a data da linha", () => {
    assert.equal(R.dataDaJornada({ marcacao: "06:30", data: "2026-09-24", tipo: "EXTRA SAIDA", entradaPrevista: "22:00", saidaPrevista: "06:00" }), "2026-09-24");
  });
});

test("chaveDedup", async t => {
  const base = R.chaveDedup(521, "2026-09-24", "LATE_EXIT", "06:30");
  await t.test("é estável e em hash", () => {
    assert.equal(base, R.chaveDedup(521, "2026-09-24", "LATE_EXIT", "06:30"));
    assert.match(base, /^[0-9a-f]{64}$/);
  });
  await t.test("formatos diferentes da mesma batida dão a mesma chave", () => {
    assert.equal(base, R.chaveDedup("0521", "2026-09-24", "late_exit", "06:30:00"));
    assert.equal(base, R.chaveDedup("521", "2026-09-24", "LATE_EXIT", "2026-09-25T06:30"));
  });
  await t.test("batidas diferentes dão chaves diferentes", () => {
    assert.notEqual(base, R.chaveDedup(521, "2026-09-24", "LATE_EXIT", "06:31"));
    assert.notEqual(base, R.chaveDedup(522, "2026-09-24", "LATE_EXIT", "06:30"));
    assert.notEqual(base, R.chaveDedup(521, "2026-09-25", "LATE_EXIT", "06:30"));
    assert.notEqual(base, R.chaveDedup(521, "2026-09-24", "EARLY_ENTRY", "06:30"));
  });
});

test("segmentosSMS", async t => {
  await t.test("GSM-7: 160 caracteres cabem em 1 SMS; 161 viram 2", () => {
    assert.equal(R.segmentosSMS("a".repeat(160)), 1);
    assert.equal(R.segmentosSMS("a".repeat(161)), 2);
    assert.equal(R.segmentosSMS("a".repeat(306)), 2);
    assert.equal(R.segmentosSMS("a".repeat(307)), 3);
  });
  await t.test("um acento derruba o limite para 70", () => {
    assert.equal(R.segmentosSMS("ã" + "a".repeat(69)), 1);
    assert.equal(R.segmentosSMS("ã" + "a".repeat(70)), 2);
    assert.equal(R.analisarSMS("orientação").codificacao, "UCS-2");
    assert.equal(R.analisarSMS("ç").codificacao, "UCS-2");
  });
  await t.test("é, à e Ç maiúsculo estão na tabela GSM", () => {
    assert.equal(R.analisarSMS("é à Ç").codificacao, "GSM-7");
  });
  await t.test("caracteres de extensão custam duas posições", () => {
    assert.equal(R.analisarSMS("{}").unidades, 4);
    assert.equal(R.segmentosSMS("a".repeat(159) + "["), 2);
    assert.equal(R.segmentosSMS("a".repeat(158) + "["), 1);
  });
  await t.test("mensagem vazia não custa nada", () => {
    assert.equal(R.segmentosSMS(""), 0);
  });
});
