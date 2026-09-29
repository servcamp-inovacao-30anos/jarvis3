// Leitura da planilha para o módulo Faltas x Medidas: escala da falta, dias
// trabalhados de quem faltou, data de admissão e número do processo disciplinar.
process.env.TZ = "America/Sao_Paulo";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const P = require("../api/_parse");

const lerArquivo = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");

test("o leitor do navegador e o do servidor são a mesma função", () => {
  const ini = "function buildDataFromWorkbook(wb){", fim = "  return data;\n}";
  const corpo = t => { const a = t.indexOf(ini); assert.ok(a >= 0, "função não encontrada"); return t.slice(a, t.indexOf(fim, a) + fim.length); };
  // A única linha escrita diferente de propósito: o navegador não tem normNome
  // e repete a mesma normalização por extenso.
  const semNormNome = t => t.split("\n").filter(l => !l.includes("ativosNomeMap[k]=r;")).join("\n");
  assert.equal(semNormNome(corpo(lerArquivo("index.html"))), semNormNome(corpo(lerArquivo("api/_parse.js"))));
});

// Datas entram como número serial com formato de data, como o Excel grava.
function aba(linhas) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const cab = linhas[0], range = XLSX.utils.decode_range(ws["!ref"]);
  cab.forEach((c, j) => {
    if (!/^(DATA|DT)/.test(c)) return;
    for (let i = 1; i <= range.e.r; i++) {
      const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })];
      if (cel && typeof cel.v === "number") cel.z = "m/d/yy";
    }
  });
  return ws;
}
const D = (d, m) => { // dia/mês de 2026 → serial do Excel
  const base = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(2026, m - 1, d) - base) / 86400000);
};

function planilha() {
  const wb = XLSX.utils.book_new();
  const cabF = ["RE", "NOMEFUNCIONARIO", "DATA", "DESCSITUACAOHOJE", "DESCESCALA", "DESCTPABONO", "NOMELOCAL", "DESC_CARGO", "AREASUPERVISAO", "TPCLIENTE", "DESCTPCOBERTURA", "HRENTRADA"];
  XLSX.utils.book_append_sheet(wb, aba([cabF,
    [521, "MARIA DA SILVA", D(9, 10), "TRABALHANDO", "5X2 SDF", null, "POSTO A", "PORTEIRO (A)", "FRANK", "CONTRATO", null, "07:00"],
    [521, "MARIA DA SILVA", D(10, 10), "FALTA", "5X2 SDF", "I", "POSTO A", "PORTEIRO (A)", "FRANK", "CONTRATO", null, "07:00"],
    [521, "MARIA DA SILVA", D(13, 10), "TRABALHANDO", "5X2 SDF", null, "POSTO A", "PORTEIRO (A)", "FRANK", "CONTRATO", null, "07:00"],
    [521, "MARIA DA SILVA", D(13, 10), "FT", "5X2 SDF", null, "POSTO B", "PORTEIRO (A)", "FRANK", "CONTRATO", "FT", "19:00"],
    [522, "JOAO SOUZA", D(10, 10), "TRABALHANDO", "12X36", null, "POSTO C", "PORTEIRO (A)", "CARLOS", "CONTRATO", null, "07:00"]
  ]), "FICHA PRESENCA");
  XLSX.utils.book_append_sheet(wb, aba([["RE", "FUNCIONARIO", "CARGO", "AREASUPERVISAO", "ESCALA", "DTADMISSAO"],
    [521, "MARIA DA SILVA", "PORTEIRO (A)", "FRANK", "5X2 SDF", D(2, 3)],
    [522, "JOAO SOUZA", "PORTEIRO (A)", "CARLOS", "12X36", null]
  ]), "FUNCIONARIOS ATIVOS");
  const cabD = ["HISTDISCIPLINAR", "RE", "NOME", "PUNICAO", "DESCRICAO", "DTINICIOOCORRENCIA", "DTFIMAFASTAMENTO", "CLIENTE", "LOCAL", "FASEATUAL"];
  XLSX.utils.book_append_sheet(wb, aba([cabD,
    ["P-100", 521, "MARIA DA SILVA", "ADVERTENCIA ESCRITA", "FALTA INJUSTIFICADA", D(13, 10), null, "POSTO A", "PORTEIRO (A)", "CONCLUIDO"],
    ["P-100", 521, "MARIA DA SILVA", "ADVERTENCIA ESCRITA", "FALTA INJUSTIFICADA", D(13, 10), null, "POSTO B", "PORTEIRO (A)", "CONCLUIDO"],
    ["P-101", 522, "JOAO SOUZA", "", "ATESTADO MEDICO", D(8, 10), D(9, 10), "POSTO C", "PORTEIRO (A)", "CONCLUIDO"]
  ]), "DISCIPLINA");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  // mesmas opções do api/import.js e do index.html
  return P.buildDataFromWorkbook(XLSX.read(buf, { type: "buffer", cellDates: true }));
}

