// api/_agenda.js — Agenda Comercial. Passa pelo api/rh.js porque o plano Hobby da Vercel já está nas 12 funções.
// As regras (horários livres, validação, .ics) moram em api/_agenda_regras.js.
//
// Administração (/api/rh?modulo=agenda, com login — o rh.js já conferiu o token e o bloqueio):
//   só a administradora da agenda (GESTORES), os administradores do painel e quem recebeu a guia em
//   Configurações › 👁️ Guias (app_users.perms.guias.agenda).
//   GET                  tudo: configuração, tipos, bloqueios, reuniões e o endereço da assinatura do iPhone
//   POST t=config        horário de atendimento, intervalo, antecedência, janela e passo
//   POST t=tipo          cria (ou altera, com id) um tipo de reunião · DELETE t=tipo&id= desativa
//   POST t=bloqueio      bloqueia um horário ou dias inteiros       · DELETE t=bloqueio&id= tira
//   POST t=reuniao       reunião cadastrada à mão · PATCH t=reuniao&id= remarca · POST t=cancelar&id= cancela
//   POST t=ics           troca a chave da assinatura do iPhone (a antiga para de funcionar)
//
// Pública (/api/rh?modulo=agendapub, SEM login — quem marca não tem conta; entra antes da exigência de token):
//   GET  t=horarios&s=   o tipo de reunião e os horários livres (nada de quem já marcou)
//   POST t=agendar       marca um horário livre
//   GET  t=ics&k=        a assinatura do iPhone da Comercial (.ics), só com a chave secreta
//   GET  t=convite&id=&c= o convite (.ics) de UMA reunião para quem marcou pôr na própria agenda; o c é uma
//                        assinatura (HMAC) que só a resposta do agendamento conhece
//
// Reunião em cima de reunião: o banco recusa (restrição de exclusão em ag_reunioes, com o intervalo incluído).
// Antes de gravar, a API também confere; quem perde a corrida recebe 409 "horário acabou de ser ocupado".

"use strict";

const crypto = require("crypto");
const _auth = require("./_auth");
const ponto = require("./_ponto");
const R = require("./_agenda_regras");
const ICS = require("./_agenda_ics");
const ADMINS = require("./users").ADMINS;

// Administradora da agenda: vai ser a Gabriela, do Comercial. Por enquanto (pedido do João em 05/11/2026)
// fica só com os administradores do painel até a agenda estar completa; para liberar, pôr "gabrielaalvarenga"
// aqui e no navOk.agenda do index.html.
const GESTORES = [];
const ENTIDADE = "agenda";
const MAX_ATIVAS_POR_CONTATO = 2;   // pelo link, o mesmo telefone/e-mail não segura mais que isso no futuro
const MAX_POR_IP_HORA = 5;          // e o mesmo endereço de internet não marca mais que isso por hora
const DIR_ATUALIZA_MIN = 5;         // o calendário de cada diretor é relido no máximo a cada 5 minutos
const DIR_VALIDO_H = 6;             // sem conseguir ler há mais que isso, o tipo de reunião sai do ar (não arrisca marcar em cima do diretor)
const DIR_DIAS = 130;               // quantos dias à frente se guardam dos compromissos do diretor

