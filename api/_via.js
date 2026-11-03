// api/_via.js — a página pública da via: o colaborador baixa o PDF da medida no próprio celular, sem login.
// Entra por api/rh.js (?modulo=via), antes da exigência de token, porque quem abre não tem conta no painel.
//
//   GET  ?modulo=via&c=CÓDIGO            → { ok, tipo: "QR"|"LINK" } (nada do documento nem do colaborador)
//   POST ?modulo=via  { c, re?, ult4? }  → o PDF em base64
//
// O código tem 192 bits, vem na parte "#" do endereço (não vai para log nem para Referer) e o sistema guarda só o
// SHA-256 dele. QR vale 15 minutos e dispensa confirmação (o supervisor está do lado); SMS e e-mail valem 30 dias e
// pedem o RE e os 4 últimos dígitos do celular cadastrado, com limite de tentativas. Cada abertura fica registrada.

const ponto = require("./_ponto");
const A = require("./_assinatura");
const MD = require("./_medida_regras");

const erro = (res, status, mensagem, codigo) => res.status(status).json({ error: mensagem, codigo });
const ipDe = req => String(((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "")).split(",")[0].trim().slice(0, 64);
const aparelhoDe = req => String((req.headers && req.headers["user-agent"]) || "").slice(0, 200);
const CODIGO_OK = /^[A-Za-z0-9_-]{20,64}$/;
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && require("crypto").timingSafeEqual(x, y); };

async function acharVia(db, codigo) {
  if (!CODIGO_OK.test(String(codigo || ""))) return null;
  const [v] = await db.obter(`fm_auditoria?select=id,criado_em,depois&acao=eq.${A.ACAO_VIA}&chave=eq.${A.hashCodigo(codigo)}&limit=1`);
  return v || null;
}

module.exports = async function via(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "Serviço indisponível.", "CONFIG_AUSENTE");
  try {
    const b = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const codigo = String(b.c || "");
    const v = await acharVia(db, codigo);
    // código desconhecido, vencido ou de documento que não existe: a mesma resposta, para não dar pista
    if (!v || Date.now() > Number(v.depois.expiraEm)) return erro(res, 410, "Este link não vale mais. Peça um novo ao seu supervisor.", "LINK_VENCIDO");
    if (req.method === "GET") return res.status(200).json({ ok: true, tipo: v.depois.tipo });
    if (req.method !== "POST") return erro(res, 405, "Método não permitido.", "METODO");

    const chave = v.depois.medida, hash = A.hashCodigo(codigo);
    const [g] = await db.obter(`fm_auditoria?select=id,criado_em,depois&acao=eq.${MD.ACAO_GERADA}&chave=eq.${encodeURIComponent(chave)}&limit=1`);
    if (!g) return erro(res, 410, "Este link não vale mais. Peça um novo ao seu supervisor.", "LINK_VENCIDO");
    if (v.depois.tipo === "LINK") {
      const desde = new Date(Date.now() - 24 * 3600000).toISOString();
      const falhas = await db.listar(`fm_auditoria?select=id&acao=eq.${A.ACAO_VIA_FALHA}&chave=eq.${hash}&criado_em=gte.${desde}`);
      if (falhas.length >= A.MAX_TENTATIVAS) return erro(res, 429, "Muitas tentativas. Peça um novo link ao seu supervisor.", "MUITAS_TENTATIVAS");
      const c = await A.contatoDe(db, g.depois.re);
      const ult4 = String(b.ult4 || "").replace(/\D/g, "");
      const re = String(b.re || "").trim();
      const ok = !!c && ult4.length === 4 && iguais(re, g.depois.re) && iguais(ult4, String(c.telefone_e164).replace(/\D/g, "").slice(-4));
      if (!ok) {
        await db.inserir("fm_auditoria", [{ ator: "colaborador", acao: A.ACAO_VIA_FALHA, entidade: MD.ENTIDADE, chave: hash, antes: null, depois: { ip: ipDe(req) } }]);
        return erro(res, 403, "RE ou número não conferem.", "NAO_CONFERE");
      }
    }
    const [pdf] = await db.obter(`fm_auditoria?select=depois&acao=eq.${MD.ACAO_ASSINADA}&chave=eq.${encodeURIComponent(chave)}&order=id.desc&limit=1`);
    const d = pdf && pdf.depois;
    if (!d || d.removido || d.digital !== true || !d.base64) return erro(res, 404, "O documento ainda não está disponível.", "SEM_PDF");
    await db.inserir("fm_auditoria", [{ ator: "colaborador", acao: A.ACAO_VIA_ABERTA, entidade: MD.ENTIDADE, chave: hash, antes: null, depois: { medida: chave, tipo: v.depois.tipo, ip: ipDe(req), aparelho: aparelhoDe(req) } }]);
    return res.status(200).json({ ok: true, nome: d.nome || "medida.pdf", base64: d.base64, sha256: d.sha256 });
  } catch (e) {
    console.error("[via] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Não foi possível abrir agora. Tente de novo.", "ERRO");
  }
};
