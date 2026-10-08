// Modo TV do Acompanhamento de Medidas (Supervisão): regras de quem entra, contagem da folha atual, ordem e cores.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const H = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const A = H.indexOf("/* ═════════ MODO TV — ACOMPANHAMENTO DE MEDIDAS"), B = H.indexOf("const FTV_IC=");

function carrega(hoje, casos, abonos) {
  assert.ok(A > 0 && B > A, "bloco do Modo TV no index.html");
  const _fmP2 = n => String(n).padStart(2, "0");
  const fmIniFolhaAtual = () => { const [a, m, d] = hoje.split("-").map(Number); if (d >= 26) return `${a}-${_fmP2(m)}-26`; return m === 1 ? `${a - 1}-12-26` : `${a}-${_fmP2(m - 1)}-26`; };
  const fmDif = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
  const fmDd = d => { const p = String(d).split("-"); return p[2] + "/" + p[1]; };
  const fmNomeCard = n => String(n || "").toLowerCase().replace(/(^|\s|-)(\S)/g, (m, a, b) => a + b.toUpperCase());
  const FM = { dados: { hoje, casos, abonos: abonos || [] } };
  const FM_ABERTAS = ["PRAZO_VENCIDO", "NO_PRAZO", "AGUARDANDO_RETORNO", "COORDENACAO"];
  const fmAbonos = () => FM.dados.abonos;
  return new Function("FM", "FM_ABERTAS", "fmAbonos", "fmIniFolhaAtual", "fmDif", "fmDd", "fmNomeCard", "_fmP2",
    H.slice(A, B) + "; return {ftvDados, ftvFolha, ftvNome, ftvColunas, ftvCores};")(FM, FM_ABERTAS, fmAbonos, fmIniFolhaAtual, fmDif, fmDd, fmNomeCard, _fmP2);
}
const caso = (re, sup, situacao, faltas, prazoFim, extra) => ({ re, nome: "MARIA DA SILVA SANTOS " + re, posto: "POSTO " + re, supervisor: sup, situacao, faltas, prazoFim, primeiraFalta: faltas[0], ...(extra || {}) });

test("entram todos os casos em aberto; com medida aplicada não entram; atestados (abonos) não são caso", () => {
  const T = carrega("2026-10-07", [
    caso(1, "CARLOS NOGUEIRA", "PRAZO_VENCIDO", ["2026-09-28"], "2026-09-29"),
    caso(2, "CARLOS NOGUEIRA", "NO_PRAZO", ["2026-10-05"], "2026-10-09"),
    caso(3, "CARLOS NOGUEIRA", "AGUARDANDO_RETORNO", ["2026-10-06"], null),
    caso(4, "CARLOS NOGUEIRA", "COORDENACAO", ["2026-10-01", "2026-10-02"], null),
    caso(5, "CARLOS NOGUEIRA", "TRATADA", ["2026-10-01"], "2026-10-02"),
    caso(6, "CARLOS NOGUEIRA", "TRATADA_FORA_DO_PRAZO", ["2026-10-01"], "2026-10-02")
  ], [{ re: 9, supervisor: "FRANK PIMENTEL", faltas: ["2026-10-03"] }]);
  const D = T.ftvDados(), c = D.lista.find(x => x.nome === "CARLOS NOGUEIRA"), f = D.lista.find(x => x.nome === "FRANK PIMENTEL");
  assert.deepEqual(c.itens.map(i => i.c.re), [1, 2, 3, 4]);
  assert.equal(c.faltas, 5, "dias de falta injustificada esperando medida");
  assert.ok(f && f.itens.length === 0 && f.faltas === 0, "supervisor só com atestado aparece, em dia");
});

