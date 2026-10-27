// Medida disciplinar gerada pelo painel: regras puras e rotas, contra um Supabase falso em memória.
// Plano em docs/medida-disciplinar.md. O SAR2G continua sendo o sistema oficial: aqui só se confere
// quem pode gerar, o que fica registrado e quando a medida deixa de ser "pendente de lançar".
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const MD = require("../api/_medida_regras");
const rh = require("../api/rh");

// ── regras ──────────────────────────────────────────────────────────────────
test("quem gera: Raphael, Jussilene, João e os supervisores; o resto não", () => {
  ["raphaelvictor", "jussilenealmeida", "joaoygor", "frankpimentel", "paulosergio", "carlos"].forEach(u => assert.equal(MD.podeGerar(u), true, u));
  ["sandraalves", "paulocampana", "eduardocipriano", "", null, undefined].forEach(u => assert.equal(MD.podeGerar(u), false, String(u)));
});

test("o supervisor só gera para a área dele; a coordenação, para todas", () => {
  assert.equal(MD.daArea("frankpimentel", "FRANK PIMENTEL"), true);
  assert.equal(MD.daArea("frankpimentel", "JEAN KLEBER"), false);
  assert.equal(MD.daArea("paulosergio", "PAULO SÉRGIO SILVA"), true, "com acento e sobrenome a mais");
  assert.equal(MD.daArea("ronaldocimadon", "RONALDO CIMADOM"), true, "sobrenome escrito diferente na planilha");
  assert.equal(MD.daArea("carlos", "CARLOS NOGUEIRA"), true);
  assert.equal(MD.daArea("jussilenealmeida", "JEAN KLEBER"), true);
  assert.equal(MD.daArea("sandraalves", "SANDRA"), false);
  assert.equal(MD.daArea("frankpimentel", ""), false, "caso sem supervisor: só a coordenação");
});

test("validar: tipo, dias da suspensão, data, motivo e colaborador", () => {
  const ok = { tipo: "SUSPENSAO", dias: 2, inicio: "2026-10-27", motivo: "Faltou sem justificativa.", re: 521, nome: "ANA", supervisor: "FRANK PIMENTEL", situacoes: ["FALTA_INJUSTIFICADA", "INVENTADA"], faltas: ["2026-10-20", "2026-10-20", "x"] };
  const v = MD.validar(ok, "2026-10-27");
  assert.equal(v.erro, undefined);
  assert.deepEqual([v.dados.tipo, v.dados.dias, v.dados.situacoes, v.dados.faltas], ["SUSPENSÃO", 2, ["FALTA_INJUSTIFICADA"], ["2026-10-20"]], "situação inventada e data repetida/inválida saem");
  assert.equal(MD.validar({ ...ok, tipo: "DEMISSAO" }).erro[1], "TIPO_INVALIDO");
  assert.equal(MD.validar({ ...ok, dias: 0 }).erro[1], "DIAS_INVALIDOS");
  assert.equal(MD.validar({ ...ok, dias: 31 }).erro[1], "DIAS_INVALIDOS");
  assert.equal(MD.validar({ ...ok, tipo: "ADVERTENCIA_ESCRITA", dias: 9 }).dados.dias, 0, "advertência não tem dias");
  assert.equal(MD.validar({ ...ok, motivo: "  " }).erro[1], "SEM_MOTIVO");
  assert.equal(MD.validar({ ...ok, inicio: "2026-13-40" }).erro[1], "DATA_INVALIDA");
  assert.equal(MD.validar({ ...ok, inicio: "2025-01-01" }, "2026-10-27").erro[1], "DATA_FORA");
  assert.equal(MD.validar({ ...ok, re: "12a" }).erro[1], "SEM_RE");
});

test("número do documento: MD-AAAA-NNNN na ordem em que foi gerado, recomeçando no ano novo", () => {
  const n = MD.numerar([
    { id: 9, chave: "c", criado_em: "2027-01-02T10:00:00Z" },
    { id: 3, chave: "b", criado_em: "2026-12-20T10:00:00Z" },
    { id: 1, chave: "a", criado_em: "2026-10-27T10:00:00Z" }
  ]);
  assert.deepEqual(n.map(x => [x.chave, x.numero]), [["a", "MD-2026-0001"], ["b", "MD-2026-0002"], ["c", "MD-2027-0001"]]);
});

