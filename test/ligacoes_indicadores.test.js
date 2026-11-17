// Feedback de Faltas: números do topo e da aba Desempenho, motivos criados pelo SAC e histórico de qualquer colaborador.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ligacoes = require("../api/ligacoes");
const IND = require("../api/_lig_indicadores");
const P = require("../api/_lig_painel");
const L = require("../api/_lig_regras");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => L.somaDias(hoje, n);
const tabelas = () => ({ lig_contatos: [], fm_faltas: [], fm_auditoria: [], fm_dias: [], dashboard_snapshots: [], app_users: [], pt_contatos: [] });
const falta = (re, data, codigo, extra) => ({ re, data, codigo: codigo || "I", nome: "PESSOA " + re, posto: "POSTO A", supervisor: "FRANK PIMENTEL", tipo: "CONTRATO", ...extra });
const pedir = (t, usuario, opcoes) => { supabaseFalso(t); return chamar(ligacoes, { usuario, ...opcoes }); };
const ev = (id, chave, depois) => ({ id, acao: IND.ACAO_MOTIVO, chave, depois, ator: "ingridycampana", criado_em: hoje + "T12:00:00Z" });

test("motivos: os padrões, os criados pelo SAC, renomeados e desativados", () => {
  const base = IND.motivosAtuais([]);
  assert.deepEqual(base.map(m => m.nome), L.MOTIVOS);
  const l = IND.motivosAtuais([ev(1, "ESCALA TROCADA", { nome: "Escala trocada", ativo: true }), ev(2, "SAUDE", { nome: "Saúde (atestado)", ativo: true }), ev(3, "OUTRO", { nome: "Outro", ativo: false })]);
  const esc = l.find(m => m.chave === "ESCALA TROCADA");
  assert.equal(esc.nome, "Escala trocada"); assert.equal(esc.padrao, false);
  const sau = l.find(m => m.chave === "SAUDE");
  assert.equal(sau.nome, "Saúde (atestado)"); assert.deepEqual(sau.antigos, ["Saúde"]);
  assert.equal(l.find(m => m.chave === "OUTRO").ativo, false);
  assert.equal(IND.nomeAtual(l, "Saúde"), "Saúde (atestado)", "contato antigo conta no motivo renomeado");
  const aceitos = IND.motivosAceitos(l);
  assert.ok(aceitos.includes("Saúde") && aceitos.includes("Saúde (atestado)") && aceitos.includes("Escala trocada") && aceitos.includes("Outro"));
  assert.equal(IND.validarNovoMotivo("escala   trocada", l).ok, false, "não duplica, nem com caixa ou espaço diferente");
  assert.equal(IND.validarNovoMotivo("saude", l).ok, false, "nem com o nome antigo");
  assert.equal(IND.validarNovoMotivo("ab", l).ok, false);
  assert.deepEqual(IND.validarNovoMotivo(" Ônibus quebrado ", l), { ok: true, nome: "Ônibus quebrado", chave: "ONIBUS QUEBRADO" });
});