const erro = (res, status, mensagem, codigo) => res.status(status).json({ error: mensagem, codigo });
const enc = encodeURIComponent;
const iso = ms => new Date(ms).toISOString();
const ipDe = req => String(((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "")).split(",")[0].trim().slice(0, 64);
const idDe = req => { const id = String((req.query && req.query.id) || ""); return /^\d{1,12}$/.test(id) ? id : null; };
const novaChave = n => crypto.randomBytes(n).toString("base64url");
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const conflito = e => /\b409\b/.test(String(e && e.message)) && /23P01|ag_reunioes_sem_sobreposicao/.test(String(e && e.message));
// assinatura do convite de uma reunião: sem ela, ninguém baixa o convite de reunião alheia trocando o id
const segredo = () => process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const assinarConvite = id => crypto.createHmac("sha256", segredo()).update("agenda-convite:" + id).digest("base64url").slice(0, 32);
const semTabela = e => /\bag_/.test(String(e && e.message)) && /\b(404|42P01|PGRST205)\b/.test(String(e && e.message));

function quemPede(req) {
  const ga = _auth.requireAuth(req);
  return ga.ok && ga.enforced && ga.user && !ga.user.s && ga.user.u ? String(ga.user.u) : null;
}
async function podeAdministrar(db, ator) {
  if (!ator) return false;
  if (ADMINS.indexOf(ator) >= 0 || GESTORES.indexOf(ator) >= 0) return true;
  const [u] = await db.obter(`app_users?select=user_key,nome,perms,ativo&user_key=eq.${enc(ator)}&limit=1`);
  if (!u || u.ativo === false) return false;
  const p = (u.perms && typeof u.perms === "object") ? u.perms : {};
  return !!((u.nome && p.admin === true) || (p.guias && p.guias.agenda === true));
}
function registrar(db, ator, acao, chave, depois) {
  return db.inserir("fm_auditoria", [{ ator: ator || null, acao, entidade: ENTIDADE, chave: String(chave), antes: null, depois: depois || null }])
    .catch(e => console.error("[agenda] registro:", e && e.message));
}

// ── leitura comum ───────────────────────────────────────────────────────────

// Configuração (uma linha só). Na primeira vez cria com os padrões, a chave do iPhone e os tipos iniciais.
async function lerConfig(db) {
  let [c] = await db.obter("ag_config?select=*&id=eq.1&limit=1");
  if (!c) {
    await db.upsert("ag_config", [Object.assign({ id: 1, ics_chave: novaChave(24) }, R.CONFIG_PADRAO)], "id", { ignorar: true });
    [c] = await db.obter("ag_config?select=*&id=eq.1&limit=1");
    const tipos = await db.listar("ag_tipos?select=id&order=id.asc");
    if (!tipos.length) await db.inserir("ag_tipos", R.TIPOS_PADRAO.map(t => Object.assign({ slug: novaChave(6), ativo: true }, t)));
  }
  return c;
}
const cfgDe = c => ({ semana: c.semana || {}, intervalo_min: c.intervalo_min, antecedencia_h: c.antecedencia_h, janela_dias: c.janela_dias, passo_min: c.passo_min });

async function ocupacao(db, de, ate, ignorarId) {
  const [reunioes, bloqueios] = await Promise.all([
    db.listar(`ag_reunioes?select=id,inicio,ocupa_ate&status=eq.ativa&ocupa_ate=gt.${iso(de)}&inicio=lt.${iso(ate)}&order=inicio.asc`),
    db.listar(`ag_bloqueios?select=inicio,fim&fim=gt.${iso(de)}&inicio=lt.${iso(ate)}&order=inicio.asc`)
  ]);
  return { ocupados: reunioes.filter(r => String(r.id) !== String(ignorarId || "")), bloqueios };
}
async function bate(db, f, ignorarId) {
  const { ocupados } = await ocupacao(db, f.inicio, f.ocupa_ate, ignorarId);
  return ocupados.length > 0;
}

// ── diretores: calendário público do iCloud ─────────────────────────────────

// Só guarda os horários OCUPADOS (sem título, local ou convidados). O link do calendário é segredo de quem o
// criou (qualquer um com o link lê os compromissos), então nunca volta inteiro para a tela.
async function baixarIcs(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { Accept: "text/calendar" } });
    if (!r.ok) throw new Error("O calendário respondeu " + r.status);
    if (r.url && !ICS.normalizarUrl(r.url)) throw new Error("O calendário mandou para um endereço não aceito.");
    const txt = await r.text();
    if (txt.length > 6 * 1024 * 1024) throw new Error("Calendário grande demais.");
    if (!/BEGIN:VCALENDAR/i.test(txt)) throw new Error("Esse link não é de um calendário.");
    return txt;
  } finally { clearTimeout(t); }
}
const velho = (d, agora) => !d.lido_em || agora - +new Date(d.lido_em) > DIR_ATUALIZA_MIN * 60000;
const valido = (d, agora) => !!d.lido_em && agora - +new Date(d.lido_em) <= DIR_VALIDO_H * 3600000;