const ev = (id, acao, chave, depois, ator, em) => ({ id, ator: ator || "frankpimentel", acao, chave, depois, criado_em: em || "2026-10-27T13:00:00Z" });
const gerada = (id, chave, extra) => ev(id, MD.ACAO_GERADA, chave, { re: "521", nome: "ANA PAULA", tipoId: "SUSPENSAO", tipo: "SUSPENSÃO", grau: "SUSPENSÃO", dias: 1, inicio: "2026-10-27", motivo: "x", supervisor: "FRANK PIMENTEL", caso: "521|2026-10-20", ...extra });

test("situação: pendente até a planilha trazer a medida (ou alguém marcar); cancelada sai", () => {
  const evs = [gerada(1, "a"), gerada(2, "b", { re: "600", nome: "BIA" }), gerada(3, "c", { re: "700", nome: "CAIO" }), gerada(4, "d", { re: "800", nome: "DUDA" }),
    ev(5, MD.ACAO_LANCADA, "b", { lancado: true }, "jussilenealmeida"),
    ev(6, MD.ACAO_CANCELADA, "c", { motivo: "gerei no colaborador errado" }),
    ev(7, MD.ACAO_LANCADA, "d", { lancado: true }), ev(8, MD.ACAO_LANCADA, "d", { lancado: false })];
  const medidas = [
    { re: 521, data: "2026-10-26", tipo: "SUSPENSÃO", dias: 1, fase: "CONCLUIDO", nome: "ANA PAULA SOUZA" }, // lançada no SAR2G (a data pode ser um pouco antes)
    { re: 800, data: "2026-10-28", tipo: "ADVERTÊNCIA", fase: "CANCELADA" },                               // cancelada no SAR2G não conta
    { re: 800, data: "2026-09-01", tipo: "ADVERTÊNCIA", fase: "CONCLUIDO" }                                // muito antes da geração: é outra
  ];
  const g = Object.fromEntries(MD.dobrar(evs, medidas, "2026-10-30").map(x => [x.chave, x]));
  assert.deepEqual([g.a.status, g.a.lancadaPor, g.a.sar2g.data], ["LANCADA", "planilha", "2026-10-26"]);
  assert.deepEqual([g.b.status, g.b.lancadaPor, g.b.manual], ["LANCADA", "jussilenealmeida", true]);
  assert.deepEqual([g.c.status, g.c.motivoCancelamento], ["CANCELADA", "gerei no colaborador errado"]);
  assert.deepEqual([g.d.status, g.d.diasPendente], ["PENDENTE", 3], "desmarcou: volta a pendente");
  assert.equal(g.a.numero, "MD-2026-0001");
  // mesmo RE, outra pessoa (o RE se repete entre as empresas do grupo): não baixa a medida
  const outra = MD.dobrar([gerada(1, "a")], [{ re: 521, data: "2026-10-27", tipo: "SUSPENSÃO", fase: "CONCLUIDO", nome: "ZECA OUTRO" }], "2026-10-27");
  assert.equal(outra[0].status, "PENDENTE");
});

