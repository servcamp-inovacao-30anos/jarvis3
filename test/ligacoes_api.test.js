// Feedback de Faltas: servidor (api/ligacoes.js) contra o Supabase falso em memória.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ligacoes = require("../api/ligacoes");
const faltas = require("../api/_faltas");

const L = require("../api/_lig_regras");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => L.somaDias(hoje, n);
const tabelas = () => ({ lig_contatos: [], fm_faltas: [], fm_auditoria: [], fm_dias: [], dashboard_snapshots: [], app_users: [] });
const falta = (re, data, extra) => ({ re, data, codigo: "I", nome: "PESSOA " + re, posto: "POSTO A", supervisor: "FRANK PIMENTEL", tipo: "CONTRATO", ...extra });
const pedir = (t, usuario, opcoes) => { supabaseFalso(t); return chamar(ligacoes, { usuario, ...opcoes }); };
const codigos = t => t.fm_faltas.map(f => f.data + ":" + f.codigo);

test("sem login ou sem a permissão lig, nada é lido nem gravado", async () => {
  const t = tabelas(); supabaseFalso(t);
  assert.equal((await chamar(ligacoes, {})).statusCode, 401);
  for (const u of ["rafaelandrade", "testejoao", "frankpimentel"]) {
    const r = await chamar(ligacoes, { usuario: u });
    assert.equal(r.statusCode, 403, u);
    const w = await chamar(ligacoes, { usuario: u, method: "POST", body: { colaborador: "X" } });
    assert.equal(w.statusCode, 403, u);
  }
  assert.equal(t.lig_contatos.length, 0);
});

test("usuário criado pela tela com lig no perfil entra; bloqueado não", async () => {
  const t = tabelas();
  t.app_users.push({ user_key: "novo", perms: { lig: true }, ativo: true }, { user_key: "fora", perms: { lig: true }, ativo: false }, { user_key: "semlig", perms: { fm: true }, ativo: true });
  assert.equal((await pedir(t, "novo")).statusCode, 200);
  assert.equal((await pedir(t, "fora")).statusCode, 401, "bloqueado na Configuração: a sessão deixa de valer");
  assert.equal((await pedir(t, "semlig")).statusCode, 403);
});

test("contato: o servidor valida e quem registrou vem do token", async () => {
  const t = tabelas();
  const ruim = async corpo => (await pedir(t, "ingridycampana", { method: "POST", body: corpo })).statusCode;
  assert.equal(await ruim({}), 400, "sem colaborador");
  assert.equal(await ruim({ colaborador: "ANA", duracao_min: 999 }), 400);
  assert.equal(await ruim({ colaborador: "ANA", abono: "Z" }), 400);
  assert.equal(await ruim({ colaborador: "ANA", telefone: "');alert(1);//" }), 400, "telefone com código não passa");
  assert.equal(await ruim({ colaborador: "ANA", data_contato: "2026-13-40" }), 400);
  assert.equal(await ruim({ colaborador: "ANA", data_contato: dia(10) }), 400, "contato no futuro");
  assert.equal(await ruim({ colaborador: "ANA", canal: "SINAL DE FUMAÇA" }), 400);
  assert.equal(t.lig_contatos.length, 0);
  const r = await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "ANA", telefone: "(19) 99999-8888", motivo: "Saúde", criado_por: "FULANO FALSO", id: 999 } });
  assert.equal(r.statusCode, 200);
  assert.equal(t.lig_contatos[0].criado_por, "Ingridy Campana", "autoria vem do token, não da tela");
  assert.notEqual(t.lig_contatos[0].id, 999);
  assert.equal(t.lig_contatos[0].canal, "LIGAÇÃO");
});

