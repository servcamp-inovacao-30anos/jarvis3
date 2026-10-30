// Aviso semanal de faltas injustificadas por e-mail, contra um Supabase falso em memória.
// Nada sai da máquina: o envio de e-mail é trocado por uma função que só anota, e o
// relógio é fixo (segunda, 26/10/2026, 14h10 em Brasília) para a regra da semana valer.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
process.env.FALTAS_MAIL_USER = "remetente@gruposervcamp.com.br";
process.env.FALTAS_MAIL_PASS = "senha-de-teste";
process.env.CRON_SECRET = "cron-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const FE = require("../api/_faltas_email");
const HTML = require("../api/_faltas_email_html");
const R = require("../api/_faltas_regras");
const rh = require("../api/rh");

const RESP = "raphaelvictor";
const SEG = new Date("2026-10-26T17:10:00Z");     // segunda, 14h10 em São Paulo
const SEG_SEGUINTE = new Date("2026-11-02T17:10:00Z");
let agora = SEG;
FE.definirRelogio(() => agora);

// cada e-mail "enviado" fica aqui; falhar(m) simula o servidor de e-mail recusando
let enviados = [], falhar = () => false;
FE.definirCorreio(async m => {
  const f = falhar(m);
  if (f === true) return { ok: false, erro: "falha simulada" };
  enviados.push(m);
  // { recusar: [...] }: o servidor aceita a mensagem mas recusa esses endereços
  if (f && f.recusar) { const todos = [...m.para, ...(m.cc || [])]; return { ok: true, id: "<id-" + enviados.length + "@teste>", aceitos: todos.filter(e => !f.recusar.includes(e)), recusados: f.recusar }; }
  return { ok: true, id: "<id-" + enviados.length + "@teste>" };
});

const ANTES = "2026-10-20T12:00:00Z"; // registrada bem antes do corte de domingo
let seq = 0;
const reg = (acao, chave, depois, extra) => ({ id: ++seq, ator: RESP, acao, entidade: "fm_email", chave: String(chave), antes: null, depois, criado_em: "2026-10-01T12:00:00Z", ...extra });
const falta = (re, data, supervisor, extra) => ({ re, data, codigo: "I", nome: "PESSOA " + re, cargo: "PORTEIRO", posto: "POSTO " + re, supervisor, escala: "12X36 SDF", tipo: "CONTRATO", criado_em: ANTES, ...extra });
const COPIAS = [{ nome: "Coordenação", email: "copia1@exemplo.com.br" }, { nome: "Diretoria A", email: "copia2@exemplo.com.br" }, { nome: "Diretoria B", email: "copia3@exemplo.com.br" }];

function base(o) {
  o = o || {};
  enviados = []; falhar = () => false; seq = 0; agora = SEG;
  const t = {
    fm_faltas: [
      falta(101, "2026-10-20", "JEAN KLEBER", { nome: "ANA PAULA DE SOUZA" }),
      falta(101, "2026-10-22", "JEAN KLEBER", { nome: "ANA PAULA DE SOUZA" }),
      falta(102, "2026-10-21", "EDNEY FERRAZ", { nome: "BRUNO DO EDNEY" }),        // área do Edney → Jean
      falta(201, "2026-10-23", "FRANK PIMENTEL", { nome: "CAIO DO FRANK" }),
      falta(202, "2026-10-24", "FRANK PIMENTEL", { nome: "DORA ABONADA", codigo: "A" }),
      falta(203, "2026-10-25", "FRANK PIMENTEL", { nome: "EDU ATRASADO", criado_em: "2026-10-26T12:00:00Z" }), // lançada depois do corte
      falta(301, "2026-10-19", "RAFAEL ANDRADE", { nome: "FABIO DO RAFAEL", posto: "" }), // área do Rafael → Carlos Nogueira
      falta(401, "2026-10-18", "JEAN KLEBER", { nome: "GIL SEMANA PASSADA" }),
      falta(501, "2026-10-23", "JEAN KLEBER", { nome: "HELO COM ATESTADO" }),
      falta(601, "2026-10-24", "JEAN KLEBER", { nome: "IVO ANTES DA ADMISSAO" }),
      falta(701, "2026-10-20", "FRANK PIMENTEL", { nome: "JOAO VIROU DEPOIS" }),
      falta(801, "2026-10-21", "MARCOS LIMA", { nome: "KAUA SEM EMAIL" }),       // área sem e-mail cadastrado
      // áreas que nunca recebem o aviso (pedido do Raphael): nem com e-mail cadastrado
      falta(901, "2026-10-20", "DIURNO RT", { nome: "LIA DA RT DIURNA" }),
      falta(902, "2026-10-21", "NOTURNO RT", { nome: "MIA DA RT NOTURNA" }),
      falta(903, "2026-10-22", "EDUARDO CIPRIANO", { nome: "NINA DO RH" }),
      falta(904, "2026-10-23", "JUSSILENE ALMEIDA", { nome: "OTO DA COORDENACAO" }),
      falta(905, "2026-10-23", "JUSSILENE COORDENAÇÃO", { nome: "PIA DA COORDENACAO" }),
      ...(o.faltas || [])
    ],
    fm_admissoes: [{ re: 601, admissao: "2026-10-25" }],
    fm_medidas: o.medidas || [],
    fm_feriados: [],
    jv_supervisores: [
      { area: "JEAN KLEBER", email: "jean@exemplo.com.br", atualizado_em: "2026-10-01T00:00:00Z" },
      { area: "FRANK PIMENTEL", email: "frank@exemplo.com.br", atualizado_em: "2026-10-01T00:00:00Z" },
      { area: "CARLOS NOGUEIRA", email: "carlos@exemplo.com.br", atualizado_em: "2026-10-01T00:00:00Z" },
      { area: "PAULO SERGIO", email: "paulo@exemplo.com.br", atualizado_em: "2026-10-01T00:00:00Z" },
      { area: "EDNEY FERRAZ", email: "edney-saiu@exemplo.com.br", atualizado_em: "2026-10-02T00:00:00Z" }, // quem saiu: não conta
      { area: "DIURNO RT", email: "rt-diurna@exemplo.com.br", atualizado_em: "2026-10-02T00:00:00Z" },
      { area: "NOTURNO RT", email: "rt-noturna@exemplo.com.br", atualizado_em: "2026-10-02T00:00:00Z" },
      { area: "EDUARDO CIPRIANO", email: "rh@exemplo.com.br", atualizado_em: "2026-10-02T00:00:00Z" },
      { area: "JUSSILENE ALMEIDA", email: "coord@exemplo.com.br", atualizado_em: "2026-10-02T00:00:00Z" }
    ],
    fm_auditoria: [
      { id: ++seq, ator: RESP, acao: "ATESTADO_REGISTRADO", entidade: "fm_atestados", chave: "501|2026-10-22", antes: null, depois: { re: 501, tem: true, inicio: "2026-10-22", dias: 3, envio: null, codigo: "A" }, criado_em: "2026-10-24T12:00:00Z" },
      { id: ++seq, ator: "sistema", acao: "FALTA_VIROU_INJUSTIFICADA", entidade: "fm_faltas", chave: "701|2026-10-20", antes: { codigo: "A" }, depois: { codigo: "I" }, criado_em: "2026-10-26T10:00:00Z" },
      reg("FALTAS_EMAIL_COPIAS", "copias", { copias: COPIAS }),
      ...(o.auto === false ? [] : [reg("FALTAS_EMAIL_AUTO", "auto", { ligado: true })]),
      ...(o.extras || [])
    ],
    dashboard_snapshots: []
  };
  supabaseFalso(t);
  return t;
}
const api = (t, o) => chamar(rh, { ...o, query: { modulo: "faltasemail", t, ...(o && o.query) } });
// o agendamento entra pela rota de RH, sem login de usuário (a Vercel não manda)
const cron = h => chamar(rh, { query: { modulo: "faltasemail", t: "cron" }, headers: h === undefined ? { authorization: "Bearer cron-de-teste" } : h });
const para = email => enviados.filter(m => m.para.includes(email));
const envios = t => t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_ENVIADO");

