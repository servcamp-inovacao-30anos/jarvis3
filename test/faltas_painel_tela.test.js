// Contas do painel da supervisão (função fmContaPeriodo do index.html, lida
// direto do arquivo para o teste valer para a tela de verdade).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const ini = html.indexOf("function fmContaPeriodo("), fim = html.indexOf("/*fim fmContaPeriodo*/");
assert.ok(ini > 0 && fim > ini, "fmContaPeriodo não encontrada no index.html");
const fmContaPeriodo = new Function(html.slice(ini, fim) + "\nreturn fmContaPeriodo;")();

// Folha 26/09 a 25/10, hoje 30/09
const P = { ini: "2026-09-26", fim: "2026-10-25", atual: true };
const HOJE = "2026-09-30";
const caso = (re, sup, situacao, faltas, extra) => ({ re, nome: "P" + re, supervisor: sup, situacao, faltas, primeiraFalta: faltas[0], ...extra });

function exemplo() {
  return [
    caso(1, "ANA", "PRAZO_VENCIDO", ["2026-09-27"], { prazoFim: "2026-09-29" }),
    caso(2, "ANA", "NO_PRAZO", ["2026-09-28"], { prazoFim: "2026-09-30" }),           // vence hoje
    caso(3, "ANA", "NO_PRAZO", ["2026-09-29"], { prazoFim: "2026-10-02" }),
    caso(4, "BIA", "TRATADA", ["2026-09-26", "2026-09-27"]),                          // 2 faltas, com medida
    caso(5, "BIA", "TRATADA_FORA_DO_PRAZO", ["2026-09-29"]),
    caso(6, "BIA", "AGUARDANDO_RETORNO", ["2026-09-30"]),
    caso(7, "ANA", "COORDENACAO", ["2026-09-20", "2026-09-22"]),                     // folha anterior, em aberto
    caso(8, "BIA", "TRATADA", ["2026-09-15"]),                                        // folha anterior, já tratada: fora do período
    caso(9, "BIA", "PRAZO_VENCIDO", ["2026-09-24", "2026-09-26"], { prazoFim: "2026-09-29" }) // começou antes e faltou de novo na folha
  ];
}
const abonos = [{ re: 20, supervisor: "ANA", faltas: ["2026-09-28", "2026-09-29"] }, { re: 21, supervisor: "BIA", faltas: ["2026-09-10"] }];

test("total de faltas injustificadas e % tratado contam só os dias dentro do período, sem as abonadas", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  // faltas no período: c1 1, c2 1, c3 1, c4 2, c5 1, c6 1, c9 1 (26/09) = 8; c7 e c8 são de antes
  assert.equal(R.faltas, 8);
  assert.equal(R.tratadas, 3, "c4 (2) + c5 (1): medida dentro ou fora do prazo conta");
  assert.equal(R.pct, 38, "3 ÷ 8 = 37,5% → 38%");
  assert.equal(R.ocorrencias, 7);
  assert.equal(R.abonos.length, 1, "só a abonada que caiu no período; e ela não entra no total");
});

test("em aberto: os da folha e os que continuam em aberto da folha anterior", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  assert.deepEqual(R.abertos.map(c => c.re).sort(), [1, 2, 3, 6, 7, 9]);
  assert.deepEqual(R.anteriores.map(c => c.re).sort(), [7, 9], "começaram antes de 26/09 e seguem sem medida");
  assert.deepEqual(R.concluidas.map(c => c.re).sort(), [4, 5], "a tratada da folha anterior fica na folha dela");
  assert.deepEqual(R.n, { da: 2, hj: 1, np: 1, gr: 1, vi: 1 });
});

test("por supervisor: em aberto, da folha anterior e % tratado de cada um", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  const ana = R.sups.find(x => x.nome === "ANA"), bia = R.sups.find(x => x.nome === "BIA");
  assert.equal(R.sups[0].nome, "ANA", "quem tem mais casos em aberto vem primeiro");
  assert.deepEqual([ana.abertos, ana.ant, ana.faltas, ana.tratadas, ana.pct, ana.abonadas], [4, 1, 3, 0, 0, 1]);
  assert.deepEqual([bia.abertos, bia.ant, bia.faltas, bia.tratadas, bia.pct, bia.concluidas], [2, 1, 5, 3, 60, 2]);
  assert.deepEqual(bia.nAnt, { da: 1, hj: 0, np: 0, gr: 0, vi: 0 });
});

