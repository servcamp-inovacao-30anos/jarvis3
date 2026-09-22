// Supabase falso em memória para os testes: entende o pedaço do PostgREST que
// o módulo de ponto usa (filtros eq/gte/lte/in/is, order, limit/offset,
// on_conflict com ignore/merge, return=representation, PATCH e rpc).
// Nada sai da máquina. O prefixo "_" deixa este arquivo fora do "npm test".

function resposta(status, corpo) {
  return { ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

const PARAMS_DE_CONTROLE = new Set(["select", "order", "limit", "offset", "on_conflict"]);

function filtrar(linhas, params) {
  let out = linhas;
  for (const [k, v] of params) {
    if (PARAMS_DE_CONTROLE.has(k)) continue;
    const m = String(v).match(/^(eq|gte|lte|gt|lt|in|is)\.(.*)$/);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter(l => {
      const x = l[k] == null ? null : String(l[k]);
      if (op === "is") return val === "null" ? x == null : x === val;
      if (x == null) return false;
      if (op === "eq") return x === val;
      if (op === "gte") return x >= val;
      if (op === "lte") return x <= val;
      if (op === "gt") return x > val;
      if (op === "lt") return x < val;
      return val.replace(/^\(|\)$/g, "").split(",").includes(x);
    });
  }
  return out;
}

function supabaseFalso(tabelas, opcoes) {
  const o = opcoes || {};
  const log = [];
  const COM_ID = new Set(["pt_ocorrencias", "pt_mensagens", "pt_competencias", "pt_auditoria", "pt_sms_uso", "dashboard_snapshots"]);
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const caminho = u.pathname.replace("/rest/v1/", "");
    const metodo = init.method || "GET";
    const corpo = init.body ? JSON.parse(init.body) : null;
    const h = init.headers || {};
    const prefer = String(h.Prefer || h.prefer || "");
    log.push({ metodo, tabela: caminho, corpo, query: u.search });
    if (o.falhar && o.falhar(metodo, caminho)) return resposta(500, { message: "falha simulada" });
    if (caminho.startsWith("rpc/")) return resposta(200, null);
    const t = (tabelas[caminho] = tabelas[caminho] || []);

    if (metodo === "GET") {
      let linhas = filtrar(t, u.searchParams);
      const ord = u.searchParams.get("order");
      if (ord) {
        const [col, dir] = ord.split(".");
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        linhas = [...linhas].sort((a, b) => cmp(String(a[col]), String(b[col])) * (dir === "desc" ? -1 : 1));
      }
      const off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
      return resposta(200, linhas.slice(off, off + lim).map(l => JSON.parse(JSON.stringify(l))));
    }
    if (metodo === "POST") {
      const conflito = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
      const ignorar = prefer.includes("ignore-duplicates");
      const volta = [];
      for (const l of Array.isArray(corpo) ? corpo : [corpo]) {
        const i = conflito.length ? t.findIndex(x => conflito.every(c => String(x[c]) === String(l[c]))) : -1;
        if (i >= 0) {
          if (!ignorar) { t[i] = { ...t[i], ...l }; volta.push({ ...t[i] }); }
          continue;
        }
        const nova = JSON.parse(JSON.stringify(l));
        if (COM_ID.has(caminho) && nova.id == null) nova.id = t.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
        if (caminho === "dashboard_snapshots" && !nova.created_at) nova.created_at = new Date(Date.now() + t.length).toISOString();
        t.push(nova);
        volta.push(JSON.parse(JSON.stringify(nova)));
      }
      return resposta(201, prefer.includes("return=representation") ? volta : null);
    }
    if (metodo === "PATCH") {
      filtrar(t, u.searchParams).forEach(x => Object.assign(x, JSON.parse(JSON.stringify(corpo))));
      return resposta(200, null);
    }
    return resposta(405, { message: "método não suportado no falso" });
  };
  return log;
}

// Chama um handler da Vercel com req/res de mentira. "usuario" gera um token
// assinado com o AUTH_SECRET do teste, como o login faria.
function chamar(handler, { method = "GET", query = {}, body, usuario, headers = {} } = {}) {
  const _auth = require("../api/_auth");
  const h = { ...headers };
  if (usuario) h.authorization = "Bearer " + _auth.sign(usuario, process.env.AUTH_SECRET, 1);
  const req = { method, query, body, headers: h };
  const res = {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader() {}
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}

module.exports = { supabaseFalso, resposta, chamar };