test("histórico do colaborador no ano: conta por tipo, ignora cancelada e outra pessoa com o mesmo RE", () => {
  const medidas = [
    { re: 5, data: "2026-03-01", tipo: "ADVERTÊNCIA", grau: "VERBAL", nome: "ANA" },
    { re: 5, data: "2026-05-01", tipo: "ADVERTÊNCIA", grau: "ESCRITA", nome: "ANA" },
    { re: 5, data: "2026-08-01", tipo: "SUSPENSÃO", dias: 2, nome: "ANA" },
    { re: 5, data: "2026-09-01", tipo: "SUSPENSÃO", dias: 3, fase: "CANCELADA", nome: "ANA" },
    { re: 5, data: "2026-09-15", tipo: "SUSPENSÃO", dias: 9, nome: "BETO" }
  ];
  const faltas = [{ re: 5, data: "2026-03-01", nome: "ANA" }, { re: 5, data: "2026-03-01", nome: "ANA" }, { re: 5, data: "2026-10-20", nome: "ANA" }, { re: 5, data: "2026-10-21", nome: "BETO" }];
  const h = MD.historicoDe(5, "ANA PAULA", medidas, faltas);
  assert.deepEqual([h.medidas, h.verbal, h.escrita, h.suspensao, h.diasSuspensao, h.faltasAno, h.reincidente, h.ultima.data], [3, 1, 1, 1, 2, 2, true, "2026-08-01"]);
  assert.equal(MD.historicoTxt(h), "1 advertência verbal, 1 advertência escrita e 1 suspensão (2 dias)");
  assert.equal(MD.historicoTxt(MD.historicoDe(9, "X", medidas, faltas)), "Nenhuma medida no ano");
});

// ── rotas ───────────────────────────────────────────────────────────────────
function base() {
  const t = {
    fm_faltas: [
      { re: 521, data: "2026-10-20", codigo: "I", nome: "ANA PAULA", supervisor: "FRANK PIMENTEL" },
      { re: 600, data: "2026-10-21", codigo: "I", nome: "BIA", supervisor: "JEAN KLEBER" }
    ],
    fm_medidas: [], fm_dias: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [], dashboard_snapshots: []
  };
  supabaseFalso(t);
  return t;
}
const api = (t, o) => chamar(rh, { ...o, query: { modulo: "faltas", t, ...(o && o.query) } });
const corpo = extra => ({ tipo: "ADVERTENCIA_ESCRITA", inicio: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), motivo: "Faltou sem justificativa no dia 20/10/2026.", re: 521, nome: "ANA PAULA", empresa: "SERV CAMP TERCEIRIZAÇÃO", posto: "POSTO A", supervisor: "FRANK PIMENTEL", caso: "521|2026-10-20", faltas: ["2026-10-20"], situacoes: ["FALTA_INJUSTIFICADA"], ...extra });

test("gerar: o supervisor gera para a área dele e fica registrado em nome dele, com número", async () => {
  const t = base();
  const r = await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.medida.numero, r.body.medida.status, r.body.medida.geradaPor], [r.body.medida.numero, "PENDENTE", "frankpimentel"]);
  assert.match(r.body.medida.numero, /^MD-\d{4}-0001$/);
  const e = t.fm_auditoria.find(x => x.acao === MD.ACAO_GERADA);
  assert.deepEqual([e.ator, e.entidade, e.depois.re, e.depois.tipo, e.depois.grau, e.depois.empresa], ["frankpimentel", MD.ENTIDADE, "521", "ADVERTÊNCIA", "ESCRITA", "SERV CAMP TERCEIRIZAÇÃO"]);
});

test("gerar: outra área, quem não é gerador e colaborador sem falta no módulo são recusados", async () => {
  base();
  assert.equal((await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo({ re: 600, nome: "BIA", supervisor: "JEAN KLEBER" }) })).body.codigo, "OUTRA_AREA");
  assert.equal((await api("medida", { method: "POST", usuario: "sandraalves", body: corpo() })).statusCode, 403);
  assert.equal((await api("medida", { method: "POST", body: corpo() })).statusCode, 401, "sem login: o login barra antes");
  assert.equal((await api("medida", { method: "POST", usuario: "jussilenealmeida", body: corpo({ re: 999 }) })).body.codigo, "NAO_ENCONTRADA");
  assert.equal((await api("medida", { method: "POST", usuario: "jussilenealmeida", body: corpo({ re: 600, nome: "BIA", supervisor: "JEAN KLEBER" }) })).statusCode, 200, "coordenação gera para qualquer área");
});

test("gerar de novo para a mesma ocorrência pede confirmação; confirmada, sai com outro número", async () => {
  base();
  await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() });
  const r2 = await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo({ tipo: "SUSPENSAO", dias: 1 }) });
  assert.equal(r2.statusCode, 409);
  assert.equal(r2.body.codigo, "JA_GERADA");
  const r3 = await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo({ tipo: "SUSPENSAO", dias: 1, repetir: true }) });
  assert.equal(r3.statusCode, 200);
  assert.match(r3.body.medida.numero, /-0002$/);
});

