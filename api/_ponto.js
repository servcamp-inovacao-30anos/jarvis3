// api/_ponto.js — backend do monitoramento de marcações de ponto.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=ponto: o plano Hobby da Vercel permite 12 funções e já estamos nas 12.
//   /api/rh?modulo=ponto&t=contatos    (GET lista · POST carga)
//   /api/rh?modulo=ponto&t=processar   (POST reprocessa a última planilha)
// E o api/import.js chama materializar() a cada planilha recebida.
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
    async obter(caminho) {
      const r = await chamar(caminho);
      return r.json();
    },
    // ignorar: linha que já existe fica como está (ON CONFLICT DO NOTHING).
    // Sem ignorar, os campos enviados sobrescrevem os da linha existente.
    async upsert(tabela, linhas, conflito, opcoes) {
      const o = opcoes || {};
      const prefer = `resolution=${o.ignorar ? "ignore" : "merge"}-duplicates,return=${o.retornar ? "representation" : "minimal"}`;
      let volta = [];
      for (const lote of emLotes(linhas, 500)) {
        const r = await chamar(`${tabela}?on_conflict=${conflito}`, { method: "POST", headers: { Prefer: prefer }, body: JSON.stringify(lote) });
        if (o.retornar) volta = volta.concat(await r.json());
      }
      return volta;
    },
    async inserir(tabela, linhas) {
      for (const lote of emLotes(linhas, 500)) {
        await chamar(tabela, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lote) });
      }
    },
    async atualizar(caminho, patch) {
      await chamar(caminho, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    }
  };
}

// ── materialização das ocorrências ──────────────────────────────────────────
// Chamada pelo api/import.js a cada planilha. O snapshot é substituído a cada
// importação e a janela da exportação (~20 dias) é mais curta que a competência
// (26 a 25): recalcular depois a partir dele perderia os primeiros dias. Por
// isso as ocorrências vão para tabela própria no momento em que chegam.
//
// Nenhum SMS é enviado aqui. Jamais.
const CAMPOS_OCORRENCIA_LIDOS = "id,re,nome,data_jornada,tipo,horario_previsto,horario_marcado,diferenca_minutos,reconciliacao,is_test,chave_dedup";

async function materializar(data, opcoes) {
  const o = opcoes || {};
  const db = o.db || conectar();
  if (!db) return { ok: false, motivo: "CONFIG_AUSENTE" };
  const ator = o.ator || null;
  const cfg = R.lerConfig(await db.listar("pt_config?select=chave,valor&order=chave.asc"));
  const { normNome } = require("./_parse");
  const det = R.detectarOcorrencias(data && data.hrextra, data && data.ativos, {
    tolerancia: cfg.tolerancia_minutos, dataVirada: cfg.data_virada, normNome
  });
  const resultado = { ok: true, ativo: det.ativo, stats: det.stats, ocorrencias_novas: 0, mensagens_novas: 0, mensagens_atualizadas: 0 };
  if (!det.ativo) return resultado;

  if (det.ocorrencias.length) {
    await db.upsert("pt_competencias", R.competenciasNecessarias(det.ocorrencias, cfg.data_virada), "data_inicio,data_fim", { ignorar: true });
    const comps = await db.listar("pt_competencias?select=id,data_inicio&order=id.asc");
    const compId = new Map(comps.map(c => [String(c.data_inicio).slice(0, 10), c.id]));

    const datas = det.ocorrencias.map(x => x.data_jornada).sort();
    const janela = `data_jornada=gte.${datas[0]}&data_jornada=lte.${datas[datas.length - 1]}&is_test=eq.false`;
    const existentes = await db.listar(`pt_ocorrencias?select=${CAMPOS_OCORRENCIA_LIDOS}&${janela}&order=id.asc`);
    const jaGravadas = new Set(existentes.map(x => x.chave_dedup));
    const novas = det.ocorrencias
      .filter(x => !jaGravadas.has(x.chave_dedup))
      .map(x => ({ ...x, competencia_id: compId.get(R.competenciaDe(x.data_jornada).inicio) || null }));
    const inseridas = await db.upsert("pt_ocorrencias", novas, "chave_dedup", { ignorar: true, retornar: true });
    resultado.ocorrencias_novas = inseridas.length;
    await db.inserir("pt_auditoria", inseridas.map(x => ({
      ator, acao: "OCORRENCIA_CRIADA", entidade: "pt_ocorrencias", entidade_id: x.id, antes: null,
      depois: { re: x.re, data_jornada: x.data_jornada, tipo: x.tipo, diferenca_minutos: x.diferenca_minutos, reconciliacao: x.reconciliacao }
    })));

    const contatos = await db.listar("pt_contatos?select=re,telefone_e164,tipo_telefone,enviavel&order=re.asc");
    const mensagens = await db.listar(`pt_mensagens?select=id,re,data_jornada,ocorrencia_ids,status,editado_em,telefone_e164,motivo_bloqueio,texto_gerado,template_id&${janela}&order=id.asc`);
    const plano = R.planejarMensagens(existentes.concat(inseridas), {
      contatosPorRE: new Map(contatos.map(c => [String(c.re), c])),
      existentes: new Map(mensagens.map(m => [`${m.re}|${String(m.data_jornada).slice(0, 10)}`, m])),
      modelos: cfg.modelos
    });
    await db.upsert("pt_mensagens", plano.inserir, "re,data_jornada,is_test", { ignorar: true });
    for (const a of plano.atualizar) await db.atualizar(`pt_mensagens?id=eq.${a.id}`, a.patch);
    resultado.mensagens_novas = plano.inserir.length;
    resultado.mensagens_atualizadas = plano.atualizar.length;
  }

  await db.inserir("pt_auditoria", [{
    ator, acao: "IMPORTACAO_PROCESSADA", entidade: "pt_ocorrencias", entidade_id: null, antes: null,
    depois: { stats: det.stats, ocorrencias_novas: resultado.ocorrencias_novas, mensagens_novas: resultado.mensagens_novas, mensagens_atualizadas: resultado.mensagens_atualizadas }
  }]);
  return resultado;
}

// Reprocessa a última planilha já importada — útil logo depois de definir a
// data de virada ou de carregar a base de contatos, sem esperar a próxima.
async function processarUltima({ res, db, ator }) {
  const snap = await db.obter("dashboard_snapshots?select=data&order=created_at.desc&limit=1");
  const data = snap && snap[0] && snap[0].data;
  if (!data) return erro(res, 404, "Nenhuma planilha importada ainda.", "SEM_PLANILHA");
  return res.status(200).json(await materializar(data, { db, ator }));
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
  "POST contatos": { aprovador: true, fn: carregarContatos },
  "POST processar": { aprovador: true, fn: processarUltima }
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
module.exports.materializar = materializar;
module.exports.usuarioDoToken = usuarioDoToken;
