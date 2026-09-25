// Materialização das ocorrências na importação (Etapa 4), contra um Supabase
// falso em memória.

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const importar = require("../api/import");

ponto.APROVADORES.add("aprovador");

const config = virada => [
  { chave: "tolerancia_minutos", valor: "5" }, { chave: "data_virada", valor: virada },
  { chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" }
];

const linha = extra => ({
  NOME: "MARIA DA SILVA", DATA: "2026-09-24", TIPO: "EXTRA ENTRADA",
  HRENTRADA: "18:00", HRMRENTRADA: "17:54", HRSAIDA: "06:00", HRMRSAIDA: "06:00",
  LOCAL: "POSTO A", CLIENTE: "CLIENTE A", AREA: "FRANK", MINUTOS: 360, RE: "", ...extra
});

const planilha = extraLinhas => ({
  ativos: [{ RE: 521, NOME: "MARIA DA SILVA", AREA: "FRANK" }, { RE: 522, NOME: "JOAO SOUZA", AREA: "FRANK" }],
  clientes: [],
  hrextra: [
    linha(),
    linha({ DATA: "2026-09-25", TIPO: "EXTRA SAIDA", HRENTRADA: "08:00", HRMRENTRADA: "08:00", HRSAIDA: "17:00", HRMRSAIDA: "17:40" }),
    linha({ NOME: "JOAO SOUZA", HRMRENTRADA: "17:57" }),
    linha({ NOME: "FULANO SEM CADASTRO" }),
    linha({ DATA: "2026-08-30" }),
    linha({ TIPO: "FT" }),
    ...(extraLinhas || [])
  ]
});

const contatos = () => [{ re: 521, telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true }];
const contar = (tabelas, acao) => (tabelas.pt_auditoria || []).filter(a => a.acao === acao).length;

test("sem data de virada, nada é criado", async () => {
  const tabelas = { pt_config: config(null), pt_contatos: contatos() };
  supabaseFalso(tabelas);
  const r = await ponto.materializar(planilha());
  assert.equal(r.ativo, false);
  assert.equal((tabelas.pt_ocorrencias || []).length, 0);
  assert.equal((tabelas.pt_mensagens || []).length, 0);
  assert.equal((tabelas.pt_auditoria || []).length, 0);
});

test("materialização e reimportação", async t => {
  const tabelas = { pt_config: config("2026-09-01"), pt_contatos: contatos() };
  supabaseFalso(tabelas);

  await t.test("primeira importação grava ocorrências, competência e mensagens", async () => {
    const r = await ponto.materializar(planilha(), { ator: "raphaelvictor" });
    assert.equal(r.ocorrencias_novas, 3, "Maria 24/09, Maria 25/09 e o nome sem cadastro");
    assert.equal(r.stats.dentro_tolerancia, 1);
    assert.equal(r.stats.antes_da_virada, 1);
    assert.equal(tabelas.pt_ocorrencias.length, 3);
    const pendente = tabelas.pt_ocorrencias.find(o => o.reconciliacao);
    assert.equal(pendente.reconciliacao, "NOME_NAO_ENCONTRADO");

    assert.equal(tabelas.pt_competencias.length, 1);
    const comp = tabelas.pt_competencias[0];
    assert.deepEqual([comp.data_inicio, comp.data_fim, comp.parcial, comp.data_corte], ["2026-08-26", "2026-09-25", true, "2026-09-01"]);
    assert.ok(tabelas.pt_ocorrencias.every(o => o.competencia_id === comp.id));

    assert.equal(tabelas.pt_mensagens.length, 2, "uma por dia da Maria; o pendente de reconciliação não gera");
    assert.ok(tabelas.pt_mensagens.every(m => m.status === "AGUARDANDO_VALIDACAO" && m.re === 521 && m.motivo_bloqueio === null));
    assert.equal(contar(tabelas, "OCORRENCIA_CRIADA"), 3);
    assert.equal(contar(tabelas, "IMPORTACAO_PROCESSADA"), 1);
    assert.equal(tabelas.pt_auditoria[0].ator, "raphaelvictor");
  });

  await t.test("reimportar a mesma planilha não cria linha nem mensagem nova", async () => {
    const r = await ponto.materializar(planilha());
    assert.equal(r.ocorrencias_novas, 0);
    assert.equal(r.mensagens_novas, 0);
    assert.equal(r.mensagens_atualizadas, 0);
    assert.equal(tabelas.pt_ocorrencias.length, 3);
    assert.equal(tabelas.pt_mensagens.length, 2);
    assert.equal(contar(tabelas, "OCORRENCIA_CRIADA"), 3);
  });

  await t.test("segunda ocorrência do mesmo dia entra na mensagem que ainda aguarda validação", async () => {
    const saida = linha({ TIPO: "EXTRA SAIDA", HRENTRADA: "18:00", HRMRENTRADA: "18:00", HRSAIDA: "06:00", HRMRSAIDA: "06:45" });
    const r = await ponto.materializar(planilha([saida]));
    assert.equal(r.ocorrencias_novas, 1);
    assert.equal(r.mensagens_novas, 0);
    assert.equal(r.mensagens_atualizadas, 1);
    const m = tabelas.pt_mensagens.find(x => x.data_jornada === "2026-09-24");
    assert.equal(m.template_id, "ambas_no_mesmo_dia");
    assert.equal(m.ocorrencia_ids.length, 2);
  });

  await t.test("mensagem já enviada não é mexida por ocorrência que chega depois", async () => {
    const m = tabelas.pt_mensagens.find(x => x.data_jornada === "2026-09-25");
    m.status = "ENVIADA";
    const antes = JSON.stringify(m);
    const outra = linha({ DATA: "2026-09-25", HRENTRADA: "08:00", HRMRENTRADA: "07:30", HRSAIDA: "17:00", HRMRSAIDA: "17:00" });
    const r = await ponto.materializar(planilha([outra]));
    assert.equal(r.ocorrencias_novas, 1, "a ocorrência fica registrada no histórico");
    assert.equal(JSON.stringify(tabelas.pt_mensagens.find(x => x.data_jornada === "2026-09-25")), antes);
  });
});

test("importar pelo api/import.js materializa junto", async () => {
  const tabelas = { pt_config: config("2026-09-01"), pt_contatos: contatos() };
  supabaseFalso(tabelas);
  const r = await chamar(importar, { method: "POST", headers: { "content-type": "application/json" }, body: { data: planilha(), source_filename: "Base dados.xlsx" } });
  assert.equal(r.statusCode, 200);
  assert.equal(tabelas.dashboard_snapshots.length, 1);
  assert.equal(tabelas.pt_ocorrencias.length, 3);
  assert.equal(tabelas.pt_mensagens.length, 2);
});

test("falha no módulo de ponto não derruba a importação da planilha", async () => {
  const tabelas = { pt_config: config("2026-09-01") };
  supabaseFalso(tabelas, { falhar: (metodo, caminho) => caminho.startsWith("pt_") });
  const r = await chamar(importar, { method: "POST", headers: { "content-type": "application/json" }, body: { data: planilha() } });
  assert.equal(r.statusCode, 200);
  assert.equal(tabelas.dashboard_snapshots.length, 1, "o snapshot foi salvo");
});

test("reprocessar a última planilha (rota processar)", async t => {
  const tabelas = { pt_config: config("2026-09-01"), pt_contatos: contatos(), dashboard_snapshots: [{ id: 1, created_at: "2026-09-25T10:00:00Z", data: planilha() }] };
  supabaseFalso(tabelas);
  await t.test("só aprovador", async () => {
    const r = await chamar(ponto, { method: "POST", query: { t: "processar" }, usuario: "outra.pessoa" });
    assert.equal(r.statusCode, 403);
  });
  await t.test("aprovador reprocessa", async () => {
    const r = await chamar(ponto, { method: "POST", query: { t: "processar" }, usuario: "aprovador" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ocorrencias_novas, 3);
    assert.equal(tabelas.pt_mensagens.length, 2);
  });
});
