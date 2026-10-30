// api/_faltas_email.js — Aviso semanal de faltas injustificadas por e-mail.
//
// Um e-mail por área, para o supervisor dela, com as faltas injustificadas da
// semana anterior (segunda a domingo, horário de Brasília). Mesmo sem falta, o
// supervisor recebe o aviso de que não houve ocorrência. Quem vai em cópia é
// configurado no painel (Jussilene, Campana e Ingridy, pedido do Raphael em 23/10/2026).
//
// Prefixo "_" → não vira rota. Duas portas de entrada:
//   /api/rh?modulo=faltasemail&t=cron   agendamento da Vercel (vercel.json): uma chamada por hora, das 6h
//                                  às 20h de Brasília (o plano Hobby dispara dentro da hora e só uma vez
//                                  por dia cada). Só age no dia da semana e a partir da hora escolhidos no
//                                  painel (sem escolha, segunda às 14h); com CRON_SECRET na Vercel, só com a
//                                  senha. As chamadas seguintes do mesmo dia enviam só o que ficou para trás.
//   /api/rh?modulo=faltasemail&t=...   painel, só a conta do Raphael:
//     GET  painel    semana anterior, áreas, e-mails, cópias e a situação de cada envio
//     GET  previa    o e-mail pronto de uma área e período (nada é enviado)
//     POST area      e-mail do supervisor e nome da saudação de uma área
//     POST copias    quem vai em cópia
//     POST auto      liga/desliga o envio automático (desligado até ele ligar)
//     POST agenda    dia da semana e hora (6h a 20h, Brasília) do envio automático; sem escolha, segunda às 14h
//     POST teste_areas  teste de todas as áreas de uma vez, para quem ele escolher (nada vai ao supervisor)
//     POST conta     a conta de e-mail que envia (e-mail e senha; a senha fica criptografada)
//     POST assinatura a imagem da assinatura do e-mail (ou null para tirar)
//     POST enviar    envio oficial da semana anterior: áreas e cópias escolhidas
//     POST teste     envio de teste de qualquer período, para quem ele escolher
//     POST resumo / GET previa_resumo / POST resumo_enviar, resumo_teste   resumo semanal das medidas
//                    geradas no painel para a coordenação (quem recebe, ligado, prévia, envio, teste)
//
// Onde fica guardado: o e-mail do supervisor na jv_supervisores (a mesma do
// relatório de hora extra: cadastra uma vez, vale para os dois); o resto na tabela
// de registros fm_auditoria, como os atestados e as chaves do Excel, sem tabela
// nova. Cada envio oficial guarda a lista de faltas que foi no e-mail: é dela que
// sai o quadro "Atualizações desde o aviso anterior" da semana seguinte.
//
// Conta que envia: a do Raphael, cadastrada no painel (a senha fica criptografada no
// banco com a chave do login, AUTH_SECRET, e nunca volta para a tela). Este módulo não tem
// nada a ver com o e-mail do Comercial e nunca usa a conta dele (pedido do Raphael). Se um
// dia FALTAS_MAIL_USER/FALTAS_MAIL_PASS forem cadastradas na Vercel, elas passam a valer.
// Quando o supervisor responde, a resposta volta para o Raphael com as cópias junto.
// Nenhum endereço de e-mail fica no código: o repositório é público.

const crypto = require("crypto");
const R = require("./_faltas_regras");
const ponto = require("./_ponto");
const faltasMod = require("./_faltas");
const HTML = require("./_faltas_email_html");
const LOGO = require("./_faltas_email_logo");
const MD = require("./_medida_regras");
const COM = require("./_comunicado");

// Só a conta do Raphael envia à mão, cadastra e-mails e liga o automático (pedido dele).
// A checagem é AQUI, no servidor: esconder o botão na tela é conveniência, não segurança.
const RESPONSAVEL = "raphaelvictor";

const ENTIDADE = "fm_email";
const ACAO_RESERVA = "FALTAS_EMAIL_RESERVA";   // antes de enviar: só uma chamada fica com cada área
const ACAO_ENVIADO = "FALTAS_EMAIL_ENVIADO";   // e-mail oficial aceito pelo servidor de e-mail
const ACAO_FALHOU = "FALTAS_EMAIL_FALHOU";     // devolve a área para a próxima tentativa
const ACAO_TESTE = "FALTAS_EMAIL_TESTE";
const ACAO_COPIAS = "FALTAS_EMAIL_COPIAS";
const ACAO_AUTO = "FALTAS_EMAIL_AUTO";
const ACAO_CONTA = "FALTAS_EMAIL_CONTA";       // conta de e-mail que envia (senha criptografada)
const ACAO_ASSINATURA = "FALTAS_EMAIL_ASSINATURA"; // imagem da assinatura, no corpo do e-mail abaixo do cartão
const ACAO_AREA = "FALTAS_EMAIL_AREA";         // e-mail e nome da saudação de uma área (o e-mail vai também para a jv_supervisores)
const ACAO_LINK = "FALTAS_EMAIL_LINK";         // endereço do painel para o botão "Abrir no Painel ServCamp" (guardado ao abrir o painel)
const ACAO_RESUMO = "FALTAS_EMAIL_RESUMO";     // resumo semanal das medidas geradas para a coordenação: { ligado, para: [{ nome, email }] }
const ACAO_AGENDA = "FALTAS_EMAIL_AGENDA";     // dia da semana e hora do envio automático: { dia (0 = domingo), hora (de Brasília) }
// Envio automático: sem escolha, segunda às 14h (o que valia antes). A Vercel (plano Hobby) dispara um agendamento por
// hora, uma vez por dia cada, e é a regra daqui que decide se aquela hora é a do envio. Hora de 6 a 20 (Brasília).
const AGENDA_PADRAO = { dia: 1, hora: 14, minuto: 0 };
const HORA_MIN = 6, HORA_MAX = 20;
const CHAVE_RESUMO = "#RESUMO";                // na chave do envio ("semana|#RESUMO"): nunca é uma área (área é só letra, número e espaço)
const ACOES_ENVIO = [ACAO_RESERVA, ACAO_ENVIADO, ACAO_FALHOU];

const RESERVA_VALE_MS = 15 * 60000; // função que caiu no meio do envio não trava a área para sempre
const DIAS_AREAS = 45;              // áreas que aparecem no painel: as das faltas recentes
const MAX_DIAS_TESTE = 31;
const MAX_DESTINOS = 10;
const MAX_COPIAS = 10;
const CID_LOGO = "logo-servcamp@aviso-semanal";
const CID_ASSINATURA = "assinatura@aviso-semanal";
const HOST_PADRAO = "email-ssl.com.br", PORTA_PADRAO = 465; // e-mail do domínio da empresa (Locaweb)
const MAX_ASSINATURA = 500 * 1024; // bytes da imagem: e-mail pesado vai para o spam ou demora a abrir
const EMAIL_OK = /^[^@\s<>"',;:()[\]\\]+@[^@\s<>"',;:()[\]\\]+\.[^@\s<>"',;:()[\]\\]+$/;
const ABONO = { A: "Atestado", J: "Justificativa", L: "Licença" };

// Áreas que nunca recebem o aviso nem aparecem no painel (pedido do Raphael, 23/10/2026):
// as reservas técnicas de turno e as áreas da Coordenação e do RH, que não são de supervisor.
// Vale a palavra inteira em qualquer ponto do nome ("JUSSILENE COORDENAÇÃO" também sai).
const AREAS_FORA = ["NOTURNO RT", "DIURNO RT", "EDUARDO CIPRIANO", "JUSSILENE"];

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
const iso = d => String(d == null ? "" : d).slice(0, 10);
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const ddmmaaaa = d => { const s = iso(d); return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4); };
const emailLimpo = v => String(v == null ? "" : v).trim().toLowerCase();
const emailValido = v => { const e = emailLimpo(v); return e.length <= 120 && EMAIL_OK.test(e); };

// ── datas no horário de São Paulo ───────────────────────────────────────────
// O relógio é trocável só para os testes (definirRelogio): a regra depende do dia da semana.
let relogio = () => new Date();
const agoraAtual = () => relogio();
function definirRelogio(fn) { const antes = relogio; relogio = fn || (() => new Date()); return antes; }
// O servidor da Vercel roda em UTC; "semana anterior" e "segunda-feira" são de Brasília.
function diaSP(agora) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora || new Date());
}
const minutoSP = agora => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", minute: "2-digit" }).format(agora)) % 60;
const minutoDoDia = agora => horaSP(agora) * 60 + minutoSP(agora);
const horaSP = agora => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(agora)) % 24;
const diaDaSemana = dia => new Date(iso(dia) + "T12:00:00Z").getUTCDay(); // 0 = domingo
function semanaAnterior(agora) {
  const hoje = diaSP(agora);
  const segunda = R.somaDias(hoje, -((diaDaSemana(hoje) + 6) % 7));
  const inicio = R.somaDias(segunda, -7);
  return { inicio, fim: R.somaDias(inicio, 6) };
}
// 23h59min59s de um dia em São Paulo (UTC−3: o Brasil não tem horário de verão desde 2019).
const fimDoDiaSP = dia => Date.parse(R.somaDias(dia, 1) + "T03:00:00Z") - 1;

