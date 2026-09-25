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
    const m = String(v).match(/^(not\.)?(eq|gte|lte|gt|lt|in|is)\.(.*)$/);
    if (!m) continue;
    const [, nao, op, val] = m;
    const passa = l => {
      const x = l[k] == null ? null : String(l[k]);
      if (op === "is") return val === "null" ? x == null : x === val;
      if (x == null) return false;
      if (op === "eq") return x === val;
      if (op === "gte") return x >= val;
      if (op === "lte") return x <= val;
      if (op === "gt") return x > val;
      if (op === "lt") return x < val;
      return val.replace(/^\(|\)$/g, "").split(",").includes(x);
    };
    out = out.filter(l => (nao ? !passa(l) : passa(l)));
  }
  return out;
}

// select=a,b,apelido:coluna->chave — como o PostgREST, devolve só o pedido.
function projetar(linha, select) {
  if (!select || select.trim() === "*") return linha;
  const out = {};
  for (const item of select.split(",")) {
    const m = item.trim().match(/^(?:([a-z0-9_]+):)?([a-z0-9_]+)(?:->>?([a-z0-9_]+))?$/i);
    if (!m) continue;
    const [, apelido, col, chave] = m;
    const v = chave ? (linha[col] == null ? null : linha[col][chave]) : linha[col];
    out[apelido || chave || col] = v === undefined ? null : v;
  }
  return out;
}

function comparar(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function ordenar(linhas, order) {
  if (!order) return linhas;
  const chaves = order.split(",").map(p => { const [col, dir] = p.split("."); return { col, desc: dir === "desc" }; });
  return [...linhas].sort((a, b) => {
    for (const { col, desc } of chaves) { const c = comparar(a[col], b[col]); if (c) return desc ? -c : c; }
    return 0;
  });
}

// As funções SQL do supabase_schema.sql, com a mesma regra.
function rpc(tabelas, nome, a) {
  const uso = (tabelas.pt_sms_uso = tabelas.pt_sms_uso || []);
  const dia = String(a.p_dia || "").slice(0, 10), ref = dia.slice(0, 7);
  if (nome === "pt_reservar_segmentos") {
    let l = uso.find(x => String(x.dia).slice(0, 10) === dia);
    if (!l) { l = { id: uso.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1, dia, mes_referencia: ref, segmentos_dia: 0, segmentos_mes: 0 }; uso.push(l); }
    const mes = uso.filter(x => String(x.mes_referencia || String(x.dia).slice(0, 7)) === ref).reduce((t, x) => t + (Number(x.segmentos_dia) || 0), 0);
    if (l.segmentos_dia + a.p_segmentos > a.p_limite_dia || mes + a.p_segmentos > a.p_limite_mes) return false;
    l.segmentos_dia += a.p_segmentos;
    l.segmentos_mes = mes + a.p_segmentos;
    return true;
  }
  if (nome === "pt_devolver_segmentos") {
    const l = uso.find(x => String(x.dia).slice(0, 10) === dia);
    if (l) { l.segmentos_dia = Math.max(0, l.segmentos_dia - a.p_segmentos); l.segmentos_mes = Math.max(0, (l.segmentos_mes || 0) - a.p_segmentos); }
    return null;
  }
  return null;
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
    if (caminho.startsWith("rpc/")) return resposta(200, rpc(tabelas, caminho.slice(4), corpo || {}));
    const t = (tabelas[caminho] = tabelas[caminho] || []);

    if (metodo === "GET") {
      const linhas = ordenar(filtrar(t, u.searchParams), u.searchParams.get("order"));
      const off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
      const sel = u.searchParams.get("select");
      return resposta(200, linhas.slice(off, off + lim).map(l => JSON.parse(JSON.stringify(projetar(l, sel)))));
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
      const alvo = filtrar(t, u.searchParams);
      alvo.forEach(x => Object.assign(x, JSON.parse(JSON.stringify(corpo))));
      return resposta(200, prefer.includes("return=representation") ? alvo.map(x => JSON.parse(JSON.stringify(x))) : null);
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
