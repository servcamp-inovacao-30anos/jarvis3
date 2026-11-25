// api/_ferias.js — Programação de Férias (Gestão), /api/rh?modulo=ferias. Passa pelo api/rh.js porque o
// plano Hobby da Vercel já está nas 12 funções; o rh.js já conferiu o token e o bloqueio antes de chegar aqui.
//
// A plataforma (ferias.html) é a mesma que rodava no Supabase próprio dela, com o cliente supabase-js
// apontado para cá. As regras continuam no banco (docs/ferias-banco.sql): esta rota só
//   1. descobre quem é o login do Jarvis na tabela usuarios da plataforma (coluna jarvis_user;
//      quem entra pela primeira vez ganha uma linha de Consulta — todos veem, só edita quem a dona liberar);
//   2. repassa o pedido ao PostgREST com um token do papel fe_app e o id dessa pessoa, assinado com o
//      SUPABASE_JWT_SECRET: é com ele que as políticas, travas e o histórico do banco sabem quem é;
//   3. faz o que a função de borda "usuarios" fazia (tela Usuários), com as mesmas regras.
//   GET  t=eu          quem sou eu na plataforma (o id que a página usa como "login")
//   *    (sem t)       PostgREST: o caminho vem no cabeçalho x-fe-path (/rest/v1/<tabela|rpc/função>?...)
//                      ou, para a tela Usuários, /functions/v1/usuarios

"use strict";

const crypto = require("crypto");
const _auth = require("./_auth");
const ponto = require("./_ponto");

// O que a página usa. Nada fora daqui passa (backups, importações, lixeira, snapshots).
const TABELAS = new Set(["afastamentos", "demissoes_pendentes", "fechamento_prazos", "feriados", "funcionarios",
  "historico", "meses_abertos", "periodos", "turnos", "usuarios", "vw_aso", "vw_escala", "vw_ficha_saidas",
  "vw_financeiro_13", "vw_financeiro_ferias", "vw_historica"]);
const RPCS = new Set(["confirmar_demissao", "demitir", "gerar_proximo_periodo", "reativar_demitido",
  "registrar_retorno", "sar2g_pendentes", "supervisor_do_login"]);
const RPC_SO_LEITURA = new Set(["sar2g_pendentes", "supervisor_do_login"]);
const CABECALHOS = ["accept", "content-type", "prefer", "range", "range-unit"];

// Mesmas listas da função de borda "usuarios" (funcoes_edge/usuarios/index.ts do pacote de migração)
const PAPEIS = ["master", "administrador", "consulta"];
const ITENS = {
  abas: ["programacao", "afastados", "aso", "historico", "usuarios"],
  acoes: ["deletar", "fechar_mes", "gerenciar_usuarios", "sar2g"],
  campos: ["datas", "dias", "abono", "cobertura", "supervisor", "escala", "situacao", "turno", "funcao", "retorno", "cliente"]
};
const ABAS_PADRAO = ["programacao", "afastados", "aso"];
const SELECT_USUARIO = "id,nome,email,papel,ativo,dono,financeiro,permissoes,jarvis_user,criado_em";

function limpar(p) {
  const o = p && typeof p === "object" ? p : {};
  const pega = k => Array.isArray(o[k]) ? [...new Set(o[k].map(String).filter(x => ITENS[k].includes(x)))] : [];
  return { abas: pega("abas"), acoes: pega("acoes"), campos: pega("campos") };
}
// o que um login pode — a mesma regra da função pode() do banco
function tem(u, tipo, item) {
  if (u.dono) return true;
  const lista = (u.permissoes && u.permissoes[tipo]) || (tipo === "abas" ? ABAS_PADRAO : []);
  if (u.papel === "master") {
    if (tipo === "campos") return true;
    if (tipo === "acoes" && item === "deletar") return true;
    if (tipo === "abas" && ["programacao", "afastados", "aso", "historico"].includes(item)) return true;
    return lista.includes(item);
  }
  if (u.papel === "administrador") return lista.includes(item);
  if (u.papel === "consulta") return tipo === "abas" && lista.includes(item);
  return false;
}
const editor = u => !!(u && u.ativo && (u.dono || u.papel === "master" || u.papel === "administrador"));

