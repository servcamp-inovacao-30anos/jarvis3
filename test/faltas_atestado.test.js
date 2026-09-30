// Atestado registrado à mão no Faltas x Medidas: vale na hora, sem esperar o
// lançamento no SAR2G, e mostra o que ainda falta lançar lá.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const ponto = require("../api/_ponto");
const R = require("../api/_faltas_regras");
const rh = require("../api/rh");

ponto.APROVADORES.add("aprovador");

// Datas relativas a hoje (horário de Brasília): o GET usa o dia de verdade.
const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const pedir = (method, t, extra) => chamar(rh, { method, query: { modulo: "faltas", t }, usuario: extra && "usuario" in extra ? extra.usuario : "aprovador", body: extra && extra.body });

// 5x2: faltou 3 dias seguidos (há 6, 5 e 4 dias), ainda sem voltar ao trabalho
function tabelas() {
  const t = { fm_faltas: [], fm_dias: [], fm_medidas: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [] };
  [-6, -5, -4].forEach(n => t.fm_faltas.push({ re: 700, data: dia(n), codigo: "I", nome: "CARLA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" }));
  return t;
}
const atestado = (extra) => ({ re: 700, tem: true, inicio: dia(-6), dias: 2, envio: dia(-5), ...extra });

test("só aprovador registra atestado", async () => {
  supabaseFalso(tabelas());
  const r = await pedir("POST", "atestado", { usuario: "supervisor.fulano", body: atestado() });
  assert.equal(r.statusCode, 403);
});

test("atestado registrado abona já as faltas que ele cobre; as outras continuam em cobrança", async () => {
  const t = tabelas(); supabaseFalso(t);
  const antes = await pedir("GET", "casos");
  assert.equal(antes.body.casos.length, 1);
  assert.deepEqual(antes.body.casos[0].faltas, [dia(-6), dia(-5), dia(-4)]);

  const r = await pedir("POST", "atestado", { body: atestado() });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.alterado, true);
  assert.equal(r.body.fim, dia(-5));
  assert.deepEqual(t.fm_auditoria.map(a => [a.acao, a.chave, a.ator]), [["ATESTADO_REGISTRADO", `700|${dia(-6)}`, "aprovador"]]);

  const d = await pedir("GET", "casos");
  assert.equal(d.body.casos.length, 1, "sobra a falta de " + dia(-4));
  assert.deepEqual(d.body.casos[0].faltas, [dia(-4)]);
  const ab = d.body.abonos.find(a => String(a.re) === "700");
  assert.deepEqual([ab.inicio, ab.fim, ab.dias], [dia(-6), dia(-5), 2]);
  assert.equal(ab.aguardaSar2g, true, "registrado aqui, ainda não consta no SAR2G");
  assert.deepEqual([ab.atestado.inicio, ab.atestado.dias, ab.atestado.envio, ab.atestado.por], [dia(-6), 2, dia(-5), "aprovador"]);
  assert.equal(d.body.atestados.length, 1);
  assert.equal(d.body.casos[0].atestados.length, 1, "o card do caso também vê o atestado");
});

test("quando o SAR2G passar a mostrar o abono, deixa de aguardar o lançamento", async () => {
  const t = tabelas(); supabaseFalso(t);
  await pedir("POST", "atestado", { body: atestado() });
  t.fm_faltas.filter(f => f.data <= dia(-5)).forEach(f => { f.codigo = "A"; });
  const d = await pedir("GET", "casos");
  const ab = d.body.abonos.find(a => String(a.re) === "700");
  assert.equal(ab.aguardaSar2g, false);
  assert.equal(ab.atestado.dias, 2, "os dados informados continuam");
  assert.equal(ab.lancadoDepois, false, "com atestado registrado à mão, vale a data de envio informada");
});

test("remover o atestado devolve as faltas para a cobrança", async () => {
  const t = tabelas(); supabaseFalso(t);
  const r1 = await pedir("POST", "atestado", { body: atestado({ dias: 3 }) });
  assert.equal((await pedir("GET", "casos")).body.casos.length, 0, "as 3 faltas estavam cobertas");
  const r2 = await pedir("POST", "atestado", { body: { re: 700, remover: true, chave: r1.body.chave } });
  assert.equal(r2.body.alterado, true);
  const d = await pedir("GET", "casos");
  assert.equal(d.body.casos.length, 1);
  assert.equal(d.body.abonos.length, 0);
  assert.equal(d.body.atestados.length, 0);
  // remover de novo não anota nada
  const r3 = await pedir("POST", "atestado", { body: { re: 700, remover: true, chave: r1.body.chave } });
  assert.equal(r3.body.alterado, false);
});

test("corrigir um atestado: troca o antigo pelo novo", async () => {
  const t = tabelas(); supabaseFalso(t);
  const r1 = await pedir("POST", "atestado", { body: atestado({ dias: 1 }) });
  await pedir("POST", "atestado", { body: atestado({ inicio: dia(-5), dias: 2, substitui: r1.body.chave }) });
  const d = await pedir("GET", "casos");
  assert.equal(d.body.atestados.length, 1);
  assert.equal(d.body.atestados[0].inicio, dia(-5));
  assert.deepEqual(d.body.casos[0].faltas, [dia(-6)], "agora só cobre " + dia(-5) + " e " + dia(-4));
});

