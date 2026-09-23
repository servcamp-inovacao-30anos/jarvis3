// api/_ponto.js — backend do monitoramento de marcações de ponto.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=ponto: o plano Hobby da Vercel permite 12 funções e já estamos nas 12.
//   /api/rh?modulo=ponto&t=...
//     leitura (qualquer pessoa logada; telefone mascarado para quem não aprova):
//       GET competencia · fila · ocorrencias · ficha · reconciliacao · quota
//     só aprovadores:
//       GET/POST contatos · POST processar · POST aprovar · POST rejeitar · PATCH mensagem
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

// ── painel: leituras ────────────────────────────────────────────────────────
// Qualquer pessoa logada lê; quem não é aprovador vê o telefone mascarado.

const CAMPOS_OCORRENCIA = "id,re,nome,data_jornada,tipo,horario_previsto,horario_marcado,diferenca_minutos,posto,cliente,supervisor,status,reconciliacao,is_test,competencia_id";
const CAMPOS_MENSAGEM = "id,re,data_jornada,ocorrencia_ids,telefone_e164,template_id,texto_gerado,texto_final,segmentos,status,motivo_bloqueio,aprovado_por,aprovado_em,editado_por,editado_em,enviado_em,rejeitado_por,rejeitado_em,motivo_rejeicao,erro_codigo,erro_mensagem,is_test,criado_em";
const STATUS_MENSAGEM = new Set(["AGUARDANDO_VALIDACAO", "APROVADA", "ENVIADA", "FALHA", "REJEITADA"]);
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function ehAprovador(ator) {
  return !!ator && APROVADORES.has(ator);
}

// Brasil sem horário de verão desde 2019: UTC−3 fixo.
function hojeSP() {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
}

async function lerConfigDoBanco(db) {
  return R.lerConfig(await db.listar("pt_config?select=chave,valor&order=chave.asc"));
}

async function ativosDaUltimaPlanilha(db) {
  const snap = await db.obter("dashboard_snapshots?select=ativos:data->ativos&order=created_at.desc&limit=1");
  return (snap && snap[0] && snap[0].ativos) || [];
}

async function porIds(db, tabela, campos, ids) {
  let out = [];
  for (const lote of emLotes(ids, 150)) out = out.concat(await db.listar(`${tabela}?select=${campos}&id=in.(${lote.join(",")})&order=id.asc`));
  return out;
}

async function verCompetencia({ req, res, db, ator }) {
  const cfg = await lerConfigDoBanco(db);
  const c = R.competenciaDe(DATA_ISO.test(String(req.query.data || "")) ? req.query.data : hojeSP());
  const comps = await db.listar("pt_competencias?select=id,data_inicio,data_fim,parcial,data_corte,status&order=data_inicio.desc");
  const reg = comps.find(x => String(x.data_inicio).slice(0, 10) === c.inicio) || null;
  const parcial = reg ? !!reg.parcial : !!cfg.data_virada && cfg.data_virada > c.inicio && cfg.data_virada <= c.fim;
  const janela = `data_jornada=gte.${c.inicio}&data_jornada=lte.${c.fim}&is_test=eq.false`;
  const oc = await db.listar(`pt_ocorrencias?select=${CAMPOS_OCORRENCIA}&${janela}&order=id.asc`);
  const ms = await db.listar(`pt_mensagens?select=id,re,status,motivo_bloqueio,is_test&${janela}&order=id.asc`);
  return res.status(200).json({
    ok: true,
    modulo: { ativo: !!cfg.data_virada, data_virada: cfg.data_virada, tolerancia_minutos: cfg.tolerancia_minutos },
    competencia: {
      id: reg ? reg.id : null, inicio: c.inicio, fim: c.fim, status: reg ? reg.status : "ABERTA",
      parcial, data_corte: parcial ? (reg ? String(reg.data_corte).slice(0, 10) : cfg.data_virada) : null
    },
    competencias: comps.map(x => ({ inicio: String(x.data_inicio).slice(0, 10), fim: String(x.data_fim).slice(0, 10), parcial: !!x.parcial })),
    resumo: R.resumoCompetencia(oc, ms),
    pode_aprovar: ehAprovador(ator)
  });
}

async function verFila({ req, res, db, ator }) {
  const pedidos = String(req.query.status || "").split(",").map(s => s.trim().toUpperCase()).filter(s => STATUS_MENSAGEM.has(s));
  const status = pedidos.length ? pedidos : ["AGUARDANDO_VALIDACAO", "APROVADA", "FALHA"];
  const ms = await db.listar(`pt_mensagens?select=${CAMPOS_MENSAGEM}&is_test=eq.false&status=in.(${status.join(",")})&order=id.asc`);
  const oc = await porIds(db, "pt_ocorrencias", CAMPOS_OCORRENCIA, [...new Set(ms.flatMap(m => (m.ocorrencia_ids || []).map(Number)))]);
  return res.status(200).json({ ok: true, status, pode_aprovar: ehAprovador(ator), linhas: R.montarFila(ms, oc, { mascarar: !ehAprovador(ator) }) });
}

