// api/_agenda_email.js — e-mails da Agenda Comercial: confirmação e lembrete para quem marcou, e aviso para a
// Comercial. Sai pela mesma conta SMTP do Comercial que já manda a cadência de propostas (MAIL_HOST, MAIL_PORT,
// MAIL_USER, MAIL_PASS, MAIL_FROM). Nada aqui derruba o agendamento: se o e-mail falhar, a reunião vale do mesmo
// jeito e o motivo fica guardado (email_status).
//
// O link para cancelar/remarcar leva um código só da pessoa; o texto nunca leva telefone, e-mail ou observação
// de outra pessoa. Os testes trocam o correio (definirCorreio) para nada sair da máquina.

"use strict";

const R = require("./_agenda_regras");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function quando(inicioMs) {
  const { dia, hora } = R.deUtc(inicioMs), d = new Date(dia + "T12:00:00Z");
  return { dia, hora, extenso: SEMANA[d.getUTCDay()] + ", " + d.getUTCDate() + " de " + MESES[d.getUTCMonth()], curto: String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") };
}
const durTxt = m => m < 60 ? m + " minutos" : (m % 60 ? Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") : m / 60 + (m === 60 ? " hora" : " horas"));
const primeiroNome = n => String(n || "").trim().split(/\s+/)[0] || "";

const moldura = (cor, titulo, corpo, rodape) => `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0d1f35">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${esc(cor)};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${esc(titulo)}</td></tr>
<tr><td style="padding:22px 24px;font-size:15px;line-height:1.55">${corpo}</td></tr>
<tr><td style="padding:14px 24px 20px;border-top:1px solid #eef2f7;font-size:12px;color:#64748b">${rodape || "Grupo ServCamp"}</td></tr>
</table></td></tr></table></body></html>`;
const quadro = linhas => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;background:#f4f7fb;border-radius:10px;width:100%"><tr><td style="padding:14px 16px;font-size:15px;line-height:1.7">${linhas.filter(Boolean).join("<br>")}</td></tr></table>`;
const botao = (url, txt, cor) => `<a href="${esc(url)}" style="display:inline-block;background:${esc(cor || "#ea580c")};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;font-size:15px">${esc(txt)}</a>`;

// m: { tipo, nome, inicio (ms), fim (ms), local, duracao_min, gerenciar (url) }
function confirmacao(m) {
  const q = quando(m.inicio);
  const assunto = `Reunião confirmada — ${m.tipo} · ${q.curto} às ${q.hora}`;
  const detalhes = [`<b>${esc(m.tipo)}</b>`, `📅 ${esc(q.extenso)}, às <b>${esc(q.hora)}</b> (horário de Brasília)`, `⏱ ${esc(durTxt(m.duracao_min))}`, m.local ? `📍 ${esc(m.local)}` : ""];
  const corpo = `<p style="margin:0 0 6px">Olá, ${esc(primeiroNome(m.nome))}!</p><p style="margin:0">Sua reunião com o Grupo ServCamp está <b>confirmada</b>:</p>${quadro(detalhes)}` +
    `<p style="margin:0 0 14px">O convite vai anexo: abra para colocar na sua agenda.</p>` +
    (m.gerenciar ? `<p style="margin:0 0 14px">Precisa mudar? Você pode remarcar ou cancelar até 2 horas antes:</p><p style="margin:0">${botao(m.gerenciar, "Remarcar ou cancelar")}</p>` : "");
  const texto = `Olá, ${primeiroNome(m.nome)}!\n\nSua reunião com o Grupo ServCamp está confirmada:\n\n${m.tipo}\n${q.extenso}, às ${q.hora} (horário de Brasília)\nDuração: ${durTxt(m.duracao_min)}\n${m.local ? "Local: " + m.local + "\n" : ""}\n${m.gerenciar ? "Para remarcar ou cancelar (até 2 horas antes): " + m.gerenciar + "\n" : ""}\nGrupo ServCamp`;
  return { assunto, html: moldura(m.cor || "#1e4d8c", "Reunião confirmada ✅", corpo), texto };
}

function lembrete(m) {
  const q = quando(m.inicio);
  const assunto = `Lembrete: sua reunião é amanhã às ${q.hora} — ${m.tipo}`;
  const detalhes = [`<b>${esc(m.tipo)}</b>`, `📅 ${esc(q.extenso)}, às <b>${esc(q.hora)}</b> (horário de Brasília)`, m.local ? `📍 ${esc(m.local)}` : ""];
  const corpo = `<p style="margin:0 0 6px">Olá, ${esc(primeiroNome(m.nome))}!</p><p style="margin:0">Passando para lembrar da nossa reunião:</p>${quadro(detalhes)}` +
    (m.gerenciar ? `<p style="margin:0 0 14px">Se não conseguir comparecer, avise remarcando ou cancelando (até 2 horas antes):</p><p style="margin:0">${botao(m.gerenciar, "Remarcar ou cancelar")}</p>` : "");
  const texto = `Olá, ${primeiroNome(m.nome)}!\n\nLembrete da nossa reunião:\n\n${m.tipo}\n${q.extenso}, às ${q.hora} (horário de Brasília)\n${m.local ? "Local: " + m.local + "\n" : ""}\n${m.gerenciar ? "Remarcar ou cancelar (até 2 horas antes): " + m.gerenciar + "\n" : ""}\nGrupo ServCamp`;
  return { assunto, html: moldura(m.cor || "#1e4d8c", "Lembrete de reunião ⏰", corpo), texto };
}

function remarcada(m) {
  const q = quando(m.inicio);
  const assunto = `Reunião remarcada — ${m.tipo} · ${q.curto} às ${q.hora}`;
  const detalhes = [`<b>${esc(m.tipo)}</b>`, `📅 ${esc(q.extenso)}, às <b>${esc(q.hora)}</b> (horário de Brasília)`, `⏱ ${esc(durTxt(m.duracao_min))}`, m.local ? `📍 ${esc(m.local)}` : ""];
  const corpo = `<p style="margin:0 0 6px">Olá, ${esc(primeiroNome(m.nome))}!</p><p style="margin:0">Sua reunião foi <b>remarcada</b> para:</p>${quadro(detalhes)}<p style="margin:0 0 14px">O convite novo vai anexo.</p>` +
    (m.gerenciar ? `<p style="margin:0">${botao(m.gerenciar, "Remarcar ou cancelar")}</p>` : "");
  const texto = `Olá, ${primeiroNome(m.nome)}!\n\nSua reunião foi remarcada para:\n\n${m.tipo}\n${q.extenso}, às ${q.hora} (horário de Brasília)\n${m.local ? "Local: " + m.local + "\n" : ""}\n${m.gerenciar ? "Remarcar ou cancelar: " + m.gerenciar + "\n" : ""}\nGrupo ServCamp`;
  return { assunto, html: moldura(m.cor || "#1e4d8c", "Reunião remarcada 🔁", corpo), texto };
}

function cancelada(m) {
  const q = quando(m.inicio);
  const assunto = `Reunião cancelada — ${m.tipo} · ${q.curto} às ${q.hora}`;
  const corpo = `<p style="margin:0 0 6px">Olá, ${esc(primeiroNome(m.nome))}!</p><p style="margin:0">A reunião <b>${esc(m.tipo)}</b> de ${esc(q.extenso)}, às ${esc(q.hora)}, foi <b>cancelada</b>.</p>` +
    (m.novo ? `<p style="margin:14px 0">Para escolher um novo horário:</p><p style="margin:0">${botao(m.novo, "Marcar novo horário")}</p>` : `<p style="margin:14px 0 0">Se quiser marcar outro horário, é só falar com o nosso Comercial.</p>`);
  const texto = `Olá, ${primeiroNome(m.nome)}!\n\nA reunião ${m.tipo} de ${q.extenso}, às ${q.hora}, foi cancelada.\n${m.novo ? "Para marcar um novo horário: " + m.novo + "\n" : ""}\nGrupo ServCamp`;
  return { assunto, html: moldura("#b91c1c", "Reunião cancelada", corpo), texto };
}

// Aviso para a Comercial (leva os dados de contato de quem marcou: só vai para a caixa dela)
// m: { acao: "nova"|"remarcada"|"cancelada", origem, tipo, nome, telefone, email, obs, inicio, duracao_min, local, de (ms, remarcada) }
function aviso(m) {
  const q = quando(m.inicio);
  const rot = { nova: "Reunião nova", remarcada: "Reunião remarcada pelo cliente", cancelada: "Reunião cancelada pelo cliente" }[m.acao] || "Agenda";
  const assunto = `${rot} — ${m.tipo} · ${q.curto} às ${q.hora} · ${m.nome}`;
  const antes = m.de ? quando(m.de) : null;
  const linhas = [`<b>${esc(m.tipo)}</b>`, `📅 ${esc(q.extenso)}, às <b>${esc(q.hora)}</b>${m.duracao_min ? " (" + esc(durTxt(m.duracao_min)) + ")" : ""}`, antes ? `↩ Era ${esc(antes.extenso)}, às ${esc(antes.hora)}` : "",
    `👤 ${esc(m.nome)}`, m.telefone ? `📞 ${esc(m.telefone)}` : "", m.email ? `✉️ ${esc(m.email)}` : "", m.obs ? `💬 “${esc(m.obs)}”` : "", m.origem === "link" ? "Marcada pelo link" : ""];
  const corpo = `<p style="margin:0">${esc(rot)}:</p>${quadro(linhas)}<p style="margin:0;color:#64748b;font-size:13px">Veja e administre em Painel › Agenda Comercial.</p>`;
  const texto = `${rot}:\n\n${m.tipo}\n${q.extenso}, às ${q.hora}\n${antes ? "Era " + antes.extenso + ", às " + antes.hora + "\n" : ""}${m.nome}\n${m.telefone ? "Telefone: " + m.telefone + "\n" : ""}${m.email ? "E-mail: " + m.email + "\n" : ""}${m.obs ? "Observação: " + m.obs + "\n" : ""}`;
  return { assunto, html: moldura(m.acao === "cancelada" ? "#b91c1c" : "#1e4d8c", rot, corpo, "Aviso automático da Agenda Comercial"), texto };
}

// ── envio ───────────────────────────────────────────────────────────────────
let correioDeTeste = null;
function definirCorreio(fn) { const antes = correioDeTeste; correioDeTeste = fn; return antes; }
const TEMPO_MAX_MS = 9000;

// msg: { para, assunto, html, texto, convite? (texto .ics) }. Nunca lança: devolve { ok, motivo }.
async function enviar(msg) {
  try {
    if (!msg || !msg.para || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(msg.para)) return { ok: false, motivo: "sem e-mail" };
    if (correioDeTeste) return await correioDeTeste(msg);
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return { ok: false, motivo: "sem conta de e-mail configurada" };
    const port = Number(process.env.MAIL_PORT || 465);
    const tx = require("nodemailer").createTransport({
      host: process.env.MAIL_HOST || "email-ssl.com.br", port, secure: port === 465,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 9000
    });
    try {
      const info = await Promise.race([
        tx.sendMail({
          from: process.env.MAIL_FROM || `"Grupo ServCamp" <${process.env.MAIL_USER}>`, to: msg.para,
          subject: msg.assunto, html: msg.html, text: msg.texto,
          attachments: msg.convite ? [{ filename: "reuniao-servcamp.ics", content: msg.convite, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }] : []
        }),
        new Promise((_, no) => setTimeout(() => no(new Error("demorou demais")), TEMPO_MAX_MS))
      ]);
      return { ok: !!(info && info.accepted && info.accepted.length), motivo: info && info.accepted && info.accepted.length ? null : "o servidor de e-mail recusou o endereço" };
    } finally { try { tx.close(); } catch (e) { /* já fechou */ } }
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e).slice(0, 120) };
  }
}

// convite (.ics) de uma reunião para anexar
function convite(m) {
  return R.ics([{ id: "convite-" + m.id, inicio: m.inicio, fim: m.fim, local: m.local, titulo: m.tipo + " — Grupo ServCamp", descricao: "Reunião com o Comercial do Grupo ServCamp." }]);
}

module.exports = { confirmacao, lembrete, remarcada, cancelada, aviso, enviar, convite, definirCorreio, quando };
