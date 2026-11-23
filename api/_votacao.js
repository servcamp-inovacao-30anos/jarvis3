// api/_votacao.js — votação do novo nome e da nova logo do Dashboard, em /api/rh?modulo=votacao.
// Passa pelo api/rh.js porque o plano Hobby da Vercel já está nas 12 funções; o rh.js já conferiu o token
// e o bloqueio antes de chegar aqui.
//
//   GET                 a votação, o voto de quem pede e, encerrada, o resultado. Ao administrador, também a
//                       contagem ao vivo e quem já votou / quem falta (sem dizer em quê: o voto é secreto).
//   POST  { opcao }     vota ou troca o voto (vale o último), enquanto estiver aberta.
//   POST t=encerrar     só administrador: fecha e mostra o resultado a todos.
//   POST t=reabrir      só administrador: volta a aceitar votos.
//
// Sem tabela nova: cada voto é uma linha da fm_auditoria (acao VOTACAO_VOTO, chave "votação|usuário"), e trocar
// o voto grava outra linha — fica o histórico e vale a mais recente. Encerrar e reabrir também são linhas
// (VOTACAO_ENCERRADA / VOTACAO_REABERTA); vale a última.
// Um voto por pessoa: só quem está identificado por token de sessão (a chave do Excel e o modo sem exigência
// de token não votam, porque não dá para saber quem é).

"use strict";

const _auth = require("./_auth");
const ponto = require("./_ponto");
const users = require("./users");

const ENTIDADE = "votacao";
const VOTO = "VOTACAO_VOTO";
const ENCERRADA = "VOTACAO_ENCERRADA";
const REABERTA = "VOTACAO_REABERTA";

// A votação em curso. Para uma próxima, trocar o id (os votos de uma não contam na outra).
const VOTACAO = {
  id: "identidade-2026-11",
  titulo: "Novo nome e nova logo do Dashboard",
  chamada: "Assista à apresentação e escolha a identidade que vai representar o nosso painel.",
  video: "/assets/votacao/apresentacao.mp4",
  opcoes: [
    { id: "shamir", nome: "SHAMIR", sub: "Gestão Inteligente", img: "/assets/votacao/shamir.webp" },
    { id: "servix", nome: "SERVIX", sub: "Grupo ServCamp Terceirizações", img: "/assets/votacao/servix.jpg" }
  ],
  ate: null // prazo opcional (ISO, ex.: "2026-11-28T18:00:00-03:00"); sem prazo, fica aberta até o administrador encerrar
};

const enc = encodeURIComponent;
const chaveVoto = (id, ator) => id + "|" + ator;
function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }

function quemPede(req) {
  const ga = _auth.requireAuth(req);
  return ga.ok && ga.enforced && ga.user && !ga.user.s && ga.user.u ? String(ga.user.u) : null;
}

async function ehAdmin(db, ator) {
  if (users.ADMINS.indexOf(ator) >= 0) return true;
  const [u] = await db.obter(`app_users?select=nome,perms,ativo&user_key=eq.${enc(ator)}&limit=1`);
  return !!(u && u.ativo !== false && u.nome && u.perms && u.perms.admin === true);
}

// Aberta? Vale o último encerrar/reabrir; sem nenhum, o prazo (se houver).
async function situacao(db, v, agora) {
  const [ult] = await db.obter(`fm_auditoria?select=acao,ator,criado_em&acao=in.(${ENCERRADA},${REABERTA})&chave=eq.${enc(v.id)}&order=id.desc&limit=1`);
  if (ult && ult.acao === ENCERRADA) return { aberta: false, encerradaEm: ult.criado_em, encerradaPor: ult.ator };
  if (!ult && v.ate && agora >= Date.parse(v.ate)) return { aberta: false, encerradaEm: new Date(Date.parse(v.ate)).toISOString(), encerradaPor: null };
  return { aberta: true, encerradaEm: null, encerradaPor: null };
}

// O voto que vale de cada pessoa: a linha mais recente dela, e só se a opção ainda existe.
async function votos(db, v) {
  const rows = await db.listar(`fm_auditoria?select=id,ator,chave,criado_em,opcao:depois->>opcao&acao=eq.${VOTO}&entidade=eq.${ENTIDADE}&order=id.desc`);
  const validas = new Set(v.opcoes.map(o => o.id));
  const por = new Map();
  rows.forEach(r => {
    if (!r.ator || r.chave !== chaveVoto(v.id, r.ator) || por.has(r.ator)) return; // só desta votação; vale a mais recente
    if (validas.has(r.opcao)) por.set(r.ator, { opcao: r.opcao, em: r.criado_em });
  });
  return por;
}

