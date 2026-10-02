// api/_bdv.js — servidor do relatório de coberturas do supervisor (BDV).
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=bdv (o plano Hobby da Vercel já está nas 12 funções).
//   /api/rh?modulo=bdv&t=...
//     GET  coberturas?de=AAAA-MM-DD&ate=AAAA-MM-DD   diretoria e coordenação
//     POST reprocessar                               só aprovadores: refaz a partir da última planilha
// E o api/import.js chama materializar() a cada planilha recebida.
//
// A planilha traz só os últimos meses e é substituída a cada envio: por isso
// as coberturas vão para tabela própria (bdv_coberturas), e o relatório pode
// pegar qualquer período. As regras moram em _bdv_regras.js (puras, testadas).

const R = require("./_bdv_regras");
const ponto = require("./_ponto");

// Quem lê o relatório: os mesmos do painel Faltas x Medidas. A checagem é no
// servidor sempre que o login emite token (AUTH_SECRET definida).
const LEITORES = new Set(["joaoygor", "raphaelvictor", "ingridycampana", "paulocampana", "jussilenealmeida", "amauriantonio"]);
const MAX_DIAS = 400;

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
// o que define a linha: se nada disso mudou, ela não precisa ir ao banco de novo
const assinar = x => require("crypto").createHash("sha1").update(JSON.stringify([x.data, x.supervisor, x.destino, x.posto, x.chegada, x.inicio, x.fonte_inicio, x.diferenca_min, x.situacao, x.motivo, x.falta_re, x.falta_nome, x.falta_abono, x.km, x.tempo_min])).digest("hex").slice(0, 16);
const ehData = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));

/* Guarda as idas do supervisor (BDV) da planilha. No período que a planilha cobre, ela manda: o que estava no banco e não veio
   mais (lançamento corrigido) sai. Só vai ao banco o que mudou: quase tudo é
   igual ao envio anterior. */
async function materializar(data, opcoes) {
  const o = opcoes || {};
  const db = o.db || ponto.conectar();
  if (!db) return { ok: false, motivo: "CONFIG_AUSENTE" };
  const bdv = data && data.bdvCobertura;
  // Sem a aba do BDV (ou vazia) não se apaga nada: a planilha pode ter vindo sem ela.
  if (!Array.isArray(bdv) || !bdv.length) return { ok: true, ignorado: "SEM_BDV_NA_PLANILHA" };
  const agora = new Date().toISOString();
  const linhas = R.bdvMontar(bdv, data.faltas, data.ativos, data.cobertura, R.BDV_JORNADAS_REF)
    .filter(x => ehData(x.data))
    .map(x => Object.assign(x, { assinatura: assinar(x) }));
  if (!linhas.length) return { ok: true, ignorado: "SEM_DATAS_VALIDAS" };
  const datas = linhas.map(x => x.data).sort(), de = datas[0], ate = datas[datas.length - 1];
  const existentes = await db.listar(`bdv_coberturas?select=id,chave,assinatura&data=gte.${de}&data=lte.${ate}&order=id.asc`);
  const antes = new Map(existentes.map(x => [x.chave, x.assinatura]));
  const novas = new Set(linhas.map(x => x.chave));
  const sair = existentes.filter(x => !novas.has(x.chave)).map(x => x.id);
  for (let i = 0; i < sair.length; i += 200) await db.remover(`bdv_coberturas?id=in.(${sair.slice(i, i + 200).join(",")})`);
  const gravar = linhas.filter(x => antes.get(x.chave) !== x.assinatura).map(x => Object.assign(x, { atualizado_em: agora }));
  if (gravar.length) await db.upsert("bdv_coberturas", gravar, "chave");
  return { ok: true, registros: linhas.length, gravados: gravar.length, removidos: sair.length, de, ate };
}

async function verCoberturas({ req, res, db }) {
  const q = req.query || {};
  const de = String(q.de || ""), ate = String(q.ate || "");
  if (!ehData(de) || !ehData(ate) || de > ate) return erro(res, 400, "Informe o período (de e até).", "PERIODO_INVALIDO");
  if ((Date.parse(ate) - Date.parse(de)) / 864e5 > MAX_DIAS) return erro(res, 400, `Período de no máximo ${MAX_DIAS} dias.`, "PERIODO_LONGO");
  const campos = "data,supervisor,destino,posto,chegada,inicio,fonte_inicio,diferenca_min,situacao,motivo,falta_re,falta_nome,falta_abono,km,tempo_min";
  const [linhas, limites] = await Promise.all([
    db.listar(`bdv_coberturas?select=${campos}&data=gte.${de}&data=lte.${ate}&order=data.asc,chegada.asc,id.asc`),
    db.obter("bdv_coberturas?select=data&order=data.asc&limit=1").then(async a => {
      const b = await db.obter("bdv_coberturas?select=data&order=data.desc&limit=1");
      return { primeiro: a[0] ? String(a[0].data).slice(0, 10) : null, ultimo: b[0] ? String(b[0].data).slice(0, 10) : null };
    })
  ]);
  linhas.forEach(x => { x.data = String(x.data).slice(0, 10); if (x.km != null) x.km = Number(x.km); });
  return res.status(200).json({ ok: true, de, ate, limites: R.BDV_LIMITES, disponivel: limites, coberturas: linhas });
}

async function reprocessar({ res, db }) {
  const snap = await db.obter("dashboard_snapshots?select=bdvCobertura:data->bdvCobertura,faltas:data->faltas,ativos:data->ativos,cobertura:data->cobertura&order=created_at.desc&limit=1");
  if (!snap || !snap[0]) return erro(res, 404, "Nenhuma planilha enviada ainda.", "SEM_PLANILHA");
  const r = await materializar(snap[0], { db });
  return res.status(200).json(r);
}

const ROTAS = {
  "GET coberturas": { leitor: true, fn: verCoberturas },
  "POST reprocessar": { aprovador: true, fn: reprocessar }
};

module.exports = async function bdv(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const ator = ponto.usuarioDoToken(req);
  // Sem AUTH_SECRET o login não emite token: aí não há como saber quem pediu.
  if (rota.leitor && process.env.AUTH_SECRET && !(ator && LEITORES.has(ator))) return erro(res, 403, "Relatório restrito à diretoria e à coordenação.", "NAO_AUTORIZADO");
  if (rota.aprovador && !(ator && ponto.APROVADORES.has(ator))) return erro(res, 403, "Ação restrita aos aprovadores.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    return await rota.fn({ req, res, db, ator });
  } catch (e) {
    console.error("[bdv] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.materializar = materializar;
module.exports.LEITORES = LEITORES;