// ── áreas ───────────────────────────────────────────────────────────────────
// A área vem da planilha (AREASUPERVISAO). Supervisor que saiu passa a área para
// quem assumiu (Edney → Jean, Rafael → Carlos Nogueira), e a chave já é a de quem assumiu.
const normalizar = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const chaveArea = nome => normalizar(R.supervisorAtual(nome));
const areaFora = chave => AREAS_FORA.some(x => (" " + chave + " ").includes(" " + x + " "));
const nomeArea = nome => String(R.supervisorAtual(nome) == null ? "" : R.supervisorAtual(nome)).trim();

const ev = (ator, acao, chave, depois, antes) => ({ ator: ator || "sistema", acao, entidade: ENTIDADE, chave: String(chave), antes: antes || null, depois: depois || null });
const eventos = (db, acoes, filtro) => db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${acoes.join(",")})${filtro || ""}&order=id.asc`);
function ultimoPorChave(lista) { const m = new Map(); lista.forEach(e => m.set(e.chave, e)); return m; }

// Áreas que o painel mostra e o envio percorre: as das faltas recentes e as que já têm e-mail.
async function lerAreas(db, hoje) {
  const [recentes, emails, cfg] = await Promise.all([
    db.listar(`fm_faltas?select=supervisor&data=gte.${R.somaDias(hoje, -DIAS_AREAS)}&order=supervisor.asc`),
    db.listar("jv_supervisores?select=area,email,atualizado_em&order=area.asc"),
    eventos(db, [ACAO_AREA])
  ]);
  const areas = new Map();
  const add = nome => {
    const k = chaveArea(nome);
    if (!k || areaFora(k)) return null;
    if (!areas.has(k)) areas.set(k, { area: k, nome: nomeArea(nome), email: null, saudacao: null });
    return areas.get(k);
  };
  recentes.forEach(f => add(f.supervisor));
  // vale a linha mais nova de cada área; a linha de quem saiu (Edney, Rafael) não conta
  [...emails].sort((a, b) => String(a.atualizado_em || "").localeCompare(String(b.atualizado_em || ""))).forEach(e => {
    if (normalizar(e.area) !== chaveArea(e.area) || !emailValido(e.email)) return;
    const a = add(e.area);
    if (a) a.email = emailLimpo(e.email);
  });
  ultimoPorChave(cfg).forEach(e => { const a = areas.get(e.chave); if (a && e.depois) a.saudacao = e.depois.saudacao || null; });
  return [...areas.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

async function lerCopias(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_COPIAS}&order=id.desc&limit=1`);
  return e && e.depois && Array.isArray(e.depois.copias) ? e.depois.copias : [];
}
// ── conta de envio ──────────────────────────────────────────────────────────
// A senha é guardada cifrada (AES-256-GCM) com uma chave tirada do AUTH_SECRET, que a
// Vercel já tem para o login. Sem AUTH_SECRET não há como guardar com segurança: o painel recusa.
function chaveCifra() {
  const s = process.env.AUTH_SECRET;
  return s ? crypto.createHash("sha256").update("faltas-email/conta|" + s).digest() : null;
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", chaveCifra(), iv);
  const dados = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), dados: dados.toString("base64") };
}
function decifrar(o) {
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", chaveCifra(), Buffer.from(o.iv, "base64"));
    d.setAuthTag(Buffer.from(o.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(o.dados, "base64")), d.final()]).toString("utf8");
  } catch (e) { return null; } // chave do login trocada: precisa cadastrar a conta de novo
}
async function lerConta(db) {
  const e = process.env;
  if (e.FALTAS_MAIL_USER && e.FALTAS_MAIL_PASS) {
    return { origem: "vercel", user: emailLimpo(e.FALTAS_MAIL_USER), pass: e.FALTAS_MAIL_PASS, host: e.FALTAS_MAIL_HOST || HOST_PADRAO, port: Number(e.FALTAS_MAIL_PORT) || PORTA_PADRAO };
  }
  const [ev] = await db.obter(`fm_auditoria?select=depois,criado_em&acao=eq.${ACAO_CONTA}&order=id.desc&limit=1`);
  const d = ev && ev.depois;
  if (!d || !d.email || !d.senha) return null;
  const pass = chaveCifra() ? decifrar(d.senha) : null;
  return { origem: "painel", user: d.email, pass, host: d.host || HOST_PADRAO, port: Number(d.port) || PORTA_PADRAO, em: ev.criado_em };
}
const pronta = c => !!(c && c.user && c.pass);
const SEM_CONTA = "Cadastre a conta de e-mail que envia o aviso no painel (Conta de envio).";
// A assinatura fica no banco, e não no código: o repositório é público e a imagem tem foto e telefones.
async function lerAssinatura(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois,criado_em&acao=eq.${ACAO_ASSINATURA}&order=id.desc&limit=1`);
  const d = e && e.depois;
  return d && d.base64 ? { tipo: d.tipo, base64: d.base64, largura: d.largura, altura: d.altura, bytes: d.bytes, em: e.criado_em } : null;
}
const assinaturaNoEmail = a => (a ? { src: "cid:" + CID_ASSINATURA, largura: a.largura, altura: a.altura } : null);
const assinaturaNaPrevia = a => (a ? { src: "data:" + a.tipo + ";base64," + a.base64, largura: a.largura, altura: a.altura } : null);
async function lerAuto(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_AUTO}&order=id.desc&limit=1`);
  return !!(e && e.depois && e.depois.ligado === true); // sem registro = desligado
}
const agendaValida = a => !!a && Number.isInteger(a.dia) && a.dia >= 0 && a.dia <= 6 && Number.isInteger(a.hora) && a.hora >= HORA_MIN && a.hora <= HORA_MAX && (a.minuto === undefined || (Number.isInteger(a.minuto) && a.minuto >= 0 && a.minuto <= 59));
async function lerAgenda(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_AGENDA}&order=id.desc&limit=1`);
  return e && agendaValida(e.depois) ? { dia: e.depois.dia, hora: e.depois.hora, minuto: e.depois.minuto || 0 } : { ...AGENDA_PADRAO };
}
// Próximo envio automático: hoje, se ainda não chegou a hora, ou no próximo dia marcado.
function proximoEnvio(agenda, agora) {
  const hoje = diaSP(agora);
  let dias = (agenda.dia - diaDaSemana(hoje) + 7) % 7;
  if (dias === 0 && minutoDoDia(agora) >= agenda.hora * 60 + agenda.minuto) dias = 7;
  return { dia: R.somaDias(hoje, dias), hora: agenda.hora, minuto: agenda.minuto };
}

// ── quais faltas entram ─────────────────────────────────────────────────────
// Faltas de [inicio, fim] que contam no aviso:
//   • injustificadas AGORA: a que foi abonada antes do envio não aparece (pedido do Raphael);
//   • que já eram injustificadas no corte (domingo 23h59 no aviso oficial): a que foi
//     lançada depois aparece no quadro de atualizações da semana seguinte;
//   • sem atestado registrado à mão no JARVIS cobrindo o dia e não anteriores à
//     admissão de quem tem o RE hoje (RE reaproveitado) — as mesmas contas da tela.
async function faltasDoPeriodo(db, inicio, fim, corteMs) {
  const [faltas, adm, atest, viradas, medidas] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,codigo,nome,cargo,posto,supervisor,escala,criado_em&data=gte.${inicio}&data=lte.${fim}&order=re.asc,data.asc`),
    db.listar("fm_admissoes?select=re,admissao&order=re.asc"),
    db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${faltasMod.ACOES_ATESTADO.join(",")})&order=criado_em.asc,id.asc`),
    db.listar(`fm_auditoria?select=id,chave,criado_em&acao=eq.${faltasMod.ACAO_VIROU_I}&criado_em=gte.${inicio}T00:00:00Z&order=id.asc`),
    db.listar(`fm_medidas?select=re,data,fase&data=gte.${inicio}&order=re.asc,data.asc`)
  ]);
  const admissao = {};
  adm.forEach(a => { if (a.admissao) admissao[String(a.re)] = iso(a.admissao); });
  const { ativos: atestados } = R.dobrarAtestados(atest);
  // Falta já tratada: medida disciplinar lançada a partir do dia da falta (o dia seguinte, por exemplo) encerra
  // a falta. A mesma regra da tela e da TV: a primeira medida a partir da falta decide, então não é cobrada de novo.
  const tratadaAte = {};
  medidas.forEach(m => {
    if (/CANCEL/i.test(String(m.fase || ""))) return;
    const re = String(m.re), d = iso(m.data);
    if (!tratadaAte[re] || d > tratadaAte[re]) tratadaAte[re] = d;
  });
  const virou = {};
  viradas.forEach(v => { virou[v.chave] = Math.max(virou[v.chave] || 0, Date.parse(v.criado_em) || 0); });
  return faltas.map(f => ({ ...f, data: iso(f.data) })).filter(f => {
    if (String(f.codigo || "").toUpperCase().trim() !== "I") return false;
    const adm = admissao[String(f.re)];
    if (adm && f.data < adm) return false;
    if (atestados.some(a => a.re === String(f.re) && f.data >= a.inicio && f.data <= a.fim)) return false;
    if (tratadaAte[String(f.re)] && tratadaAte[String(f.re)] >= f.data) return false; // já tem medida lançada a partir desta falta
    const injustificadaDesde = Math.max(Date.parse(f.criado_em) || 0, virou[f.re + "|" + f.data] || 0);
    return injustificadaDesde <= corteMs;
  }).map(f => ({ ...f, area: chaveArea(f.supervisor), areaNome: nomeArea(f.supervisor) }))
    .filter(f => !areaFora(f.area)); // RT de turno, Coordenação e RH: fora do aviso
}

// Histórico de todos os colaboradores, lido uma vez por rodada de envio: medidas (sem repetir a que veio no
// histórico importado e na planilha diária) e faltas que continuam injustificadas. As faltas passam pelas MESMAS
// regras do aviso da semana (nada anterior à admissão de quem tem o RE hoje, nada coberto por atestado lançado
// à mão), para o número do histórico nunca contar o que o aviso não contaria.
async function historicoDoAno(db, hoje) {
  const ano = String(hoje).slice(0, 4);
  const [medidas, faltasI, adm, atest] = await Promise.all([
    db.listar(`fm_medidas?select=chave,re,data,tipo,grau,dias,fase,nome&order=re.asc,data.asc,chave.asc`),
    db.listar(`fm_faltas?select=re,data,nome&codigo=eq.I&order=re.asc,data.asc`),
    db.listar("fm_admissoes?select=re,admissao&order=re.asc"),
    db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${faltasMod.ACOES_ATESTADO.join(",")})&order=criado_em.asc,id.asc`)
  ]);
  const admissao = {};
  adm.forEach(a => { if (a.admissao) admissao[String(a.re)] = iso(a.admissao); });
  const { ativos: atestados } = R.dobrarAtestados(atest);
  const validas = faltasI.map(f => ({ ...f, data: iso(f.data) })).filter(f => {
    const ad = admissao[String(f.re)];
    if (ad && f.data < ad) return false;
    return !atestados.some(a => a.re === String(f.re) && f.data >= a.inicio && f.data <= a.fim);
  });
  return { ano, medidas: R.dedupMedidas(medidas).map(m => ({ ...m, data: iso(m.data) })), faltasI: validas };
}
// `datasSemana`: as faltas que estão neste aviso entram sempre no histórico (o histórico nunca pode ter menos
// faltas que a semana que está sendo avisada).
function historicoDaLinha(hist, re, nome, datasSemana) {
  if (!hist) return null;
  const extra = (datasSemana || []).map(d => ({ re, nome, data: d }));
  const h = MD.historicoDe(re, nome, hist.medidas, [...hist.faltasI, ...extra], hist.ano);
  return { ...h, txt: MD.historicoTxt(h) };
}

