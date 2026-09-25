// Detecção de ocorrências (Etapa 4) e montagem das mensagens.

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_ponto_regras");
const { normNome } = require("../api/_parse");

const ativos = [
  { RE: 521, NOME: "MARIA DA SILVA", AREA: "FRANK", LOCAL: "POSTO A", TPCLIENTE: "CONTRATO" },
  { RE: 522, NOME: "JOAO SOUZA", AREA: "FRANK", LOCAL: "POSTO B" },
  { RE: 530, NOME: "ANA LIMA" },
  { RE: 531, NOME: "ANA  LIMA" }
];

const linha = extra => ({
  NOME: "MARIA DA SILVA", DATA: "2026-09-24", TIPO: "EXTRA ENTRADA",
  HRENTRADA: "18:00", HRMRENTRADA: "17:54", HRSAIDA: "06:00", HRMRSAIDA: "06:00",
  LOCAL: "POSTO A", CLIENTE: "CLIENTE A", AREA: "FRANK", MINUTOS: 360, RE: "", ...extra
});

const detectar = (linhas, extra) => R.detectarOcorrencias(linhas, ativos, { tolerancia: 5, dataVirada: "2026-09-01", normNome, ...extra });

test("detectarOcorrencias", async t => {
  await t.test("sem data de virada o módulo fica desligado", () => {
    const r = detectar([linha()], { dataVirada: null });
    assert.equal(r.ativo, false);
    assert.equal(r.ocorrencias.length, 0);
  });
  await t.test("entrada antecipada vira ocorrência com RE, horários e posto", () => {
    const [oc] = detectar([linha()]).ocorrencias;
    assert.equal(oc.re, 521);
    assert.equal(oc.tipo, "EARLY_ENTRY");
    assert.equal(oc.diferenca_minutos, 6);
    assert.equal(oc.horario_previsto, "18:00");
    assert.equal(oc.horario_marcado, "17:54");
    assert.equal(oc.data_jornada, "2026-09-24");
    assert.equal(oc.posto, "POSTO A");
    assert.equal(oc.supervisor, "FRANK");
    assert.equal(oc.reconciliacao, null);
    assert.equal(oc.status, "DETECTADA");
    assert.match(oc.chave_dedup, /^[0-9a-f]{64}$/);
  });
  await t.test("saída após o horário", () => {
    const [oc] = detectar([linha({ TIPO: "EXTRA SAIDA", HRENTRADA: "08:00", HRMRENTRADA: "08:00", HRSAIDA: "17:00", HRMRSAIDA: "17:40" })]).ocorrencias;
    assert.equal(oc.tipo, "LATE_EXIT");
    assert.equal(oc.diferenca_minutos, 40);
  });
  await t.test("dentro da tolerância não gera nada", () => {
    const r = detectar([linha({ HRMRENTRADA: "17:55" })]);
    assert.equal(r.ocorrencias.length, 0);
    assert.equal(r.stats.dentro_tolerancia, 1);
  });
  await t.test("FT, DOBRA e outros tipos ficam de fora", () => {
    const r = detectar([linha({ TIPO: "FT" }), linha({ TIPO: "DOBRA" })]);
    assert.equal(r.stats.consideradas, 0);
    assert.equal(r.ocorrencias.length, 0);
  });
  await t.test("nada anterior à data de virada — nem no histórico", () => {
    const r = detectar([linha({ DATA: "2026-08-31" }), linha({ DATA: "2026-09-01", HRMRENTRADA: "17:40" })]);
    assert.equal(r.ocorrencias.length, 1);
    assert.equal(r.ocorrencias[0].data_jornada, "2026-09-01");
    assert.equal(r.stats.antes_da_virada, 1);
  });
  await t.test("nome sem par no quadro ativo fica pendente de reconciliação", () => {
    const [oc] = detectar([linha({ NOME: "FULANO DE TAL" })]).ocorrencias;
    assert.equal(oc.re, null);
    assert.equal(oc.reconciliacao, "NOME_NAO_ENCONTRADO");
  });
  await t.test("nome com dois pares é ambíguo (mesma normalização do sistema)", () => {
    const [oc] = detectar([linha({ NOME: "ana lima" })]).ocorrencias;
    assert.equal(oc.re, null);
    assert.equal(oc.reconciliacao, "NOME_AMBIGUO");
  });
  await t.test("com coluna RE na aba, o nome não é usado", () => {
    const [oc] = detectar([linha({ NOME: "NOME DIFERENTE", RE: "522" })]).ocorrencias;
    assert.equal(oc.re, 522);
    assert.equal(oc.reconciliacao, null);
  });
  await t.test("RE da aba fora do quadro ativo vai para reconciliação", () => {
    const [oc] = detectar([linha({ RE: "999" })]).ocorrencias;
    assert.equal(oc.re, 999);
    assert.equal(oc.reconciliacao, "RE_NAO_ENCONTRADO");
  });
  await t.test("a mesma batida duas vezes na planilha conta uma vez", () => {
    const r = detectar([linha(), linha()]);
    assert.equal(r.ocorrencias.length, 1);
    assert.equal(r.stats.repetidas, 1);
  });
  await t.test("reprocessar a mesma planilha dá as mesmas chaves", () => {
    assert.equal(detectar([linha()]).ocorrencias[0].chave_dedup, detectar([linha()]).ocorrencias[0].chave_dedup);
  });
  await t.test("linha sem os horários é contada, não inventada", () => {
    const r = detectar([linha({ HRENTRADA: "", HRMRENTRADA: "" })]);
    assert.equal(r.ocorrencias.length, 0);
    assert.equal(r.stats.sem_horario, 1);
  });
  await t.test("saída de jornada noturna com data na marcação fica no dia do início", () => {
    const [oc] = detectar([linha({ TIPO: "EXTRA SAIDA", DATA: "2026-09-25", HRENTRADA: "22:00", HRMRENTRADA: "22:00", HRSAIDA: "06:00", HRMRSAIDA: "2026-09-25T06:30" })]).ocorrencias;
    assert.equal(oc.data_jornada, "2026-09-24");
    assert.equal(oc.horario_marcado, "06:30");
  });
});