test("lista: o supervisor vê só a área dele; a coordenação vê tudo, com o total pendente de cada um", async () => {
  base();
  await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() });
  await api("medida", { method: "POST", usuario: "jussilenealmeida", body: corpo({ re: 600, nome: "BIA", supervisor: "JEAN KLEBER", caso: "600|2026-10-21" }) });
  const frank = (await api("medidas_geradas", { usuario: "frankpimentel" })).body;
  assert.deepEqual([frank.geradas.length, frank.minhasPendentes, frank.coordenacao], [1, 1, false]);
  const jean = (await api("medidas_geradas", { usuario: "jeankleber" })).body;
  assert.deepEqual(jean.geradas.map(g => g.nome), ["BIA"], "a gerada pela coordenação na área do Jean aparece para ele");
  const coord = (await api("medidas_geradas", { usuario: "jussilenealmeida" })).body;
  assert.deepEqual([coord.geradas.length, coord.minhasPendentes, coord.coordenacao], [2, 1, true]);
  assert.equal((await api("medidas_geradas", { usuario: "sandraalves" })).statusCode, 403);
});

test("marcar lançada e cancelar: só quem gerou ou a coordenação; cancelar exige motivo", async () => {
  base();
  const g = (await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() })).body.medida;
  assert.equal((await api("medida_lancada", { method: "POST", usuario: "jeankleber", body: { chave: g.chave, lancado: true } })).statusCode, 403);
  const l = await api("medida_lancada", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, lancado: true } });
  assert.deepEqual([l.statusCode, l.body.medida.status, l.body.medida.manual], [200, "LANCADA", true]);
  assert.equal((await api("medida_cancelar", { method: "POST", usuario: "jussilenealmeida", body: { chave: g.chave, motivo: "" } })).body.codigo, "SEM_MOTIVO");
  const c = await api("medida_cancelar", { method: "POST", usuario: "jussilenealmeida", body: { chave: g.chave, motivo: "Gerada para a pessoa errada" } });
  assert.equal(c.body.medida.status, "CANCELADA");
  assert.equal((await api("medida_lancada", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, lancado: false } })).body.codigo, "CANCELADA");
  assert.equal((await api("medida_lancada", { method: "POST", usuario: "frankpimentel", body: { chave: "zz", lancado: true } })).body.codigo, "CHAVE_INVALIDA");
});

test("quando a planilha diária traz a medida, ela sai de pendente sozinha", async () => {
  const t = base();
  await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() });
  t.fm_medidas.push({ chave: "P-77", re: 521, data: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, fase: "CONCLUIDO", nome: "ANA PAULA" });
  const r = (await api("medidas_geradas", { usuario: "frankpimentel" })).body;
  assert.deepEqual([r.geradas[0].status, r.geradas[0].lancadaPor, r.minhasPendentes], ["LANCADA", "planilha", 0]);
});

// ── e-mail semanal: histórico do ano e o botão do painel ────────────────────
test("e-mail: tabela de reincidência no ano, selo de reincidente e botão para o painel", () => {
  const HTML = require("../api/_faltas_email_html");
  const h = { ...MD.historicoDe(1, "ANA", [{ re: 1, data: "2026-05-01", tipo: "ADVERTÊNCIA", grau: "ESCRITA" }, { re: 1, data: "2026-09-01", tipo: "SUSPENSÃO", dias: 2 }], [{ re: 1, data: "2026-05-01" }, { re: 1, data: "2026-10-20" }]) };
  h.txt = MD.historicoTxt(h);
  const linhas = [{ re: 1, nome: "ANA", posto: "P", cargo: "C", escala: "12X36", datas: ["2026-10-20"], hist: h }];
  const m = HTML.montar({ area: "FRANK PIMENTEL", inicio: "2026-10-19", fim: "2026-10-25", linhas, logo: "x", link: "https://painel.exemplo.com.br/?pg=faltassup" });
  assert.match(m.html, /Reincidência no ano/);
  assert.match(m.html, /REINCIDENTE/);
  assert.match(m.html, /Suspensão de 2 dias/);
  assert.match(m.html, /href="https:\/\/painel\.exemplo\.com\.br\/\?pg=faltassup"/);
  assert.match(m.texto, /No ano: 2 faltas injustificadas · 2 medidas \(1 advertência escrita e 1 suspensão \(2 dias\)\)/);
  const sem = HTML.montar({ area: "X", inicio: "2026-10-19", fim: "2026-10-25", linhas: linhas.map(l => ({ ...l, hist: null })), logo: "x", link: null });
  assert.doesNotMatch(sem.html, /Reincidência no ano|Abrir no Painel/, "sem histórico e sem endereço: o e-mail sai como antes");
});