// Endereço do painel para o botão do e-mail: PAINEL_URL na Vercel ou o que o painel guardou
// (o endereço em que o Raphael abre o painel do aviso). Sem nenhum dos dois, o e-mail sai sem o botão.
const LINK_OK = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;
async function lerLink(db) {
  const e = String(process.env.PAINEL_URL || "").trim().replace(/\/+$/, "");
  if (LINK_OK.test(e)) return e;
  const [ev] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_LINK}&order=id.desc&limit=1`);
  const v = ev && ev.depois && ev.depois.link;
  return v && LINK_OK.test(v) ? v : null;
}
// O botão do e-mail abre o comunicado da semana no painel (o mesmo do e-mail, como foi enviado), onde cada colaborador tem o "Gerar medida".
// É um link só e sem nada do caso: nome, RE e motivo nunca vão no endereço, e a checagem de área é do servidor.
const linkDaTela = base => (base ? base + "/?pg=faltassup&aba=COMUNICADO" : null);

// Uma linha por colaborador, com todas as datas de falta dele (pedido do Raphael);
// os dados do posto/cargo/escala são os da falta mais recente.
const semPosto = p => { const t = String(p == null ? "" : p).trim(); return !t || t === "—" || t === "-"; };
function agrupar(faltas, hist) {
  const porRE = new Map();
  [...faltas].sort((a, b) => a.data.localeCompare(b.data)).forEach(f => {
    const k = String(f.re);
    if (!porRE.has(k)) porRE.set(k, { re: f.re, datas: [] });
    const p = porRE.get(k);
    p.datas.push(f.data);
    p.nome = f.nome || p.nome;
    p.posto = semPosto(f.posto) ? "Reserva técnica · " + (f.areaNome || "") : f.posto;
    p.cargo = f.cargo || p.cargo;
    p.escala = f.escala || p.escala;
  });
  return [...porRE.values()]
    .map(p => ({ ...p, datas: [...new Set(p.datas)].sort(), hist: historicoDaLinha(hist, p.re, p.nome, p.datas) }))
    .sort((a, b) => a.datas[0].localeCompare(b.datas[0]) || String(a.nome || "").localeCompare(String(b.nome || "")));
}

// ── atualizações desde o aviso anterior ─────────────────────────────────────
// O que mudou nas faltas do e-mail oficial da semana passada desta área: abonada,
// retirada pelo RH, medida aplicada (com a data) e a falta da semana passada que
// só foi lançada depois do envio.
async function atualizacoesDa(db, area, inicio, agoraMs) {
  const de = R.somaDias(inicio, -7), ate = R.somaDias(inicio, -1);
  const [ant] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_ENVIADO}&chave=eq.${encodeURIComponent(de + "|" + area)}&order=id.desc&limit=1`);
  if (!ant || !ant.depois) return null;
  const avisadas = Array.isArray(ant.depois.faltas) ? ant.depois.faltas : [];
  const [linhas, medidas, atuais] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,codigo,nome&data=gte.${de}&data=lte.${ate}&order=re.asc,data.asc`),
    db.listar(`fm_medidas?select=chave,re,data,tipo,grau,dias,fase&data=gte.${de}&order=re.asc,data.asc,chave.asc`),
    faltasDoPeriodo(db, de, ate, agoraMs)
  ]);
  const k = (re, d) => String(re) + "|" + iso(d);
  const linhaDe = new Map(linhas.map(l => [k(l.re, l.data), l]));
  const contaHoje = new Set(atuais.map(f => k(f.re, f.data)));
  const jaAvisada = new Set(avisadas.map(f => k(f.re, f.data)));
  const itens = [];
  avisadas.forEach(f => {
    const l = linhaDe.get(k(f.re, f.data));
    const base = { nome: (l && l.nome) || f.nome, re: f.re, data: iso(f.data) };
    if (!l) { itens.push({ ...base, tipo: "RETIRADA", detalhe: "Lançamento retirado no SAR2G" }); return; }
    const m = medidas.filter(x => String(x.re) === String(f.re) && iso(x.data) >= iso(f.data) && !String(x.fase || "").toUpperCase().includes("CANCEL"))
      .sort((a, b) => iso(a.data).localeCompare(iso(b.data)))[0];
    const c = String(l.codigo || "").toUpperCase().trim();
    if (m && c === "I") { // continua injustificada no SAR2G e já tem medida: tratada (não é mais cobrada)
      const d = R.descreverMedida({ TIPO: m.tipo, GRAU: m.grau, DIAS: m.dias });
      itens.push({ ...base, tipo: "MEDIDA", detalhe: d.charAt(0).toUpperCase() + d.slice(1) + " · lançada em " + ddmmaaaa(m.data) });
      return;
    }
    if (!contaHoje.has(k(f.re, f.data))) itens.push({ ...base, tipo: "ABONADA", detalhe: ABONO[c] || "Atestado registrado no JARVIS" });
  });
  atuais.filter(f => f.area === area && !jaAvisada.has(k(f.re, f.data)))
    .forEach(f => itens.push({ nome: f.nome, re: f.re, data: f.data, tipo: "NOVA", detalhe: "Lançada depois do envio do aviso" }));
  itens.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")) || a.data.localeCompare(b.data));
  return { de, ate, itens };
}

// O e-mail de uma área. Só entram as faltas desta área: nenhum supervisor recebe dado de outra.
async function montarEmail(db, o) {
  const minhas = o.faltas.filter(f => f.area === o.area.area);
  const hist = o.hist || (minhas.length ? await historicoDoAno(db, diaSP(new Date(o.agoraMs || Date.now()))) : null);
  const linhas = agrupar(minhas, hist);
  const atualizacoes = o.comAtualizacoes ? await atualizacoesDa(db, o.area.area, o.inicio, o.agoraMs) : null;
  const link = o.link === undefined ? linkDaTela(await lerLink(db)) : o.link;
  const m = HTML.montar({
    area: o.area.nome, saudacao: o.area.saudacao || o.area.nome, inicio: o.inicio, fim: o.fim, linhas, atualizacoes,
    teste: !!o.teste, logo: o.logo || "cid:" + CID_LOGO, assinatura: o.assinatura || null, link
  });
  return { ...m, linhas, faltas: minhas, atualizacoes };
}

// ── envio ───────────────────────────────────────────────────────────────────
// Envia pela conta do aviso (lerConta). Os testes trocam o correio (definirCorreio) e a
// conferência da conta (definirVerificador) para nada sair da máquina.
let correioDeTeste = null, verificadorDeTeste = null;
function definirCorreio(fn) { const antes = correioDeTeste; correioDeTeste = fn; return antes; }
function definirVerificador(fn) { const antes = verificadorDeTeste; verificadorDeTeste = fn; return antes; }
// Entra na conta sem enviar nada: é como o painel confere e-mail e senha antes de guardar.
async function verificarConta(c) {
  if (verificadorDeTeste) return verificadorDeTeste(c);
  const tx = require("nodemailer").createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  try { await tx.verify(); return { ok: true }; }
  catch (e) { return { ok: false, codigo: (e && (e.responseCode || e.code)) || null }; }
  finally { try { tx.close(); } catch (e) { /* já fechou */ } }
}
function abrirCorreio(c) {
  if (correioDeTeste) return { enviar: correioDeTeste, fechar() {} };
  const nodemailer = require("nodemailer");
  // pool: uma conexão só para todos os e-mails da rodada (abrir uma por e-mail estoura o tempo da função)
  const tx = nodemailer.createTransport({
    pool: true, maxConnections: 1, port: c.port, secure: c.port === 465, host: c.host,
    auth: { user: c.user, pass: c.pass }
  });
  return {
    async enviar(m) {
      const info = await tx.sendMail({
        from: `"Grupo ServCamp" <${c.user}>`, replyTo: m.responderPara && m.responderPara.length ? m.responderPara : undefined,
        to: m.para, cc: m.cc && m.cc.length ? m.cc : undefined,
        subject: m.assunto, html: m.html, text: m.texto,
        attachments: [{ filename: "servcamp.png", content: Buffer.from(LOGO, "base64"), contentType: "image/png", cid: CID_LOGO }]
          .concat(m.assinatura ? [{ filename: "assinatura." + (m.assinatura.tipo === "image/jpeg" ? "jpg" : "png"), content: Buffer.from(m.assinatura.base64, "base64"), contentType: m.assinatura.tipo, cid: CID_ASSINATURA }] : [])
      });
      // o servidor pode aceitar parte dos endereços e recusar outros: guarda os dois para ninguém achar que recebeu sem ter recebido
      const lista = x => (Array.isArray(x) ? x : []).map(e => String((e && e.address) || e).toLowerCase());
      return { ok: !!(info && info.accepted && info.accepted.length), id: (info && info.messageId) || null, aceitos: lista(info && info.accepted), recusados: lista(info && info.rejected) };
    },
    fechar() { try { tx.close(); } catch (e) { /* já fechou */ } }
  };
}

// Situação de um envio oficial (semana|área), lida da sequência de registros.
// agoraMs é a hora real (Date.now()): o criado_em dos registros é a hora do banco.
// Reserva viva = sem ENVIADO/FALHOU do mesmo lote e com menos de 15 minutos; vale
// a primeira. Duas chamadas ao mesmo tempo gravam, releem, e só uma se vê dona.
function estadoEnvio(lista, agoraMs) {
  let enviado = null;
  const fechados = new Set(), reservas = [];
  let ultimaFalha = null;
  lista.forEach(e => {
    const d = e.depois || {};
    if (e.acao === ACAO_ENVIADO) { if (!enviado) enviado = e; fechados.add(d.lote); }
    else if (e.acao === ACAO_FALHOU) { fechados.add(d.lote); ultimaFalha = e; }
    else if (e.acao === ACAO_RESERVA) reservas.push({ lote: d.lote, id: Number(e.id), em: Date.parse(e.criado_em) || 0 });
  });
  const vivas = reservas.filter(r => !fechados.has(r.lote) && agoraMs - r.em < RESERVA_VALE_MS).sort((a, b) => a.id - b.id);
  return { enviado, dono: vivas.length ? vivas[0].lote : null, ultimaFalha };
}
const eventosDoEnvio = (db, chave) => eventos(db, ACOES_ENVIO, `&chave=eq.${encodeURIComponent(chave)}`);

// Envio oficial de uma semana. escolhidas: chaves de área (null = todas com e-mail).
// Devolve só contagens e nomes de área: nunca nome de colaborador.
async function enviarSemana(db, { semana, escolhidas, copias, origem, ator, agora }) {
  agora = agora || agoraAtual();
  const agoraMs = agora.getTime();
  const [areas, faltas, conta, assinatura, hist, base] = await Promise.all([lerAreas(db, diaSP(agora)), faltasDoPeriodo(db, semana.inicio, semana.fim, fimDoDiaSP(semana.fim)), lerConta(db), lerAssinatura(db), historicoDoAno(db, diaSP(agora)), lerLink(db)]);
  if (!pronta(conta)) throw new Error("conta de envio não cadastrada");
  const link = linkDaTela(base);
  // "Responder" volta para o Raphael com as cópias junto (pedido dele): todos no Reply-To.
  const responderPara = [...new Set([conta.user, ...copias])];
  const alvo = escolhidas ? new Set(escolhidas) : null;
  const tot = { areas: 0, enviados: 0, semFaltas: 0, faltas: 0, jaEnviados: 0, emAndamento: 0, falhas: 0, semEmail: [] };
  const correio = abrirCorreio(conta);
  try {
    for (const a of areas) {
      if (alvo && !alvo.has(a.area)) continue;
      tot.areas++;
      if (!a.email) { tot.semEmail.push(a.nome); continue; }
      const chave = semana.inicio + "|" + a.area;
      let est = estadoEnvio(await eventosDoEnvio(db, chave), Date.now());
      if (est.enviado) { tot.jaEnviados++; continue; }
      if (est.dono) { tot.emAndamento++; continue; }
      const lote = crypto.randomBytes(6).toString("hex");
      await db.inserir("fm_auditoria", [ev(ator, ACAO_RESERVA, chave, { lote, origem })]);
      est = estadoEnvio(await eventosDoEnvio(db, chave), Date.now());
      if (est.enviado || est.dono !== lote) { tot.emAndamento++; continue; } // outra chamada chegou antes
      let m = null, r;
      try {
        m = await montarEmail(db, { area: a, inicio: semana.inicio, fim: semana.fim, faltas, comAtualizacoes: true, agoraMs, assinatura: assinaturaNoEmail(assinatura), hist, link });
        r = await correio.enviar({ para: [a.email], cc: copias, responderPara, assinatura, assunto: m.assunto, html: m.html, texto: m.texto });
      } catch (e) {
        r = { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
      }
      // o supervisor precisa estar entre os aceitos: cópia aceita com o supervisor recusado não conta como enviado
      if (r && r.ok && r.aceitos && !r.aceitos.includes(String(a.email).toLowerCase())) r = { ok: false, erro: "o servidor de e-mail recusou o endereço do supervisor (" + a.email + ")" };
      if (!r || !r.ok) {
        await db.inserir("fm_auditoria", [ev(ator, ACAO_FALHOU, chave, { lote, origem, erro: (r && r.erro) || "o servidor de e-mail não confirmou o envio" })]);
        console.error("[faltas-email] envio não confirmado para a área " + a.area);
        tot.falhas++;
        continue;
      }
      await db.inserir("fm_auditoria", [ev(ator, ACAO_ENVIADO, chave, {
        lote, origem, semana: semana.inicio, area: a.area, nome: a.nome, para: [a.email], cc: copias, assunto: m.assunto, id: r.id || null,
        qtd: m.faltas.length, colaboradores: m.linhas.length, atualizacoes: m.atualizacoes ? m.atualizacoes.itens.length : 0,
        faltas: m.faltas.map(f => ({ re: f.re, data: f.data, nome: f.nome || null }))
      })]);
      // a cópia do comunicado, para o supervisor abrir no painel o mesmo que recebeu; se não gravar, o e-mail já saiu e vale
      try {
        await COM.guardar(db, ator, { semana: semana.inicio, area: a.area, nome: a.nome, inicio: semana.inicio, fim: semana.fim, origem, qtd: m.faltas.length, colaboradores: m.linhas.length, linhas: m.linhas, atualizacoes: m.atualizacoes });
      } catch (e) { console.error("[faltas-email] cópia do comunicado não gravada para a área " + a.area + ": " + (e && e.message ? e.message : e)); }
      tot.enviados++;
      tot.faltas += m.faltas.length;
      if (!m.faltas.length) tot.semFaltas++;
    }
  } finally {
    correio.fechar();
  }
  return tot;
}

// ── resumo semanal das medidas para a coordenação ───────────────────────────
// Um e-mail só, para quem estiver cadastrado no painel (a Jussilene, pedido do Raphael em 26/10/2026):
// o que foi gerado no Painel ServCamp e ainda não está no SAR2G, por supervisor, e o que ainda não
// tem o documento assinado anexado. Sai na mesma rodada do aviso das áreas, uma vez por semana.
async function lerResumo(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_RESUMO}&order=id.desc&limit=1`);
  const d = (e && e.depois) || {};
  return { ligado: d.ligado === true, para: Array.isArray(d.para) ? d.para : [] };
}
const saudacaoResumo = para => (para.length === 1 ? String(para[0].nome || "").trim().split(/\s+/)[0] : "");
async function montarResumoEmail(db, o) {
  const [geradas, base] = await Promise.all([faltasMod.lerGeradas(db), o.link !== undefined ? o.link : lerLink(db)]);
  return HTML.montarResumo({
    semana: o.semana, hoje: diaSP(o.agora), geradas, nomes: MD.NOMES, teste: !!o.teste, saudacao: o.saudacao || "",
    link: base ? base + "/?pg=faltassup&aba=MEDIDA" : null, logo: o.logo || "cid:" + CID_LOGO, assinatura: o.assinatura || null
  });
}
// Envio oficial do resumo de uma semana. Mesma reserva do aviso das áreas: só uma chamada envia.
async function enviarResumo(db, { semana, origem, ator, agora }) {
  agora = agora || agoraAtual();
  const cfg = await lerResumo(db);
  if (!cfg.para.length) return { situacao: "SEM_DESTINO" };
  const conta = await lerConta(db);
  if (!pronta(conta)) throw new Error("conta de envio não cadastrada");
  const chave = semana.inicio + "|" + CHAVE_RESUMO;
  let est = estadoEnvio(await eventosDoEnvio(db, chave), Date.now());
  if (est.enviado) return { situacao: "JA_ENVIADO" };
  if (est.dono) return { situacao: "EM_ANDAMENTO" };
  const lote = crypto.randomBytes(6).toString("hex");
  await db.inserir("fm_auditoria", [ev(ator, ACAO_RESERVA, chave, { lote, origem })]);
  est = estadoEnvio(await eventosDoEnvio(db, chave), Date.now());
  if (est.enviado || est.dono !== lote) return { situacao: "EM_ANDAMENTO" };
  const para = cfg.para.map(p => p.email);
  let m = null, r;
  const correio = abrirCorreio(conta);
  try {
    const assinatura = await lerAssinatura(db);
    m = await montarResumoEmail(db, { semana, agora, assinatura: assinaturaNoEmail(assinatura), saudacao: saudacaoResumo(cfg.para) });
    r = await correio.enviar({ para, cc: [], responderPara: [conta.user], assinatura, assunto: m.assunto, html: m.html, texto: m.texto });
  } catch (e) {
    r = { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
  } finally {
    correio.fechar();
  }
  if (!r || !r.ok) {
    await db.inserir("fm_auditoria", [ev(ator, ACAO_FALHOU, chave, { lote, origem, erro: (r && r.erro) || "o servidor de e-mail não confirmou o envio" })]);
    console.error("[faltas-email] resumo da coordenação não confirmado");
    return { situacao: "FALHOU" };
  }
  await db.inserir("fm_auditoria", [ev(ator, ACAO_ENVIADO, chave, {
    lote, origem, semana: semana.inicio, area: CHAVE_RESUMO, nome: "Resumo das medidas (coordenação)", para, cc: [], assunto: m.assunto, id: r.id || null,
    qtd: m.pendentes, atrasadas: m.atrasadas, geradas: m.geradasSemana, lancadas: m.lancadasSemana, semAssinatura: m.semAssinatura
  })]);
  return { situacao: "ENVIADO", pendentes: m.pendentes };
}

// ── agendamento (vercel.json → /api/rh?modulo=faltasemail&t=cron) ───────────
async function cron(req, res) {
  const segredo = process.env.CRON_SECRET;
  const cab = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  // Com CRON_SECRET na Vercel, só passa quem tem a senha (a Vercel manda sozinha). Sem ela
  // roda do mesmo jeito (pedido do Raphael: sem depender de variável nova), e quem segura é a
  // própria regra: só segunda a partir das 14h e cada área uma vez por semana. Quem chamar o
  // endereço por fora do agendamento consegue, no máximo, adiantar em minutos o mesmo envio.
  if (segredo && cab !== "Bearer " + segredo) return erro(res, 401, "Não autorizado.", "NAO_AUTORIZADO");
  const agora = agoraAtual();
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    // dia e hora escolhidos no painel; a Vercel chama a cada hora e daqui em diante, no mesmo dia, cada chamada
    // só envia o que ficou para trás (área já enviada não sai de novo)
    const agenda = await lerAgenda(db);
    if (diaDaSemana(diaSP(agora)) !== agenda.dia) return res.status(200).json({ ok: true, ignorado: "NAO_E_O_DIA" });
    if (minutoDoDia(agora) < agenda.hora * 60 + agenda.minuto) return res.status(200).json({ ok: true, ignorado: "ANTES_DO_HORARIO" });
    if (!(await lerAuto(db))) return res.status(200).json({ ok: true, ignorado: "AUTO_DESLIGADO" });
    if (!pronta(await lerConta(db))) return res.status(200).json({ ok: false, motivo: SEM_CONTA });
    const copias = (await lerCopias(db)).map(c => c.email);
    const semana = semanaAnterior(agora);
    const t = await enviarSemana(db, { semana, copias, origem: "auto", ator: "sistema", agora });
    // resumo da coordenação: falhar aqui não desfaz nem atrasa o aviso das áreas (as rodadas das 16h e 18h tentam de novo)
    let resumo = { situacao: "DESLIGADO" };
    try { if ((await lerResumo(db)).ligado) resumo = await enviarResumo(db, { semana, origem: "auto", ator: "sistema", agora }); }
    catch (e) { console.error("[faltas-email] resumo da coordenação: " + (e && e.message ? e.message : e)); resumo = { situacao: "FALHOU" }; }
    return res.status(200).json({ ok: true, semana, ...t, semEmail: t.semEmail.length, resumo: resumo.situacao });
  } catch (e) {
    console.error("[faltas-email] agendamento falhou: " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha no envio automático.", "FALHA_NO_ENVIO");
  }
}

// ── painel (só a conta do Raphael) ──────────────────────────────────────────
async function verPainel({ req, res, db, ator }) {
  const agora = agoraAtual(), hoje = diaSP(agora), semana = semanaAnterior(agora);
  // O endereço em que o painel foi aberto vira o do botão do e-mail (só https; localhost não serve).
  const origem = String((req && req.query && req.query.origem) || "").trim().replace(/\/+$/, "").toLowerCase();
  if (LINK_OK.test(origem) && !/localhost|127\.0\.0\.1/.test(origem) && !process.env.PAINEL_URL) {
    const [u] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_LINK}&order=id.desc&limit=1`);
    if (!(u && u.depois && u.depois.link === origem)) await db.inserir("fm_auditoria", [ev(ator, ACAO_LINK, "link", { link: origem }, u ? u.depois : null)]);
  }
  const [areas, faltas, copias, auto, agenda, envios, historico, conta, assinatura, resumo, link, abertos] = await Promise.all([
    lerAreas(db, hoje),
    faltasDoPeriodo(db, semana.inicio, semana.fim, fimDoDiaSP(semana.fim)),
    lerCopias(db),
    lerAuto(db),
    lerAgenda(db),
    eventos(db, ACOES_ENVIO, `&criado_em=gte.${semana.inicio}T00:00:00Z`),
    db.obter(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${ACAO_ENVIADO},${ACAO_TESTE})&order=id.desc&limit=30`),
    lerConta(db),
    lerAssinatura(db),
    lerResumo(db),
    lerLink(db),
    COM.aberturas(db, semana.inicio)
  ]);
  const estResumo = estadoEnvio(envios.filter(e => e.chave === semana.inicio + "|" + CHAVE_RESUMO), Date.now());
  const porChave = new Map();
  envios.filter(e => String(e.chave).startsWith(semana.inicio + "|")).forEach(e => {
    if (!porChave.has(e.chave)) porChave.set(e.chave, []);
    porChave.get(e.chave).push(e);
  });
  const lista = areas.map(a => {
    const minhas = faltas.filter(f => f.area === a.area);
    const est = estadoEnvio(porChave.get(semana.inicio + "|" + a.area) || [], Date.now());
    const env = est.enviado;
    const status = env ? "ENVIADO" : !a.email ? "SEM_EMAIL" : est.dono ? "EM_ANDAMENTO" : est.ultimaFalha ? "FALHOU" : "PENDENTE";
    return {
      area: a.area, nome: a.nome, email: a.email, saudacao: a.saudacao,
      faltas: minhas.length, colaboradores: new Set(minhas.map(f => String(f.re))).size, status,
      enviado: env ? { em: env.criado_em, origem: env.depois.origem, por: env.ator, cc: env.depois.cc || [] } : null,
      aberto: abertos.get(semana.inicio + "|" + a.area) || null, // quando o supervisor abriu o comunicado no painel (null = ainda não)
      falha: !env && est.ultimaFalha ? { em: est.ultimaFalha.criado_em, erro: est.ultimaFalha.depois.erro } : null
    };
  });
  return res.status(200).json({
    ok: true, hoje, semana, configurado: pronta(conta), auto, agenda: { ...agenda, proximo: proximoEnvio(agenda, agora), horas: [HORA_MIN, HORA_MAX] }, copias, areas: lista,
    // a senha nunca sai daqui; "ilegivel" = guardada com outra chave do login, precisa cadastrar de novo
    conta: conta ? { origem: conta.origem, email: conta.user, host: conta.host, port: conta.port, em: conta.em || null, ilegivel: !conta.pass } : null,
    assinatura: assinatura ? { src: assinaturaNaPrevia(assinatura).src, largura: assinatura.largura, altura: assinatura.altura, bytes: assinatura.bytes, em: assinatura.em } : null,
    semArea: faltas.filter(f => !f.area).length, // falta sem área na planilha não tem para quem ir: o painel avisa
    link, // endereço do botão "Abrir no Painel ServCamp" (null: os e-mails saem sem o botão)
    resumo: {
      ligado: resumo.ligado, para: resumo.para,
      enviado: estResumo.enviado ? { em: estResumo.enviado.criado_em, origem: estResumo.enviado.depois.origem, qtd: estResumo.enviado.depois.qtd || 0 } : null,
      falha: !estResumo.enviado && estResumo.ultimaFalha ? { em: estResumo.ultimaFalha.criado_em, erro: estResumo.ultimaFalha.depois.erro } : null
    },
    historico: (historico || []).map(e => ({
      tipo: e.acao === ACAO_TESTE ? "TESTE" : "OFICIAL", em: e.criado_em, por: e.ator,
      area: (e.depois && (e.depois.nome || e.depois.area)) || "", semana: e.depois && (e.depois.semana || e.depois.de) || null,
      ate: e.depois && e.depois.ate || null, origem: e.depois && e.depois.origem || "manual", qtd: e.depois && e.depois.qtd || 0, ok: e.acao === ACAO_ENVIADO || !!(e.depois && e.depois.ok)
    }))
  });
}