test("só a coordenação dá a baixa: sem baixa a falta continua na cobrança", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3)), falta(521, dia(-2)));
  const r1 = await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true } });
  assert.equal(r1.statusCode, 403);
  assert.equal(t.lig_contatos.length, 0, "nem o contato é gravado quando o pedido é recusado");
  // registra o contato sem baixa: continua cobrando
  await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "PESSOA 521" } });
  assert.deepEqual(codigos(t), [dia(-3) + ":I", dia(-2) + ":I"]);
  const r2 = await pedir(t, "ingridycampana", { method: "POST", query: { acao: "baixa" }, body: { id: t.lig_contatos[0].id, re: 521 } });
  assert.equal(r2.statusCode, 403);
  assert.deepEqual(codigos(t), [dia(-3) + ":I", dia(-2) + ":I"]);
});

test("baixa da coordenação: faltas da janela viram T, as de fora não, e sobrevivem à planilha; desfazer devolve", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3)), falta(521, dia(-60)), falta(522, dia(-3)));
  const r = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true, data_contato: dia(-1) } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.baixa.ok, true);
  const porDia = Object.fromEntries(t.fm_faltas.map(f => [f.re + "@" + f.data, f.codigo]));
  assert.equal(porDia["521@" + dia(-3)], "T", "falta que originou o feedback sai da cobrança");
  assert.equal(porDia["521@" + dia(-60)], "I", "falta muito antiga da janela fica como estava");
  assert.equal(porDia["522@" + dia(-3)], "I", "outra pessoa não é atingida");
  // falta nova depois do feedback, dentro dos 30 dias: chega pela planilha e também não gera alarme
  const planilha = { faltas: [{ RE: 521, NOME: "PESSOA 521", DATA: dia(-3), ABONO: "I", CARGO: "X", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }, { RE: 521, NOME: "PESSOA 521", DATA: hoje, ABONO: "I", CARGO: "X", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }, { RE: 522, NOME: "PESSOA 522", DATA: dia(-3), ABONO: "I", CARGO: "X", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO" }], fichaDias: {} };
  await faltas.materializar(planilha);
  const depois = Object.fromEntries(t.fm_faltas.map(f => [f.re + "@" + f.data, f.codigo]));
  assert.equal(depois["521@" + dia(-3)], "T", "a planilha seguinte não desfaz a baixa");
  assert.equal(depois["521@" + hoje], "T", "falta dentro dos 30 dias do feedback vai para o acompanhamento");
  assert.equal(depois["522@" + dia(-3)], "I");
  // desfazer: tudo volta à cobrança
  const id = t.lig_contatos[0].id;
  const d = await pedir(t, "raphaelvictor", { method: "POST", query: { acao: "baixa" }, body: { id, baixar: false } });
  assert.equal(d.statusCode, 200);
  const volta = Object.fromEntries(t.fm_faltas.map(f => [f.re + "@" + f.data, f.codigo]));
  assert.equal(volta["521@" + dia(-3)], "I");
  assert.equal(volta["521@" + hoje], "I");
});

test("a falta já abonada ou de demitido não vira T: atestado vale mais", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3), { codigo: "A" }), falta(521, dia(-2)));
  await pedir(t, "jussilenealmeida", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true } });
  const porDia = Object.fromEntries(t.fm_faltas.map(f => [f.data, f.codigo]));
  assert.equal(porDia[dia(-3)], "A");
  assert.equal(porDia[dia(-2)], "T");
});

test("baixa sem RE conhecido não inventa: contato é gravado e o motivo volta", async () => {
  const t = tabelas();
  const r = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "NOME SEM FALTA", baixar: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.baixa.ok, false);
  assert.match(r.body.baixa.motivo, /RE/);
  assert.equal(t.lig_contatos.length, 1);
  // RE de outra pessoa é recusado
  t.fm_faltas.push(falta(521, dia(-3)));
  const r2 = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "MARIA OUTRA", re: 521, baixar: true } });
  assert.equal(r2.body.baixa.ok, false);
  assert.equal(t.fm_faltas[0].codigo, "I");
});

