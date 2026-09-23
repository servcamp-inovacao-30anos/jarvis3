// api/_sms.js — camada de provedor de SMS.
//
// Prefixo "_" → não vira rota. Todo provedor tem a mesma cara:
//   enviar(destinatario, texto) → { ok: true, id } | { ok: false, codigo, mensagem }
//   enviarLote(mensagens)       → um resultado por mensagem, na mesma ordem
//   status()                    → { ok, provedor, online }
//
// Escolhido por SMS_PROVIDER:
//   mock    → registra o que teria enviado e devolve id falso. Nunca toca a rede.
//   textbee → Etapa 8 (ainda não implementado).
//   vazio   → desligado: nada sai. É o padrão de propósito — cair no mock sem
//             ninguém pedir marcaria como "enviada" uma mensagem que não saiu.
//
// Códigos de falha que o envio trata de forma especial:
//   LIMITE_API          → o provedor recusou por limite (HTTP 429): o lote para,
//                         as mensagens restantes continuam na fila, sem nova tentativa.
//   SMS_GATEWAY_OFFLINE → o aparelho/gateway não responde: o lote também para.
// Qualquer outro código é falha só daquela mensagem.

class MockSmsProvider {
  constructor() {
    this.nome = "mock";
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

class ProvedorDesligado {
  constructor(motivo) {
    this.nome = "desligado";
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
  if (!p) return new ProvedorDesligado("SMS_PROVIDER não configurado: o envio de SMS está desligado.");
  return new ProvedorDesligado(`Provedor de SMS desconhecido ou ainda não implementado: ${p}.`);
}

module.exports = { provedorSMS, MockSmsProvider, ProvedorDesligado };
