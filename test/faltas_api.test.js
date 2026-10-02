// Servidor do módulo Faltas x Medidas, contra um Supabase falso em memória.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const faltas = require("../api/_faltas");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

const falta = (re, data, extra) => ({ RE: re, NOME: "PESSOA " + re, DATA: data, ABONO: "I", CARGO: "PORTEIRO (A)", LOCAL: "POSTO A", AREA: "FRANK", ESCALA: "12X36", TIPO: "CONTRATO", ...extra });
function planilha(extra) {
  return {
    faltas: [falta(521, "2026-10-10"), falta(900, "2026-10-10", { TIPO: "DEPARTAMENTO" }), falta(901, "2026-10-10", { ESCALA: "3X4 FOLGA FIXA" })],
    fichaDias: { 521: { "2026-10-10": "FALTA", "2026-10-12": "TRABALHANDO" }, 900: { "2026-10-10": "FALTA" } },
    disciplina: [{ HIST: "P-1", RE: 521, DATA: "2026-10-12", TIPO: "ADVERTÊNCIA", GRAU: "ESCRITA", DIAS: 0, FASE: "CONCLUIDO", MOTIVO: "FALTA INJUSTIFICADA" }],
    ativos: [{ RE: 521, NOME: "PESSOA 521", ADMISSAO: "2025-01-10" }, { RE: 522, NOME: "SEM DATA", ADMISSAO: null }],
    ...extra
  };
}
const tabelasVazias = () => ({ fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] });

test("materializar: guarda só quem é do módulo", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const r = await faltas.materializar(planilha());
  assert.equal(r.ok, true);
  assert.deepEqual(t.fm_faltas.map(f => [f.re, f.data, f.codigo, f.escala]), [[521, "2026-10-10", "I", "12X36"]], "departamento e escala fora do módulo ficam de fora");
  assert.deepEqual(t.fm_dias.map(d => [d.re, d.data, d.situacao]), [[521, "2026-10-10", "FALTA"], [521, "2026-10-12", "TRABALHANDO"]]);
  assert.deepEqual(t.fm_medidas.map(m => [m.chave, m.re, m.data, m.motivo_sar2g]), [["P-1", 521, "2026-10-12", "FALTA INJUSTIFICADA"]]);
  assert.deepEqual(t.fm_admissoes.map(a => [a.re, a.admissao]), [[521, "2025-01-10"]], "sem data de admissão, nada é gravado");
});

test("materializar: atestado muda o código, e falta corrigida pelo RH sai do módulo", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10"), falta(521, "2026-10-14"), falta(530, "2026-09-01")] }));
  assert.equal(t.fm_faltas.length, 3);
  // planilha seguinte: 10/10 virou abonada, 14/10 foi corrigida (não é mais falta)
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10", { ABONO: "A" })], fichaDias: { 521: { "2026-10-10": "FALTA", "2026-10-14": "TRABALHANDO" } } }));
  const ficou = t.fm_faltas.map(f => [f.re, f.data, f.codigo]).sort();
  assert.deepEqual(ficou, [[521, "2026-10-10", "A"], [530, "2026-09-01", "I"]], "a de setembro está fora do período desta planilha e fica");
});

test("materializar: planilha sem faltas não apaga nada", async () => {
  const t = tabelasVazias(); t.fm_faltas.push({ re: 521, data: "2026-10-10", codigo: "I" }); supabaseFalso(t);
  const r = await faltas.materializar({ disciplina: [] });
  assert.equal(r.ignorado, "SEM_FALTAS_NA_PLANILHA");
  assert.equal(t.fm_faltas.length, 1);
});

test("materializar: o motivo editado no JARVIS nunca é sobrescrito pela planilha", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar(planilha());
  t.fm_medidas[0].motivo = "Chegou 2h atrasado e sem avisar";
  await faltas.materializar(planilha());
  assert.equal(t.fm_medidas.length, 1);
  assert.equal(t.fm_medidas[0].motivo, "Chegou 2h atrasado e sem avisar");
});

