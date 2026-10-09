// Avisos de faltas (push no celular dos supervisores), contra um Supabase falso em memória.
// Nada sai da máquina: o envio do push é trocado por uma função que só anota.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; // as chaves são geradas e guardadas pelo próprio servidor
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const avisos = require("../api/_avisos");
const ponto = require("../api/_ponto");
const rh = require("../api/rh");
const R = require("../api/_faltas_regras");

const APROV = "raphaelvictor", SUP = "frankpimentel", SUP2 = "jeankleber";
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const ontem = R.somaDias(hoje, -1), antes = R.somaDias(hoje, -2), velha = R.somaDias(hoje, -10);

// cada push "enviado" fica anotado aqui; status !== 201 simula falha do serviço
let enviados = [], statusDoServico = () => 201;
avisos.definirEnviador(async (ap, corpo) => {
  const s = statusDoServico(ap);
  if (s >= 400) return { ok: false, status: s };
  enviados.push({ endpoint: ap.endpoint, user: ap.user_key, ...JSON.parse(corpo) });
  return { ok: true, status: s };
});

const EP = n => "https://fcm.googleapis.com/fcm/send/aparelho-" + n;
// Tudo do módulo fica na tabela de registros (fm_auditoria): estes atalhos montam e leem esses registros.
let seq = 0;
const reg = (acao, chave, depois, ator) => ({ id: ++seq, ator: ator || APROV, acao, entidade: "fs_avisos", chave: String(chave), antes: null, depois, criado_em: new Date().toISOString() });
const evContato = (id, nome, area, user_key, ativo) => reg("AVISO_CONTATO_CRIADO", id, { nome, area, user_key, ativo: ativo !== false });
const resumo = ep => "ap|" + require("crypto").createHash("sha256").update(ep).digest("hex").slice(0, 32);
const ap = (n, user) => reg("AVISO_APARELHO", resumo(EP(n)), { user_key: user, endpoint: EP(n), p256dh: "B".repeat(87), auth: "a".repeat(22) }, user);
const evAuto = ligado => reg("AVISO_AUTO_ALTERADO", "auto", { ligado });
const ultimos = (t, acoes) => { const m = new Map(); t.fm_auditoria.filter(e => acoes.includes(e.acao)).sort((a, b) => a.id - b.id).forEach(e => m.set(e.chave, e)); return [...m.values()]; };
const aparelhos = t => ultimos(t, ["AVISO_APARELHO", "AVISO_APARELHO_REMOVIDO"]).filter(e => e.acao === "AVISO_APARELHO").map(e => e.depois);
const contatos = t => ultimos(t, ["AVISO_CONTATO_CRIADO", "AVISO_CONTATO_EDITADO", "AVISO_CONTATO_REMOVIDO"]).filter(e => e.acao !== "AVISO_CONTATO_REMOVIDO").map(e => ({ id: Number(e.chave), ...e.depois }));
const avisadas = t => [...avisos.estadoReservas(t.fm_auditoria.filter(e => ["AVISO_RESERVA", "AVISO_DEVOLVIDA"].includes(e.acao)).sort((a, b) => a.id - b.id)).keys()];
const envios = t => t.fm_auditoria.filter(e => e.acao === "AVISO_ENVIO").map(e => e.depois);
const autoLigado = t => { const l = t.fm_auditoria.filter(e => e.acao === "AVISO_AUTO_ALTERADO"); return !!(l.length && l[l.length - 1].depois.ligado); };
const falta = (re, data, extra) => ({ re, data, codigo: "I", nome: "PESSOA " + re, posto: "POSTO " + re, supervisor: "FRANK", ...extra });
// o: { faltas, aparelhos (lista de [n, usuário]), auto, extras (registros a mais), admissoes }
function base(o) {
  o = o || {};
  enviados = []; statusDoServico = () => 201; seq = 0;
  const regs = [
    evContato(1, "Frank Pimentel", "FRANK PIMENTEL", SUP),
    evContato(2, "Jean Kleber", "JEAN KLEBER", SUP2),
    ...(o.aparelhos || [[1, SUP]]).map(([n, u]) => ap(n, u)),
    ...(o.auto === false ? [] : [evAuto(true)]),
    ...(o.extras || []).map(e => ({ ...e, id: ++seq, criado_em: e.criado_em || new Date().toISOString() }))
  ];
  const t = {
    fm_faltas: o.faltas || [falta(101, ontem), falta(102, antes), falta(201, ontem, { supervisor: "JEAN KLEBER" })],
    fm_admissoes: o.admissoes || [], fm_auditoria: regs, fm_feriados: []
  };
  supabaseFalso(t);
  return t;
}
const api = (t, o) => chamar(rh, { ...o, query: { modulo: "avisos", t, ...(o && o.query) } });