async function listarOcorrencias({ req, res, db }) {
  const q = req.query || {};
  const f = ["is_test=eq.false"];
  if (DATA_ISO.test(String(q.competencia || ""))) { const c = R.competenciaDe(q.competencia); f.push(`data_jornada=gte.${c.inicio}`, `data_jornada=lte.${c.fim}`); }
  if (DATA_ISO.test(String(q.de || ""))) f.push(`data_jornada=gte.${q.de}`);
  if (DATA_ISO.test(String(q.ate || ""))) f.push(`data_jornada=lte.${q.ate}`);
  if (q.status) f.push(`status=eq.${encodeURIComponent(String(q.status).trim().toUpperCase())}`);
  if (q.supervisor) f.push(`supervisor=eq.${encodeURIComponent(String(q.supervisor).trim())}`);
  const re = R.normRE(q.re);
  if (/^\d{1,15}$/.test(re)) f.push(`re=eq.${re}`);
  const linhas = await db.listar(`pt_ocorrencias?select=${CAMPOS_OCORRENCIA}&${f.join("&")}&order=data_jornada.desc,id.desc`);
  return res.status(200).json({ ok: true, linhas });
}

async function verFicha({ req, res, db, ator }) {
  const re = R.normRE(req.query.re);
  if (!/^\d{1,15}$/.test(re)) return erro(res, 400, "Informe o RE do colaborador.", "RE_INVALIDO");
  const oc = await db.listar(`pt_ocorrencias?select=${CAMPOS_OCORRENCIA}&re=eq.${re}&is_test=eq.false&order=data_jornada.desc,id.desc`);
  const ms = await db.listar(`pt_mensagens?select=${CAMPOS_MENSAGEM}&re=eq.${re}&is_test=eq.false&order=id.asc`);
  const contato = (await db.obter(`pt_contatos?select=re,telefone_e164,tipo_telefone,enviavel&re=eq.${re}`))[0] || null;
  const ativo = (await ativosDaUltimaPlanilha(db)).find(a => R.normRE(a.RE) === re) || null;
  const competencia = R.competenciaDe(DATA_ISO.test(String(req.query.competencia || "")) ? req.query.competencia : hojeSP());
  const ficha = R.montarFicha(Number(re), { ocorrencias: oc, mensagens: ms, contato, ativo, competencia, mascarar: !ehAprovador(ator) });
  return res.status(200).json({ ok: true, ficha });
}

async function verReconciliacao({ res, db }) {
  const oc = await db.listar(`pt_ocorrencias?select=${CAMPOS_OCORRENCIA}&reconciliacao=not.is.null&is_test=eq.false&order=data_jornada.desc,id.desc`);
  const { normNome } = require("./_parse");
  const grupos = R.agruparReconciliacao(oc, oc.length ? await ativosDaUltimaPlanilha(db) : [], normNome);
  return res.status(200).json({ ok: true, total_ocorrencias: oc.length, grupos });
}

async function verCota({ res, db }) {
  const cfg = await lerConfigDoBanco(db);
  const hoje = hojeSP();
  const usos = await db.listar(`pt_sms_uso?select=dia,segmentos_dia&dia=gte.${hoje.slice(0, 7)}-01&order=dia.asc`);
  return res.status(200).json({ ok: true, cota: R.resumoCota(usos, hoje, cfg) });
}

// ── validação humana: só aprovadores ────────────────────────────────────────

