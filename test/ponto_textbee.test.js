// Provedor TextBee (Etapa 8) contra um TextBee FALSO: nenhum teste toca a rede
// nem manda SMS de verdade. As respostas seguem a especificação oficial
// (https://textbee.dev/openapi.json): 200 com data.smsBatchId; 400 sem aparelho
// habilitado; 401 chave inválida; 429 limite do plano.

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const SMS = require("../api/_sms");
const ponto = require("../api/_ponto");
const { supabaseFalso, chamar, resposta } = require("./_supabase_falso");

ponto.APROVADORES.add("aprovador");
const CHAVE = "chave-textbee-de-teste-123";

function textbeeFalso(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const falso = async (url, init = {}) => {
    chamadas.push({ url, metodo: init.method || "GET", cabecalhos: init.headers || {}, corpo: init.body ? JSON.parse(init.body) : null });
    const r = fila.length > 1 ? fila.shift() : fila[0];
    if (r === "REDE") throw new Error("getaddrinfo ENOTFOUND api.textbee.dev");
    return resposta(r.status, r.corpo);
  };
  return { falso, chamadas };
}

function provedor(respostas, env) {
  const tb = textbeeFalso(respostas);
  global.fetch = tb.falso;
  return { p: new SMS.TextBeeSmsProvider({ TEXTBEE_API_KEY: CHAVE, ...env }), chamadas: tb.chamadas };
}

const OK = { status: 200, corpo: { data: { success: true, message: "SMS added to queue for processing", smsBatchId: "lote-1", recipientCount: 1 } } };

test("TextBee: envio", async t => {
  await t.test("requisição no formato da API e id do lote na volta", async () => {
    const { p, chamadas } = provedor([OK]);
    const r = await p.enviar("+5519998765432", "Ola, Maria.");
    assert.deepEqual(r, { ok: true, id: "lote-1" });
    const c = chamadas[0];
    assert.equal(c.url, "https://api.textbee.dev/api/v1/gateway/send-sms");
    assert.equal(c.metodo, "POST");
    assert.equal(c.cabecalhos["x-api-key"], CHAVE);
    assert.deepEqual(c.corpo, { recipients: ["+5519998765432"], message: "Ola, Maria." });
  });
  await t.test("aparelho e chip fixos quando configurados", async () => {
    const { p, chamadas } = provedor([OK], { TEXTBEE_DEVICE_ID: "aparelho-corporativo", TEXTBEE_SIM_SUBSCRIPTION_ID: "2", TEXTBEE_BASE_URL: "https://api.textbee.dev/" });
    await p.enviar("+5519998765432", "Ola");
    assert.deepEqual(chamadas[0].corpo, { recipients: ["+5519998765432"], message: "Ola", deviceId: "aparelho-corporativo", simSubscriptionId: 2 });
    assert.equal(chamadas[0].url, "https://api.textbee.dev/api/v1/gateway/send-sms");
  });
  await t.test("cada erro documentado vira o código certo", async () => {
    const casos = [
      [{ status: 429, corpo: { message: "Daily limit reached" } }, "LIMITE_API"],
      [{ status: 400, corpo: { message: "No enabled device to send from" } }, "SMS_GATEWAY_OFFLINE"],
      [{ status: 401, corpo: { message: "Invalid API key" } }, "SMS_CREDENCIAL_INVALIDA"],
      [{ status: 503, corpo: { message: "Service Unavailable" } }, "SMS_INDISPONIVEL"],
      [{ status: 200, corpo: { data: { success: false, message: "Could not push to phone" } } }, "SMS_RECUSADO"],
      [{ status: 422, corpo: { message: ["recipients must be an array"] } }, "SMS_RECUSADO"]
    ];
    for (const [resp, codigo] of casos) {
      const { p } = provedor([resp]);
      const r = await p.enviar("+5519998765432", "Ola");
      assert.equal(r.ok, false);
      assert.equal(r.codigo, codigo, JSON.stringify(resp));
      assert.ok(r.mensagem && r.mensagem.length > 0);
    }
  });
  await t.test("sem rede", async () => {
    const { p } = provedor(["REDE"]);
    assert.equal((await p.enviar("+5519998765432", "Ola")).codigo, "SMS_INDISPONIVEL");
  });
  await t.test("sem chave, nem chama a API", async () => {
    const tb = textbeeFalso([OK]);
    global.fetch = tb.falso;
    const r = await new SMS.TextBeeSmsProvider({}).enviar("+5519998765432", "Ola");
    assert.equal(r.codigo, "SMS_CREDENCIAL_INVALIDA");
    assert.equal(tb.chamadas.length, 0);
  });
  await t.test("a chave nunca aparece numa mensagem de erro", async () => {
    for (const status of [400, 401, 429, 500]) {
      const { p } = provedor([{ status, corpo: { message: "erro" } }]);
      const r = await p.enviar("+5519998765432", "Ola");
      assert.ok(!JSON.stringify(r).includes(CHAVE));
    }
  });
});

