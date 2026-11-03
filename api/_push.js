// api/_push.js — o comunicado semanal de faltas por notificação no celular (Web Push, biblioteca web-push).
// Arquivo com prefixo "_" → NÃO vira rota; as rotas entram por api/_faltas.js (módulo faltas).
//
// Volta o canal removido em 23/10/2026, bem menor: só o comunicado semanal e o lembrete. Reaproveita os mesmos
// eventos do módulo antigo na fm_auditoria (AVISO_APARELHO, AVISO_APARELHO_REMOVIDO, AVISO_VAPID): o par de chaves de
// envio continua o mesmo e os aparelhos registrados antes voltam a valer.
//
//   • a notificação não mostra nome de colaborador: "Comunicado semanal de faltas injustificadas · Semana de 26/10 a 01/11";
//   • quem recebe: o supervisor da área (a coordenação abre o painel quando quiser; não recebe a de todas as áreas);
//   • canal independente do e-mail: tem o próprio registro (FALTAS_PUSH), então um não segura o outro, e nenhum se repete
//     na mesma semana e área;
//   • lembrete no dia seguinte, uma vez, para quem não abriu o comunicado no painel.
// Quem nunca autorizou toca uma vez em "Permitir" (assets/comunicado/push.js): o navegador exige o gesto da pessoa.

const crypto = require("crypto");
const MD = require("./_medida_regras");

const ENTIDADE = "fs_avisos";
const ACAO_APARELHO = "AVISO_APARELHO";
const ACAO_APARELHO_FIM = "AVISO_APARELHO_REMOVIDO";
const ACAO_VAPID = "AVISO_VAPID";
const ACAO_PUSH = "FALTAS_PUSH";                   // chave semana|área: { tipo, enviados, falhas }
const TTL_SEGUNDOS = 24 * 3600;                    // celular desligado: ainda chega se ligar em até 24 h
const SERVICOS_PUSH = ["fcm.googleapis.com", "android.googleapis.com", "googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
const URL_COMUNICADO = "/?pg=faltassup&aba=COMUNICADO";

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
const ev = (ator, acao, chave, depois, antes) => ({ ator: ator || "sistema", acao, entidade: ENTIDADE, chave: String(chave), antes: antes || null, depois: depois || null });
const resumoEndereco = ep => "ap|" + crypto.createHash("sha256").update(String(ep)).digest("hex").slice(0, 32);
const dm = d => String(d).slice(8, 10) + "/" + String(d).slice(5, 7);

// só endereços dos serviços de push conhecidos: ninguém faz o servidor chamar um endereço qualquer
function endpointValido(e) {
  try {
    const u = new URL(String(e));
    return u.protocol === "https:" && SERVICOS_PUSH.some(h => u.hostname === h || u.hostname.endsWith("." + h)) && String(e).length <= 600;
  } catch (x) { return false; }
}

// ── chaves VAPID ────────────────────────────────────────────────────────────
const SUBJECT = () => process.env.VAPID_SUBJECT || "https://gruposervcamp.com.br";
async function vapid(db) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, subject: SUBJECT() };
  const ler = async () => (await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_VAPID}&order=id.asc&limit=1`))[0];
  let e = await ler();
  if (!e) {
    const k = require("web-push").generateVAPIDKeys();
    await db.inserir("fm_auditoria", [ev("sistema", ACAO_VAPID, "vapid", { pub: k.publicKey, priv: k.privateKey })]);
    e = await ler(); // duas chamadas ao mesmo tempo: vale a primeira gravada
  }
  return { pub: e.depois.pub, priv: e.depois.priv, subject: SUBJECT() };
}

// ── aparelhos ───────────────────────────────────────────────────────────────
async function lerAparelhos(db) {
  const lista = await db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${ACAO_APARELHO},${ACAO_APARELHO_FIM})&order=id.asc`);
  const m = new Map();
  lista.forEach(e => m.set(e.chave, e));
  return [...m.values()].filter(e => e.acao === ACAO_APARELHO && e.depois).map(e => ({ id: e.chave, ...e.depois }));
}