test("indicadores: faltas por dia e supervisor, quem teve feedback e as conversas", () => {
  const motivos = IND.motivosAtuais([ev(1, "SAUDE", { nome: "Saúde (atestado)", ativo: true })]);
  const r = IND.montarIndicadores({
    hoje, motivos, turnoDe: s => (/^PAULO/.test(s) ? "NOTURNO" : "DIURNO"),
    faltas: [falta(1, dia(-1)), falta(1, dia(-1), "T", { re: 2, nome: "PESSOA 2" }), falta(3, dia(-1), "A"), falta(4, dia(-1), "D"), falta(5, dia(-2), "AF", { supervisor: "PAULO SOUZA" }), falta(1, dia(3))],
    contatos: [{ id: 1, colaborador: "PESSOA 1", data_contato: dia(-1), motivo: "Saúde", duracao_min: 12, efetivo: true, supervisor: "FRANK PIMENTEL" },
      { id: 2, colaborador: "PESSOA 3", data_contato: dia(-1), motivo: null, duracao_min: null, efetivo: true },
      { id: 3, colaborador: "PESSOA 2", data_contato: dia(-1), motivo: "Outro", efetivo: false }]
  });
  assert.deepEqual(r.dias, [[dia(-2), "PAULO SOUZA", 0, 1], [dia(-1), "FRANK PIMENTEL", 2, 1]], "D não é falta; futuro não entra; T conta como sem justificativa");
  assert.deepEqual(r.turnos, { "FRANK PIMENTEL": "DIURNO", "PAULO SOUZA": "NOTURNO" });
  assert.equal(r.pessoas.length, 5, "todas as pessoas da planilha para a busca do histórico");
  assert.equal(r.com_feedback, undefined, "trocado por avaliacoes");
  assert.deepEqual(r.avaliacoes.map(x => x.nome), ["PESSOA 1", "PESSOA 3"], "tentativa não é feedback");
  assert.deepEqual(r.avaliacoes[0], { i: 0, nome: "PESSOA 1", re: "1", sup: "FRANK PIMENTEL", d: dia(-1), antes: 1, depois: 0, dias: 1, veredito: "comecando",
    faltas_antes: [dia(-1)], faltas_depois: [], desligado: false }, "a falta do dia do feedback conta como antes; a futura não entra");
  assert.equal(r.avaliacoes[1].antes, 0, "abonada não pesa no antes x depois");
  assert.deepEqual(r.conversas, [[dia(-1), "Saúde (atestado)", 12, "FRANK PIMENTEL", "", 1], [dia(-1), "Sem motivo", null, "FRANK PIMENTEL", "", 2]], "sem supervisor no contato: vale o da pessoa; o id liga o card ao detalhe");
});

test("rota de indicadores: qualquer pessoa do SAC lê", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-3)), falta(2, dia(-2), "J"));
  t.lig_contatos.push({ id: 1, colaborador: "PESSOA 1", data_contato: dia(-1), criado_em: dia(-1) + "T10:00:00Z", motivo: "Saúde", duracao_min: 9, supervisor: "FRANK PIMENTEL" });
  const r = await pedir(t, "ingridycampana", { query: { acao: "indicadores" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dias.length, 2);
  assert.deepEqual(r.body.conversas, [[dia(-1), "Saúde", 9, "FRANK PIMENTEL", "", 1]]);
  t.fm_faltas.push(falta(3, dia(-4), "I", { tipo: "RESERVA", posto: "POSTO A" }));
  const rr = await pedir(t, "ingridycampana", { query: { acao: "indicadores" } });
  assert.equal(rr.body.funil.faltas.find(x => x[0] === dia(-4))[4], "R", "a rota lê o tipo: reserva com posto preenchido continua reserva");
  assert.equal((await pedir(t, "frankpimentel", { query: { acao: "indicadores" } })).statusCode, 403);
});

test("motivo novo: qualquer pessoa do SAC cria e usa no registro; renomear e desativar é da coordenação", async () => {
  const t = tabelas();
  assert.equal((await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "ANA", motivo: "Escala trocada" } })).statusCode, 400, "motivo que não existe não passa");
  const c = await pedir(t, "ingridycampana", { method: "POST", query: { acao: "motivo" }, body: { nome: "Escala trocada" } });
  assert.equal(c.statusCode, 200);
  assert.equal((await pedir(t, "joyce", { method: "POST", query: { acao: "motivo" }, body: { nome: "escala trocada" } })).statusCode, 400, "não duplica");
  const ok = await pedir(t, "ingridycampana", { method: "POST", body: { colaborador: "ANA", motivo: "Escala trocada", duracao_min: 7 } });
  assert.equal(ok.statusCode, 200);
  assert.equal(t.lig_contatos[0].motivo, "Escala trocada"); assert.equal(t.lig_contatos[0].duracao_min, 7);
  assert.equal((await pedir(t, "ingridycampana", { method: "POST", query: { acao: "motivo" }, body: { chave: "ESCALA TROCADA", ativo: false } })).statusCode, 403);
  const ed = await pedir(t, "raphaelvictor", { method: "POST", query: { acao: "motivo" }, body: { chave: "ESCALA TROCADA", nome: "Troca de escala", ativo: false } });
  assert.equal(ed.statusCode, 200);
  const l = (await pedir(t, "joyce", { query: { acao: "motivos" } })).body;
  const m = l.motivos.find(x => x.chave === "ESCALA TROCADA");
  assert.equal(m.nome, "Troca de escala"); assert.equal(m.ativo, false); assert.deepEqual(m.antigos, ["Escala trocada"]);
  assert.equal(l.pode_editar, false);
  assert.equal((await pedir(t, "raphaelvictor", { query: { acao: "motivos" } })).body.pode_editar, true);
  assert.equal((await pedir(t, "ingridycampana", { method: "PATCH", body: { id: t.lig_contatos[0].id, motivo: "Escala trocada" } })).statusCode, 200, "o contato antigo continua editável com o nome velho");
});

