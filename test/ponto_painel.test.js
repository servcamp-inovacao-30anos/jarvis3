// Rotas do painel e da validação humana (Etapa 5), contra um Supabase falso.

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const R = require("../api/_ponto_regras");

ponto.APROVADORES.add("aprovador");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const mesAnterior = (() => { const [y, m] = hoje.split("-").map(Number); return m === 1 ? `${y - 1}-12-15` : `${y}-${String(m - 1).padStart(2, "0")}-15`; })();
const TEXTO_MARIA = "SERVCAMP | ORIENTACAO DE PONTO\nOla, Maria. Em 20/09 sua entrada foi as 17:45, 15 min antes do previsto (18:00). Oriente-se a marcar no horario. RE 521.";

const oc = (id, extra) => ({
  id, re: 521, nome: "MARIA DA SILVA", data_jornada: "2026-09-10", tipo: "EARLY_ENTRY", horario_previsto: "18:00", horario_marcado: "17:40",
  diferenca_minutos: 20, posto: "POSTO A", cliente: "CLIENTE A", supervisor: "FRANK", status: "DETECTADA", reconciliacao: null, is_test: false, competencia_id: 1, ...extra
});
const msg = (id, extra) => ({
  id, re: 521, data_jornada: "2026-09-20", ocorrencia_ids: [4], telefone_e164: "+5519998765432", template_id: "entrada_antecipada",
  texto_gerado: TEXTO_MARIA, texto_final: null, segmentos: 1, status: "AGUARDANDO_VALIDACAO", motivo_bloqueio: null, is_test: false, ...extra
});

