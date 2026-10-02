// Painel da diretoria (card Faltas x Medidas da Visão Geral): taxa de conclusão e pendências,
// por supervisor e por posto. As funções são lidas direto do index.html.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const ini = html.indexOf("function fmContaPeriodo("), fim = html.indexOf("/*fim fmContaPeriodo*/");
assert.ok(ini > 0 && fim > ini, "fmContaPeriodo não encontrada");
function funcao(nome) {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i > 0, nome + " não encontrada");
  let d = 0, k = html.indexOf("{", i);
  for (; k < html.length; k++) { if (html[k] === "{") d++; else if (html[k] === "}" && --d === 0) break; }
  return html.slice(i, k + 1);
}
const { fmContaPeriodo, vgFmAgrupar, vgFmTom } = new Function("FM_ABERTAS",
  html.slice(ini, fim) + "\n" + funcao("vgFmAgrupar") + "\nconst vgFmTom=" + html.match(/const vgFmTom=(.*);\n/)[1] + ";\nreturn{fmContaPeriodo,vgFmAgrupar,vgFmTom};")(["PRAZO_VENCIDO", "NO_PRAZO", "AGUARDANDO_RETORNO", "COORDENACAO"]);

const P = { ini: "2026-09-26", fim: "2026-10-25", atual: true }, HOJE = "2026-10-01";
const caso = (re, sup, posto, situacao, faltas, extra) => ({ re, nome: "P" + re, supervisor: sup, posto, situacao, faltas, primeiraFalta: faltas[0], ...extra });
const casos = () => [
  caso(1, "ANA", "POSTO A", "PRAZO_VENCIDO", ["2026-09-27"], { prazoFim: "2026-09-30" }),
  caso(2, "ANA", "POSTO A", "TRATADA", ["2026-09-28", "2026-09-29"]),                    // 2 faltas com medida
  caso(3, "ANA", "POSTO B", "NO_PRAZO", ["2026-09-30"], { prazoFim: "2026-10-03" }),
  caso(4, "BIA", "POSTO B", "TRATADA_FORA_DO_PRAZO", ["2026-09-26"]),
  caso(5, "BIA", "POSTO C", "AGUARDANDO_RETORNO", ["2026-10-01"]),
  caso(6, "BIA", "POSTO C", "COORDENACAO", ["2026-09-26", "2026-09-27"]),
  caso(7, "BIA", "POSTO C", "PRAZO_VENCIDO", ["2026-09-20"], { prazoFim: "2026-09-25" }),  // começou na folha anterior: à parte
  caso(8, "", "", "PRAZO_VENCIDO", ["2026-09-29"], { prazoFim: "2026-09-30" })            // sem supervisor e sem posto
];

test("taxa de conclusão: só faltas da folha, com medida ÷ todas; o caso da folha anterior fica à parte", () => {
  const R = fmContaPeriodo(casos(), [], P, HOJE);
  // faltas da folha: 1+2+1+1+1+2+1 = 9; com medida: 2+1 = 3 → 33%
  assert.equal(R.faltas, 9);
  assert.equal(R.tratadas, 3);
  assert.equal(R.pct, 33);
  assert.equal(R.abertos.length, 5, "pendentes da folha: 1, 3, 5, 6, 8");
  assert.equal(R.anteriores.length, 1);
});

test("por supervisor: faltas, tratadas, pendentes, atrasadas e % de cada um", () => {
  const R = fmContaPeriodo(casos(), [], P, HOJE);
  const g = Object.fromEntries(vgFmAgrupar(R, c => c.supervisor || "Sem supervisor").map(x => [x.nome, x]));
  assert.deepEqual([g.ANA.faltas, g.ANA.tratadas, g.ANA.pend.length, g.ANA.da, g.ANA.pct], [4, 2, 2, 1, 50]);
  assert.deepEqual([g.BIA.faltas, g.BIA.tratadas, g.BIA.pend.length, g.BIA.ant.length, g.BIA.pct], [4, 1, 2, 1, 25]);
  assert.deepEqual([g["Sem supervisor"].faltas, g["Sem supervisor"].pend.length, g["Sem supervisor"].pct], [1, 1, 0]);
});

test("por posto: as somas fecham com o total (nada some nem conta duas vezes)", () => {
  const R = fmContaPeriodo(casos(), [], P, HOJE);
  const por = vgFmAgrupar(R, c => c.posto || "Sem posto");
  assert.equal(por.reduce((s, x) => s + x.faltas, 0), R.faltas);
  assert.equal(por.reduce((s, x) => s + x.pend.length, 0), R.abertos.length);
  assert.equal(por.reduce((s, x) => s + x.ant.length, 0), R.anteriores.length);
  const c = Object.fromEntries(por.map(x => [x.nome, x]));
  assert.deepEqual([c["POSTO C"].pend.length, c["POSTO C"].ant.length], [2, 1]);
  assert.ok(c["Sem posto"], "caso sem posto aparece em 'Sem posto'");
});

test("cor da taxa: verde a partir de 80%, âmbar a partir de 50%, vermelho abaixo; sem dado fica neutro", () => {
  assert.equal(vgFmTom(100), "ok"); assert.equal(vgFmTom(80), "ok");
  assert.equal(vgFmTom(79), "am"); assert.equal(vgFmTom(50), "am");
  assert.equal(vgFmTom(49), "da"); assert.equal(vgFmTom(0), "da");
  assert.equal(vgFmTom(null), "gr");
});

test("o card só abre para quem tem permissão e a linha do card abre o painel da diretoria", () => {
  assert.ok(html.includes("function vgFmDir(){\n  if(!fmPermitido())return;"));
  assert.ok(html.includes('onclick="event.stopPropagation();vgFmDir()"'));
});