// Relê o calendário e guarda. Falhou: guarda o motivo e mantém a última leitura boa.
async function atualizarDiretor(db, d, agora) {
  try {
    const url = ICS.normalizarUrl(d.url);
    if (!url) throw new Error("Link de calendário inválido.");
    const ocupado = ICS.ocupados(await baixarIcs(url), agora - 86400000, agora + DIR_DIAS * 86400000);
    const novo = { ocupado, lido_em: iso(agora), erro: null };
    await db.atualizar(`ag_diretores?id=eq.${d.id}`, novo);
    return novo;
  } catch (e) {
    const erro = String((e && e.name === "AbortError") ? "O calendário demorou demais para responder." : (e && e.message) || e).slice(0, 200);
    await db.atualizar(`ag_diretores?id=eq.${d.id}`, { erro }).catch(() => {});
    return { erro };
  }
}
async function diretoresDoTipo(db, tipo, agora) {
  const ids = (Array.isArray(tipo.diretores) ? tipo.diretores : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  const ds = await db.listar(`ag_diretores?select=id,nome,url,ocupado,lido_em,erro&ativo=is.true&id=in.(${ids.join(",")})&order=id.asc`);
  await Promise.all(ds.filter(d => velho(d, agora)).map(async d => Object.assign(d, await atualizarDiretor(db, d, agora))));
  return ds;
}
// Horários em que algum diretor exigido pelo tipo está ocupado. Sem leitura válida de algum deles: indisponível.
async function bloqueiosDosDiretores(db, tipo, agora) {
  const ds = await diretoresDoTipo(db, tipo, agora);
  if (ds.some(d => !valido(d, agora))) return { indisponivel: true, bloqueios: [] };
  const bloqueios = [];
  ds.forEach(d => (d.ocupado || []).forEach(([a, b]) => bloqueios.push({ inicio: iso(a), fim: iso(b) })));
  return { indisponivel: false, bloqueios };
}
const mascarar = u => { try { const x = new URL(ICS.normalizarUrl(u) || u); return x.hostname + "/…" + x.pathname.slice(-6); } catch (e) { return "…"; } };

// ── pública ─────────────────────────────────────────────────────────────────

async function tipoPeloLink(db, s) {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(s || ""))) return null;
  const [t] = await db.obter(`ag_tipos?select=id,nome,duracao_min,local,cor,slug,diretores&slug=eq.${enc(s)}&ativo=is.true&limit=1`);
  return t || null;
}
async function livresPara(db, cfg, tipo, agora) {
  const ate = R.paraUtc(R.somaDias(R.hojeBR(agora), cfg.janela_dias + 1), "00:00");
  const { ocupados, bloqueios } = await ocupacao(db, agora, ate);
  const dir = await bloqueiosDosDiretores(db, tipo, agora);
  if (dir.indisponivel) { const e = new Error("diretor sem leitura válida"); e.indisponivel = true; throw e; }
  return R.horariosLivres(cfg, tipo, ocupados, bloqueios.concat(dir.bloqueios), agora);
}

async function pubHorarios({ req, res, db }) {
  const tipo = await tipoPeloLink(db, req.query.s);
  if (!tipo) return erro(res, 404, "Este link de agendamento não existe ou foi desativado.", "SEM_TIPO");
  const cfg = cfgDe(await lerConfig(db)), agora = Date.now();
  return res.status(200).json({
    tipo: { nome: tipo.nome, duracao_min: tipo.duracao_min, local: tipo.local || null, cor: tipo.cor },
    dias: await livresPara(db, cfg, tipo, agora)
  });
}