// ── texto ───────────────────────────────────────────────────────────────────

test("saudação pelo horário de São Paulo", () => {
  assert.equal(avisos.saudacao(new Date("2026-10-09T13:00:00Z")), "bom dia");    // 10h
  assert.equal(avisos.saudacao(new Date("2026-10-09T14:59:00Z")), "bom dia");    // 11h59
  assert.equal(avisos.saudacao(new Date("2026-10-09T15:00:00Z")), "boa tarde");  // 12h
  assert.equal(avisos.saudacao(new Date("2026-10-09T21:00:00Z")), "boa noite");  // 18h
  assert.equal(avisos.saudacao(new Date("2026-10-10T02:00:00Z")), "boa noite");  // 23h do dia 9
});

test("formato do aviso: data de cada falta, 'chegaram mais', versão completa e limite de tamanho", () => {
  const agora = new Date("2026-10-09T13:00:00Z");
  const dm = d => d.slice(8, 10) + "/" + d.slice(5, 7);
  const f = [falta(12345, ontem, { nome: "MARIA DA SILVA", posto: "COND - ESTRELA" }), falta(678, ontem, { nome: "JOÃO SOUZA", posto: "" })];
  const t = avisos.montarTexto({ nome: "FRANK PIMENTEL", faltas: f, agora, tipo: "RESUMO" });
  assert.equal(t.titulo, "ServCamp · 2 faltas injustificadas");
  const l = t.corpo.split("\n");
  assert.equal(l[0], "Muito bom dia, Frank! Temos 2 faltas injustificadas na sua área:");
  assert.deepEqual(l.slice(1, 3), ["• JOÃO SOUZA — RE 678 — Reserva técnica — falta em " + dm(ontem), "• MARIA DA SILVA — RE 12345 — COND - ESTRELA — falta em " + dm(ontem)]);
  assert.equal(l[3], "Por gentileza, verifique se há atestados que justifiquem a ausência. Caso não haja, aplicar medida disciplinar até o próximo plantão.");
  assert.equal(avisos.montarTexto({ nome: "Frank", faltas: f.slice(0, 1), agora, jaAvisou: true }).corpo.split("\n")[0], "Muito bom dia, Frank! Chegou mais 1 falta injustificada na sua área:");
  assert.match(avisos.montarTexto({ nome: "Frank", faltas: f, agora, jaAvisou: true }).corpo, /Chegaram mais 2 faltas injustificadas na sua área:/);
  assert.equal(avisos.montarTexto({ nome: "Frank", faltas: f.slice(0, 1), agora }).titulo, "ServCamp · 1 falta injustificada");
  // a mesma pessoa em dois dias: uma linha só
  const dupla = avisos.montarTexto({ nome: "Frank", faltas: [falta(5, ontem), falta(5, antes)], agora });
  assert.ok(dupla.corpo.includes("• PESSOA 5 — RE 5 — POSTO 5 — faltas em " + dm(antes) + " e " + dm(ontem)), dupla.corpo);
  // 15 pessoas: 10 linhas e o resto na tela
  const muitas = Array.from({ length: 15 }, (_, i) => falta(1000 + i, ontem));
  const m = avisos.montarTexto({ nome: "Frank", faltas: muitas, agora });
  assert.equal(m.corpo.split("\n").filter(x => x.startsWith("• ")).length, 10);
  assert.match(m.corpo, /\+ 5 — toque para ver o aviso completo/);
  // a versão completa (a que o app mostra) traz todo mundo
  const mc = avisos.montarTexto({ nome: "Frank", faltas: muitas, agora, completo: true });
  assert.equal(mc.corpo.split("\n").filter(x => x.startsWith("• ")).length, 15);
  assert.doesNotMatch(mc.corpo, /toque para ver/);
  // nomes e postos enormes: o push continua abaixo de 4 KB
  const gigantes = Array.from({ length: 12 }, (_, i) => falta(2000 + i, ontem, { nome: "Ç".repeat(400), posto: "Ã".repeat(400) }));
  const g = avisos.montarTexto({ nome: "Frank", faltas: gigantes, agora });
  assert.ok(Buffer.byteLength(JSON.stringify(g), "utf8") < 4096);
  // "sem faltas"
  assert.match(avisos.montarTexto({ nome: "Frank", faltas: [], agora: new Date("2026-10-09T22:00:00Z"), tipo: "SEM_FALTAS" }).corpo, /^Muito boa noite, Frank! Hoje não temos faltas injustificadas novas/);
});