// ── datas ───────────────────────────────────────────────────────────────────
test("semana anterior e corte de domingo no horário de São Paulo", () => {
  assert.deepEqual(FE.semanaAnterior(SEG), { inicio: "2026-10-19", fim: "2026-10-25" });
  // domingo 23h30 em SP ainda é domingo: a semana anterior é a outra
  assert.deepEqual(FE.semanaAnterior(new Date("2026-10-26T02:30:00Z")), { inicio: "2026-10-12", fim: "2026-10-18" });
  assert.deepEqual(FE.semanaAnterior(new Date("2026-10-26T03:30:00Z")), { inicio: "2026-10-19", fim: "2026-10-25" });
  assert.deepEqual(FE.semanaAnterior(new Date("2026-10-30T15:00:00Z")), { inicio: "2026-10-19", fim: "2026-10-25" }, "sexta: ainda a semana de 19 a 25");
  assert.equal(FE.fimDoDiaSP("2026-10-25"), Date.parse("2026-10-26T02:59:59.999Z"));
});

// ── o que entra ─────────────────────────────────────────────────────────────
test("só falta injustificada até domingo 23h59 e ainda injustificada; fora: abonada, atrasada, virou depois, atestado, antes da admissão, outra semana", async () => {
  base();
  const ponto = require("../api/_ponto");
  const l = await FE.faltasDoPeriodo(ponto.conectar(), "2026-10-19", "2026-10-25", FE.fimDoDiaSP("2026-10-25"));
  assert.deepEqual(l.map(f => f.re + "|" + f.data).sort(), ["101|2026-10-20", "101|2026-10-22", "102|2026-10-21", "201|2026-10-23", "301|2026-10-19", "801|2026-10-21"]);
  assert.equal(l.find(f => f.re === 102).area, "JEAN KLEBER", "Edney → Jean");
  assert.equal(l.find(f => f.re === 301).area, "CARLOS NOGUEIRA", "Rafael → Carlos Nogueira");
});

test("uma linha por colaborador, com todas as datas dele, ordenadas pela primeira falta", () => {
  const g = FE.agrupar([
    { re: 9, data: "2026-10-22", nome: "B", posto: "P1", areaNome: "X" },
    { re: 9, data: "2026-10-20", nome: "B", posto: "P1", areaNome: "X" },
    { re: 5, data: "2026-10-21", nome: "A", posto: "", areaNome: "JEAN KLEBER" }
  ]);
  assert.deepEqual(g.map(x => [x.re, x.datas]), [[9, ["2026-10-20", "2026-10-22"]], [5, ["2026-10-21"]]]);
  assert.equal(g[1].posto, "Reserva técnica · JEAN KLEBER", "sem posto é reserva técnica do supervisor");
});

test("a área do Rafael passou para o Carlos Nogueira, e a do Edney segue com o Jean", () => {
  assert.equal(R.supervisorAtual("RAFAEL ANDRADE"), "CARLOS NOGUEIRA");
  assert.equal(R.supervisorAtual("EDNEY FERRAZ"), "JEAN KLEBER");
  assert.equal(R.supervisorAtual("CARLOS NOGUEIRA"), "CARLOS NOGUEIRA");
});

// ── agendamento ─────────────────────────────────────────────────────────────
test("agendamento: com CRON_SECRET, só com a senha; sem ela roda pela regra (segunda depois das 14h, uma vez por área)", async () => {
  base();
  assert.equal((await cron({})).statusCode, 401);
  assert.equal((await cron({ authorization: "Bearer outra" })).statusCode, 401);
  assert.equal(enviados.length, 0);
  const antes = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    agora = new Date("2026-10-26T15:00:00Z"); // segunda, 12h em São Paulo
    assert.equal((await cron({})).body.ignorado, "ANTES_DO_HORARIO");
    assert.equal(enviados.length, 0);
    agora = SEG;
    const r = await cron({});
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.enviados, 4);
    assert.equal((await cron({})).body.enviados, 0, "chamar de novo não repete");
  } finally { process.env.CRON_SECRET = antes; }
});

test("agendamento: automático desligado por padrão e só age na segunda", async () => {
  base({ auto: false });
  assert.equal((await cron()).body.ignorado, "AUTO_DESLIGADO");
  base();
  agora = new Date("2026-10-27T17:10:00Z"); // terça
  assert.equal((await cron()).body.ignorado, "NAO_E_O_DIA");
  assert.equal(enviados.length, 0);
});

test("segunda: um e-mail por área, só com as faltas daquela área, cópias e assunto certos", async () => {
  const t = base();
  const r = await cron();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.enviados, 4, "Jean, Frank, Carlos Nogueira e Paulo Sérgio (sem falta)");
  assert.equal(r.body.semEmail, 1, "MARCOS LIMA tem falta e não tem e-mail");
  for (const fora of ["rt-diurna@", "rt-noturna@", "rh@", "coord@"]) assert.ok(!enviados.some(m => m.para.some(p => p.startsWith(fora))), "área que nunca recebe: " + fora);
  for (const nome of ["Lia da RT", "Mia da RT", "Nina do RH", "Oto da", "Pia da"]) assert.ok(!enviados.some(m => m.html.includes(nome)), "falta de área fora do aviso apareceu: " + nome);
  assert.ok(!JSON.stringify(r.body).includes("PESSOA") && !JSON.stringify(r.body).includes("ANA"), "a resposta não leva nome de colaborador");
  assert.equal(enviados.length, 4);
  enviados.forEach(m => {
    assert.equal(m.para.length, 1, "um supervisor por e-mail");
    assert.deepEqual(m.cc, COPIAS.map(c => c.email));
    assert.deepEqual(m.responderPara, ["remetente@gruposervcamp.com.br", ...COPIAS.map(c => c.email)], "Responder volta para a conta que envia, com as cópias junto");
  });
  const jean = para("jean@exemplo.com.br")[0];
  assert.equal(jean.assunto, "Aviso semanal de faltas injustificadas — Jean Kleber");
  assert.match(jean.html, /Ana Paula de Souza/);
  assert.match(jean.html, /Bruno do Edney/);
  assert.match(jean.html, /2 faltas na semana/);
  assert.match(jean.html, /Olá, Jean Kleber\./);
  assert.match(jean.html, /src="cid:logo-servcamp@aviso-semanal"/);
  for (const outro of ["Caio", "Fabio", "Kaua", "Lia", "Nina", "Dora", "Gil", "Helo", "Ivo", "Joao", "Edu"]) assert.ok(!jean.html.includes(outro), "outra área ou fora da regra no e-mail do Jean: " + outro);
  const frank = para("frank@exemplo.com.br")[0];
  assert.match(frank.html, /Caio do Frank/);
  assert.ok(!frank.html.includes("Ana Paula") && !frank.html.includes("Edu Atrasado") && !frank.html.includes("Joao Virou"));
  const carlos = para("carlos@exemplo.com.br")[0];
  assert.match(carlos.html, /Fabio do Rafael/);
  assert.match(carlos.html, /Reserva Técnica · Carlos Nogueira/);
  const paulo = para("paulo@exemplo.com.br")[0];
  assert.match(paulo.html, /Não foram identificadas faltas injustificadas na sua área no período de 19\/10\/2026 a 25\/10\/2026\./);
  assert.equal(para("edney-saiu@exemplo.com.br").length, 0, "e-mail de quem saiu nunca é usado");
  // o registro guarda o que foi em cada e-mail (base do quadro de atualizações)
  const e = envios(t).find(x => x.chave === "2026-10-19|JEAN KLEBER");
  assert.deepEqual(e.depois.faltas.map(f => f.re + "|" + f.data).sort(), ["101|2026-10-20", "101|2026-10-22", "102|2026-10-21"]);
  assert.equal(e.depois.origem, "auto");
});

