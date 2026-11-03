// api/_recupera.js — "Esqueci minha senha": regras do código e o envio por e-mail ou SMS.
//
// Prefixo "_" → não vira rota. Quem usa é api/users.js (ações recovery_*).
//
// Como funciona:
//   • Cada pessoa cadastra ANTES (logada, com a senha atual) ou o administrador cadastra
//     por ela: um e-mail e/ou um celular de recuperação (app_users.rec_email / rec_celular).
//     Na hora de recuperar ninguém digita destino: o código só vai para o que já estava
//     cadastrado. Assim, saber o usuário de alguém não basta para tomar a conta.
//   • A pessoa escolhe e-mail ou SMS; o servidor sorteia 6 dígitos e guarda só o HMAC
//     (app_users.rec_codigo), com validade de 15 min e 5 tentativas.
//   • No máximo 1 envio por minuto e 5 por hora para cada usuário.
//
// E-mail: conta SENHA_MAIL_USER/SENHA_MAIL_PASS (SENHA_MAIL_HOST, SENHA_MAIL_PORT,
// SENHA_MAIL_FROM); sem elas, a conta geral MAIL_* do painel.
// SMS: o mesmo provedor do resto do sistema (api/_sms.js, SMS_PROVIDER).

const crypto = require("crypto");
const { provedorSMS } = require("./_sms");
const { classificarTelefoneBR } = require("./_ponto_regras");

const VALIDADE_MIN = 15;
const MAX_TENTATIVAS = 5;
const INTERVALO_S = 60;
const MAX_ENVIOS_HORA = 5;

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

// "" ou null limpa; devolve { ok, valor } ou { ok:false, erro }
function lerEmail(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return { ok: true, valor: null };
  if (s.length > 120 || !EMAIL_RE.test(s)) return { ok: false, erro: "E-mail inválido." };
  return { ok: true, valor: s };
}
function lerCelular(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return { ok: true, valor: null };
  const c = classificarTelefoneBR(s);
  if (c.tipo !== "CELULAR" && c.tipo !== "CELULAR_CORRIGIDO") return { ok: false, erro: "Celular inválido: use DDD + número, ex.: (19) 99999-1234." };
  return { ok: true, valor: c.e164 };
}

// "adriano.macedo@empresa.com.br" → "ad•••••@empresa.com.br"
function mascararEmail(e) {
  if (!e) return null;
  const [u, d] = String(e).split("@");
  return u.slice(0, Math.min(2, u.length)) + "•••••@" + d;
}
// "+5519991234567" → "(19) •••••-4567"
function mascararCelular(c) {
  if (!c) return null;
  const d = String(c).replace(/\D/g, "").replace(/^55/, "");
  return "(" + d.slice(0, 2) + ") •••••-" + d.slice(-4);
}
function celularFormatado(c) {
  if (!c) return null;
  const d = String(c).replace(/\D/g, "").replace(/^55/, "");
  return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
}

