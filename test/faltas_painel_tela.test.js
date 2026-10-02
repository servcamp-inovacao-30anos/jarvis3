// Contas do painel da supervisão (função fmContaPeriodo do index.html, lida
// direto do arquivo para o teste valer para a tela de verdade).
//
// Regra da coordenação: cada caso pertence à folha (ou mês) da PRIMEIRA falta dele,
// e os casos abertos de folhas que já fecharam ficam À PARTE: nunca entram nos
// números da folha atual (para não misturar).
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
    caso(7, "ANA", "COORDENACAO", ["2026-09-20", "2026-09-22"]),                     // começou na folha anterior, em aberto
    caso(8, "BIA", "TRATADA", ["2026-09-15"]),                                        // folha anterior, já tratada
    caso(9, "BIA", "PRAZO_VENCIDO", ["2026-09-24", "2026-09-26"], { prazoFim: "2026-09-29" }) // começou 24/09 (folha anterior) e faltou de novo em 26/09
  ];
}
const abonos = [{ re: 20, supervisor: "ANA", inicio: "2026-09-28", faltas: ["2026-09-28", "2026-09-29"] }, { re: 21, supervisor: "BIA", inicio: "2026-09-10", faltas: ["2026-09-10"] }];

test("o caso pertence à folha da primeira falta: total de faltas e % tratado só com os casos da folha, sem as abonadas", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  // casos da folha: 1, 2, 3, 4 (2 faltas), 5, 6 → 7 faltas. O 9 começou em 24/09: é da folha anterior, com as 2 faltas dele.
  assert.equal(R.faltas, 7);
  assert.equal(R.tratadas, 3, "caso 4 (2 faltas) + caso 5: medida dentro ou fora do prazo conta");
  assert.equal(R.pct, 43, "3 ÷ 7 = 42,9% → 43%");
  assert.equal(R.ocorrencias, 6);
  assert.equal(R.abonos.length, 1, "só a abonada que começou na folha; a de 10/09 é da anterior. E nenhuma entra no total");
});

test("em aberto: só os da folha. Os abertos de antes ficam à parte e não entram em nenhum número da folha", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  assert.deepEqual(R.abertos.map(c => c.re).sort(), [1, 2, 3, 6]);
  assert.deepEqual(R.anteriores.map(c => c.re).sort(), [7, 9], "começaram antes de 26/09 e seguem sem medida");
  assert.deepEqual(R.concluidas.map(c => c.re).sort(), [4, 5], "a tratada da folha anterior fica na folha dela");
  assert.deepEqual(R.n, { da: 1, hj: 1, np: 1, gr: 1, vi: 0 }, "os números da folha não incluem coordenação nem atraso de antes");
  assert.deepEqual(R.nAnt, { da: 1, hj: 0, np: 0, gr: 0, vi: 1 }, "os de antes têm a contagem deles");
});

test("por supervisor: em aberto da folha e da folha anterior em colunas separadas", () => {
  const R = fmContaPeriodo(exemplo(), abonos, P, HOJE);
  const ana = R.sups.find(x => x.nome === "ANA"), bia = R.sups.find(x => x.nome === "BIA");
  assert.equal(R.sups[0].nome, "ANA", "quem tem mais casos em aberto na folha vem primeiro");
  assert.deepEqual([ana.abertos, ana.ant, ana.faltas, ana.tratadas, ana.pct, ana.abonadas], [3, 1, 3, 0, 0, 1]);
  assert.deepEqual([bia.abertos, bia.ant, bia.faltas, bia.tratadas, bia.pct, bia.concluidas], [1, 1, 4, 3, 75, 2]);
  assert.deepEqual(bia.nAnt, { da: 1, hj: 0, np: 0, gr: 0, vi: 0 });
});

