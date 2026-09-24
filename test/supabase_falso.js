// Supabase de mentira para os testes: responde, em memória, às poucas formas
// de chamada PostgREST que api/users.js faz em app_users. Não é um PostgREST
// completo — só o suficiente para exercitar a API sem tocar no banco real.
//
//   const sb = new SupabaseFalso("https://falso.supabase.co");
//   global.fetch = sb.fetch;          // a API usa o fetch global
//   sb.linhas.get("testejoao")         // conferir o que foi gravado
//   sb.falhar = (metodo, url) => 500   // simular o banco fora do ar

class SupabaseFalso {
  constructor(base) {
    this.base = base;
    this.linhas = new Map();   // user_key → linha
    this.chamadas = [];        // { metodo, url, corpo } de cada requisição
    this.falhar = null;
    this.fetch = this.fetch.bind(this);
  }

  semear(userKey, campos) {
    this.linhas.set(userKey, { user_key: userKey, custom_password: null, must_change: null, ...campos });
  }

  async fetch(url, opt = {}) {
    const metodo = (opt.method || "GET").toUpperCase();
    this.chamadas.push({ metodo, url: String(url), corpo: opt.body || null });
    const u = new URL(url);
    if (u.origin !== this.base || u.pathname !== "/rest/v1/app_users") {
      return resposta(404, { message: "rota desconhecida no Supabase falso: " + u.pathname });
    }
    const st = this.falhar && this.falhar(metodo, String(url));
    if (st) return resposta(st, { message: "falha simulada" });

    const filtros = [];
    let select = null;
    for (const [k, v] of u.searchParams) {
      if (k === "select") select = v.split(",");
      else filtros.push([k, v]);
    }
    const casa = linha => filtros.every(([col, expr]) => confere(linha[col], expr));

    if (metodo === "GET") {
      const rows = [...this.linhas.values()].filter(casa).map(l => {
        if (!select) return { ...l };
        const o = {};
        select.forEach(c => { o[c] = c in l ? l[c] : null; });
        return o;
      });
      return resposta(200, rows);
    }
    const corpo = JSON.parse(opt.body || "{}");
    if (metodo === "POST") {
      const prefer = String(new Headers(opt.headers || {}).get("Prefer") || "");
      for (const item of [].concat(corpo)) {
        const atual = this.linhas.get(item.user_key);
        if (atual && prefer.indexOf("resolution=merge-duplicates") < 0) return resposta(409, { message: "duplicate key" });
        this.linhas.set(item.user_key, atual ? { ...atual, ...item } : { custom_password: null, must_change: null, ...item });
      }
      return resposta(201, null);
    }
    if (metodo === "PATCH") {
      for (const l of this.linhas.values()) if (casa(l)) Object.assign(l, corpo);
      return resposta(204, null);
    }
    return resposta(405, { message: "método não suportado no Supabase falso" });
  }
}

// Filtros PostgREST usados pela API: eq.X, is.null e not.like.prefixo*
function confere(valor, expr) {
  let neg = false;
  if (expr.indexOf("not.") === 0) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf(".");
  const op = expr.slice(0, i), arg = expr.slice(i + 1);
  let r;
  if (op === "eq") r = valor != null && String(valor) === arg;
  else if (op === "is") r = arg === "null" ? valor == null : false;
  else if (op === "like") {
    if (valor == null) return false;   // NULL não casa com LIKE nem com NOT LIKE
    const re = new RegExp("^" + arg.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    r = re.test(String(valor));
  } else throw new Error("filtro não suportado no Supabase falso: " + expr);
  return neg ? !r : r;
}

function resposta(status, dados) {
  if (dados === null) return new Response(null, { status });
  return new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
}

module.exports = { SupabaseFalso };
