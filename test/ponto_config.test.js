// Modelos de mensagem e configuração do módulo (Etapa 6).

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const R = require("../api/_ponto_regras");
const ponto = require("../api/_ponto");
const { supabaseFalso, chamar } = require("./_supabase_falso");

ponto.APROVADORES.add("aprovador");
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const amanha = new Date(Date.now() - 3 * 3600000 + 86400000).toISOString().slice(0, 10);

test("validarModelo", async t => {
  await t.test("os modelos de entrada e de saída do plano passam", () => {
    assert.equal(R.validarModelo("entrada_antecipada", R.MODELOS_PADRAO.entrada_antecipada).erro, undefined);
    assert.equal(R.validarModelo("saida_apos_horario", R.MODELOS_PADRAO.saida_apos_horario).erro, undefined);
  });
  await t.test("o modelo 'ambas no mesmo dia' do plano passa de 160 caracteres", () => {
    const v = R.validarModelo("ambas_no_mesmo_dia", R.MODELOS_PADRAO.ambas_no_mesmo_dia);
    assert.equal(v.erro, "ACIMA_DE_160");
    assert.ok(v.caracteres > 160);
  });
  await t.test("variável que o sistema não sabe preencher", () => {
    const v = R.validarModelo("entrada_antecipada", "Ola {{nome}}, seu CPF {{cpf}}.");
    assert.equal(v.erro, "VARIAVEL_DESCONHECIDA");
    assert.deepEqual(v.variaveis, ["cpf"]);
  });
  await t.test("variável de outro modelo também é desconhecida", () => {
    assert.equal(R.validarModelo("entrada_antecipada", "Ola {{nome}}, saida {{saida_marcada}}.").erro, "VARIAVEL_DESCONHECIDA");
  });
  await t.test("chave incompleta", () => {
    assert.equal(R.validarModelo("entrada_antecipada", "Ola {{nome, marque no horario.").erro, "CHAVES_SOLTAS");
  });
  await t.test("acento", () => {
    assert.equal(R.validarModelo("entrada_antecipada", "Olá {{nome}}, marque no horário.").erro, "COM_ACENTO");
  });
  await t.test("termo proibido", () => {
    assert.equal(R.validarModelo("entrada_antecipada", "Ola {{nome}}, isso gera hora extra.").erro, "TERMO_PROIBIDO");
  });
  await t.test("vazio e modelo desconhecido", () => {
    assert.equal(R.validarModelo("entrada_antecipada", "  ").erro, "TEXTO_VAZIO");
    assert.equal(R.validarModelo("outro", "Ola").erro, "MODELO_DESCONHECIDO");
  });
});

test("validarConfig", async t => {
  const atual = R.lerConfig([]);
  const ctx = { hoje, haOcorrencias: false };
  await t.test("só vai para o patch o que mudou", () => {
    assert.deepEqual(R.validarConfig({ tolerancia_minutos: 7, sms_limite_dia: 50 }, atual, ctx), { patch: { tolerancia_minutos: 7 } });
  });
  await t.test("fora do intervalo", () => {
    assert.equal(R.validarConfig({ tolerancia_minutos: -1 }, atual, ctx).erro, "VALOR_INVALIDO");
    assert.equal(R.validarConfig({ tolerancia_minutos: 2.5 }, atual, ctx).erro, "VALOR_INVALIDO");
  });
  await t.test("alerta precisa ficar abaixo do crítico, e o dia abaixo do mês", () => {
    assert.equal(R.validarConfig({ alerta_pct: 90 }, atual, ctx).erro, "ALERTA_ACIMA_DO_CRITICO");
    assert.equal(R.validarConfig({ sms_limite_dia: 400 }, atual, ctx).erro, "LIMITE_DIA_ACIMA_DO_MES");
  });
  await t.test("data de virada no passado criaria ocorrências retroativas", () => {
    assert.equal(R.validarConfig({ data_virada: "2020-01-01" }, atual, ctx).erro, "VIRADA_NO_PASSADO");
  });
  await t.test("data de virada hoje ou no futuro liga o módulo", () => {
    assert.deepEqual(R.validarConfig({ data_virada: hoje }, atual, ctx), { patch: { data_virada: hoje } });
    assert.deepEqual(R.validarConfig({ data_virada: amanha }, atual, ctx), { patch: { data_virada: amanha } });
  });
  await t.test("com ocorrências já registradas, a virada não muda mais", () => {
    const ligado = { ...atual, data_virada: hoje };
    assert.equal(R.validarConfig({ data_virada: amanha }, ligado, { hoje, haOcorrencias: true }).erro, "VIRADA_JA_EM_USO");
  });
  await t.test("data inválida", () => {
    assert.equal(R.validarConfig({ data_virada: "31/12/2030" }, atual, ctx).erro, "DATA_INVALIDA");
  });
});