test("área da planilha → supervisor: igual, nome inteiro contido, e na dúvida ninguém", () => {
  const c = [{ id: 1, area: "FRANK PIMENTEL" }, { id: 2, area: "PAULO SERGIO" }, { id: 3, area: "PAULO CAMPANA" }, { id: 4, area: "Jean Kléber" }];
  assert.equal(avisos.casarArea("frank pimentel", c).contato.id, 1);
  assert.equal(avisos.casarArea("FRANK", c).contato.id, 1, "FRANK ⊂ FRANK PIMENTEL");
  assert.equal(avisos.casarArea("JEAN KLEBER", c).contato.id, 4, "acento não atrapalha");
  assert.equal(avisos.casarArea("FRANKLIN", c).contato, null, "pedaço de palavra não vale");
  assert.equal(avisos.casarArea("PAULO", c).motivo, "AMBIGUA");
  assert.equal(avisos.casarArea("RONALDO", c).motivo, "SEM_CADASTRO");
});

test("área do Edney (saiu) vai para o Jean: o aviso da falta cai no celular do Jean", async () => {
  const t = base({ faltas: [falta(301, ontem, { supervisor: "EDNEY FERRAZ" })], aparelhos: [[2, SUP2]] });
  await avisos.aposImportar();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].user, SUP2);
  assert.deepEqual(avisadas(t), ["301|" + ontem]);
});

// ── envio automático ────────────────────────────────────────────────────────

test("automático desligado por padrão: sem registro não envia nada", async () => {
  const t = base({ auto: false });
  const r = await avisos.aposImportar();
  assert.equal(r.ignorado, "AUTO_DESLIGADO");
  assert.equal(enviados.length, 0);
  assert.equal(avisadas(t).length, 0);
});

test("automático ligado: só quem tem aparelho recebe, e a mesma falta não repete", async () => {
  const t = base();
  const r = await avisos.aposImportar();
  assert.equal(r.ok, true);
  assert.equal(enviados.length, 1, "Jean não ativou aparelho");
  assert.equal(enviados[0].user, SUP);
  assert.equal(enviados[0].titulo, "ServCamp · 2 faltas injustificadas");
  assert.equal(enviados[0].tipo, "RESUMO");
  assert.equal(enviados[0].url, "/?abrir=faltassup&aviso=" + enviados[0].aviso);
  assert.deepEqual(avisadas(t).sort(), ["101|" + ontem, "102|" + antes].sort(), "a falta do Jean continua na fila até ele ativar");
  assert.equal(r.semAparelho, 1);
  // nova planilha sem falta nova: nada se repete (e já houve aviso hoje: nem "sem faltas")
  enviados = [];
  await avisos.aposImportar();
  assert.equal(enviados.length, 0);
  // chega mais uma falta: só ela vai, com "Chegou mais 1"
  t.fm_faltas.push(falta(103, hoje));
  await avisos.aposImportar();
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].corpo, /Chegou mais 1 falta injustificada/);
  assert.match(enviados[0].corpo, /RE 103/);
  assert.doesNotMatch(enviados[0].corpo, /RE 101/);
});

