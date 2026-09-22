// Testes do backend do monitoramento de ponto (api/_ponto.js) contra um
// Supabase falso em memória: nada sai da máquina.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const _auth = require("../api/_auth");
const ponto = require("../api/_ponto");
const rh = require("../api/rh");

const { supabaseFalso, chamar } = require("./_supabase_falso");

ponto.APROVADORES.add("aprovador");

const contato = (re, tel, extra) => ({
  re, nome_cadastro: "PESSOA " + re, nome_norm: "PESSOA " + re, telefone_original: tel, telefone_e164: tel,
  tipo_telefone: tel ? "CELULAR" : "SEM_TELEFONE", enviavel: tel ? "true" : "false", origem: "CADASTRO", data_base: "2026-09-01", ...extra
});

test("rota desconhecida", async () => {
  supabaseFalso({});
  const r = await chamar(ponto, { query: { t: "nada" } });
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.codigo, "ROTA_DESCONHECIDA");
});

test("base de contatos exige aprovador verificado no servidor", async t => {
  const log = supabaseFalso({});
  await t.test("sem token", async () => {
    const r = await chamar(ponto, { method: "POST", query: { t: "contatos" }, body: { linhas: [contato(1, "+5519998765432")] } });
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.codigo, "NAO_AUTORIZADO");
  });
  await t.test("token de quem não é aprovador", async () => {
    const r = await chamar(ponto, { method: "POST", query: { t: "contatos" }, usuario: "outra.pessoa", body: { linhas: [contato(1, "+5519998765432")] } });
    assert.equal(r.statusCode, 403);
  });
  await t.test("token forjado com outro segredo", async () => {
    const falso = _auth.sign("aprovador", "outro-segredo", 1);
    const req = { method: "GET", query: { t: "contatos" }, headers: { authorization: "Bearer " + falso } };
    const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await ponto(req, res);
    assert.equal(res.statusCode, 403);
  });
  assert.equal(log.length, 0, "nenhuma chamada ao banco antes da autorização");
});

test("carga de contatos: prévia não grava, confirmação grava", async t => {
  const tabelas = { pt_contatos: [{ re: 1, nome_cadastro: "PESSOA 1", nome_norm: "PESSOA 1", telefone_original: "+5519998765432", telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true, origem: "CADASTRO", data_base: "2026-09-01" }] };
  const log = supabaseFalso(tabelas);
  const linhas = [contato(1, "+5519911112222"), contato(2, "+5519933334444"), contato(3, "", { cpf: "000.000.000-00" })];

  await t.test("prévia", async () => {
    const r = await chamar(ponto, { method: "POST", query: { t: "contatos" }, usuario: "aprovador", body: { linhas } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.gravado, false);
    assert.equal(r.body.resumo.novos, 2);
    assert.equal(r.body.resumo.atualizados, 1);
    assert.equal(r.body.resumo.telefones_alterados, 1);
    assert.equal(r.body.resumo.sem_telefone, 1);
    assert.equal(log.filter(c => c.metodo !== "GET").length, 0, "prévia não escreve nada");
  });

  await t.test("confirmação", async () => {
    log.length = 0;
    const r = await chamar(ponto, { method: "POST", query: { t: "contatos" }, usuario: "aprovador", body: { linhas, confirmar: true } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.gravado, true);
    const escritas = log.filter(c => c.metodo === "POST").map(c => c.tabela);
    assert.deepEqual(escritas, ["pt_auditoria", "pt_contatos", "pt_auditoria"], "telefone antigo auditado antes da sobrescrita");
    assert.equal(tabelas.pt_contatos.length, 3);
    assert.equal(tabelas.pt_contatos.find(c => c.re === 1).telefone_e164, "+5519911112222");
    assert.equal(tabelas.pt_contatos.find(c => c.re === 3).cpf, undefined, "CPF nunca chega ao banco");
    const aud = tabelas.pt_auditoria;
    assert.equal(aud[0].acao, "TELEFONE_ALTERADO");
    assert.equal(aud[0].ator, "aprovador");
    assert.equal(aud[0].antes.telefone_e164, "+5519998765432");
    assert.equal(aud[aud.length - 1].acao, "CONTATOS_CARREGADOS");
  });

  await t.test("listagem", async () => {
    const r = await chamar(ponto, { query: { t: "contatos" }, usuario: "aprovador" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.enviaveis, 2);
  });
});

test("api/rh.js desvia ?modulo=ponto para o módulo de ponto", async () => {
  const log = supabaseFalso({});
  const r = await chamar(rh, { query: { modulo: "ponto", t: "contatos" } });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.codigo, "NAO_AUTORIZADO");
  assert.equal(log.length, 0);
});

test("carga vazia é recusada", async () => {
  supabaseFalso({});
  const r = await chamar(ponto, { method: "POST", query: { t: "contatos" }, usuario: "aprovador", body: { linhas: [] } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.codigo, "SEM_LINHAS");
});