test("período passado: só os casos que começaram nele (nada de 'folha anterior')", () => {
  const R = fmContaPeriodo(exemplo(), abonos, { ini: "2026-08-26", fim: "2026-09-25", atual: false }, HOJE);
  assert.deepEqual(R.abertos.map(c => c.re).sort(), [7, 9]);
  assert.equal(R.anteriores.length, 0);
  assert.equal(R.faltas, 4, "c7 (2), c8 (1), c9 (24/09)");
  assert.equal(R.tratadas, 1);
});

test("limites da folha: dia 25 é da folha que fecha, dia 26 é da nova", () => {
  const cs = [caso(1, "ANA", "NO_PRAZO", ["2026-09-25"], { prazoFim: "2026-10-01" }), caso(2, "ANA", "NO_PRAZO", ["2026-09-26"], { prazoFim: "2026-10-01" })];
  const R = fmContaPeriodo(cs, [], P, HOJE);
  assert.deepEqual(R.anteriores.map(c => c.re), [1]);
  assert.equal(R.faltas, 1);
});

test("sem faltas no período: % tratado fica vazio (e não 0%)", () => {
  const R = fmContaPeriodo([], [], P, HOJE);
  assert.equal(R.pct, null);
  assert.equal(R.faltas, 0);
  assert.deepEqual(R.sups, []);
});

test("revisão: Concluídas é o mesmo conjunto do % tratado (caso tratado que atravessa o dia 26 entra na folha nova)", () => {
  const c = caso(30, "ANA", "TRATADA", ["2026-09-24", "2026-09-25", "2026-09-26"]);
  const R = fmContaPeriodo([c], [], P, HOJE);
  assert.equal(R.faltas, 1);
  assert.equal(R.tratadas, 1);
  assert.deepEqual(R.concluidas.map(x => x.re), [30], "o indicador diz 1 tratada; a lista mostra esse caso");
});

// ── calendário compacto: servidor e tela precisam dar exatamente o mesmo resultado ─────
test("calendário compacto: ida e volta não perde nada, e a tela expande igual ao servidor", () => {
  const R = require("../api/_faltas_regras");
  const ini = html.indexOf("const FM_TIPOS_CAL="), fim = html.indexOf("/* Calendário do mês (dia 1 ao último)");
  assert.ok(ini > 0 && fim > ini, "fmCalDe não encontrada no index.html");
  const fmCalDe = new Function(html.slice(ini, fim) + "\nreturn fmCalDe;")();
  const presente = (...d) => Object.fromEntries(d.map(x => [x, "TRABALHO"]));
  const c = { faltas: ["2026-10-07", "2026-10-09"], primeiraFalta: "2026-10-07", retorno: "2026-10-08", prazo: ["2026-10-08", "2026-10-09", "2026-10-12"], prazoFim: "2026-10-12", medida: { DATA: "2026-10-09" } };
  const cal = R.calendario(c, { dias: { ...presente("2026-10-06", "2026-10-08"), "2026-10-04": "FOLGA" }, abonadas: ["2026-10-05"], feriados: ["2026-10-02", "2026-10-14"], hoje: "2026-10-09", meses: true, atestado: { inicio: "2026-10-04", fim: "2026-10-05" } });
  const compacto = R.compactarCalendario(cal);
  const volta = R.expandirCalendario(compacto);
  const tirarNoPrazo = l => l.map(({ noPrazo, ...resto }) => resto);
  assert.deepEqual(volta, tirarNoPrazo(cal), "servidor: compactar e expandir devolve o mesmo calendário");
  assert.deepEqual(fmCalDe({ cal: compacto }), volta, "tela: expande igual ao servidor");
  assert.ok(JSON.stringify(compacto).length < JSON.stringify(cal).length / 10, "e ocupa menos de um décimo");
  assert.deepEqual(fmCalDe({}), [], "caso sem calendário não quebra");
  assert.deepEqual(R.expandirCalendario(R.compactarCalendario([])), []);
});