test("competenciasNecessarias", async t => {
  await t.test("a competência da virada nasce parcial; a seguinte, completa", () => {
    const comps = R.competenciasNecessarias([{ data_jornada: "2026-09-12" }, { data_jornada: "2026-09-27" }, { data_jornada: "2026-09-13" }], "2026-09-10");
    assert.deepEqual(comps, [
      { data_inicio: "2026-08-26", data_fim: "2026-09-25", parcial: true, data_corte: "2026-09-10" },
      { data_inicio: "2026-09-26", data_fim: "2026-10-25", parcial: false, data_corte: null }
    ]);
  });
  await t.test("virada no próprio dia 26 não deixa a competência parcial", () => {
    const [c] = R.competenciasNecessarias([{ data_jornada: "2026-09-27" }], "2026-09-26");
    assert.equal(c.parcial, false);
  });
});

const oc = (id, extra) => ({
  id, re: 521, nome: "MARIA DA SILVA", data_jornada: "2026-09-24", tipo: "EARLY_ENTRY",
  horario_previsto: "18:00", horario_marcado: "17:54", diferenca_minutos: 6, reconciliacao: null, is_test: false, ...extra
});
const celular = { re: 521, telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true };
const contatos = new Map([["521", celular]]);

test("planejarMensagens", async t => {
  await t.test("uma ocorrência → uma mensagem aguardando validação", () => {
    const { inserir } = R.planejarMensagens([oc(1)], { contatosPorRE: contatos });
    assert.equal(inserir.length, 1);
    const m = inserir[0];
    assert.equal(m.status, "AGUARDANDO_VALIDACAO");
    assert.equal(m.template_id, "entrada_antecipada");
    assert.deepEqual(m.ocorrencia_ids, [1]);
    assert.equal(m.telefone_e164, "+5519998765432");
    assert.equal(m.motivo_bloqueio, null);
    assert.equal(m.texto_gerado, "SERVCAMP | ORIENTACAO DE PONTO\nOla, Maria. Em 24/09 sua entrada foi as 17:54, 6 min antes do previsto (18:00). Oriente-se a marcar no horario. RE 521.");
    assert.equal(m.segmentos, 1);
  });
  await t.test("entrada e saída no mesmo dia viram uma mensagem só", () => {
    const { inserir } = R.planejarMensagens([oc(1), oc(2, { tipo: "LATE_EXIT", horario_previsto: "06:00", horario_marcado: "06:40", diferenca_minutos: 40 })], { contatosPorRE: contatos });
    assert.equal(inserir.length, 1);
    assert.equal(inserir[0].template_id, "ambas_no_mesmo_dia");
    assert.deepEqual(inserir[0].ocorrencia_ids, [1, 2]);
    assert.match(inserir[0].texto_gerado, /entrada foi as 17:54 e a saida as 06:40, fora do previsto \(18:00 as 06:00\)/);
  });
  await t.test("dias diferentes são mensagens diferentes", () => {
    const { inserir } = R.planejarMensagens([oc(1), oc(2, { data_jornada: "2026-09-25" })], { contatosPorRE: contatos });
    assert.equal(inserir.length, 2);
  });
  await t.test("nome com acento sai sem acento e a mensagem continua em GSM-7", () => {
    const { inserir } = R.planejarMensagens([oc(1, { nome: "JOSÉ CONCEIÇÃO" })], { contatosPorRE: contatos });
    assert.match(inserir[0].texto_gerado, /Ola, Jose\./);
    assert.equal(R.analisarSMS(inserir[0].texto_gerado).codificacao, "GSM-7");
  });
  await t.test("pendente de reconciliação não gera mensagem", () => {
    const { inserir } = R.planejarMensagens([oc(1, { re: null, reconciliacao: "NOME_NAO_ENCONTRADO" })], { contatosPorRE: contatos });
    assert.equal(inserir.length, 0);
  });
  await t.test("motivo de bloqueio pelo telefone", () => {
    const motivo = c => R.planejarMensagens([oc(1)], { contatosPorRE: new Map(c ? [["521", c]] : []) }).inserir[0].motivo_bloqueio;
    assert.equal(motivo(null), "TELEFONE_AUSENTE");
    assert.equal(motivo({ ...celular, telefone_e164: null, tipo_telefone: "SEM_TELEFONE", enviavel: false }), "TELEFONE_AUSENTE");
    assert.equal(motivo({ ...celular, telefone_e164: "+551932345678", tipo_telefone: "FIXO", enviavel: false }), "TELEFONE_FIXO");
    assert.equal(motivo({ ...celular, tipo_telefone: "INVALIDO", enviavel: false }), "TELEFONE_INVALIDO");
    assert.equal(motivo(celular), null);
  });
  await t.test("mensagem aguardando validação ganha a segunda ocorrência do dia", () => {
    const ex = { id: 50, status: "AGUARDANDO_VALIDACAO", ocorrencia_ids: [1], texto_gerado: "x", telefone_e164: "+5519998765432", motivo_bloqueio: null };
    const { inserir, atualizar } = R.planejarMensagens(
      [oc(1), oc(2, { tipo: "LATE_EXIT", horario_previsto: "06:00", horario_marcado: "06:40", diferenca_minutos: 40 })],
      { contatosPorRE: contatos, existentes: new Map([["521|2026-09-24", ex]]) }
    );
    assert.equal(inserir.length, 0);
    assert.equal(atualizar[0].id, 50);
    assert.deepEqual(atualizar[0].patch.ocorrencia_ids, [1, 2]);
    assert.equal(atualizar[0].patch.template_id, "ambas_no_mesmo_dia");
  });
  await t.test("texto editado por uma pessoa não é sobrescrito", () => {
    const ex = { id: 50, status: "AGUARDANDO_VALIDACAO", ocorrencia_ids: [1], texto_gerado: "x", editado_em: "2026-09-24T12:00:00Z", telefone_e164: "+5519998765432", motivo_bloqueio: null };
    const { atualizar } = R.planejarMensagens([oc(1)], { contatosPorRE: contatos, existentes: new Map([["521|2026-09-24", ex]]) });
    assert.equal(atualizar.length, 0);
  });
  await t.test("mensagem aprovada, enviada ou rejeitada não é tocada", () => {
    for (const status of ["APROVADA", "ENVIADA", "REJEITADA"]) {
      const ex = { id: 50, status, ocorrencia_ids: [1], texto_gerado: "x", telefone_e164: null, motivo_bloqueio: "TELEFONE_AUSENTE" };
      const r = R.planejarMensagens([oc(1), oc(2, { tipo: "LATE_EXIT", horario_previsto: "06:00", horario_marcado: "06:40", diferenca_minutos: 40 })], { contatosPorRE: contatos, existentes: new Map([["521|2026-09-24", ex]]) });
      assert.equal(r.inserir.length + r.atualizar.length, 0, status);
    }
  });
  await t.test("telefone carregado depois desbloqueia a mensagem na fila", () => {
    const ex = { id: 50, status: "AGUARDANDO_VALIDACAO", ocorrencia_ids: [1], texto_gerado: null, telefone_e164: null, motivo_bloqueio: "TELEFONE_AUSENTE" };
    ex.texto_gerado = R.planejarMensagens([oc(1)], { contatosPorRE: contatos }).inserir[0].texto_gerado;
    const { atualizar } = R.planejarMensagens([oc(1)], { contatosPorRE: contatos, existentes: new Map([["521|2026-09-24", ex]]) });
    assert.deepEqual(atualizar[0].patch, { telefone_e164: "+5519998765432", motivo_bloqueio: null });
  });
});

