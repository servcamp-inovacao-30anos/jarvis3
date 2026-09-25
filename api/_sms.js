// api/_sms.js — camada de provedor de SMS.
//
// Prefixo "_" → não vira rota. Todo provedor tem a mesma cara:
//   enviar(destinatario, texto) → { ok: true, id } | { ok: false, codigo, mensagem }
//   enviarLote(mensagens)       → um resultado por mensagem, na mesma ordem
//   status()                    → { ok, provedor, online }
//
// Escolhido por SMS_PROVIDER:
//   mock    → registra o que teria enviado e devolve id falso. Nunca toca a rede.
//   textbee → API do TextBee (https://textbee.dev/openapi.json).
//   vazio   → desligado: nada sai. É o padrão de propósito — cair no mock sem
//             ninguém pedir marcaria como "enviada" uma mensagem que não saiu.
//
// Códigos de falha que param o lote inteiro (as mensagens restantes continuam
// na fila, sem nova tentativa automática):
//   LIMITE_API              → HTTP 429: limite diário, mensal ou por lote do plano
//   SMS_GATEWAY_OFFLINE     → HTTP 400: nenhum aparelho habilitado, ou o gateway
//                             não conseguiu entregar a mensagem ao celular
//   SMS_CREDENCIAL_INVALIDA → HTTP 401/403: chave ausente, inválida ou revogada
//   SMS_INDISPONIVEL        → sem resposta ou HTTP 5xx
// Qualquer outro código é falha só daquela mensagem.

class MockSmsProvider {
  constructor() {
    this.nome = "mock";
    this.configurado = true;
    this.enviados = [];
  }
  async enviar(destinatario, texto) {
    const id = `mock-${Date.now().toString(36)}-${this.enviados.length + 1}`;
    this.enviados.push({ id, destinatario, texto, em: new Date().toISOString() });
    return { ok: true, id };
  }
  async enviarLote(mensagens) {
    const r = [];
    for (const m of mensagens) r.push(await this.enviar(m.destinatario, m.texto));
    return r;
  }
  async status() {
    return { ok: true, provedor: this.nome, online: true };
  }
}

