// api/_avisos.js — Avisos de faltas: notificação push no celular de cada supervisor.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=avisos (o plano Hobby da Vercel já está nas 12 funções).
//   /api/rh?modulo=avisos&t=...
//     qualquer pessoa logada:
//       GET  chave      chave pública VAPID (gerada no primeiro uso)
//       GET  status     se esta pessoa recebe avisos, se aprova e quantos aparelhos tem
//       POST inscrever  grava o aparelho (só supervisor cadastrado ativo ou aprovador)
//       POST cancelar   tira aparelhos da própria pessoa (nunca de outra)
//       GET  aviso      o aviso completo que chegou no celular (só quem recebeu ou aprovador)
//     só aprovadores:
//       GET  previa     supervisores, aparelhos, faltas novas e o texto exato de cada aviso
//       POST contato · editar · remover   cadastro de quem recebe
//       POST enviar     envio manual (exige confirmar: true)
//       POST teste      envia só para os aparelhos de quem pediu
//       POST auto       liga/desliga o envio automático
// E o api/import.js chama aposImportar() a cada planilha recebida.
//
// Nada de configuração: não usa tabela nova no Supabase nem variável nova na
// Vercel (tudo fica na tabela de registros fm_auditoria; veja "onde fica guardado").
//
// Canal: Web Push (biblioteca web-push, chaves VAPID). Não é SMS: o aviso
// aparece na tela de bloqueio e na central de notificações do celular, de graça.
// O navegador só entrega push a quem autorizou o aparelho; ninguém pode ativar
// pelo supervisor. Por isso existe o convite com um toque depois do login.

const R = require("./_faltas_regras");
const ponto = require("./_ponto");
const faltasMod = require("./_faltas");
const { USUARIOS } = require("./users");

const JANELA_DIAS = 3;              // faltas dos últimos 3 dias (a planilha às vezes chega com atraso)
const MAX_LINHAS = 10;              // pessoas listadas no aviso; o resto vira "+ N na tela..."
const MAX_PAYLOAD = 3800;           // bytes; o serviço de push recusa acima de 4 KB
const TTL_SEGUNDOS = 12 * 3600;     // celular desligado: o aviso ainda chega se ligar em até 12h
const PAGINA = "faltassup";         // tela aberta ao tocar na notificação
const ACAO_CRIADO = "AVISO_CONTATO_CRIADO";
const ACAO_EDITADO = "AVISO_CONTATO_EDITADO";
const ACAO_REMOVIDO = "AVISO_CONTATO_REMOVIDO";
const ACAO_AUTO = "AVISO_AUTO_ALTERADO";

// Só serviços de push de verdade. O endereço vem do navegador; sem esta lista,
// alguém logado poderia cadastrar um endereço interno e fazer o servidor
// chamá-lo a cada envio (SSRF).
const SERVICOS_PUSH = ["fcm.googleapis.com", "android.googleapis.com", "googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }

// ── datas e horário de São Paulo ────────────────────────────────────────────
// O servidor da Vercel roda em UTC; a saudação e o "dia do aviso" são do horário de Brasília.
function partesSP(agora) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = {};
  f.formatToParts(agora || new Date()).forEach(x => { p[x.type] = x.value; });
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24 };
}
const diaSP = agora => partesSP(agora).dia;
function saudacao(agora) {
  const h = partesSP(agora).hora;
  return h < 12 ? "bom dia" : h < 18 ? "boa tarde" : "boa noite";
}

// ── nomes e casamento área → supervisor ─────────────────────────────────────
const normalizar = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// "FRANK" ⊂ "FRANK PIMENTEL": um nome inteiro dentro do outro (palavra inteira, não pedaço de palavra).
const contem = (a, b) => !!a && !!b && (" " + a + " ").indexOf(" " + b + " ") >= 0;

// A falta chega pelo nome da área (AREASUPERVISAO da planilha). Vale só se der
// exatamente UM cadastro: na dúvida ninguém recebe, e a área aparece no painel
// como "sem cadastro" — mandar a falta de um para outro seria pior que não mandar.
function casarArea(area, contatos) {
  const a = normalizar(area);
  if (!a) return { contato: null, motivo: "SEM_AREA" };
  const iguais = contatos.filter(c => normalizar(c.area) === a);
  if (iguais.length === 1) return { contato: iguais[0] };
  if (iguais.length > 1) return { contato: null, motivo: "AMBIGUA" };
  const parecidos = contatos.filter(c => { const b = normalizar(c.area); return contem(a, b) || contem(b, a); });
  if (parecidos.length === 1) return { contato: parecidos[0] };
  return { contato: null, motivo: parecidos.length ? "AMBIGUA" : "SEM_CADASTRO" };
}

// ── texto do aviso ──────────────────────────────────────────────────────────
const primeiroNome = n => { const p = String(n || "").trim().split(/\s+/)[0] || ""; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };
const corta = (s, n) => { s = String(s == null ? "" : s).trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);