test("salvar duas vezes a mesma coisa não duplica o registro", async () => {
  const t = tabelas(); supabaseFalso(t);
  await pedir("POST", "atestado", { body: atestado() });
  const r = await pedir("POST", "atestado", { body: atestado() });
  assert.equal(r.body.alterado, false);
  assert.equal(t.fm_auditoria.length, 1);
});

test("sem atestado: fica anotado no caso, e não muda o prazo", async () => {
  const t = tabelas(); supabaseFalso(t);
  const antes = (await pedir("GET", "casos")).body.casos[0];
  const r = await pedir("POST", "atestado", { body: { re: 700, tem: false, caso: dia(-6) } });
  assert.equal(r.body.alterado, true);
  const c = (await pedir("GET", "casos")).body.casos[0];
  assert.equal(c.situacao, antes.situacao);
  assert.equal(c.semAtestado.por, "aprovador");
  assert.equal(c.semAtestado.chave, `700|sem|${dia(-6)}`);
  // desfazer
  await pedir("POST", "atestado", { body: { re: 700, remover: true, chave: r.body.chave } });
  assert.equal((await pedir("GET", "casos")).body.casos[0].semAtestado, null);
});

test("dados inválidos são recusados com a explicação", async t => {
  supabaseFalso(tabelas());
  const erro = async (body, codigo) => { const r = await pedir("POST", "atestado", { body }); assert.equal(r.body.codigo, codigo, JSON.stringify(body)); };
  await t.test("colaborador", async () => { await erro({ tem: true }, "SEM_RE"); await erro(atestado({ re: 999 }), "NAO_ENCONTRADA"); });
  await t.test("data do atestado", async () => { await erro(atestado({ inicio: "amanha" }), "DATA_INVALIDA"); await erro(atestado({ inicio: dia(-400) }), "DATA_FORA"); await erro(atestado({ inicio: dia(90) }), "DATA_FORA"); });
  await t.test("dias", async () => { await erro(atestado({ dias: 0 }), "DIAS_INVALIDOS"); await erro(atestado({ dias: 2.5 }), "DIAS_INVALIDOS"); await erro(atestado({ dias: 500 }), "DIAS_INVALIDOS"); });
  await t.test("envio", async () => { await erro(atestado({ envio: "ontem" }), "ENVIO_INVALIDO"); await erro(atestado({ envio: dia(3) }), "ENVIO_FUTURO"); });
  await t.test("sem atestado pede o caso; remover pede um atestado da mesma pessoa", async () => { await erro({ re: 700, tem: false }, "CASO_INVALIDO"); await erro({ re: 700, remover: true, chave: "800|2026-01-01" }, "CHAVE_INVALIDA"); });
});

test("atestado sem data de envio é aceito (o campo é opcional)", async () => {
  supabaseFalso(tabelas());
  const r = await pedir("POST", "atestado", { body: atestado({ envio: "" }) });
  assert.equal(r.statusCode, 200);
  assert.equal((await pedir("GET", "casos")).body.atestados[0].envio, null);
});

test("dobrarAtestados: vale o último evento de cada atestado", () => {
  const ev = (acao, chave, depois, ator) => ({ acao, chave, depois, ator: ator || "a", criado_em: "2026-10-01T10:00:00Z" });
  const { ativos, sem } = R.dobrarAtestados([
    ev("ATESTADO_REGISTRADO", "1|2026-10-01", { re: 1, tem: true, inicio: "2026-10-01", dias: 3, envio: "2026-10-02" }),
    ev("ATESTADO_REGISTRADO", "2|2026-10-05", { re: 2, tem: true, inicio: "2026-10-05", dias: 1 }),
    ev("ATESTADO_REMOVIDO", "2|2026-10-05", null),
    ev("ATESTADO_REGISTRADO", "1|2026-10-01", { re: 1, tem: true, inicio: "2026-10-01", dias: 4, envio: "2026-10-02" }, "b"),
    ev("ATESTADO_REGISTRADO", "3|sem|2026-10-07", { re: 3, tem: false, caso: "2026-10-07" })
  ]);
  assert.deepEqual(ativos.map(a => [a.chave, a.re, a.inicio, a.fim, a.dias, a.envio, a.por]), [["1|2026-10-01", "1", "2026-10-01", "2026-10-04", 4, "2026-10-02", "b"]]);
  assert.deepEqual(Object.keys(sem), ["3|2026-10-07"]);
});

