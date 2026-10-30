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
// "iat" (quando foi emitido) permite encerrar de uma vez todas as sessões antigas de alguém
// (sair de todos os aparelhos, troca ou redefinição de senha): veja sessaoValida.
function sign(userKey, secret, horas, extra) {
  const agora = Date.now();
  const payload = Object.assign({ u: String(userKey), iat: agora, exp: agora + (horas || 12) * 3600000 }, extra || {});
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

// Estado do acesso de um usuário: bloqueado na tela de Configurações (app_users.ativo = false)
// e quando ele mandou encerrar todas as sessões (evento SESSAO_REVOGADA na fm_auditoria).
// O token de sessão e as chaves do Excel de quem está bloqueado deixam de valer em TODAS as rotas,
// e não só na tela. requireAuth é síncrono e não lê o banco; por isso esta conferência vem logo
// depois dele em cada rota. Cache de 30 s por instância, para não ler o banco a cada chamada.
// Se o banco falhar, vale o último estado conhecido (sem ele, deixa passar): um
// soluço do Supabase não pode derrubar o painel de todo mundo.
const _cacheAtivo = new Map(); // userKey -> { bloq, revogadaEm, em }
const CACHE_ATIVO_MS = 30000;
const ACAO_SESSAO_REVOGADA = "SESSAO_REVOGADA";
async function estadoDoAcesso(userKey) {
  const vazio = { bloq: false, revogadaEm: 0 };
  if (!userKey) return vazio;
  const c = _cacheAtivo.get(userKey);
  if (c && Date.now() - c.em < CACHE_ATIVO_MS) return c;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return vazio;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const [bloq, revogadaEm] = await Promise.all([
    (async () => {
      try {
        const r = await fetch(`${url}/rest/v1/app_users?user_key=eq.${encodeURIComponent(userKey)}&select=user_key,ativo`, { headers: h });
        if (!r.ok) throw new Error("app_users " + r.status);
        const rows = await r.json();
        const row = Array.isArray(rows) ? rows.find(x => x && x.user_key === userKey) : null;
        return !!(row && row.ativo === false);
      } catch (e) {
        console.error("auth: não consegui conferir o bloqueio de", userKey, e.message);
        return c ? c.bloq : false;
      }
    })(),
    (async () => {
      try {
        const r = await fetch(`${url}/rest/v1/fm_auditoria?select=depois&acao=eq.${ACAO_SESSAO_REVOGADA}&chave=eq.${encodeURIComponent(userKey)}&order=id.desc&limit=1`, { headers: h });
        if (!r.ok) throw new Error("fm_auditoria " + r.status);
        const rows = await r.json();
        return Number(rows && rows[0] && rows[0].depois && rows[0].depois.em) || 0;
      } catch (e) {
        console.error("auth: não consegui conferir o encerramento de sessões de", userKey, e.message);
        return c ? c.revogadaEm : 0;
      }
    })()
  ]);
  const novo = { bloq, revogadaEm, em: Date.now() };
  _cacheAtivo.set(userKey, novo);
  return novo;
}
async function estaBloqueado(userKey) { return (await estadoDoAcesso(userKey)).bloq; }

// A sessão ainda vale? Falha se o acesso foi bloqueado ou se foi encerrada depois de emitida.
// Chave de escopo restrito (a do Excel) não é sessão de aparelho: só o bloqueio a derruba.
// Token sem "iat" (de antes desta regra) vive no máximo 12 h e não é atingido pelo encerramento.
async function sessaoValida(user) {
  const u = user && user.u;
  if (!u) return { ok: true };
  const e = await estadoDoAcesso(u);
  if (e.bloq) return { ok: false, bloqueado: true };
  if (!user.s && user.iat && user.iat < e.revogadaEm) return { ok: false, encerrada: true };
  return { ok: true };
}
// Uso: if (await _auth.recusarSeBloqueado(req, res, _ga)) return;
async function recusarSeBloqueado(req, res, ga) {
  const v = await sessaoValida(ga && ga.user);
  if (v.ok) return false;
  if (v.bloqueado) res.status(401).json({ error: "Acesso bloqueado.", bloqueado: true });
  else res.status(401).json({ error: "Sessão encerrada. Entre de novo.", encerrada: true });
  return true;
}
// Encerra TODAS as sessões emitidas até agora para este usuário (os outros aparelhos pedem login de novo).
// Lança se não conseguir gravar: quem pediu precisa saber que não valeu.
async function revogarSessoes(userKey, ator) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userKey) throw new Error("sem banco para registrar o encerramento");
  const r = await fetch(`${url}/rest/v1/fm_auditoria`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify([{ ator: ator || userKey, acao: ACAO_SESSAO_REVOGADA, entidade: "sessao", chave: String(userKey), antes: null, depois: { em: Date.now() } }])
  });
  if (!r.ok) throw new Error("fm_auditoria " + r.status);
  _cacheAtivo.delete(userKey);
}
// set_active chama ao bloquear/liberar: nesta instância vale na hora (nas outras, em até 30 s)
function esquecerBloqueio(userKey) { if (userKey) _cacheAtivo.delete(userKey); else _cacheAtivo.clear(); }

module.exports = { sign, verify, tokenFrom, requireAuth, estaBloqueado, estadoDoAcesso, sessaoValida, recusarSeBloqueado, revogarSessoes, esquecerBloqueio, ACAO_SESSAO_REVOGADA };