async function pubAgendar({ req, res, db }) {
  const b = req.body || {};
  if (b.site) return erro(res, 400, "Não foi possível agendar.", "INVALIDO"); // campo escondido: só robô preenche
  const tipo = await tipoPeloLink(db, b.s);
  if (!tipo) return erro(res, 404, "Este link de agendamento não existe ou foi desativado.", "SEM_TIPO");
  if (!R.DIA.test(String(b.dia || "")) || !R.HORA.test(String(b.hora || ""))) return erro(res, 400, "Escolha um dia e um horário.", "INVALIDO");
  const v = R.validarPessoa(b);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const cfg = cfgDe(await lerConfig(db)), agora = Date.now();
  const livres = await livresPara(db, cfg, tipo, agora);
  if (!(livres[b.dia] || []).includes(b.hora)) return erro(res, 409, "Esse horário não está mais disponível. Escolha outro.", "OCUPADO");

  // limites contra quem tenta lotar a agenda
  const p = v.pessoa, ip = ipDe(req);
  const [futuras, doIp] = await Promise.all([
    db.listar(`ag_reunioes?select=telefone,email&status=eq.ativa&origem=eq.link&inicio=gt.${iso(agora)}&order=id.asc`),
    ip ? db.listar(`ag_reunioes?select=id&origem=eq.link&ip=eq.${enc(ip)}&criado_em=gt.${iso(agora - 3600000)}&order=id.asc`) : Promise.resolve([])
  ]);
  const doContato = futuras.filter(r => r.telefone === p.telefone || (p.email && r.email === p.email));
  if (doContato.length >= MAX_ATIVAS_POR_CONTATO) return erro(res, 429, "Você já tem reuniões marcadas com a gente. Se precisar mudar, fale com o nosso Comercial.", "LIMITE");
  if (doIp.length >= MAX_POR_IP_HORA) return erro(res, 429, "Muitos agendamentos seguidos. Tente de novo mais tarde.", "LIMITE");

  const f = R.faixa(b.dia, b.hora, tipo.duracao_min, cfg.intervalo_min);
  const linha = Object.assign({ tipo_id: tipo.id, tipo_nome: tipo.nome, local: tipo.local || null, inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate), origem: "link", status: "ativa", ip: ip || null, criado_em: iso(agora) }, p);
  let nova;
  try { [nova] = await db.upsert("ag_reunioes", [linha], "id", { retornar: true }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Esse horário acabou de ser ocupado. Escolha outro.", "OCUPADO"); throw e; }
  registrar(db, "link", "AGENDA_MARCADA", nova ? nova.id : "?", { tipo: tipo.nome, inicio: linha.inicio, origem: "link" });
  const id = nova ? nova.id : null;
  return res.status(201).json({ ok: true, tipo: tipo.nome, local: tipo.local || null, dia: b.dia, hora: b.hora, inicio: linha.inicio, fim: linha.fim, duracao_min: tipo.duracao_min,
    convite: id != null ? { id, c: assinarConvite(id) } : null });
}

// O convite de quem marcou: só a reunião dele, sem nada da agenda da Comercial.
async function pubConvite({ req, res, db }) {
  const id = idDe(req), c = String((req.query && req.query.c) || "");
  if (!id || !segredo() || !iguais(c, assinarConvite(id))) return erro(res, 404, "Convite não encontrado.", "SEM_CONVITE");
  const [r] = await db.obter(`ag_reunioes?select=id,tipo_nome,inicio,fim,local,status&id=eq.${id}&limit=1`);
  if (!r) return erro(res, 404, "Convite não encontrado.", "SEM_CONVITE");
  const corpo = R.ics([{ id: "convite-" + r.id, inicio: r.inicio, fim: r.fim, local: r.local, cancelada: r.status !== "ativa",
    titulo: (r.tipo_nome || "Reunião") + " — Grupo ServCamp", descricao: "Reunião com o Comercial do Grupo ServCamp." }]);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="reuniao-servcamp.ics"');
  return res.status(200).send(corpo);
}

async function pubIcs({ req, res, db }) {
  const k = String((req.query && req.query.k) || "");
  const c = await lerConfig(db);
  if (!k || !c.ics_chave || !iguais(k, c.ics_chave)) return erro(res, 404, "Calendário não encontrado.", "SEM_ICS");
  const desde = Date.now() - 60 * 86400000;
  const rs = await db.listar(`ag_reunioes?select=id,tipo_nome,inicio,fim,nome,telefone,email,obs,local,origem,status&fim=gt.${iso(desde)}&order=inicio.asc`);
  const corpo = R.ics(rs.map(r => ({
    id: r.id, inicio: r.inicio, fim: r.fim, local: r.local, cancelada: r.status !== "ativa",
    titulo: (r.status !== "ativa" ? "CANCELADA — " : "") + (r.tipo_nome || "Reunião") + " — " + r.nome,
    descricao: ["Nome: " + r.nome, r.telefone ? "Telefone: " + r.telefone : "", r.email ? "E-mail: " + r.email : "", r.obs ? "Observação: " + r.obs : "", r.origem === "link" ? "Marcada pelo link" : "Cadastrada no painel"].filter(Boolean).join("\n")
  })), { nome: "Agenda Comercial — ServCamp" });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="agenda-comercial.ics"');
  return res.status(200).send(corpo);
}

const ROTAS_PUB = { "GET horarios": pubHorarios, "POST agendar": pubAgendar, "GET ics": pubIcs, "GET convite": pubConvite };

async function publico(req, res) {
  const t = String((req.query && req.query.t) || "");
  const fn = ROTAS_PUB[`${req.method} ${t}`];
  if (!fn) return erro(res, 404, "Rota desconhecida.", "ROTA_DESCONHECIDA");
  res.setHeader("Cache-Control", "no-store");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "Agenda indisponível no momento.", "CONFIG_AUSENTE");
  try { return await fn({ req, res, db }); }
  catch (e) {
    if (e && e.indisponivel) return erro(res, 503, "Os horários estão indisponíveis no momento. Fale com o nosso Comercial para marcar.", "INDISPONIVEL");
    console.error("[agenda pública] " + String((e && e.message) || e));
    return erro(res, 500, "Não foi possível agora. Tente de novo em instantes.", "ERRO");
  }
}