async function verChave({ res, db }) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ ok: true, chave: (await vapid(db)).pub });
}
async function inscrever({ res, db, ator, body }) {
  if (!endpointValido(body.endpoint)) return erro(res, 400, "Endereço de notificação não reconhecido.", "ENDPOINT_INVALIDO");
  const k = body.keys || {};
  if (typeof k.p256dh !== "string" || typeof k.auth !== "string" || k.p256dh.length > 200 || k.auth.length > 80) return erro(res, 400, "Chaves da notificação inválidas.", "CHAVES_INVALIDAS");
  await db.inserir("fm_auditoria", [ev(ator, ACAO_APARELHO, resumoEndereco(body.endpoint), { user_key: ator, endpoint: body.endpoint, p256dh: k.p256dh, auth: k.auth, agente: String(body.agente || "").slice(0, 200) || null })]);
  return res.status(200).json({ ok: true });
}
async function remover({ res, db, ator, body }) {
  const meus = (await lerAparelhos(db)).filter(a => a.user_key === ator && (!body.endpoint || a.endpoint === String(body.endpoint)));
  if (meus.length) await db.inserir("fm_auditoria", meus.map(a => ev(ator, ACAO_APARELHO_FIM, a.id, null, { user_key: ator })));
  return res.status(200).json({ ok: true, removidos: meus.length });
}

// ── envio ───────────────────────────────────────────────────────────────────
let enviador = null; // os testes trocam por uma função que só anota
function definirEnviador(fn) { const antes = enviador; enviador = fn; return antes; }
async function mandar(db, aparelho, corpo, v) {
  if (enviador) return enviador(aparelho, corpo);
  try {
    await require("web-push").sendNotification({ endpoint: aparelho.endpoint, keys: { p256dh: aparelho.p256dh, auth: aparelho.auth } }, JSON.stringify(corpo),
      { TTL: TTL_SEGUNDOS, urgency: "high", vapidDetails: { subject: v.subject, publicKey: v.pub, privateKey: v.priv }, timeout: 10000 });
    return { ok: true };
  } catch (e) { return { ok: false, status: e && e.statusCode }; }
}

const TEXTOS = {
  COMUNICADO: p => ({ titulo: "Comunicado semanal de faltas injustificadas", corpo: `Semana de ${dm(p.inicio)} a ${dm(p.fim)}. Toque para abrir.` }),
  LEMBRETE: p => ({ titulo: "Comunicado semanal ainda não aberto", corpo: `Semana de ${dm(p.inicio)} a ${dm(p.fim)}. Toque para abrir.` })
};

// Manda para os aparelhos do supervisor da área. Uma vez por semana, área e tipo: devolve { enviados, falhas, jaEnviado }.
async function enviarParaArea(db, p) {
  const chave = `${p.semana}|${p.area}`;
  const feitos = await db.listar(`fm_auditoria?select=id,depois&acao=eq.${ACAO_PUSH}&chave=eq.${encodeURIComponent(chave)}`);
  if (feitos.some(e => e.depois && e.depois.tipo === p.tipo)) return { enviados: 0, falhas: 0, jaEnviado: true };
  const alvos = (await lerAparelhos(db)).filter(a => MD.SUPERVISORES.has(a.user_key) && MD.daArea(a.user_key, p.nome));
  const v = enviador ? null : await vapid(db);
  const t = TEXTOS[p.tipo](p), corpo = { titulo: t.titulo, corpo: t.corpo, tipo: p.tipo, tag: "comunicado-" + p.semana, url: URL_COMUNICADO };
  let enviados = 0, falhas = 0;
  for (const a of alvos) {
    const r = await mandar(db, a, corpo, v);
    if (r && r.ok) enviados++;
    else {
      falhas++;
      // aparelho que o serviço de push diz que não existe mais sai da lista
      if (r && (r.status === 404 || r.status === 410)) await db.inserir("fm_auditoria", [ev("sistema", ACAO_APARELHO_FIM, a.id, null, { user_key: a.user_key, motivo: "servico_" + r.status })]);
    }
  }
  // sem aparelho nenhum cadastrado não grava: assim que alguém autorizar, o próximo envio já vale
  if (alvos.length) await db.inserir("fm_auditoria", [ev(p.ator, ACAO_PUSH, chave, { tipo: p.tipo, enviados, falhas, aparelhos: alvos.length })]);
  return { enviados, falhas, jaEnviado: false, aparelhos: alvos.length };
}

module.exports = { ACAO_PUSH, ACAO_APARELHO, ACAO_APARELHO_FIM, URL_COMUNICADO, endpointValido, vapid, lerAparelhos, verChave, inscrever, remover, enviarParaArea, definirEnviador };