test("'sem faltas' no automático: uma vez por dia", async () => {
  const t = base({ faltas: [] });
  await avisos.aposImportar();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].tipo, "SEM_FALTAS");
  await avisos.aposImportar();
  assert.equal(enviados.length, 1, "segunda planilha do dia não repete");
  assert.deepEqual(envios(t).map(e => e.tipo), ["SEM_FALTAS"]);
});

test("fora do aviso: abonada, coberta por atestado registrado, anterior à admissão e antiga", async () => {
  const t = base({
    faltas: [
      falta(101, ontem),                    // vai
      falta(102, ontem, { codigo: "A" }),   // abonada
      falta(103, ontem),                    // atestado registrado à mão
      falta(104, antes),                    // falta de quem tinha o RE antes
      falta(105, velha)                     // fora dos últimos 3 dias
    ],
    admissoes: [{ re: 104, admissao: ontem }],
    extras: [{ ator: APROV, acao: "ATESTADO_REGISTRADO", entidade: "fm_atestados", chave: "103|" + antes, depois: { re: 103, tem: true, inicio: antes, dias: 3, codigo: "A" } }]
  });
  await avisos.aposImportar();
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].corpo, /RE 101/);
  ["RE 102", "RE 103", "RE 104", "RE 105"].forEach(x => assert.ok(!enviados[0].corpo.includes(x), x + " não deveria estar no aviso"));
  assert.deepEqual(avisadas(t), ["101|" + ontem]);
});

test("nenhum aparelho recebeu: as faltas voltam para a fila", async () => {
  const t = base();
  statusDoServico = () => 500;
  const r = await avisos.aposImportar();
  assert.equal(r.falhou, 1);
  assert.equal(avisadas(t).length, 0, "devolvidas à fila");
  assert.equal(aparelhos(t).length, 1, "falha comum não apaga o aparelho");
  statusDoServico = () => 201;
  await avisos.aposImportar();
  assert.equal(enviados.length, 1, "saem no próximo envio");
  assert.equal(avisadas(t).length, 2);
});

test("aparelho que o serviço diz não existir mais (410) é apagado", async () => {
  const t = base({ aparelhos: [[1, SUP], [2, SUP]] });
  statusDoServico = a => (a.endpoint === EP(2) ? 410 : 201);
  await avisos.aposImportar();
  assert.deepEqual(aparelhos(t).map(a => a.endpoint), [EP(1)]);
  assert.equal(enviados.length, 1);
});

// ── envio manual ────────────────────────────────────────────────────────────