function contagem(v, por) {
  const n = {};
  v.opcoes.forEach(o => { n[o.id] = 0; });
  por.forEach(x => { n[x.opcao]++; });
  const total = por.size;
  return v.opcoes.map(o => ({ id: o.id, nome: o.nome, votos: n[o.id], pct: total ? Math.round(n[o.id] * 1000 / total) / 10 : 0 }));
}

// Quem pode votar: os fixos do código e os criados pela tela, menos bloqueados e excluídos.
async function eleitores(db) {
  const rows = await db.listar("app_users?select=user_key,nome,ativo&order=user_key.asc");
  const fora = new Set(rows.filter(u => u.ativo === false).map(u => u.user_key));
  const nomes = {};
  rows.forEach(u => { if (u.nome) nomes[u.user_key] = u.nome; });
  const chaves = [...new Set(users.USUARIOS.concat(rows.filter(u => u.nome).map(u => u.user_key)))].filter(k => !fora.has(k));
  return { chaves, nomes };
}

function publica(v) {
  return { id: v.id, titulo: v.titulo, chamada: v.chamada, video: v.video, ate: v.ate, opcoes: v.opcoes.map(o => ({ ...o })) };
}

async function estado({ res, db, ator, v, agora }) {
  const [sit, por, admin] = await Promise.all([situacao(db, v, agora), votos(db, v), ehAdmin(db, ator)]);
  const meu = por.get(ator) || null;
  const saida = {
    ativo: true, votacao: publica(v), ...sit,
    meuVoto: meu ? meu.opcao : null, votouEm: meu ? meu.em : null,
    admin
  };
  // resultado: a todos depois de encerrada; durante, só ao administrador
  if (!sit.aberta || admin) {
    saida.resultado = contagem(v, por);
    saida.totalVotos = por.size;
  }
  if (admin) {
    const { chaves, nomes } = await eleitores(db);
    const votaram = [], faltam = [];
    chaves.forEach(k => (por.has(k) ? votaram : faltam).push({ user_key: k, nome: nomes[k] || null, em: por.has(k) ? por.get(k).em : null }));
    // quem votou e já não está na lista (bloqueado depois) continua contando: o voto foi dado com acesso válido
    por.forEach((x, k) => { if (chaves.indexOf(k) < 0) votaram.push({ user_key: k, nome: nomes[k] || null, em: x.em }); });
    votaram.sort((a, b) => String(b.em).localeCompare(String(a.em)));
    saida.participacao = { eleitores: chaves.length, votaram, faltam }; // sem a opção de cada um: o voto é secreto
  }
  return res.status(200).json(saida);
}

async function votar({ req, res, db, ator, v, agora, body }) {
  const opcao = String((body && body.opcao) || "");
  if (!v.opcoes.some(o => o.id === opcao)) return erro(res, 400, "Escolha uma das opções.", "OPCAO_INVALIDA");
  const sit = await situacao(db, v, agora);
  if (!sit.aberta) return erro(res, 409, "A votação já foi encerrada.", "ENCERRADA");
  const por = await votos(db, v);
  const antes = por.get(ator);
  if (!antes || antes.opcao !== opcao) {
    await db.inserir("fm_auditoria", [{ ator, acao: VOTO, entidade: ENTIDADE, chave: chaveVoto(v.id, ator), antes: antes ? { opcao: antes.opcao } : null, depois: { opcao } }]);
  }
  return estado({ req, res, db, ator, v, agora });
}

function abrirFechar(acao) {
  return async ({ req, res, db, ator, v, agora }) => {
    if (!(await ehAdmin(db, ator))) return erro(res, 403, "Só o administrador encerra ou reabre a votação.", "SEM_PERMISSAO");
    const sit = await situacao(db, v, agora);
    if (sit.aberta === (acao === REABERTA)) return estado({ req, res, db, ator, v, agora }); // já está assim
    await db.inserir("fm_auditoria", [{ ator, acao, entidade: ENTIDADE, chave: v.id, antes: null, depois: null }]);
    return estado({ req, res, db, ator, v, agora });
  };
}

const ROTAS = { "GET ": estado, "POST ": votar, "POST encerrar": abrirFechar(ENCERRADA), "POST reabrir": abrirFechar(REABERTA) };

module.exports = async function votacao(req, res) {
  const t = String((req.query && req.query.t) || "");
  const fn = ROTAS[`${req.method} ${t}`];
  if (!fn) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  res.setHeader("Cache-Control", "no-store");
  const ator = quemPede(req);
  if (!ator) return res.status(200).json({ ativo: false }); // sem como saber quem é: a tela não mostra a votação
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    return await fn({ req, res, db, ator, v: module.exports.VOTACAO, agora: Date.now(), body: req.body || {} });
  } catch (e) {
    console.error("[votacao] " + String((e && e.message) || e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
module.exports.VOTACAO = VOTACAO; // os testes trocam o prazo
