// api/_bdv.js — servidor do relatório de coberturas do supervisor (BDV).
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=bdv (o plano Hobby da Vercel já está nas 12 funções).
//   /api/rh?modulo=bdv&t=coberturas&de=AAAA-MM-DD&ate=AAAA-MM-DD   diretoria e coordenação
//
// Sem tabela própria: cada planilha enviada já fica guardada inteira em
// dashboard_snapshots, e cada uma traz uns 3 meses de BDV. Para o período
// pedido, lê a planilha mais recente e, se o período começa antes do que ela
// cobre, a última planilha de cada mês anterior, voltando até cobrir o início.
// Cada dia vem sempre da planilha mais nova que o tem. As regras moram em
// _bdv_regras.js (puras, testadas).

const R = require("./_bdv_regras");
const ponto = require("./_ponto");

// Quem lê o relatório: os mesmos do painel Faltas x Medidas. A checagem é no
// servidor sempre que o login emite token (AUTH_SECRET definida).
const LEITORES = new Set(["joaoygor", "raphaelvictor", "ingridycampana", "paulocampana", "jussilenealmeida", "amauriantonio"]);
const MAX_DIAS = 400;
const MAX_PLANILHAS = 15; // planilhas lidas por pedido, no máximo (uma por mês do período)
const CAMPOS_PLANILHA = "bdvCobertura:data->bdvCobertura,faltas:data->faltas,ativos:data->ativos,cobertura:data->cobertura";

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
const ehData = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const diaSP = iso => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 10);

/* Idas do supervisor entre de e ate, montadas a partir das planilhas guardadas.
   Devolve também até onde se conseguiu voltar (primeiro dia com dado). */
async function idasDoPeriodo(db, de, ate) {
  const todos = await db.listar("dashboard_snapshots?select=id,created_at&order=created_at.desc");
  // a mais recente e a última de cada mês anterior
  const meses = new Set(), envios = [];
  todos.forEach(e => { const m = diaSP(e.created_at).slice(0, 7); if (!envios.length || !meses.has(m)) envios.push(e); meses.add(m); });
  const linhas = [];
  let limite = null; // dias >= limite já vieram de uma planilha mais nova
  let primeiro = null, ultimo = null, lidas = 0;
  for (const e of envios) {
    if (lidas >= MAX_PLANILHAS || (limite && limite <= de)) break;
    const criado = diaSP(e.created_at);
    if (criado < de) break;                     // esta e as mais velhas param antes do período
    const [p] = await db.obter(`dashboard_snapshots?select=${CAMPOS_PLANILHA}&id=eq.${e.id}`);
    lidas++;
    const bdv = (p && Array.isArray(p.bdvCobertura)) ? p.bdvCobertura : [];
    const datas = bdv.map(x => String(x.DATA || "").slice(0, 10)).filter(ehData).sort();
    if (!datas.length) { if (!limite) limite = criado; continue; } // planilha sem a aba do BDV
    if (!ultimo) ultimo = datas[datas.length - 1];
    R.bdvMontar(bdv, p.faltas, p.ativos, p.cobertura, R.BDV_JORNADAS_REF).forEach(x => {
      if (x.data >= de && x.data <= ate && (!limite || x.data < limite)) linhas.push(x);
    });
    primeiro = datas[0];
    limite = datas[0];
  }
  linhas.sort((a, b) => a.data.localeCompare(b.data) || String(a.chegada).localeCompare(String(b.chegada)));
  return { linhas, primeiro, ultimo, lidas };
}

/* Desde quando há BDV guardado: o primeiro dia da planilha guardada mais antiga
   que tenha a aba. Muda pouco (só quando alguém apaga envios antigos): fica em
   memória por algumas horas. */
let _desde = { valor: undefined, em: 0 };
async function dadosDesde(db) {
  if (_desde.valor !== undefined && Date.now() - _desde.em < 6 * 3600000) return _desde.valor;
  const antigos = await db.obter("dashboard_snapshots?select=id&order=created_at.asc&limit=4");
  let valor = null;
  for (const e of antigos || []) {
    const [p] = await db.obter(`dashboard_snapshots?select=bdv:data->bdvCobertura&id=eq.${e.id}`);
    const datas = ((p && p.bdv) || []).map(x => String(x.DATA || "").slice(0, 10)).filter(ehData).sort();
    if (datas.length) { valor = datas[0]; break; }
  }
  _desde = { valor, em: Date.now() };
  return valor;
}

async function verCoberturas({ req, res, db }) {
  const q = req.query || {};
  const de = String(q.de || ""), ate = String(q.ate || "");
  if (!ehData(de) || !ehData(ate) || de > ate) return erro(res, 400, "Informe o período (de e até).", "PERIODO_INVALIDO");
  if ((Date.parse(ate) - Date.parse(de)) / 864e5 > MAX_DIAS) return erro(res, 400, `Período de no máximo ${MAX_DIAS} dias.`, "PERIODO_LONGO");
  const [r, desde] = await Promise.all([idasDoPeriodo(db, de, ate), dadosDesde(db)]);
  const coberturas = r.linhas.map(x => ({
    data: x.data, supervisor: x.supervisor, destino: x.destino, posto: x.posto, chegada: x.chegada, inicio: x.inicio,
    fonte_inicio: x.fonte_inicio, diferenca_min: x.diferenca_min, situacao: x.situacao, motivo: x.motivo,
    falta_re: x.falta_re, falta_nome: x.falta_nome, falta_abono: x.falta_abono, km: x.km, tempo_min: x.tempo_min
  }));
  return res.status(200).json({ ok: true, de, ate, limites: R.BDV_LIMITES, disponivel: { primeiro: r.primeiro, ultimo: r.ultimo, desde }, planilhas_lidas: r.lidas, coberturas });
}

const ROTAS = {
  "GET coberturas": { leitor: true, fn: verCoberturas }
};

module.exports = async function bdv(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const ator = ponto.usuarioDoToken(req);
  // Sem AUTH_SECRET o login não emite token: aí não há como saber quem pediu.
  if (rota.leitor && process.env.AUTH_SECRET && !(ator && LEITORES.has(ator))) return erro(res, 403, "Relatório restrito à diretoria e à coordenação.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    return await rota.fn({ req, res, db, ator });
  } catch (e) {
    console.error("[bdv] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.idasDoPeriodo = idasDoPeriodo;
module.exports._zerarCache = () => { _desde = { valor: undefined, em: 0 }; };
module.exports.LEITORES = LEITORES;
