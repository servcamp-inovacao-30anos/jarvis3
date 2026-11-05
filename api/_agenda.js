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
//   POST t=marca         quem atende (nome, cargo, foto) e a mensagem de boas-vindas da página e dos e-mails
//   POST t=resultado&id= reunião que já começou: realizada ou não compareceu, próximo passo e anotação
//   GET  t=numeros&mes=  os números do mês para o Painel Comercial (só contagens, sem dados de ninguém)
//   POST t=modalidade    { dia, modalidade }: neste dia só online, só presencial, os dois ou volta ao padrão
//
// Pública (/api/rh?modulo=agendapub, SEM login — quem marca não tem conta; entra antes da exigência de token):
//   GET  t=horarios&s=   o tipo de reunião e os horários livres (nada de quem já marcou)
//   POST t=agendar       marca um horário livre
//   GET  t=ics&k=        a assinatura do iPhone da Comercial (.ics), só com a chave secreta
//   GET  t=foto          a foto de quem atende (página e e-mails)
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
const EMAIL = require("./_agenda_email");
const ZAP = require("./_agenda_whatsapp");
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
const CANCELA_ATE_H = 2;            // o cliente remarca ou cancela pelo link até 2 horas antes
const MAX_REMARCACOES = 2;          // e remarca no máximo 2 vezes pelo link (depois, fala com o Comercial)
// Os números da agenda no Painel Comercial: enquanto a agenda não for liberada, só quem administra a agenda
// vê. Ao liberar para a Gabriela, pôr true: aí quem tem o Painel Comercial (perms.comDash) também vê.
const NUMEROS_NO_PAINEL = false;

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
// Código do link "remarcar ou cancelar" de UMA reunião: <id>.<assinatura>. É calculado (HMAC), não guardado:
// serve para o e-mail de confirmação, o lembrete e a tela de confirmação, e ninguém chega à reunião dos outros.
const assinarGerenciar = id => crypto.createHmac("sha256", segredo()).update("agenda-gerenciar:" + id).digest("base64url").slice(0, 32);
const codigoDe = id => id + "." + assinarGerenciar(id);
const idDoCodigo = c => { const m = String(c || "").match(/^(\d{1,12})\.([A-Za-z0-9_-]{32})$/); return m && segredo() && iguais(m[2], assinarGerenciar(m[1])) ? m[1] : null; };
// endereço do painel para os links dos e-mails: o que a pessoa usou, senão PAINEL_URL
function baseUrl(req) {
  const h = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(h) && !/^localhost|^127\./.test(h)) return "https://" + h;
  return String(process.env.PAINEL_URL || "").trim().replace(/\/+$/, "");
}
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
const cfgDe = c => ({ semana: c.semana || {}, intervalo_min: c.intervalo_min, antecedencia_h: c.antecedencia_h, janela_dias: c.janela_dias, passo_min: c.passo_min, email_aviso: c.email_aviso || null,
  modalidade_semana: c.modalidade_semana || {}, modalidade_dias: c.modalidade_dias || {} });

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

// ── quem atende (página do cliente e e-mails) ─────────────────────────────
// A foto mora no banco (já reduzida pela tela) e sai por /api/rh?modulo=agendapub&t=foto; o v= muda quando a
// foto muda, para o navegador e o e-mail não mostrarem a antiga.
const fotoUrl = (c, base) => c && c.anfitriao_foto ? (base || "") + "/api/rh?modulo=agendapub&t=foto&v=" + crypto.createHash("sha1").update(String(c.anfitriao_foto)).digest("hex").slice(0, 10) : null;
const marcaDe = (c, base) => ({ nome: (c && c.anfitriao_nome) || null, cargo: (c && c.anfitriao_cargo) || null, boas_vindas: (c && c.boas_vindas) || null, foto: fotoUrl(c, base) });
const extraMarca = (c, base) => ({ anfitriao: marcaDe(c, base), base: base || null });

// ── e-mails ────────────────────────────────────────────────────────────────