test("excluir: só coordenação, o contato fica no registro e a baixa é desfeita", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3)));
  await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true, justificativa: "atestado" } });
  const id = t.lig_contatos[0].id;
  assert.equal((await pedir(t, "ingridycampana", { method: "DELETE", query: { id } })).statusCode, 403);
  assert.equal(t.lig_contatos.length, 1);
  assert.equal((await pedir(t, "raphaelvictor", { method: "DELETE", query: { id: "1 or 1=1" } })).statusCode, 400);
  assert.equal((await pedir(t, "raphaelvictor", { method: "DELETE", query: { id } })).statusCode, 200);
  assert.equal(t.lig_contatos.length, 0);
  const ev = t.fm_auditoria.find(e => e.acao === L.ACAO_EXCLUIDO);
  assert.equal(ev.antes.justificativa, "atestado", "o contato inteiro fica no registro");
  assert.equal(ev.ator, "raphaelvictor");
  assert.equal(t.fm_faltas[0].codigo, "I", "sem o contato, a falta volta à cobrança");
});

test("editar guarda o antes e o depois; mudar a data do contato move a janela", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3)), falta(521, dia(-50)));
  await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true, data_contato: dia(-1) } });
  const id = t.lig_contatos[0].id;
  assert.equal((await pedir(t, "ingridycampana", { method: "PATCH", body: { id, motivo: "Saúde" } })).statusCode, 200);
  const ev = t.fm_auditoria.find(e => e.acao === L.ACAO_EDITADO);
  assert.deepEqual([ev.antes.motivo == null ? null : ev.antes.motivo, ev.depois.motivo], [null, "Saúde"]);
  assert.equal((await pedir(t, "ingridycampana", { method: "PATCH", body: { id, baixar: false } })).statusCode, 403);
  // contato passa para 40 dias atrás: a falta de 50 dias atrás entra na janela, a de 3 dias atrás sai
  await pedir(t, "raphaelvictor", { method: "PATCH", body: { id, data_contato: dia(-40) } });
  const porDia = Object.fromEntries(t.fm_faltas.map(f => [f.data, f.codigo]));
  assert.equal(porDia[dia(-50)], "T");
  assert.equal(porDia[dia(-3)], "I");
});

test("prazo do acordo: cumprido por qualquer um, descumprido só pela coordenação e reabre a cobrança", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3)));
  await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, baixar: true, acordo: "traz o atestado", acordo_prazo: dia(2) } });
  const id = t.lig_contatos[0].id;
  const lista = await pedir(t, "ingridycampana");
  assert.equal(lista.body.rows[0].acordo_prazo, dia(2));
  assert.equal(lista.body.rows[0].acordo_status, "aberto");
  assert.equal(lista.body.rows[0].baixa.por, "Raphael Victor");
  assert.equal((await pedir(t, "ingridycampana", { method: "POST", query: { acao: "acordo" }, body: { id, status: "descumprido" } })).statusCode, 403);
  assert.equal(t.fm_faltas[0].codigo, "T");
  const r = await pedir(t, "jussilenealmeida", { method: "POST", query: { acao: "acordo" }, body: { id, status: "descumprido" } });
  assert.equal(r.statusCode, 200);
  assert.equal(t.fm_faltas[0].codigo, "I", "não cumpriu: a falta volta à cobrança");
  assert.equal((await pedir(t, "ingridycampana")).body.rows[0].acordo_status, "descumprido");
});

test("a lista traz o código da apuração das faltas que não são injustificadas", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-3), { codigo: "J" }), falta(522, dia(-3), { codigo: "D" }), falta(523, dia(-3)));
  const r = await pedir(t, "ingridycampana");
  assert.deepEqual(r.body.codigos, { ["521|PESSOA|" + dia(-3)]: "J", ["522|PESSOA|" + dia(-3)]: "D" });
  assert.equal(r.body.pode_baixar, false);
  assert.equal((await pedir(t, "raphaelvictor")).body.pode_baixar, true);
});