test("não envia duas vezes: segunda rodada e duas chamadas ao mesmo tempo", async () => {
  base();
  await cron();
  const r2 = await cron();
  assert.equal(r2.body.enviados, 0);
  assert.equal(r2.body.jaEnviados, 4);
  assert.equal(enviados.length, 4);
  base();
  const [a, b] = await Promise.all([cron(), cron()]);
  assert.equal(a.body.enviados + b.body.enviados, 4);
  assert.equal(enviados.length, 4, "cada área uma vez só");
});

test("servidor de e-mail fora do ar: a área volta para a fila e a rodada seguinte envia só ela", async () => {
  const t = base();
  falhar = m => m.para.includes("frank@exemplo.com.br");
  const r1 = await cron();
  assert.equal(r1.body.enviados, 3);
  assert.equal(r1.body.falhas, 1);
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTAS_EMAIL_FALHOU" && e.chave === "2026-10-19|FRANK PIMENTEL"));
  falhar = () => false;
  agora = new Date("2026-10-26T19:05:00Z"); // rodada das 16h
  const r2 = await cron();
  assert.equal(r2.body.enviados, 1);
  assert.equal(r2.body.jaEnviados, 3);
  assert.equal(para("frank@exemplo.com.br").length, 1);
});

// ── quadro de atualizações (semana seguinte) ────────────────────────────────
test("semana seguinte: abonada, medida aplicada com a data, retirada pelo RH e falta lançada depois do aviso", async () => {
  const t = base();
  await cron();
  enviados = [];
  agora = SEG_SEGUINTE;
  t.fm_faltas.find(f => f.re === 101 && f.data === "2026-10-20").codigo = "A";
  t.fm_faltas = t.fm_faltas.filter(f => f.re !== 102); // o RH tirou o lançamento
  t.fm_medidas.push({ chave: "H1", re: 101, data: "2026-10-28", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "APLICADA" });
  t.fm_medidas.push({ chave: "H2", re: 201, data: "2026-10-29", tipo: "ADVERTÊNCIA", grau: "VERBAL", dias: 0, fase: "CANCELADA" });
  supabaseFalso(t);
  const r = await cron();
  assert.equal(r.statusCode, 200);
  const jean = para("jean@exemplo.com.br")[0];
  assert.match(jean.html, /Atualizações desde o aviso anterior/);
  assert.match(jean.html, /ABONADA/);
  assert.match(jean.html, /MEDIDA APLICADA/);
  assert.match(jean.html, /Advertência escrita · lançada em 28\/10\/2026/);
  assert.match(jean.html, /RETIRADA/);
  const frank = para("frank@exemplo.com.br")[0];
  assert.match(frank.html, /REGISTRADA APÓS O AVISO/);
  assert.match(frank.html, /Edu Atrasado/);
  assert.ok(!frank.html.includes("MEDIDA APLICADA"), "medida cancelada não conta");
  assert.ok(!para("paulo@exemplo.com.br")[0].html.includes("Atualizações desde"), "sem mudança, sem quadro");
});

// ── painel e envio manual ───────────────────────────────────────────────────
test("painel: só a conta do Raphael (outros 403, sem login 401)", async () => {
  base();
  assert.equal((await api("painel", {})).statusCode, 401);
  assert.equal((await api("painel", { usuario: "joaoygor" })).statusCode, 403);
  assert.equal((await api("painel", { usuario: "jeankleber" })).statusCode, 403);
  const r = await api("painel", { usuario: RESP });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.semana, { inicio: "2026-10-19", fim: "2026-10-25" });
  const nomes = r.body.areas.map(a => a.area);
  assert.ok(nomes.includes("JEAN KLEBER") && nomes.includes("CARLOS NOGUEIRA") && nomes.includes("PAULO SERGIO") && nomes.includes("MARCOS LIMA"));
  for (const fora of ["DIURNO RT", "NOTURNO RT", "EDUARDO CIPRIANO", "JUSSILENE ALMEIDA", "JUSSILENE COORDENACAO"]) assert.ok(!nomes.includes(fora), fora + " não aparece no painel");
  assert.ok(!nomes.includes("EDNEY FERRAZ") && !nomes.includes("RAFAEL ANDRADE"), "quem saiu não vira área própria");
  const jean = r.body.areas.find(a => a.area === "JEAN KLEBER");
  assert.equal(jean.faltas, 3);
  assert.equal(jean.colaboradores, 2);
  assert.equal(jean.status, "PENDENTE");
  assert.equal(r.body.areas.find(a => a.area === "MARCOS LIMA").status, "SEM_EMAIL");
  assert.equal(r.body.conta.origem, "vercel");
  assert.equal(r.body.conta.email, "remetente@gruposervcamp.com.br");
  assert.equal(r.body.configurado, true);
  assert.ok(!JSON.stringify(r.body).includes("senha-de-teste"), "nenhum segredo na resposta");
});