// Uma linha por pessoa, com o dia de cada falta (quem faltou dois dias aparece uma vez, com as duas datas).
const ddmm = d => { const s = String(d || ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) : ""; };
const emLista = l => (l.length <= 1 ? l.join("") : l.slice(0, -1).join(", ") + " e " + l[l.length - 1]);
function linhasPorPessoa(faltas) {
  const porRE = new Map();
  faltas.forEach(f => {
    const k = String(f.re);
    if (!porRE.has(k)) porRE.set(k, { re: f.re, nome: f.nome, posto: f.posto, datas: [] });
    porRE.get(k).datas.push(String(f.data || "").slice(0, 10));
  });
  const l = [...porRE.values()];
  l.forEach(p => { p.datas = [...new Set(p.datas)].sort(); p.n = p.datas.length || 1; });
  return l.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
}
function linhaPessoa(p, corte) {
  const datas = p.datas.map(ddmm).filter(Boolean);
  const quando = datas.length ? (datas.length === 1 ? " — falta em " + datas[0] : " — faltas em " + emLista(datas)) : "";
  return `• ${corta(p.nome || "SEM NOME", corte ? 48 : 120)} — RE ${p.re} — ${corta(p.posto || "Reserva técnica", corte ? 40 : 120)}${quando}`;
}

// tipo: RESUMO | SEM_FALTAS. jaAvisou: já saiu aviso para esta pessoa hoje ("Chegaram mais...").
// completo: a versão que o app mostra ao tocar na notificação — todo mundo, sem cortar nada.
function montarTexto({ nome, faltas, jaAvisou, agora, tipo, completo }) {
  const sauda = "Muito " + saudacao(agora) + ", " + (primeiroNome(nome) || "supervisor") + "!";
  if (tipo === "SEM_FALTAS" || !faltas || !faltas.length) {
    return {
      titulo: "ServCamp · sem faltas injustificadas",
      corpo: sauda + " Hoje não temos faltas injustificadas novas na sua área. Bom trabalho!"
    };
  }
  const n = faltas.length;
  const abertura = jaAvisou
    ? (n === 1 ? "Chegou mais 1 falta injustificada na sua área:" : `Chegaram mais ${n} faltas injustificadas na sua área:`)
    : `Temos ${plural(n, "falta injustificada", "faltas injustificadas")} na sua área:`;
  const pessoas = linhasPorPessoa(faltas);
  const fecho = "Por gentileza, verifique se há atestados que justifiquem a ausência. Caso não haja, aplicar medida disciplinar até o próximo plantão.";
  const titulo = "ServCamp · " + plural(n, "falta injustificada", "faltas injustificadas");
  if (completo) return { titulo, corpo: [sauda + " " + abertura, ...pessoas.map(p => linhaPessoa(p, false)), fecho].join("\n") };
  // Corta nomes e postos e, se ainda passar do limite, lista menos gente: o
  // serviço de push recusa a mensagem inteira acima de 4 KB.
  for (let max = MAX_LINHAS; max >= 1; max--) {
    const vis = pessoas.slice(0, max), resto = pessoas.length - vis.length;
    const linhas = vis.map(p => linhaPessoa(p, true));
    if (resto > 0) linhas.push(`+ ${resto} — toque para ver o aviso completo`);
    const corpo = [sauda + " " + abertura, ...linhas, fecho].join("\n");
    if (Buffer.byteLength(JSON.stringify({ titulo, corpo }), "utf8") <= MAX_PAYLOAD - 300) return { titulo, corpo };
  }
  return { titulo, corpo: sauda + " " + abertura + "\n+ " + pessoas.length + " — toque para ver o aviso completo\n" + fecho };
}

// O que vai para o celular. O service worker (sw.js) monta a notificação com isto.
function payload(texto, tipo, dia, aviso) {
  const p = { titulo: texto.titulo, corpo: texto.corpo, tipo, pg: PAGINA, aviso, url: "/?abrir=" + PAGINA + (aviso ? "&aviso=" + aviso : ""), tag: "faltas-" + dia + (tipo === "TESTE" ? "-teste" : "") };
  const s = JSON.stringify(p);
  if (Buffer.byteLength(s, "utf8") > MAX_PAYLOAD) throw new Error("aviso grande demais");
  return s;
}