test("manual: só os selecionados, exige confirmar, e 'todas' reenvia sem reservar de novo", async () => {
  const t = base({ aparelhos: [[1, SUP], [2, SUP2]], auto: false });
  const sem = await api("enviar", { method: "POST", usuario: APROV, body: { ids: [1], modo: "novas" } });
  assert.equal(sem.statusCode, 400);
  assert.equal(sem.body.codigo, "SEM_CONFIRMACAO");
  assert.equal(enviados.length, 0);
  const r = await api("enviar", { method: "POST", usuario: APROV, body: { ids: [1], modo: "novas", confirmar: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.avisos, 1);
  assert.deepEqual(enviados.map(e => e.user), [SUP], "o automático está desligado, mas o manual funciona");
  enviados = [];
  const r2 = await api("enviar", { method: "POST", usuario: APROV, body: { ids: [1], modo: "todas", confirmar: true } });
  assert.equal(r2.body.avisos, 1);
  assert.match(enviados[0].corpo, /Temos 2 faltas/);
  assert.equal(avisadas(t).length, 2, "reenvio não duplica");
  assert.equal(t.fm_auditoria.filter(e => e.acao === "AVISO_RESERVA").length, 2, "nem grava reserva de novo");
  // manual "novas" sem nada novo: só manda "sem faltas" se pedir
  enviados = [];
  await api("enviar", { method: "POST", usuario: APROV, body: { ids: [1], modo: "novas", confirmar: true } });
  assert.equal(enviados.length, 0);
  await api("enviar", { method: "POST", usuario: APROV, body: { ids: [1], modo: "novas", semFaltas: true, confirmar: true } });
  assert.equal(enviados[0].tipo, "SEM_FALTAS");
});

test("rotas de aprovador: 403 para supervisor, 401 sem login", async () => {
  base();
  for (const [m, t] of [["GET", "previa"], ["POST", "contato"], ["POST", "editar"], ["POST", "remover"], ["POST", "enviar"], ["POST", "teste"], ["POST", "auto"]]) {
    const r = await api(t, { method: m, usuario: SUP, body: {} });
    assert.equal(r.statusCode, 403, m + " " + t);
    const r2 = await api(t, { method: m, body: {} });
    assert.equal(r2.statusCode, 401, m + " " + t + " sem login");
  }
});

test("prévia: supervisores, aparelhos, faltas novas, texto e áreas sem cadastro", async () => {
  const t = base();
  t.fm_faltas.push(falta(301, ontem, { supervisor: "RONALDO CIMADON" }));
  const r = await api("previa", { usuario: APROV });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.auto, true);
  const frank = r.body.contatos.find(c => c.id === 1);
  assert.equal(frank.aparelhos, 1);
  assert.equal(frank.novas, 2);
  assert.equal(frank.aviso.titulo, "ServCamp · 2 faltas injustificadas");
  assert.deepEqual(r.body.semCadastro.map(a => a.area), ["RONALDO CIMADON"]);
  assert.ok(r.body.areasLivres.includes("RONALDO CIMADON"));
  assert.equal(enviados.length, 0, "prévia não envia nada");
});

// ── cadastro ────────────────────────────────────────────────────────────────

test("cadastro de supervisores: cria, recusa duplicado e login inválido, pausa e remove (tudo auditado)", async () => {
  const t = base();
  const novo = await api("contato", { method: "POST", usuario: APROV, body: { nome: "Ronaldo Cimadon", area: "RONALDO CIMADON", user_key: "ronaldocimadon" } });
  assert.equal(novo.statusCode, 200, JSON.stringify(novo.body));
  const id = novo.body.contato.id;
  assert.equal((await api("contato", { method: "POST", usuario: APROV, body: { nome: "X", area: "ronaldo cimadon", user_key: "carlos" } })).body.codigo, "AREA_DUPLICADA");
  assert.equal((await api("contato", { method: "POST", usuario: APROV, body: { nome: "X", area: "OUTRA", user_key: SUP } })).body.codigo, "LOGIN_DUPLICADO");
  assert.equal((await api("contato", { method: "POST", usuario: APROV, body: { nome: "X", area: "OUTRA", user_key: "naoexiste" } })).body.codigo, "LOGIN_INVALIDO");
  assert.equal((await api("editar", { method: "POST", usuario: APROV, body: { id, area: "FRANK PIMENTEL" } })).body.codigo, "AREA_DUPLICADA");
  const pausa = await api("editar", { method: "POST", usuario: APROV, body: { id: 1, ativo: false } });
  assert.equal(pausa.statusCode, 200);
  assert.equal(contatos(t).find(c => c.id === 1).ativo, false);
  await avisos.aposImportar();
  assert.equal(enviados.length, 0, "pausado não recebe");
  const rem = await api("remover", { method: "POST", usuario: APROV, body: { id } });
  assert.equal(rem.statusCode, 200);
  assert.ok(!contatos(t).some(c => c.id === id));
  assert.equal(id, 3, "id novo depois dos existentes");
  assert.deepEqual(t.fm_auditoria.filter(a => a.id > 4 && /^AVISO_CONTATO/.test(a.acao)).map(a => a.acao), ["AVISO_CONTATO_CRIADO", "AVISO_CONTATO_EDITADO", "AVISO_CONTATO_REMOVIDO"]);
});

// ── aparelhos ───────────────────────────────────────────────────────────────

test("inscrição: recusa endereço estranho, chave inválida e quem não está cadastrado", async () => {
  const t = base({ aparelhos: [] });
  const corpo = ep => ({ endpoint: ep, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) }, agente: "teste" });
  for (const ep of ["http://fcm.googleapis.com/x/123456789012345", "https://169.254.169.254/latest/meta-data/x", "https://googleapis.com.evil.com/abcdefghijklmnop", "https://fcm.googleapis.com:8443/x/12345678901234"]) {
    const r = await api("inscrever", { method: "POST", usuario: SUP, body: corpo(ep) });
    assert.equal(r.body.codigo, "ENDPOINT_INVALIDO", ep);
  }
  assert.equal((await api("inscrever", { method: "POST", usuario: SUP, body: { endpoint: EP(9), keys: { p256dh: "curta", auth: "x" } } })).body.codigo, "CHAVES_INVALIDAS");
  assert.equal((await api("inscrever", { method: "POST", usuario: "testejoao", body: corpo(EP(9)) })).statusCode, 403);
  assert.equal((await api("inscrever", { method: "POST", body: corpo(EP(9)) })).statusCode, 401);
  for (const ep of [EP(9), "https://web.push.apple.com/QGuQyavXutnMH", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2-by3p.notify.windows.com/w/?token=abc"]) {
    const r = await api("inscrever", { method: "POST", usuario: SUP, body: corpo(ep) });
    assert.equal(r.statusCode, 200, ep + " " + JSON.stringify(r.body));
  }
  assert.equal(aparelhos(t).length, 4);
  assert.ok(aparelhos(t).every(a => a.user_key === SUP));
  // aprovador pode ativar mesmo sem estar cadastrado como supervisor
  assert.equal((await api("inscrever", { method: "POST", usuario: APROV, body: corpo(EP(10)) })).statusCode, 200);
});

