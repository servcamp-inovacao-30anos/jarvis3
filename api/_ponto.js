// api/_ponto.js — backend do monitoramento de marcações de ponto.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=ponto: o plano Hobby da Vercel permite 12 funções e já estamos nas 12.
//   /api/rh?modulo=ponto&t=contatos   (GET lista · POST carga)
//
// As regras moram em _ponto_regras.js (puras, testadas). Aqui fica só o que
// fala com o mundo: banco, autorização e o formato das respostas.

const R = require("./_ponto_regras");
const _auth = require("./_auth");

// Quem pode aprovar, enviar e mexer na base de contatos. A checagem é AQUI, no
// servidor: esconder o botão no front é conveniência, não segurança.
const APROVADORES = new Set([]);

function usuarioDoToken(req) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const p = _auth.verify(_auth.tokenFrom(req), secret);
  return p && p.u ? String(p.u) : null;
}

function erro(res, status, mensagem, codigo, detalhe) {
  const corpo = { error: mensagem, codigo };
  if (detalhe) corpo.details = detalhe;
  return res.status(status).json(corpo);
}

function emLotes(lista, tamanho) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

function conectar() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const base = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function chamar(caminho, init) {
    const r = await fetch(`${url}/rest/v1/${caminho}`, { ...init, headers: { ...base, ...((init && init.headers) || {}) } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Supabase ${r.status}: ${t.slice(0, 300)}`);
    }
    return r;
  }
  return {
    // O PostgREST devolve no máximo 1000 linhas por chamada: pagina até o fim.
    // O caminho precisa trazer "order=", senão as páginas podem se sobrepor.
    async listar(caminho) {
      const PAGINA = 1000;
      let todos = [];
      for (let offset = 0; offset <= 50000; offset += PAGINA) {
        const r = await chamar(`${caminho}${caminho.includes("?") ? "&" : "?"}limit=${PAGINA}&offset=${offset}`);
        const pag = await r.json();
        todos = todos.concat(pag);
        if (pag.length < PAGINA) break;
      }
      return todos;
    },
    async upsert(tabela, linhas, conflito) {
      for (const lote of emLotes(linhas, 500)) {
        await chamar(`${tabela}?on_conflict=${conflito}`, {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(lote)
        });
      }
    },
    async inserir(tabela, linhas) {
      for (const lote of emLotes(linhas, 500)) {
        await chamar(tabela, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lote) });
      }
    }
  };
}

// ── contatos ────────────────────────────────────────────────────────────────

async function listarContatos({ res, db }) {
  const linhas = await db.listar("pt_contatos?select=re,nome_cadastro,telefone_e164,tipo_telefone,enviavel,data_base,atualizado_em&order=re.asc");
  const porTipo = {};
  let enviaveis = 0, ultima = null;
  linhas.forEach(c => {
    const tp = c.tipo_telefone || "SEM_TIPO";
    porTipo[tp] = (porTipo[tp] || 0) + 1;
    if (c.enviavel) enviaveis++;
    if (c.atualizado_em && (!ultima || c.atualizado_em > ultima)) ultima = c.atualizado_em;
  });
  return res.status(200).json({
    ok: true, total: linhas.length, enviaveis, nao_enviaveis: linhas.length - enviaveis,
    por_tipo: porTipo, atualizado_em: ultima, linhas
  });
}

// POST { linhas: [...], confirmar: false } → só o resumo, nada é gravado.
// POST { linhas: [...], confirmar: true  } → grava e devolve o mesmo resumo.
async function carregarContatos({ res, db, ator, body }) {
  const linhas = Array.isArray(body.linhas) ? body.linhas : null;
  if (!linhas || !linhas.length) return erro(res, 400, "Envie as linhas da base de contatos.", "SEM_LINHAS");
  if (linhas.length > 20000) return erro(res, 413, "Base grande demais (limite de 20.000 linhas).", "BASE_GRANDE");

  const existentes = await db.listar(`pt_contatos?select=${R.CAMPOS_CONTATO.join(",")}&order=re.asc`);
  const plano = R.planejarContatos(existentes, linhas, { ator, agora: new Date().toISOString() });
  const resposta = { ok: true, gravado: false, resumo: plano.resumo, rejeitadas: plano.rejeitadas.slice(0, 50) };
  if (!body.confirmar) return res.status(200).json(resposta);

  // A auditoria do telefone antigo vai ANTES da sobrescrita: se a gravação
  // falhar no meio, o número anterior não se perde.
  await db.inserir("pt_auditoria", plano.auditorias);
  await db.upsert("pt_contatos", plano.upserts, "re");
  await db.inserir("pt_auditoria", [{
    ator, acao: "CONTATOS_CARREGADOS", entidade: "pt_contatos", entidade_id: null, antes: null, depois: plano.resumo
  }]);
  resposta.gravado = true;
  return res.status(200).json(resposta);
}

// ── roteamento ──────────────────────────────────────────────────────────────

const ROTAS = {
  "GET contatos": { aprovador: true, fn: listarContatos },
  "POST contatos": { aprovador: true, fn: carregarContatos }
};

module.exports = async function ponto(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");

  const ator = usuarioDoToken(req);
  if (rota.aprovador && !(ator && APROVADORES.has(ator))) {
    return erro(res, 403, "Ação restrita aos aprovadores do monitoramento de ponto.", "NAO_AUTORIZADO");
  }

  const db = conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  try {
    return await rota.fn({ req, res, db, ator, body });
  } catch (e) {
    return erro(res, 502, "Falha ao falar com o banco.", "FALHA_BANCO", String((e && e.message) || e).slice(0, 300));
  }
};

module.exports.APROVADORES = APROVADORES;