test("modelos de mensagem", async t => {
  const vars = { nome: "Maria", data: "24/09", horario_marcado: "17:54", horario_previsto: "18:00", minutos: 6, re: 521, entrada_marcada: "07:40", saida_marcada: "17:30", entrada_prevista: "08:00", saida_prevista: "17:00" };
  await t.test("nenhum menciona custo, hora extra, pagamento ou desconto", () => {
    for (const txt of Object.values(R.MODELOS_PADRAO)) assert.doesNotMatch(txt.toLowerCase(), /hora extra|horas extras|custo|pagamento|pagar|desconto|descontar/);
  });
  await t.test("todos sem acento (GSM-7)", () => {
    for (const txt of Object.values(R.MODELOS_PADRAO)) assert.equal(R.analisarSMS(R.renderizar(txt, vars)).codificacao, "GSM-7");
  });
  await t.test("entrada antecipada e saída após o horário cabem em 1 SMS", () => {
    assert.equal(R.segmentosSMS(R.renderizar(R.MODELOS_PADRAO.entrada_antecipada, vars)), 1);
    assert.equal(R.segmentosSMS(R.renderizar(R.MODELOS_PADRAO.saida_apos_horario, vars)), 1);
  });
  await t.test("ambas no mesmo dia cabe em 1 SMS", { todo: "o texto do plano rende 171 caracteres (2 SMS) mesmo com nome curto — aguardando decisão sobre o texto" }, () => {
    assert.equal(R.segmentosSMS(R.renderizar(R.MODELOS_PADRAO.ambas_no_mesmo_dia, vars)), 1);
  });
});

test("lerConfig", () => {
  const cfg = R.lerConfig([{ chave: "tolerancia_minutos", valor: "7" }, { chave: "data_virada", valor: null }, { chave: "sms_limite_dia", valor: "50" }, { chave: "modelo_entrada_antecipada", valor: "Ola {{nome}}" }]);
  assert.equal(cfg.tolerancia_minutos, 7);
  assert.equal(cfg.data_virada, null);
  assert.equal(cfg.sms_limite_dia, 50);
  assert.equal(cfg.sms_limite_mes, 300);
  assert.equal(cfg.modelos.entrada_antecipada, "Ola {{nome}}");
  assert.equal(R.lerConfig([]).tolerancia_minutos, 5);
});
