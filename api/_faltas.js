// api/_faltas.js — servidor do módulo Faltas x Medidas disciplinares.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=faltas (o plano Hobby da Vercel já está nas 12 funções).
//   /api/rh?modulo=faltas&t=...
//     GET  casos      qualquer pessoa logada: os casos já calculados
//     GET  feriados   qualquer pessoa logada
//     PATCH motivo    só aprovadores: motivo da medida (texto livre, com histórico)
//     POST feriados   só aprovadores: { data, descricao } ou { data, remover: true }
// E o api/import.js chama materializar() a cada planilha recebida.
//
// As regras moram em _faltas_regras.js (puras, testadas). Aqui fica só o que
// fala com o mundo: banco, autorização e o formato das respostas.

const R = require("./_faltas_regras");
const ponto = require("./_ponto");

const JANELA_DIAS = 150; // o que a tela carrega: casos mais antigos já se encerraram

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
function hojeSP() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const reNum = v => { const r = R.reDe(v); return /^\d{1,15}$/.test(r) ? Number(r) : null; };

// ── materialização ──────────────────────────────────────────────────────────
// A planilha traz só o mês até hoje e cada envio substitui o anterior: sem
// guardar aqui, a falta de um mês some antes de o caso se resolver.
async function materializar(data, opcoes) {
  const o = opcoes || {};
  const db = o.db || ponto.conectar();
  if (!db) return { ok: false, motivo: "CONFIG_AUSENTE" };
  if (!data || !Array.isArray(data.faltas)) return { ok: true, ignorado: "SEM_FALTAS_NA_PLANILHA" };
  const agora = new Date().toISOString();

  // Só entra quem é do módulo: operacional, em 5x2, 6x1 ou 12x36.
  const faltas = [];
  data.faltas.forEach(f => {
    const re = reNum(f.RE), dia = String(f.DATA || "").slice(0, 10);
    if (re == null || !ehData(dia) || !R.familiaEscala(f.ESCALA) || !R.ehOperacional(f.TIPO)) return;
    faltas.push({
      re, data: dia, codigo: String(f.ABONO || "").toUpperCase().trim() || null,
      nome: f.NOME || null, cargo: f.CARGO || null, posto: f.LOCAL || null,
      supervisor: f.AREA || null, escala: f.ESCALA || null, tipo: f.TIPO || null, atualizado_em: agora
    });
  });
  const reDoModulo = new Set(faltas.map(f => String(f.re)));

  const dias = [];
  Object.entries(data.fichaDias || {}).forEach(([reTxt, porDia]) => {
    const re = reNum(reTxt);
    if (re == null || !reDoModulo.has(String(re))) return;
    Object.entries(porDia || {}).forEach(([dia, situacao]) => { if (ehData(dia)) dias.push({ re, data: dia, situacao: situacao || null, atualizado_em: agora }); });
  });

  // Período que esta planilha cobre: é nele que ela manda. Falta que existia no
  // banco e não veio mais (o RH corrigiu o lançamento) sai do módulo.
  const datas = faltas.map(f => f.data).concat(Object.values(data.fichaDias || {}).flatMap(m => Object.keys(m || {}))).filter(ehData).sort();
  let removidas = 0;
  if (datas.length) {
    const de = datas[0], ate = datas[datas.length - 1];
    const existentes = await db.listar(`fm_faltas?select=re,data&data=gte.${de}&data=lte.${ate}&order=re.asc,data.asc`);
    const novas = new Set(faltas.map(f => f.re + "|" + f.data));
    const sumiram = new Map();
    existentes.forEach(x => {
      const k = x.re + "|" + String(x.data).slice(0, 10);
      if (novas.has(k)) return;
      if (!sumiram.has(x.re)) sumiram.set(x.re, []);
      sumiram.get(x.re).push(String(x.data).slice(0, 10));
    });
    for (const [re, lista] of sumiram) { await db.remover(`fm_faltas?re=eq.${re}&data=in.(${lista.join(",")})`); removidas += lista.length; }
  }
  if (faltas.length) await db.upsert("fm_faltas", faltas, "re,data");
  if (dias.length) await db.upsert("fm_dias", dias, "re,data");

  // Medidas: o motivo editado no JARVIS não vai no upsert, então nunca é sobrescrito.
  const medidas = [];
  (data.disciplina || []).forEach(m => {
    const re = reNum(m.RE), dia = String(m.DATA || "").slice(0, 10);
    if (re == null || !ehData(dia)) return;
    const chave = String(m.HIST || "").trim() || [re, dia, m.TIPO || "", m.GRAU || ""].join("|");
    medidas.push({
      chave, re, data: dia, tipo: m.TIPO || null, grau: m.GRAU || null, dias: Number(m.DIAS) || 0,
      fase: m.FASE || null, motivo_sar2g: m.MOTIVO || null, obs: m.OBS || null, nome: m.NOME || null, local: m.LOCAL || null,
      atualizado_em: agora
    });
  });
  if (medidas.length) await db.upsert("fm_medidas", medidas, "chave");

  // Admissão de quem tem o RE hoje. Sem data na planilha, não apaga a que já existe.
  const admissoes = (data.ativos || [])
    .map(a => ({ re: reNum(a.RE), admissao: String(a.ADMISSAO || "").slice(0, 10), atualizado_em: agora }))
    .filter(a => a.re != null && ehData(a.admissao));
  if (admissoes.length) await db.upsert("fm_admissoes", admissoes, "re");

  return { ok: true, faltas: faltas.length, removidas, dias: dias.length, medidas: medidas.length, admissoes: admissoes.length };
}