function gerarCodigo() { return String(crypto.randomInt(0, 1000000)).padStart(6, "0"); }
function hashCodigo(userKey, codigo, segredo) {
  return crypto.createHmac("sha256", String(segredo || "")).update("recupera:" + userKey + ":" + codigo).digest("hex");
}
function codigoConfere(userKey, codigo, guardado, segredo) {
  if (!guardado || !/^\d{6}$/.test(String(codigo || ""))) return false;
  const a = Buffer.from(hashCodigo(userKey, String(codigo), segredo)), b = Buffer.from(String(guardado));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Envios da última hora (rec_envios: lista de instantes em ms). Devolve { ok, lista } ou { ok:false, erro, espera }.
function podeEnviar(envios, agora) {
  const lista = (Array.isArray(envios) ? envios : []).map(Number).filter(t => Number.isFinite(t) && agora - t < 3600000);
  const ultimo = lista.length ? Math.max(...lista) : 0;
  if (ultimo && agora - ultimo < INTERVALO_S * 1000) {
    const espera = Math.ceil((INTERVALO_S * 1000 - (agora - ultimo)) / 1000);
    return { ok: false, espera, erro: `Aguarde ${espera} s para pedir outro código.` };
  }
  if (lista.length >= MAX_ENVIOS_HORA) return { ok: false, erro: "Muitos códigos pedidos na última hora. Tente de novo mais tarde ou fale com o administrador." };
  return { ok: true, lista };
}

function textoSms(codigo) {
  return `JARVIS ServCamp: seu codigo para criar uma nova senha e ${codigo}. Vale ${VALIDADE_MIN} min. Se nao foi voce, ignore.`;
}
function emailMensagem(codigo, nome) {
  const ola = nome ? `Olá, ${String(nome).replace(/[<>&"']/g, "")}.` : "Olá.";
  return {
    assunto: "Código para criar uma nova senha — JARVIS ServCamp",
    texto: `${ola}\n\nSeu código para criar uma nova senha no JARVIS é ${codigo}.\nEle vale ${VALIDADE_MIN} minutos.\n\nSe não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: `<div style="font-family:Arial,sans-serif;color:#0d1f35;font-size:14px;max-width:520px">
      <p>${ola}</p>
      <p>Seu código para criar uma nova senha no <b>JARVIS</b> é:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;background:#f1f5f9;border-radius:8px;padding:12px 18px;display:inline-block;margin:6px 0 14px">${codigo}</p>
      <p>Ele vale <b>${VALIDADE_MIN} minutos</b>.</p>
      <p style="color:#64748b;font-size:12px;margin-top:20px">Se não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.</p>
    </div>`
  };
}

// ── envio (os testes trocam por definirEnvio, para nada sair da máquina) ─────
let envioDeTeste = null;
function definirEnvio(fn) { const antes = envioDeTeste; envioDeTeste = fn; return antes; }

function contaEmail() {
  const e = process.env;
  const user = e.SENHA_MAIL_USER || e.MAIL_USER, pass = e.SENHA_MAIL_USER ? e.SENHA_MAIL_PASS : e.MAIL_PASS;
  if (!user || !pass) return null;
  const port = Number((e.SENHA_MAIL_USER ? e.SENHA_MAIL_PORT : e.MAIL_PORT) || 465);
  return {
    user, pass, port,
    host: (e.SENHA_MAIL_USER ? e.SENHA_MAIL_HOST : e.MAIL_HOST) || "email-ssl.com.br",
    from: (e.SENHA_MAIL_USER ? e.SENHA_MAIL_FROM : e.MAIL_FROM) || `"JARVIS ServCamp" <${user}>`
  };
}

// canal "email" | "sms" → { ok } | { ok:false, erro }
async function enviarCodigo(canal, destino, codigo, nome) {
  if (envioDeTeste) return envioDeTeste({ canal, destino, codigo, nome });
  if (canal === "sms") {
    const r = await provedorSMS().enviar(destino, textoSms(codigo));
    if (r.ok) return { ok: true };
    console.error("recupera: SMS não saiu", r.codigo, r.mensagem);
    return { ok: false, erro: "Não consegui enviar o SMS agora. Tente pelo e-mail ou de novo em alguns minutos." };
  }
  const c = contaEmail();
  if (!c) return { ok: false, erro: "O envio por e-mail não está configurado no servidor. Tente pelo SMS." };
  const m = emailMensagem(codigo, nome);
  const tx = require("nodemailer").createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  try {
    await tx.sendMail({ from: c.from, to: destino, subject: m.assunto, text: m.texto, html: m.html });
    return { ok: true };
  } catch (e) {
    console.error("recupera: e-mail não saiu", (e && (e.responseCode || e.code)) || e);
    return { ok: false, erro: "Não consegui enviar o e-mail agora. Tente pelo SMS ou de novo em alguns minutos." };
  } finally { try { tx.close(); } catch (e) { /* já fechou */ } }
}

module.exports = {
  VALIDADE_MIN, MAX_TENTATIVAS, INTERVALO_S, MAX_ENVIOS_HORA,
  lerEmail, lerCelular, mascararEmail, mascararCelular, celularFormatado,
  gerarCodigo, hashCodigo, codigoConfere, podeEnviar, textoSms, emailMensagem,
  enviarCodigo, definirEnvio
};