// ── onde fica guardado ──────────────────────────────────────────────────────
// Nenhuma tabela nova: tudo vira registro na tabela de registros que já existe
// (fm_auditoria), como os atestados e as chaves do Excel. Cada coisa é uma
// sequência de eventos e o último evento de cada chave é o que vale. Assim o
// módulo entra no ar sem ninguém precisar rodar SQL no Supabase.
//   AVISO_CONTATO_CRIADO/EDITADO/REMOVIDO  chave = id do supervisor
//   AVISO_APARELHO / AVISO_APARELHO_REMOVIDO chave = "ap|" + resumo do endereço
//   AVISO_RESERVA / AVISO_DEVOLVIDA        chave = "RE|data" (cada falta avisada uma vez)
//   AVISO_ENVIO                            um por aviso que saiu (para o painel e o "uma vez por dia")
//   AVISO_AUTO_ALTERADO                    liga/desliga o automático (sem registro = desligado)
//   AVISO_VAPID                            par de chaves do envio, gerado aqui no primeiro uso
// A tabela só é lida pelo servidor (RLS + service_role), e toda leitura dela
// no sistema filtra pelo tipo de registro: a chave privada nunca sai daqui.
const ACAO_APARELHO = "AVISO_APARELHO";
const ACAO_APARELHO_FIM = "AVISO_APARELHO_REMOVIDO";
const ACAO_RESERVA = "AVISO_RESERVA";
const ACAO_DEVOLVIDA = "AVISO_DEVOLVIDA";
const ACAO_ENVIO = "AVISO_ENVIO";
const ACAO_VAPID = "AVISO_VAPID";
const ENTIDADE = "fs_avisos";

const ev = (ator, acao, chave, depois, antes) => ({ ator: ator || "sistema", acao, entidade: ENTIDADE, chave: String(chave), antes: antes || null, depois: depois || null });
const eventos = (db, acoes, desde) => db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${acoes.join(",")})${desde ? `&criado_em=gte.${desde}` : ""}&order=id.asc`);
function ultimoPorChave(lista) { const m = new Map(); lista.forEach(e => m.set(e.chave, e)); return m; }
const resumoEndereco = ep => "ap|" + require("crypto").createHash("sha256").update(String(ep)).digest("hex").slice(0, 32);

async function lerContatos(db) {
  const lista = await eventos(db, [ACAO_CRIADO, ACAO_EDITADO, ACAO_REMOVIDO]);
  const ids = lista.map(e => Number(e.chave)).filter(Number.isInteger);
  const vivos = [...ultimoPorChave(lista).values()].filter(e => e.acao !== ACAO_REMOVIDO && e.depois).map(e => ({ ...e.depois, id: Number(e.chave), ativo: e.depois.ativo !== false }));
  vivos.sort((a, b) => String(a.nome).localeCompare(String(b.nome)) || a.id - b.id);
  return { contatos: vivos, proximoId: (ids.length ? Math.max(...ids) : 0) + 1 };
}
async function lerAparelhos(db) {
  const lista = await eventos(db, [ACAO_APARELHO, ACAO_APARELHO_FIM]);
  return [...ultimoPorChave(lista).values()].filter(e => e.acao === ACAO_APARELHO && e.depois).map(e => ({ id: e.chave, ...e.depois }));
}
async function lerAuto(db) {
  const [e] = await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_AUTO}&order=id.desc&limit=1`);
  return !!(e && e.depois && e.depois.ligado === true); // sem registro = desligado
}

// Faltas já avisadas. A reserva é gravada ANTES do envio e vale a PRIMEIRA de
// cada falta: se duas planilhas chegarem juntas, as duas gravam, as duas releem
// e só uma se vê como dona — a mesma falta não sai duas vezes. Se nenhum
// aparelho recebeu, a reserva é devolvida e a falta volta para a fila.
function estadoReservas(lista) {
  const m = new Map();
  lista.forEach(e => {
    const d = e.depois || {}, atual = m.get(e.chave) || null;
    if (e.acao === ACAO_RESERVA && !atual) m.set(e.chave, { lote: d.lote, contato_id: d.contato_id });
    else if (e.acao === ACAO_DEVOLVIDA && atual && atual.lote === d.lote) m.delete(e.chave);
  });
  return m;
}
const desdeReservas = hoje => R.somaDias(hoje, -(JANELA_DIAS + 7)) + "T00:00:00Z";

// ── configuração do envio (VAPID) ───────────────────────────────────────────
// As chaves podem vir da Vercel (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY), mas não
// precisam: sem elas, o servidor gera o par no primeiro uso e guarda. Se duas
// chamadas gerarem ao mesmo tempo, vale sempre o primeiro registro.
const SUBJECT = () => process.env.VAPID_SUBJECT || "https://gruposervcamp.com.br";
async function vapid(db) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, subject: SUBJECT(), ok: true };
  const ler = async () => (await db.obter(`fm_auditoria?select=depois&acao=eq.${ACAO_VAPID}&order=id.asc&limit=1`))[0];
  let e = await ler();
  if (!e) {
    const k = require("web-push").generateVAPIDKeys();
    await db.inserir("fm_auditoria", [ev("sistema", ACAO_VAPID, "vapid", { pub: k.publicKey, priv: k.privateKey })]);
    e = await ler();
  }
  const d = (e && e.depois) || {};
  return { pub: d.pub || "", priv: d.priv || "", subject: SUBJECT(), ok: !!(d.pub && d.priv) };
}

