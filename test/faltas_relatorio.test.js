// Relatório de Faltas x Medidas (tela, impressão e Excel): contas puras e ligações da página.
// As funções moram no index.html; aqui são extraídas e rodadas sem navegador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function funcao(nome) {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i >= 0, "função não encontrada: " + nome);
  let j = html.indexOf("{", i), nivel = 0;
  for (; j < html.length; j++) {
    if (html[j] === "{") nivel++;
    else if (html[j] === "}") { nivel--; if (nivel === 0) break; }
  }
  return html.slice(i, j + 1);
}
function contexto(hoje) {
  const ctx = { FM: { dados: { hoje } }, fmFam: () => "", fmDif: () => 0 };
  ctx.fmPermitido = () => true;
  vm.createContext(ctx);
  ["frHoje", "brHoje", "frFolhaDe", "frSitDe", "frConta", "frPermitido"].forEach(n => vm.runInContext(funcao(n), ctx));
  return ctx;
}

test("folha vai do dia 26 ao dia 25", () => {
  const c = contexto("2026-10-05");
  assert.deepEqual(JSON.parse(JSON.stringify(c.frFolhaDe("2026-10-25"))), { ini: "2026-09-26", fim: "2026-10-25" });
  assert.deepEqual(JSON.parse(JSON.stringify(c.frFolhaDe("2026-10-26"))), { ini: "2026-10-26", fim: "2026-11-25" });
  assert.deepEqual(JSON.parse(JSON.stringify(c.frFolhaDe("2026-01-10"))), { ini: "2025-12-26", fim: "2026-01-25" });
  assert.deepEqual(JSON.parse(JSON.stringify(c.frFolhaDe("2026-12-30"))), { ini: "2026-12-26", fim: "2027-01-25" });
});

test("situação do caso: vence hoje só no último dia do prazo", () => {
  const c = contexto("2026-10-05");
  const s = (situacao, prazoFim) => c.frSitDe({ situacao, prazoFim });
  assert.equal(s("PRAZO_VENCIDO", "2026-10-01"), "AT");
  assert.equal(s("NO_PRAZO", "2026-10-05"), "HJ");
  assert.equal(s("NO_PRAZO", "2026-10-06"), "NP");
  assert.equal(s("AGUARDANDO_RETORNO", "2026-10-09"), "NP", "ainda não voltou: também tem prazo (o próximo plantão), então entra em no prazo");
  assert.equal(s("COORDENACAO"), "VI");
  assert.equal(s("TRATADA"), "MP");
  assert.equal(s("TRATADA_FORA_DO_PRAZO"), "MF");
});

test("contas do relatório: abertos, medidas aplicadas e % no prazo", () => {
  const c = contexto("2026-10-05");
  const L = [
    { sit: "AT", supervisor: "A", posto: "P1", re: 1, nF: 1, reinc: 0, atraso: 4 },
    { sit: "AT", supervisor: "A", posto: "P2", re: 2, nF: 2, reinc: 2, atraso: 6 },
    { sit: "GR", supervisor: "B", posto: "P2", re: 3, nF: 1, reinc: 0, atraso: null },
    { sit: "MP", supervisor: "B", posto: "P3", re: 4, nF: 1, reinc: 3, atraso: null },
    { sit: "MP", supervisor: "B", posto: "P3", re: 5, nF: 1, reinc: 0, atraso: null },
    { sit: "MF", supervisor: "B", posto: "P3", re: 6, nF: 1, reinc: 0, atraso: 2 }
  ];
  const R = c.frConta(L);
  assert.equal(R.n, 6);
  assert.equal(R.abertos, 3);
  assert.equal(R.tratados, 3);
  assert.equal(R.venc, 5, "medidas que já deviam estar aplicadas: 3 aplicadas + 2 atrasadas");
  assert.equal(R.pct, 40, "prazo cumprido: 2 no prazo de 5 (aplicadas + atrasadas)");
  assert.equal(R.faltas, 7);
  assert.equal(R.sups.size, 2);
  assert.equal(R.postos.size, 3);
  assert.equal(R.reinc.size, 2, "quem tem 2 ou mais medidas no ano");
  assert.equal(R.med, 5, "atraso médio só dos atrasados, em dias");
  assert.equal(R.max, 6);
  assert.equal(c.frConta([]).pct, null, "sem medidas não há percentual");
  // uma medida no prazo e duas atrasadas não pode dar 100%
  assert.equal(c.frConta([{ sit: "MP", supervisor: "A", posto: "P", re: 1, nF: 1, reinc: 0 }, { sit: "AT", supervisor: "A", posto: "P", re: 2, nF: 1, reinc: 0, atraso: 3 }, { sit: "AT", supervisor: "A", posto: "P", re: 3, nF: 1, reinc: 0, atraso: 5 }]).pct, 33);
  // só atrasadas e nenhuma medida aplicada: 0%, não "—"
  assert.equal(c.frConta([{ sit: "AT", supervisor: "A", posto: "P", re: 1, nF: 1, reinc: 0, atraso: 3 }]).pct, 0);
  // casos que ainda estão no prazo não entram na conta
  assert.equal(c.frConta([{ sit: "NP", supervisor: "A", posto: "P", re: 1, nF: 1, reinc: 0 }, { sit: "MP", supervisor: "A", posto: "P", re: 2, nF: 1, reinc: 0 }]).pct, 100);
});

