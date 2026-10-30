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

// Bloqueado pela tela de Configurações (app_users.ativo = false): o token de sessão
// e as chaves do Excel dele deixam de valer em TODAS as rotas, e não só na tela.
// requireAuth é síncrono e não lê o banco; por isso esta conferência vem logo depois
// dele em cada rota. Cache de 30 s por instância, para não ler o banco a cada chamada.
// Se o banco falhar, vale o último estado conhecido (sem ele, deixa passar): um
// soluço do Supabase não pode derrubar o painel de todo mundo.
const _cacheAtivo = new Map(); // userKey -> { bloq, em }
const CACHE_ATIVO_MS = 30000;
async function estaBloqueado(userKey) {
  if (!userKey) return false;
  const c = _cacheAtivo.get(userKey);
  if (c && Date.now() - c.em < CACHE_ATIVO_MS) return c.bloq;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url}/rest/v1/app_users?user_key=eq.${encodeURIComponent(userKey)}&select=user_key,ativo`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error("app_users " + r.status);
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows.find(x => x && x.user_key === userKey) : null;
    const bloq = !!(row && row.ativo === false);
    _cacheAtivo.set(userKey, { bloq, em: Date.now() });
    return bloq;
  } catch (e) {
    console.error("auth: não consegui conferir o bloqueio de", userKey, e.message);
    return c ? c.bloq : false;
  }
}
// Uso: if (await _auth.recusarSeBloqueado(req, res, _ga)) return;
async function recusarSeBloqueado(req, res, ga) {
  const u = ga && ga.user && ga.user.u;
  if (!u || !(await estaBloqueado(u))) return false;
  res.status(401).json({ error: "Acesso bloqueado.", bloqueado: true });
  return true;
}
// set_active chama ao bloquear/liberar: nesta instância vale na hora (nas outras, em até 30 s)
function esquecerBloqueio(userKey) { if (userKey) _cacheAtivo.delete(userKey); else _cacheAtivo.clear(); }

module.exports = { sign, verify, tokenFrom, requireAuth, estaBloqueado, recusarSeBloqueado, esquecerBloqueio };