test("histórico geral: abre qualquer colaborador da planilha, mesmo sem feedback", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(9, dia(-200), "I", { nome: "CARLOS NUNES" }), falta(9, dia(-60), "A", { nome: "CARLOS NUNES" }));
  t.pt_contatos.push({ re: 9, telefone_e164: "+5519999990009", enviavel: true });
  const r = await pedir(t, "ingridycampana", { query: { acao: "colaborador", re: "9" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.pessoa.situacao, "sem");
  assert.equal(r.body.pessoa.nome, "CARLOS NUNES");
  assert.deepEqual(r.body.pessoa.hist, [[dia(-200), "I"], [dia(-60), "A"]], "até 400 dias de histórico");
  assert.equal(r.body.pessoa.telefone, "5519999990009");
  t.fm_faltas.push(falta(9, dia(-1), "I", { nome: "CARLOS NUNES" }));
  const p = await pedir(t, "ingridycampana", { query: { acao: "colaborador", nome: "CARLOS NUNES" } });
  assert.equal(p.body.pessoa.situacao, "mensagem", "com falta pendente, o mesmo panorama da fila");
  assert.equal(p.body.pessoa.hist.length, 3, "o histórico inteiro, não só a janela da fila");
  assert.equal((await pedir(t, "ingridycampana", { query: { acao: "colaborador" } })).statusCode, 400);
  assert.equal((await pedir(t, "ingridycampana", { query: { acao: "colaborador", re: "777" } })).statusCode, 404);
});

test("funil: cada falta (I pendente, T tratada, A abonada), cada WhatsApp enviado e cada feedback, pela posição da pessoa", () => {
  const r = IND.montarIndicadores({
    hoje, motivos: IND.motivosAtuais([]),
    faltas: [falta(2, dia(-5), "I", { nome: "BIA" }), falta(1, dia(-5), "T", { nome: "ANA" }), falta(1, dia(-4), "J", { nome: "ANA" }), falta(1, dia(-3), "D", { nome: "ANA" })],
    contatos: [{ id: 1, colaborador: "ANA", data_contato: dia(-2), efetivo: true }, { id: 2, colaborador: "BIA", data_contato: dia(-2), efetivo: false }],
    envios: [{ chave: "1|ANA", data: dia(-4) }, { chave: "2|BIA", data: dia(-4) }, { chave: "9|NINGUEM", data: dia(-4) }]
  });
  assert.deepEqual(r.pessoas.map(p => p[1]), ["ANA", "BIA"], "ordem de nome: ANA é 0, BIA é 1");
  assert.deepEqual(r.funil.faltas.map(x => x.slice(0, 3)), [[dia(-5), 0, "T"], [dia(-5), 1, "I"], [dia(-4), 0, "A"]], "desligamento não é falta");
  assert.deepEqual(r.funil.envios, [[dia(-4), 0], [dia(-4), 1]], "envio de quem não está na planilha fica de fora");
  assert.deepEqual(r.funil.feedbacks, [[dia(-2), 0]], "tentativa não é feedback");
});

test("falta tipo RESERVA com posto preenchido é reserva; a falta guarda o supervisor dela (6º campo)", () => {
  const r = IND.montarIndicadores({
    hoje, motivos: IND.motivosAtuais([]),
    faltas: [falta(1, dia(-9), "I", { nome: "ANA", supervisor: "FRANK PIMENTEL" }), falta(1, dia(-3), "I", { nome: "ANA", supervisor: "PAULO SOUZA", tipo: "RESERVA", posto: "POSTO B" })]
  });
  assert.deepEqual(r.supervisores, ["FRANK PIMENTEL", "PAULO SOUZA"]);
  assert.deepEqual(r.funil.faltas.map(x => [x[4], r.supervisores[x[5]], r.postos[x[3]]]), [["E", "FRANK PIMENTEL", "POSTO A"], ["R", "PAULO SOUZA", "Reserva técnica · PAULO SOUZA"]],
    "a área da falta é a do dia da falta, mesmo que a pessoa tenha mudado de supervisor");
  assert.deepEqual(r.pessoas[0], ["1", "ANA", "POSTO B", "PAULO SOUZA"]);
});