test("a página do relatório só abre para quem tem o módulo de faltas", () => {
  assert.match(html, /if\(p==="fmrel"&&!fmPermitido\(\)\)\{p="visao";btn=null;\}/);
  assert.match(html, /function frPermitido\(\)\{return fmPermitido\(\);\}/);
  // usa a mesma página do relatório de coberturas e remonta quando o outro estava na tela
  assert.match(html, /getElementById\("pg-"\+\(p==="fmrel"\?"bdvrel":p\)\)/);
  assert.match(html, /_s\.dataset\.mod!=="br"/);
  assert.match(html, /el\.dataset\.mod="fr"/);
});

test("Excel: a base tem as colunas que as fórmulas leem", () => {
  const i = html.indexOf("const cols=[{t:\"RE\",w:8}");
  assert.ok(i > 0, "colunas da aba Acompanhamento não encontradas");
  const bloco = html.slice(i, i + 1800);
  const nomes = [...bloco.matchAll(/\{t:"([^"]+)"/g)].map(m => m[1]);
  const letra = n => String.fromCharCode(64 + nomes.indexOf(n) + 1);
  assert.equal(letra("Supervisor"), "E");
  assert.equal(letra("Posto"), "D");
  assert.equal(letra("Folha"), "I");
  assert.equal(letra("Faltas (nº)"), "K");
  assert.equal(letra("Prazo até"), "N");
  assert.equal(letra("Data da medida"), "P");
  assert.equal(letra("Situação"), "Q");
  assert.equal(letra("Medidas no ano"), "S");
  assert.equal(letra("Regra"), "T");
  assert.equal(letra("Providência"), "U");
  assert.equal(nomes.length, 24);
});

test("histórico: a busca acha por nome, RE e posto, sem acento e com várias palavras", () => {
  const ctx = { FM: { dados: { hoje: "2026-10-05" } }, FM_MES: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] };
  vm.createContext(ctx);
  ["brNorm", "fmHistBusca", "fmHistPosto", "fmMeses6"].forEach(n => vm.runInContext(funcao(n), ctx));
  const p = { nome: "JOÃO DA SILVA", re: "4706", local: "COND - AURORA", l: [{ local: "COND - AURORA" }, { local: "CLINICA VIDA" }] };
  const q = t => ctx.brNorm(t.trim());
  assert.ok(ctx.fmHistBusca(p, q("")), "sem busca mostra todos");
  assert.ok(ctx.fmHistBusca(p, q("joao")), "sem acento");
  assert.ok(ctx.fmHistBusca(p, q("silva joao")), "palavras fora de ordem");
  assert.ok(ctx.fmHistBusca(p, q("4706")), "RE");
  assert.ok(ctx.fmHistBusca(p, q("aurora")), "posto atual");
  assert.ok(ctx.fmHistBusca(p, q("clinica vida")), "outro posto em que teve medida");
  assert.ok(!ctx.fmHistBusca(p, q("maria")), "não acha quem não está");
  assert.equal(ctx.fmHistPosto({ local: "—" }), "Sem posto informado");
  assert.equal(ctx.fmHistPosto({ local: "—", supervisor: "FRANK" }), "Reserva técnica · FRANK", "sem posto efetivo = reserva técnica do supervisor");
  assert.equal(ctx.fmHistPosto({ local: " COND - X " }), "COND - X");
  const m = ctx.fmMeses6();
  assert.deepEqual(JSON.parse(JSON.stringify(m.map(x => x.k))), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  ctx.FM.dados.hoje = "2026-02-10";
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.fmMeses6().map(x => x.k))), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"], "vira o ano");
});

