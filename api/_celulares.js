// api/_celulares.js — guia Celulares (/api/rh?modulo=celulares). Passa pelo api/rh.js porque o plano
// Hobby da Vercel já está nas 12 funções; o rh.js já conferiu o token e o bloqueio antes de chegar aqui.
// As regras (pendências, leitura da planilha) moram em api/_celulares_regras.js.
//
// Quem vê o quê — a tela só esconde; quem barra é aqui:
//   GET    t=contatos  todo mundo logado: cliente, número e login Zello dos aparelhos ATIVOS de posto.
//                      É o que a guia Clientes mostra para o supervisor ligar. Sem senha, IMEI ou e-mail.
//   O resto é só de quem tem a guia Celulares: administrador, ou quem o administrador liberou em
//   Configurações › 👁️ Guias (app_users.perms.guias.celulares).
//   GET    (sem t)     a lista com as pendências. As senhas NÃO vão: só quais estão preenchidas.
//   GET    t=senhas    as senhas de UM aparelho (?id=); fica registrado na fm_auditoria antes de sair.
//   GET    t=exportar  tudo, com as senhas (o Excel de backup); registrado do mesmo jeito.
//   POST   (sem t)     cadastra · PATCH ?id= altera · DELETE ?id= apaga (registrados, sem senha no registro)
//   POST   t=importar  a planilha CELULARES lida no navegador; sem "confirmar", só a prévia.
//   POST   t=ddd       completa o DDD dos números que estão sem; sem "confirmar", só a prévia.
// Sem AUTH_SECRET, ou com AUTH_ENFORCE=0 (modo de emergência, APIs abertas), não há como saber quem
// pede — o rh.js nem confere sessão encerrada nem chave de escopo: só os contatos saem.

"use strict";

const _auth = require("./_auth");
const ponto = require("./_ponto");
const R = require("./_celulares_regras");
const ADMINS = require("./users").ADMINS;

const TABELA = "cel_aparelhos";
const ENTIDADE = "celular";
const VISIVEIS = ["id"].concat(R.CAMPOS.filter(c => R.SEGREDOS.indexOf(c) < 0), ["criado_em", "criado_por", "atualizado_em", "atualizado_por"]);
const IDENTIDADE = "id,cliente,modelo,imei1,imei2,numero,login_zello,email";

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
const vazio = v => v == null || String(v).trim() === "";
const idDe = req => { const id = String((req.query && req.query.id) || ""); return /^\d{1,12}$/.test(id) ? id : null; };
const semSegredos = a => {
  const o = {};
  for (const c of VISIVEIS) o[c] = a[c] == null ? null : a[c];
  o.com = R.SEGREDOS.filter(c => !vazio(a[c])); // quais senhas estão preenchidas — nunca o valor
  return o;
};
// Para o registro: as senhas viram só "(preenchida)" ou "(vazia)".
const resumo = (obj, campos) => {
  const o = {};
  for (const c of campos) o[c] = R.SEGREDOS.indexOf(c) >= 0 ? (vazio(obj[c]) ? "(vazia)" : "(preenchida)") : (obj[c] == null ? null : obj[c]);
  return o;
};
const publico = obj => resumo(obj, R.CAMPOS.filter(c => R.SEGREDOS.indexOf(c) < 0 && Object.prototype.hasOwnProperty.call(obj, c)));

async function registrar(db, ator, acao, chave, antes, depois) {
  await db.inserir("fm_auditoria", [{ ator: ator || null, acao, entidade: ENTIDADE, chave: String(chave), antes: antes || null, depois: depois || null }]);
}
// Registro de alteração já feita: se falhar, a alteração vale do mesmo jeito (fica no log da Vercel).
const registrarDepois = (...a) => registrar(...a).catch(e => console.error("[celulares] registro:", e && e.message));

// Quem tem a guia: administrador fixo, administrador criado pela tela (mesma regra do api/users.js)
// ou quem recebeu a guia em 👁️ Guias. Bloqueado na Configuração não passa.
async function temAGuia(db, ator) {
  if (!ator) return false;
  if (ADMINS.indexOf(ator) >= 0) return true;
  const [u] = await db.obter(`app_users?select=user_key,nome,perms,ativo&user_key=eq.${encodeURIComponent(ator)}&limit=1`);
  if (!u || u.ativo === false) return false;
  const p = (u.perms && typeof u.perms === "object") ? u.perms : {};
  return !!((u.nome && p.admin === true) || (p.guias && p.guias.celulares === true));
}