// Datas relativas a hoje: o GET usa o dia de verdade.
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function tabelasComCaso() {
  const t = tabelasVazias();
  // 12x36: faltou há 10 dias, voltou há 8; prazo nos plantões de há 8 e há 6 dias → vencido
  t.fm_faltas.push({ re: 521, data: dia(-10), codigo: "I", nome: "MARIA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "12X36", tipo: "CONTRATO" });
  t.fm_dias.push({ re: 521, data: dia(-10), situacao: "FALTA" }, { re: 521, data: dia(-8), situacao: "TRABALHANDO" }, { re: 521, data: dia(-6), situacao: "TRABALHANDO" });
  t.fm_medidas.push({ chave: "P-9", re: 521, data: dia(-40), tipo: "ADVERTÊNCIA", grau: "VERBAL", dias: 0, fase: "CONCLUIDO" });
  return t;
}
const pedir = (method, t, extra) => chamar(rh, { method, query: { modulo: "faltas", t, ...(extra && extra.query) }, usuario: extra && "usuario" in extra ? extra.usuario : "aprovador", body: extra && extra.body });

test("GET casos: calcula a situação e diz quem pode editar", async t => {
  await t.test("aprovador", async () => {
    supabaseFalso(tabelasComCaso());
    const r = await pedir("GET", "casos");
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.casos.length, 1);
    const c = r.body.casos[0];
    assert.equal(c.situacao, "PRAZO_VENCIDO");
    assert.deepEqual(c.prazo, [dia(-8), dia(-6)]);
    assert.equal(c.medida, null, "a advertência de 40 dias atrás é anterior à falta");
    assert.deepEqual(r.body.resumo, { PRAZO_VENCIDO: 1 });
    assert.ok(r.body.dias["521"], "manda os dias da ficha para o card");
    assert.equal(r.body.historico["521"].length, 1, "e as medidas anteriores da pessoa");
    assert.equal(r.body.pode_editar, true);
  });
  await t.test("qualquer outra pessoa logada vê, mas não edita", async () => {
    supabaseFalso(tabelasComCaso());
    const r = await pedir("GET", "casos", { usuario: "supervisor.fulano" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.pode_editar, false);
  });
});

test("atestado que chega depois: a troca injustificada → abonada é anotada uma vez, e a que já nasce abonada não", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  // 1ª planilha: 10/10 injustificada; 11/10 já chega abonada
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10"), falta(521, "2026-10-11", { ABONO: "A" })] }));
  assert.equal(t.fm_auditoria.length, 0, "nada mudou ainda");
  // 2ª planilha: o atestado chegou e 10/10 virou abonada
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10", { ABONO: "A" }), falta(521, "2026-10-11", { ABONO: "A" })] }));
  assert.deepEqual(t.fm_auditoria.map(a => [a.acao, a.chave, a.antes.codigo, a.depois.codigo, a.ator]), [["FALTA_ABONADA_DEPOIS", "521|2026-10-10", "I", "A", "sistema"]]);
  // 3ª planilha igual: não anota de novo
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10", { ABONO: "A" }), falta(521, "2026-10-11", { ABONO: "A" })] }));
  assert.equal(t.fm_auditoria.length, 1);
});

test("GET casos: o período do atestado diz se foi lançado depois e quando", async () => {
  const t = tabelasVazias();
  [dia(-3), dia(-2)].forEach(d => t.fm_faltas.push({ re: 600, data: d, codigo: "A", nome: "JULIA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" }));
  t.fm_faltas.push({ re: 601, data: dia(-3), codigo: "J", nome: "LUIZ", cargo: "PORTEIRO (A)", posto: "POSTO B", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" });
  // o sistema percebeu a troca da Julia no dia seguinte à 1ª falta (criado_em em UTC)
  t.fm_auditoria.push({ acao: "FALTA_ABONADA_DEPOIS", chave: "600|" + dia(-3), criado_em: dia(-2) + "T15:00:00Z" });
  supabaseFalso(t);
  const r = await pedir("GET", "casos");
  const de = re => r.body.abonos.find(a => String(a.re) === String(re));
  assert.equal(de(600).lancadoDepois, true);
  assert.equal(de(600).lancadoEm, dia(-2));
  assert.equal(de(600).dias, 2);
  assert.equal(de(601).lancadoDepois, false, "já chegou abonada");
  assert.equal(de(601).lancadoEm, null);
});

test("PATCH motivo", async t => {
  await t.test("só aprovador", async () => {
    supabaseFalso(tabelasComCaso());
    const r = await pedir("PATCH", "motivo", { usuario: "supervisor.fulano", body: { chave: "P-9", motivo: "x" } });
    assert.equal(r.statusCode, 403);
  });
  await t.test("grava o texto e o histórico com o antes e o depois", async () => {
    const tab = tabelasComCaso(); supabaseFalso(tab);
    const r = await pedir("PATCH", "motivo", { body: { chave: "P-9", motivo: "  Falta sem aviso no posto A  " } });
    assert.equal(r.statusCode, 200);
    assert.equal(tab.fm_medidas[0].motivo, "Falta sem aviso no posto A");
    assert.equal(tab.fm_medidas[0].motivo_editado_por, "aprovador");
    assert.deepEqual([tab.fm_auditoria[0].acao, tab.fm_auditoria[0].antes, tab.fm_auditoria[0].depois], ["MOTIVO_EDITADO", { motivo: null }, { motivo: "Falta sem aviso no posto A" }]);
  });
  await t.test("mesmo texto não gera histórico; medida inexistente dá 404", async () => {
    const tab = tabelasComCaso(); tab.fm_medidas[0].motivo = "igual"; supabaseFalso(tab);
    assert.equal((await pedir("PATCH", "motivo", { body: { chave: "P-9", motivo: "igual" } })).body.alterado, false);
    assert.equal(tab.fm_auditoria.length, 0);
    assert.equal((await pedir("PATCH", "motivo", { body: { chave: "NAO-EXISTE", motivo: "x" } })).statusCode, 404);
  });
});

test("feriados: aprovador cadastra e remove, todos veem", async () => {
  const tab = tabelasVazias(); supabaseFalso(tab);
  assert.equal((await pedir("POST", "feriados", { usuario: "supervisor.fulano", body: { data: "2026-11-02" } })).statusCode, 403);
  assert.equal((await pedir("POST", "feriados", { body: { data: "2026-11-02", descricao: "Finados" } })).statusCode, 200);
  assert.deepEqual(tab.fm_feriados.map(f => [f.data, f.descricao]), [["2026-11-02", "Finados"]]);
  assert.equal((await pedir("GET", "feriados", { usuario: "supervisor.fulano" })).body.feriados.length, 1);
  await pedir("POST", "feriados", { body: { data: "2026-11-02", remover: true } });
  assert.equal(tab.fm_feriados.length, 0);
  assert.equal((await pedir("POST", "feriados", { body: { data: "02/11/2026" } })).body.codigo, "DATA_INVALIDA");
});

test("rota desconhecida", async () => {
  supabaseFalso(tabelasVazias());
  assert.equal((await pedir("DELETE", "casos")).statusCode, 404);
});

test("importar pelo api/import.js guarda as faltas junto", async () => {
  const importar = require("../api/import");
  const tab = tabelasVazias(); supabaseFalso(tab);
  const r = await chamar(importar, { method: "POST", usuario: "aprovador", headers: { "content-type": "application/json" }, body: { data: { ...planilha(), clientes: [] }, source_filename: "Base dados.xlsx" } });
  assert.equal(r.statusCode, 200);
  assert.equal(tab.dashboard_snapshots.length, 1);
  assert.equal(tab.fm_faltas.length, 1);
  assert.equal(tab.fm_medidas.length, 1);
  // a resposta diz o que o módulo recebeu (a tela mostra isso para quem enviou)
  assert.equal(r.body.faltas_medidas.ok, true);
  assert.deepEqual([r.body.faltas_medidas.faltas, r.body.faltas_medidas.medidas], [1, 1]);
});

test("falha no módulo não derruba a importação da planilha", async () => {
  const importar = require("../api/import");
  const tab = tabelasVazias(); supabaseFalso(tab, { falhar: (metodo, caminho) => caminho.startsWith("fm_") });
  const r = await chamar(importar, { method: "POST", usuario: "aprovador", headers: { "content-type": "application/json" }, body: { data: { ...planilha(), clientes: [] } } });
  assert.equal(r.statusCode, 200);
  assert.equal(tab.dashboard_snapshots.length, 1, "o snapshot foi salvo");
  assert.equal(r.body.faltas_medidas.ok, false, "e a resposta avisa que o módulo falhou, em vez de calar");
  assert.ok(r.body.faltas_medidas.erro, "com o motivo");
});

test("módulo sem nenhuma planilha recebida: a tela recebe 'vazio' e explica; com dados, não", async () => {
  supabaseFalso(tabelasVazias());
  assert.equal((await pedir("GET", "casos")).body.vazio, true);
  supabaseFalso(tabelasComCaso());
  assert.equal((await pedir("GET", "casos")).body.vazio, false);
});

test("retorno numa planilha seguinte: os dias de quem faltou antes continuam sendo guardados", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  const hojeISO = new Date().toISOString().slice(0, 10);
  t.fm_faltas.push({ re: 521, data: hojeISO, codigo: "I", escala: "12X36", tipo: "CONTRATO" });
  // planilha do dia seguinte: a 521 não tem falta, só o dia trabalhado; a 777 nunca faltou
  await faltas.materializar({ faltas: [], fichaDias: { 521: { "2099-01-02": "TRABALHO" }, 777: { "2099-01-02": "TRABALHO" } } });
  assert.deepEqual(t.fm_dias.map(d => [d.re, d.data]), [[521, "2099-01-02"]]);
});

test("a cópia da planilha que as telas carregam não leva os dias da ficha", async () => {
  const importar = require("../api/import");
  const tab = tabelasVazias(); supabaseFalso(tab);
  await chamar(importar, { method: "POST", usuario: "aprovador", headers: { "content-type": "application/json" }, body: { data: { ...planilha(), clientes: [] } } });
  assert.equal(tab.dashboard_snapshots[0].data.fichaDias, undefined);
  assert.equal(tab.fm_dias.length, 2, "mas o módulo guardou");
});

test("revisão: falta sem código que vira abonada não é marcada como 'lançado depois'", async () => {
  const t = tabelasVazias(); supabaseFalso(t);
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10", { ABONO: "—" })] }));
  await faltas.materializar(planilha({ faltas: [falta(521, "2026-10-10", { ABONO: "A" })] }));
  assert.equal(t.fm_auditoria.length, 0);
});
