// A tela (index.html) repete três coisas do servidor que não podem divergir:
// a contagem de SMS, os termos proibidos e as colunas permitidas da base de
// contatos. Este teste extrai o código do index.html e compara com o servidor.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const R = require("../api/_ponto_regras");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

function trecho(inicio, fim) {
  const a = html.indexOf(inicio);
  const b = html.indexOf(fim, a);
  assert.ok(a >= 0 && b > a, `trecho não encontrado no index.html: ${inicio}`);
  return html.slice(a, b + fim.length);
}

const codigo = trecho("const PT_GSM7=", "segmentos};\n}");
const contexto = vm.createContext({});
vm.runInContext(codigo + "\nthis.ptAnalisarSMS = ptAnalisarSMS;", contexto);
const ptAnalisarSMS = contexto.ptAnalisarSMS;

test("a contagem de SMS da tela é a mesma do servidor", () => {
  const fixos = [
    "", "a", "a".repeat(160), "a".repeat(161), "a".repeat(306), "a".repeat(307),
    "ã" + "a".repeat(69), "ã" + "a".repeat(70), "{}[]~^|\\€", "a".repeat(159) + "[", "é à Ç", "ç", "😀 teste", "linha 1\nlinha 2\r\n",
    R.renderizar(R.MODELOS_PADRAO.entrada_antecipada, { nome: "Maria", data: "24/09", horario_marcado: "17:54", horario_previsto: "18:00", minutos: 6, re: 521 }),
    R.renderizar(R.MODELOS_PADRAO.ambas_no_mesmo_dia, { nome: "Maria", data: "24/09", entrada_marcada: "07:40", saida_marcada: "17:30", entrada_prevista: "08:00", saida_prevista: "17:00", re: 521 })
  ];
  const alfabeto = Array.from("abcXYZ019 .,!?-éàÇçãõáíóú{}[]~^|€\n@£$¥😀`");
  let semente = 7;
  const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const sorteados = Array.from({ length: 400 }, () => Array.from({ length: Math.floor(aleatorio() * 340) }, () => alfabeto[Math.floor(aleatorio() * alfabeto.length)]).join(""));
  for (const t of fixos.concat(sorteados)) {
    assert.deepEqual({ ...ptAnalisarSMS(t) }, R.analisarSMS(t), JSON.stringify(t).slice(0, 80));
  }
});

test("a tela avisa sobre os mesmos termos que o servidor recusa", () => {
  const m = html.match(/const PT_PROIBIDO=(\/.*\/[a-z]*);/);
  assert.ok(m, "PT_PROIBIDO não encontrado no index.html");
  const daTela = vm.runInNewContext(m[1]);
  assert.equal(daTela.source, R.PROIBIDO_NA_MENSAGEM.source);
  assert.equal(daTela.flags, R.PROIBIDO_NA_MENSAGEM.flags);
});

test("a tela só envia as colunas que o servidor aceita na base de contatos", () => {
  const m = html.match(/const PT_COLS_CONTATO=(\[[^\]]*\]);/);
  assert.ok(m, "PT_COLS_CONTATO não encontrado no index.html");
  assert.deepEqual(JSON.parse(m[1]), R.CAMPOS_CONTATO);
});