test("avaliações: uma por feedback (pessoa + data), desligado à parte, contato sem pessoa na planilha", () => {
  const conv = (id, nome, d, extra) => ({ id, colaborador: nome, data_contato: d, efetivo: true, ...extra });
  const r = IND.montarIndicadores({
    hoje, motivos: IND.motivosAtuais([]),
    faltas: [falta(1, dia(-50), "D", { nome: "ANA" }), falta(1, dia(-12), "I", { nome: "ANA" }), falta(2, dia(-12), "I", { nome: "BIA" }), falta(2, dia(-5), "D", { nome: "BIA" })],
    contatos: [conv(1, "ANA", dia(-10), { supervisor: "JOAO" }), conv(2, "ANA", dia(-10)), conv(3, "BIA", dia(-10)), conv(4, "CARLOS FORA", dia(-30)), conv(5, "DUDA FORA", dia(-29))]
  });
  const de = n => r.avaliacoes.filter(x => x.nome === n);
  assert.equal(de("ANA").length, 1, "dois registros no mesmo dia são um feedback só");
  assert.equal(de("ANA")[0].sup, "JOAO", "a área da avaliação é o supervisor gravado no contato");
  assert.equal(de("ANA")[0].desligado, false, "D de antes do feedback não tira");
  assert.equal(de("BIA")[0].desligado, true, "D depois do feedback: fora das contas");
  assert.deepEqual([de("CARLOS FORA")[0].i, de("CARLOS FORA")[0].veredito, de("CARLOS FORA")[0].dias], [null, "sem_faltas", 30], "sem pessoa na planilha: sem faltas aos 30 dias");
  assert.equal(de("DUDA FORA")[0].veredito, "comecando", "ainda dentro dos 30 dias");
});

test("teste cruzado: Monitoramento (montarPainel) e Desempenho (montarIndicadores) dão o mesmo antes, depois e veredito", () => {
  const casos = [
    // [RE, dias atrás do feedback, faltas (dias relativos a hoje) com código]
    [1, 10, [[-39, "I"], [-38, "T"], [-30, "I"], [-5, "I"]]],            // 3 antes (a 1ª é dc−29), 1 depois: em observação
    [2, 10, [[-15, "I"], [-11, "I"], [-10, "I"], [-8, "I"], [-6, "T"], [-2, "I"], [-1, "I"]]], // piorou na hora
    [3, 30, []],                                                       // sem faltas aos 30 dias
    [4, 30, [[-45, "I"], [-31, "I"], [-20, "A"]]],                      // melhorou: 2 antes, abonada depois não conta
    [5, 20, [[-40, "I"], [-50, "I"], [-49, "I"], [-3, "I"], [-2, "T"]]], // dc−30 fica fora, dc−29 entra: 2 antes, 2 depois
    [6, 0, [[0, "I"]]]                                                  // feedback hoje, falta hoje: conta como antes
  ];
  const faltas = [], contatos = [];
  casos.forEach(([re, dc, fs], k) => {
    fs.forEach(([n, cod]) => faltas.push(falta(re, dia(n), cod, { nome: "PESSOA " + re })));
    contatos.push({ id: k + 1, colaborador: "PESSOA " + re, data_contato: dia(-dc), efetivo: true, criado_por: "Ingridy Campana", baixa: null });
  });
  faltas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.re - b.re));
  const pn = P.montarPainel({ hoje, faltas, contatos, envios: [], telefones: {} });
  const ind = IND.montarIndicadores({ hoje, faltas, contatos, motivos: IND.motivosAtuais([]) });
  const vistos = new Set();
  casos.forEach(([re]) => {
    const a = pn.pessoas.find(p => p.nome === "PESSOA " + re).acomp, b = ind.avaliacoes.find(x => x.nome === "PESSOA " + re);
    assert.deepEqual([b.antes, b.depois, b.dias, b.veredito, b.faltas_antes, b.faltas_depois], [a.antes, a.depois, a.dia, a.veredito, a.faltas_antes, a.faltas_depois], "RE " + re);
    vistos.add(a.veredito);
  });
  assert.deepEqual([...vistos].sort(), ["comecando", "melhorando", "mesma", "piorou", "sem_faltas"], "o teste passa pelos 5 vereditos");
});