test("e-mail: o endereço do painel é guardado ao abrir o painel do aviso (só https, nunca localhost)", async () => {
  const FE = require("../api/_faltas_email");
  const t = base();
  const ver = origem => chamar(rh, { usuario: FE.RESPONSAVEL, query: { modulo: "faltasemail", t: "painel", origem } });
  await ver("http://localhost:3001");
  await ver("https://evil.exemplo.com/caminho");
  assert.equal(t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_LINK").length, 0, "localhost e endereço com caminho não valem");
  await ver("https://painel.exemplo.com.br/");
  await ver("https://painel.exemplo.com.br");
  const l = t.fm_auditoria.filter(e => e.acao === "FALTAS_EMAIL_LINK");
  assert.deepEqual(l.map(e => e.depois.link), ["https://painel.exemplo.com.br"], "o mesmo endereço não é gravado de novo");
});

// ── documento assinado ──────────────────────────────────────────────────────
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
const JPG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const PDF = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 teste").toString("base64");

test("anexo: só foto JPG/PNG ou PDF de verdade, até 2,5 MB", () => {
  assert.equal(MD.validarAnexo(PNG).tipo, "image/png");
  assert.equal(MD.validarAnexo(JPG).tipo, "image/jpeg");
  assert.equal(MD.validarAnexo(PDF).tipo, "application/pdf");
  assert.equal(MD.validarAnexo("data:application/pdf;base64," + Buffer.from("nao sou pdf").toString("base64")).erro[1], "ARQUIVO_INVALIDO", "o nome do tipo não basta: confere os bytes");
  assert.equal(MD.validarAnexo("data:text/html;base64,PGI+").erro[1], "ARQUIVO_INVALIDO");
  assert.equal(MD.validarAnexo("data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MD.MAX_ANEXO)]).toString("base64")).erro[1], "ARQUIVO_GRANDE");
});

test("anexo: quem gerou, a coordenação ou o supervisor da área anexa; a lista mostra só os dados, o arquivo desce à parte", async () => {
  base();
  const g = (await api("medida", { method: "POST", usuario: "jussilenealmeida", body: corpo() })).body.medida;
  assert.equal(g.assinado, null);
  assert.equal((await api("medida_assinado", { method: "POST", usuario: "jeankleber", body: { chave: g.chave, arquivo: JPG } })).statusCode, 403, "outra área");
  assert.equal((await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, arquivo: "data:image/jpeg;base64,AAAA" } })).body.codigo, "ARQUIVO_INVALIDO");
  const a = await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, arquivo: JPG, nome: "foto.jpg" } });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
  assert.deepEqual([a.body.medida.assinado.por, a.body.medida.assinado.tipo, a.body.medida.assinado.nome], ["frankpimentel", "image/jpeg", "foto.jpg"]);
  const lista = (await api("medidas_geradas", { usuario: "frankpimentel" })).body;
  assert.ok(!JSON.stringify(lista).includes(JPG.split(",")[1]), "a lista não carrega o arquivo");
  const v = (await api("medida_assinado", { usuario: "jussilenealmeida", query: { chave: g.chave } })).body;
  assert.deepEqual([v.tipo, "data:" + v.tipo + ";base64," + v.base64, v.numero], ["image/jpeg", JPG, g.numero]);
  assert.equal((await api("medida_assinado", { usuario: "jeankleber", query: { chave: g.chave } })).statusCode, 404, "outra área não vê");
  // trocar e tirar
  await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, arquivo: PDF } });
  assert.equal((await api("medida_assinado", { usuario: "frankpimentel", query: { chave: g.chave } })).body.tipo, "application/pdf", "vale o último");
  const r = await api("medida_assinado", { method: "POST", usuario: "jussilenealmeida", body: { chave: g.chave, remover: true } });
  assert.equal(r.body.medida.assinado, null);
  assert.equal((await api("medida_assinado", { usuario: "frankpimentel", query: { chave: g.chave } })).body.codigo, "SEM_ANEXO");
});