const base = () => ({
  pt_config: [{ chave: "tolerancia_minutos", valor: "5" }, { chave: "data_virada", valor: null }, { chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" }, { chave: "alerta_pct", valor: "80" }, { chave: "critico_pct", valor: "90" }],
  pt_ocorrencias: []
});

test("GET config", async () => {
  supabaseFalso(base());
  const r = await chamar(ponto, { query: { t: "config" }, usuario: "outra.pessoa" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.config.tolerancia_minutos, 5);
  assert.equal(r.body.pode_aprovar, false);
  assert.equal(r.body.virada_travada, false);
  const ambas = r.body.modelos.find(m => m.id === "ambas_no_mesmo_dia");
  assert.equal(ambas.problema, "ACIMA_DE_160");
  assert.equal(r.body.modelos.find(m => m.id === "entrada_antecipada").problema, null);
});

test("PATCH config", async t => {
  await t.test("só aprovador", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await chamar(ponto, { method: "PATCH", query: { t: "config" }, usuario: "outra.pessoa", body: { tolerancia_minutos: 7 } });
    assert.equal(r.statusCode, 403);
    assert.equal(tabelas.pt_config.find(c => c.chave === "tolerancia_minutos").valor, "5");
  });
  await t.test("grava configuração e modelo, com auditoria de antes e depois", async () => {
    const tabelas = base();
    const log = supabaseFalso(tabelas);
    const novo = "SERVCAMP | PONTO\nOla, {{nome}}. Em {{data}} voce entrou as {{horario_marcado}}, {{minutos}} min antes. Marque no horario. RE {{re}}.";
    const r = await chamar(ponto, { method: "PATCH", query: { t: "config" }, usuario: "aprovador", body: { tolerancia_minutos: 7, data_virada: amanha, modelos: { entrada_antecipada: novo } } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.alterado, 3);
    assert.equal(tabelas.pt_config.find(c => c.chave === "tolerancia_minutos").valor, "7");
    assert.equal(tabelas.pt_config.find(c => c.chave === "data_virada").valor, amanha);
    assert.equal(tabelas.pt_config.find(c => c.chave === "modelo_entrada_antecipada").valor, novo);
    const acoes = tabelas.pt_auditoria.map(a => a.acao).sort();
    assert.deepEqual(acoes, ["CONFIGURACAO_ALTERADA", "CONFIGURACAO_ALTERADA", "MODELO_ALTERADO"]);
    const escritas = log.filter(c => c.metodo === "POST").map(c => c.tabela);
    assert.deepEqual(escritas, ["pt_auditoria", "pt_config"], "auditoria antes da alteração");
  });
  await t.test("um modelo inválido barra a requisição inteira", async () => {
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await chamar(ponto, { method: "PATCH", query: { t: "config" }, usuario: "aprovador", body: { tolerancia_minutos: 7, modelos: { entrada_antecipada: "Ola {{nome}}, CPF {{cpf}}" } } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.codigo, "VARIAVEL_DESCONHECIDA");
    assert.match(r.body.error, /\{\{cpf\}\}/);
    assert.equal(tabelas.pt_config.find(c => c.chave === "tolerancia_minutos").valor, "5", "nada foi gravado");
    assert.equal((tabelas.pt_auditoria || []).length, 0);
  });
  await t.test("virada travada depois que há ocorrências", async () => {
    const tabelas = base();
    tabelas.pt_config.find(c => c.chave === "data_virada").valor = hoje;
    tabelas.pt_ocorrencias.push({ id: 1, is_test: false });
    supabaseFalso(tabelas);
    const r = await chamar(ponto, { method: "PATCH", query: { t: "config" }, usuario: "aprovador", body: { data_virada: amanha } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.codigo, "VIRADA_JA_EM_USO");
  });
  await t.test("modelo salvo passa a valer na geração das mensagens", () => {
    const novo = "SERVCAMP | PONTO\nOla, {{nome}}. Entrada as {{horario_marcado}} em {{data}}, {{minutos}} min antes. RE {{re}}.";
    const cfg = R.lerConfig([{ chave: "modelo_entrada_antecipada", valor: novo }]);
    const { inserir } = R.planejarMensagens(
      [{ id: 1, re: 521, nome: "MARIA DA SILVA", data_jornada: "2026-09-24", tipo: "EARLY_ENTRY", horario_previsto: "18:00", horario_marcado: "17:54", diferenca_minutos: 6, reconciliacao: null, is_test: false }],
      { contatosPorRE: new Map(), modelos: cfg.modelos }
    );
    assert.equal(inserir[0].texto_gerado, "SERVCAMP | PONTO\nOla, Maria. Entrada as 17:54 em 24/09, 6 min antes. RE 521.");
  });
});

test("as sementes do SQL são exatamente os modelos padrão do código", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase_schema.sql"), "utf8");
  for (const id of Object.keys(R.MODELOS_PADRAO)) {
    const m = sql.match(new RegExp(`\\('modelo_${id}',\\s*E'((?:[^'\\\\]|\\\\.|'')*)'\\)`));
    assert.ok(m, `semente do modelo ${id} não encontrada`);
    const texto = m[1].replace(/\\n/g, "\n").replace(/''/g, "'");
    assert.equal(texto, R.MODELOS_PADRAO[id], id);
  }
});

test("a amostra dos modelos na tela é a mesma do servidor", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/const PT_AMOSTRA=(\{[^}]*\});/);
  assert.ok(m, "PT_AMOSTRA não encontrado no index.html");
  assert.deepEqual({ ...vm.runInNewContext("(" + m[1] + ")") }, R.AMOSTRA_MODELO);
});