// ── leituras ────────────────────────────────────────────────────────────────

async function verCasos({ res, db, ator }) {
  const hoje = hojeSP(), desde = R.somaDias(hoje, -JANELA_DIAS);
  const [faltas, dias, medidas, adm, feriados] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,codigo,nome,cargo,posto,supervisor,escala,tipo&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar(`fm_dias?select=re,data,situacao&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar(`fm_medidas?select=chave,re,data,tipo,grau,dias,fase,motivo_sar2g,obs,motivo,motivo_editado_por,motivo_editado_em&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar("fm_admissoes?select=re,admissao&order=re.asc"),
    db.listar("fm_feriados?select=data,descricao&order=data.asc")
  ]);
  const fichaDias = {};
  dias.forEach(d => { (fichaDias[d.re] = fichaDias[d.re] || {})[String(d.data).slice(0, 10)] = d.situacao; });
  const admissoes = {};
  adm.forEach(a => { if (a.admissao) admissoes[a.re] = String(a.admissao).slice(0, 10); });

  const r = R.montarCasos({
    hoje,
    feriados: feriados.map(f => String(f.data).slice(0, 10)),
    admissoes, fichaDias,
    faltas: faltas.map(f => ({ RE: f.re, DATA: f.data, ABONO: f.codigo, NOME: f.nome, CARGO: f.cargo, LOCAL: f.posto, AREA: f.supervisor, ESCALA: f.escala, TIPO: f.tipo })),
    medidas: medidas.map(m => ({ RE: m.re, DATA: m.data, TIPO: m.tipo, GRAU: m.grau, DIAS: m.dias, FASE: m.fase, HIST: m.chave, MOTIVO: m.motivo_sar2g, chave: m.chave, motivo: m.motivo, motivo_editado_por: m.motivo_editado_por, motivo_editado_em: m.motivo_editado_em }))
  });

  const resumo = {};
  r.casos.forEach(c => { resumo[c.situacao] = (resumo[c.situacao] || 0) + 1; });
  const doCaso = new Set(r.casos.map(c => String(c.re)));
  const diasDosCasos = {};
  Object.keys(fichaDias).forEach(re => { if (doCaso.has(String(re))) diasDosCasos[re] = fichaDias[re]; });
  // Medidas anteriores de cada pessoa, para o card (reincidência).
  const historico = {};
  medidas.forEach(m => { if (doCaso.has(String(m.re))) (historico[m.re] = historico[m.re] || []).push(m); });

  return res.status(200).json({
    ok: true, hoje, dataBase: r.dataBase, resumo, casos: r.casos, abonadas: r.abonadas,
    dias: diasDosCasos, historico, feriados, pode_editar: !!(ator && ponto.APROVADORES.has(ator))
  });
}