// ── resumo semanal da coordenação ───────────────────────────────────────────
const FE = require("../api/_faltas_email");
const HTML = require("../api/_faltas_email_html");
process.env.FALTAS_MAIL_USER = "remetente@gruposervcamp.com.br";
process.env.FALTAS_MAIL_PASS = "senha-de-teste";
let enviados = [];
FE.definirCorreio(async m => { enviados.push(m); return { ok: true, id: "<x@teste>" }; });

test("resumo: pendentes no SAR2G da mais antiga para a mais nova, por supervisor, e o que está sem assinatura", () => {
  const g = (n, extra) => ({ chave: "c" + n, numero: "MD-2026-000" + n, re: String(n), nome: "PESSOA " + n, tipoId: "SUSPENSAO", tipo: "SUSPENSÃO", dias: 1, supervisor: "FRANK PIMENTEL", geradaPor: "frankpimentel", geradaEm: "2026-10-21T13:00:00Z", status: "PENDENTE", diasPendente: 5, assinado: null, ...extra });
  const m = HTML.montarResumo({
    semana: { inicio: "2026-10-19", fim: "2026-10-25" }, hoje: "2026-10-26", nomes: MD.NOMES, logo: "x", link: "https://painel.exemplo.com.br/?pg=faltassup&aba=MEDIDA", saudacao: "Jussilene",
    geradas: [
      g(1, { diasPendente: 1, geradaEm: "2026-10-25T13:00:00Z" }),
      g(2, { supervisor: "JEAN KLEBER", geradaPor: "jussilenealmeida", assinado: { por: "x" } }),
      g(3, { status: "LANCADA", lancadaPor: "planilha", lancadaEm: "2026-10-23", diasPendente: null, assinado: { por: "x" } }),
      g(4, { status: "CANCELADA" })
    ]
  });
  assert.deepEqual([m.pendentes, m.atrasadas, m.geradasSemana, m.lancadasSemana, m.semAssinatura], [2, 1, 3, 1, 1]);
  assert.match(m.assunto, /2 medidas faltam lançar no SAR2G/);
  assert.ok(m.html.indexOf("MD-2026-0002") < m.html.indexOf("MD-2026-0001"), "a mais antiga primeiro");
  assert.doesNotMatch(m.html, /MD-2026-0004/, "cancelada não entra");
  assert.match(m.html, /por Jussilene Almeida/);
  assert.match(m.html, /Olá, Jussilene\./);
  assert.match(m.html, /aba=MEDIDA/);
  const nada = HTML.montarResumo({ semana: { inicio: "2026-10-19", fim: "2026-10-25" }, hoje: "2026-10-26", geradas: [], logo: "x" });
  assert.match(nada.assunto, /nada pendente no SAR2G/);
  assert.match(nada.html, /Nada pendente no SAR2G/);
});