test("faltas trazem a escala", () => {
  const data = planilha();
  assert.equal(data.faltas.length, 1);
  assert.equal(data.faltas[0].ESCALA, "5X2 SDF");
  assert.equal(data.faltas[0].DATA, "2026-10-10");
  assert.equal(data.faltas[0].ABONO, "I");
});

test("dias da ficha: com todas as situações do dia", async t => {
  const data = planilha();
  await t.test("quem faltou tem os dias guardados", () => {
    assert.deepEqual(data.fichaDias["521"], {
      "2026-10-09": "TRABALHANDO",
      "2026-10-10": "FALTA",
      "2026-10-13": "TRABALHANDO|FT"
    });
  });
  await t.test("quem não faltou também tem os dias recentes (pode ter faltado numa planilha anterior)", () => {
    assert.deepEqual(data.fichaDias["522"], { "2026-10-10": "TRABALHANDO" });
  });
});

test("quadro de ativos traz a data de admissão", () => {
  const data = planilha();
  const maria = data.ativos.find(a => String(a.RE) === "521");
  const joao = data.ativos.find(a => String(a.RE) === "522");
  assert.equal(maria.ADMISSAO, "2026-03-02");
  assert.equal(joao.ADMISSAO, null, "sem data na planilha, fica vazio");
});

test("medidas trazem o número do processo, sem repetir", () => {
  const data = planilha();
  assert.equal(data.disciplina.length, 1, "a mesma medida em duas linhas entra uma vez; atestado não é medida");
  assert.equal(data.disciplina[0].HIST, "P-100");
  assert.equal(data.disciplina[0].DATA, "2026-10-13");
  assert.equal(data.disciplina[0].FASE, "CONCLUIDO");
});

test("dias da ficha: quem não faltou nesta planilha fica com os últimos 10 dias", () => {
  const wb = XLSX.utils.book_new();
  const cab = ["RE", "NOMEFUNCIONARIO", "DATA", "DESCSITUACAOHOJE", "DESCESCALA", "DESCTPABONO"];
  XLSX.utils.book_append_sheet(wb, aba([cab,
    [600, "ANTIGA", D(1, 10), "TRABALHO", "5X2 SDF", null],
    [600, "ANTIGA", D(20, 10), "TRABALHO", "5X2 SDF", null],
    [601, "FALTOU", D(1, 10), "TRABALHO", "5X2 SDF", null],
    [601, "FALTOU", D(20, 10), "FALTA", "5X2 SDF", "I"]
  ]), "FICHA PRESENCA");
  const data = P.buildDataFromWorkbook(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true }));
  assert.deepEqual(Object.keys(data.fichaDias["600"]), ["2026-10-20"], "01/10 está a mais de 10 dias do último dia");
  assert.deepEqual(Object.keys(data.fichaDias["601"]).sort(), ["2026-10-01", "2026-10-20"], "quem faltou guarda todos os dias");
});