test("pasta Sem posicionamento: 2+ faltas injustificadas e nenhum contato", async () => {
  const t = tabelas();
  t.fm_faltas.push(
    falta(521, dia(-5)), falta(521, dia(-2)),                       // 2 faltas, sem contato → entra
    falta(522, dia(-5)),                                             // só 1 → não
    falta(523, dia(-5)), falta(523, dia(-2)),                        // 2 faltas mas com contato → não
    falta(524, dia(-5), { codigo: "T" }), falta(524, dia(-2), { codigo: "T" }), // tratadas → não
    falta(525, dia(-5), { tipo: "HISTORICO" }), falta(525, dia(-2), { tipo: "HISTORICO" }) // só histórico → não
  );
  t.lig_contatos.push({ id: 1, colaborador: "Pessoa 523", data_contato: dia(-4) });
  t.fm_auditoria.push({ id: 1, ator: "raphaelvictor", acao: L.ACAO_ZAP_ENVIO, entidade: L.ENTIDADE, chave: "521|PESSOA", depois: { ok: true }, criado_em: new Date().toISOString() });
  const r = await pedir(t, "raphaelvictor", { query: { acao: "sem_retorno" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.pessoas.map(p => [p.re, p.datas.length, p.tentativas]), [["521", 2, 1]]);
});

// ── WhatsApp do SAC ─────────────────────────────────────────────────────────
const FOTO = { base64: "A".repeat(200), mimetype: "image/jpeg", nome: "atestado.jpg" };

// O Baileys roda no PC do SAC e a tela fala com ele direto; a API só confere se pode enviar e registra o resultado.
test("WhatsApp: autorização valida, limita por pessoa e não guarda o texto; o resultado é registrado", async () => {
  const t = tabelas(); t.fm_faltas.push(falta(521, dia(-1)));
  const aut = (corpo, u) => pedir(t, u || "ingridycampana", { method: "POST", query: { acao: "zap_autorizar" }, body: { colaborador: "PESSOA 521", re: 521, telefone: "(19) 99999-8888", ...corpo } });
  const reg = (corpo) => pedir(t, "ingridycampana", { method: "POST", query: { acao: "zap_registrar" }, body: corpo });
  assert.equal((await aut({ texto: "" })).statusCode, 400);
  assert.equal((await aut({ texto: "oi", telefone: "1933334444" })).statusCode, 422, "fixo não recebe");
  assert.equal((await aut({ texto: "x".repeat(1001) })).statusCode, 400);
  assert.equal((await aut({ texto: "oi", imagem: { ...FOTO, mimetype: "application/pdf" } })).statusCode, 400);
  assert.equal((await aut({ texto: "oi", imagem: { ...FOTO, base64: "A".repeat(3500000) } })).statusCode, 413);
  assert.equal((await aut({ texto: "oi", imagem: { ...FOTO, base64: "<script>".repeat(30) } })).statusCode, 400);
  const ok = await aut({ texto: "Olá, Pessoa!", imagem: FOTO });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([ok.body.numero, ok.body.chave, ok.body.final, ok.body.comFoto], ["5519999998888", "521|PESSOA", "8888", true]);
  assert.equal(t.fm_auditoria.filter(e => e.acao === L.ACAO_ZAP_ENVIO).length, 0, "autorizar não registra envio");
  assert.equal((await reg({ chave: "<x>", ok: true })).statusCode, 400, "registro inválido");
  assert.equal((await reg({ chave: ok.body.chave, ok: true, comFoto: true, tamanho: 12, final: "8888", contato_id: 7 })).statusCode, 200);
  const ev = t.fm_auditoria.find(e => e.acao === L.ACAO_ZAP_ENVIO);
  assert.equal(ev.chave, "521|PESSOA");
  assert.deepEqual([ev.depois.ok, ev.depois.comFoto, ev.depois.final, ev.depois.contato], [true, true, "8888", 7]);
  assert.equal(JSON.stringify(ev).includes("Olá, Pessoa"), false, "o texto da mensagem não fica no registro");
  // intervalo mínimo por pessoa
  assert.equal((await aut({ texto: "outra" })).statusCode, 429);
  // e o limite do dia (envios antigos o bastante para passar do intervalo)
  t.fm_auditoria.forEach(e => { if (e.acao === L.ACAO_ZAP_ENVIO) e.criado_em = new Date(Date.now() - 3600000).toISOString().replace(/^.{10}/, hoje); });
  t.fm_auditoria.push({ id: 90, ator: "x", acao: L.ACAO_ZAP_ENVIO, entidade: L.ENTIDADE, chave: "521|PESSOA", depois: { ok: true }, criado_em: hoje + "T05:00:00.000Z" }, { id: 91, ator: "x", acao: L.ACAO_ZAP_ENVIO, entidade: L.ENTIDADE, chave: "521|PESSOA", depois: { ok: true }, criado_em: hoje + "T06:00:00.000Z" });
  const lim = await aut({ texto: "mais uma" });
  assert.equal(lim.statusCode, 429);
  assert.match(lim.body.error, /3 mensagens/);
});

test("WhatsApp: falha registrada não conta como envio", async () => {
  const t = tabelas();
  const r = await pedir(t, "ingridycampana", { method: "POST", query: { acao: "zap_registrar" }, body: { chave: "9|ANA", ok: false, motivo: "WhatsApp desconectado" } });
  assert.equal(r.statusCode, 200);
  const ev = t.fm_auditoria.find(e => e.acao === L.ACAO_ZAP_ENVIO);
  assert.equal(ev.depois.ok, false); assert.match(ev.depois.motivo, /desconectado/);
});

test("WhatsApp: mensagem padrão editável só pela coordenação", async () => {
  const t = tabelas();
  const padrao = await pedir(t, "ingridycampana", { query: { acao: "zap_modelo" } });
  assert.equal(padrao.body.texto, L.MODELO_PADRAO);
  assert.equal(padrao.body.pode_editar, false);
  assert.equal((await pedir(t, "ingridycampana", { method: "POST", query: { acao: "zap_modelo" }, body: { texto: "Novo texto de teste" } })).statusCode, 403);
  assert.equal((await pedir(t, "raphaelvictor", { method: "POST", query: { acao: "zap_modelo" }, body: { texto: "curto" } })).statusCode, 400);
  assert.equal((await pedir(t, "raphaelvictor", { method: "POST", query: { acao: "zap_modelo" }, body: { texto: "Olá, {nome}! Texto novo do SAC." } })).statusCode, 200);
  const novo = await pedir(t, "ingridycampana", { query: { acao: "zap_modelo" } });
  assert.equal(novo.body.texto, "Olá, {nome}! Texto novo do SAC.");
  assert.equal(novo.body.padrao, false);
});

test("a lista de quem tem lig no servidor é a mesma do index.html", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  const bloco = html.slice(html.indexOf("const USERS={"), html.indexOf("};", html.indexOf("const USERS={")));
  const comLig = [...bloco.matchAll(/"([a-z0-9]+)":\{[^}]*\blig:true[^}]*\}/g)].map(m => m[1]).sort();
  const admins = [...bloco.matchAll(/"([a-z0-9]+)":\{[^}]*admin:true[^}]*\}/g)].map(m => m[1]);
  assert.deepEqual([...L.USUARIOS].filter(u => !admins.includes(u)).sort(), comLig, "lista fixa do servidor e USERS do index.html");
  admins.forEach(a => assert.ok(L.USUARIOS.has(a), "admin " + a + " usa o módulo"));
});