function quemPede(req) {
  const ga = _auth.requireAuth(req);
  return ga.ok && ga.enforced && ga.user && !ga.user.s && ga.user.u ? String(ga.user.u) : null;
}
const nomeLimpo = v => String(v || "").trim().replace(/\s+/g, " ").slice(0, 120);

// O login do Jarvis na tabela usuarios da plataforma. Primeira vez: entra como Consulta.
async function euDe(db, chave, nomeSugerido) {
  const ler = () => db.obter(`usuarios?select=${SELECT_USUARIO}&jarvis_user=eq.${encodeURIComponent(chave)}&limit=1`);
  const [u] = await ler();
  if (u) return u;
  const [a] = await db.obter(`app_users?select=nome&user_key=eq.${encodeURIComponent(chave)}&limit=1`);
  const novo = {
    id: crypto.randomUUID(), nome: nomeLimpo(a && a.nome) || nomeLimpo(nomeSugerido) || chave,
    papel: "consulta", ativo: true, dono: false, financeiro: false,
    permissoes: { abas: ABAS_PADRAO, acoes: [], campos: [] }, jarvis_user: chave
  };
  await db.upsert("usuarios", [novo], "jarvis_user", { ignorar: true }); // dois pedidos juntos não duplicam
  const [depois] = await ler();
  return depois;
}

// Token do banco: papel fe_app (políticas e permissões do docs/ferias-banco.sql) e o id da pessoa (fe_uid()).
function tokenDoBanco(uid) {
  const agora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = b64({ alg: "HS256", typ: "JWT" }) + "." +
    b64({ role: "fe_app", sub: uid, aud: "authenticated", iat: agora, exp: agora + 120 });
  return corpo + "." + crypto.createHmac("sha256", process.env.SUPABASE_JWT_SECRET).update(corpo).digest("base64url");
}

// Erro no formato do PostgREST, que a página já sabe mostrar (error.message)
const recusa = (res, status, message) => res.status(status).json({ code: String(status), message, erro: message });