// Dados de uma reunião para os textos dos e-mails
const dadosMail = (r, tipo, base, extra) => Object.assign({
  id: r.id, tipo: r.tipo_nome || (tipo && tipo.nome) || "Reunião", nome: r.nome, telefone: r.telefone, email: r.email, obs: r.obs, origem: r.origem,
  inicio: +new Date(r.inicio), fim: +new Date(r.fim), duracao_min: Math.round((+new Date(r.fim) - +new Date(r.inicio)) / 60000), local: r.local || null, modalidade: r.modalidade || null,
  cor: (tipo && tipo.cor) || null, gerenciar: base ? base + "/agendar.html?r=" + codigoDe(r.id) : null
}, extra || {});
const paraAviso = cfg => (cfg && cfg.email_aviso) || process.env.MAIL_USER || null;
const resumoZap = r => r.naoTenta ? "não enviado: " + (r.motivo || "") : (r.ok ? "enviado" : "falhou: " + (r.motivo || "erro"));
// pausa entre um WhatsApp e outro nos lembretes em lote (o WhatsApp desconfia de rajada)
let pausaWaMs = 2000;
const pausaWa = () => pausaWaMs > 0 ? new Promise(r => setTimeout(r, pausaWaMs)) : Promise.resolve();
const resumoEnvio = (r, tem) => !tem ? "sem e-mail" : (r.ok ? "enviado" : "falhou: " + (r.motivo || "erro"));
// Nada aqui lança: o e-mail é um extra, a reunião já está gravada.
async function emailMarcada(db, r, tipo, cfg, base, opcoes) {
  try {
    const m = dadosMail(r, tipo, base, extraMarca(cfg, base));
    const [cli, av, zap] = await Promise.all([
      r.email && !(opcoes && opcoes.semAviso) ? EMAIL.enviar(Object.assign({ para: r.email, convite: EMAIL.convite(m) }, EMAIL.confirmacao(m))) : Promise.resolve({ ok: false, motivo: "sem e-mail" }),
      (opcoes && opcoes.semComercial) ? Promise.resolve(null) : EMAIL.enviar(Object.assign({ para: paraAviso(cfg) }, EMAIL.aviso(Object.assign({ acao: "nova" }, m)))),
      ZAP.enviar({ telefone: r.telefone, texto: ZAP.confirmacao(m) })
    ]);
    const zapStatus = resumoZap(zap);
    // o aviso da Comercial também fica registrado: se ele falhar, ela precisa saber que não foi avisada
    const status = resumoEnvio(cli, !!r.email) + (av && !av.ok ? " · aviso à Comercial falhou: " + (av.motivo || "erro") : "");
    await db.atualizar(`ag_reunioes?id=eq.${r.id}`, { email_status: status, whatsapp_status: zapStatus }).catch(() => {});
    return { cliente: status.split(" · ")[0], whatsapp: zapStatus, comercial: av ? (av.ok ? "enviado" : "falhou: " + av.motivo) : null };
  } catch (e) { console.error("[agenda] e-mail:", e && e.message); return { cliente: "falhou", whatsapp: null, comercial: null }; }
}

// ── pública ─────────────────────────────────────────────────────────────────

async function tipoPeloLink(db, s) {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(s || ""))) return null;
  const [t] = await db.obter(`ag_tipos?select=id,nome,duracao_min,local,local_online,cor,slug,diretores&slug=eq.${enc(s)}&ativo=is.true&limit=1`);
  return t || null;
}
async function livresPara(db, cfg, tipo, agora, ignorarId) {
  const ate = R.paraUtc(R.somaDias(R.hojeBR(agora), cfg.janela_dias + 1), "00:00");
  const { ocupados, bloqueios } = await ocupacao(db, agora, ate, ignorarId);
  const dir = await bloqueiosDosDiretores(db, tipo, agora);
  if (dir.indisponivel) { const e = new Error("diretor sem leitura válida"); e.indisponivel = true; throw e; }
  return R.horariosLivres(cfg, tipo, ocupados, bloqueios.concat(dir.bloqueios), agora);
}