test("TextBee: status", async t => {
  await t.test("chave válida e aparelho cadastrado", async () => {
    const { p, chamadas } = provedor([{ status: 200, corpo: { data: { totalSentSMSCount: 10, totalDeviceCount: 1 } } }]);
    const s = await p.status();
    assert.equal(s.online, true);
    assert.equal(chamadas[0].url, "https://api.textbee.dev/api/v1/gateway/stats");
  });
  await t.test("sem aparelho", async () => {
    const { p } = provedor([{ status: 200, corpo: { data: { totalDeviceCount: 0 } } }]);
    const s = await p.status();
    assert.equal(s.online, false);
    assert.match(s.motivo, /aparelho/i);
  });
  await t.test("chave inválida", async () => {
    const { p } = provedor([{ status: 401, corpo: { message: "Unauthorized" } }]);
    assert.equal((await p.status()).codigo, "SMS_CREDENCIAL_INVALIDA");
  });
});

test("SMS_PROVIDER=textbee escolhe o TextBee", () => {
  process.env.SMS_PROVIDER = "textbee";
  assert.ok(SMS.provedorSMS() instanceof SMS.TextBeeSmsProvider);
  delete process.env.SMS_PROVIDER;
});

test("envio de ponta a ponta pelo TextBee falso: o 429 para o lote e a cota volta", async () => {
  process.env.SMS_PROVIDER = "textbee";
  process.env.TEXTBEE_API_KEY = CHAVE;
  const diaCota = new Date().toISOString().slice(0, 10);
  const txt = "SERVCAMP | ORIENTACAO DE PONTO\nOla. Marque o ponto no horario.";
  const m = (id, re, min) => ({ id, re, data_jornada: "2026-09-20", ocorrencia_ids: [id], telefone_e164: null, texto_gerado: txt, status: "APROVADA", is_test: false, _min: min });
  const tabelas = {
    pt_config: [{ chave: "sms_limite_dia", valor: "50" }, { chave: "sms_limite_mes", valor: "300" }],
    pt_contatos: [521, 522, 523].map((re, i) => ({ re, telefone_e164: `+551999876543${i}`, tipo_telefone: "CELULAR", enviavel: true })),
    pt_ocorrencias: [{ id: 1, diferenca_minutos: 50 }, { id: 2, diferenca_minutos: 40 }, { id: 3, diferenca_minutos: 30 }],
    pt_mensagens: [m(1, 521), m(2, 522), m(3, 523)],
    pt_sms_uso: []
  };
  supabaseFalso(tabelas);
  const banco = global.fetch;
  const tb = textbeeFalso([OK, { status: 429, corpo: { message: "Daily limit reached" } }]);
  global.fetch = (url, init) => (String(url).startsWith("https://api.textbee.dev") ? tb.falso(url, init) : banco(url, init));
  try {
    const r = await chamar(ponto, { method: "POST", query: { t: "enviar" }, usuario: "aprovador", body: { aprovadas: true, confirmar: true } });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.enviadas, [1]);
    assert.equal(r.body.parado_por, "LIMITE_API");
    assert.equal(tb.chamadas.length, 2, "a terceira nem foi tentada");
    const [m1, m2, m3] = [1, 2, 3].map(id => tabelas.pt_mensagens.find(x => x.id === id));
    assert.deepEqual([m1.status, m1.provider, m1.provider_message_id], ["ENVIADA", "textbee", "lote-1"]);
    assert.deepEqual([m2.status, m2.erro_codigo], ["APROVADA", "LIMITE_API"]);
    assert.equal(m3.status, "APROVADA");
    assert.equal(tabelas.pt_sms_uso.find(u => u.dia === diaCota).segmentos_dia, 1, "só o SMS que saiu conta");
  } finally {
    delete process.env.SMS_PROVIDER;
    delete process.env.TEXTBEE_API_KEY;
  }
});

test("limites: o pt_config vale; a variável de ambiente só preenche o que falta", async () => {
  process.env.SMS_LIMITE_DIA = "20";
  process.env.SMS_LIMITE_MES = "999";
  try {
    supabaseFalso({ pt_config: [{ chave: "sms_limite_mes", valor: "300" }], pt_sms_uso: [] });
    const r = await chamar(ponto, { query: { t: "quota" } });
    assert.equal(r.body.cota.hoje.limite, 20, "sem sms_limite_dia no banco, vale a variável");
    assert.equal(r.body.cota.mes.limite, 300, "com sms_limite_mes no banco, vale o banco");
  } finally {
    delete process.env.SMS_LIMITE_DIA;
    delete process.env.SMS_LIMITE_MES;
  }
});
