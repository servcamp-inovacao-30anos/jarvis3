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

test("base de contatos", async t => {
  const linha = (extra) => ({
    re: "521", nome_cadastro: "MARIA DA SILVA", nome_norm: "MARIA DA SILVA",
    telefone_original: "(19) 99876-5432", telefone_e164: "+5519998765432",
    tipo_telefone: "CELULAR", enviavel: "true", origem: "CADASTRO", data_base: "2026-09-01", ...extra
  });

  await t.test("só as colunas permitidas entram no banco", () => {
    const { upserts } = R.planejarContatos([], [linha({ cpf: "123.456.789-00", rg: "12.345.678-9", nome_mae: "ANA", endereco: "RUA X" })], { agora: "2026-09-22T10:00:00Z" });
    assert.deepEqual(Object.keys(upserts[0]).sort(), [...R.CAMPOS_CONTATO, "atualizado_em"].sort());
    assert.equal(upserts[0].cpf, undefined);
  });
  await t.test("aceita cabeçalho em maiúsculas e com espaços", () => {
    const { contato } = R.normalizarContato({ RE: 521, "Telefone E164": "+5519998765432", "Tipo Telefone": "celular", Enviavel: "SIM" });
    assert.equal(contato.re, 521);
    assert.equal(contato.tipo_telefone, "CELULAR");
    assert.equal(contato.enviavel, true);
  });
  await t.test("novo, atualizado e inalterado", () => {
    const existentes = [
      { re: 521, nome_cadastro: "MARIA DA SILVA", nome_norm: "MARIA DA SILVA", telefone_original: "(19) 99876-5432", telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true, origem: "CADASTRO", data_base: "2026-09-01" },
      { re: 522, nome_cadastro: "JOAO", nome_norm: "JOAO", telefone_original: null, telefone_e164: null, tipo_telefone: "SEM_TELEFONE", enviavel: false, origem: "CADASTRO", data_base: "2026-09-01" }
    ];
    const { resumo, upserts } = R.planejarContatos(existentes, [
      linha(),
      linha({ re: "522", nome_cadastro: "JOAO", nome_norm: "JOAO", telefone_e164: "+5519911112222", telefone_original: "19911112222" }),
      linha({ re: "523", nome_cadastro: "ANA", nome_norm: "ANA" })
    ]);
    assert.equal(resumo.inalterados, 1);
    assert.equal(resumo.atualizados, 1);
    assert.equal(resumo.novos, 1);
    assert.deepEqual(upserts.map(u => u.re).sort(), [522, 523]);
  });
  await t.test("telefone alterado vai para a auditoria com o valor anterior", () => {
    const existentes = [{ re: 521, telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true }];
    const { resumo, auditorias } = R.planejarContatos(existentes, [linha({ telefone_e164: "+5519911112222" })], { ator: "raphaelvictor" });
    assert.equal(resumo.telefones_alterados, 1);
    assert.equal(auditorias[0].acao, "TELEFONE_ALTERADO");
    assert.equal(auditorias[0].ator, "raphaelvictor");
    assert.equal(auditorias[0].antes.telefone_e164, "+5519998765432");
    assert.equal(auditorias[0].depois.telefone_e164, "+5519911112222");
  });
  await t.test("fixo marcado como enviável não vira enviável", () => {
    const { resumo, upserts } = R.planejarContatos([], [linha({ tipo_telefone: "FIXO", telefone_e164: "+551932345678" })]);
    assert.equal(upserts[0].enviavel, false);
    assert.equal(resumo.inconsistentes, 1);
  });
  await t.test("celular fora do padrão E.164 brasileiro não vira enviável", () => {
    assert.equal(R.normalizarContato(linha({ telefone_e164: "+11998765432" })).contato.enviavel, false);
    assert.equal(R.normalizarContato(linha({ telefone_e164: "+551998765432" })).contato.enviavel, false);
  });
  await t.test("RE inválido e RE repetido são rejeitados, com a linha da planilha", () => {
    const { resumo, rejeitadas } = R.planejarContatos([], [linha(), linha({ re: "" }), linha({ re: "0521" }), linha({ re: "ABC" })]);
    assert.equal(resumo.validas, 1);
    assert.equal(resumo.rejeitadas, 3);
    assert.deepEqual(rejeitadas.map(r => [r.linha, r.motivo]), [[3, "RE_INVALIDO"], [4, "RE_REPETIDO_NO_ARQUIVO"], [5, "RE_INVALIDO"]]);
  });
  await t.test("resumo separa enviáveis e não enviáveis por tipo", () => {
    const { resumo } = R.planejarContatos([], [
      linha({ re: "1" }), linha({ re: "2" }), linha({ re: "3", tipo_telefone: "CELULAR_CORRIGIDO" }),
      linha({ re: "4", tipo_telefone: "SEM_TELEFONE", telefone_e164: "", enviavel: "false" }),
      linha({ re: "5", tipo_telefone: "FIXO", telefone_e164: "+551932345678", enviavel: "false" }),
      linha({ re: "6", tipo_telefone: "INVALIDO", telefone_e164: "+55199", enviavel: "false" })
    ]);
    assert.equal(resumo.enviaveis, 3);
    assert.equal(resumo.nao_enviaveis, 3);
    assert.equal(resumo.sem_telefone, 1);
    assert.deepEqual(resumo.por_tipo, { CELULAR: 2, CELULAR_CORRIGIDO: 1, SEM_TELEFONE: 1, FIXO: 1, INVALIDO: 1 });
  });
  await t.test("data da base aceita dd/mm/aaaa", () => {
    assert.equal(R.normalizarContato(linha({ data_base: "01/09/2026" })).contato.data_base, "2026-09-01");
    assert.equal(R.normalizarContato(linha({ data_base: "32/09/2026" })).contato.data_base, null);
  });
});