// ── resultado do contato: tentativa x conversa, próxima ação e atividades ───
test("tentativa sem conversa: fica registrada com a próxima ação, mas não tira da cobrança nem da pasta", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(521, dia(-5)), falta(521, dia(-2)));
  const ruim = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, resultado: "NAO_ATENDEU", baixar: true } });
  assert.equal(ruim.statusCode, 422, "não dá para retirar da cobrança sem conversar");
  assert.equal(t.lig_contatos.length, 0, "e nada é gravado quando o pedido é recusado");
  const r = await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, resultado: "NAO_ATENDEU", canal: "LIGAÇÃO" } });
  assert.equal(r.statusCode, 200);
  const lista = (await pedir(t, "ingridycampana")).body;
  assert.deepEqual([lista.rows[0].resultado, lista.rows[0].proxima, lista.rows[0].retorno, lista.rows[0].atividade], ["NAO_ATENDEU", "RETORNAR", dia(1), "aberta"], "sugere ligar de novo amanhã");
  assert.ok(lista.resultados.NAO_ATENDEU && lista.proximas.RETORNAR, "a tela recebe a lista de resultados do servidor");
  assert.deepEqual(t.fm_faltas.map(f => f.codigo), ["I", "I"]);
  const sem = await pedir(t, "raphaelvictor", { query: { acao: "sem_retorno" } });
  assert.deepEqual(sem.body.pessoas.map(p => [p.re, p.tentativas]), [["521", 1]], "segue sem posicionamento, com a tentativa contada");
  const b = await pedir(t, "raphaelvictor", { method: "POST", query: { acao: "baixa" }, body: { id: t.lig_contatos[0].id, re: 521 } });
  assert.equal(b.statusCode, 422);
  // a conversa resolve: sai da pasta e pode sair da cobrança
  const c = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 521", re: 521, resultado: "EXPLICOU", motivo: "Saúde", baixar: true } });
  assert.equal(c.statusCode, 200);
  assert.deepEqual(t.fm_faltas.map(f => f.codigo), ["T", "T"]);
  assert.deepEqual((await pedir(t, "raphaelvictor", { query: { acao: "sem_retorno" } })).body.pessoas, []);
});

