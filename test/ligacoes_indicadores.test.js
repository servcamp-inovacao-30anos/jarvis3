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
  assert.deepEqual(r.com_feedback.map(x => x.nome), ["PESSOA 1", "PESSOA 3"], "tentativa não é feedback");
  assert.deepEqual(r.com_feedback[0].faltas, [[dia(-1), "S"]]);
  assert.deepEqual(r.com_feedback[0].contatos, [dia(-1)]);
  assert.deepEqual(r.conversas, [[dia(-1), "Saúde (atestado)", 12, "FRANK PIMENTEL", ""], [dia(-1), "Sem motivo", null, "FRANK PIMENTEL", ""]]);
});

test("rota de indicadores: qualquer pessoa do SAC lê", async () => {
  const t = tabelas();
  t.fm_faltas.push(falta(1, dia(-3)), falta(2, dia(-2), "J"));
  t.lig_contatos.push({ id: 1, colaborador: "PESSOA 1", data_contato: dia(-1), criado_em: dia(-1) + "T10:00:00Z", motivo: "Saúde", duracao_min: 9, supervisor: "FRANK PIMENTEL" });
  const r = await pedir(t, "ingridycampana", { query: { acao: "indicadores" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.dias.length, 2);
  assert.deepEqual(r.body.conversas, [[dia(-1), "Saúde", 9, "FRANK PIMENTEL", ""]]);
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
