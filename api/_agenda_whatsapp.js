// api/_agenda_whatsapp.js — mensagens de WhatsApp da Agenda Comercial (confirmação, lembrete, remarcada e cancelada
// para quem marcou). Sai pelo mesmo número pareado do Comercial que já manda a 1ª mensagem da cadência de propostas
// (Evolution API: EVOLUTION_URL, EVOLUTION_INSTANCE_COM, EVOLUTION_APIKEY_COM — as mesmas de api/comercial.js).
//
// O número pareado cai quando o celular fica sem rede ou alguém remove o pareamento. Por isso, antes de cada envio
// o painel pergunta se a instância está conectada; se não estiver, nada é enviado e o motivo fica registrado
// (o e-mail segue normalmente). Só vai para celular brasileiro; a reunião nunca depende do WhatsApp.
// Os testes trocam o envio (definirZap) para nada sair da máquina.

"use strict";

const { quando, onde } = require("./_agenda_email");

const primeiroNome = n => String(n || "").trim().split(/\s+/)[0] || "";
const durTxt = m => m < 60 ? m + " minutos" : (m % 60 ? Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") : m / 60 + (m === 60 ? " hora" : " horas"));

// assinatura de quem atende (Painel › Agenda › 🎨 Sua página), quando configurada
const assina = m => { const a = m && m.anfitriao; return a && a.nome ? `\n\n— ${a.nome}${a.cargo ? " · " + a.cargo : ""}\n*Grupo ServCamp*` : ""; };

// "(19) 99999-8888" → "5519999998888". Fixo, número curto ou lixo → null (não manda).
function celular(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return /^[1-9][1-9]9\d{8}$/.test(d) ? "55" + d : null;
}

// m: { tipo, nome, inicio (ms), duracao_min, local, gerenciar, novo }
function confirmacao(m) {
  const q = quando(m.inicio);
  return `Olá, ${primeiroNome(m.nome)}! ✅\nSua reunião com o *Grupo ServCamp* está *confirmada*:\n\n📌 ${m.tipo}\n📅 ${q.extenso}, às *${q.hora}* (horário de Brasília)\n⏱ ${durTxt(m.duracao_min)}` +
    (onde(m) ? "\n" + onde(m) : "") + (m.gerenciar ? `\n\nPara remarcar ou cancelar (até 2 horas antes):\n${m.gerenciar}` : "") + assina(m);
}
function lembrete(m) {
  const q = quando(m.inicio);
  return `Olá, ${primeiroNome(m.nome)}! ⏰\nLembrete da sua reunião com o *Grupo ServCamp* *amanhã*:\n\n📌 ${m.tipo}\n📅 ${q.extenso}, às *${q.hora}* (horário de Brasília)` +
    (onde(m) ? "\n" + onde(m) : "") + (m.gerenciar ? `\n\nSe não conseguir comparecer, remarque ou cancele (até 2 horas antes):\n${m.gerenciar}` : "") + assina(m);
}
function remarcada(m) {
  const q = quando(m.inicio);
  return `Olá, ${primeiroNome(m.nome)}! 🔁\nSua reunião com o *Grupo ServCamp* foi *remarcada* para:\n\n📌 ${m.tipo}\n📅 ${q.extenso}, às *${q.hora}* (horário de Brasília)` +
    (onde(m) ? "\n" + onde(m) : "") + (m.gerenciar ? `\n\nPara remarcar ou cancelar:\n${m.gerenciar}` : "") + assina(m);
}
function cancelada(m) {
  const q = quando(m.inicio);
  return `Olá, ${primeiroNome(m.nome)}.\nSua reunião *${m.tipo}* de ${q.extenso}, às ${q.hora}, foi *cancelada*.` +
    (m.novo ? `\n\nPara marcar um novo horário:\n${m.novo}` : "\n\nSe quiser marcar outro horário, é só responder esta mensagem.") + assina(m);
}

// ── envio ───────────────────────────────────────────────────────────────────
let envioDeTeste = null;
function definirZap(fn) { const antes = envioDeTeste; envioDeTeste = fn; return antes; }
const configuracao = () => ({
  url: String(process.env.EVOLUTION_URL || "https://evolution-api-cizp.srv1815873.hstgr.cloud").replace(/\/+$/, ""),
  inst: process.env.EVOLUTION_INSTANCE_COM || process.env.EVOLUTION_INSTANCE || "servcamp",
  apikey: process.env.EVOLUTION_APIKEY_COM || process.env.EVOLUTION_APIKEY
});
async function comTempo(url, init, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({}, init, { signal: ctl.signal })); } finally { clearTimeout(t); }
}

// { telefone, texto } → { ok, motivo, naoTenta }. Nunca lança.
// naoTenta = não havia como enviar (sem celular, WhatsApp não configurado): não é falha para ficar repetindo.
async function enviar(msg) {
  try {
    const num = celular(msg && msg.telefone);
    if (!num) return { ok: false, motivo: "telefone não é celular", naoTenta: true };
    if (envioDeTeste) return await envioDeTeste({ telefone: num, texto: msg.texto });
    const c = configuracao();
    if (!c.apikey) return { ok: false, motivo: "WhatsApp não configurado", naoTenta: true };
    const est = await comTempo(`${c.url}/instance/connectionState/${encodeURIComponent(c.inst)}`, { headers: { apikey: c.apikey } }, 6000);
    const j = await est.json().catch(() => null);
    const estado = (j && j.instance && j.instance.state) || (j && j.state) || null;
    if (estado !== "open") return { ok: false, motivo: "WhatsApp do Comercial desconectado" };
    const r = await comTempo(`${c.url}/message/sendText/${encodeURIComponent(c.inst)}`, {
      method: "POST", headers: { apikey: c.apikey, "Content-Type": "application/json" }, body: JSON.stringify({ number: num, text: msg.texto })
    }, 10000);
    if (!r.ok) return { ok: false, motivo: "a Evolution respondeu " + r.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: String((e && e.name === "AbortError") ? "demorou demais" : (e && e.message) || e).slice(0, 120) };
  }
}

module.exports = { celular, confirmacao, lembrete, remarcada, cancelada, enviar, definirZap };