test("período que já fechou: mostra os casos que começaram nele, inteiros, e não tem 'anterior'", () => {
  const R = fmContaPeriodo(exemplo(), abonos, { ini: "2026-08-26", fim: "2026-09-25", atual: false }, HOJE);
  assert.deepEqual(R.abertos.map(c => c.re).sort(), [7, 9], "o caso 9 aparece aqui com as duas faltas, e não na folha nova");
  assert.equal(R.anteriores.length, 0);
  assert.equal(R.faltas, 5, "caso 7 (2) + caso 8 (1) + caso 9 (2)");
  assert.equal(R.tratadas, 1);
  assert.equal(R.pct, 20);
});

test("o mesmo caso nunca aparece em duas folhas", () => {
  const cs = exemplo();
  const nova = fmContaPeriodo(cs, abonos, P, HOJE), velha = fmContaPeriodo(cs, abonos, { ini: "2026-08-26", fim: "2026-09-25", atual: false }, HOJE);
  const naNova = new Set(nova.base.map(c => c.re)), naVelha = new Set(velha.base.map(c => c.re));
  [...naNova].forEach(re => assert.ok(!naVelha.has(re), "caso " + re + " está nas duas folhas"));
  assert.equal(naNova.size + naVelha.size, cs.length, "cada caso está em exatamente uma folha");
});

test("limites da folha: dia 25 é da folha que fecha, dia 26 é da nova", () => {
  const cs = [caso(1, "ANA", "NO_PRAZO", ["2026-09-25"], { prazoFim: "2026-10-01" }), caso(2, "ANA", "NO_PRAZO", ["2026-09-26"], { prazoFim: "2026-10-01" })];
  const R = fmContaPeriodo(cs, [], P, HOJE);
  assert.deepEqual(R.anteriores.map(c => c.re), [1]);
  assert.deepEqual(R.abertos.map(c => c.re), [2]);
  assert.equal(R.faltas, 1);
});

test("sem faltas no período: % tratado fica vazio (e não 0%)", () => {
  const R = fmContaPeriodo([], [], P, HOJE);
  assert.equal(R.pct, null);
  assert.equal(R.faltas, 0);
  assert.deepEqual(R.sups, []);
});

test("supervisor que só tem casos de antes aparece na tabela, mas com 0 em aberto na folha", () => {
  const R = fmContaPeriodo([caso(1, "CLÁUDIO", "COORDENACAO", ["2026-09-20"])], [], P, HOJE);
  assert.deepEqual(R.abertos, []);
  const c = R.sups.find(x => x.nome === "CLÁUDIO");
  assert.deepEqual([c.abertos, c.ant], [0, 1]);
});

test("caso tratado que começou na folha anterior não entra na folha nova (mesmo com falta depois do dia 26)", () => {
  const c = caso(30, "ANA", "TRATADA", ["2026-09-24", "2026-09-25", "2026-09-26"]);
  const nova = fmContaPeriodo([c], [], P, HOJE);
  assert.equal(nova.faltas, 0);
  assert.deepEqual(nova.concluidas, []);
  const velha = fmContaPeriodo([c], [], { ini: "2026-08-26", fim: "2026-09-25", atual: false }, HOJE);
  assert.equal(velha.faltas, 3, "as 3 faltas ficam na folha do caso");
  assert.equal(velha.tratadas, 3);
  assert.deepEqual(velha.concluidas.map(x => x.re), [30]);
});

