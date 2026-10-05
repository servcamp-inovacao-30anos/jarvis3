// api/_auth.js — autenticação das APIs por token assinado (HMAC-SHA256).
// Arquivo com prefixo "_" → NÃO vira rota na Vercel; é só importado.
//
// Com AUTH_SECRET definida, as APIs EXIGEM token válido (o login o emite e o
// front o envia em toda chamada). O modo "graça" (ninguém é bloqueado) só vale
// sem AUTH_SECRET — aí o login nem tem como emitir token — ou com
// AUTH_ENFORCE=0, a chave de emergência para desligar a exigência sem deploy.
// (Antes era o contrário: só exigia com AUTH_ENFORCE=1, e essa variável nunca
// foi ligada na Vercel — as APIs ficaram abertas a quem soubesse o endereço.)

const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

// Emite um token {u: userKey, exp: epoch_ms}. Validade padrão: 12h.
// "extra" acrescenta campos ao token; com {s: "xl"} ele vira uma chave de ESCOPO RESTRITO:
// só vale na rota que pedir esse escopo (veja requireAuth) e é recusado em todas as outras.
function sign(userKey, secret, horas, extra) {
  const payload = Object.assign({ u: String(userKey), exp: Date.now() + (horas || 12) * 3600000 }, extra || {});
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return body + "." + sig;
}

function verify(token, secret) {
  if (!token || String(token).indexOf(".") < 0) return null;
  const parts = String(token).split(".");
  const body = parts[0], sig = parts[1] || "";
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  // comparação em tempo constante (evita timing attack)
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(unb64url(body).toString("utf8")); } catch (e) { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}

function tokenFrom(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  return h.indexOf("Bearer ") === 0 ? h.slice(7) : "";
}

// Guard usado no topo de cada endpoint protegido.
// Retorna { ok:true } quando pode seguir; { ok:false } quando deve bloquear (401).
// Em modo graça (sem AUTH_SECRET, ou AUTH_ENFORCE=0) SEMPRE deixa passar.
// escopo: nome do escopo que esta rota aceita (só as rotas de chave restrita passam isto).
// daQuery: aceita o token também em ?k= (o Excel não manda cabeçalho; a chave vai no endereço).
function requireAuth(req, escopo, daQuery) {
  const secret = process.env.AUTH_SECRET;
  const enforce = process.env.AUTH_ENFORCE !== "0";
  if (!enforce || !secret) return { ok: true, user: null, enforced: false };
  let t = tokenFrom(req);
  if (!t && daQuery && req.query && req.query.k) t = String(req.query.k);
  const p = verify(t, secret);
  if (!p) return { ok: false, enforced: true };
  // chave de escopo restrito (ex.: a do Excel) não serve em nenhuma outra rota
  if (p.s && p.s !== escopo) return { ok: false, enforced: true };
  return { ok: true, user: p, enforced: true };
}

module.exports = { sign, verify, tokenFrom, requireAuth };