test("cancelar só mexe nos aparelhos da própria pessoa", async () => {
  const t = base({ aparelhos: [[1, SUP], [2, SUP2], [3, SUP]] });
  const r = await api("cancelar", { method: "POST", usuario: SUP2, body: { endpoint: EP(1) } });
  assert.equal(r.statusCode, 200);
  assert.equal(aparelhos(t).length, 3, "o aparelho 1 é do Frank: o Jean não apaga");
  await api("cancelar", { method: "POST", usuario: SUP, body: { endpoint: EP(1) } });
  assert.deepEqual(aparelhos(t).map(a => a.endpoint), [EP(2), EP(3)]);
  await api("cancelar", { method: "POST", usuario: SUP, body: {} });
  assert.deepEqual(aparelhos(t).map(a => a.endpoint), [EP(2)]);
});

test("status e chave: quem recebe, aprovador, aparelhos; chave gerada e guardada sem configurar nada", async () => {
  const t = base();
  const s = await api("status", { usuario: SUP });
  assert.deepEqual([s.body.recebe, s.body.aprovador, s.body.aparelhos], [true, false, 1]);
  const a = await api("status", { usuario: APROV });
  assert.deepEqual([a.body.recebe, a.body.aprovador, a.body.aparelhos], [false, true, 0]);
  const k = await api("chave", { usuario: SUP });
  assert.equal(k.body.configurado, true);
  assert.match(k.body.chave, /^[A-Za-z0-9_-]{80,90}$/, "chave pública gerada no primeiro uso");
  const k2 = await api("chave", { usuario: SUP2 });
  assert.equal(k2.body.chave, k.body.chave, "a mesma chave depois");
  assert.equal(t.fm_auditoria.filter(e => e.acao === "AVISO_VAPID").length, 1, "gerada uma vez só");
  assert.ok(!JSON.stringify([s.body, a.body, k.body]).includes(t.fm_auditoria.find(e => e.acao === "AVISO_VAPID").depois.priv), "a chave privada nunca sai do servidor");
});