test("resumo: o painel cadastra quem recebe; ligado, sai com o aviso automático da segunda, uma vez por semana", async () => {
  const t = base();
  FE.definirRelogio(() => new Date("2026-10-26T17:10:00Z")); // segunda, 14h10 em São Paulo
  t.fm_auditoria.push({ id: 9000, ator: "raphaelvictor", acao: "FALTAS_EMAIL_AUTO", entidade: "fm_email", chave: "auto", depois: { ligado: true }, criado_em: "2026-10-01T12:00:00Z" });
  await api("medida", { method: "POST", usuario: "frankpimentel", body: corpo() });
  const painel = (t2, o) => chamar(rh, { usuario: FE.RESPONSAVEL, ...o, query: { modulo: "faltasemail", t: t2, ...(o && o.query) } });
  assert.equal((await painel("resumo", { method: "POST", body: { ligado: true } })).body.codigo, "SEM_DESTINO", "não liga sem ninguém para receber");
  assert.equal((await painel("resumo", { method: "POST", body: { para: [{ nome: "Jussilene", email: "não é e-mail" }] } })).body.codigo, "EMAIL_INVALIDO");
  assert.equal((await painel("resumo", { method: "POST", usuario: "frankpimentel", body: { ligado: true } })).statusCode, 403, "só a conta do responsável");
  await painel("resumo", { method: "POST", body: { para: [{ nome: "Jussilene Almeida", email: "coord@exemplo.com.br" }] } });
  // desligado: o automático não manda o resumo
  enviados = [];
  let r = await chamar(rh, { query: { modulo: "faltasemail", t: "cron" } });
  assert.equal(r.body.resumo, "DESLIGADO");
  assert.equal(enviados.filter(m => m.para.includes("coord@exemplo.com.br")).length, 0);
  await painel("resumo", { method: "POST", body: { ligado: true } });
  r = await chamar(rh, { query: { modulo: "faltasemail", t: "cron" } });
  assert.equal(r.body.resumo, "ENVIADO");
  const e = enviados.filter(m => m.para.includes("coord@exemplo.com.br"));
  assert.equal(e.length, 1);
  assert.match(e[0].assunto, /^Resumo semanal das medidas disciplinares — 1 medida falta lançar no SAR2G$/);
  assert.match(e[0].html, /Olá, Jussilene\./);
  // a rodada das 16h não manda de novo
  r = await chamar(rh, { query: { modulo: "faltasemail", t: "cron" } });
  assert.equal(r.body.resumo, "JA_ENVIADO");
  const p = (await painel("painel")).body;
  assert.deepEqual([p.resumo.ligado, p.resumo.enviado.qtd, p.resumo.para[0].email], [true, 1, "coord@exemplo.com.br"]);
  assert.equal((await painel("resumo_enviar", { method: "POST", body: { confirmar: true } })).body.situacao, "JA_ENVIADO");
  // prévia e teste não contam como envio oficial
  assert.match((await painel("previa_resumo")).body.html, /Falta lançar no SAR2G/);
  enviados = [];
  const tt = await painel("resumo_teste", { method: "POST", body: { para: ["@eu"] } });
  assert.deepEqual([tt.statusCode, enviados[0].para, /^\[TESTE\]/.test(enviados[0].assunto)], [200, ["remetente@gruposervcamp.com.br"], true]);
  FE.definirRelogio(null);
});

test("nomes de quem gera iguais aos do USERS do index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  Object.entries(MD.NOMES).forEach(([k, n]) => assert.match(html, new RegExp(`"${k}":\\{nome:"${n}"`), k));
  [...MD.COORDENACAO, ...MD.SUPERVISORES].forEach(k => assert.ok(MD.NOMES[k], "sem nome: " + k));
});

test("a tela recebe quem pode gerar (casos) e o encaixe fica fora do index.html", async () => {
  base();
  assert.deepEqual((await api("casos", { usuario: "frankpimentel" })).body.medida, { pode_gerar: true, coordenacao: false });
  assert.deepEqual((await api("casos", { usuario: "jussilenealmeida" })).body.medida, { pode_gerar: true, coordenacao: true });
  assert.deepEqual((await api("casos", { usuario: "sandraalves" })).body.medida, { pode_gerar: false, coordenacao: false });
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<script src="\/assets\/medida\/medida\.js"><\/script>/);
  const js = fs.readFileSync(path.join(__dirname, "..", "assets", "medida", "medida.js"), "utf8");
  new Function(js); // sintaxe
  // os tipos e situações da tela são os mesmos do servidor
  Object.keys(MD.TIPOS).forEach(k => assert.ok(js.includes(k + ":{"), "tipo " + k + " na tela"));
  Object.keys(MD.SITUACOES).forEach(k => assert.ok(js.includes(k + ":"), "situação " + k + " na tela"));
});