// Período do painel: padrão é a semana anterior; teste aceita até 31 dias.
function periodoDe(de, ate, agora) {
  const s = semanaAnterior(agora);
  const ini = ehData(de) ? de : s.inicio, fim = ehData(ate) ? ate : s.fim;
  if (ini > fim) return { erro: ["A data inicial é depois da final.", "PERIODO"] };
  if (R.somaDias(ini, MAX_DIAS_TESTE - 1) < fim) return { erro: [`O período pode ter no máximo ${MAX_DIAS_TESTE} dias.`, "PERIODO_LONGO"] };
  if (ini > diaSP(agora)) return { erro: ["O período não pode começar no futuro.", "PERIODO_FUTURO"] };
  return { inicio: ini, fim };
}

async function areaDoPedido(db, chave) {
  const k = normalizar(chave);
  if (!k) return null;
  return (await lerAreas(db, diaSP(agoraAtual()))).find(a => a.area === k) || null;
}

async function verPrevia({ req, res, db }) {
  const q = req.query || {}, agora = agoraAtual();
  const a = await areaDoPedido(db, q.area);
  if (!a) return erro(res, 404, "Área não encontrada.", "AREA_DESCONHECIDA");
  const p = periodoDe(q.de, q.ate, agora);
  if (p.erro) return erro(res, 400, p.erro[0], p.erro[1]);
  const corte = Math.min(fimDoDiaSP(p.fim), agora.getTime());
  const [faltas, assinatura] = await Promise.all([faltasDoPeriodo(db, p.inicio, p.fim, corte), lerAssinatura(db)]);
  const m = await montarEmail(db, {
    area: a, inicio: p.inicio, fim: p.fim, faltas, agoraMs: agora.getTime(), teste: q.teste === "1",
    comAtualizacoes: HTML.ehSemanaCheia(p.inicio, p.fim), logo: "data:image/png;base64," + LOGO, assinatura: assinaturaNaPrevia(assinatura)
  });
  return res.status(200).json({ ok: true, assunto: m.assunto, html: m.html, periodo: p, para: a.email, cc: (await lerCopias(db)).map(c => c.email) });
}