async function pubHorarios({ req, res, db }) {
  const tipo = await tipoPeloLink(db, req.query.s);
  if (!tipo) return erro(res, 404, "Este link de agendamento não existe ou foi desativado.", "SEM_TIPO");
  const cfgL = await lerConfig(db), cfg = cfgDe(cfgL), agora = Date.now();
  // remarcando pelo link: o horário atual da própria reunião não conta como ocupado
  const rid = req.query.r ? idDoCodigo(req.query.r) : null;
  let ignorar = null, sua = null;
  if (rid) { const [m] = await db.obter(`ag_reunioes?select=id,tipo_id,status,modalidade&id=eq.${rid}&limit=1`); if (m && m.status === "ativa" && String(m.tipo_id) === String(tipo.id)) { ignorar = m.id; sua = m.modalidade || null; } }
  const dias = await livresPara(db, cfg, tipo, agora, ignorar), modalidades = {};
  for (const d of Object.keys(dias)) {
    const md = R.modalidadeDoDia(cfg, d);
    if (sua && !R.aceita(md, sua)) { delete dias[d]; continue; }
    modalidades[d] = md;
  }
  return res.status(200).json({
    tipo: { nome: tipo.nome, duracao_min: tipo.duracao_min, local: tipo.local || null, local_online: tipo.local_online || null, cor: tipo.cor },
    marca: marcaDe(cfgL, ""),
    dias, modalidades, modalidade: sua
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
  // online ou presencial: o dia precisa aceitar o que a pessoa escolheu (dia de um só jeito já decide sozinho)
  const md = R.modalidadeDoDia(cfg, b.dia);
  const modalidade = md === "ambos" ? String(b.modalidade || "") : (b.modalidade ? String(b.modalidade) : md);
  // (página antiga em cache não manda nada: em dia que aceita os dois, fica "não definida")
  if (modalidade && !R.MODALIDADES[modalidade]) return erro(res, 400, "Escolha se a reunião é online ou presencial.", "INVALIDO");
  if (modalidade && !R.aceita(md, modalidade)) return erro(res, 409, "Neste dia a reunião é só " + (md === "online" ? "online" : "presencial") + ". Escolha outro dia.", "MODALIDADE");

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
  const linha = Object.assign({ tipo_id: tipo.id, tipo_nome: tipo.nome, local: modalidade ? R.localDe(tipo, modalidade) : (tipo.local || null), modalidade: modalidade || null, inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate), origem: "link", status: "ativa", ip: ip || null, criado_em: iso(agora) }, p);
  let nova;
  try { [nova] = await db.upsert("ag_reunioes", [linha], "id", { retornar: true }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Esse horário acabou de ser ocupado. Escolha outro.", "OCUPADO"); throw e; }
  registrar(db, "link", "AGENDA_MARCADA", nova ? nova.id : "?", { tipo: tipo.nome, inicio: linha.inicio, origem: "link" });
  const id = nova ? nova.id : null;
  const email = nova ? await emailMarcada(db, Object.assign({}, linha, { id }), tipo, await lerConfig(db), baseUrl(req)) : null;
  return res.status(201).json({ ok: true, tipo: tipo.nome, local: linha.local, modalidade: linha.modalidade, dia: b.dia, hora: b.hora, inicio: linha.inicio, fim: linha.fim, duracao_min: tipo.duracao_min,
    convite: id != null ? { id, c: assinarConvite(id) } : null, gerenciar: id != null ? codigoDe(id) : null, email_cliente: email ? email.cliente : null, whatsapp_cliente: email ? email.whatsapp : null });
}

// ── o cliente mexe na própria reunião (link do e-mail: agendar.html?r=CODIGO) ──

async function reuniaoDoCodigo(db, codigo) {
  const id = idDoCodigo(codigo);
  if (!id) return {};
  const [r] = await db.obter(`ag_reunioes?select=*&id=eq.${id}&limit=1`);
  if (!r) return {};
  const [tipo] = r.tipo_id != null ? await db.obter(`ag_tipos?select=id,nome,duracao_min,local,local_online,cor,slug,ativo,diretores&id=eq.${r.tipo_id}&limit=1`) : [];
  return { r, tipo: tipo || null };
}
const podeMexer = (r, agora) => r.status === "ativa" && +new Date(r.inicio) - agora >= CANCELA_ATE_H * 3600000;

async function pubMinha({ req, res, db }) {
  const { r, tipo } = await reuniaoDoCodigo(db, req.query.r);
  if (!r) return erro(res, 404, "Este link não existe ou não vale mais.", "SEM_REUNIAO");
  const agora = Date.now(), mexe = podeMexer(r, agora);
  const cfgL = await lerConfig(db);
  return res.status(200).json({ // nada de telefone, e-mail ou observação
    marca: marcaDe(cfgL, ""),
    nome: String(r.nome || "").split(/\s+/)[0], status: r.status, inicio: r.inicio, fim: r.fim, local: r.local || null, modalidade: r.modalidade || null,
    tipo: { nome: r.tipo_nome || (tipo && tipo.nome) || "Reunião", duracao_min: Math.round((+new Date(r.fim) - +new Date(r.inicio)) / 60000), cor: tipo && tipo.cor, slug: tipo && tipo.ativo ? tipo.slug : null },
    pode_cancelar: mexe, pode_remarcar: mexe && !!(tipo && tipo.ativo) && (r.remarcacoes || 0) < MAX_REMARCACOES,
    passou: +new Date(r.fim) < agora, cancela_ate_h: CANCELA_ATE_H
  });
}

async function pubCancelarMinha({ req, res, db }) {
  const { r, tipo } = await reuniaoDoCodigo(db, (req.body || {}).r);
  if (!r) return erro(res, 404, "Este link não existe ou não vale mais.", "SEM_REUNIAO");
  const agora = Date.now();
  if (r.status !== "ativa") return res.status(200).json({ ok: true, ja: true });
  if (!podeMexer(r, agora)) return erro(res, 409, "Faltam menos de " + CANCELA_ATE_H + " horas para a reunião. Fale com o nosso Comercial para cancelar.", "FORA_DO_PRAZO");
  await db.atualizar(`ag_reunioes?id=eq.${r.id}&status=eq.ativa`, { status: "cancelada", cancelado_em: iso(agora), cancelado_por: "cliente" });
  registrar(db, "cliente", "AGENDA_CANCELADA", r.id, { pelo: "link" });
  const cfg = await lerConfig(db);
  await EMAIL.enviar(Object.assign({ para: paraAviso(cfg) }, EMAIL.aviso(Object.assign({ acao: "cancelada" }, dadosMail(r, tipo, null))))).catch(() => {});
  return res.status(200).json({ ok: true });
}

async function pubRemarcarMinha({ req, res, db }) {
  const b = req.body || {};
  const { r, tipo } = await reuniaoDoCodigo(db, b.r);
  if (!r) return erro(res, 404, "Este link não existe ou não vale mais.", "SEM_REUNIAO");
  const agora = Date.now();
  if (!podeMexer(r, agora)) return erro(res, 409, "Faltam menos de " + CANCELA_ATE_H + " horas para a reunião (ou ela já foi cancelada). Fale com o nosso Comercial.", "FORA_DO_PRAZO");
  if (!tipo || !tipo.ativo) return erro(res, 409, "Este tipo de reunião não está mais disponível. Fale com o nosso Comercial.", "SEM_TIPO");
  if ((r.remarcacoes || 0) >= MAX_REMARCACOES) return erro(res, 409, "Você já remarcou " + MAX_REMARCACOES + " vezes. Fale com o nosso Comercial.", "LIMITE");
  if (!R.DIA.test(String(b.dia || "")) || !R.HORA.test(String(b.hora || ""))) return erro(res, 400, "Escolha um dia e um horário.", "INVALIDO");
  const cfgL = await lerConfig(db), cfg = cfgDe(cfgL);
  const livres = await livresPara(db, cfg, tipo, agora, r.id);
  if (!(livres[b.dia] || []).includes(b.hora)) return erro(res, 409, "Esse horário não está mais disponível. Escolha outro.", "OCUPADO");
  if (r.modalidade && !R.aceita(R.modalidadeDoDia(cfg, b.dia), r.modalidade)) return erro(res, 409, "Neste dia não atendemos " + (r.modalidade === "online" ? "online" : "presencialmente") + ". Escolha outro dia.", "MODALIDADE");
  const f = R.faixa(b.dia, b.hora, Math.round((+new Date(r.fim) - +new Date(r.inicio)) / 60000), cfg.intervalo_min);
  try { await db.atualizar(`ag_reunioes?id=eq.${r.id}&status=eq.ativa`, { inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate), remarcacoes: (r.remarcacoes || 0) + 1, lembrete_em: null }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Esse horário acabou de ser ocupado. Escolha outro.", "OCUPADO"); throw e; }
  registrar(db, "cliente", "AGENDA_REMARCADA", r.id, { de: r.inicio, para: iso(f.inicio), pelo: "link" });
  const novo = Object.assign({}, r, { inicio: iso(f.inicio), fim: iso(f.fim) });
  const base = baseUrl(req), m = dadosMail(novo, tipo, base, extraMarca(cfgL, base));
  const [cli, , zap] = await Promise.all([
    r.email ? EMAIL.enviar(Object.assign({ para: r.email, convite: EMAIL.convite(m) }, EMAIL.remarcada(m))) : Promise.resolve({ ok: false, motivo: "sem e-mail" }),
    EMAIL.enviar(Object.assign({ para: paraAviso(cfgL) }, EMAIL.aviso(Object.assign({ acao: "remarcada", de: +new Date(r.inicio) }, m)))),
    ZAP.enviar({ telefone: r.telefone, texto: ZAP.remarcada(m) })
  ]);
  await db.atualizar(`ag_reunioes?id=eq.${r.id}`, { email_status: resumoEnvio(cli, !!r.email), whatsapp_status: resumoZap(zap) }).catch(() => {});
  return res.status(200).json({ ok: true, dia: b.dia, hora: b.hora, inicio: novo.inicio, fim: novo.fim });
}

// Lembrete: o cron diário (17h, Brasília) avisa quem tem reunião amanhã e ainda não foi lembrado.
async function cron(req, res) {
  const secret = process.env.CRON_SECRET, auth = req.headers && req.headers.authorization;
  if (secret && auth !== "Bearer " + secret && (req.query || {}).secret !== secret) return erro(res, 401, "Não autorizado.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "Agenda indisponível.", "CONFIG_AUSENTE");
  res.setHeader("Cache-Control", "no-store");
  try {
    const agora = Date.now(), amanha = R.somaDias(R.hojeBR(agora), 1);
    const de = R.paraUtc(amanha, "00:00"), ate = R.paraUtc(R.somaDias(amanha, 1), "00:00");
    const rs = await db.listar(`ag_reunioes?select=*&status=eq.ativa&lembrete_em=is.null&inicio=gte.${iso(de)}&inicio=lt.${iso(ate)}&order=inicio.asc`);
    const tipos = await db.listar("ag_tipos?select=id,nome,cor,slug&order=id.asc");
    const base = baseUrl(req), cfgL = await lerConfig(db);
    let enviados = 0; const falhas = [];
    for (const r of rs) {
      const t = tipos.find(x => String(x.id) === String(r.tipo_id)) || null;
      const m = dadosMail(r, t, base, extraMarca(cfgL, base));
      const em = r.email ? await EMAIL.enviar(Object.assign({ para: r.email, convite: EMAIL.convite(m) }, EMAIL.lembrete(m))) : null;
      const zp = await ZAP.enviar({ telefone: r.telefone, texto: ZAP.lembrete(m) });
      if (!r.email && zp.naoTenta) { await db.atualizar(`ag_reunioes?id=eq.${r.id}`, { lembrete_em: iso(agora) }).catch(() => {}); continue; } // sem como avisar: não fica repetindo
      if ((em && em.ok) || zp.ok) { enviados++; await db.atualizar(`ag_reunioes?id=eq.${r.id}`, { lembrete_em: iso(agora) }); }
      else falhas.push({ id: r.id, motivo: (em && em.motivo) || zp.motivo }); // sem marcar: tenta de novo na próxima rodada
      if (zp.ok) await pausaWa();
    }
    return res.status(200).json({ ok: true, amanha, reunioes: rs.length, enviados, falhas });
  } catch (e) {
    console.error("[agenda cron] " + String((e && e.message) || e));
    return erro(res, 500, "Falha ao enviar os lembretes.", "ERRO");
  }
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

async function pubFoto({ res, db }) {
  const c = await lerConfig(db);
  const m = String(c.anfitriao_foto || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return erro(res, 404, "Sem foto.", "SEM_FOTO");
  res.setHeader("Content-Type", m[1]);
  res.setHeader("Cache-Control", "public, max-age=86400"); // o endereço muda (v=) quando a foto muda
  return res.status(200).send(Buffer.from(m[2], "base64"));
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

const ROTAS_PUB = { "GET horarios": pubHorarios, "POST agendar": pubAgendar, "GET ics": pubIcs, "GET convite": pubConvite,
  "GET minha": pubMinha, "GET foto": pubFoto, "POST cancelar-minha": pubCancelarMinha, "POST remarcar-minha": pubRemarcarMinha };

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
    db.listar("ag_tipos?select=id,nome,duracao_min,local,local_online,cor,slug,ativo,ordem,diretores&order=ordem.asc,id.asc"),
    db.listar(`ag_bloqueios?select=id,inicio,fim,motivo&fim=gt.${iso(agora - 90 * 86400000)}&order=inicio.asc`),
    db.listar(`ag_reunioes?select=id,tipo_id,tipo_nome,inicio,fim,nome,telefone,email,obs,local,modalidade,origem,status,criado_em,email_status,whatsapp_status,remarcacoes,cancelado_por,resultado,proximo_passo,resultado_obs,resultado_em,resultado_por&inicio=gt.${iso(agora - 90 * 86400000)}&order=inicio.asc`),
    db.listar("ag_diretores?select=id,nome,url,ativo,ocupado,lido_em,erro&order=id.asc")
  ]);
  await Promise.all(dirs.filter(d => d.ativo && velho(d, agora)).map(async d => Object.assign(d, await atualizarDiretor(db, d, agora))));
  const ate = agora + 90 * 86400000, ocupados = [];
  dirs.filter(d => d.ativo).forEach(d => (d.ocupado || []).forEach(([a, b]) => { if (b > agora - 7 * 86400000 && a < ate) ocupados.push({ dir: d.id, nome: d.nome, inicio: iso(a), fim: iso(b) }); }));
  const diretores = dirs.map(d => ({ id: d.id, nome: d.nome, ativo: d.ativo, lido_em: d.lido_em, erro: d.erro || null, valido: valido(d, agora), link: mascarar(d.url), compromissos: (d.ocupado || []).filter(([a, b]) => b > agora && a < ate).length }));
  return res.status(200).json({ config: cfgDe(c), marca: Object.assign(marcaDe(c, ""), { foto_dados: c.anfitriao_foto || null }), ics_chave: c.ics_chave, tipos, bloqueios, reunioes, diretores, ocupados });
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
  // Bloqueio parcial (só parte do dia): a Comercial diz como o cliente pode marcar no resto do dia (online, presencial ou os dois).
  const parcial = !!(de || ate);
  let modalidade = null;
  if (parcial && body.modalidade != null && body.modalidade !== "") {
    modalidade = String(body.modalidade);
    if (!R.MOD_DIA.includes(modalidade)) return erro(res, 400, "Escolha online, presencial ou os dois.", "INVALIDO");
  }
  const dias = [];
  for (let d = dia; d <= ateDia && dias.length < 31; d = R.somaDias(d, 1)) dias.push(d);
  await db.inserir("ag_bloqueios", [{ inicio: iso(inicio), fim: iso(fim), motivo, criado_por: ator }]);
  registrar(db, ator, "AGENDA_BLOQUEIO", dia, { inicio: iso(inicio), fim: iso(fim), motivo });
  if (modalidade) await aplicarModalidade(db, ator, dias, modalidade);
  return res.status(200).json({ ok: true, modalidade: modalidade });
}
async function tirarBloqueio({ req, res, db, ator }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe o bloqueio.", "SEM_ID");
  await db.remover(`ag_bloqueios?id=eq.${id}`);
  registrar(db, ator, "AGENDA_BLOQUEIO_TIRADO", id, null);
  return res.status(200).json({ ok: true });
}

// Reunião cadastrada à mão: qualquer horário (a Comercial decide), mas nunca em cima de outra.
async function criarReuniao({ req, res, db, ator, body }) {
  if (!R.DIA.test(String(body.dia || "")) || !R.HORA.test(String(body.hora || ""))) return erro(res, 400, "Escolha o dia e o horário.", "INVALIDO");
  const [tipo] = /^\d{1,12}$/.test(String(body.tipo_id || "")) ? await db.obter(`ag_tipos?select=id,nome,duracao_min,local,local_online,cor&id=eq.${body.tipo_id}&limit=1`) : [];
  if (!tipo) return erro(res, 400, "Escolha o tipo de reunião.", "INVALIDO");
  const v = R.validarPessoa(body, { telefoneOpcional: true });
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const cfg = cfgDe(await lerConfig(db));
  const f = R.faixa(body.dia, body.hora, tipo.duracao_min, cfg.intervalo_min);
  if (await bate(db, f)) return erro(res, 409, "Já existe reunião nesse horário (contando o intervalo entre reuniões).", "OCUPADO");
  const modalidade = R.MODALIDADES[body.modalidade] ? body.modalidade : null;
  const linha = Object.assign({ tipo_id: tipo.id, tipo_nome: tipo.nome, local: modalidade ? R.localDe(tipo, modalidade) : (tipo.local || null), modalidade, inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate), origem: "manual", status: "ativa", criado_por: ator, criado_em: iso(Date.now()) }, v.pessoa);
  let nova;
  try { [nova] = await db.upsert("ag_reunioes", [linha], "id", { retornar: true }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Já existe reunião nesse horário.", "OCUPADO"); throw e; }
  registrar(db, ator, "AGENDA_MARCADA", nova ? nova.id : "?", { tipo: tipo.nome, inicio: linha.inicio, origem: "manual" });
  // quem cadastrou já sabe: sem aviso para a Comercial; a pessoa recebe a confirmação se tiver e-mail e se a Comercial quiser
  const email = nova && (linha.email || linha.telefone) && body.avisar !== false ? await emailMarcada(db, Object.assign({}, linha, { id: nova.id }), tipo, await lerConfig(db), baseUrl(req), { semComercial: true }) : null;
  return res.status(201).json({ ok: true, id: nova ? nova.id : null, email_cliente: email ? email.cliente : null, whatsapp_cliente: email ? email.whatsapp : null });
}

async function remarcar({ req, res, db, ator, body }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe a reunião.", "SEM_ID");
  if (!R.DIA.test(String(body.dia || "")) || !R.HORA.test(String(body.hora || ""))) return erro(res, 400, "Escolha o novo dia e horário.", "INVALIDO");
  const [r] = await db.obter(`ag_reunioes?select=*&id=eq.${id}&limit=1`);
  if (!r || r.status !== "ativa") return erro(res, 404, "Reunião não encontrada (ou já cancelada).", "NAO_ENCONTRADA");
  const cfgL = await lerConfig(db), cfg = cfgDe(cfgL);
  const dur = Math.round((+new Date(r.fim) - +new Date(r.inicio)) / 60000);
  const f = R.faixa(body.dia, body.hora, dur, cfg.intervalo_min);
  if (await bate(db, f, id)) return erro(res, 409, "Já existe reunião nesse horário (contando o intervalo entre reuniões).", "OCUPADO");
  try { await db.atualizar(`ag_reunioes?id=eq.${id}&status=eq.ativa`, { inicio: iso(f.inicio), fim: iso(f.fim), ocupa_ate: iso(f.ocupa_ate) }); }
  catch (e) { if (conflito(e)) return erro(res, 409, "Já existe reunião nesse horário.", "OCUPADO"); throw e; }
  registrar(db, ator, "AGENDA_REMARCADA", id, { de: r.inicio, para: iso(f.inicio) });
  let email = null, whatsapp = null;
  if ((r.email || r.telefone) && body.avisar !== false) {
    const [tipo] = r.tipo_id != null ? await db.obter(`ag_tipos?select=id,nome,cor&id=eq.${r.tipo_id}&limit=1`) : [];
    const base = baseUrl(req), m = dadosMail(Object.assign({}, r, { inicio: iso(f.inicio), fim: iso(f.fim) }), tipo, base, extraMarca(cfgL, base));
    const [x, z] = await Promise.all([
      r.email ? EMAIL.enviar(Object.assign({ para: r.email, convite: EMAIL.convite(m) }, EMAIL.remarcada(m))) : Promise.resolve(null),
      ZAP.enviar({ telefone: r.telefone, texto: ZAP.remarcada(m) })
    ]);
    email = x ? resumoEnvio(x, true) : null; whatsapp = resumoZap(z);
    await db.atualizar(`ag_reunioes?id=eq.${id}`, { email_status: email || r.email_status || null, whatsapp_status: whatsapp, lembrete_em: null }).catch(() => {});
  }
  return res.status(200).json({ ok: true, email_cliente: email, whatsapp_cliente: whatsapp });
}

async function cancelar({ req, res, db, ator, body }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe a reunião.", "SEM_ID");
  const [r] = await db.obter(`ag_reunioes?select=*&id=eq.${id}&limit=1`);
  await db.atualizar(`ag_reunioes?id=eq.${id}&status=eq.ativa`, { status: "cancelada", cancelado_em: iso(Date.now()), cancelado_por: ator });
  registrar(db, ator, "AGENDA_CANCELADA", id, null);
  let email = null, whatsapp = null;
  if (r && r.status === "ativa" && (r.email || r.telefone) && body.avisar !== false) {
    const [tipo] = r.tipo_id != null ? await db.obter(`ag_tipos?select=id,nome,cor,slug,ativo&id=eq.${r.tipo_id}&limit=1`) : [];
    const base = baseUrl(req);
    const m = dadosMail(r, tipo, base, Object.assign(extraMarca(await lerConfig(db), base), { novo: tipo && tipo.ativo && base ? base + "/agendar.html?s=" + tipo.slug : null }));
    const [x, z] = await Promise.all([
      r.email ? EMAIL.enviar(Object.assign({ para: r.email }, EMAIL.cancelada(m))) : Promise.resolve(null),
      ZAP.enviar({ telefone: r.telefone, texto: ZAP.cancelada(m) })
    ]);
    email = x ? resumoEnvio(x, true) : null; whatsapp = resumoZap(z);
  }
  return res.status(200).json({ ok: true, email_cliente: email, whatsapp_cliente: whatsapp });
}

async function salvarMarca({ res, db, ator, body }) {
  const v = R.validarMarca(body);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  await lerConfig(db);
  await db.atualizar("ag_config?id=eq.1", Object.assign({}, v.marca, { atualizado_em: iso(Date.now()), atualizado_por: ator }));
  registrar(db, ator, "AGENDA_MARCA", "marca", { nome: v.marca.anfitriao_nome, cargo: v.marca.anfitriao_cargo, foto: v.marca.anfitriao_foto === undefined ? "mantida" : (v.marca.anfitriao_foto ? "trocada" : "tirada") });
  return res.status(200).json({ ok: true });
}

// Resultado: só de reunião ativa que já começou (antes disso não há o que registrar).
async function salvarResultado({ req, res, db, ator, body }) {
  const id = idDe(req);
  if (!id) return erro(res, 400, "Informe a reunião.", "SEM_ID");
  const v = R.validarResultado(body);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  const [r] = await db.obter(`ag_reunioes?select=id,inicio,status&id=eq.${id}&limit=1`);
  if (!r || r.status !== "ativa") return erro(res, 404, "Reunião não encontrada (ou cancelada).", "NAO_ENCONTRADA");
  const agora = Date.now();
  if (v.resultado.resultado && +new Date(r.inicio) > agora) return erro(res, 409, "A reunião ainda não começou.", "AINDA_NAO");
  const patch = Object.assign({}, v.resultado, v.resultado.resultado ? { resultado_em: iso(agora), resultado_por: ator } : { resultado_em: null, resultado_por: null });
  await db.atualizar(`ag_reunioes?id=eq.${id}`, patch);
  registrar(db, ator, "AGENDA_RESULTADO", id, { resultado: v.resultado.resultado, proximo: v.resultado.proximo_passo });
  return res.status(200).json({ ok: true });
}

// Números do mês para o Painel Comercial: só contagens (nada de nome, telefone ou e-mail).
async function numerosDoPainel({ req, res, db }) {
  const agora = Date.now();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || "")) ? String(req.query.mes) : R.hojeBR(agora).slice(0, 7);
  const de = R.paraUtc(R.mesAntes(mes, 6) + "-01", "00:00"), ate = R.paraUtc(R.mesAntes(mes, -1) + "-01", "00:00");
  const rs = await db.listar(`ag_reunioes?select=inicio,tipo_nome,origem,status,cancelado_por,resultado,proximo_passo,modalidade&inicio=gte.${iso(de)}&inicio=lt.${iso(ate)}&order=inicio.asc`);
  return res.status(200).json(Object.assign({ ok: true }, R.numeros(rs, mes, agora)));
}
async function podeVerNumeros(db, ator) {
  if (await podeAdministrar(db, ator)) return true;
  if (!NUMEROS_NO_PAINEL || !ator) return false;
  const [u] = await db.obter(`app_users?select=perms,ativo&user_key=eq.${enc(ator)}&limit=1`);
  return !!(u && u.ativo !== false && u.perms && u.perms.comDash === true);
}

// Define (ou tira, com modalidade null) o jeito de um ou mais dias. O que já passou sai da lista.
async function aplicarModalidade(db, ator, listaDias, modalidade) {
  const c = await lerConfig(db), ontem = R.somaDias(R.hojeBR(Date.now()), -1);
  const dias = {};
  for (const [d, m] of Object.entries(c.modalidade_dias || {})) if (d >= ontem && R.MOD_DIA.includes(m)) dias[d] = m;
  for (const d of listaDias) { if (modalidade) dias[d] = modalidade; else delete dias[d]; }
  await db.atualizar("ag_config?id=eq.1", { modalidade_dias: dias, atualizado_em: iso(Date.now()), atualizado_por: ator });
  registrar(db, ator, "AGENDA_MODALIDADE_DIA", listaDias[0], { dias: listaDias.length, modalidade: modalidade || "padrão" });
  return dias;
}
async function salvarModalidadeDia({ res, db, ator, body }) {
  const v = R.validarModalidadeDia(body);
  if (v.erro) return erro(res, 400, v.erro, "INVALIDO");
  return res.status(200).json({ ok: true, modalidade_dias: await aplicarModalidade(db, ator, [v.dia], v.modalidade) });
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
  "POST reuniao": criarReuniao, "PATCH reuniao": remarcar, "POST cancelar": cancelar, "POST ics": trocarIcs,
  "POST marca": salvarMarca, "POST resultado": salvarResultado, "GET numeros": numerosDoPainel, "POST modalidade": salvarModalidadeDia
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
    const pode = t === "numeros" ? await podeVerNumeros(db, ator) : await podeAdministrar(db, ator);
    if (!pode) return erro(res, 403, "Só a administradora da agenda.", "NAO_AUTORIZADO");
    return await fn({ req, res, db, ator, body: req.body || {} });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[agenda] " + msg);
    if (semTabela(e)) return erro(res, 503, "As tabelas da agenda ainda não foram criadas no banco.", "SEM_TABELA");
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
module.exports.publico = publico;
module.exports.cron = cron;
module.exports.definirPausaWa = ms => { const antes = pausaWaMs; pausaWaMs = ms; return antes; };
module.exports.GESTORES = GESTORES;
module.exports.NUMEROS_NO_PAINEL = NUMEROS_NO_PAINEL;