function base() {
  return {
    pt_config: [
      { chave: "tolerancia_minutos", valor: "5" }, { chave: "data_virada", valor: "2026-09-01" },
      { chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" },
      { chave: "alerta_pct", valor: "80" }, { chave: "critico_pct", valor: "90" }
    ],
    pt_competencias: [{ id: 1, data_inicio: "2026-08-26", data_fim: "2026-09-25", parcial: true, data_corte: "2026-09-01", status: "ABERTA" }],
    pt_ocorrencias: [
      oc(1),
      oc(2, { tipo: "LATE_EXIT", horario_previsto: "06:00", horario_marcado: "06:30", diferenca_minutos: 30 }),
      oc(3, { re: 522, nome: "JOAO SOUZA", data_jornada: "2026-09-12", tipo: "LATE_EXIT", horario_previsto: "17:00", horario_marcado: "17:45", diferenca_minutos: 45 }),
      oc(4, { data_jornada: "2026-09-20", horario_marcado: "17:45", diferenca_minutos: 15 }),
      oc(5, { re: null, nome: "ANA LIMA", data_jornada: "2026-09-15", diferenca_minutos: 10, reconciliacao: "NOME_AMBIGUO" }),
      oc(6, { re: null, nome: "FULANO DE TAL", data_jornada: "2026-09-16", diferenca_minutos: 8, reconciliacao: "NOME_NAO_ENCONTRADO" }),
      oc(7, { data_jornada: "2026-09-21", diferenca_minutos: 99, is_test: true })
    ],
    pt_mensagens: [
      msg(10, { data_jornada: "2026-09-10", ocorrencia_ids: [1, 2], template_id: "ambas_no_mesmo_dia", status: "ENVIADA", enviado_em: "2026-09-11T10:00:00Z" }),
      msg(11, { re: 522, data_jornada: "2026-09-12", ocorrencia_ids: [3], telefone_e164: null, motivo_bloqueio: "TELEFONE_AUSENTE" }),
      msg(12)
    ],
    pt_contatos: [{ re: 521, telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true }],
    pt_sms_uso: [{ id: 1, dia: hoje, mes_referencia: hoje.slice(0, 7), segmentos_dia: 42 }, { id: 2, dia: mesAnterior, mes_referencia: mesAnterior.slice(0, 7), segmentos_dia: 999 }],
    dashboard_snapshots: [{
      id: 1, created_at: "2026-09-22T10:00:00Z",
      data: { ativos: [
        { RE: 521, NOME: "MARIA DA SILVA", AREA: "FRANK", LOCAL: "POSTO NOVO", CARGO: "PORTEIRO (A)" },
        { RE: 530, NOME: "ANA LIMA", AREA: "SUP X", LOCAL: "P1" },
        { RE: 531, NOME: "ANA LIMA", AREA: "SUP Y", LOCAL: "P2" }
      ] }
    }]
  };
}

const get = (t, query, usuario) => chamar(ponto, { query: { t, ...query }, usuario });
const post = (t, body, usuario, method) => chamar(ponto, { method: method || "POST", query: { t }, body, usuario });

test("GET competencia: indicadores da competência, sem os testes", async () => {
  supabaseFalso(base());
  const r = await get("competencia", { data: "2026-09-15" }, "outra.pessoa");
  assert.equal(r.statusCode, 200);
  const s = r.body.resumo;
  assert.equal(s.ocorrencias, 6, "o registro de teste não conta");
  assert.deepEqual(s.entradas_antecipadas, { qtd: 4, minutos: 53 });
  assert.deepEqual(s.saidas_apos_horario, { qtd: 2, minutos: 75 });
  assert.equal(s.minutos_excedentes, 128);
  assert.equal(s.pendentes_reconciliacao, 2);
  assert.deepEqual(s.mensagens, { aguardando: 2, bloqueadas: 1, aprovadas: 0, enviadas: 1, falhas: 0, rejeitadas: 0 });
  assert.equal(s.colaboradores_sem_telefone, 1);
  assert.deepEqual(r.body.competencia.inicio + " a " + r.body.competencia.fim, "2026-08-26 a 2026-09-25");
  assert.equal(r.body.competencia.parcial, true);
  assert.equal(r.body.competencia.data_corte, "2026-09-01");
  assert.equal(r.body.modulo.ativo, true);
  assert.equal(r.body.pode_aprovar, false);
  assert.equal((await get("competencia", { data: "2026-09-15" }, "aprovador")).body.pode_aprovar, true);
});

test("GET fila", async t => {
  supabaseFalso(base());
  await t.test("por padrão traz o que aguarda, o aprovado e o que falhou — mais recente primeiro", async () => {
    const r = await get("fila", {}, "outra.pessoa");
    assert.deepEqual(r.body.linhas.map(l => l.id), [12, 11]);
    const l = r.body.linhas[0];
    assert.equal(l.nome, "MARIA DA SILVA");
    assert.equal(l.posto, "POSTO A");
    assert.deepEqual(l.itens, [{ id: 4, tipo: "EARLY_ENTRY", previsto: "18:00", marcado: "17:45", minutos: 15 }]);
    assert.equal(l.segmentos, 1);
    assert.equal(l.codificacao, "GSM-7");
  });
  await t.test("quem não aprova vê o telefone mascarado; o aprovador vê inteiro", async () => {
    assert.equal((await get("fila", {}, "outra.pessoa")).body.linhas[0].telefone, "+55 19 ****-5432");
    assert.equal((await get("fila", {}, "aprovador")).body.linhas[0].telefone, "+5519998765432");
  });
  await t.test("filtro por status", async () => {
    const r = await get("fila", { status: "ENVIADA" }, "aprovador");
    assert.deepEqual(r.body.linhas.map(l => l.id), [10]);
    assert.deepEqual(r.body.linhas[0].itens.map(i => i.tipo), ["EARLY_ENTRY", "LATE_EXIT"]);
  });
});

test("GET ocorrencias com filtros", async () => {
  supabaseFalso(base());
  const r = await get("ocorrencias", { competencia: "2026-09-15", re: "0521" });
  assert.deepEqual(r.body.linhas.map(l => l.id).sort(), [1, 2, 4]);
});

test("GET ficha", async t => {
  supabaseFalso(base());
  await t.test("cabeçalho do sistema, histórico sem testes e reincidência depois da orientação", async () => {
    const r = await get("ficha", { re: "521", competencia: "2026-09-15" }, "outra.pessoa");
    assert.equal(r.statusCode, 200);
    const f = r.body.ficha;
    assert.equal(f.nome, "MARIA DA SILVA");
    assert.equal(f.posto_atual, "POSTO NOVO", "posto atual vem do quadro ativo, não da ocorrência antiga");
    assert.equal(f.no_quadro_ativo, true);
    assert.equal(f.telefone, "+55 19 ****-5432");
    assert.deepEqual(f.historico.map(h => h.id), [4, 2, 1]);
    assert.equal(f.historico[0].apos_orientacao, true);
    assert.equal(f.historico[1].apos_orientacao, false);
    assert.equal(f.reincidente, true);
    assert.equal(f.competencia.dias_com_ocorrencia, 2);
    assert.deepEqual(f.acoes.map(a => a.id), [12, 10]);
  });
  await t.test("RE inválido", async () => {
    assert.equal((await get("ficha", { re: "abc" })).statusCode, 400);
  });
});

test("GET reconciliacao", async () => {
  supabaseFalso(base());
  const r = await get("reconciliacao", {});
  assert.equal(r.body.total_ocorrencias, 2);
  const [amb, sem] = [r.body.grupos.find(g => g.motivo === "NOME_AMBIGUO"), r.body.grupos.find(g => g.motivo === "NOME_NAO_ENCONTRADO")];
  assert.equal(amb.nome, "ANA LIMA");
  assert.deepEqual(amb.candidatos.map(c => c.re), [530, 531]);
  assert.equal(sem.nome, "FULANO DE TAL");
  assert.deepEqual(sem.candidatos, []);
});

test("GET quota conta segmentos do dia e do mês do calendário", async () => {
  supabaseFalso(base());
  const r = await get("quota", {});
  assert.deepEqual(r.body.cota.hoje, { usado: 42, limite: 50, disponivel: 8, estado: "ATENCAO" });
  assert.deepEqual(r.body.cota.mes, { usado: 42, limite: 300, disponivel: 258, estado: "NORMAL" });
  assert.equal(r.body.cota.disponivel, 8);
});

test("POST aprovar", async t => {
  await t.test("só o que pode: com telefone, aguardando validação", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await post("aprovar", { ids: [11, 12, 10, 999] }, "aprovador");
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.aprovadas, [12]);
    assert.deepEqual(r.body.recusadas, [{ id: 11, motivo: "TELEFONE_AUSENTE" }, { id: 10, motivo: "JA_ENVIADA" }, { id: 999, motivo: "NAO_ENCONTRADA" }]);
    const m = tabelas.pt_mensagens.find(x => x.id === 12);
    assert.equal(m.status, "APROVADA");
    assert.equal(m.aprovado_por, "aprovador");
    assert.ok(m.aprovado_em);
    assert.equal(tabelas.pt_auditoria.filter(a => a.acao === "MENSAGEM_APROVADA").length, 1);
  });
  await t.test("quem não é aprovador é recusado no servidor", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    assert.equal((await post("aprovar", { ids: [12] }, "outra.pessoa")).statusCode, 403);
    assert.equal(tabelas.pt_mensagens.find(x => x.id === 12).status, "AGUARDANDO_VALIDACAO");
  });
  await t.test("sem seleção", async () => {
    supabaseFalso(base());
    assert.equal((await post("aprovar", { ids: [] }, "aprovador")).body.codigo, "SEM_SELECAO");
  });
});