// Envio de um push. Os testes trocam esta função (definirEnviador) para nada sair da máquina.
let enviador = async function enviarComWebPush(aparelho, corpo, v) {
  const webpush = require("web-push");
  try {
    const r = await webpush.sendNotification(
      { endpoint: aparelho.endpoint, keys: { p256dh: aparelho.p256dh, auth: aparelho.auth } },
      corpo,
      { TTL: TTL_SEGUNDOS, urgency: "high", vapidDetails: { subject: v.subject, publicKey: v.pub, privateKey: v.priv }, timeout: 10000 }
    );
    return { ok: true, status: r && r.statusCode };
  } catch (e) {
    return { ok: false, status: e && e.statusCode, erro: String((e && e.message) || e).slice(0, 200) };
  }
};
function definirEnviador(fn) { const antes = enviador; enviador = fn; return antes; }

// Manda para cada aparelho. Aparelho que o serviço diz não existir mais (404/410:
// app desinstalado, permissão retirada) sai da lista; outra falha não apaga,
// porque pode ser só o celular sem sinal.
async function mandar(db, aparelhos, corpo, v) {
  let ok = 0;
  for (const a of aparelhos) {
    let r;
    try { r = await enviador(a, corpo, v); } catch (e) { r = { ok: false, erro: String(e && e.message || e) }; }
    if (r.ok) { ok++; continue; }
    if (r.status === 404 || r.status === 410) {
      try { await db.inserir("fm_auditoria", [ev("sistema", ACAO_APARELHO_FIM, a.id, null, { user_key: a.user_key, motivo: "servico_" + r.status })]); }
      catch (e) { console.error("[avisos] não tirou o aparelho:", e && e.message); }
    } else console.error("[avisos] push não entregue (" + (r.status || "rede") + ")");
  }
  return ok;
}