test("histórico: a navegação abre no lugar (sem trocar de visão e sem pular a rolagem)", () => {
  // nenhum botão leva a pessoa para outra visão sozinho
  assert.doesNotMatch(html, /fmRkPostoLista|fmHistPostoFiltra/);
  // o Histórico guarda e devolve a rolagem a cada redesenho
  assert.match(html, /if\(FM\.aba==="HIST"\)\{const sc=document\.querySelector\("\.cnt"\),y=sc\?sc\.scrollTop:0;/);
  // abrir um nível dos rankings redesenha só o grupo tocado
  const f = funcao("fmRkToggle");
  assert.match(f, /closest\("\.fm-rkt-g"\)/);
  assert.match(f, /g\.outerHTML=fmRkGrupoHtml/);
  assert.doesNotMatch(f.replace(/return fmRenderCorpo\(\)/g, ""), /fmRenderCorpo\(\)/, "só cai no redesenho total se não achar o grupo");
});

test("Excel: fórmulas escritas à mão têm aspas balanceadas (aspa solta faz o Excel pedir reparo)", () => {
  const i = html.indexOf("function frXlsxMontar");
  assert.ok(i > 0);
  const corpo = html.slice(i);
  // fórmulas de texto fixo definidas em constantes do bloco do Excel
  const m = corpo.match(/const MOSTRANDO=`([^`]*)`;/);
  assert.ok(m, "constante MOSTRANDO não encontrada");
  assert.equal((m[1].match(/"/g) || []).length % 2, 0, "aspas desbalanceadas em MOSTRANDO: " + m[1]);
  let nivel = 0;
  for (const ch of m[1]) { if (ch === "(") nivel++; if (ch === ")") nivel--; assert.ok(nivel >= 0); }
  assert.equal(nivel, 0, "parênteses desbalanceados em MOSTRANDO");
});

test("ranking: medida do colaborador só se liga ao posto aberto se for desse posto; os últimos 6 meses separam os dois tons", () => {
  const ctx = { FM: { dados: { hoje: "2026-10-05" } }, FM_MES: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"], fmMedCancelada: m => /CANCEL/i.test(m.fase || "") };
  vm.createContext(ctx);
  ["fmMeses6", "fmRkCtx", "fmRkVinculo"].forEach(n => vm.runInContext(funcao(n), ctx));
  const c = ctx.fmRkCtx(m => m.local === "COND - AURORA");
  assert.equal(c.ini, "2026-05-01", "os 6 meses vão de maio a outubro");
  const v = (data, local, fase) => ctx.fmRkVinculo({ data, local, fase }, {}, c);
  assert.equal(v("2026-07-29", "COND - AURORA"), "no", "neste posto e dentro dos 6 meses");
  assert.equal(v("2026-05-01", "COND - AURORA"), "no", "o 1º dia do 1º mês já conta");
  assert.equal(v("2026-04-30", "COND - AURORA"), "fora", "neste posto, mas antes dos 6 meses");
  assert.equal(v("2026-09-02", "COND - SOLAR"), "", "outro posto não se liga, mesmo dentro dos 6 meses");
  assert.equal(v("2026-07-14", "COND - AURORA", "CANCELADA"), "", "medida cancelada não conta");
  assert.equal(ctx.fmRkVinculo({ data: "2026-07-14", local: "COND - AURORA" }, {}, null), "", "sem posto aberto não pinta nada");
});

test("atestado: só a planilha valida; a tela não tem mais formulário nem botão para registrar à mão", () => {
  ["fmAtForm", "fmAtSalvar", "fmAtLancado", "fmAtRemover", "Com atestado", "Já lancei no SAR2G", "Remover registro"].forEach(t => assert.ok(!html.includes(t), "não pode sobrar: " + t));
  const f = funcao("fmAtCaso");
  assert.match(f, /Se a falta não vier abonada na planilha, ela é injustificada/);
  assert.ok(!/<button|<input|<textarea/.test(f), "o aviso do atestado não tem controles");
});

test("calendário: o dia da falta com medida aplicada mostra a medida numa etiqueta própria, sem a frase confusa \"faltou · medida\"", () => {
  assert.ok(html.includes('<span class="mk">medida aplicada</span>'));
  assert.match(html, /MEDIDA:"medida aplicada"/);
});

test("ranking: cada mês é um botão; o mês escolhido mostra as medidas dele e o 'Antes' mostra as de mais de 6 meses, à parte", () => {
  const ctx = {
    FM: { dados: { hoje: "2026-10-05" }, rkMes: {} }, FM_MES: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    _esc: v => String(v), fmDd: d => String(d).slice(8, 10) + "/" + String(d).slice(5, 7), fmMedTxtH: m => m.tipo,
    fmHistPosto: m => m.local || "Sem posto informado", fmPostoVazio: v => "Reserva técnica · " + v
  };
  vm.createContext(ctx);
  ["fmMeses6", "fmRkMesDe", "fmRkMeses", "fmRkMesLista"].forEach(n => vm.runInContext(funcao(n), ctx));
  const p = { nome: "OSCAR LIMA", re: "903" };
  const ms = [{ data: "2026-07-29", tipo: "Suspensão", local: "GALPAO SUL" }, { data: "2026-07-14", tipo: "Suspensão", local: "GALPAO SUL" }, { data: "2026-04-08", tipo: "Suspensão", local: "GALPAO SUL" }, { data: "2026-01-22", tipo: "Advertência", local: "GALPAO SUL" }];
  const d = ctx.fmRkMesDe(ms);
  assert.deepEqual(JSON.parse(JSON.stringify(d.tr)), [0, 0, 2, 0, 0, 0], "mai a out: só julho tem medida");
  assert.equal(d.antes, 2, "abril e janeiro são de antes dos 6 meses");
  const cartoes = ctx.fmRkMeses(d, "posto|GALPAO SUL");
  assert.ok(cartoes.includes('data-m="2026-07"') && cartoes.includes('onclick="fmRkMes(this)"'), "o mês é um botão");
  assert.match(cartoes, /data-m="2026-06" disabled/, "mês sem medida não abre nada");
  assert.match(cartoes, /data-m="antes"/, "e há um cartão para as de antes dos 6 meses");
  const it = ms.map(m => ({ m, p }));
  assert.equal(ctx.fmRkMesLista("posto|GALPAO SUL", it, d), "", "sem mês escolhido não mostra lista");
  ctx.FM.rkMes["posto|GALPAO SUL"] = "2026-07";
  const jul = ctx.fmRkMesLista("posto|GALPAO SUL", it, d);
  assert.ok(jul.includes("Medidas de jul/2026"));
  assert.equal((jul.match(/class="fm-ml-r/g) || []).length, 2, "as duas de julho");
  assert.ok(!jul.includes("08/04") && !jul.includes("22/01"), "as de antes não aparecem na lista do mês");
  ctx.FM.rkMes["posto|GALPAO SUL"] = "antes";
  const antes = ctx.fmRkMesLista("posto|GALPAO SUL", it, d);
  assert.match(antes, /Antes dos últimos 6 meses/);
  assert.equal((antes.match(/class="fm-ml-r/g) || []).length, 2);
  assert.ok(antes.includes("08/04") && antes.includes("22/01") && !antes.includes("29/07"));
  assert.match(antes, /não entram nos números dos 6 meses/);
  // o mesmo vale nas 3 visões: grupos (postos e supervisores) e o cartão do colaborador
  assert.ok(html.includes('fmRkMeses(g,"posto|"+g.nome)') && html.includes('fmRkMeses(g,"sup|"+g.nome)') && html.includes('fmHistTimeline(p,null,{mes:true})'));
});