test("períodos de abono com atestado registrado à mão", () => {
  const ab = (data, extra) => ({ re: "1", data, codigo: "A", nome: "P", cargo: "", posto: "X", supervisor: "S", escala: "5X2 SDF", ...extra });
  const cobre = { chave: "1|2026-10-05", re: "1", inicio: "2026-10-05", dias: 3, fim: "2026-10-07", envio: "2026-10-06", por: "raphael" };
  const p = R.periodosDeAbono(
    [ab("2026-10-05", { manual: cobre.chave, noSar2g: false }), ab("2026-10-06", { manual: cobre.chave, noSar2g: true }), ab("2026-10-07", { manual: cobre.chave, noSar2g: false })],
    {}, { "1|2026-10-05": "2026-10-06" }, [cobre]);
  assert.equal(p.length, 1);
  assert.equal(p[0].aguardaSar2g, true, "2 dos 3 dias ainda não constam no SAR2G");
  assert.equal(p[0].atestado.dias, 3);
  assert.equal(p[0].lancadoDepois, false, "a data informada manda");
  const so = R.periodosDeAbono([ab("2026-10-05", { manual: cobre.chave, noSar2g: true })], {}, {}, [cobre]);
  assert.equal(so[0].aguardaSar2g, false);
  const semManual = R.periodosDeAbono([ab("2026-10-05", { noSar2g: true })], {}, {}, []);
  assert.deepEqual([semManual[0].manuais.length, semManual[0].atestado, semManual[0].aguardaSar2g], [0, null, false]);
});

test("revisão: corrigir para uma data em que já existe outro atestado é recusado (não sobrescreve)", async () => {
  const t = tabelas(); supabaseFalso(t);
  const a = await pedir("POST", "atestado", { body: atestado({ inicio: dia(-6), dias: 1 }) });
  await pedir("POST", "atestado", { body: atestado({ inicio: dia(-4), dias: 1 }) });
  const r = await pedir("POST", "atestado", { body: atestado({ inicio: dia(-4), dias: 2, substitui: a.body.chave }) });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.codigo, "JA_EXISTE");
  assert.equal((await pedir("GET", "casos")).body.atestados.length, 2, "os dois continuam como estavam");
});

test("revisão: o card do caso só lista os atestados daquela época", async () => {
  const t = tabelas();
  t.fm_faltas.push({ re: 700, data: dia(-60), codigo: "A", nome: "CARLA", cargo: "PORTEIRO (A)", posto: "POSTO A", supervisor: "FRANK", escala: "5X2 SDF", tipo: "CONTRATO" });
  supabaseFalso(t);
  await pedir("POST", "atestado", { body: { re: 700, tem: true, inicio: dia(-60), dias: 1 } }); // atestado antigo
  const c = (await pedir("GET", "casos")).body.casos.find(x => String(x.re) === "700");
  assert.equal(c.atestados.length, 0, "o atestado de 60 dias atrás não é deste caso");
});

test("'já lancei no SAR2G': marca, desmarca e tira o aviso de lançamento pendente", async () => {
  const t = tabelas(); supabaseFalso(t);
  const a = await pedir("POST", "atestado", { body: atestado() });
  const pend = async () => (await pedir("GET", "casos")).body.abonos.find(x => String(x.re) === "700");
  assert.equal((await pend()).aguardaSar2g, true);
  const m = await pedir("POST", "atestado", { body: { re: 700, chave: a.body.chave, lancado: true } });
  assert.equal(m.body.alterado, true);
  let ab = await pend();
  assert.equal(ab.aguardaSar2g, false, "marcado como lançado");
  assert.equal(ab.atestado.lancadoSar2g, true);
  assert.equal(ab.atestado.lancadoPor, "aprovador");
  assert.equal((await pedir("POST", "atestado", { body: { re: 700, chave: a.body.chave, lancado: true } })).body.alterado, false, "marcar de novo não duplica");
  await pedir("POST", "atestado", { body: { re: 700, chave: a.body.chave, lancado: false } });
  ab = await pend();
  assert.equal(ab.aguardaSar2g, true, "desmarcado: volta a aguardar");
  assert.equal(ab.atestado.lancadoSar2g, false);
});

test("'já lancei no SAR2G': corrigir o atestado depois de marcar volta a pedir o lançamento", async () => {
  const t = tabelas(); supabaseFalso(t);
  const a = await pedir("POST", "atestado", { body: atestado({ dias: 1 }) });
  await pedir("POST", "atestado", { body: { re: 700, chave: a.body.chave, lancado: true } });
  await pedir("POST", "atestado", { body: atestado({ dias: 2 }) });   // mesma data, mais um dia: é outra versão
  const ab = (await pedir("GET", "casos")).body.abonos.find(x => String(x.re) === "700");
  assert.equal(ab.atestado.lancadoSar2g, false, "o que foi lançado era outra versão");
  assert.equal(ab.aguardaSar2g, true);
});

test("'já lancei no SAR2G': só aprovador, só de atestado que existe e da própria pessoa", async () => {
  const t = tabelas(); supabaseFalso(t);
  const a = await pedir("POST", "atestado", { body: atestado() });
  assert.equal((await pedir("POST", "atestado", { usuario: "supervisor.fulano", body: { re: 700, chave: a.body.chave, lancado: true } })).statusCode, 403);
  assert.equal((await pedir("POST", "atestado", { body: { re: 700, chave: "700|2020-01-01", lancado: true } })).statusCode, 404);
  assert.equal((await pedir("POST", "atestado", { body: { re: 700, chave: "999|2026-01-01", lancado: true } })).body.codigo, "CHAVE_INVALIDA");
});