test("teste: vai só para o aparelho de quem pediu e não marca nada como avisado", async () => {
  const t = base({ aparelhos: [[1, SUP], [5, APROV]] });
  const r = await api("teste", { method: "POST", usuario: APROV, body: { nome: "Raphael Victor" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(enviados.map(e => e.user), [APROV]);
  assert.match(enviados[0].titulo, /^TESTE · ServCamp · 2 faltas injustificadas$/);
  assert.match(enviados[0].corpo, /Raphael!/);
  assert.match(enviados[0].corpo, /MARIA EXEMPLO/);
  enviados = [];
  await api("teste", { method: "POST", usuario: APROV, body: { contato_id: 1 } });
  assert.deepEqual(enviados.map(e => e.user), [APROV], "faltas reais do Frank, mas só no aparelho de quem pediu");
  assert.match(enviados[0].corpo, /RE 101/);
  assert.equal(avisadas(t).length, 0, "teste não tira falta da fila");
  assert.deepEqual(envios(t).map(e => e.tipo), ["TESTE", "TESTE"]);
  const sem = await api("teste", { method: "POST", usuario: "joaoygor", body: {} });
  assert.equal(sem.body.codigo, "SEM_APARELHO");
});

test("liga e desliga o automático (auditado)", async () => {
  const t = base({ auto: false });
  const r = await api("auto", { method: "POST", usuario: APROV, body: { ligado: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(autoLigado(t), true);
  await api("auto", { method: "POST", usuario: APROV, body: { ligado: false } });
  assert.equal(autoLigado(t), false);
  assert.equal(t.fm_auditoria.filter(a => a.acao === "AVISO_AUTO_ALTERADO").length, 2);
});

// ── integração ──────────────────────────────────────────────────────────────

test("importação da planilha: automático desligado, e a resposta não leva nome de ninguém", async () => {
  const importar = require("../api/import");
  base({ auto: false });
  const planilha = {
    faltas: [{ RE: 777, NOME: "FULANO SECRETO", DATA: ontem, ABONO: "I", CARGO: "PORTEIRO", LOCAL: "POSTO X", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }],
    fichaDias: {}, disciplina: [], ativos: [{ RE: 777, NOME: "FULANO SECRETO", ADMISSAO: "2020-01-01" }], clientes: []
  };
  const r = await chamar(importar, { method: "POST", usuario: APROV, headers: { "content-type": "application/json" }, body: { data: planilha } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.avisos_faltas.ignorado, "AUTO_DESLIGADO");
  assert.ok(!JSON.stringify(r.body.avisos_faltas).includes("FULANO"));
  assert.equal(enviados.length, 0);
});

test("importação com o automático ligado envia e devolve só contagens", async () => {
  const importar = require("../api/import");
  base({ faltas: [] });
  const planilha = {
    faltas: [{ RE: 777, NOME: "FULANO SECRETO", DATA: ontem, ABONO: "I", CARGO: "PORTEIRO", LOCAL: "POSTO X", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }],
    fichaDias: {}, disciplina: [], ativos: [], clientes: []
  };
  const r = await chamar(importar, { method: "POST", usuario: APROV, headers: { "content-type": "application/json" }, body: { data: planilha } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.avisos_faltas.avisos, 1);
  assert.equal(enviados.length, 1);
  assert.ok(!JSON.stringify(r.body.avisos_faltas).includes("FULANO"));
});

test("a lista de aprovadores da tela é a mesma do servidor", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "avisos", "avisos.js"), "utf8");
  const m = js.match(/const AV_APROVADORES=(\[[^\]]*\]);/);
  assert.ok(m, "AV_APROVADORES não encontrada");
  assert.deepEqual(JSON.parse(m[1]).sort(), [...ponto.APROVADORES].filter(x => x !== "aprovador").sort());
});

test("tela: script dos avisos compila, está ligado no index.html e o service worker trata o push", () => {
  const raiz = path.join(__dirname, "..");
  const js = fs.readFileSync(path.join(raiz, "assets", "avisos", "avisos.js"), "utf8");
  assert.doesNotThrow(() => new Function(js), "avisos.js com erro de sintaxe");
  const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  assert.ok(html.includes('<script src="/assets/avisos/avisos.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/avisos/avisos.css">'));
  assert.ok(html.includes('id="sbAvAparelho"') && html.includes('id="sbAvPainel"'), "links no menu do perfil");
  assert.ok(/navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(js), "o service worker precisa ser registrado, senão nenhum push chega");
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  assert.ok(sw.includes('addEventListener("push"') && sw.includes('addEventListener("notificationclick"'));
  assert.ok(sw.includes('if (url.pathname.startsWith("/api/")) return;'), "/api/ continua fora do cache");
  assert.ok(fs.existsSync(path.join(raiz, "assets", "som", "aviso-faltas.wav")), "som do aviso");
});

test("duas planilhas ao mesmo tempo: a mesma falta sai uma vez só", async () => {
  const t = base();
  const [a, b] = await Promise.all([avisos.aposImportar(), avisos.aposImportar()]);
  assert.equal(a.avisos + b.avisos, 1);
  assert.equal(enviados.length, 1);
  assert.equal(avisadas(t).length, 2);
});

test("tocar na notificação abre o aviso completo: todas as faltas, só para quem recebeu", async () => {
  const muitas = Array.from({ length: 12 }, (_, i) => falta(5000 + i, ontem));
  base({ faltas: muitas });
  await avisos.aposImportar();
  assert.equal(enviados.length, 1);
  const p = enviados[0];
  assert.match(p.aviso, /^[a-f0-9]{16}$/);
  assert.equal(p.url, "/?abrir=faltassup&aviso=" + p.aviso);
  assert.equal(p.corpo.split("\n").filter(x => x.startsWith("• ")).length, 10, "a notificação mostra 10");
  const r = await api("aviso", { usuario: SUP, query: { id: p.aviso } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.aviso.faltas.length, 12, "o app mostra as 12");
  assert.equal(r.body.aviso.corpo.split("\n").filter(x => x.startsWith("• ")).length, 12);
  assert.ok(r.body.aviso.faltas.every(f => f.data === ontem));
  assert.equal((await api("aviso", { usuario: SUP2, query: { id: p.aviso } })).statusCode, 403, "outro supervisor não vê");
  assert.equal((await api("aviso", { usuario: APROV, query: { id: p.aviso } })).statusCode, 200, "aprovador vê");
  assert.equal((await api("aviso", { usuario: SUP, query: { id: "nao-existe" } })).statusCode, 400);
  assert.equal((await api("aviso", { query: { id: p.aviso } })).statusCode, 401);
});

test("o aviso de teste também abre completo para quem pediu", async () => {
  base({ aparelhos: [[5, APROV]] });
  await api("teste", { method: "POST", usuario: APROV, body: { nome: "Raphael Victor" } });
  const r = await api("aviso", { usuario: APROV, query: { id: enviados[0].aviso } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.aviso.faltas.length, 2);
  assert.match(r.body.aviso.titulo, /^TESTE · /);
  assert.match(r.body.aviso.corpo, /falta em \d{2}\/\d{2}/);
});

test("service worker: só ícones e manifesto vêm do cache; scripts, estilos, sons e /api/ vão sempre à rede", () => {
  const vm = require("vm");
  const ouvintes = {};
  const self = { location: { origin: "https://painel.exemplo" }, addEventListener: (t, fn) => { ouvintes[t] = fn; }, skipWaiting() {}, clients: { claim: async () => {} }, registration: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), { self, caches: { match: async () => null, open: async () => ({ put() {} }) }, fetch: async () => ({ status: 200, type: "basic", clone() { return this; } }), URL, Response: { error: () => null }, console });
  const respondeu = (caminho, mode) => { let r = false; ouvintes.fetch({ request: { method: "GET", url: "https://painel.exemplo" + caminho, mode: mode || "no-cors" }, respondWith: () => { r = true; } }); return r; };
  assert.equal(respondeu("/icon-192.png"), true, "ícone pode vir do cache");
  assert.equal(respondeu("/site.webmanifest"), true);
  for (const c of ["/assets/avisos/avisos.js", "/assets/avisos/avisos.css", "/assets/tv/modo-tv.css", "/fonts/Rajdhani700.woff2", "/assets/som/aviso-faltas.wav", "/api/rh?modulo=avisos&t=status"]) {
    assert.equal(respondeu(c), false, c + " não pode ficar preso no cache");
  }
  assert.equal(respondeu("/", "navigate"), true, "a página continua rede primeiro, com o cache só de reserva");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), /const VERSAO = "jarvis-v2";/, "versão nova apaga o cache antigo (v1)");
});