// ── administração ───────────────────────────────────────────────────────────

async function tudo({ res, db }) {
  const c = await lerConfig(db), agora = Date.now();
  const [tipos, bloqueios, reunioes, dirs] = await Promise.all([
    db.listar("ag_tipos?select=id,nome,duracao_min,local,cor,slug,ativo,ordem,diretores&order=ordem.asc,id.asc"),
    db.listar(`ag_bloqueios?select=id,inicio,fim,motivo&fim=gt.${iso(agora - 90 * 86400000)}&order=inicio.asc`),
    db.listar(`ag_reunioes?select=id,tipo_id,tipo_nome,inicio,fim,nome,telefone,email,obs,local,origem,status,criado_em&inicio=gt.${iso(agora - 90 * 86400000)}&order=inicio.asc`),
    db.listar("ag_diretores?select=id,nome,url,ativo,ocupado,lido_em,erro&order=id.asc")
  ]);
  await Promise.all(dirs.filter(d => d.ativo && velho(d, agora)).map(async d => Object.assign(d, await atualizarDiretor(db, d, agora))));
  const ate = agora + 90 * 86400000, ocupados = [];
  dirs.filter(d => d.ativo).forEach(d => (d.ocupado || []).forEach(([a, b]) => { if (b > agora - 7 * 86400000 && a < ate) ocupados.push({ dir: d.id, nome: d.nome, inicio: iso(a), fim: iso(b) }); }));
  const diretores = dirs.map(d => ({ id: d.id, nome: d.nome, ativo: d.ativo, lido_em: d.lido_em, erro: d.erro || null, valido: valido(d, agora), link: mascarar(d.url), compromissos: (d.ocupado || []).filter(([a, b]) => b > agora && a < ate).length }));
  return res.status(200).json({ config: cfgDe(c), ics_chave: c.ics_chave, tipos, bloqueios, reunioes, diretores, ocupados });
}