// ── calendário compacto: servidor e tela precisam dar exatamente o mesmo resultado ─────
test("calendário compacto: ida e volta não perde nada, e a tela expande igual ao servidor", () => {
  const R = require("../api/_faltas_regras");
  const i2 = html.indexOf("const FM_TIPOS_CAL="), f2 = html.indexOf("/* Calendário do mês (dia 1 ao último)");
  assert.ok(i2 > 0 && f2 > i2, "fmCalDe não encontrada no index.html");
  const fmCalDe = new Function(html.slice(i2, f2) + "\nreturn fmCalDe;")();
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

// ── colunas "Faltas" e "Vínculo" das listas ────────────────────────────────────────────
test("colunas da lista: vínculo (efetivo no posto / reserva técnica) e datas das faltas", () => {
  const i3 = html.indexOf("/*ini colunas*/"), f3 = html.indexOf("/*fim colunas*/");
  assert.ok(i3 > 0 && f3 > i3, "funções das colunas não encontradas no index.html");
  const { fmVinculoRot, fmFaltasTxt } = new Function(html.slice(i3, f3) + "\nreturn { fmVinculoRot, fmFaltasTxt };")();
  assert.deepEqual([fmVinculoRot("CONTRATO").t, fmVinculoRot("contrato").c], ["Efetivo", "ef"], "CONTRATO = efetivo no posto (maiúsculas não importam)");
  assert.deepEqual([fmVinculoRot("RESERVA").t, fmVinculoRot("RESERVA").c], ["Reserva técnica", "rt"]);
  assert.equal(fmVinculoRot("").t, "—", "sem a informação, mostra traço");
  assert.equal(fmVinculoRot(null).d, "Vínculo não informado");
  assert.equal(fmFaltasTxt(["2026-09-25", "2026-09-24"]), "24/09 · 25/09", "em ordem, dia/mês");
  assert.equal(fmFaltasTxt(["2026-09-24", "2026-09-24"]), "24/09", "sem repetir");
  assert.equal(fmFaltasTxt(["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"]), "24/09 · 25/09 · 28/09 · 29/09", "até 4 datas aparecem todas");
  assert.equal(fmFaltasTxt(["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"]), "22/09 · 23/09 · 24/09 · +3", "mais de 4: as 3 primeiras e quantas faltam");
  assert.equal(fmFaltasTxt([]), "—");
  assert.equal(fmFaltasTxt(undefined), "—");
});

// ── cartões de supervisor: o supervisor escolhido vale para a tela toda ──
const pega = nome => {
  const i = html.indexOf("function " + nome + "("); assert.ok(i > 0, nome + " não encontrada");
  let d = 0, k = html.indexOf("{", i);
  for (; k < html.length; k++) { if (html[k] === "{") d++; else if (html[k] === "}" && --d === 0) break; }
  return html.slice(i, k + 1);
};

test("nome no cartão: 'CARLOS NOGUEIRA' vira 'Carlos Nogueira', com acento e hífen", () => {
  const fmNomeCard = new Function(pega("fmNomeCard") + "\nreturn fmNomeCard;")();
  assert.equal(fmNomeCard("CARLOS NOGUEIRA"), "Carlos Nogueira");
  assert.equal(fmNomeCard("PAULO SÉRGIO"), "Paulo Sérgio");
  assert.equal(fmNomeCard("ANA-MARIA DA SILVA"), "Ana-Maria Da Silva");
  assert.equal(fmNomeCard(""), "");
});

test("filtro por supervisor: só a área dele; 'Sem supervisor' também dá para escolher", () => {
  const mk = FM => new Function("FM", "fmFam", pega("fmFiltraG") + "\nreturn fmFiltraG;")(FM, x => x);
  const f = mk({ sup: "CARLOS NOGUEIRA", turno: "", escala: "", posto: "" });
  assert.equal(f({ supervisor: "CARLOS NOGUEIRA" }), true);
  assert.equal(f({ supervisor: "EDNEY FERRAZ" }), false);
  assert.equal(f({ supervisor: "" }), false);
  const g = mk({ sup: "Sem supervisor", turno: "", escala: "", posto: "" });
  assert.equal(g({ supervisor: "" }), true);
  assert.equal(g({ supervisor: null }), true);
  assert.equal(g({ supervisor: "CARLOS NOGUEIRA" }), false);
  const t = mk({ sup: "", turno: "", escala: "", posto: "" });
  assert.equal(t({ supervisor: "QUALQUER" }), true);
});