// ── leitura do que vai no aviso ─────────────────────────────────────────────
// Faltas injustificadas dos últimos dias, já sem as que não contam: abonada (o
// código deixa de ser "I"), coberta por atestado registrado à mão (igual à tela
// do módulo, em _faltas.js) e anterior à admissão (RE reaproveitado).
async function faltasDaJanela(db, hoje) {
  const desde = R.somaDias(hoje, -JANELA_DIAS);
  const [faltas, adm, atest] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,codigo,nome,posto,supervisor&codigo=eq.I&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar("fm_admissoes?select=re,admissao&order=re.asc"),
    db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${faltasMod.ACOES_ATESTADO.join(",")})&order=criado_em.asc,id.asc`)
  ]);
  const admissao = {};
  adm.forEach(a => { if (a.admissao) admissao[String(a.re)] = String(a.admissao).slice(0, 10); });
  const { ativos: atestados } = R.dobrarAtestados(atest);
  return faltas.map(f => ({ ...f, data: String(f.data).slice(0, 10), supervisor: R.supervisorAtual(f.supervisor) })).filter(f => {
    if (String(f.codigo || "").toUpperCase() !== "I") return false;
    const adm = admissao[String(f.re)];
    if (adm && f.data < adm) return false;
    return !atestados.some(a => a.re === String(f.re) && f.data >= a.inicio && f.data <= a.fim);
  });
}

// Tudo o que o envio e a prévia precisam, numa leitura só.
async function panorama(db, agora) {
  const hoje = diaSP(agora);
  const [{ contatos }, aparelhos, faltas, reservas, envios] = await Promise.all([
    lerContatos(db),
    lerAparelhos(db),
    faltasDaJanela(db, hoje),
    eventos(db, [ACAO_RESERVA, ACAO_DEVOLVIDA], desdeReservas(hoje)),
    eventos(db, [ACAO_ENVIO], R.somaDias(hoje, -1) + "T00:00:00Z")
  ]);
  const avisadas = estadoReservas(reservas);
  const doDia = envios.map(e => ({ ...(e.depois || {}), em: e.criado_em })).filter(e => e.dia === hoje);
  const porContato = new Map(contatos.map(c => [c.id, { contato: c, faltas: [], novas: [] }]));
  const semCadastro = new Map(); // área → { area, faltas, motivo }
  faltas.forEach(f => {
    const m = casarArea(f.supervisor, contatos);
    if (!m.contato) {
      const k = String(f.supervisor || "(sem área)");
      if (!semCadastro.has(k)) semCadastro.set(k, { area: k, faltas: 0, motivo: m.motivo });
      semCadastro.get(k).faltas++;
      return;
    }
    const g = porContato.get(m.contato.id);
    g.faltas.push(f);
    if (!avisadas.has(f.re + "|" + f.data)) g.novas.push(f);
  });
  const aparelhosDe = uk => aparelhos.filter(a => a.user_key === uk);
  return { hoje, contatos, aparelhos, aparelhosDe, porContato, semCadastro: [...semCadastro.values()], envios: doDia };
}

// O registro guarda o aviso inteiro (texto completo e a lista de faltas): é o
// que o app mostra quando a pessoa toca na notificação.
const novoIdAviso = () => require("crypto").randomBytes(8).toString("hex");
const faltasDoAviso = l => l.map(f => ({ re: f.re, nome: f.nome || null, posto: f.posto || null, data: String(f.data || "").slice(0, 10) || null }));
async function anotarEnvio(db, ator, d) {
  await db.inserir("fm_auditoria", [ev(ator, ACAO_ENVIO, d.aviso, d)]);
}

// ── envio (automático e manual) ─────────────────────────────────────────────
// modo "novas": só o que ainda não foi avisado. "todas": reenvia a janela inteira.
// semFaltas: manda "sem faltas" para quem não tem nada novo.
async function processar(db, { origem, ids, modo, semFaltas, ator, agora }) {
  agora = agora || new Date();
  const v = await vapid(db);
  const P = await panorama(db, agora);
  const alvo = ids ? new Set(ids.map(Number)) : null;
  const tot = { supervisores: 0, avisos: 0, semFaltas: 0, faltas: 0, aparelhos: 0, semAparelho: 0, falhou: 0, semCadastro: P.semCadastro.length };
  if (!v.ok) return { ...tot, ignorado: "SEM_CHAVES" };
  for (const { contato, faltas, novas } of P.porContato.values()) {
    if (alvo && !alvo.has(Number(contato.id))) continue;
    if (!contato.ativo) continue; // pausado
    tot.supervisores++;
    const aps = P.aparelhosDe(contato.user_key);
    if (!aps.length) { tot.semAparelho++; continue; }
    const doDia = P.envios.filter(e => Number(e.contato_id) === Number(contato.id) && e.tipo !== "TESTE");
    const lista = modo === "todas" ? faltas : novas;
    if (lista.length) {
      // reserva antes de enviar e relê: só vai o que ficou com ESTA chamada
      const lote = require("crypto").randomBytes(6).toString("hex");
      const novasAqui = lista.filter(f => novas.includes(f));
      if (novasAqui.length) await db.inserir("fm_auditoria", novasAqui.map(f => ev(ator, ACAO_RESERVA, f.re + "|" + f.data, { contato_id: contato.id, lote })));
      const dono = estadoReservas(await eventos(db, [ACAO_RESERVA, ACAO_DEVOLVIDA], desdeReservas(P.hoje)));
      const minhas = novasAqui.filter(f => { const r = dono.get(f.re + "|" + f.data); return r && r.lote === lote; });
      const vai = modo === "todas" ? lista : minhas;
      if (!vai.length) continue; // outra atualização já avisou estas
      const jaAvisou = doDia.some(e => e.tipo === "RESUMO");
      const opcoesTexto = { nome: contato.nome, faltas: vai, jaAvisou: modo === "todas" ? false : jaAvisou, agora, tipo: "RESUMO" };
      const texto = montarTexto(opcoesTexto), aviso = novoIdAviso();
      const ok = await mandar(db, aps, payload(texto, "RESUMO", P.hoje, aviso), v);
      if (!ok) {
        // nenhum aparelho recebeu: as faltas voltam para a fila e saem no próximo envio
        if (minhas.length) await db.inserir("fm_auditoria", minhas.map(f => ev(ator, ACAO_DEVOLVIDA, f.re + "|" + f.data, { lote })));
        tot.falhou++;
        continue;
      }
      await anotarEnvio(db, ator, { aviso, contato_id: contato.id, nome: contato.nome, user_key: contato.user_key, dia: P.hoje, tipo: "RESUMO", origem, qtd: vai.length, aparelhos: ok, titulo: texto.titulo, corpo: montarTexto({ ...opcoesTexto, completo: true }).corpo, faltas: faltasDoAviso(vai) });
      tot.avisos++; tot.faltas += vai.length; tot.aparelhos += ok;
      continue;
    }
    // Sem nada novo. Automático: "sem faltas" no máximo uma vez por dia e só se
    // ainda não saiu aviso hoje. Manual: só quando o aprovador marcou a opção.
    const querSem = origem === "auto" ? !doDia.length : !!semFaltas || modo === "todas";
    if (!querSem) continue;
    const texto = montarTexto({ nome: contato.nome, faltas: [], agora, tipo: "SEM_FALTAS" }), aviso = novoIdAviso();
    const ok = await mandar(db, aps, payload(texto, "SEM_FALTAS", P.hoje, aviso), v);
    if (!ok) { tot.falhou++; continue; }
    await anotarEnvio(db, ator, { aviso, contato_id: contato.id, nome: contato.nome, user_key: contato.user_key, dia: P.hoje, tipo: "SEM_FALTAS", origem, qtd: 0, aparelhos: ok, titulo: texto.titulo, corpo: texto.corpo, faltas: [] });
    tot.semFaltas++; tot.aparelhos += ok;
  }
  return tot;
}

// Chamado pelo api/import.js logo depois de guardar as faltas. Devolve só
// contagens (a resposta da importação não leva nome de ninguém). Nunca lança.
async function aposImportar(opcoes) {
  const o = opcoes || {};
  try {
    const db = o.db || ponto.conectar();
    if (!db) return { ok: false, ignorado: "CONFIG_AUSENTE" };
    if (!(await lerAuto(db))) return { ok: true, ignorado: "AUTO_DESLIGADO" };
    const t = await processar(db, { origem: "auto", modo: "novas", ator: "sistema", agora: o.agora });
    return { ok: true, ...t };
  } catch (e) {
    console.error("[avisos] envio automático falhou: " + (e && e.message ? e.message : e));
    return { ok: false, erro: "FALHA_NO_ENVIO" };
  }
}

// ── rotas de qualquer pessoa logada ─────────────────────────────────────────
async function verChave({ res, db }) {
  const v = await vapid(db);
  return res.status(200).json({ ok: true, chave: v.ok ? v.pub : null, configurado: v.ok });
}

async function contatoDoUsuario(db, ator) {
  if (!ator) return null;
  return (await lerContatos(db)).contatos.find(c => c.user_key === ator) || null;
}
async function aparelhosDoUsuario(db, ator) { return ator ? (await lerAparelhos(db)).filter(a => a.user_key === ator) : []; }

async function verStatus({ res, db, ator }) {
  const c = await contatoDoUsuario(db, ator);
  const aps = await aparelhosDoUsuario(db, ator);
  return res.status(200).json({ ok: true, recebe: !!(c && c.ativo), cadastrado: !!c, aprovador: ponto.APROVADORES.has(ator), aparelhos: aps.length, configurado: true });
}

function endpointValido(e) {
  if (typeof e !== "string" || e.length < 20 || e.length > 1000) return false;
  let u;
  try { u = new URL(e); } catch (x) { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  return SERVICOS_PUSH.some(s => h === s || h.endsWith("." + s));
}
const chaveB64 = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

async function inscrever({ res, db, ator, body }) {
  if (!ator) return erro(res, 401, "Entre no sistema para ativar os avisos.", "SEM_LOGIN");
  const c = await contatoDoUsuario(db, ator);
  if (!(c && c.ativo) && !ponto.APROVADORES.has(ator)) return erro(res, 403, "Você não está cadastrado para receber os avisos de faltas.", "NAO_CADASTRADO");
  const keys = body.keys || {};
  if (!endpointValido(body.endpoint)) return erro(res, 400, "Endereço de notificação não reconhecido.", "ENDPOINT_INVALIDO");
  // p256dh: chave pública de 65 bytes (87 caracteres em base64url); auth: 16 bytes (22)
  if (!chaveB64(keys.p256dh, 80, 100) || !chaveB64(keys.auth, 16, 30)) return erro(res, 400, "Chaves do aparelho inválidas.", "CHAVES_INVALIDAS");
  // o mesmo aparelho reinscrito (ou passado para outra pessoa) fica com quem ativou por último
  await db.inserir("fm_auditoria", [ev(ator, ACAO_APARELHO, resumoEndereco(body.endpoint), { user_key: ator, endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth, agente: String(body.agente || "").slice(0, 200) || null })]);
  return res.status(200).json({ ok: true, aparelhos: (await aparelhosDoUsuario(db, ator)).length });
}

async function cancelar({ res, db, ator, body }) {
  if (!ator) return erro(res, 401, "Entre no sistema.", "SEM_LOGIN");
  // só os aparelhos da própria pessoa: os de outra nem entram na lista
  const meus = (await aparelhosDoUsuario(db, ator)).filter(a => !body.endpoint || a.endpoint === String(body.endpoint));
  if (meus.length) await db.inserir("fm_auditoria", meus.map(a => ev(ator, ACAO_APARELHO_FIM, a.id, null, { user_key: ator })));
  return res.status(200).json({ ok: true, aparelhos: (await aparelhosDoUsuario(db, ator)).length });
}

// O aviso completo, aberto pelo toque na notificação. Só quem recebeu (ou um aprovador) vê.
async function verAviso({ req, res, db, ator }) {
  const id = String((req.query && req.query.id) || "");
  if (!/^[a-f0-9]{16}$/.test(id)) return erro(res, 400, "Aviso inválido.", "AVISO_INVALIDO");
  const [e] = await db.obter(`fm_auditoria?select=depois,criado_em&acao=eq.${ACAO_ENVIO}&chave=eq.${id}&order=id.asc&limit=1`);
  const d = e && e.depois;
  if (!d) return erro(res, 404, "Aviso não encontrado.", "NAO_ENCONTRADO");
  if (!(ator && (d.user_key === ator || ponto.APROVADORES.has(ator)))) return erro(res, 403, "Este aviso é de outra pessoa.", "NAO_AUTORIZADO");
  return res.status(200).json({ ok: true, aviso: { id, tipo: d.tipo, nome: d.nome, dia: d.dia, enviado_em: e.criado_em, titulo: d.titulo || "", corpo: d.corpo || "", faltas: d.faltas || [] } });
}

// ── rotas dos aprovadores ───────────────────────────────────────────────────
async function verPrevia({ res, db, ator }) {
  const agora = new Date();
  const P = await panorama(db, agora);
  const [auto, areasRecentes] = await Promise.all([
    lerAuto(db),
    db.listar(`fm_faltas?select=supervisor&data=gte.${R.somaDias(P.hoje, -45)}&order=supervisor.asc`)
  ]);
  const contatos = [...P.porContato.values()].map(({ contato: c, faltas, novas }) => {
    const doDia = P.envios.filter(e => Number(e.contato_id) === Number(c.id) && e.tipo !== "TESTE");
    const ult = doDia[doDia.length - 1] || null;
    return {
      id: c.id, nome: c.nome, area: c.area, user_key: c.user_key, ativo: !!c.ativo,
      aparelhos: P.aparelhosDe(c.user_key).length,
      novas: novas.length, total: faltas.length,
      faltas: faltas.map(f => ({ re: f.re, nome: f.nome, posto: f.posto, data: f.data, nova: novas.includes(f) })),
      aviso: montarTexto({ nome: c.nome, faltas: novas, jaAvisou: doDia.some(e => e.tipo === "RESUMO"), agora, tipo: novas.length ? "RESUMO" : "SEM_FALTAS" }),
      ultimoEnvio: ult ? { tipo: ult.tipo, origem: ult.origem, em: ult.em } : null
    };
  });
  // áreas da planilha (últimas semanas) que nenhum cadastro cobre: viram sugestão no formulário
  const areas = [...new Set(areasRecentes.map(a => String(R.supervisorAtual(a.supervisor) || "").trim()).filter(Boolean))].sort();
  return res.status(200).json({
    ok: true, hoje: P.hoje, configurado: true, auto, contatos,
    semCadastro: P.semCadastro, areasLivres: areas.filter(a => casarArea(a, P.contatos).motivo === "SEM_CADASTRO"),
    meusAparelhos: P.aparelhosDe(ator).length, usuarios: USUARIOS
  });
}

function validarContato(body, contatos, id) {
  const nome = String(body.nome == null ? "" : body.nome).trim().slice(0, 80);
  const area = String(body.area == null ? "" : body.area).trim().slice(0, 120);
  const uk = String(body.user_key == null ? "" : body.user_key).trim();
  if (!nome) return { erro: ["Informe o nome do supervisor.", "SEM_NOME"] };
  if (!area) return { erro: ["Informe o nome da área como vem na planilha.", "SEM_AREA"] };
  if (USUARIOS.indexOf(uk) < 0) return { erro: ["Login inexistente no sistema.", "LOGIN_INVALIDO"] };
  const outros = contatos.filter(c => Number(c.id) !== Number(id));
  if (outros.some(c => normalizar(c.area) === normalizar(area))) return { erro: ["Já existe um supervisor cadastrado para essa área.", "AREA_DUPLICADA"] };
  if (outros.some(c => c.user_key === uk)) return { erro: ["Esse login já está cadastrado em outro supervisor.", "LOGIN_DUPLICADO"] };
  return { linha: { nome, area, user_key: uk } };
}

async function criarContato({ res, db, ator, body }) {
  const { contatos, proximoId } = await lerContatos(db);
  const v = validarContato(body, contatos, null);
  if (v.erro) return erro(res, 400, v.erro[0], v.erro[1]);
  const novo = { ...v.linha, ativo: true, criado_por: ator, criado_em: new Date().toISOString() };
  await db.inserir("fm_auditoria", [ev(ator, ACAO_CRIADO, proximoId, novo)]);
  return res.status(200).json({ ok: true, contato: { id: proximoId, ...novo } });
}

async function editarContato({ res, db, ator, body }) {
  const id = Number(body.id);
  if (!Number.isInteger(id)) return erro(res, 400, "Informe o supervisor.", "SEM_ID");
  const { contatos } = await lerContatos(db);
  const atual = contatos.find(c => c.id === id);
  if (!atual) return erro(res, 404, "Supervisor não encontrado.", "NAO_ENCONTRADO");
  const junto = { nome: body.nome != null ? body.nome : atual.nome, area: body.area != null ? body.area : atual.area, user_key: body.user_key != null ? body.user_key : atual.user_key };
  const v = validarContato(junto, contatos, id);
  if (v.erro) return erro(res, 400, v.erro[0], v.erro[1]);
  const ativo = body.ativo === true || body.ativo === false ? body.ativo : atual.ativo; // pausar / reativar
  const antes = { nome: atual.nome, area: atual.area, user_key: atual.user_key, ativo: atual.ativo };
  await db.inserir("fm_auditoria", [ev(ator, ACAO_EDITADO, id, { ...atual, ...v.linha, ativo, id: undefined, atualizado_por: ator, atualizado_em: new Date().toISOString() }, antes)]);
  return res.status(200).json({ ok: true });
}

async function removerContato({ res, db, ator, body }) {
  const id = Number(body.id);
  if (!Number.isInteger(id)) return erro(res, 400, "Informe o supervisor.", "SEM_ID");
  const atual = (await lerContatos(db)).contatos.find(c => c.id === id);
  if (!atual) return erro(res, 404, "Supervisor não encontrado.", "NAO_ENCONTRADO");
  await db.inserir("fm_auditoria", [ev(ator, ACAO_REMOVIDO, id, null, { nome: atual.nome, area: atual.area, user_key: atual.user_key, ativo: atual.ativo })]);
  return res.status(200).json({ ok: true });
}

async function enviarManual({ res, db, ator, body }) {
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return erro(res, 400, "Escolha ao menos um supervisor.", "SEM_SELECAO");
  const modo = body.modo === "todas" ? "todas" : "novas";
  if (body.confirmar !== true) return erro(res, 400, "Confirme o envio.", "SEM_CONFIRMACAO");
  const t = await processar(db, { origem: "manual", ids, modo, semFaltas: body.semFaltas === true, ator });
  return res.status(200).json({ ok: true, ...t });
}

const EXEMPLO = () => {
  const ontem = R.somaDias(diaSP(new Date()), -1);
  return [
    { re: 12345, nome: "MARIA EXEMPLO DA SILVA", posto: "COND - POSTO DE EXEMPLO", data: ontem },
    { re: 67890, nome: "JOÃO EXEMPLO SOUZA", posto: "EDIFÍCIO EXEMPLO", data: ontem }
  ];
};
async function enviarTeste({ res, db, ator, body }) {
  // só para os aparelhos de QUEM PEDIU: um teste nunca cai no celular de um supervisor
  const aps = await aparelhosDoUsuario(db, ator);
  if (!aps.length) return erro(res, 409, "Ative os avisos neste aparelho antes de enviar o teste.", "SEM_APARELHO");
  const agora = new Date();
  // exemplo fictício (2 faltas) saudando quem pediu, ou as faltas reais de um supervisor escolhido
  let faltas = EXEMPLO(), nome = String(body.nome || ator || "").slice(0, 60), contatoId = null;
  if (body.contato_id != null) {
    const P = await panorama(db, agora);
    const g = [...P.porContato.values()].find(x => Number(x.contato.id) === Number(body.contato_id));
    if (!g) return erro(res, 404, "Supervisor não encontrado.", "NAO_ENCONTRADO");
    faltas = g.novas.length ? g.novas : g.faltas;
    nome = g.contato.nome; contatoId = g.contato.id;
  }
  const opcoesTexto = { nome, faltas, agora, tipo: faltas.length ? "RESUMO" : "SEM_FALTAS" };
  const texto = montarTexto(opcoesTexto), aviso = novoIdAviso();
  texto.titulo = "TESTE · " + texto.titulo;
  const ok = await mandar(db, aps, payload(texto, "TESTE", diaSP(agora), aviso), await vapid(db));
  // não reserva nenhuma falta: o teste não tira nada da fila
  await anotarEnvio(db, ator, { aviso, contato_id: contatoId, nome, user_key: ator, dia: diaSP(agora), tipo: "TESTE", origem: "manual", qtd: faltas.length, aparelhos: ok, titulo: texto.titulo, corpo: montarTexto({ ...opcoesTexto, completo: true }).corpo, faltas: faltasDoAviso(faltas) });
  return res.status(200).json({ ok: ok > 0, aparelhos: ok, de: aps.length, texto, aviso });
}

async function salvarAuto({ res, db, ator, body }) {
  if (body.ligado !== true && body.ligado !== false) return erro(res, 400, "Informe ligado: true ou false.", "VALOR_INVALIDO");
  const antes = await lerAuto(db);
  if (antes !== body.ligado) await db.inserir("fm_auditoria", [ev(ator, ACAO_AUTO, "auto", { ligado: body.ligado }, { ligado: antes })]);
  return res.status(200).json({ ok: true, auto: body.ligado });
}

// ── roteamento ──────────────────────────────────────────────────────────────
const ROTAS = {
  "GET chave": { fn: verChave },
  "GET status": { fn: verStatus },
  "POST inscrever": { fn: inscrever },
  "POST cancelar": { fn: cancelar },
  "GET aviso": { fn: verAviso },
  "GET previa": { aprovador: true, fn: verPrevia },
  "POST contato": { aprovador: true, fn: criarContato },
  "POST editar": { aprovador: true, fn: editarContato },
  "POST remover": { aprovador: true, fn: removerContato },
  "POST enviar": { aprovador: true, fn: enviarManual },
  "POST teste": { aprovador: true, fn: enviarTeste },
  "POST auto": { aprovador: true, fn: salvarAuto }
};

module.exports = async function avisos(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const ator = ponto.usuarioDoToken(req);
  // a checagem é AQUI, no servidor: esconder o botão no front é conveniência, não segurança
  if (rota.aprovador && !(ator && ponto.APROVADORES.has(ator))) return erro(res, 403, "Ação restrita aos aprovadores.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  try {
    return await rota.fn({ req, res, db, ator, body });
  } catch (e) {
    console.error("[avisos] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.aposImportar = aposImportar;
module.exports.processar = processar;
module.exports.definirEnviador = definirEnviador;
module.exports.montarTexto = montarTexto;
module.exports.saudacao = saudacao;
module.exports.casarArea = casarArea;
module.exports.endpointValido = endpointValido;
module.exports.estadoReservas = estadoReservas;
module.exports.MAX_PAYLOAD = MAX_PAYLOAD;