// Quem pede: só com a exigência de token ligada e token de sessão. A chave do Excel (escopo "xl"/"xlb",
// 90 dias, vai no endereço de planilha compartilhada) nunca vale aqui, nem no modo de emergência.
function quemPede(req) {
  const ga = _auth.requireAuth(req);
  return ga.ok && ga.enforced && ga.user && !ga.user.s && ga.user.u ? String(ga.user.u) : null;
}

const lerTodos = db => db.listar(`${TABELA}?select=*&order=id.asc`);

async function contatos({ res, db }) {
  const rows = await db.listar(`${TABELA}?select=id,cliente,cliente_vinculado,numero,login_zello&situacao=eq.ATIVO&tipo=eq.POSTO&order=id.asc`);
  const limpo = v => (vazio(v) || R.naoSeAplica(v)) ? "" : String(v).trim();
  return res.status(200).json({
    contatos: rows.map(r => ({ id: r.id, cliente: limpo(r.cliente), cliente_vinculado: limpo(r.cliente_vinculado), numero: limpo(r.numero), login_zello: limpo(r.login_zello) }))
  });
}

async function listar({ res, db }) {
  const todos = await lerTodos(db);
  const P = R.pendencias(todos);
  return res.status(200).json({ aparelhos: todos.map(a => Object.assign(semSegredos(a), { pend: P[a.id] || [] })) });
}