test("resultado e próxima ação: valida lista, data e prazo máximo; contato antigo sem resultado continua valendo como conversa", async () => {
  const t = tabelas();
  const st = async b => (await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "ANA", ...b } })).statusCode;
  assert.equal(await st({ resultado: "INVENTADO" }), 400);
  assert.equal(await st({ resultado: "NAO_ATENDEU", proxima: "VOAR" }), 400);
  assert.equal(await st({ resultado: "NAO_ATENDEU", retorno: dia(-1) }), 400, "retorno no passado");
  assert.equal(await st({ resultado: "NAO_ATENDEU", retorno: dia(120) }), 400, "mais de 90 dias");
  assert.equal(await st({ resultado: "VAI_ENTREGAR", retorno: dia(3) }), 200);
  assert.equal(t.fm_auditoria.filter(e => e.acao === L.ACAO_RESULTADO)[0].depois.proxima, "COBRAR", "vai entregar: sugere cobrar o documento");
  assert.equal(await st({ resultado: "EXPLICOU", proxima: "ENCERRAR", retorno: dia(3) }), 200);
  assert.equal(t.fm_auditoria.filter(e => e.acao === L.ACAO_RESULTADO)[1].depois.retorno, null, "ação sem data não guarda data");
  assert.equal(L.efetivo(null), true, "contato antigo, sem resultado, é conversa");
  assert.equal(L.efetivo("CAIXA_POSTAL"), false);
});

