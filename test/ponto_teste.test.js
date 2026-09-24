// Envio de teste (1 SMS avulso para um RE), contra um Supabase falso e o
// provedor mock. Nenhum teste toca a rede nem manda SMS de verdade.

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../api/_ponto_regras");
const ponto = require("../api/_ponto");
const { supabaseFalso, chamar } = require("./_supabase_falso");

ponto.APROVADORES.add("aprovador");

function base() {
  return {
    pt_config: [{ chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" }, { chave: "alerta_pct", valor: "80" }, { chave: "critico_pct", valor: "90" }],
    pt_contatos: [
      { re: 521, nome_cadastro: "MARIA DA SILVA", telefone_e164: "+5519998765432", tipo_telefone: "CELULAR", enviavel: true },
      { re: 523, nome_cadastro: "ANA FIXO", telefone_e164: "+551932345678", tipo_telefone: "FIXO", enviavel: false }
    ],
    pt_ocorrencias: [
      { id: 1, re: 521, nome: "MARIA DA SILVA", data_jornada: "2026-09-20", tipo: "LATE_EXIT", horario_previsto: "18:00", horario_marcado: "18:40", diferenca_minutos: 40, is_test: false },
      { id: 2, re: 521, nome: "MARIA DA SILVA", data_jornada: "2026-09-22", tipo: "EARLY_ENTRY", horario_previsto: "07:00", horario_marcado: "06:30", diferenca_minutos: 30, is_test: false }
    ],
    pt_mensagens: [],
    pt_sms_uso: [],
    pt_auditoria: [],
    dashboard_snapshots: [{ id: 1, created_at: "2026-09-23T10:00:00Z", data: { ativos: [{ RE: "521", NOME: "MARIA DA SILVA", CARGO: "PORTEIRO", LOCAL: "POSTO A", AREA: "SUPERVISOR X" }] } }]
  };
}

const ver = (re, usuario) => chamar(ponto, { method: "GET", query: { t: "teste", re }, usuario: usuario === undefined ? "aprovador" : usuario });
const enviar = (body, usuario) => chamar(ponto, { method: "POST", query: { t: "teste" }, usuario: usuario === undefined ? "aprovador" : usuario, body });

test("telefoneDeTeste", () => {
  assert.equal(R.telefoneDeTeste("(19) 99876-5432"), "+5519998765432");
  assert.equal(R.telefoneDeTeste("+55 19 99876-5432"), "+5519998765432");
  assert.equal(R.telefoneDeTeste("(19) 3234-5678"), null, "fixo não");
  assert.equal(R.telefoneDeTeste(""), null);
});

test("textoDeTeste: orientação do dia mais recente, ou aviso neutro", () => {
  const t = R.textoDeTeste(521, "MARIA DA SILVA", base().pt_ocorrencias, {});
  assert.equal(t.origem, "ocorrencia");
  assert.equal(t.data_jornada, "2026-09-22");
  assert.equal(t.template_id, "entrada_antecipada");
  assert.match(t.texto, /Ola, Maria\. Em 22\/09 sua entrada foi as 06:30, 30 min antes/);
  const p = R.textoDeTeste(12345, "JOSÉ ALESSANDRO", [], {});
  assert.equal(p.origem, "padrao");
  assert.equal(R.analisarSMS(p.texto).codificacao, "GSM-7");
  assert.equal(R.analisarSMS(p.texto).segmentos, 1);
});

test("GET teste", async t => {
  process.env.SMS_PROVIDER = "mock";
  await t.test("só aprovador", async () => {
    supabaseFalso(base());
    const r = await ver("521", "outra-pessoa");
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.codigo, "NAO_AUTORIZADO");
  });
  await t.test("traz colaborador, telefone completo e texto sugerido", async () => {
    supabaseFalso(base());
    const r = await ver("521");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.colaborador.nome, "MARIA DA SILVA");
    assert.equal(r.body.colaborador.no_quadro_ativo, true);
    assert.equal(r.body.telefone, "+5519998765432");
    assert.equal(r.body.bloqueio, null);
    assert.equal(r.body.sugestao.template_id, "entrada_antecipada");
    assert.equal(r.body.provedor.nome, "mock");
    assert.equal(r.body.ultimas_ocorrencias.length, 2);
  });
  await t.test("telefone fixo vem com o bloqueio", async () => {
    supabaseFalso(base());
    const r = await ver("523");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.bloqueio, "TELEFONE_FIXO");
    assert.equal(r.body.sugestao.origem, "padrao");
  });
  await t.test("RE desconhecido", async () => {
    supabaseFalso(base());
    const r = await ver("999");
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.codigo, "RE_NAO_ENCONTRADO");
  });
});

test("POST teste", async t => {
  const TXT = "SERVCAMP | TESTE DE ENVIO\nOla, Maria. Teste. RE 521.";
  await t.test("envia 1 SMS, gasta cota e registra na auditoria, sem criar pt_mensagens", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ re: 521, telefone: "(19) 91111-2222", texto: TXT, confirmar: true });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.provedor, "mock");
    assert.equal(r.body.segmentos, 1);
    assert.equal(tabelas.pt_mensagens.length, 0);
    assert.equal(tabelas.pt_sms_uso[0].segmentos_dia, 1);
    const a = tabelas.pt_auditoria.find(x => x.acao === "SMS_TESTE_ENVIADO");
    assert.ok(a);
    assert.equal(a.ator, "aprovador");
    assert.equal(a.depois.telefone, "+55 19 ****-2222");
  });
  await t.test("sem confirmar, nada sai", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    supabaseFalso(tabelas);
    const r = await enviar({ re: 521, telefone: "19998765432", texto: TXT });
    assert.equal(r.statusCode, 400);
    assert.equal(r.body.codigo, "SEM_CONFIRMACAO");
    assert.equal(tabelas.pt_sms_uso.length, 0);
  });
  await t.test("recusa telefone fixo, termo proibido e quem não aprova", async () => {
    process.env.SMS_PROVIDER = "mock";
    supabaseFalso(base());
    assert.equal((await enviar({ re: 521, telefone: "1932345678", texto: TXT, confirmar: true })).body.codigo, "TELEFONE_INVALIDO");
    assert.equal((await enviar({ re: 521, telefone: "19998765432", texto: "Sua hora extra foi paga", confirmar: true })).body.codigo, "TERMO_PROIBIDO");
    assert.equal((await enviar({ re: 521, telefone: "19998765432", texto: TXT, confirmar: true }, "outra-pessoa")).statusCode, 403);
  });
  await t.test("sem cota, não envia", async () => {
    process.env.SMS_PROVIDER = "mock";
    const tabelas = base();
    tabelas.pt_sms_uso = [{ id: 1, dia: new Date().toISOString().slice(0, 10), mes_referencia: new Date().toISOString().slice(0, 7), segmentos_dia: 50, segmentos_mes: 50 }];
    supabaseFalso(tabelas);
    const r = await enviar({ re: 521, telefone: "19998765432", texto: TXT, confirmar: true });
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.codigo, "SEM_COTA");
  });
  await t.test("provedor desligado", async () => {
    process.env.SMS_PROVIDER = "";
    supabaseFalso(base());
    const r = await enviar({ re: 521, telefone: "19998765432", texto: TXT, confirmar: true });
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.codigo, "SMS_DESLIGADO");
  });
  delete process.env.SMS_PROVIDER;
});