async function senhas({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o aparelho.", "SEM_ID");
  const [a] = await db.obter(`${TABELA}?select=id,cliente,senha_gmail,senha_zello,applock&id=eq.${id}`);
  if (!a) return erro(res, 404, "Aparelho não encontrado.", "NAO_ENCONTRADO");
  await registrar(db, ator, "CEL_SENHAS_VISTAS", id, null, { cliente: a.cliente || null }); // sem registro, não sai
  return res.status(200).json({ id: a.id, senha_gmail: a.senha_gmail || "", senha_zello: a.senha_zello || "", applock: a.applock || "" });
}

async function exportar({ res, db, ator }) {
  const todos = await lerTodos(db);
  await registrar(db, ator, "CEL_EXPORTADO", "todos", null, { quantos: todos.length });
  const P = R.pendencias(todos);
  return res.status(200).json({ aparelhos: todos.map(a => Object.assign({}, a, { pend: P[a.id] || [] })), colunas: R.COLUNAS_EXCEL });
}

async function criar({ res, db, ator, body }) {
  const v = R.validar(body, false);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const agora = new Date().toISOString();
  const [novo] = await db.upsert(TABELA, [Object.assign({}, v.campos, { criado_por: ator, atualizado_por: ator, atualizado_em: agora })], "id", { retornar: true });
  await registrarDepois(db, ator, "CEL_CRIADO", novo ? novo.id : "?", null, publico(v.campos));
  return res.status(201).json({ ok: true, id: novo ? novo.id : null });
}

async function alterar({ req, res, db, ator, body }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o aparelho.", "SEM_ID");
  const v = R.validar(body, true);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const [antes] = await db.obter(`${TABELA}?select=*&id=eq.${id}`);
  if (!antes) return erro(res, 404, "Aparelho não encontrado.", "NAO_ENCONTRADO");
  const txt = x => x == null ? null : String(x);
  const mudou = Object.keys(v.campos).filter(c => txt(antes[c]) !== txt(v.campos[c]));
  if (!mudou.length) return res.status(200).json({ ok: true, mudou: [] });
  const patch = {};
  mudou.forEach(c => { patch[c] = v.campos[c]; });
  await db.atualizar(`${TABELA}?id=eq.${id}`, Object.assign({}, patch, { atualizado_em: new Date().toISOString(), atualizado_por: ator }));
  await registrarDepois(db, ator, "CEL_ALTERADO", id, resumo(antes, mudou), resumo(patch, mudou));
  return res.status(200).json({ ok: true, mudou });
}

async function apagar({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o aparelho.", "SEM_ID");
  const [antes] = await db.obter(`${TABELA}?select=*&id=eq.${id}`);
  if (!antes) return erro(res, 404, "Aparelho não encontrado.", "NAO_ENCONTRADO");
  await db.remover(`${TABELA}?id=eq.${id}`);
  await registrarDepois(db, ator, "CEL_APAGADO", id, publico(antes), null);
  return res.status(200).json({ ok: true });
}

// A importação só acrescenta: aparelho que já está no painel (digitado igual) é ignorado.
// Corrigir um aparelho é na tela, não reimportando a planilha.
async function importar({ res, db, ator, body }) {
  const lida = R.lerPlanilha(body.linhas);
  if (lida.erro) return erro(res, 400, lida.erro, "PLANILHA");
  const atuais = await db.listar(`${TABELA}?select=${IDENTIDADE}&order=id.asc`);
  const vistos = new Set(atuais.map(R.impressao));
  const novos = [];
  let iguais = 0;
  for (const a of lida.aparelhos) {
    const k = R.impressao(a);
    if (vistos.has(k)) { iguais++; continue; }
    vistos.add(k);
    novos.push(a);
  }
  const previa = {
    lidos: lida.aparelhos.length, novos: novos.length, iguais, vazias: lida.vazias,
    colunas: lida.colunas, naoReconhecidas: lida.naoReconhecidas,
    internos: novos.filter(a => a.tipo === "INTERNO").length
  };
  if (!body.confirmar || !novos.length) return res.status(200).json({ ok: true, previa, inseridos: 0 });
  const agora = new Date().toISOString();
  await db.inserir(TABELA, novos.map(a => Object.assign({}, a, { criado_por: ator, atualizado_por: ator, atualizado_em: agora })));
  await registrarDepois(db, ator, "CEL_IMPORTADO", "planilha", null, { inseridos: novos.length, iguais });
  return res.status(200).json({ ok: true, previa, inseridos: novos.length });
}

// Completa o DDD dos números que estão sem (só dos aparelhos não baixados). Só troca o número se ele
// ainda for o mesmo da prévia: quem editou no meio do caminho não é atropelado.
async function completarDDD({ res, db, ator, body }) {
  const ddd = String(body.ddd || "").trim();
  if (!/^[1-9][1-9]$/.test(ddd)) return erro(res, 400, "DDD inválido.", "INVALIDO");
  const alvo = R.semDDD(await db.listar(`${TABELA}?select=id,cliente,numero,situacao&order=id.asc`));
  const previa = { quantos: alvo.length, exemplos: alvo.slice(0, 5).map(a => ({ cliente: a.cliente, antes: a.numero, depois: R.comDDD(a.numero, ddd) })) };
  if (!body.confirmar || !alvo.length) return res.status(200).json({ ok: true, previa, alterados: 0 });
  const agora = new Date().toISOString();
  for (let i = 0; i < alvo.length; i += 10) {
    await Promise.all(alvo.slice(i, i + 10).map(a => db.atualizar(
      `${TABELA}?id=eq.${a.id}&numero=eq.${encodeURIComponent(a.numero)}`,
      { numero: R.comDDD(a.numero, ddd), atualizado_em: agora, atualizado_por: ator })));
  }
  await registrarDepois(db, ator, "CEL_DDD", "numeros", null, { ddd, quantos: alvo.length });
  return res.status(200).json({ ok: true, previa, alterados: alvo.length });
}

const ROTAS = {
  "GET contatos": { fn: contatos, todos: true },
  "GET ": { fn: listar },
  "GET senhas": { fn: senhas },
  "GET exportar": { fn: exportar },
  "POST ": { fn: criar },
  "PATCH ": { fn: alterar },
  "DELETE ": { fn: apagar },
  "POST importar": { fn: importar },
  "POST ddd": { fn: completarDDD }
};

module.exports = async function celulares(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  res.setHeader("Cache-Control", "no-store");
  try {
    const ator = quemPede(req);
    if (!rota.todos && !(await temAGuia(db, ator))) return erro(res, 403, "Só quem tem a guia Celulares.", "NAO_AUTORIZADO");
    return await rota.fn({ req, res, db, ator, body: req.body || {} });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[celulares] " + msg);
    // deploy antes de a tabela existir: a tela explica em vez de mostrar "erro no banco"
    if (/cel_aparelhos/.test(msg) && /\b(404|42P01|PGRST205)\b/.test(msg)) return erro(res, 503, "A tabela dos celulares ainda não foi criada no banco.", "SEM_TABELA");
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