function idsDoCorpo(body) {
  const lista = Array.isArray(body.ids) ? body.ids : [];
  return [...new Set(lista.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
}

async function aprovar({ res, db, ator, body }) {
  const ids = idsDoCorpo(body);
  if (!ids.length) return erro(res, 400, "Selecione ao menos uma mensagem.", "SEM_SELECAO");
  const porId = new Map((await porIds(db, "pt_mensagens", CAMPOS_MENSAGEM, ids)).map(m => [Number(m.id), m]));
  const aprovadas = [], recusadas = [];
  ids.forEach(id => { const motivo = R.motivoParaNaoAprovar(porId.get(id)); if (motivo) recusadas.push({ id, motivo }); else aprovadas.push(id); });
  if (aprovadas.length) {
    const agora = new Date().toISOString();
    // O filtro de status na própria atualização impede aprovar o que outra
    // pessoa acabou de rejeitar ou aprovar em paralelo.
    for (const lote of emLotes(aprovadas, 150)) {
      await db.atualizar(`pt_mensagens?id=in.(${lote.join(",")})&status=eq.AGUARDANDO_VALIDACAO`, { status: "APROVADA", aprovado_por: ator, aprovado_em: agora });
    }
    await db.inserir("pt_auditoria", aprovadas.map(id => ({
      ator, acao: "MENSAGEM_APROVADA", entidade: "pt_mensagens", entidade_id: id, antes: { status: "AGUARDANDO_VALIDACAO" }, depois: { status: "APROVADA" }
    })));
  }
  return res.status(200).json({ ok: true, aprovadas, recusadas });
}

async function rejeitar({ res, db, ator, body }) {
  const ids = idsDoCorpo(body);
  const motivo = String(body.motivo == null ? "" : body.motivo).trim().slice(0, 300);
  if (!ids.length) return erro(res, 400, "Selecione ao menos uma mensagem.", "SEM_SELECAO");
  if (!motivo) return erro(res, 400, "Informe o motivo da rejeição.", "SEM_MOTIVO");
  const porId = new Map((await porIds(db, "pt_mensagens", CAMPOS_MENSAGEM, ids)).map(m => [Number(m.id), m]));
  const rejeitadas = [], recusadas = [];
  ids.forEach(id => { const m = porId.get(id); const r = R.motivoParaNaoRejeitar(m); if (r) recusadas.push({ id, motivo: r }); else rejeitadas.push(m); });
  if (rejeitadas.length) {
    const agora = new Date().toISOString();
    const ids2 = rejeitadas.map(m => Number(m.id));
    for (const lote of emLotes(ids2, 150)) {
      await db.atualizar(`pt_mensagens?id=in.(${lote.join(",")})&status=in.(AGUARDANDO_VALIDACAO,APROVADA,FALHA)`, { status: "REJEITADA", rejeitado_por: ator, rejeitado_em: agora, motivo_rejeicao: motivo });
    }
    await db.inserir("pt_auditoria", rejeitadas.map(m => ({
      ator, acao: "MENSAGEM_REJEITADA", entidade: "pt_mensagens", entidade_id: Number(m.id), antes: { status: m.status }, depois: { status: "REJEITADA", motivo }
    })));
  }
  return res.status(200).json({ ok: true, rejeitadas: rejeitadas.map(m => Number(m.id)), recusadas });
}

// PATCH { id, texto_final } edita; { id, texto_final: null } volta ao texto gerado.
async function editarMensagem({ res, db, ator, body }) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return erro(res, 400, "Informe a mensagem.", "SEM_SELECAO");
  const [m] = await porIds(db, "pt_mensagens", CAMPOS_MENSAGEM, [id]);
  if (!m) return erro(res, 404, "Mensagem não encontrada.", "NAO_ENCONTRADA");
  if (m.status !== "AGUARDANDO_VALIDACAO") return erro(res, 409, "Só dá para editar a mensagem antes da aprovação.", m.status === "ENVIADA" ? "JA_ENVIADA" : "STATUS_" + m.status);
  const agora = new Date().toISOString();
  let patch, depois;
  if (body.texto_final === null) {
    patch = { texto_final: null, segmentos: R.segmentosSMS(m.texto_gerado), editado_por: null, editado_em: null };
    depois = { texto: m.texto_gerado, restaurado: true };
  } else {
    const v = R.validarTextoMensagem(body.texto_final);
    if (v.erro) {
      const msg = { TEXTO_VAZIO: "O texto não pode ficar vazio.", TEXTO_LONGO: "Texto longo demais.", TERMO_PROIBIDO: "A orientação não pode mencionar custo, hora extra, pagamento ou desconto." }[v.erro];
      return erro(res, 400, msg, v.erro);
    }
    patch = { texto_final: v.texto, segmentos: v.segmentos, editado_por: ator, editado_em: agora };
    depois = { texto: v.texto, segmentos: v.segmentos, codificacao: v.codificacao };
  }
  await db.atualizar(`pt_mensagens?id=eq.${id}&status=eq.AGUARDANDO_VALIDACAO`, patch);
  await db.inserir("pt_auditoria", [{ ator, acao: "MENSAGEM_EDITADA", entidade: "pt_mensagens", entidade_id: id, antes: { texto: m.texto_final || m.texto_gerado }, depois }]);
  return res.status(200).json({ ok: true, id, ...depois });
}

// ── roteamento ──────────────────────────────────────────────────────────────

const ROTAS = {
  "GET competencia": { fn: verCompetencia },
  "GET fila": { fn: verFila },
  "GET ocorrencias": { fn: listarOcorrencias },
  "GET ficha": { fn: verFicha },
  "GET reconciliacao": { fn: verReconciliacao },
  "GET quota": { fn: verCota },
  "GET contatos": { aprovador: true, fn: listarContatos },
  "POST contatos": { aprovador: true, fn: carregarContatos },
  "POST processar": { aprovador: true, fn: processarUltima },
  "POST aprovar": { aprovador: true, fn: aprovar },
  "POST rejeitar": { aprovador: true, fn: rejeitar },
  "PATCH mensagem": { aprovador: true, fn: editarMensagem }
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