test("POST rejeitar", async t => {
  await t.test("exige motivo", async () => {
    supabaseFalso(base());
    assert.equal((await post("rejeitar", { ids: [11] }, "aprovador")).body.codigo, "SEM_MOTIVO");
  });
  await t.test("rejeita o que ainda não foi enviado e guarda quem e por quê", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await post("rejeitar", { ids: [11, 10], motivo: "Escala trocada no dia" }, "aprovador");
    assert.deepEqual(r.body.rejeitadas, [11]);
    assert.deepEqual(r.body.recusadas, [{ id: 10, motivo: "JA_ENVIADA" }]);
    const m = tabelas.pt_mensagens.find(x => x.id === 11);
    assert.deepEqual([m.status, m.rejeitado_por, m.motivo_rejeicao], ["REJEITADA", "aprovador", "Escala trocada no dia"]);
    assert.equal(tabelas.pt_auditoria[0].acao, "MENSAGEM_REJEITADA");
  });
});

test("PATCH mensagem", async t => {
  await t.test("texto não pode falar de hora extra, custo, pagamento ou desconto", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await post("mensagem", { id: 12, texto_final: "Ola, Maria. Evite hora extra." }, "aprovador", "PATCH");
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.codigo, "TERMO_PROIBIDO");
    assert.equal(tabelas.pt_mensagens.find(x => x.id === 12).texto_final, null);
  });
  await t.test("edição válida recalcula os segmentos e registra quem editou", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await post("mensagem", { id: 12, texto_final: "Olá, Maria. Marque o ponto no horário, por favor." }, "aprovador", "PATCH");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.codificacao, "UCS-2", "o acento é aceito, mas o contador avisa que o limite caiu para 70");
    const m = tabelas.pt_mensagens.find(x => x.id === 12);
    assert.equal(m.texto_final, "Olá, Maria. Marque o ponto no horário, por favor.");
    assert.equal(m.editado_por, "aprovador");
    assert.equal(tabelas.pt_auditoria[0].acao, "MENSAGEM_EDITADA");
    assert.equal(tabelas.pt_auditoria[0].antes.texto, TEXTO_MARIA);
  });
  await t.test("texto nulo volta ao texto gerado", async () => {
    const tabelas = base();
    tabelas.pt_mensagens.find(x => x.id === 12).texto_final = "editado";
    supabaseFalso(tabelas);
    const r = await post("mensagem", { id: 12, texto_final: null }, "aprovador", "PATCH");
    assert.equal(r.statusCode, 200);
    const m = tabelas.pt_mensagens.find(x => x.id === 12);
    assert.equal(m.texto_final, null);
    assert.equal(m.editado_em, null);
  });
  await t.test("mensagem já enviada não se edita", async () => {
    supabaseFalso(base());
    const r = await post("mensagem", { id: 10, texto_final: "novo" }, "aprovador", "PATCH");
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.codigo, "JA_ENVIADA");
  });
});