async function salvarConfig({ res, db, ator, body }) {
  const v = R.validarConfig(body);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  await lerConfig(db);
  await db.atualizar("ag_config?id=eq.1", Object.assign({}, v.config, { atualizado_em: iso(Date.now()), atualizado_por: ator }));
  registrar(db, ator, "AGENDA_CONFIG", "config", v.config);
  return res.status(200).json({ ok: true });
}

async function salvarTipo({ req, res, db, ator, body }) {
  const v = R.validarTipo(body);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const id = body.id != null && /^\d{1,12}$/.test(String(body.id)) ? String(body.id) : null;
  if (id) await db.atualizar(`ag_tipos?id=eq.${id}`, v.tipo);
  else await db.inserir("ag_tipos", [Object.assign({ slug: novaChave(6), ordem: 99 }, v.tipo)]);
  registrar(db, ator, id ? "AGENDA_TIPO_ALTERADO" : "AGENDA_TIPO_CRIADO", id || v.tipo.nome, v.tipo);
  return res.status(200).json({ ok: true });
}
// Cadastra (ou altera, com id) um diretor. Link novo: lê na hora para avisar se não funciona.
async function salvarDiretor({ res, db, ator, body }) {
  const nome = String(body.nome || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
  if (nome.length < 2) return erro(res, 400, "Informe o nome do diretor.", "INVALIDO");
  const id = body.id != null && /^\d{1,12}$/.test(String(body.id)) ? String(body.id) : null;
  const temUrl = String(body.url || "").trim() !== "";
  let url = null;
  if (temUrl || !id) {
    url = ICS.normalizarUrl(body.url);
    if (!url) return erro(res, 400, "Esse não parece um link de calendário do iCloud. Copie o link em Calendário › Calendário Público › Compartilhar Link.", "LINK_INVALIDO");
  }
  const agora = Date.now();
  let lido = null;
  if (url) {
    try { lido = ICS.ocupados(await baixarIcs(url), agora - 86400000, agora + DIR_DIAS * 86400000); }
    catch (e) { return erro(res, 400, "Não consegui ler esse calendário (" + String((e && e.message) || e).slice(0, 120) + "). Confira se ele está como Calendário Público e copie o link de novo.", "LINK_ILEGIVEL"); }
  }
  if (id) {
    const patch = { nome, ativo: body.ativo !== false };
    if (url) Object.assign(patch, { url, ocupado: lido, lido_em: iso(agora), erro: null });
    await db.atualizar(`ag_diretores?id=eq.${id}`, patch);
  } else {
    await db.inserir("ag_diretores", [{ nome, url, ativo: true, ocupado: lido, lido_em: iso(agora), criado_por: ator }]);
  }
  registrar(db, ator, id ? "AGENDA_DIRETOR_ALTERADO" : "AGENDA_DIRETOR_CRIADO", id || nome, { nome }); // o link não vai para o registro
  return res.status(200).json({ ok: true, compromissos: lido ? lido.length : null });
}
async function atualizarDiretores({ req, res, db }) {
  const id = idDe(req), agora = Date.now();
  const ds = await db.listar(`ag_diretores?select=id,nome,url&ativo=is.true${id ? "&id=eq." + id : ""}&order=id.asc`);
  const r = await Promise.all(ds.map(d => atualizarDiretor(db, d, agora)));
  return res.status(200).json({ ok: true, lidos: r.filter(x => !x.erro).length, falhas: r.filter(x => x.erro).map((x, i) => ({ nome: ds[i].nome, erro: x.erro })) });
}
async function tirarDiretor({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o diretor.", "SEM_ID");
  const tipos = await db.listar("ag_tipos?select=id,diretores&order=id.asc");
  for (const t of tipos) {
    const ids = (Array.isArray(t.diretores) ? t.diretores : []).map(Number);
    if (ids.includes(Number(id))) await db.atualizar(`ag_tipos?id=eq.${t.id}`, { diretores: ids.filter(n => n !== Number(id)) });
  }
  await db.remover(`ag_diretores?id=eq.${id}`);
  registrar(db, ator, "AGENDA_DIRETOR_TIRADO", id, null);
  return res.status(200).json({ ok: true });
}

async function desativarTipo({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o tipo.", "SEM_ID");
  await db.atualizar(`ag_tipos?id=eq.${id}`, { ativo: false });
  registrar(db, ator, "AGENDA_TIPO_DESATIVADO", id, null);
  return res.status(200).json({ ok: true });
}

// { dia, ateDia?, de?, ate?, motivo } — sem de/ate é o dia (ou os dias) inteiro
async function criarBloqueio({ res, db, ator, body }) {
  const dia = String(body.dia || ""), ateDia = String(body.ateDia || body.dia || "");
  if (!R.DIA.test(dia) || !R.DIA.test(ateDia) || ateDia < dia) return erro(res, 400, "Datas inválidas.", "INVALIDO");
  const de = body.de ? String(body.de) : null, ate = body.ate ? String(body.ate) : null;
  if ((de && !R.HORA.test(de)) || (ate && !R.HORA.test(ate))) return erro(res, 400, "Horário inválido: use HH:MM.", "INVALIDO");
  const inicio = R.paraUtc(dia, de || "00:00");
  const fim = ate ? R.paraUtc(ateDia, ate) : R.paraUtc(R.somaDias(ateDia, 1), "00:00");
  if (fim <= inicio) return erro(res, 400, "O fim do bloqueio precisa ser depois do início.", "INVALIDO");
  const motivo = String(body.motivo || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || null;
  await db.inserir("ag_bloqueios", [{ inicio: iso(inicio), fim: iso(fim), motivo, criado_por: ator }]);
  registrar(db, ator, "AGENDA_BLOQUEIO", dia, { inicio: iso(inicio), fim: iso(fim), motivo });
  return res.status(200).json({ ok: true });
}
async function tirarBloqueio({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o bloqueio.", "SEM_ID");
  await db.remover(`ag_bloqueios?id=eq.${id}`);
  registrar(db, ator, "AGENDA_BLOQUEIO_TIRADO", id, null);
  return res.status(200).json({ ok: true });
}

// Reunião cadastrada à mão: qualquer horário (a Comercial decide), mas nunca em cima de outra.
async function criarReuniao({ res, db, ator, body }) {
  if (!R.DIA.test(String(body.dia || "")) || !R.HORA.test(String(body.hora || ""))) return erro(res, 400, "Escolha o dia e o horário.", "INVALIDO");
  const [tipo] = /^\d{1,12}$/.test(String(body.tipo_id || "")) ? await db.obter(`ag_tipos?select=id,nome,duracao_min,local&id=eq.${body.tipo_id}&limit=1`) : [];
  if (!tipo) return erro(res, 400, "Escolha o tipo de reunião.", "INVALIDO");
  const v = R.validarPessoa(body, { telefoneOpcional: true });
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const cfg = cfgDe(await lerConfig(db));
  const f = R.faixa(body.dia, body.hora, tipo.duracao_min, cfg.intervalo_min);
  if (await bate(db, f)) return erro(res, 409, "Já existe reunião nesse horário (contando o intervalo entre reuniões).", "OCUPADO");
  const linha = Object.assign({ tipo_id: tipo.id, tipo_nome: tipo.nome, local: tipo.local || null, inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate), origem: "manual", status: "ativa", criado_por: ator, criado_em: iso(Date.now()) }, v.pessoa);
  let nova;
  try { [nova] = await db.upsert("ag_reunioes", [linha], "id", { retornar: true }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Já existe reunião nesse horário.", "OCUPADO"); throw e; }
  registrar(db, ator, "AGENDA_MARCADA", nova ? nova.id : "?", { tipo: tipo.nome, inicio: linha.inicio, origem: "manual" });
  return res.status(201).json({ ok: true, id: nova ? nova.id : null });
}

async function remarcar({ req, res, db, ator, body }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe a reunião.", "SEM_ID");
  if (!R.DIA.test(String(body.dia || "")) || !R.HORA.test(String(body.hora || ""))) return erro(res, 400, "Escolha o novo dia e horário.", "INVALIDO");
  const [r] = await db.obter(`ag_reunioes?select=id,inicio,fim,status&id=eq.${id}&limit=1`);
  if (!r || r.status !== "ativa") return erro(res, 404, "Reunião não encontrada (ou já cancelada).", "NAO_ENCONTRADA");
  const cfg = cfgDe(await lerConfig(db));
  const dur = Math.round((+new Date(r.fim) - +new Date(r.inicio)) / 60000);
  const f = R.faixa(body.dia, body.hora, dur, cfg.intervalo_min);
  if (await bate(db, f, id)) return erro(res, 409, "Já existe reunião nesse horário (contando o intervalo entre reuniões).", "OCUPADO");
  try { await db.atualizar(`ag_reunioes?id=eq.${id}&status=eq.ativa`, { inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate) }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Já existe reunião nesse horário.", "OCUPADO"); throw e; }
  registrar(db, ator, "AGENDA_REMARCADA", id, { de: r.inicio, para: iso(f.inicio) });
  return res.status(200).json({ ok: true });
}

async function cancelar({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe a reunião.", "SEM_ID");
  await db.atualizar(`ag_reunioes?id=eq.${id}&status=eq.ativa`, { status: "cancelada", cancelado_em: iso(Date.now()), cancelado_por: ator });
  registrar(db, ator, "AGENDA_CANCELADA", id, null);
  return res.status(200).json({ ok: true });
}

async function trocarIcs({ res, db, ator }) {
  await lerConfig(db);
  const k = novaChave(24);
  await db.atualizar("ag_config?id=eq.1", { ics_chave: k });
  registrar(db, ator, "AGENDA_ICS_TROCADA", "ics", null);
  return res.status(200).json({ ok: true, ics_chave: k });
}

const ROTAS = {
  "GET ": tudo, "POST config": salvarConfig, "POST tipo": salvarTipo, "DELETE tipo": desativarTipo,
  "POST bloqueio": criarBloqueio, "DELETE bloqueio": tirarBloqueio,
  "POST diretor": salvarDiretor, "POST atualizar": atualizarDiretores, "DELETE diretor": tirarDiretor,
  "POST reuniao": criarReuniao, "PATCH reuniao": remarcar, "POST cancelar": cancelar, "POST ics": trocarIcs
};

module.exports = async function agenda(req, res) {
  const t = String((req.query && req.query.t) || "");
  const fn = ROTAS[`${req.method} ${t}`];
  if (!fn) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  res.setHeader("Cache-Control", "no-store");
  try {
    const ator = quemPede(req);
    if (!(await podeAdministrar(db, ator))) return erro(res, 403, "Só a administradora da agenda.", "NAO_AUTORIZADO");
    return await fn({ req, res, db, ator, body: req.body || {} });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[agenda] " + msg);
    if (semTabela(e)) return erro(res, 503, "As tabelas da agenda ainda não foram criadas no banco.", "SEM_TABELA");
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
module.exports.publico = publico;
module.exports.GESTORES = GESTORES;