test("envio manual: exige confirmar, só a semana anterior, cópias escolhidas da lista e áreas escolhidas", async () => {
  base({ auto: false });
  assert.equal((await api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER"] } })).statusCode, 400);
  assert.equal((await api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER"], copias: ["intruso@exemplo.com.br"], confirmar: true } })).body.codigo, "COPIA_DESCONHECIDA");
  const r = await api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER"], copias: ["copia1@exemplo.com.br"], confirmar: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.enviados, 1);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].cc, ["copia1@exemplo.com.br"]);
  assert.match(enviados[0].html, /Envio automatizado/);
  const r2 = await api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER"], copias: [], confirmar: true } });
  assert.equal(r2.body.jaEnviados, 1, "já enviada nesta semana: não sai de novo");
  assert.equal(enviados.length, 1);
  const p = await api("painel", { usuario: RESP });
  assert.equal(p.body.areas.find(a => a.area === "JEAN KLEBER").status, "ENVIADO");
  assert.equal((await api("enviar", { method: "POST", usuario: "joaoygor", body: { areas: ["JEAN KLEBER"], confirmar: true } })).statusCode, 403);
});

test("teste: qualquer período, destinatários escolhidos na hora (qualquer e-mail válido), e não bloqueia o oficial", async () => {
  const t = base();
  const corpo = extra => ({ area: "JEAN KLEBER", de: "2026-10-01", ate: "2026-10-25", para: ["@eu"], ...extra });
  assert.equal((await api("teste", { method: "POST", usuario: RESP, body: corpo({ para: ["não é e-mail"] }) })).body.codigo, "EMAIL_INVALIDO");
  assert.equal((await api("teste", { method: "POST", usuario: RESP, body: corpo({ para: Array.from({ length: 11 }, (_, i) => "p" + i + "@exemplo.com.br") }) })).body.codigo, "MUITOS_DESTINOS");
  assert.equal((await api("teste", { method: "POST", usuario: RESP, body: corpo({ de: "2026-09-01" }) })).body.codigo, "PERIODO_LONGO");
  assert.equal((await api("teste", { method: "POST", usuario: RESP, body: corpo({ para: [] }) })).body.codigo, "SEM_DESTINO");
  const r = await api("teste", { method: "POST", usuario: RESP, body: corpo({ para: ["@eu", "@supervisor", "copia2@exemplo.com.br", "Alguem@Gmail.com"] }) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].para, ["remetente@gruposervcamp.com.br", "jean@exemplo.com.br", "copia2@exemplo.com.br", "alguem@gmail.com"], "e-mail de fora da empresa vale no teste");
  assert.match(enviados[0].assunto, /^Prévia: Aviso semanal de faltas injustificadas — Jean Kleber$/);
  assert.match(enviados[0].html, /Prévia\./);
  assert.match(enviados[0].html, /Gil Semana Passada/, "período escolhido: entra a falta de 18/10");
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTAS_EMAIL_TESTE"));
  enviados = [];
  const c = await cron();
  assert.equal(c.body.enviados, 4, "o teste não conta como envio oficial");
});

test("histórico no e-mail: mesma regra do aviso (sem falta anterior à admissão), datas à mostra e nunca menor que a semana", async () => {
  const t = base({ faltas: [falta(101, "2026-09-01", "JEAN KLEBER", { nome: "ANA PAULA DE SOUZA" }), falta(101, "2025-12-01", "JEAN KLEBER", { nome: "ANA PAULA DE SOUZA" })] });
  t.fm_admissoes.push({ re: 101, admissao: "2026-01-05" });
  const r = await api("previa", { usuario: RESP, query: { area: "JEAN KLEBER" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const txt = r.body.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(txt, /Histórico: 3 faltas injustificadas Medidas disciplinares: nenhuma/, "20/10 e 22/10 da semana + 01/09; a de 2025 é de antes da admissão");
  assert.match(txt, /22\/10\/26, 20\/10\/26, 01\/09\/26/, "as datas que formam o número aparecem");
  assert.doesNotMatch(txt, /01\/12\/25/);
});
test("envio oficial: supervisor recusado pelo servidor (só a cópia aceita) não conta como enviado", async () => {
  const t = base();
  falhar = m => m.para[0] === "jean@exemplo.com.br" ? { recusar: ["jean@exemplo.com.br"] } : false;
  const r = await api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER"], copias: ["copia1@exemplo.com.br"], confirmar: true } });
  assert.equal(r.body.enviados, 0, JSON.stringify(r.body));
  assert.equal(r.body.falhas, 1);
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTAS_EMAIL_FALHOU" && /recusou o endereço do supervisor/.test(JSON.stringify(e.depois))));
});

test("teste de áreas: devolve quem o servidor recusou", async () => {
  base();
  falhar = () => ({ recusar: ["fulano@exemplo.com.br"] });
  const r = await api("teste_areas", { method: "POST", usuario: RESP, body: { para: ["@eu", "fulano@exemplo.com.br"], areas: ["JEAN KLEBER"] } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.recusados, ["fulano@exemplo.com.br"]);
});
test("prévia: e-mail pronto com a logo embutida, sem enviar nada", async () => {
  base();
  const r = await api("previa", { usuario: RESP, query: { area: "JEAN KLEBER" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.match(r.body.html, /src="data:image\/png;base64,/);
  assert.equal(r.body.para, "jean@exemplo.com.br");
  assert.equal(enviados.length, 0);
  assert.equal((await api("previa", { usuario: RESP, query: { area: "NAO EXISTE" } })).statusCode, 404);
});

test("cadastro da área: e-mail na jv_supervisores (vale para a hora extra), saudação e registro", async () => {
  const t = base();
  assert.equal((await api("area", { method: "POST", usuario: RESP, body: { area: "MARCOS LIMA", email: "não é e-mail" } })).body.codigo, "EMAIL_INVALIDO");
  assert.equal((await api("area", { method: "POST", usuario: RESP, body: { area: "INVENTADA", email: "x@exemplo.com.br" } })).statusCode, 404);
  const r = await api("area", { method: "POST", usuario: RESP, body: { area: "marcos lima", email: " Sup.Marcos@Exemplo.com.br ", saudacao: "Marcão" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(t.jv_supervisores.some(x => x.area === "MARCOS LIMA" && x.email === "sup.marcos@exemplo.com.br"));
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTAS_EMAIL_AREA" && e.chave === "MARCOS LIMA" && e.depois.saudacao === "Marcão"));
  await cron();
  const m = para("sup.marcos@exemplo.com.br")[0];
  assert.match(m.html, /Olá, Marcão\./);
  assert.equal(m.assunto, "Aviso semanal de faltas injustificadas — Marcos Lima");
  assert.equal((await api("area", { method: "POST", usuario: "frankpimentel", body: { area: "MARCOS LIMA", email: "x@exemplo.com.br" } })).statusCode, 403);
  assert.equal((await api("area", { method: "POST", usuario: RESP, body: { area: "DIURNO RT", email: "x@exemplo.com.br" } })).statusCode, 404, "área fora do aviso não se cadastra");
  assert.equal((await api("previa", { usuario: RESP, query: { area: "JUSSILENE ALMEIDA" } })).statusCode, 404);
});

test("cópias: valida, tira repetidas e guarda com registro", async () => {
  const t = base();
  assert.equal((await api("copias", { method: "POST", usuario: RESP, body: { copias: [{ nome: "X", email: "ruim" }] } })).body.codigo, "EMAIL_INVALIDO");
  const r = await api("copias", { method: "POST", usuario: RESP, body: { copias: [{ nome: "A", email: "a@exemplo.com.br" }, { nome: "A de novo", email: "A@exemplo.com.br" }] } });
  assert.deepEqual(r.body.copias, [{ nome: "A", email: "a@exemplo.com.br" }]);
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_COPIAS").length, 2);
});

// ── modelo do e-mail ────────────────────────────────────────────────────────
test("modelo: escapa o que vem da planilha, texto simples equivalente e nomes em formato de título", () => {
  const m = HTML.montar({ area: "JEAN KLEBER", inicio: "2026-10-19", fim: "2026-10-25", logo: "cid:x", automatico: true,
    linhas: [{ nome: "<script>alert(1)</script>", re: 1, posto: "COND. JARDIM DAS FLORES", cargo: "PORTEIRO (A)", escala: "12X36 SDF", datas: ["2026-10-22", "2026-10-20"] }] });
  assert.ok(!/<script>alert/i.test(m.html));
  assert.match(m.html, /&lt;script&gt;/i);
  assert.match(m.html, /Cond\. Jardim das Flores/);
  assert.match(m.html, /12X36 SDF/);
  assert.match(m.html, /19\/10 a 25\/10\/2026/);
  assert.match(m.html, /segunda a domingo/);
  assert.match(m.html, /Envio automatizado/);
  assert.ok(!/Mensagem confidencial|Enviada (automaticamente )?pelo Servcamp/.test(m.html), "rodapé antigo saiu");
  assert.match(m.texto, /Faltas: 20\/10\/2026 \(ter\), 22\/10\/2026 \(qui\)/);
  assert.ok(!/Atenciosamente|<b>Servcamp<\/b>/.test(m.html), "sem \"Atenciosamente, Servcamp\": a assinatura do Raphael já fecha o e-mail");
  assert.ok(m.texto.endsWith("Envio automatizado") && !/Atenciosamente/.test(m.texto), "texto simples fecha igual ao HTML");
  const comAss = HTML.montar({ area: "JEAN KLEBER", inicio: "2026-10-19", fim: "2026-10-25", logo: "cid:x", linhas: [], assinatura: { src: "cid:ass", largura: 635, altura: 201 } });
  assert.ok(comAss.html.includes('src="cid:ass"') && !comAss.html.includes("Atenciosamente"), "só a assinatura, sem Atenciosamente");
  assert.ok(!comAss.html.includes("<b>Servcamp</b>"), "com assinatura, não repete Servcamp");
  assert.match(comAss.html, /width="600" height="190" alt="Assinatura"/, "assinatura larga cabe nos 600 px do e-mail");
  assert.ok(!/Atenciosamente/.test(comAss.texto));
  assert.equal(HTML.titulo("OSEAS - DIURNO"), "Oseas - Diurno");
  assert.equal(HTML.titulo("DIURNO RT"), "Diurno RT");
  assert.equal(HTML.periodoCurto("2025-12-29", "2026-01-04"), "29/12/2025 a 04/01/2026");
  const vazio = HTML.montar({ area: "PAULO SERGIO", inicio: "2026-10-19", fim: "2026-10-25", logo: "cid:x", linhas: [] });
  assert.match(vazio.html, /Nenhuma ocorrência no período/);
  assert.match(vazio.texto, /Não foram identificadas faltas injustificadas na sua área no período de 19\/10\/2026 a 25\/10\/2026\./);
});

// ── importação e tela ───────────────────────────────────────────────────────
test("importação anota a falta que virou injustificada depois (corte de domingo)", async () => {
  const faltas = require("../api/_faltas");
  const t = { fm_faltas: [{ re: 900, data: "2026-10-20", codigo: "A", criado_em: ANTES }], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_auditoria: [] };
  supabaseFalso(t);
  await faltas.materializar({ faltas: [{ RE: 900, DATA: "2026-10-20", ABONO: "I", NOME: "X", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }], fichaDias: {}, disciplina: [], ativos: [] });
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTA_VIROU_INJUSTIFICADA" && e.chave === "900|2026-10-20"));
  const n = t.fm_auditoria.length;
  await faltas.materializar({ faltas: [{ RE: 900, DATA: "2026-10-20", ABONO: "I", NOME: "X", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }], fichaDias: {}, disciplina: [], ativos: [] });
  assert.equal(t.fm_auditoria.length, n, "continuou injustificada: nada a anotar");
});

test("tela: script compila, mesma conta do servidor, ligado no index.html, e os avisos no celular saíram", () => {
  const raiz = path.join(__dirname, "..");
  const js = fs.readFileSync(path.join(raiz, "assets", "faltas-email", "faltas-email.js"), "utf8");
  assert.doesNotThrow(() => new Function(js), "faltas-email.js com erro de sintaxe");
  const m = js.match(/const FE_RESPONSAVEL="([a-z]+)";/);
  assert.ok(m && m[1] === FE.RESPONSAVEL, "a tela e o servidor precisam falar da mesma conta");
  const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  assert.ok(html.includes('<script src="/assets/faltas-email/faltas-email.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/faltas-email/faltas-email.css">'));
  assert.ok(html.includes('id="fm-bt-email"') && html.includes('id="sbFeEmail"'));
  assert.ok(/navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(html), "o sistema continua instalável no celular");
  assert.ok(!html.includes("/assets/avisos/") && !html.includes("avAposLogin") && !html.includes("sbAvPainel"), "nada dos avisos no celular");
  assert.ok(!fs.existsSync(path.join(raiz, "api", "_avisos.js")));
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  assert.ok(!sw.includes('addEventListener("push"'), "o service worker não trata mais push");
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
  assert.ok(!pkg.dependencies["web-push"]);
});

test("vercel.json: um agendamento por hora, das 6h às 20h de Brasília (9h a 23h UTC), uma vez por dia cada, pela rota do cron", () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const f = v.crons.filter(c => c.path.startsWith("/api/rh?modulo=faltasemail&t=cron"));
  assert.deepEqual(f.map(c => c.schedule).sort(), Array.from({ length: 15 }, (_, i) => "0 " + (9 + i) + " * * *").sort());
  assert.equal(new Set(v.crons.map(c => c.path)).size, v.crons.length, "cada agendamento com um endereço próprio");
  assert.ok(v.crons.filter(c => c.path.startsWith("/api/comercial-cron")).every(c => !/faltas/.test(c.path)), "nada do aviso passa pela rota do Comercial");
  assert.ok(!(v.functions || {})["api/comercial-cron.js"], "a função do Comercial não foi mexida");
  const comercial = fs.readFileSync(path.join(__dirname, "..", "api", "comercial-cron.js"), "utf8");
  assert.ok(!/faltas|_faltas_email/.test(comercial), "o código do Comercial não sabe do aviso de faltas");
  const aviso = fs.readFileSync(path.join(__dirname, "..", "api", "_faltas_email.js"), "utf8");
  assert.ok(!/process\.env\.MAIL_(USER|PASS|HOST|PORT|FROM|BCC)\b/.test(aviso), "o aviso nunca lê a conta de e-mail do Comercial");
});

test("nenhum endereço de e-mail real no código do aviso (o repositório é público)", () => {
  for (const f of ["_faltas_email.js", "_faltas_email_html.js"]) {
    const s = fs.readFileSync(path.join(__dirname, "..", "api", f), "utf8");
    assert.ok(!/[a-z0-9._-]+@gruposervcamp\.com\.br/i.test(s), f + " tem endereço de e-mail");
  }
});

test("conta de envio: cadastrada no painel, senha conferida e criptografada; a do Comercial nunca é usada", async () => {
  const salvo = { u: process.env.FALTAS_MAIL_USER, p: process.env.FALTAS_MAIL_PASS, a: process.env.AUTH_SECRET };
  delete process.env.FALTAS_MAIL_USER; delete process.env.FALTAS_MAIL_PASS;
  process.env.MAIL_USER = "comercial-de-teste@exemplo.com.br"; process.env.MAIL_PASS = "senha-do-comercial"; // existe, e não pode ser usada
  let conferidas = [];
  FE.definirVerificador(async c => { conferidas.push(c); return c.pass === "senha-certa" ? { ok: true } : { ok: false, codigo: 535 }; });
  try {
    const t = base();
    const p0 = await api("painel", { usuario: RESP });
    assert.equal(p0.body.configurado, false, "sem conta do aviso não envia, mesmo com a do Comercial configurada");
    assert.equal(p0.body.conta, null);
    assert.equal((await cron()).body.ok, false);
    assert.equal(enviados.length, 0);
    assert.equal((await api("teste", { method: "POST", usuario: RESP, body: { area: "JEAN KLEBER", para: ["@eu"] } })).body.codigo, "SEM_CONTA");
    const conta = body => api("conta", { method: "POST", usuario: RESP, body });
    assert.equal((await conta({ email: "ruim", senha: "x" })).body.codigo, "EMAIL_INVALIDO");
    assert.equal((await conta({ email: "envio@exemplo.com.br", senha: "" })).body.codigo, "SEM_SENHA");
    assert.equal((await conta({ email: "envio@exemplo.com.br", senha: "x", port: 25 })).body.codigo, "PORTA_INVALIDA");
    assert.equal((await conta({ email: "envio@exemplo.com.br", senha: "senha-errada" })).body.codigo, "CONTA_RECUSADA");
    assert.equal((await api("conta", { method: "POST", usuario: "joaoygor", body: { email: "envio@exemplo.com.br", senha: "senha-certa" } })).statusCode, 403);
    const r = await conta({ email: " Envio@Exemplo.com.br ", senha: "senha-certa" });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual(conferidas[conferidas.length - 1], { user: "envio@exemplo.com.br", pass: "senha-certa", host: "email-ssl.com.br", port: 465 });
    assert.ok(!JSON.stringify(r.body).includes("senha-certa"));
    assert.ok(!JSON.stringify(t.fm_auditoria).includes("senha-certa"), "a senha não fica legível no banco");
    const lida = await FE.lerConta(require("../api/_ponto").conectar());
    assert.equal(lida.pass, "senha-certa", "o servidor consegue ler a senha cifrada para enviar");
    const p = await api("painel", { usuario: RESP });
    assert.equal(p.body.configurado, true);
    assert.deepEqual({ ...p.body.conta, em: null }, { origem: "painel", email: "envio@exemplo.com.br", host: "email-ssl.com.br", port: 465, em: null, ilegivel: false });
    assert.ok(!JSON.stringify(p.body).includes("senha-certa") && !JSON.stringify(p.body).includes("comercial-de-teste"), "o painel não mostra senha nem a conta do Comercial");
    await cron();
    assert.equal(enviados.length, 4);
    assert.ok(enviados.every(m => m.responderPara[0] === "envio@exemplo.com.br"));
    enviados = [];
    await api("teste", { method: "POST", usuario: RESP, body: { area: "JEAN KLEBER", para: ["@eu"] } });
    assert.deepEqual(enviados[0].para, ["envio@exemplo.com.br"], "'Eu' no teste é a conta que envia");
    // chave do login trocada: a senha guardada não abre mais, e o painel pede para cadastrar de novo
    process.env.AUTH_SECRET = "outro-segredo";
    const lida2 = await FE.lerConta(require("../api/_ponto").conectar());
    assert.equal(lida2.pass, null);
  } finally {
    process.env.AUTH_SECRET = salvo.a;
    process.env.FALTAS_MAIL_USER = salvo.u; process.env.FALTAS_MAIL_PASS = salvo.p;
    delete process.env.MAIL_USER; delete process.env.MAIL_PASS;
    FE.definirVerificador(null);
  }
});

test("assinatura: imagem do painel no corpo do e-mail, abaixo do cartão; conferida pelos bytes; dá para tirar", async () => {
  const LOGO = require("../api/_faltas_email_logo"); // um PNG de verdade (86 x 120) serve de assinatura no teste
  const png = "data:image/png;base64," + LOGO;
  const t = base();
  const envia = body => api("assinatura", { method: "POST", usuario: RESP, body });
  assert.equal((await envia({ imagem: "data:text/html;base64,PGI+", largura: 10, altura: 10 })).body.codigo, "IMAGEM_INVALIDA");
  assert.equal((await envia({ imagem: "data:image/png;base64," + Buffer.from("não sou png").toString("base64"), largura: 10, altura: 10 })).body.codigo, "IMAGEM_INVALIDA", "o nome diz png, os bytes não");
  const grande = Buffer.concat([Buffer.from(LOGO, "base64"), Buffer.alloc(600 * 1024)]).toString("base64");
  assert.equal((await envia({ imagem: "data:image/png;base64," + grande, largura: 86, altura: 120 })).body.codigo, "IMAGEM_GRANDE");
  assert.equal((await envia({ imagem: png, largura: 0, altura: 120 })).body.codigo, "IMAGEM_INVALIDA");
  assert.equal((await api("assinatura", { method: "POST", usuario: "joaoygor", body: { imagem: png, largura: 86, altura: 120 } })).statusCode, 403);
  // o painel reduz imagem grande para JPG de até 1200 px antes de enviar: o servidor aceita
  const jpg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200 * 1024, 7)]).toString("base64");
  assert.equal((await envia({ imagem: jpg, largura: 1200, altura: 380 })).statusCode, 200);
  assert.equal((await envia({ imagem: png, largura: 86, altura: 120 })).statusCode, 200);
  const p = await api("painel", { usuario: RESP });
  assert.equal(p.body.assinatura.largura, 86);
  assert.match(p.body.assinatura.src, /^data:image\/png;base64,/);
  await cron();
  const m = para("jean@exemplo.com.br")[0];
  assert.equal(m.assinatura.tipo, "image/png", "a imagem vai anexada ao e-mail");
  const iAss = m.html.indexOf('src="cid:assinatura@aviso-semanal"'), iCartao = m.html.indexOf("Envio automatizado");
  assert.ok(iAss > 0 && iAss > iCartao, "assinatura no corpo, depois do cartão");
  assert.match(m.html, /width="86" height="120" alt="Assinatura"/);
  const pv = await api("previa", { usuario: RESP, query: { area: "PAULO SERGIO" } });
  assert.ok(pv.body.html.includes('src="' + png + '"'), "a prévia mostra a assinatura");
  assert.ok(t.fm_auditoria.some(e => e.acao === "FALTAS_EMAIL_ASSINATURA"));
  assert.equal((await envia({ imagem: null })).body.assinatura, null);
  enviados = [];
  agora = SEG_SEGUINTE;
  await cron();
  assert.ok(enviados.length && enviados.every(x => !x.assinatura && !x.html.includes("cid:assinatura")), "sem assinatura, o e-mail termina no cartão");
  assert.ok(enviados.every(x => !x.html.includes("Atenciosamente")));
});

// ── dia e hora do envio automático ──────────────────────────────────────────
test("agenda: sem escolha vale segunda às 14h; o painel mostra o próximo envio", async () => {
  base();
  const r = await api("painel", { usuario: RESP });
  assert.deepEqual([r.body.agenda.dia, r.body.agenda.hora], [1, 14]);
  assert.deepEqual(r.body.agenda.proximo, { dia: "2026-11-02", hora: 14, minuto: 0 }, "segunda 14h10: a das 14h já passou, vale a próxima");
  agora = new Date("2026-10-26T15:00:00Z"); // segunda 12h
  assert.deepEqual((await api("painel", { usuario: RESP })).body.agenda.proximo, { dia: "2026-10-26", hora: 14, minuto: 0 });
});

test("agenda: dia e hora escolhidos no painel mandam no envio automático; só a conta do responsável muda", async () => {
  const t = base();
  const cfg = corpo => api("agenda", { method: "POST", usuario: RESP, body: corpo });
  assert.equal((await api("agenda", { method: "POST", usuario: "outra.pessoa", body: { dia: 5, hora: 9 } })).statusCode, 403);
  for (const ruim of [{ dia: 7, hora: 9 }, { dia: 5, hora: 5 }, { dia: 5, hora: 21 }, { dia: "x", hora: 9 }, { dia: 1.5, hora: 9 }, {}]) assert.equal((await cfg(ruim)).body.codigo, "AGENDA_INVALIDA", JSON.stringify(ruim));
  const r = await cfg({ dia: 5, hora: 9 }); // sexta, 9h
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.agenda.proximo, { dia: "2026-10-30", hora: 9, minuto: 0 });
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_AGENDA").length, 1);
  await cfg({ dia: 5, hora: 9 });
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_AGENDA").length, 1, "mesma escolha não duplica");

  assert.equal((await cron()).body.ignorado, "NAO_E_O_DIA", "segunda não é mais o dia");
  agora = new Date("2026-10-30T11:00:00Z"); // sexta 8h
  assert.equal((await cron()).body.ignorado, "ANTES_DO_HORARIO");
  assert.equal(enviados.length, 0);
  agora = new Date("2026-10-30T12:05:00Z"); // sexta 9h05
  const e = await cron();
  assert.equal(e.statusCode, 200);
  assert.equal(e.body.enviados, 4, "envia as áreas com e-mail, como na segunda");
  agora = new Date("2026-10-30T13:05:00Z"); // sexta 10h05: a chamada da hora seguinte não repete
  assert.equal((await cron()).body.enviados, 0);
});

test("agenda com minuto: 13:51 só envia a partir de 13:51 e aceita só minutos de 0 a 59", async () => {
  base();
  const cfg = corpo => api("agenda", { method: "POST", usuario: RESP, body: corpo });
  for (const ruim of [{ dia: 5, hora: 13, minuto: 60 }, { dia: 5, hora: 13, minuto: -1 }, { dia: 5, hora: 13, minuto: 1.5 }, { dia: 5, hora: 13, minuto: "x" }]) assert.equal((await cfg(ruim)).body.codigo, "AGENDA_INVALIDA", JSON.stringify(ruim));
  const r = await cfg({ dia: 5, hora: 13, minuto: 51 });
  assert.deepEqual(r.body.agenda.proximo, { dia: "2026-10-30", hora: 13, minuto: 51 });
  assert.deepEqual((await api("painel", { usuario: RESP })).body.agenda.minuto, 51);
  agora = new Date("2026-10-30T16:50:00Z"); // sexta 13h50
  assert.equal((await cron()).body.ignorado, "ANTES_DO_HORARIO");
  assert.equal(enviados.length, 0);
  agora = new Date("2026-10-30T16:51:00Z"); // sexta 13h51
  assert.equal((await cron()).body.enviados, 4);
});
// ── teste de todas as áreas ─────────────────────────────────────────────────
test("teste de todas as áreas: um e-mail por área só para quem foi escolhido, nada ao supervisor e nada marcado como oficial", async () => {
  const t = base();
  const pedir = body => api("teste_areas", { method: "POST", usuario: RESP, body });
  assert.equal((await api("teste_areas", { method: "POST", usuario: "outra.pessoa", body: { para: ["a@exemplo.com.br"] } })).statusCode, 403);
  assert.equal((await pedir({ para: [] })).body.codigo, "SEM_DESTINO");
  assert.equal((await pedir({ para: ["não é e-mail"] })).body.codigo, "EMAIL_INVALIDO");
  assert.equal((await pedir({ para: Array.from({ length: 11 }, (_, i) => "p" + i + "@exemplo.com.br") })).body.codigo, "MUITOS_DESTINOS");
  assert.equal(enviados.length, 0);
  const r = await pedir({ para: ["Jussilene@Exemplo.com.br"] });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.enviados, r.body.areas, "uma por área");
  assert.ok(r.body.areas >= 4);
  assert.equal(enviados.length, r.body.areas);
  enviados.forEach(m => { assert.deepEqual(m.para, ["jussilene@exemplo.com.br"]); assert.deepEqual(m.cc, []); assert.ok(/^Prévia: /.test(m.assunto), "assunto marca prévia: " + m.assunto); });
  for (const sup of ["jean@", "frank@", "carlos@", "paulo@"]) assert.ok(!enviados.some(m => m.para.some(p => p.startsWith(sup))), "nada vai ao supervisor " + sup);
  for (const fora of ["rt-diurna@", "rt-noturna@", "rh@", "coord@"]) assert.ok(!enviados.some(m => m.para.some(p => p.startsWith(fora))));
  assert.equal(envios(t).length, 0, "teste não conta como envio oficial");
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_TESTE" && e.depois.todasAsAreas).length, r.body.areas);
  const jean = enviados.find(m => /Jean/i.test(m.assunto) || m.html.includes("ANA PAULA"));
  assert.ok(jean && jean.html.includes("<table"), "a planilha vai dentro do e-mail, como tabela");
  assert.ok(!jean.html.includes("PESSOA 201") && !/FRANK/.test(jean.html.split("ANA PAULA")[0] || ""), "cada e-mail só com as faltas da área");
});

test("teste de todas as áreas: servidor de e-mail fora do ar não grava como enviado", async () => {
  base();
  falhar = () => true;
  const r = await api("teste_areas", { method: "POST", usuario: RESP, body: { para: ["@eu"] } });
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.codigo, "FALHA_NO_ENVIO");
});

// ── falta já tratada por medida não é cobrada ───────────────────────────────
test("falta com medida lançada a partir do dia dela já foi tratada: não entra no aviso (a mesma regra da tela e da TV)", async () => {
  // Ana Paula (RE 101) faltou em 20/10 e 22/10; advertência lançada em 21/10: a de 20/10 está tratada, a de 22/10 não
  base({ medidas: [{ chave: "P-1", re: 101, data: "2026-10-21", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO" }] });
  const r = await cron();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const jean = para("jean@exemplo.com.br")[0];
  assert.ok(jean.html.includes("22/10/2026"), "a falta depois da medida continua cobrada");
  assert.ok(!jean.html.includes("20/10/2026"), "a falta de 20/10 já foi tratada pela advertência de 21/10");
  assert.ok(/1 falta|1 ocorr/i.test(jean.html) || !/2 faltas na semana/.test(jean.html), "não conta mais as duas");
});

test("medida na mesma data da falta também trata; medida cancelada ou de antes da falta não", async () => {
  base({ medidas: [
    { chave: "P-2", re: 201, data: "2026-10-23", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO" },      // mesmo dia da falta do Caio (Frank)
    { chave: "P-3", re: 102, data: "2026-10-22", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 2, fase: "CANCELADA" },     // cancelada: não trata o Bruno
    { chave: "P-4", re: 101, data: "2026-10-19", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO" }      // um dia ANTES das faltas da Ana (20/10 e 22/10)
  ] });
  await cron();
  const frank = para("frank@exemplo.com.br")[0].html, jean = para("jean@exemplo.com.br")[0].html;
  assert.ok(!frank.includes("CAIO DO FRANK") && !frank.includes("Caio Do Frank"), "medida no dia da falta trata");
  assert.ok(/Bruno/i.test(jean), "medida cancelada não trata");
  assert.ok(/Ana Paula/i.test(jean), "medida anterior à falta não trata");
});

test("teste de várias áreas: só as escolhidas, quantas quiser; sem lista vão todas; lista sem área válida é recusada", async () => {
  base();
  const pedir = body => api("teste_areas", { method: "POST", usuario: RESP, body });
  assert.equal((await pedir({ para: ["j@exemplo.com.br"], areas: [] })).body.codigo, "SEM_AREA");
  assert.equal((await pedir({ para: ["j@exemplo.com.br"], areas: ["NAO EXISTE"] })).body.codigo, "SEM_AREA");
  assert.equal(enviados.length, 0);
  const duas = await pedir({ para: ["j@exemplo.com.br"], areas: ["JEAN KLEBER", "FRANK PIMENTEL", "NAO EXISTE"] });
  assert.equal(duas.statusCode, 200, JSON.stringify(duas.body));
  assert.equal(duas.body.areas, 2);
  assert.equal(enviados.length, 2, "uma por área escolhida");
  assert.ok(enviados.every(m => m.para.length === 1 && m.para[0] === "j@exemplo.com.br"));
  enviados.length = 0;
  const todas = await pedir({ para: ["j@exemplo.com.br"] });
  assert.ok(todas.body.areas >= 4 && enviados.length === todas.body.areas, "sem lista, todas");
});

// ── comunicado semanal dentro do painel ─────────────────────────────────────
const faltasApi = (t, o) => chamar(rh, { ...o, query: { modulo: "faltas", t, ...(o && o.query) } });
const oficial = () => api("enviar", { method: "POST", usuario: RESP, body: { areas: ["JEAN KLEBER", "FRANK PIMENTEL"], copias: [], confirmar: true } });
const copiasDoComunicado = t => t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_COMUNICADO");

test("comunicado: o envio oficial guarda uma cópia por área, separada do registro do envio", async () => {
  const t = base();
  const r = await oficial();
  assert.equal(r.body.enviados, 2, JSON.stringify(r.body));
  const cs = copiasDoComunicado(t);
  assert.equal(cs.length, 2);
  const jean = cs.find(c => c.depois.area === "JEAN KLEBER");
  assert.equal(jean.chave, "2026-10-19|JEAN KLEBER");
  assert.equal(jean.depois.semana, "2026-10-19");
  assert.equal(jean.depois.colaboradores, jean.depois.linhas.length);
  assert.ok(jean.depois.linhas.length >= 1);
  const ana = jean.depois.linhas.find(l => l.re === 101);
  assert.deepEqual(ana.datas, ["2026-10-20", "2026-10-22"], "as datas do e-mail");
  assert.ok(ana.hist && typeof ana.hist.txt === "string", "o histórico do ano vai junto, como no e-mail");
  // o registro do envio continua leve: é lido inteiro a cada abertura do painel do aviso
  envios(t).forEach(e => assert.equal(e.depois.linhas, undefined, "o envio não carrega o comunicado"));
  assert.ok(JSON.stringify(envios(t)).length < JSON.stringify(cs).length, "a cópia pesada fica fora do registro do envio");
});

test("comunicado: supervisor abre o da própria área; o de outra área e o inexistente dão a mesma resposta", async () => {
  const t = base();
  await oficial();
  const lista = await faltasApi("comunicados", { usuario: "jeankleber" });
  assert.equal(lista.statusCode, 200, JSON.stringify(lista.body));
  assert.deepEqual(lista.body.comunicados.map(c => c.area), ["JEAN KLEBER"], "só a área dele");
  assert.equal(lista.body.comunicados[0].linhas, undefined, "a lista é leve: sem as linhas");
  const q = { semana: "2026-10-19", area: "JEAN KLEBER" };
  const meu = await faltasApi("comunicado", { usuario: "jeankleber", query: q });
  assert.equal(meu.statusCode, 200);
  assert.ok(meu.body.comunicado.linhas.some(l => l.re === 101));
  const alheio = await faltasApi("comunicado", { usuario: "jeankleber", query: { semana: "2026-10-19", area: "FRANK PIMENTEL" } });
  const nenhum = await faltasApi("comunicado", { usuario: "jeankleber", query: { semana: "2026-10-19", area: "NAO EXISTE" } });
  assert.equal(alheio.statusCode, 404);
  assert.equal(nenhum.statusCode, 404);
  assert.deepEqual(alheio.body, nenhum.body, "não revela se a área existe");
  assert.equal((await faltasApi("comunicado", { usuario: "jeankleber", query: { semana: "x", area: "JEAN KLEBER" } })).statusCode, 404);
  // quem não gera medida nem entra
  assert.equal((await faltasApi("comunicado", { usuario: "eduardocipriano", query: q })).statusCode, 403);
  assert.equal((await faltasApi("comunicados", {})).statusCode, 401, "sem login");
  // a coordenação vê todas as áreas
  const coord = await faltasApi("comunicados", { usuario: RESP });
  assert.deepEqual(coord.body.comunicados.map(c => c.area).sort(), ["FRANK PIMENTEL", "JEAN KLEBER"]);
});

test("comunicado: se houver mais de uma cópia da mesma semana e área, vale a mais recente e a lista traz uma só", async () => {
  const t = base();
  await oficial();
  const velha = copiasDoComunicado(t).find(c => c.depois.area === "JEAN KLEBER");
  // um segundo envio oficial da mesma semana (o manual pode se repetir) grava outra cópia, com id maior
  t.fm_auditoria.push({ ...velha, id: 9999, criado_em: "2026-10-26T18:00:00Z", depois: { ...velha.depois, qtd: 99, enviadoEm: "2026-10-26T18:00:00Z" } });
  const lista = await faltasApi("comunicados", { usuario: RESP });
  assert.equal(lista.body.comunicados.length, 2, "uma por área");
  assert.equal(lista.body.comunicados.find(c => c.area === "JEAN KLEBER").qtd, 99, "a mais recente");
  const um = await faltasApi("comunicado", { usuario: "jeankleber", query: { semana: "2026-10-19", area: "JEAN KLEBER" } });
  assert.equal(um.body.comunicado.qtd, 99);
});

test("comunicado: abrir fica registrado uma vez por supervisor; a coordenação olhando não conta; o painel do aviso mostra", async () => {
  const t = base();
  await oficial();
  const q = { semana: "2026-10-19", area: "JEAN KLEBER" };
  const antes = await api("painel", { usuario: RESP });
  assert.equal(antes.body.areas.find(a => a.area === "JEAN KLEBER").aberto, null, "ainda ninguém abriu");
  await faltasApi("comunicado", { usuario: RESP, query: q });
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_COMUNICADO_ABERTO").length, 0, "a coordenação olhando não conta como leitura");
  await faltasApi("comunicado", { usuario: "jeankleber", query: q });
  await faltasApi("comunicado", { usuario: "jeankleber", query: q });
  const abertos = t.fm_auditoria.filter(e => e.acao === "FALTAS_COMUNICADO_ABERTO");
  assert.equal(abertos.length, 1, "abrir de novo não grava de novo");
  assert.equal(abertos[0].ator, "jeankleber");
  assert.equal(abertos[0].chave, "2026-10-19|JEAN KLEBER");
  const depois = await api("painel", { usuario: RESP });
  assert.equal(depois.body.areas.find(a => a.area === "JEAN KLEBER").aberto.por, "jeankleber");
  assert.equal(depois.body.areas.find(a => a.area === "FRANK PIMENTEL").aberto, null, "a outra área não abriu");
});

test("comunicado: se a cópia não grava, o e-mail já enviado continua valendo", async () => {
  const t = base();
  supabaseFalso(t, { falhar: (m, tabela) => m === "POST" && tabela === "fm_auditoria" && false });
  const original = global.fetch;
  global.fetch = async (url, init = {}) => {
    if ((init.method || "GET") === "POST" && String(url).includes("fm_auditoria") && String(init.body || "").includes("FALTAS_EMAIL_COMUNICADO")) return { ok: false, status: 500, json: async () => ({}), text: async () => "falha" };
    return original(url, init);
  };
  const r = await oficial();
  assert.equal(r.body.enviados, 2, "os dois e-mails foram marcados como enviados");
  assert.equal(copiasDoComunicado(t).length, 0);
  assert.equal(envios(t).length, 2);
});

test("o botão do e-mail abre o comunicado da semana, com um link só e sem nada do caso na URL", async () => {
  base({ extras: [reg("FALTAS_EMAIL_LINK", "link", { link: "https://painel.exemplo.com.br" })] });
  await oficial();
  const m = para("jean@exemplo.com.br")[0];
  const links = [...m.html.matchAll(/href="(https:\/\/painel\.exemplo\.com\.br[^"]*)"/g)].map(x => x[1]);
  assert.ok(links.length >= 1);
  [...new Set(links.map(l => l.replace(/&amp;/g, "&")))].forEach(l => assert.equal(l, "https://painel.exemplo.com.br/?pg=faltassup&aba=COMUNICADO", "um único endereço, sem RE, nome ou data"));
  assert.ok(!/ANA PAULA|\b101\b/.test(links.join(" ")));
});
