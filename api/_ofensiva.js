// api/_ofensiva.js — Ofensiva (dias seguidos de uso do Dashboard) em /api/rh?modulo=ofensiva.
// Passa pelo api/rh.js porque o plano Hobby da Vercel já está nas 12 funções; o rh.js já conferiu o token
// e o bloqueio antes de chegar aqui. As regras moram em api/_ofensiva_regras.js.
//
//   POST            { guia }  a pessoa abriu uma guia (clique dela). Registra e devolve o estado.
//   GET             o estado de quem pede (sequência, recorde, guias de hoje, congelamentos).
//   GET t=ranking   o ranking de todos, só com nome e sequência (a tela mostra na primeira tela).
// Só vale quem está identificado por token de sessão. A chave do Excel (escopo) nunca vale aqui, e no modo
// de emergência (sem exigência de token) não há como saber quem é: a tela some com o contador.

"use strict";

const _auth = require("./_auth");
const ponto = require("./_ponto");
const R = require("./_ofensiva_regras");
const USUARIOS = require("./users").USUARIOS;

const VISITAS = "ofensiva_visitas"; // uma linha por pessoa, dia e guia (a chave composta evita corrida)
const DIAS = "ofensiva_dias";       // uma linha por pessoa e dia completo (as 3 guias)

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }

function quemPede(req) {
  const ga = _auth.requireAuth(req);
  return ga.ok && ga.enforced && ga.user && !ga.user.s && ga.user.u ? String(ga.user.u) : null;
}

const desde = hoje => R.somaDias(hoje, -R.JANELA_DIAS);
const enc = encodeURIComponent;

async function estado(db, ator, hoje, guiasHoje) {
  const rows = await db.listar(`${DIAS}?select=dia&user_key=eq.${enc(ator)}&dia=gte.${desde(hoje)}&order=dia.asc`);
  const c = R.calcular(rows.map(r => r.dia), hoje);
  if (guiasHoje == null) {
    const g = await db.listar(`${VISITAS}?select=guia&user_key=eq.${enc(ator)}&dia=eq.${hoje}&order=guia.asc`);
    guiasHoje = g.length;
  }
  return {
    ativo: true, dia: hoje, util: R.ehUtil(hoje), meta: R.META_GUIAS,
    guiasHoje: Math.min(guiasHoje, R.META_GUIAS),
    sequencia: c.sequencia, melhor: c.melhor, hojeOk: c.hojeOk,
    congelamentosRestantes: c.congelamentosRestantes, congeladosNoMes: c.congeladosNoMes, congeladoRecente: c.congeladoRecente
  };
}

async function registrar({ req, res, db, ator, hoje, body }) {
  const guia = body && body.guia;
  if (!R.guiaValida(guia)) return erro(res, 400, "Guia inválida.", "INVALIDO");
  let guiasHoje = null;
  if (R.ehUtil(hoje)) {
    const ja = await db.listar(`${VISITAS}?select=guia&user_key=eq.${enc(ator)}&dia=eq.${hoje}&order=guia.asc`);
    const nomes = ja.map(v => v.guia);
    guiasHoje = nomes.length;
    if (nomes.length < R.META_GUIAS && nomes.indexOf(guia) < 0) {
      await db.upsert(VISITAS, [{ user_key: ator, dia: hoje, guia }], "user_key,dia,guia", { ignorar: true });
      const depois = await db.listar(`${VISITAS}?select=guia&user_key=eq.${enc(ator)}&dia=eq.${hoje}&order=guia.asc`);
      guiasHoje = depois.length;
      if (guiasHoje >= R.META_GUIAS) await db.upsert(DIAS, [{ user_key: ator, dia: hoje }], "user_key,dia", { ignorar: true });
    }
  }
  return res.status(200).json(await estado(db, ator, hoje, guiasHoje));
}

async function meu({ res, db, ator, hoje }) {
  return res.status(200).json(await estado(db, ator, hoje, R.ehUtil(hoje) ? null : 0));
}

async function ranking({ res, db, ator, hoje }) {
  const [dias, usuarios, visitas] = await Promise.all([
    db.listar(`${DIAS}?select=user_key,dia&dia=gte.${desde(hoje)}&order=dia.asc,user_key.asc`),
    db.listar("app_users?select=user_key,nome,ativo&order=user_key.asc"),
    R.ehUtil(hoje) ? db.listar(`${VISITAS}?select=user_key,guia&dia=eq.${hoje}&order=user_key.asc,guia.asc`) : Promise.resolve([])
  ]);
  const bloqueados = new Set(usuarios.filter(u => u.ativo === false).map(u => u.user_key));
  const nomes = {};
  usuarios.forEach(u => { if (u.nome) nomes[u.user_key] = u.nome; });
  const por = {};
  dias.forEach(d => { if (!bloqueados.has(d.user_key)) (por[d.user_key] = por[d.user_key] || []).push(d.dia); });
  const guiasHoje = {};
  visitas.forEach(v => { guiasHoje[v.user_key] = (guiasHoje[v.user_key] || 0) + 1; });
  // todos os acessos: quem pode entrar (fixos e criados pela tela), menos os bloqueados, mesmo sem nenhum dia ainda
  const todasChaves = [...new Set(USUARIOS.concat(usuarios.filter(u => u.nome).map(u => u.user_key)))].filter(k => !bloqueados.has(k));
  const todos = R.ranking(por, hoje, nomes, { todos: todasChaves, guiasHoje });
  const i = todos.findIndex(x => x.user_key === ator);
  return res.status(200).json({
    dia: hoje,
    util: R.ehUtil(hoje),
    ranking: todos.map(x => ({ user_key: x.user_key, nome: x.nome, sequencia: x.sequencia, melhor: x.melhor, hojeOk: x.hojeOk, guiasHoje: x.guiasHoje })),
    participantes: todos.length,
    voce: i >= 0 ? { posicao: i + 1, sequencia: todos[i].sequencia } : null // quem pede sempre está na lista
  });
}

const ROTAS = { "POST ": registrar, "GET ": meu, "GET ranking": ranking };

module.exports = async function ofensiva(req, res) {
  const t = String((req.query && req.query.t) || "");
  const fn = ROTAS[`${req.method} ${t}`];
  if (!fn) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  res.setHeader("Cache-Control", "no-store");
  const ator = quemPede(req);
  if (!ator) return res.status(200).json({ ativo: false }); // sem como saber quem é: a tela não mostra nada
  try {
    return await fn({ req, res, db, ator, hoje: R.hojeBR(), body: req.body || {} });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[ofensiva] " + msg);
    if (/ofensiva_/.test(msg) && /\b(404|42P01|PGRST205)\b/.test(msg)) return res.status(200).json({ ativo: false, codigo: "SEM_TABELA" }); // antes da tabela existir a tela só não mostra
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