async function repassar(req, res, eu, caminho) {
  const m = caminho.match(/^\/rest\/v1\/(rpc\/)?([a-z0-9_]+)(\?[^#]*)?$/);
  if (!m || !(m[1] ? RPCS : TABELAS).has(m[2])) return recusa(res, 404, "Caminho fora da Programação de Férias.");
  const metodo = req.method;
  if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(metodo)) return recusa(res, 405, "Método não aceito.");
  const leitura = metodo === "GET" || metodo === "HEAD" || (m[1] && RPC_SO_LEITURA.has(m[2]));
  if (!leitura && !editor(eu)) return recusa(res, 403, "Seu acesso à Programação de Férias é só de consulta.");

  const base = String(process.env.SUPABASE_URL).replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const h = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + tokenDoBanco(eu.id) };
  for (const k of CABECALHOS) if (req.headers[k]) h[k] = req.headers[k];
  const init = { method: metodo, headers: h };
  if (metodo !== "GET" && metodo !== "HEAD" && req.body !== undefined && req.body !== null && req.body !== "") {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  const r = await fetch(`${base}/rest/v1/${m[1] || ""}${m[2]}${m[3] || ""}`, init);
  for (const k of ["content-type", "content-range", "preference-applied"]) {
    const v = r.headers && r.headers.get(k);
    if (v) res.setHeader(k, v);
  }
  return res.status(r.status).send(metodo === "HEAD" ? "" : await r.text());
}

// ---------- tela Usuários: o que a função de borda "usuarios" fazia ----------
async function usuarios(req, res, db, eu) {
  const ok = (corpo) => res.status(200).json(corpo);
  const nao = (status, erro) => res.status(status).json({ erro });
  if (!eu || !eu.ativo) return nao(403, "Esta tela é exclusiva de quem administra os logins.");
  const dono = !!eu.dono;
  const gerencia = dono || tem(eu, "acoes", "gerenciar_usuarios");
  if (!(gerencia || tem(eu, "abas", "usuarios"))) return nao(403, "Esta tela é exclusiva de quem administra os logins.");
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  const acao = String(body.acao || "");
  const registrar = (campo, antigo, novo, operacao) => db.inserir("historico", [{
    tabela: "usuarios", registro_id: 0, operacao: operacao || "alteracao", campo,
    valor_antigo: antigo == null ? null : antigo, valor_novo: novo, autor_id: eu.id, autor_nome: eu.nome
  }]);
  const linha = async id => (await db.obter(`usuarios?select=${SELECT_USUARIO}&id=eq.${encodeURIComponent(id)}&limit=1`))[0];

  if (acao === "listar") {
    const lista = await db.obter(`usuarios?select=${SELECT_USUARIO}&order=nome.asc`);
    // o e-mail era o login; agora o login é o do Jarvis
    lista.forEach(u => { if (!u.email && u.jarvis_user) u.email = "login do Jarvis: " + u.jarvis_user; });
    return ok({ ok: true, usuarios: lista, eu: eu.id, dono, gerencia });
  }
  if (acao === "criar") return nao(400, "Os logins agora são os do Jarvis: quem abre a Programação de Férias pelo Jarvis já aparece aqui como Consulta.");
  if (acao === "senha") return nao(400, "A senha agora é a do Jarvis.");
  if (!gerencia) return nao(403, "Seu acesso permite só ver os logins.");

  const id = String(body.id || "");
  // quem não é a dona só mexe em Administrador e Consulta, e nunca em si mesmo
  const barrarAlvo = async () => {
    if (dono) return null;
    if (id === eu.id) return "Você não pode mudar o próprio acesso.";
    const a = await linha(id);
    if (!a) return "Login não encontrado.";
    if (a.dono || a.papel === "master") return "Só a dona dos logins mexe em quem é Master.";
    return null;
  };

  if (acao === "papel") {
    const papel = String(body.papel || "");
    if (!PAPEIS.includes(papel)) return nao(400, "Papel inválido.");
    if (id === eu.id && papel !== "master") return nao(400, "Você não pode tirar o próprio acesso master.");
    const barrado = await barrarAlvo();
    if (barrado) return nao(403, barrado);
    if (!dono && papel === "master") return nao(403, "Só a dona dos logins dá o papel Master.");
    const antes = await linha(id);
    await db.atualizar(`usuarios?id=eq.${encodeURIComponent(id)}`, { papel });
    await registrar("papel", antes ? antes.papel : null, `${antes ? antes.nome : id} → ${papel}`);
    return ok({ ok: true, msg: "Papel alterado." });
  }

  if (acao === "permissoes") {
    const papel = String(body.papel || "");
    if (!PAPEIS.includes(papel)) return nao(400, "Papel inválido.");
    if (id === eu.id) return nao(400, "Você não pode mudar o próprio acesso.");
    const antes = await linha(id);
    if (!antes) return nao(404, "Login não encontrado.");
    if (antes.dono) return nao(400, "A dona dos logins já tem tudo; não há o que configurar.");
    const perm = limpar(body.permissoes);
    const mudar = { papel, permissoes: perm };
    if (dono) {
      if (typeof body.financeiro === "boolean") mudar.financeiro = body.financeiro;
    } else {
      if (antes.papel === "master" || papel === "master") return nao(403, "Só a dona dos logins mexe em quem é Master.");
      // "Gerenciar usuários" e Financeiro ficam como estavam: só a dona mexe neles
      const tinha = Array.isArray(antes.permissoes && antes.permissoes.acoes) && antes.permissoes.acoes.includes("gerenciar_usuarios");
      perm.acoes = perm.acoes.filter(x => x !== "gerenciar_usuarios");
      if (tinha) perm.acoes.push("gerenciar_usuarios");
    }
    await db.atualizar(`usuarios?id=eq.${encodeURIComponent(id)}`, mudar);
    const resumo = [
      perm.abas.length ? `abas: ${perm.abas.join(", ")}` : "",
      perm.acoes.length ? `ações: ${perm.acoes.join(", ")}` : "",
      perm.campos.length ? `campos: ${perm.campos.join(", ")}` : "",
      typeof mudar.financeiro === "boolean" ? `financeiro: ${mudar.financeiro ? "sim" : "não"}` : ""
    ].filter(Boolean).join(" · ");
    await registrar("permissões", antes.papel, `${antes.nome || id} → ${papel}${resumo ? " · " + resumo : ""}`);
    return ok({ ok: true, msg: "Permissões salvas." });
  }

  if (acao === "ativo") {
    const ativo = !!body.ativo;
    if (id === eu.id && !ativo) return nao(400, "Você não pode desativar o próprio login.");
    const barrado = await barrarAlvo();
    if (barrado) return nao(403, barrado);
    const antes = await linha(id);
    await db.atualizar(`usuarios?id=eq.${encodeURIComponent(id)}`, { ativo });
    await registrar("acesso", null, `${antes ? antes.nome : id} → ${ativo ? "liberado" : "bloqueado"}`);
    return ok({ ok: true, msg: ativo ? "Acesso liberado." : "Acesso bloqueado." });
  }

  if (acao === "nome") {
    const nome = nomeLimpo(body.nome);
    if (!id) return nao(400, "Login não informado.");
    if (!nome) return nao(400, "O nome não pode ficar vazio.");
    if (String(body.nome).trim().replace(/\s+/g, " ").length > 120) return nao(400, "O nome está muito comprido.");
    const barrado = await barrarAlvo();
    if (barrado) return nao(403, barrado);
    const antes = await linha(id);
    if (!antes) return nao(404, "Login não encontrado.");
    if (antes.nome === nome) return ok({ ok: true, msg: "O nome já estava assim." });
    await db.atualizar(`usuarios?id=eq.${encodeURIComponent(id)}`, { nome });
    await registrar("nome do login", antes.nome, nome);
    return ok({ ok: true, msg: `Nome alterado para ${nome}.` });
  }
  return nao(400, "Ação desconhecida.");
}

module.exports = async function ferias(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const ator = quemPede(req);
  if (!ator) return recusa(res, 401, "Entre no Jarvis para abrir a Programação de Férias.");
  const db = ponto.conectar();
  if (!db) return recusa(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.");
  if (!process.env.SUPABASE_JWT_SECRET) return recusa(res, 503, "Falta a variável SUPABASE_JWT_SECRET na Vercel (o JWT secret do Supabase do Jarvis).");
  try {
    const q = req.query || {};
    const eu = await euDe(db, ator, q.nome);
    if (q.t === "eu" && req.method === "GET") return res.status(200).json({ uid: eu.id, email: eu.email || null, nome: eu.nome });
    const caminho = String(req.headers["x-fe-path"] || "");
    if (caminho === "/functions/v1/usuarios" && req.method === "POST") return await usuarios(req, res, db, eu);
    return await repassar(req, res, eu, caminho);
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[ferias] " + msg);
    if (/usuarios/.test(msg) && /\b(404|42P01|PGRST205)\b/.test(msg)) return recusa(res, 503, "As tabelas da Programação de Férias ainda não foram criadas no banco (docs/ferias-banco.sql).");
    return recusa(res, 500, "Falha ao falar com o banco.");
  }
};
module.exports.tem = tem;