// TextBee: o SMS sai por um celular Android com o app do TextBee ("gateway").
// Tudo o que é segredo vem de variável de ambiente, lida só aqui no servidor:
//   TEXTBEE_API_KEY (obrigatória) · TEXTBEE_BASE_URL · TEXTBEE_DEVICE_ID · TEXTBEE_SIM_SUBSCRIPTION_ID
// Sem TEXTBEE_DEVICE_ID, o TextBee usa o aparelho padrão da conta (ou o que deu
// sinal de vida mais recente). Trocar de aparelho é só trocar essa variável.
// Os lotes não usam send-bulk-sms: cada SMS sai numa chamada, para que cota,
// status e auditoria fiquem certos mensagem a mensagem.
class TextBeeSmsProvider {
  constructor(env) {
    const e = env || {};
    this.nome = "textbee";
    this.chave = String(e.TEXTBEE_API_KEY || "").trim();
    this.base = String(e.TEXTBEE_BASE_URL || "https://api.textbee.dev").trim().replace(/\/+$/, "");
    this.dispositivo = String(e.TEXTBEE_DEVICE_ID || "").trim() || null;
    const sim = Number(e.TEXTBEE_SIM_SUBSCRIPTION_ID);
    this.sim = String(e.TEXTBEE_SIM_SUBSCRIPTION_ID || "").trim() && Number.isFinite(sim) ? sim : null;
    this.configurado = !!this.chave;
  }
  async chamar(metodo, caminho, corpo) {
    let r;
    try {
      r = await fetch(this.base + caminho, {
        method: metodo,
        headers: { "x-api-key": this.chave, "Content-Type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined
      });
    } catch (err) {
      return { status: 0, json: null, texto: String((err && err.message) || err) };
    }
    const texto = await r.text().catch(() => "");
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (err) { json = null; }
    return { status: r.status, json, texto };
  }
  erro(resp) {
    const bruto = resp.json && (resp.json.message || resp.json.error);
    const msg = String(Array.isArray(bruto) ? bruto.join("; ") : bruto || resp.texto || "").slice(0, 300);
    if (resp.status === 429) return { ok: false, codigo: "LIMITE_API", mensagem: msg || "Limite do plano do TextBee atingido." };
    if (resp.status === 401 || resp.status === 403) return { ok: false, codigo: "SMS_CREDENCIAL_INVALIDA", mensagem: msg || "Chave do TextBee ausente, inválida ou revogada." };
    if (resp.status === 400) return { ok: false, codigo: "SMS_GATEWAY_OFFLINE", mensagem: msg || "Nenhum aparelho habilitado para enviar." };
    if (resp.status === 0 || resp.status >= 500) return { ok: false, codigo: "SMS_INDISPONIVEL", mensagem: msg || "TextBee indisponível." };
    return { ok: false, codigo: "SMS_RECUSADO", mensagem: msg || `TextBee respondeu HTTP ${resp.status}.` };
  }
  async enviar(destinatario, texto) {
    if (!this.configurado) return { ok: false, codigo: "SMS_CREDENCIAL_INVALIDA", mensagem: "TEXTBEE_API_KEY não configurada." };
    const corpo = { recipients: [destinatario], message: texto };
    if (this.dispositivo) corpo.deviceId = this.dispositivo;
    if (this.sim != null) corpo.simSubscriptionId = this.sim;
    const resp = await this.chamar("POST", "/api/v1/gateway/send-sms", corpo);
    if (resp.status < 200 || resp.status >= 300) return this.erro(resp);
    const d = (resp.json && resp.json.data) || {};
    if (d.success === false || (Number(d.failureCount) > 0 && !Number(d.successCount))) {
      return { ok: false, codigo: "SMS_RECUSADO", mensagem: String(d.message || "O gateway não conseguiu enviar este SMS.").slice(0, 300) };
    }
    return { ok: true, id: d.smsBatchId || null };
  }
  async enviarLote(mensagens) {
    const r = [];
    for (const m of mensagens) r.push(await this.enviar(m.destinatario, m.texto));
    return r;
  }
  // Confere a chave e se há aparelho cadastrado. Se o aparelho está ligado agora
  // só se sabe no envio (HTTP 400).
  async status() {
    if (!this.configurado) return { ok: false, provedor: this.nome, online: false, codigo: "SMS_CREDENCIAL_INVALIDA", motivo: "TEXTBEE_API_KEY não configurada." };
    const resp = await this.chamar("GET", "/api/v1/gateway/stats");
    if (resp.status !== 200) { const e = this.erro(resp); return { ok: false, provedor: this.nome, online: false, codigo: e.codigo, motivo: e.mensagem }; }
    const n = Number(((resp.json && resp.json.data) || {}).totalDeviceCount) || 0;
    return { ok: true, provedor: this.nome, online: n > 0, dispositivos: n, motivo: n > 0 ? null : "Nenhum aparelho cadastrado no TextBee." };
  }
}

class ProvedorDesligado {
  constructor(motivo) {
    this.nome = "desligado";
    this.configurado = false;
    this.motivo = motivo;
  }
  async enviar() {
    return { ok: false, codigo: "SMS_DESLIGADO", mensagem: this.motivo };
  }
  async enviarLote(mensagens) {
    return mensagens.map(() => ({ ok: false, codigo: "SMS_DESLIGADO", mensagem: this.motivo }));
  }
  async status() {
    return { ok: false, provedor: this.nome, online: false, motivo: this.motivo };
  }
}

function provedorSMS() {
  const p = String(process.env.SMS_PROVIDER || "").trim().toLowerCase();
  if (p === "mock") return new MockSmsProvider();
  if (p === "textbee") return new TextBeeSmsProvider(process.env);
  if (!p) return new ProvedorDesligado("SMS_PROVIDER não configurado: o envio de SMS está desligado.");
  return new ProvedorDesligado(`Provedor de SMS desconhecido: ${p}.`);
}

module.exports = { provedorSMS, MockSmsProvider, TextBeeSmsProvider, ProvedorDesligado };