test("sempre a folha atual (26 a 25): falta de antes do dia 26 não conta; caso só da folha anterior não aparece", () => {
  const T = carrega("2026-10-07", [
    caso(1, "ANA", "PRAZO_VENCIDO", ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"], "2026-09-28"),
    caso(2, "ANA", "PRAZO_VENCIDO", ["2026-09-20"], "2026-09-21"),
    caso(3, "ANA", "NO_PRAZO", ["2026-10-25"], "2026-10-27"),
    caso(4, "ANA", "NO_PRAZO", ["2026-10-26"], "2026-10-28")
  ]);
  assert.deepEqual(T.ftvFolha(), { ini: "2026-09-26", fim: "2026-10-25" });
  const a = T.ftvDados().lista[0];
  assert.deepEqual(a.itens.map(i => [i.c.re, i.fl.length]), [[1, 2], [3, 1]]);
  assert.equal(a.faltas, 3);
});

test("folha na virada do ano e a partir do dia 26", () => {
  assert.deepEqual(carrega("2027-01-10", []).ftvFolha(), { ini: "2026-12-26", fim: "2027-01-25" });
  assert.deepEqual(carrega("2026-12-26", []).ftvFolha(), { ini: "2026-12-26", fim: "2027-01-25" });
  assert.deepEqual(carrega("2026-10-26", []).ftvFolha(), { ini: "2026-10-26", fim: "2026-11-25" });
});

test("ordem no card: atrasadas, vence hoje, no prazo, ainda não voltou, coordenação; prazo mais antigo primeiro", () => {
  const T = carrega("2026-10-07", [
    caso(1, "ANA", "COORDENACAO", ["2026-10-01"], null),
    caso(2, "ANA", "NO_PRAZO", ["2026-10-05"], "2026-10-09"),
    caso(3, "ANA", "AGUARDANDO_RETORNO", ["2026-10-06"], null),
    caso(4, "ANA", "NO_PRAZO", ["2026-10-06"], "2026-10-07"),
    caso(5, "ANA", "PRAZO_VENCIDO", ["2026-09-30"], "2026-10-02"),
    caso(6, "ANA", "PRAZO_VENCIDO", ["2026-09-28"], "2026-09-29")
  ]);
  const a = T.ftvDados().lista[0];
  assert.deepEqual(a.itens.map(i => i.c.re), [6, 5, 4, 2, 3, 1]);
  assert.deepEqual(a.itens.map(i => i.cat), ["da", "da", "hj", "np", "gr", "vi"]);
  assert.deepEqual([a.itens[0].p.b, a.itens[0].p.s, a.itens[2].p.b, a.itens[3].p.b, a.itens[3].p.s], ["Vencido em 29/09", "há 8 dias", "Vence hoje", "Até 09/10", "faltam 2 dias"]);
  assert.deepEqual([a.itens[4].p.b, a.itens[5].p.b], ["No próximo plantão", "Coordenação"]);
});

test("nome e sobrenome; cores diferentes para cada supervisor; colunas que deixam o card maior", () => {
  const T = carrega("2026-10-07", []);
  assert.equal(T.ftvNome("MARIA DA SILVA SANTOS"), "Maria Santos");
  assert.equal(T.ftvNome("JOAO"), "Joao");
  const nomes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"], cor = T.ftvCores(nomes);
  assert.equal(new Set(Object.values(cor)).size, nomes.length, "nenhuma cor repetida");
  assert.equal(T.ftvColunas(8, 1880, 860), 4);
  assert.equal(T.ftvColunas(1, 1880, 860), 1);
  assert.ok(T.ftvColunas(12, 1880, 860) >= 4);
  assert.equal(T.ftvColunas(14, 1880, 860), 5, "com 14 supervisores, 5 colunas: card largo o bastante para ler o nome e a data");
});

test("tela: nome novo no menu e no título, botão Modo TV, endereço ?tv=medidas só para quem vê a supervisão", () => {
  assert.ok(!H.includes("Faltas da Supervisão"), "o nome antigo saiu");
  assert.ok(H.includes('<span>Acompanhamento de Medidas (Supervisão)</span>') && H.includes('faltassup:"Acompanhamento de Medidas (Supervisão)"'));
  assert.ok(H.includes('onclick="ftvAbrir()"'), "botão Modo TV na tela da supervisão");
  assert.ok(/function ftvChecar\(\)\{[\s\S]*?get\("tv"\)!=="medidas"[\s\S]*?fsPermitido\(\)/.test(H), "endereço só abre para quem tem a tela da supervisão");
  assert.equal((H.match(/tvModoChecar\(\); ftvChecar\(\);/g) || []).length, 2, "confere no carregamento e depois do login");
  assert.ok(/function ftvAbrir\(\)\{\s*if\(!fsPermitido\(\)\)return;/.test(H));
});

test("identidade arcade: estilo, fontes e cena da central são arquivos do próprio sistema", () => {
  const raiz = path.join(__dirname, "..");
  assert.ok(H.includes('<link rel="stylesheet" href="/assets/tv/modo-tv.css">'), "estilo do Modo TV ligado no fim da página");
  const css = fs.readFileSync(path.join(raiz, "assets", "tv", "modo-tv.css"), "utf8");
  for (const f of ["/fonts/Jersey10.woff2", "/fonts/VT323.woff2", "/assets/tv/central-operacional.webp"]) {
    assert.ok(css.includes("url(" + f + ")"), f + " usado no estilo");
    assert.ok(fs.existsSync(path.join(raiz, f)), f + " existe no repositório");
  }
  assert.ok(/prefers-reduced-motion:reduce\)\{#ftv \.ftv-op/.test(css), "a cena para de se mexer com reduzir movimento");
  assert.ok(H.includes('<div class="ftv-palco ftv-cena" aria-hidden="true">'), "cena decorativa escondida do leitor de tela");
});

test("tela da TV: relógio no topo, tema escuro e claro, card que abre o detalhe da área", () => {
  assert.ok(/class="ftv-rl"><b>\$\{ftvRelTxt\(\)\.h\}/.test(H), "relógio no topo");
  assert.ok(/FTV\.tRel=setInterval\(ftvRelogio,1000\)/.test(H) && /clearInterval\(FTV\.tRel\)/.test(H), "relógio anda e para ao sair");
  assert.ok(H.includes('#ftv[data-tema="escuro"]') && H.includes('#ftv[data-tema="claro"]'), "os dois temas");
  assert.ok(H.includes('onclick="ftvDet(this.dataset.n)"') && H.includes("function ftvDetHtml(D)"), "tocar no card abre o detalhe");
  assert.ok(/if\(FTV\.det\)\{ftvDetFecha\(\);return;\}/.test(H), "Esc fecha primeiro o detalhe");
});