test("funções de apoio", async t => {
  await t.test("mascararTelefone", () => {
    assert.equal(R.mascararTelefone("+5519998765432"), "+55 19 ****-5432");
    assert.equal(R.mascararTelefone(null), null);
  });
  await t.test("validarTextoMensagem reconhece termo proibido com acento e maiúscula", () => {
    assert.equal(R.validarTextoMensagem("Seu Pagamento").erro, "TERMO_PROIBIDO");
    assert.equal(R.validarTextoMensagem("sem DESCONTO").erro, "TERMO_PROIBIDO");
    assert.equal(R.validarTextoMensagem("HORAS EXTRAS").erro, "TERMO_PROIBIDO");
    assert.equal(R.validarTextoMensagem("   ").erro, "TEXTO_VAZIO");
    assert.equal(R.validarTextoMensagem("Marque no horario").segmentos, 1);
  });
  await t.test("estados da cota", () => {
    const cfg = { sms_limite_dia: 50, sms_limite_mes: 300, alerta_pct: 80, critico_pct: 90 };
    const estado = usado => R.resumoCota([{ dia: "2026-09-23", segmentos_dia: usado }], "2026-09-23", cfg).hoje.estado;
    assert.equal(estado(39), "NORMAL");
    assert.equal(estado(40), "ATENCAO");
    assert.equal(estado(45), "PROXIMO_DO_LIMITE");
    assert.equal(estado(50), "LIMITE_ATINGIDO");
  });
});