async function salvarArea({ res, db, ator, body }) {
  const a = await areaDoPedido(db, body.area);
  if (!a) return erro(res, 404, "Área não encontrada.", "AREA_DESCONHECIDA");
  const email = body.email == null ? a.email : emailLimpo(body.email);
  if (email && !emailValido(email)) return erro(res, 400, "E-mail inválido.", "EMAIL_INVALIDO");
  if (!email && a.email) return erro(res, 400, "Informe o e-mail do supervisor. Para trocar, cole o novo endereço.", "SEM_EMAIL");
  const saudacao = body.saudacao == null ? a.saudacao : (String(body.saudacao).trim().slice(0, 60) || null);
  if (email === a.email && saudacao === a.saudacao) return res.status(200).json({ ok: true, alterado: false });
  // registro antes: se a gravação na jv_supervisores falhar, fica anotado o que se tentou
  await db.inserir("fm_auditoria", [ev(ator, ACAO_AREA, a.area, { nome: a.nome, email, saudacao }, { email: a.email, saudacao: a.saudacao })]);
  if (email && email !== a.email) await gravarEmailSupervisor(a.nome, email);
  return res.status(200).json({ ok: true, alterado: true, area: a.area, email, saudacao });
}
// Mesmo jeito de gravar do relatório de hora extra (api/rh.js, ?heemail=1), na mesma tabela.
async function gravarEmailSupervisor(area, email) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/rest/v1/jv_supervisores`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ area, email, atualizado_em: new Date().toISOString() })
  });
  if (!r.ok) throw new Error("jv_supervisores " + r.status);
}

async function salvarCopias({ res, db, ator, body }) {
  const lista = Array.isArray(body.copias) ? body.copias : null;
  if (!lista) return erro(res, 400, "Envie a lista de cópias.", "SEM_LISTA");
  if (lista.length > MAX_COPIAS) return erro(res, 400, `No máximo ${MAX_COPIAS} pessoas em cópia.`, "MUITAS_COPIAS");
  const copias = [], vistos = new Set();
  for (const c of lista) {
    const email = emailLimpo(c && c.email), nome = String((c && c.nome) || "").trim().slice(0, 60);
    if (!emailValido(email)) return erro(res, 400, "E-mail inválido: " + String((c && c.email) || "(vazio)").slice(0, 80), "EMAIL_INVALIDO");
    if (vistos.has(email)) continue;
    vistos.add(email);
    copias.push({ nome: nome || email, email });
  }
  const antes = await lerCopias(db);
  await db.inserir("fm_auditoria", [ev(ator, ACAO_COPIAS, "copias", { copias }, { copias: antes })]);
  return res.status(200).json({ ok: true, copias });
}

// Conta que envia: o painel confere e-mail e senha entrando na conta (sem enviar nada)
// e só então guarda, com a senha cifrada. A senha não aparece em resposta nem em log.
async function salvarConta({ res, db, ator, body }) {
  if (!chaveCifra()) return erro(res, 409, "O login por token não está ativo (AUTH_SECRET); não há como guardar a senha com segurança.", "SEM_CHAVE");
  if (body.remover === true) {
    await db.inserir("fm_auditoria", [ev(ator, ACAO_CONTA, "conta", { removida: true })]);
    return res.status(200).json({ ok: true, conta: null });
  }
  const email = emailLimpo(body.email), senha = String(body.senha == null ? "" : body.senha);
  if (!emailValido(email)) return erro(res, 400, "E-mail da conta inválido.", "EMAIL_INVALIDO");
  if (!senha || senha.length > 200) return erro(res, 400, "Informe a senha da conta.", "SEM_SENHA");
  const host = String(body.host || HOST_PADRAO).trim().toLowerCase(), port = Number(body.port || PORTA_PADRAO);
  if (!/^[a-z0-9.-]{3,100}$/.test(host)) return erro(res, 400, "Servidor de e-mail inválido.", "SERVIDOR_INVALIDO");
  if (port !== 465 && port !== 587) return erro(res, 400, "A porta precisa ser 465 ou 587.", "PORTA_INVALIDA");
  const v = await verificarConta({ user: email, pass: senha, host, port });
  if (!v || !v.ok) return erro(res, 400, "Não consegui entrar na conta com esse e-mail e senha" + (v && v.codigo ? " (" + v.codigo + ")" : "") + ". Confira e tente de novo.", "CONTA_RECUSADA");
  const antes = await lerConta(db);
  await db.inserir("fm_auditoria", [ev(ator, ACAO_CONTA, "conta", { email, host, port, senha: cifrar(senha) }, { email: antes && antes.origem === "painel" ? antes.user : null })]);
  return res.status(200).json({ ok: true, conta: { origem: "painel", email, host, port } });
}

// Imagem da assinatura: PNG ou JPEG de até 500 KB, conferida pelos bytes (não só pelo nome).
// imagem: "data:image/png;base64,..." para trocar, ou null para tirar.
async function salvarAssinatura({ res, db, ator, body }) {
  if (body.imagem === null) {
    await db.inserir("fm_auditoria", [ev(ator, ACAO_ASSINATURA, "assinatura", { removida: true })]);
    return res.status(200).json({ ok: true, assinatura: null });
  }
  const m = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.imagem || ""));
  if (!m) return erro(res, 400, "Envie a assinatura como imagem PNG ou JPG.", "IMAGEM_INVALIDA");
  const bytes = Buffer.from(m[2], "base64");
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!(m[1] === "image/png" ? png : jpg)) return erro(res, 400, "O arquivo não é uma imagem PNG ou JPG de verdade.", "IMAGEM_INVALIDA");
  if (bytes.length > MAX_ASSINATURA) return erro(res, 400, "A imagem passa de 500 KB. Diminua e envie de novo.", "IMAGEM_GRANDE");
  const largura = Number(body.largura), altura = Number(body.altura);
  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura < 1 || altura < 1 || largura > 3000 || altura > 3000) return erro(res, 400, "Tamanho da imagem inválido.", "IMAGEM_INVALIDA");
  await db.inserir("fm_auditoria", [ev(ator, ACAO_ASSINATURA, "assinatura", { tipo: m[1], base64: m[2], largura, altura, bytes: bytes.length })]);
  return res.status(200).json({ ok: true, assinatura: { largura, altura, bytes: bytes.length } });
}

async function salvarAuto({ res, db, ator, body }) {
  if (body.ligado !== true && body.ligado !== false) return erro(res, 400, "Informe ligado: true ou false.", "VALOR_INVALIDO");
  const antes = await lerAuto(db);
  if (antes !== body.ligado) await db.inserir("fm_auditoria", [ev(ator, ACAO_AUTO, "auto", { ligado: body.ligado }, { ligado: antes })]);
  return res.status(200).json({ ok: true, auto: body.ligado });
}

// Dia da semana e hora do envio automático. O aviso sempre traz a semana anterior (segunda a domingo).
async function salvarAgenda({ res, db, ator, body }) {
  const nova = { dia: Number(body.dia), hora: Number(body.hora), minuto: body.minuto === undefined || body.minuto === "" ? 0 : Number(body.minuto) };
  if (!agendaValida(nova)) return erro(res, 400, `Escolha o dia da semana e um horário entre ${HORA_MIN}:00 e ${HORA_MAX}:59.`, "AGENDA_INVALIDA");
  const antes = await lerAgenda(db);
  if (antes.dia !== nova.dia || antes.hora !== nova.hora || antes.minuto !== nova.minuto) await db.inserir("fm_auditoria", [ev(ator, ACAO_AGENDA, "agenda", nova, antes)]);
  return res.status(200).json({ ok: true, agenda: { ...nova, proximo: proximoEnvio(nova, agoraAtual()) } });
}

// Envio oficial à mão: sempre a semana anterior. Área já enviada não sai de novo.
async function enviarManual({ res, db, ator, body }) {
  if (body.confirmar !== true) return erro(res, 400, "Confirme o envio.", "SEM_CONFIRMACAO");
  if (!pronta(await lerConta(db))) return erro(res, 409, SEM_CONTA, "SEM_CONTA");
  const areas = Array.isArray(body.areas) ? [...new Set(body.areas.map(normalizar).filter(Boolean))] : [];
  if (!areas.length) return erro(res, 400, "Escolha ao menos uma área.", "SEM_AREA");
  const guardadas = new Set((await lerCopias(db)).map(c => c.email));
  const copias = Array.isArray(body.copias) ? [...new Set(body.copias.map(emailLimpo))] : [];
  if (copias.some(c => !guardadas.has(c))) return erro(res, 400, "Cópia fora da lista cadastrada no painel.", "COPIA_DESCONHECIDA");
  const semana = semanaAnterior(agoraAtual());
  const t = await enviarSemana(db, { semana, escolhidas: areas, copias, origem: "manual", ator });
  return res.status(200).json({ ok: true, semana, ...t });
}

// Teste: qualquer período (até 31 dias), para quem ele escolher na hora. "@eu" é a
// própria conta de envio e "@supervisor" o e-mail da área, para a tela não precisar
// conhecer esses endereços; o resto pode ser qualquer e-mail válido, de dentro ou de fora
// da empresa (pedido do Raphael, 24/10/2026). O envio oficial continua só para o
// supervisor da área e as cópias da lista.
async function enviarTeste({ res, db, ator, body }) {
  const conta = await lerConta(db);
  if (!pronta(conta)) return erro(res, 409, SEM_CONTA, "SEM_CONTA");
  const agora = agoraAtual();
  const a = await areaDoPedido(db, body.area);
  if (!a) return erro(res, 404, "Área não encontrada.", "AREA_DESCONHECIDA");
  const p = periodoDe(body.de, body.ate, agora);
  if (p.erro) return erro(res, 400, p.erro[0], p.erro[1]);
  const assinatura = await lerAssinatura(db);
  const pedidos = Array.isArray(body.para) ? body.para : [];
  const para = [];
  for (const x of pedidos) {
    let e = String(x == null ? "" : x).trim();
    if (e === "@eu") e = conta.user;
    else if (e === "@supervisor") { if (!a.email) return erro(res, 400, "Esta área ainda não tem e-mail de supervisor.", "SEM_EMAIL"); e = a.email; }
    else {
      e = emailLimpo(e);
      if (!emailValido(e)) return erro(res, 400, "E-mail inválido: " + String(x).slice(0, 80), "EMAIL_INVALIDO");
    }
    if (e && !para.includes(e)) para.push(e);
  }
  if (!para.length) return erro(res, 400, "Escolha ao menos um destinatário.", "SEM_DESTINO");
  if (para.length > MAX_DESTINOS) return erro(res, 400, `No máximo ${MAX_DESTINOS} destinatários.`, "MUITOS_DESTINOS");
  const corte = Math.min(fimDoDiaSP(p.fim), agora.getTime());
  const faltas = await faltasDoPeriodo(db, p.inicio, p.fim, corte);
  const m = await montarEmail(db, { area: a, inicio: p.inicio, fim: p.fim, faltas, teste: true, agoraMs: agora.getTime(), comAtualizacoes: HTML.ehSemanaCheia(p.inicio, p.fim), assinatura: assinaturaNoEmail(assinatura) });
  const correio = abrirCorreio(conta);
  let r;
  try { r = await correio.enviar({ para, cc: [], responderPara: [conta.user], assinatura, assunto: m.assunto, html: m.html, texto: m.texto }); }
  catch (e) { r = { ok: false, erro: String((e && e.message) || e).slice(0, 200) }; }
  finally { correio.fechar(); }
  // teste não reserva nem marca nada: não bloqueia o oficial nem entra nas atualizações
  await db.inserir("fm_auditoria", [ev(ator, ACAO_TESTE, a.area, { nome: a.nome, de: p.inicio, ate: p.fim, para, qtd: m.faltas.length, ok: !!(r && r.ok), erro: r && !r.ok ? (r.erro || "não confirmado") : null, recusados: (r && r.recusados) || [] })]);
  if (!r || !r.ok) return res.status(502).json({ ok: false, error: "O servidor de e-mail não confirmou o envio do teste.", codigo: "FALHA_NO_ENVIO" });
  return res.status(200).json({ ok: true, para: para.length, faltas: m.faltas.length, recusados: (r && r.recusados) || [], periodo: p });
}

// Teste de todas as áreas de uma vez, para quem ele escolher (a coordenação acompanhar o que cada supervisor
// recebe). Um e-mail por área, com o conteúdo real; nada vai para o supervisor e nada fica marcado como envio oficial.
async function enviarTesteAreas({ res, db, ator, body }) {
  const conta = await lerConta(db);
  if (!pronta(conta)) return erro(res, 409, SEM_CONTA, "SEM_CONTA");
  const agora = agoraAtual();
  const p = periodoDe(body.de, body.ate, agora);
  if (p.erro) return erro(res, 400, p.erro[0], p.erro[1]);
  const para = [];
  for (const x of Array.isArray(body.para) ? body.para : []) {
    let e = String(x == null ? "" : x).trim();
    if (e === "@eu") e = conta.user;
    else { e = emailLimpo(e); if (!emailValido(e)) return erro(res, 400, "E-mail inválido: " + String(x).slice(0, 80), "EMAIL_INVALIDO"); }
    if (e && !para.includes(e)) para.push(e);
  }
  if (!para.length) return erro(res, 400, "Escolha ao menos um destinatário.", "SEM_DESTINO");
  if (para.length > MAX_DESTINOS) return erro(res, 400, `No máximo ${MAX_DESTINOS} destinatários.`, "MUITOS_DESTINOS");
  const areas = await lerAreas(db, diaSP(agora));
  if (!areas.length) return erro(res, 404, "Nenhuma área nas planilhas recentes.", "SEM_AREA");
  // quantas áreas quiser: sem lista vão todas; com lista, só as escolhidas (as que não existem são ignoradas)
  const pedidas = Array.isArray(body.areas) ? new Set(body.areas.map(normalizar)) : null;
  const escolhidas = pedidas ? areas.filter(a => pedidas.has(a.area)) : areas;
  if (!escolhidas.length) return erro(res, 400, "Escolha ao menos uma área.", "SEM_AREA");
  const corte = Math.min(fimDoDiaSP(p.fim), agora.getTime());
  const [faltas, assinatura, hist] = await Promise.all([faltasDoPeriodo(db, p.inicio, p.fim, corte), lerAssinatura(db), historicoDoAno(db, diaSP(agora))]);
  const correio = abrirCorreio(conta), registros = [], recusados = new Set();
  let enviados = 0, falhas = 0, comFaltas = 0;
  try {
    for (const [i, a] of escolhidas.entries()) {
      // vários e-mails quase iguais, para as mesmas pessoas, em poucos segundos parecem envio em massa e o antispam
      // segura: um intervalo entre eles (até ~35 s no total, dentro do limite de 60 s da função)
      if (i && !correioDeTeste) await new Promise(ok => setTimeout(ok, Math.min(2500, Math.floor(35000 / escolhidas.length))));
      const m = await montarEmail(db, { area: a, inicio: p.inicio, fim: p.fim, faltas, teste: true, agoraMs: agora.getTime(), comAtualizacoes: HTML.ehSemanaCheia(p.inicio, p.fim), assinatura: assinaturaNoEmail(assinatura), hist });
      let r;
      try { r = await correio.enviar({ para, cc: [], responderPara: [conta.user], assinatura, assunto: m.assunto, html: m.html, texto: m.texto }); }
      catch (e) { r = { ok: false, erro: String((e && e.message) || e).slice(0, 200) }; }
      const ok = !!(r && r.ok);
      if (ok) enviados++; else falhas++;
      ((r && r.recusados) || []).forEach(e => recusados.add(e));
      if (m.faltas.length) comFaltas++;
      registros.push(ev(ator, ACAO_TESTE, a.area, { nome: a.nome, de: p.inicio, ate: p.fim, para, qtd: m.faltas.length, ok, erro: ok ? null : ((r && r.erro) || "não confirmado"), recusados: (r && r.recusados) || [], todasAsAreas: true }));
    }
  } finally { correio.fechar(); }
  await db.inserir("fm_auditoria", registros);
  if (!enviados) return res.status(502).json({ ok: false, error: "O servidor de e-mail não confirmou o envio do teste.", codigo: "FALHA_NO_ENVIO" });
  return res.status(200).json({ ok: true, areas: escolhidas.length, enviados, falhas, comFaltas, para: para.length, recusados: [...recusados], periodo: p });
}

// Resumo da coordenação no painel: quem recebe e liga/desliga; prévia; teste; envio oficial da semana.
async function salvarResumo({ res, db, ator, body }) {
  const antes = await lerResumo(db);
  let para = antes.para;
  if (body.para !== undefined) {
    if (!Array.isArray(body.para)) return erro(res, 400, "Envie a lista de quem recebe.", "SEM_LISTA");
    if (body.para.length > MAX_COPIAS) return erro(res, 400, `No máximo ${MAX_COPIAS} pessoas.`, "MUITOS_DESTINOS");
    para = []; const vistos = new Set();
    for (const c of body.para) {
      const email = emailLimpo(c && c.email), nome = String((c && c.nome) || "").trim().slice(0, 60);
      if (!emailValido(email)) return erro(res, 400, "E-mail inválido: " + String((c && c.email) || "(vazio)").slice(0, 80), "EMAIL_INVALIDO");
      if (vistos.has(email)) continue;
      vistos.add(email); para.push({ nome: nome || email, email });
    }
  }
  const ligado = body.ligado === true || body.ligado === false ? body.ligado : antes.ligado;
  if (ligado && !para.length) return erro(res, 400, "Cadastre quem recebe o resumo antes de ligar.", "SEM_DESTINO");
  await db.inserir("fm_auditoria", [ev(ator, ACAO_RESUMO, "resumo", { ligado, para }, antes)]);
  return res.status(200).json({ ok: true, resumo: { ligado, para } });
}
async function verPreviaResumo({ res, db }) {
  const agora = agoraAtual(), semana = semanaAnterior(agora);
  const [cfg, assinatura] = await Promise.all([lerResumo(db), lerAssinatura(db)]);
  const m = await montarResumoEmail(db, { semana, agora, logo: "data:image/png;base64," + LOGO, assinatura: assinaturaNaPrevia(assinatura), saudacao: saudacaoResumo(cfg.para) });
  return res.status(200).json({ ok: true, assunto: m.assunto, html: m.html, para: cfg.para.map(p => p.email).join(", "), cc: [] });
}
async function enviarResumoManual({ res, db, ator, body }) {
  if (body.confirmar !== true) return erro(res, 400, "Confirme o envio.", "SEM_CONFIRMACAO");
  if (!pronta(await lerConta(db))) return erro(res, 409, SEM_CONTA, "SEM_CONTA");
  const r = await enviarResumo(db, { semana: semanaAnterior(agoraAtual()), origem: "manual", ator });
  if (r.situacao === "SEM_DESTINO") return erro(res, 400, "Cadastre quem recebe o resumo.", "SEM_DESTINO");
  if (r.situacao === "FALHOU") return res.status(502).json({ ok: false, error: "O servidor de e-mail não confirmou o envio do resumo.", codigo: "FALHA_NO_ENVIO" });
  return res.status(200).json({ ok: true, ...r });
}
async function enviarResumoTeste({ res, db, ator, body }) {
  const conta = await lerConta(db);
  if (!pronta(conta)) return erro(res, 409, SEM_CONTA, "SEM_CONTA");
  const cfg = await lerResumo(db), para = [];
  for (const x of Array.isArray(body.para) ? body.para : []) {
    let e = String(x == null ? "" : x).trim();
    if (e === "@eu") e = conta.user;
    else { e = emailLimpo(e); if (!emailValido(e)) return erro(res, 400, "E-mail inválido: " + String(x).slice(0, 80), "EMAIL_INVALIDO"); }
    if (e && !para.includes(e)) para.push(e);
  }
  if (!para.length) return erro(res, 400, "Escolha ao menos um destinatário.", "SEM_DESTINO");
  if (para.length > MAX_DESTINOS) return erro(res, 400, `No máximo ${MAX_DESTINOS} destinatários.`, "MUITOS_DESTINOS");
  const agora = agoraAtual(), semana = semanaAnterior(agora), assinatura = await lerAssinatura(db);
  const m = await montarResumoEmail(db, { semana, agora, teste: true, assinatura: assinaturaNoEmail(assinatura), saudacao: saudacaoResumo(cfg.para) });
  const correio = abrirCorreio(conta);
  let r;
  try { r = await correio.enviar({ para, cc: [], responderPara: [conta.user], assinatura, assunto: m.assunto, html: m.html, texto: m.texto }); }
  catch (e) { r = { ok: false, erro: String((e && e.message) || e).slice(0, 200) }; }
  finally { correio.fechar(); }
  await db.inserir("fm_auditoria", [ev(ator, ACAO_TESTE, CHAVE_RESUMO, { nome: "Resumo das medidas (coordenação)", de: semana.inicio, ate: semana.fim, para, qtd: m.pendentes, ok: !!(r && r.ok), erro: r && !r.ok ? (r.erro || "não confirmado") : null })]);
  if (!r || !r.ok) return res.status(502).json({ ok: false, error: "O servidor de e-mail não confirmou o envio do teste.", codigo: "FALHA_NO_ENVIO" });
  return res.status(200).json({ ok: true, para: para.length, pendentes: m.pendentes });
}

// ── roteamento ──────────────────────────────────────────────────────────────
const ROTAS = {
  "POST resumo": salvarResumo,
  "GET previa_resumo": verPreviaResumo,
  "POST resumo_enviar": enviarResumoManual,
  "POST resumo_teste": enviarResumoTeste,
  "GET painel": verPainel,
  "GET previa": verPrevia,
  "POST area": salvarArea,
  "POST copias": salvarCopias,
  "POST auto": salvarAuto,
  "POST agenda": salvarAgenda,
  "POST teste_areas": enviarTesteAreas,
  "POST conta": salvarConta,
  "POST assinatura": salvarAssinatura,
  "POST enviar": enviarManual,
  "POST teste": enviarTeste
};

module.exports = async function faltasEmail(req, res) {
  const t = String((req.query && req.query.t) || "");
  const fn = ROTAS[`${req.method} ${t}`];
  if (!fn) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  if (ponto.usuarioDoToken(req) !== RESPONSAVEL) return erro(res, 403, "O aviso semanal por e-mail é restrito à conta do responsável.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  try {
    return await fn({ req, res, db, ator: RESPONSAVEL, body });
  } catch (e) {
    console.error("[faltas-email] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.cron = cron;
module.exports.enviarSemana = enviarSemana;
module.exports.faltasDoPeriodo = faltasDoPeriodo;
module.exports.agrupar = agrupar;
module.exports.semanaAnterior = semanaAnterior;
module.exports.fimDoDiaSP = fimDoDiaSP;
module.exports.estadoEnvio = estadoEnvio;
module.exports.definirCorreio = definirCorreio;
module.exports.definirRelogio = definirRelogio;
module.exports.RESPONSAVEL = RESPONSAVEL;
module.exports.AREAS_FORA = AREAS_FORA;
module.exports.lerConta = lerConta;
module.exports.definirVerificador = definirVerificador;
module.exports.ACOES = { ACAO_ASSINATURA, ACAO_CONTA, ACAO_RESERVA, ACAO_ENVIADO, ACAO_FALHOU, ACAO_TESTE, ACAO_COPIAS, ACAO_AUTO, ACAO_AREA, ACAO_LINK, ACAO_RESUMO };
module.exports.enviarResumo = enviarResumo;