async function verFeriados({ res, db }) {
  return res.status(200).json({ ok: true, feriados: await db.listar("fm_feriados?select=data,descricao&order=data.asc") });
}

// ── escritas (só aprovadores) ───────────────────────────────────────────────

async function editarMotivo({ res, db, ator, body }) {
  const chave = String(body.chave || "").trim();
  if (!chave) return erro(res, 400, "Informe a medida.", "SEM_MEDIDA");
  const motivo = String(body.motivo == null ? "" : body.motivo).trim().slice(0, 1000);
  const [m] = await db.obter(`fm_medidas?select=chave,motivo&chave=eq.${encodeURIComponent(chave)}`);
  if (!m) return erro(res, 404, "Medida não encontrada.", "NAO_ENCONTRADA");
  if ((m.motivo || "") === motivo) return res.status(200).json({ ok: true, alterado: false });
  const agora = new Date().toISOString();
  // A auditoria vai antes: se a gravação falhar no meio, o texto anterior não se perde.
  await db.inserir("fm_auditoria", [{ ator, acao: "MOTIVO_EDITADO", entidade: "fm_medidas", chave, antes: { motivo: m.motivo || null }, depois: { motivo: motivo || null } }]);
  await db.atualizar(`fm_medidas?chave=eq.${encodeURIComponent(chave)}`, { motivo: motivo || null, motivo_editado_por: ator, motivo_editado_em: agora });
  return res.status(200).json({ ok: true, alterado: true, motivo: motivo || null, motivo_editado_por: ator, motivo_editado_em: agora });
}

async function salvarFeriado({ res, db, ator, body }) {
  const dia = String(body.data || "").slice(0, 10);
  if (!ehData(dia)) return erro(res, 400, "Data inválida.", "DATA_INVALIDA");
  if (body.remover === true) {
    await db.remover(`fm_feriados?data=eq.${dia}`);
    await db.inserir("fm_auditoria", [{ ator, acao: "FERIADO_REMOVIDO", entidade: "fm_feriados", chave: dia, antes: null, depois: null }]);
    return res.status(200).json({ ok: true, removido: dia });
  }
  const descricao = String(body.descricao == null ? "" : body.descricao).trim().slice(0, 120) || null;
  await db.upsert("fm_feriados", [{ data: dia, descricao }], "data");
  await db.inserir("fm_auditoria", [{ ator, acao: "FERIADO_SALVO", entidade: "fm_feriados", chave: dia, antes: null, depois: { descricao } }]);
  return res.status(200).json({ ok: true, data: dia, descricao });
}

// ── roteamento ──────────────────────────────────────────────────────────────

const ROTAS = {
  "GET casos": { fn: verCasos },
  "GET feriados": { fn: verFeriados },
  "PATCH motivo": { aprovador: true, fn: editarMotivo },
  "POST feriados": { aprovador: true, fn: salvarFeriado }
};

module.exports = async function faltas(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const ator = ponto.usuarioDoToken(req);
  if (rota.aprovador && !(ator && ponto.APROVADORES.has(ator))) return erro(res, 403, "Ação restrita aos aprovadores.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    return await rota.fn({ req, res, db, ator, body: req.body || {} });
  } catch (e) {
    console.error("[faltas] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.materializar = materializar;