test("atividade: reagendar, concluir e cancelar ficam registrados; sem próxima ação não há o que fazer", async () => {
  const t = tabelas();
  await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "ANA", resultado: "PEDIU_RETORNO" } });
  await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "BIA" } });
  const [a, b] = t.lig_contatos.map(c => c.id);
  const op = (body, u) => pedir(t, u || "ingridycampana", { method: "POST", query: { acao: "atividade" }, body });
  assert.equal((await op({ id: a, op: "reagendar", data: dia(-1) })).statusCode, 400);
  assert.equal((await op({ id: a, op: "pular" })).statusCode, 400);
  assert.equal((await op({ id: b, op: "concluir" })).statusCode, 404, "contato sem próxima ação");
  assert.equal((await op({ id: a, op: "reagendar", data: dia(5) })).statusCode, 200);
  let row = (await pedir(t, "ingridycampana")).body.rows.find(r => r.id === a);
  assert.deepEqual([row.retorno, row.atividade], [dia(5), "aberta"]);
  assert.equal((await op({ id: a, op: "concluir" })).statusCode, 200);
  row = (await pedir(t, "ingridycampana")).body.rows.find(r => r.id === a);
  assert.equal(row.atividade, "concluida");
  assert.equal((await op({ id: a, op: "cancelar" })).statusCode, 200);
  assert.equal((await pedir(t, "ingridycampana")).body.rows.find(r => r.id === a).atividade, "cancelada");
  assert.equal(t.fm_auditoria.filter(e => e.acao === L.ACAO_ATIVIDADE).length, 3, "cada passo fica no registro");
  assert.equal((await op({ id: a, op: "concluir" }, "rafaelandrade")).statusCode, 403, "quem não tem lig não mexe");
});

// ── painel: cada pessoa em uma situação (modelo receptivo) ───────────────────
const painel = (t, usuario) => pedir(t, usuario || "ingridycampana", { query: { acao: "painel" } });
const pessoaDe = (r, nome) => r.body.pessoas.find(p => p.nome === nome);

test("painel: sem permissão não lê; método errado é recusado", async () => {
  const t = tabelas();
  assert.equal((await painel(t, "rafaelandrade")).statusCode, 403);
  supabaseFalso(t);
  assert.equal((await chamar(ligacoes, { usuario: "ingridycampana", method: "POST", query: { acao: "painel" } })).statusCode, 405);
});

test("painel: faltou sem justificar vira Mandar mensagem; telefone vem do cadastro (pt_contatos) pelo RE", async () => {
  const t = tabelas();
  t.pt_contatos = [{ re: 1, telefone_e164: "+5519999998888", enviavel: true }, { re: 2, telefone_e164: "+551933334444", enviavel: false }];
  t.fm_faltas.push(falta(1, dia(-1)), falta(2, dia(-1)), falta(3, dia(-1)));
  const r = await painel(t);
  assert.equal(r.statusCode, 200);
  assert.equal(pessoaDe(r, "PESSOA 1").situacao, "mensagem");
  assert.equal(pessoaDe(r, "PESSOA 1").telefone, "5519999998888");
  assert.equal(pessoaDe(r, "PESSOA 2").telefone, "", "fixo ou não enviável não vira celular");
  assert.equal(pessoaDe(r, "PESSOA 3").telefone, "", "sem cadastro de telefone");
  assert.equal(r.body.resumo.mensagem, 3);
  assert.equal(r.body.prazo_resposta_dias, 1);
});

test("painel: mensagem enviada pelo WhatsApp muda a situação; duas sem resposta levam à base", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-8)), falta(1, dia(-4)), falta(2, dia(-1)));
  const envio = (chave, d) => t.fm_auditoria.push({ id: t.fm_auditoria.length + 1, ator: "ingridycampana", acao: L.ACAO_ZAP_ENVIO, entidade: L.ENTIDADE, chave, antes: null, depois: { ok: true }, criado_em: dia(d) + "T15:00:00Z" });
  envio("2|PESSOA", 0);
  let r = await painel(t);
  assert.equal(pessoaDe(r, "PESSOA 2").situacao, "aguardando");
  assert.equal(pessoaDe(r, "PESSOA 2").envio, "prazo");
  assert.equal(pessoaDe(r, "PESSOA 1").situacao, "mensagem");
  envio("1|PESSOA", -7); envio("1|PESSOA", -3);
  t.fm_auditoria.push({ id: 99, ator: "ingridycampana", acao: L.ACAO_ZAP_ENVIO, entidade: L.ENTIDADE, chave: "1|PESSOA", antes: null, depois: { ok: false, motivo: "WhatsApp desconectado" }, criado_em: dia(-1) + "T15:00:00Z" });
  r = await painel(t);
  assert.equal(pessoaDe(r, "PESSOA 1").situacao, "base");
  assert.equal(pessoaDe(r, "PESSOA 1").tentativas, 2, "o envio que falhou não conta como mensagem");
  assert.equal(r.body.resumo.base, 1);
});

