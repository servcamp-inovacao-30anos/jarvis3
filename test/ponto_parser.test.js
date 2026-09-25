// Leitura da aba HR EXTRA: horários e RE que o monitoramento de ponto usa.
// Roda no fuso de São Paulo de propósito — é onde a planilha é aberta no
// navegador, e onde datas-base de 1899 têm fuso histórico quebrado.
process.env.TZ = "America/Sao_Paulo";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const P = require("../api/_parse");

const lerArquivo = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");
function trecho(texto, inicio, fim) {
  const a = texto.indexOf(inicio);
  const b = texto.indexOf(fim, a);
  assert.ok(a >= 0 && b > a, `trecho não encontrado: ${inicio}`);
  return texto.slice(a, b + fim.length);
}

test("os dois parsers (navegador e servidor) seguem idênticos", async t => {
  const servidor = lerArquivo("api/_parse.js"), navegador = lerArquivo("index.html");
  await t.test("horaDaCelula", () => {
    const ini = "// Horario de uma celula de ponto", fim = 'return hm?(dia?dia+"T"+hm:hm):"";\n}';
    assert.equal(trecho(navegador, ini, fim), trecho(servidor, ini, fim));
  });
  await t.test("bloco da aba HR EXTRA", () => {
    const ini = 'const wsHE=findSheet(wb,"HR EXTRA")', fim = 'console.warn("[HR EXTRA] Guia não encontrada. Guias:",wb.SheetNames.join(", "));}';
    assert.equal(trecho(navegador, ini, fim), trecho(servidor, ini, fim));
  });
});

test("horaDaCelula", async t => {
  await t.test("fração de dia do Excel", () => {
    assert.equal(P.horaDaCelula((17 * 60 + 54) / 1440, ""), "17:54");
    assert.equal(P.horaDaCelula(0, ""), "00:00");
  });
  await t.test("serial com data", () => {
    const serial = 46290 + (6 * 60 + 30) / 1440; // 25/09/2026 06:30
    assert.equal(P.horaDaCelula(serial, ""), "2026-09-25T06:30");
  });
  await t.test("o texto formatado manda na hora", () => {
    assert.equal(P.horaDaCelula(new Date(1899, 11, 30, 6, 29, 59, 999), "06:30"), "06:30");
    assert.equal(P.horaDaCelula("", "6:30 PM"), "18:30");
    assert.equal(P.horaDaCelula("", "12:05 AM"), "00:05");
    assert.equal(P.horaDaCelula("", "07:00:00"), "07:00");
  });
  await t.test("Date com data real", () => {
    assert.equal(P.horaDaCelula(new Date(2026, 8, 25, 6, 30), "25/09/2026 06:30"), "2026-09-25T06:30");
  });
  await t.test("célula vazia", () => {
    assert.equal(P.horaDaCelula("", ""), "");
    assert.equal(P.horaDaCelula(null, null), "");
  });
});

function planilha(linhasHE, cabecalho) {
  const wb = XLSX.utils.book_new();
  const cab = cabecalho || ["FUNCIONARIO", "DATA", "AREASUPERVISAO", "LOCAL", "CLIENTE", "TIPOEXTRA", "HRENTRADA", "HRMRENTRADA", "HRSAIDA", "HRMRSAIDA"];
  // Datas e horas entram como número serial com formato de célula — é assim
  // que o Excel grava. (Montar a célula a partir de um Date do JavaScript
  // desloca a data em um dia no fuso de São Paulo e não representa a planilha real.)
  const he = XLSX.utils.aoa_to_sheet([cab, ...linhasHE]);
  const range = XLSX.utils.decode_range(he["!ref"]);
  cab.forEach((c, j) => {
    for (let i = 1; i <= range.e.r; i++) {
      const cel = he[XLSX.utils.encode_cell({ r: i, c: j })];
      if (!cel || typeof cel.v !== "number") continue;
      if (c === "DATA") cel.z = "m/d/yy";
      else if (/^HR/.test(c)) cel.z = cel.v >= 1 ? "dd/mm/yyyy hh:mm" : "hh:mm";
    }
  });
  XLSX.utils.book_append_sheet(wb, he, "HR EXTRA");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["RE", "FUNCIONARIO"], [521, "MARIA DA SILVA"], [522, "JOAO SOUZA"]]), "FUNCIONARIOS ATIVOS");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  // mesmas opções do api/import.js e do index.html
  return P.buildDataFromWorkbook(XLSX.read(buf, { type: "buffer", cellDates: true }));
}