test("painel: 'Não consegui falar' (duas escolhas da tela) conta como tentativa e não retira da cobrança", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-3)));
  const reg = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 1", re: 1, canal: "WHATSAPP", data_contato: dia(-2), justificativa: "caixa postal", resultado: "SEM_RESPOSTA", proxima: "NENHUMA", baixar: true } });
  assert.equal(reg.statusCode, 422, "tentativa não permite retirar da cobrança");
  const ok = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 1", re: 1, canal: "WHATSAPP", data_contato: dia(-2), justificativa: "caixa postal", resultado: "SEM_RESPOSTA", proxima: "NENHUMA" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(t.fm_auditoria.filter(e => e.acao === L.ACAO_RESULTADO)[0].depois.proxima, null, "NENHUMA: sem atividade nem prazo");
  const p = pessoaDe(await painel(t), "PESSOA 1");
  assert.equal(p.situacao, "aguardando");
  assert.equal(p.tentativas, 1);
  assert.equal(p.ultima_marca_manual, true);
  assert.equal(t.fm_faltas[0].codigo, "I", "a falta continua na cobrança");
});

test("painel: 'Falei com a pessoa' e a baixa levam ao acompanhamento com antes x depois", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-12)), falta(1, dia(-6)), falta(1, dia(-2)));
  const reg = await pedir(t, "raphaelvictor", { method: "POST", body: { colaborador: "PESSOA 1", re: 1, canal: "LIGAÇÃO", data_contato: dia(-4), justificativa: "Estava doente", motivo: "Saúde", baixar: true } });
  assert.equal(reg.statusCode, 200);
  const r = await painel(t);
  const p = pessoaDe(r, "PESSOA 1");
  assert.equal(p.situacao, "acomp");
  assert.equal(p.acomp.antes, 2, "as duas faltas até o dia do contato (a baixa as trata)");
  assert.equal(p.acomp.depois, 1);
  assert.equal(p.acomp.veredito, "melhorando");
  assert.equal(p.contato.por, "Raphael Victor");
  assert.ok(p.contato.baixa, "mostra quem deu a baixa");
  assert.equal(p.acomp.sem_baixa, false);
  assert.ok(p.hist.length === 3 && p.hist.every(h => Array.isArray(h)));
});

test("painel: acordo com prazo é conferido sozinho quando a falta vira abonada", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-5)));
  await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "PESSOA 1", re: 1, data_contato: dia(-3), data_falta: dia(-5), justificativa: "Vai trazer atestado", acordo: "Atestado até depois de amanhã", acordo_prazo: dia(2) } });
  let p = pessoaDe(await painel(t), "PESSOA 1");
  assert.equal(p.contato.acordo_auto, "pendente");
  t.fm_faltas[0].codigo = "A"; // a planilha subiu com o atestado
  p = pessoaDe(await painel(t), "PESSOA 1");
  assert.equal(p.contato.acordo_auto, "cumpriu");
  t.fm_faltas[0].codigo = "I";
  assert.equal((await pedir(t, "ingridycampana", { method: "PATCH", body: { id: t.lig_contatos[0].id, acordo_prazo: dia(-1) } })).statusCode, 200);
  assert.equal(pessoaDe(await painel(t), "PESSOA 1").contato.acordo_auto, "nao_cumpriu", "passou o prazo e a falta segue sem justificativa");
});