const h = (hh, mm) => (hh * 60 + mm) / 1440;

test("aba HR EXTRA lida de uma planilha real (.xlsx)", async t => {
  const data = planilha([
    ["MARIA DA SILVA", 46289, "FRANK", "POSTO A", "CLIENTE A", "EXTRA ENTRADA", h(18, 0), h(17, 54), h(6, 0), h(6, 0)],
    ["JOAO SOUZA", 46289, "FRANK", "POSTO B", "CLIENTE B", "EXTRA SAIDA", h(8, 0), h(8, 0), h(17, 0), h(17, 45)],
    ["JOAO SOUZA", 46290, "FRANK", "POSTO B", "CLIENTE B", "EXTRA SAIDA", h(22, 0), h(22, 0), h(6, 0), 46290 + h(6, 30)]
  ]);
  const [maria, joao, noturno] = data.hrextra;

  await t.test("horários previstos e marcados em HH:MM", () => {
    assert.deepEqual([maria.HRENTRADA, maria.HRMRENTRADA, maria.HRSAIDA, maria.HRMRSAIDA], ["18:00", "17:54", "06:00", "06:00"]);
    assert.deepEqual([joao.HRENTRADA, joao.HRMRENTRADA, joao.HRSAIDA, joao.HRMRSAIDA], ["08:00", "08:00", "17:00", "17:45"]);
  });
  await t.test("marcação com data completa mantém a data", () => {
    assert.equal(noturno.HRMRSAIDA, "2026-09-25T06:30");
  });
  await t.test("campos que já existiam continuam iguais", () => {
    assert.equal(maria.NOME, "MARIA DA SILVA");
    assert.equal(maria.DATA, "2026-09-24");
    assert.equal(maria.TIPO, "EXTRA ENTRADA");
    assert.equal(maria.AREA, "FRANK");
    assert.equal(maria.CLIENTE, "CLIENTE A");
  });
  await t.test("sem coluna RE, o campo fica vazio", () => {
    assert.equal(maria.RE, "");
  });
});

test("aba HR EXTRA com coluna RE", () => {
  const data = planilha(
    [[521, "MARIA DA SILVA", 46289, "EXTRA ENTRADA", h(18, 0), h(17, 54), h(6, 0), h(6, 0)]],
    ["RE", "FUNCIONARIO", "DATA", "TIPOEXTRA", "HRENTRADA", "HRMRENTRADA", "HRSAIDA", "HRMRSAIDA"]
  );
  assert.equal(String(data.hrextra[0].RE), "521");
});

test("aba HR EXTRA sem as colunas de horário não quebra", () => {
  const data = planilha([["MARIA DA SILVA", 46289, "EXTRA ENTRADA"]], ["FUNCIONARIO", "DATA", "TIPOEXTRA"]);
  const r = data.hrextra[0];
  assert.deepEqual([r.HRENTRADA, r.HRMRENTRADA, r.HRSAIDA, r.HRMRSAIDA], ["", "", "", ""]);
});

test("normNome é a mesma normalização do ativosNomeMap", () => {
  assert.equal(P.normNome("  maria   da silva "), "MARIA DA SILVA");
  assert.equal(P.normNome("José"), "JOSÉ", "não remove acento: o casamento de nomes do sistema também não remove");
});
