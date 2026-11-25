// Feedback de Faltas na tela: executa o código REAL do módulo (assets/ligacoes/ligacoes.js) num ambiente simulado,
// para pegar erro de execução, o que cada situação mostra, HTML perigoso e a coerência com o servidor.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../api/_lig_regras");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// o módulo saiu do index.html para assets/ligacoes/ (o index.html tem limite de tamanho)
const JS = fs.readFileSync(path.join(__dirname, "..", "assets", "ligacoes", "ligacoes.js"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "..", "assets", "ligacoes", "ligacoes.css"), "utf8");
assert.ok(HTML.includes('<script src="/assets/ligacoes/ligacoes.js"></script>') && HTML.includes('href="/assets/ligacoes/ligacoes.css"'), "o index.html carrega o módulo");

const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dia = n => { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/u;

function ambiente({ pessoas, contatos, podeBaixar, faltas, codigos, ind } = {}) {
  const els = {}, janelas = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: "", style: {}, value: "", textContent: "", classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, dataset: {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], remove() {} });
  const ctx = {
    console, setTimeout, setInterval, clearInterval, Date, Math, JSON, Object, String, Number, Array, RegExp, Set, Map, Promise, performance: { now: () => 0 }, requestAnimationFrame: () => 0,
    document: {
      getElementById: id => janelas[id] || el(id), querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
      createElement: () => ({ style: {}, innerHTML: "", className: "", id: "", setAttribute() {}, appendChild() {}, remove() {}, addEventListener() {}, querySelector: () => null, classList: { add() {}, remove() {}, contains: () => false } }),
      body: { appendChild(o) { if (o && o.id) janelas[o.id] = o; } }
    },
    window: { matchMedia: () => ({ matches: true }) }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => "" },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    DASHBOARD_DATA: { faltas: faltas || [], ativos: [] }, ST: { area: "", sd: null, ed: null }, inR: () => true, mT: () => true, mA: () => true,
    _esc: s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    rhFmt: d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—"),
    ymd: d => d.toISOString().split("T")[0], VG: { ligCodigos: {} }, MutationObserver: function () { this.observe = () => {}; }
  };
  vm.createContext(ctx);
  vm.runInContext("var _LIG_RE_MAP=null;\n" + JS, ctx, { filename: "ligacoes.js" });
  const resumo = { mensagem: 0, aguardando: 0, base: 0, acomp: 0, vereditos: { melhorando: 0, mesma: 0, sem_faltas: 0, piorou: 0, comecando: 0 } };
  (pessoas || []).forEach(p => { resumo[p.situacao]++; if (p.acomp) resumo.vereditos[p.acomp.veredito]++; });
  vm.runInContext(`LIG_C=${JSON.stringify(contatos || [])};LIG_P=${JSON.stringify(pessoas || [])};LIG_RESUMO=${JSON.stringify(resumo)};LIG_COD=${JSON.stringify(codigos || {})};LIG_PODE_BAIXAR=${!!podeBaixar};LIG_HOJE=${JSON.stringify(hoje)};LIG_RES={};LIG_IND=${JSON.stringify(ind || null)};`, ctx);
  const aba = tab => tab === "acomp" ? "monit" : tab === "hist" ? "hist" : tab === "desemp" ? "desemp" : tab === "visao" ? "visao" : "fila";
  const html = (tab, vf) => { vm.runInContext(`LIG_ABA=${JSON.stringify(aba(tab))};LIG_TAB=${JSON.stringify(tab || "mensagem")};LIG_VF=${JSON.stringify(vf || "todos")};ligRender();`, ctx); return els["lig-content"].innerHTML + (els["lig-panel"] ? els["lig-panel"].innerHTML : ""); };
  const painel = id => (janelas[id] || {}).innerHTML || "";
  return { ctx, els, html, janelas, painel, run: c => vm.runInContext(c, ctx) };
}
const pessoa = (sit, extra) => ({ key: "1|ANA", re: "1", nome: "ANA SOUZA", posto: "POSTO A", supervisor: "FRANK", telefone: "5519999998888", situacao: sit, hist: [], envios: [], ...extra });
const msg = extra => pessoa("mensagem", { faltas: [dia(-2), dia(-1)], ultima_falta: dia(-1), tentativas: 0, ...extra });
const aguard = extra => pessoa("aguardando", { faltas: [dia(-1)], ultima_falta: dia(-1), tentativas: 0, envio: "prazo", ultima_marca: dia(0), prazo_ate: dia(1), envios: [dia(0)], ...extra });
const base = extra => pessoa("base", { faltas: [dia(-8), dia(-3)], ultima_falta: dia(-3), tentativas: 2, ...extra });
const acomp = extra => pessoa("acomp", { contato: { id: 7, data: dia(-12), por: "Ingridy Campana", acordo_prazo: null, baixa: null }, hist: [[dia(-14), "T"], [dia(-13), "T"]],
  acomp: { dia: 12, antes: 2, depois: 0, abonadas_depois: 0, ultima_falta_depois: null, veredito: "melhorando", sem_baixa: false }, ...extra });

test("o módulo roda: sem dados e com dados, sem erro de execução", () => {
  const e0 = ambiente().html();
  assert.match(e0, /Feedback de Faltas/);
  assert.match(e0, /Acompanhe o comportamento<br>de faltas de forma clara e organizada\./, "tela vazia com a ilustração (referência 2)");
  assert.match(e0, /<svg class="fb-ilu"/);
  assert.match(ambiente({ pessoas: [msg()] }).html(), /ANA SOUZA/);
});

test("cinco abas num bloco único com turno e área; o período não fica no topo; as situações de 30 dias só no Monitoramento", () => {
  const e = ambiente({ pessoas: [msg(), msg({ nome: "B", key: "2|B", re: "2" }), aguard({ nome: "C", key: "3|C", re: "3" }), base({ nome: "D", key: "4|D", re: "4" }), acomp({ nome: "E", key: "5|E", re: "5" })] });
  const h = e.html("mensagem");
  const nav = h.slice(h.indexOf('<nav class="fb-abas"'), h.indexOf("</nav>"));
  const pos = ["Visão geral", "Fila do SAC", "Monitoramento 30 dias", "Desempenho", "Histórico"].map(x => nav.indexOf(x));
  pos.forEach(p => assert.ok(p > 0));
  assert.deepEqual([...pos].sort((x, y) => x - y), pos, "ordem das abas");
  assert.match(h, /<section class="fb-topo"><header class="fb-band">[\s\S]*<h1>Feedback de Faltas<\/h1><p>Grupo ServCamp - Hoje - \d\d\/\d\d\/\d{4}<\/p>[\s\S]*<div class="fb-filtros">[\s\S]*Turno[\s\S]*Área[\s\S]*<\/header>[\s\S]*fb-abas[\s\S]*<\/section><div id="lig-panel">/, "faixa, filtros e abas num bloco só (referência 1)");
  const topo = h.slice(0, h.indexOf('<div id="lig-panel">'));
  assert.ok(!/Período|fb-kpi|fb-funil/.test(topo), "período e números saíram do topo: ficam só na Visão geral");
  assert.match(h, /<span class="fb-selp"><select id="lig-turno"/, "turno e área em pílula com seta, como na referência");
  assert.match(h, /Fila do SAC<\/button>/, "a aba Fila do SAC não tem número");
  assert.match(h, /Monitoramento 30 dias<span class="n">1<\/span>/);
  assert.match(h, /Enviar mensagem<span class="n">2<\/span>/);
  assert.match(h, /Aguardando ligação<span class="n">1<\/span>/);
  assert.match(h, /Com a coordenação<span class="n">1<\/span>/);
  assert.ok(!/Piorou<span|Melhorou<span/.test(h), "Piorou, Melhorou e cia. não ficam na fila");
  const m = e.html("acomp");
  assert.match(m, /Todos<span class="n">1<\/span>[\s\S]*Melhorou<span class="n">1<\/span>[\s\S]*Igual a antes<span class="n">0<\/span>[\s\S]*Continuou sem faltas<span class="n">0<\/span>[\s\S]*Piorou<span class="n">0<\/span>[\s\S]*Em observação<span class="n">0<\/span>/, "ordem: Melhorou · Igual a antes · Continuou sem faltas · Piorou · Em observação");
  assert.ok(h.includes("Enviar WhatsApp") && h.includes("Registrar feedback"), "as duas ações ficam sempre na linha das abas");
  assert.ok(m.includes("ligZapAbrir('','','',[],null)") && m.includes('onclick="ligForm()"'), "também no Monitoramento");
  assert.match(h, /Enviar WhatsApp<span id="lig-zap-chip" class="fb-zp"><i class="fb-dot off"/, "o estado do WhatsApp é um ponto no botão");
  assert.ok(!/Atividades|Sem posicionamento|Chamar na base|Mandar mensagem/.test(h), "os nomes antigos saíram");
});

/* funil: ANA e ZECA sem mensagem; BIA recebeu e não respondeu; CAIO recebeu e ligou (feedback registrado) */
const funilInd = () => ({ hoje, desde: dia(-120), prazo_resposta_dias: 1,
  dias: [[dia(-5), "FRANK", 3, 1], [dia(-5), "PAULO SOUZA", 1, 0]],
  pessoas: [["1", "ANA SOUZA", "POSTO A", "FRANK"], ["2", "BIA LIMA", "POSTO B", "FRANK"], ["3", "CAIO DIAS", "POSTO C", "FRANK"], ["9", "ZECA REIS", "POSTO Z", "PAULO SOUZA"]],
  funil: { faltas: [[dia(-5), 0, "I", null, "E", 0], [dia(-5), 0, "A", null, "E", 0], [dia(-5), 1, "I", null, "E", 0], [dia(-5), 2, "T", null, "E", 0], [dia(-5), 3, "I", null, "E", 1]], envios: [[dia(-4), 1], [dia(-4), 2]], feedbacks: [[dia(-3), 2]] },
  avaliacoes: [], conversas: [[dia(-3), "Saúde", 10, "FRANK", "Ingridy"], [dia(-3), "Familiar", 20, "FRANK", "Joyce"], [dia(-3), "Saúde", null, "FRANK", "Joyce"]],
  supervisores: ["FRANK", "PAULO SOUZA"], turnos: { FRANK: "DIURNO", "PAULO SOUZA": "NOTURNO" } });

test("Visão geral: Todas as faltas + quatro etapas sem repetir ninguém (sem mensagem → mensagem → feedback / não responderam)", () => {
  const ind = funilInd();
  ind.pessoas.push(["5", "DORA MELO", "POSTO D", "FRANK"], ["6", "EVA ROCHA", "POSTO E", "FRANK"]);
  ind.funil.faltas.push([dia(-5), 4, "A", null, "E", 0]);                              // DORA: só falta abonada
  ind.funil.faltas.push([dia(-9), 5, "I", null, "E", 0], [dia(-2), 5, "I", null, "E", 0]); // EVA: feedback e faltou de novo
  ind.funil.feedbacks.push([dia(-8), 5]);
  ind.funil.envios.push([hoje, 3]);                                                     // ZECA: mensagem hoje, no prazo
  const e = ambiente({ pessoas: [msg()], ind });
  e.run(`LIG_F.per="periodo";LIG_F.de=${JSON.stringify(dia(-10))};LIG_F.ate=${JSON.stringify(hoje)}`);
  let h = e.html("visao");
  assert.match(h, /Hoje<\/button><button[^>]*>Semana<\/button><button[^>]*>Folha<\/button><button[^>]*>Período/, "o período fica acima dos cards");
  const card = (rot, n, sub) => assert.match(h, new RegExp(rot + "<\\/small><\\/span><span class=\"mid\"><b data-n=\"\\d+\">" + n + "<\\/b><\\/span><span class=\"sub\">" + sub), rot);
  card("Todas as faltas", 6, "6 faltas · 2 abonadas");
  card("1 · Sem mensagem", 1, "1 falta<");
  card("2 · Mensagem enviada", 1, "1 falta · no prazo para ligar");
  card("3 · Feedback registrado", 1, "1 falta<");
  card("4 · Não responderam", 2, "3 faltas · 1 após feedback");
  assert.ok(!/fb-avs/.test(h), "sem iniciais nos cards do funil");
  assert.match(h, /<small>Taxa de feedback<\/small><\/span><span class="mid"><b>20<em>%<\/em><\/b><\/span><span class="sub">1 de 5 pessoas/, "taxa = quem teve feedback registrado sobre quem faltou sem justificativa");
  assert.match(h, /Tempo médio por feedback<\/small><\/span><span class="mid"><b data-n="\d+">15<em>min<\/em><\/b>/, "média só de quem informou o tempo");
  assert.ok(!/class="fb-fc g-amber info"[^>]*onclick/.test(h), "o tempo médio não é clicável");
  assert.match(h, /<b>Todas as faltas<\/b><span>6 pessoas/, "a lista abaixo começa com todas");
  assert.match(h, /DORA MELO[\s\S]*Falta abonada[\s\S]*<b>1 abonada<\/b> em \d\d\/\d\d/, "quem só teve falta abonada aparece separado, sem envio");
  e.run('ligVG("semmsg")');
  h = e.els["lig-panel"].innerHTML;
  assert.ok(h.includes("ANA SOUZA") && !h.includes("CAIO DIAS") && !h.includes("ZECA REIS"), "feedback registrado e mensagem enviada nunca aparecem no azul");
  assert.match(h, /ANA SOUZA[\s\S]*?1 abonada[\s\S]*?<b>1 falta<\/b> em \d\d\/\d\d/, "a pessoa com a quantidade de faltas dela");
  e.run('ligVG("ligaram")');
  h = e.els["lig-panel"].innerHTML;
  assert.match(h, /CAIO DIAS[\s\S]*Feedback em \d\d\/\d\d<\/span>[\s\S]*<b>1 falta<\/b> em \d\d\/\d\d<\/p><\/div>/, "card verde no mesmo padrão dos outros: etiqueta com a data e uma linha");
  assert.ok(!/fb-reg/.test(h), "sem o bloco grande do registro");
  e.run('ligVG("naoresp")');
  h = e.els["lig-panel"].innerHTML;
  assert.match(h, /<b>Não responderam<\/b><span>2 pessoas/);
  assert.match(h, /BIA LIMA[\s\S]*Não respondeu[\s\S]*ligVGEnviar\(\d\)/, "quem não respondeu pode receber nova mensagem");
  assert.match(h, /EVA ROCHA[\s\S]*Faltou após feedback de \d\d\/\d\d[\s\S]*Ver panorama/, "falta nova no acompanhamento vai para a coordenação, sem cobrança nova");
  e.run('LIG_F.turno="NOTURNO"');
  h = e.html("visao");
  assert.match(h, /Todas as faltas<\/small><\/span><span class="mid"><b data-n="\d+">1<\/b>/, "turno e área valem para o funil");
  /* área = supervisor da falta: ZECA hoje é do FRANK, mas a falta foi registrada com PAULO SOUZA */
  const e2 = ambiente({ pessoas: [msg()], ind: Object.assign(funilInd(), { pessoas: funilInd().pessoas.map(p => p[1] === "ZECA REIS" ? ["9", "ZECA REIS", "POSTO Z", "FRANK"] : p) }) });
  e2.run(`LIG_F.per="periodo";LIG_F.de=${JSON.stringify(dia(-10))};LIG_F.ate=${JSON.stringify(hoje)};LIG_F.area="PAULO SOUZA"`);
  assert.match(e2.html("visao"), /Todas as faltas<\/small><\/span><span class="mid"><b data-n="\d+">1<\/b>[\s\S]*ZECA REIS/, "a falta conta na área de quem era o supervisor no dia");
  assert.equal(e.run('LIG_F.turno="todos";LIG_F.per="periodo";LIG_F.de="2026-11-20";LIG_F.ate="2026-11-01";JSON.stringify(fbPeriodo())'), JSON.stringify({ de: "2026-11-01", ate: "2026-11-20", rot: "01/11 a 20/11" }), "datas trocadas se acertam");
  assert.match(e.run('LIG_F.per="folha";fbPeriodo().rot'), /^Folha até \d\d\/\d\d$/);
});

test("Fila: falta nova nos 30 dias depois do feedback vai para Com a coordenação (e continua no Monitoramento)", () => {
  const reinc = pessoa("acomp", { nome: "RE INCIDENTE", key: "7|R", re: "7", contato: { id: 1, data: dia(-10) }, acomp: { dia: 10, antes: 1, depois: 1, faltas_depois: [dia(-2)], faltas_antes: [dia(-12)], veredito: "mesma" } });
  const e = ambiente({ pessoas: [msg(), reinc], podeBaixar: true });
  let h = e.html("base");
  assert.match(h, /Com a coordenação<span class="n">1<\/span>/);
  assert.match(h, /RE INCIDENTE[\s\S]*Faltou de novo após feedback[\s\S]*<b>Faltou<\/b> em \d\d\/\d\d[\s\S]*Cabe à coordenação decidir/);
  assert.ok(!/undefined/.test(h));
  h = e.html("acomp");
  assert.ok(h.includes("RE INCIDENTE"), "o Monitoramento continua mostrando a pessoa");
});

test("folha de 26 a 25 e mês do calendário", () => {
  const e = ambiente();
  assert.equal(e.run('fbFolhaDe("2026-10-26")'), "2026-11");
  assert.equal(e.run('fbFolhaDe("2026-11-25")'), "2026-11");
  assert.equal(e.run('fbFolhaDe("2026-12-28")'), "2027-01");
  assert.equal(e.run('fbMesIni("2026-01","folha")'), "2025-12-26");
  assert.equal(e.run('fbMesFim("2026-11","folha")'), "2026-11-25");
  assert.equal(e.run('fbMesIni("2026-11","civil")'), "2026-11-01");
  assert.equal(e.run('fbMesFim("2026-02","civil")'), "2026-02-28");
});

test("Desempenho: cards compactos, meses fechados, diferença em número, as cinco situações e a estimativa à parte", () => {
  const e = ambiente();
  const kHoje = e.run(`fbMesChave(${JSON.stringify(hoje)},"civil")`);
  const mes = (k, n) => { let a = Number(k.slice(0, 4)), m = Number(k.slice(5, 7)) + n; while (m < 1) { m += 12; a--; } while (m > 12) { m -= 12; a++; } return a + "-" + String(m).padStart(2, "0"); };
  const kI = mes(kHoje, -3), kF = mes(kHoje, -1), d1 = kI + "-05", d2 = kI + "-06", d3 = kI + "-07", dF = kF + "-10";
  const av = (nome, i, d, antes, depois, veredito, extra) => ({ i, nome, re: String(i + 1), sup: "FRANK", d, antes, depois, dias: 30, veredito, faltas_antes: [], faltas_depois: [], desligado: false, ...extra });
  const ind = { hoje, desde: mes(kHoje, -5) + "-01", dias: [[d1, "FRANK", 10, 2], [dF, "FRANK", 5, 1]], pessoas: [["1", "ANA SOUZA", "POSTO A", "FRANK"], ["2", "BIA", "POSTO A", "FRANK"], ["3", "CAIO", "POSTO A", "FRANK"]],
    funil: { faltas: [[d1, 0, "I", 0, "E", 0], [d2, 0, "I", 0, "E", 0], [dF, 0, "I", 0, "E", 0]], envios: [[d3, 0]], feedbacks: [[d3, 0]] },
    /* o servidor manda o veredito pronto: a tela não recalcula. BIA sem faltas e CAIO desligado ficam fora da taxa */
    avaliacoes: [av("ANA SOUZA", 0, d3, 2, 0, "melhorando", { faltas_antes: [d1, d2] }), av("BIA", 1, d3, 0, 0, "sem_faltas"), av("CAIO", 2, d3, 0, 5, "piorou", { desligado: true })],
    postos: ["POSTO A"], conversas: [[dF, "Saúde", 10, "FRANK", "Ingridy"], [dF, "Transporte", 6, "FRANK", "Joyce"]], supervisores: ["FRANK"], turnos: { FRANK: "DIURNO" } };
  const e2 = ambiente({ ind });
  e2.run(`this._uploadInfo=()=>({ts:Date.parse(${JSON.stringify(hoje + "T15:00:00Z")})});LIG_DES={modo:"civil",ini:${JSON.stringify(kI)},fim:${JSON.stringify(kF)},ord:"var",dir:1};LIG_DSUB="resumo"`);
  assert.equal(JSON.parse(e2.run('JSON.stringify(fbMesesDisp("civil"))')).slice(-1)[0], kF, "o mês em andamento não aparece; o último é o anterior (já fechado pela planilha de hoje)");
  let h = e2.html("desemp");
  assert.match(h, /Resumo executivo[\s\S]*Efeito do feedback[\s\S]*Empresa e áreas[\s\S]*Motivos e atendimento/, "as 5 sub-abas");
  assert.match(h, /Folha 26 a 25/); assert.match(h, /Mês do calendário/);
  assert.match(h, /Comparação: <b>[^<]+<\/b> × [^·]+· meses fechados · hoje/, "linha de período: dois meses fechados e a data de hoje");
  assert.match(h, /<small>Faltas sem justificativa em [^<]+<\/small><b class="tn-da">5<\/b><span>Aumentou \+5 vs /, "5 faltas, 5 a mais que o mês anterior: diz o que conta, o sentido e o mês de comparação");
  assert.match(h, /Pessoas que melhoraram depois do feedback<\/small><b>1 de 1<\/b>/);
  assert.match(h, /Pessoas que pioraram depois do feedback<\/small><b>0 de 1<\/b>/);
  assert.match(h, /Áreas com mais faltas que no mês anterior<\/small><b class="tn-da">1 de 1<\/b><span>Maior: Frank \+5/);
  assert.ok(!/\d%/.test(h), "base abaixo de 20: só diferença em número, nunca porcentagem");
  assert.ok(!/projeção|Retorno das mensagens|Mensagens enviadas|Tempo médio por feedback|>S1</i.test(h), "sem projeção, retorno, mensagens, tempo médio nem S1 a S5 no Resumo");
  assert.equal((h.match(/class="fb-dc tn-/g) || []).length, 4, "quatro cards, todos do mesmo tipo, cada um na cor do que mede");
  e2.run('ligDes("sub","efeito")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Como ficaram as 2 pessoas\?[\s\S]*1 de 1 melhoraram; 0 pioraram\./);
  ["Melhorou", "Igual a antes", "Continuou sem faltas", "Piorou", "Em observação"].forEach(r => assert.ok(h.includes(">" + r + "<"), "situação " + r));
  assert.ok(!/ef-leg|Como ler|Fora das contas/.test(h), "sem a legenda descritiva embaixo dos cards");
  assert.ok(!/ef-bar|ef-key/.test(h), "sem a barra proporcional nem a legenda: os cards já mostram os números");
  e2.run('ligDesSit("melhorando")'); h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /<button type="button" class="tn-ok on" aria-pressed="true" onclick="ligDesSit\('melhorando'\)">/, "o card escolhido fica marcado");
  assert.match(h, /class="fb-pn ef-lista tn-ok"[\s\S]*<span class="fb-tag tn-ok">Melhorou<\/span><b>1 pessoa<\/b>[\s\S]*<th>Colaborador<\/th><th>Feedback em<\/th><th>Acompanhamento<\/th><th class="n">Antes<\/th><th class="n">Depois<\/th><th class="n">Diferença<\/th>[\s\S]*<span class="av">AS<\/span>[\s\S]*ANA SOUZA[\s\S]*Concluído \(30 dias\)[\s\S]*<td class="n">2<\/td><td class="n">0<\/td><td class="n"><span class="df tn-ok">−2<\/span>/, "tabela da situação escolhida: avatar, nome, progresso, antes, depois e selo de diferença");
  assert.ok(!/CAIO/.test(h), "desligado depois do feedback fica fora das contas");
  assert.ok(!/\d%/.test(h.replace(/style="[^"]*"/g, "")), "sem porcentagem por pessoa nem com base pequena (a largura da barra de progresso não conta)");
  assert.ok(h.includes('onclick="ligDesAbrir(0)"'), "a linha abre o panorama");
  e2.run('ligDes("sub","areas")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Sem justificativa em [^<]+<\/small><b class="tn-da">5<\/b>/);
  assert.match(h, /Abonadas em [^<]+<\/small><b class="tn-da">1<\/b>/);
  assert.match(h, /As duas juntas em [^<]+<\/small><b class="tn-da">6<\/b>/, "sem justificativa + abonadas, separadas e juntas");
  assert.match(h, /As faltas aumentaram ou diminuíram\?[\s\S]*class="gc"/, "pergunta no título e colunas");
  assert.match(h, /Número sobre a coluna: sem justificativa \+ abonadas/);
  assert.match(h, /em andamento[\s\S]*Estimativa[\s\S]*Não entra nas comparações/);
  assert.match(h, /Qual área teve aumento\?[\s\S]*Frank[\s\S]*<b>\+5<\/b>[\s\S]*Aumentou[\s\S]*Empresa/);
  assert.ok(!/\d%/.test(h), "tabela por área sem porcentagem");
  e2.run('ligDes("sub","motivos")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Feedbacks registrados<\/small><b>2<\/b>/);
  assert.match(h, /Motivo principal<\/small><b>Saúde<\/b><span>1 de 2 feedbacks/);
  assert.match(h, /Motivos informados nos feedbacks[\s\S]*Saúde[\s\S]*Tempo médio por pessoa do SAC[\s\S]*Ingridy[\s\S]*10 min/);
  assert.match(ambiente().html("desemp"), /Acompanhe o comportamento/, "sem números, a tela vazia");
});

test("projeção: fechamento do mês pelo ritmo e tendência pelos meses fechados", () => {
  const e = ambiente();
  assert.equal(e.run("fbTeto(37)"), 40);
  assert.equal(e.run("fbTeto(6.5)"), 8, "o eixo sempre tem 4 intervalos de número inteiro");
  assert.equal(e.run("fbTeto(3)"), 4);
  const svg = e.run('fbGArea({rots:["Jan/26","Fev/26","Mar/26"],vals:[10,8,3],parcial:true,fech:9,tend:{meses:["2026-04","2026-05","2026-06"],vals:[7,6,5],banda:1},cor:"#2563eb"})');
  assert.match(svg, /fechamento projetado de 9/);
  assert.match(svg, /tendência de 7 \(± 1\)/);
  assert.match(svg, /class="gbd"/, "faixa de margem");
});

test("histórico geral: a busca do topo acha qualquer colaborador da planilha", () => {
  const ind = { hoje, desde: dia(-120), dias: [], pessoas: [["55", "CARLOS NUNES", "POSTO C", "FRANK"]], com_feedback: [], conversas: [], supervisores: [], turnos: {} };
  const e = ambiente({ pessoas: [msg()], ind });
  e.html("mensagem");
  e.run('ligBuscaG("carl")');
  assert.match(e.els["lig-bg-r"].innerHTML, /CARLOS NUNES[\s\S]*RE 55/);
  e.run('ligBuscaG("55")');
  assert.match(e.els["lig-bg-r"].innerHTML, /CARLOS NUNES/);
  e.run('ligBuscaG("ninguem")');
  assert.match(e.els["lig-bg-r"].innerHTML, /Ninguém com esse nome ou RE/);
  e.run(`ligPanorama({key:"55|CARLOS",re:"55",nome:"CARLOS NUNES",posto:"POSTO C",supervisor:"FRANK",situacao:"sem",faltas:[],hist:[[${JSON.stringify(dia(-3))},"I"],[${JSON.stringify(dia(-2))},"A"]],envios:[]})`);
  const p = e.painel("lig-perfil-modal");
  assert.match(p, /Sem pendência/);
  assert.match(p, /Sem justificativa<\/small><b>1 falta<\/b>/);
  assert.ok(true); // o mês a mês agora fica na aba Evolução do panorama
});

test("Enviar mensagem: a ação principal é enviar; quem já recebeu uma mensagem mostra isso em palavras claras", () => {
  const e = ambiente({ pessoas: [msg(), msg({ nome: "REINCIDENTE", key: "2|R", re: "2", tentativas: 1, ultima_tentativa: dia(-5) })] });
  const h = e.html("mensagem");
  assert.equal((h.match(/class="fb-pc[ "]/g) || []).length, 2);
  assert.ok(h.includes('onclick="ligEnviarI(0)"') && h.includes("Enviar WhatsApp"));
  assert.ok(h.includes('onclick="ligRegistrarI(0)"'));
  assert.match(h, /2 faltas/);
  assert.match(h, /<b>Faltou<\/b> em \d\d\/\d\d e \d\d\/\d\d/);
  assert.ok(!/sem justificativa/i.test(h.replace(/<div class="fb-dcs[\s\S]*?<\/div><\/div>/, "")), "o card não repete \"sem justificativa\"");
  assert.match(h, /1 mensagem sem resposta/);
  assert.match(h, /Última mensagem em \d\d\/\d\d\. A pessoa não ligou/);
});

test("Aguardando ligação: dentro do prazo e 'não ligou' se distinguem; tentativa à mão não vira mensagem", () => {
  const h = ambiente({ pessoas: [aguard(), aguard({ nome: "SEM RETORNO", key: "2|S", re: "2", envio: "sem_retorno", tentativas: 1 }), aguard({ nome: "A MAO", key: "3|M", re: "3", envio: "sem_retorno", tentativas: 1, ultima_marca_manual: true })] }).html("aguardando");
  assert.match(h, /Aguardando ligação/);
  assert.match(h, /A pessoa tem até \d\d\/\d\d para ligar/);
  assert.match(h, /Não ligou/);
  assert.match(h, /Se faltar de novo e não responder, vai para a coordenação/);
  assert.match(h, /<b>Tentativa registrada<\/b>/);
  assert.ok(h.includes("Registrar feedback") && h.includes("Enviar WhatsApp"));
});

test("Com a coordenação: só a coordenação registra a conversa; todos veem o resumo", () => {
  const coord = ambiente({ pessoas: [base()], podeBaixar: true }).html("base");
  assert.match(coord, /2 mensagens sem resposta/);
  assert.ok(coord.includes("ligRegistrarI(0)") && coord.includes("ligResumoI(0)"));
  const sac = ambiente({ pessoas: [base()], podeBaixar: false }).html("base");
  assert.ok(!sac.includes("ligRegistrarI(0)"));
  assert.ok(sac.includes("ligResumoI(0)") && sac.includes("ligEnviarI(0)"));
});

test("Monitoramento 30 dias: selo do resultado, antes → depois em número grande, barra dos 30 dias, motivo e combinado", () => {
  const e = ambiente({ pessoas: [
    acomp(), acomp({ nome: "PIOR", key: "2|P", re: "2", acomp: { dia: 9, antes: 2, depois: 4, abonadas_depois: 0, ultima_falta_depois: dia(-1), faltas_depois: [dia(-6), dia(-4), dia(-2), dia(-1)], veredito: "piorou", sem_baixa: true } }),
    acomp({ nome: "COMBINADO", key: "3|C", re: "3", contato: { id: 8, data: dia(-5), por: "Raphael Victor", acordo_prazo: dia(-1), acordo_auto: "nao_cumpriu", baixa: null } })] });
  const h = e.html("acomp");
  assert.equal((h.match(/class="fb-pc fb-pm /g) || []).length, 3);
  assert.match(h, /class="fb-pc fb-pm tn-da"/, "piorou: fundo vermelho claro");
  assert.match(h, /class="fb-pc fb-pm tn-ok"/, "melhorou: fundo verde claro");
  assert.match(h, /<span class="fb-vp"><svg[^>]*>.*?<\/svg>Piorou<\/span>/);
  assert.match(h, /<div class="fb-pm-n"[^>]*><b>2<\/b><i aria-hidden="true">→<\/i><b class="d">4<\/b><span>faltas antes → depois<\/span>/, "antes → depois em um número só");
  assert.match(h, /role="progressbar" aria-valuemin="0" aria-valuemax="30" aria-valuenow="9"/); assert.match(h, /Dia 9 de 30/);
  assert.ok(!/fb-pm-ic|fb-pm-go|class="fb-mc"/.test(h), "sem ícone de relógio, seta nem datas no card");
  assert.match(h, /RE 1 • Posto A/);
  assert.match(h, /Aguardando baixa da coordenação/);
  assert.match(h, /Combinado não cumprido/);
  assert.ok(!/fb-cal|fb-mini/.test(h), "o calendário fica só no panorama");
  assert.match(h, /title="Passou do número de faltas dos 30 dias antes do feedback."/);
  const f = e.html("acomp", "piorou");
  assert.equal((f.match(/class="fb-pc fb-pm /g) || []).length, 1);
  assert.match(f, /PIOR/);
  assert.match(e.html("acomp", "comecando"), /Acompanhe o comportamento/);
});

test("o rótulo dos vereditos é o mesmo no filtro, no card e no texto de ajuda", () => {
  const e = ambiente({ pessoas: [acomp()] });
  const h = e.html("acomp");
  ["Melhorou", "Igual a antes", "Continuou sem faltas", "Piorou", "Em observação"].forEach(r => assert.ok(h.includes(r), r));
  assert.ok(!/Na mesma|Começando|Faltou de novo/.test(h), "palavras antigas fora");
  assert.deepEqual(JSON.parse(e.run("JSON.stringify(Object.keys(FB_VD).map(k=>[k,FB_VD[k].t,FB_VD[k].tom]))")),
    [["melhorando", "Melhorou", "tn-ok"], ["mesma", "Igual a antes", "tn-am"], ["sem_faltas", "Continuou sem faltas", "tn-gr"], ["piorou", "Piorou", "tn-da"], ["comecando", "Em observação", "tn-br"]], "as 5 situações, nesta ordem");
  assert.deepEqual(JSON.parse(e.run("JSON.stringify(Object.keys(FB_DEST).map(k=>FB_DEST[k][0]))")), ["Melhorou", "Igual a antes", "Continuou sem faltas", "Piorou", "Em observação"], "o destaque do panorama usa o mesmo rótulo");
  const P = require("../api/_lig_painel");
  const doServidor = Object.keys(P.montarPainel({ hoje, faltas: [], contatos: [], envios: [], telefones: {} }).resumo.vereditos).sort();
  assert.deepEqual(JSON.parse(e.run("JSON.stringify(Object.keys(FB_VD))")).sort(), doServidor, "as mesmas chaves do servidor");
});

test("a faixa e o calendário marcam falta, abonada, dia futuro, hoje e mensagem do SAC", () => {
  const e = ambiente({ pessoas: [acomp()] });
  /* "hoje" fixo em 05/11: a janela de 11 dias atrás a 2 à frente cruza outubro e novembro, em qualquer dia em que o teste rode */
  const H = "2026-11-05", dia = n => L.somaDias(H, n);
  e.run(`LIG_HOJE=${JSON.stringify(H)}`);
  const p = JSON.stringify(acomp({ hist: [[dia(-10), "I"], [dia(-9), "T"], [dia(-8), "A"], [dia(-7), "J"]], envios: [dia(-6)] }));
  const cel = JSON.parse(e.run(`JSON.stringify(fbCelulas(${p},${JSON.stringify(dia(-11))},${JSON.stringify(dia(2))},${JSON.stringify(dia(-6))}))`));
  assert.equal((cel.match(/class="f"/g) || []).length, 2, "I e T são falta");
  assert.equal((cel.match(/class="a"/g) || []).length, 2, "A e J são abonadas");
  assert.equal((cel.match(/class="fut"/g) || []).length, 2, "amanhã e depois de amanhã ainda não chegaram");
  assert.match(cel, / c m"/, "dia do contato e mensagem do SAC no mesmo dia");
  assert.equal((cel.match(/>\d\d<\/i>/g) || []).length, 14, "cada dia do calendário traz o seu número");
  assert.equal((cel.match(/<section class="fb-mes" data-m="\d"/g) || []).length, 2, "um bloco por mês (a janela cruza dois meses)");
  assert.ok(!/display:none/.test(cel), "sem mês ativo definido, todos aparecem");
  const um = JSON.parse(e.run(`JSON.stringify(fbCelulas(${p},${JSON.stringify(dia(-11))},${JSON.stringify(dia(2))},null,0))`));
  assert.equal((um.match(/display:none/g) || []).length, 1, "com mês ativo, os outros ficam escondidos");
  assert.equal((cel.match(/<b>/g) || []).length, 14, "cabeçalho de dias da semana em cada mês");
  assert.equal((cel.match(/ h"/g) || []).length, 1, "o dia de hoje é marcado");
});

test("o card só carrega números nos botões: nome com HTML não vira código", () => {
  const ruim = '"><img src=x onerror=alert(1)>';
  const e = ambiente({ pessoas: [msg({ nome: ruim, posto: ruim, supervisor: ruim })] });
  const h = e.html("mensagem");
  assert.ok(!h.includes("<img src=x"), "nome escapado");
  assert.ok(!/onclick="[^"]*onerror/.test(h));
  const corpo = e.run("ligPanorama(LIG_VIEW[0]);'ok'") && e.painel("lig-perfil-modal");
  assert.ok(!corpo.includes("<img src=x"), "o panorama também escapa");
  e.run("ligResumo(LIG_VIEW[0])");
  assert.ok(!e.painel("lig-resumo-modal").includes("<img"), "o resumo vai em campo de texto e não vira HTML");
});

test("panorama: cabeçalho com veredito, três cartões, evolução, calendário de um mês, linha do tempo e histórico", () => {
  const e = ambiente({ pessoas: [acomp({ hist: [[dia(-14), "T"], [dia(-13), "T"], [dia(-12), "A"]] })], podeBaixar: true,
    contatos: [{ id: 7, colaborador: "ANA SOUZA", data_contato: dia(-12), criado_em: dia(-12) + "T10:00:00Z", canal: "LIGAÇÃO", motivo: "Saúde", justificativa: "Consulta médica", criado_por: "Ingridy Campana", baixa: { por: "Raphael Victor", em: dia(-12) + "T11:00:00Z", de: dia(-42), ate: dia(18), re: "1" } }] });
  e.html("acomp");
  e.run("ligAbrir(0)");
  const h = e.painel("lig-perfil-modal"), linha = e.els["lp-tl"].innerHTML; // o histórico é desenhado em seguida, no próprio painel
  // cabeçalho
  assert.match(h, /class="fb-vd tn-ok">[\s\S]*Melhorou/);
  assert.match(h, /Supervisor: <b>Frank<\/b>/);
  assert.match(h, /<div class="fb-dlg-h banner"><div><h2>Panorama do colaborador<\/h2>/, "faixa do topo (referência 3)");
  assert.match(h, /data-k="cal"/); assert.match(h, /data-k="hist"/);
  assert.match(h, /onclick="ligPanEnviar\(\)">[\s\S]*Enviar WhatsApp/); assert.match(h, /Registrar feedback/);
  // três cartões, cada um dizendo o que é o número
  assert.match(h, /class="fb-res [^"]*"><div class="fb-res-n"><div><b>2<\/b><span>faltas antes<\/span><\/div><i aria-hidden="true">→<\/i><div class="d"><b>0<\/b><span>faltas depois<\/span>/, "o resultado primeiro: antes → depois");
  assert.match(h, /Faltou antes em[\s\S]*Faltou depois em/);
  assert.match(h, /Acompanhamento<\/small><b>até \d\d\/\d\d<\/b><span>faltam 18 dias<\/span>/);
  assert.match(h, /fb-pm-prog/); assert.match(h, /role="progressbar"/);
  // evolução: barras com o número em cima e a variação
  assert.match(h, /fb-evoc/);
  assert.match(h, /Faltas antes e depois do feedback/); assert.match(h, /<svg class="fb-g fb-gl"/);
  assert.ok(!/fb-kgs pan3/.test(h), "a Evolução não repete os números do Resumo");
  // calendário: um mês por vez, com setas, os dias de todos os meses presentes
  const calH = h.slice(h.indexOf('fb-card2 fb-calc'));
  assert.equal((calH.match(/data-d="[0-9]+"/g) || []).length, 31, "o calendário mostra o dia do contato e os 30 dias seguintes, em sequência");
  assert.match(calH, /Calendário do acompanhamento/);
  assert.ok(!calH.includes('ligMes('), "sem navegação por mês no acompanhamento");
  assert.match(h, /Sem falta registrada/); assert.match(h, /Falta sem justificar/); assert.match(h, /Dia do feedback/);
  // linha do tempo horizontal e o destaque
  assert.match(h, /fb-pan-ct/); assert.match(h, /Feedback realizado/);
  assert.ok(!/fb-call/.test(h));
  // histórico
  assert.match(linha, /Motivo da falta/); assert.match(linha, /Consulta médica/);
  assert.match(linha, /Feedback registrado por ligação/); assert.match(linha, /Saúde/);
  assert.match(linha, /Faltou sem justificar/);
  assert.match(linha, /Registrado por Ingridy/);
  // ações no rodapé, Fechar à direita
  assert.match(h, /Resumo para a coordenação/);
  assert.match(h, /Retirar da cobrança/, "sem baixa, a coordenação vê o botão para dar a baixa");
  assert.match(h, /class="fb-btn navy sm"[^>]*>Fechar/);
  const comBaixa = ambiente({ pessoas: [acomp({ contato: { id: 7, data: dia(-12), por: "Ingridy Campana", baixa: { por: "Raphael Victor", re: "1" } } })], podeBaixar: true });
  comBaixa.html("acomp"); comBaixa.run("ligAbrir(0)");
  assert.match(comBaixa.painel("lig-perfil-modal"), /Voltar para a cobrança/);
  assert.ok(!/Retirar da cobrança/.test(comBaixa.painel("lig-perfil-modal")));
});


test("panorama de quem espera mensagem ou ligação explica o que acontece em seguida", () => {
  const e = ambiente({ pessoas: [msg({ tentativas: 1 }), aguard({ envio: "sem_retorno", tentativas: 1 }), base()] });
  const t = n => { e.html(["mensagem", "aguardando", "base"][n]); e.run("ligAbrir(0)"); return e.painel("lig-perfil-modal"); };
  assert.match(t(0), /class="fb-tl-nota tn-br"><b>Aguardando mensagem\.<\/b> O SAC ainda não enviou mensagem\. Uma mensagem anterior ficou sem resposta\./);
  assert.match(t(1), /A pessoa não ligou depois da mensagem de \d\d\/\d\d\. Se faltar de novo e não responder, o caso vai para a coordenação\./);
  assert.match(t(2), /A pessoa não ligou depois de 2 mensagens do SAC\. Cabe à coordenação conversar com ela\./);
  assert.match(t(2), /Sem resposta/);
});

test("o combinado aparece no panorama com a conferência automática", () => {
  const c = { id: 7, data: dia(-5), por: "Ingridy Campana", acordo: "Atestado até amanhã", acordo_prazo: dia(1), acordo_auto: "pendente", baixa: null };
  const e = ambiente({ pessoas: [acomp({ contato: c })], podeBaixar: true });
  e.html("acomp"); e.run("ligAbrir(0)");
  const h = e.painel("lig-perfil-modal");
  assert.match(h, /Atestado até amanhã/); assert.match(h, /Combinado pendente/);
  assert.ok(!/confere sozinho/.test(h), "sem texto de ajuda repetindo o óbvio");
  assert.match(h, /Não cumpriu o combinado/); assert.match(h, /Marcar como cumprido/);
  const ok = ambiente({ pessoas: [acomp({ contato: { ...c, acordo_auto: "cumpriu" } })], podeBaixar: true });
  ok.html("acomp"); ok.run("ligAbrir(0)");
  assert.match(ok.painel("lig-perfil-modal"), /Combinado cumprido/);
  assert.ok(!/Marcar como cumprido/.test(ok.painel("lig-perfil-modal")));
});

test("lista grande: mostra 24 por vez e a busca enxerga todos", () => {
  const muitos = Array.from({ length: 60 }, (_, k) => msg({ nome: "PESSOA " + k, key: k + "|P", re: String(k) }));
  const e = ambiente({ pessoas: muitos });
  const h = e.html("mensagem");
  assert.equal((h.match(/class="fb-pc[ "]/g) || []).length, 24);
  assert.match(h, /Mostrar mais 24/); assert.match(h, /faltam 36/);
  e.run("ligMais()");
  assert.equal((e.els["lig-panel"].innerHTML.match(/class="fb-pc[ "]/g) || []).length, 48);
  e.run('LIG_LIM=24;ligFiltraPend("pessoa 59")');
  assert.equal((e.els["lig-panel"].innerHTML.match(/class="fb-pc[ "]/g) || []).length, 60, "com busca, todos entram na lista para o filtro esconder o que não bate");
});

test("envio em lote: seleciona até 15, mostra quem tem celular e monta a mensagem de cada pessoa", async () => {
  const gente = Array.from({ length: 20 }, (_, k) => msg({ nome: "PESSOA " + k, key: k + "|P", re: String(k), telefone: k === 3 ? "" : "55199999000" + String(10 + k) }));
  const e = ambiente({ pessoas: gente, podeBaixar: true });
  e.html("mensagem");
  assert.match(e.els["lig-panel"].innerHTML, /Selecionar 15 primeiras/);
  assert.match(e.els["lig-panel"].innerHTML, /type="checkbox"/);
  e.run("ligSelTodos()");
  assert.equal(e.run("LIG_SEL.size"), 15, "o lote tem limite");
  const barra = e.els["lig-lote"] ? e.els["lig-lote"].innerHTML : e.els["lig-panel"].innerHTML;
  assert.match(barra, /15<\/b> pessoas selecionadas<\/span>/);
  assert.match(barra, /onclick="ligLote\(\)">[\s\S]*Enviar mensagem para 15/);
  // a coordenação pode marcar mais de 15 (para mover para uma pasta), mas o envio de WhatsApp fica travado acima de 15
  e.run("ligSel(15,{checked:true,closest:()=>null})");
  assert.equal(e.run("LIG_SEL.size"), 16);
  const b16 = e.els["lig-lote"].innerHTML;
  assert.match(b16, /o WhatsApp vai até 15 por vez/);
  assert.match(b16, /onclick="ligLote\(\)" disabled/);
  assert.match(b16, /Mover para pasta…<\/option><option value="inss">INSS<\/option><option value="abandono">Abandono<\/option><option value="demitido">Demitido<\/option>/);
  e.run("ligSel(15,{checked:false,closest:()=>null})");
  assert.equal(e.run("LIG_SEL.size"), 15);
  e.run("LIG_ZAP={configurado:true,ok:true,state:'open'};LIG_MODELO={texto:'Olá, {nome}. Faltou{data}. Ligue para o SAC.'};ligLote()");
  const j = e.painel("lig-lote-modal");
  assert.match(j, /Enviar mensagem para 15 pessoas/);
  assert.match(j, /sem celular válido/, "quem não tem celular fica de fora");
  assert.match(j, /1 sem celular válido/);
  assert.match(j, /Enviar para 14/);
  assert.ok(!/disabled/.test(j.slice(j.indexOf('id="ll-enviar"'))), "com WhatsApp conectado o botão fica ativo");
  assert.equal(e.run('fbTextoPara("Olá, {nome}. Faltou{data}.","ANA SOUZA",["2026-11-08","2026-11-09"])'), "Olá, Ana. Faltou em 08/11, 09/11.");
  e.run("LIG_ZAP={configurado:true,ok:true,state:'closed'};ligLote()");
  assert.match(e.painel("lig-lote-modal"), /O WhatsApp do SAC não está conectado/);
});

test("resumo para a coordenação: texto simples com faltas, mensagens, conversas e combinado", () => {
  const contatos = [{ id: 7, colaborador: "ANA SOUZA", data_contato: dia(-12), criado_em: dia(-12) + "T10:00:00Z", canal: "LIGAÇÃO", motivo: "Saúde", justificativa: "Consulta médica", acordo: "Atestado até sexta", acordo_prazo: dia(-8), criado_por: "Ingridy Campana", baixa: { por: "Raphael Victor", em: dia(-12) + "T11:00:00Z", de: dia(-42), ate: dia(18), re: "1" } }];
  const p = acomp({ envios: [dia(-13)], hist: [[dia(-14), "T"], [dia(-13), "T"]], contato: { id: 7, data: dia(-12), por: "Ingridy Campana", acordo_prazo: dia(-8), acordo_auto: "nao_cumpriu", baixa: { por: "Raphael Victor", re: "1" } },
    acomp: { dia: 12, antes: 2, depois: 1, abonadas_depois: 0, ultima_falta_depois: dia(-3), faltas_depois: [dia(-3)], veredito: "melhorando", sem_baixa: false } });
  const e = ambiente({ pessoas: [p], contatos });
  const t = JSON.parse(e.run(`JSON.stringify(fbResumo(${JSON.stringify(p)}))`));
  assert.match(t, /^RESUMO PARA A COORDENAÇÃO/);
  assert.match(t, /Colaborador: ANA SOUZA \(RE 1\)/);
  assert.match(t, /Situação: Em acompanhamento · Melhorou/);
  assert.match(t, /Antes do feedback \(30 dias\): 2 faltas/);
  assert.match(t, /Depois do feedback \(\d\d\/\d\d\): 1 falta em \d\d\/\d\d/);
  assert.match(t, /1 mensagem enviada em \d\d\/\d\d/);
  assert.match(t, /conversa por ligação · registrado por Ingridy/);
  assert.match(t, /A pessoa disse: Consulta médica/);
  assert.match(t, /Combinado: Atestado até sexta \(prazo \d\d\/\d\d\)/);
  assert.match(t, /Situação do combinado: não cumprido\./);
  assert.ok(!EMOJI.test(t), "sem emoji");
  e.run(`ligResumo(${JSON.stringify(p)})`);
  assert.match(e.painel("lig-resumo-modal"), /Copiar texto/);
  assert.match(e.painel("lig-resumo-modal"), /<textarea[^>]*readonly/);
});

test("registrar contato: duas escolhas e os campos certos para cada uma", () => {
  const e = ambiente({ pessoas: [msg()], podeBaixar: true });
  e.run(`ligForm(null,{colaborador:"ANA SOUZA",re:"1",posto:"POSTO A",supervisor:"FRANK",telefone:"(19) 99999-8888",ultima:${JSON.stringify(dia(-1))}})`);
  const h = e.painel("lig-modal");
  assert.ok(h.includes("Falei com a pessoa") && h.includes("Não consegui falar"));
  assert.match(h, /Registrar feedback/);
  assert.equal((h.match(/class="fb-dec[ "]/g) || []).length, 2, "só duas escolhas");
  assert.ok(h.includes('value="(19) 99999-8888"'), "celular já preenchido");
  assert.ok(/so-tentativa/.test(h) && /so-conversa/.test(h));
  assert.ok(h.includes("Retirar esta pessoa da cobrança"), "coordenação vê a baixa");
  assert.ok(!/Próxima ação|Impressão|Tipo da falta/.test(h), "campos que atrapalhavam saíram");
  assert.match(h, /Duração \(min\)/, "o tempo da conversa é digitado");
  assert.match(h, /id="lf-dur" type="number" min="1" max="240"/);
  assert.match(h, /Novo motivo/, "qualquer pessoa do SAC cria um motivo");
  assert.ok(!/Editar motivos/.test(h), "renomear e desativar é da coordenação (e só aparece com a permissão do servidor)");
  e.run('LIG_MOT.push({chave:"X",nome:"Escala trocada",ativo:true,padrao:false,antigos:[]},{chave:"Y",nome:"Antigo",ativo:false,padrao:false,antigos:[]});LIG_MOT_EDITA=true');
  const ch = e.run('fbChipsMotivo("")');
  assert.ok(ch.includes("Escala trocada") && !ch.includes(">Antigo<"), "motivo criado aparece; desativado não");
  assert.ok(e.run('fbChipsMotivo("Antigo")').includes(">Antigo<"), "o contato com motivo desativado continua mostrando o dele");
  assert.match(ch, /Editar motivos/);
  const sac = ambiente({ pessoas: [msg()], podeBaixar: false });
  sac.run('ligForm(null,{colaborador:"ANA SOUZA"})');
  assert.match(sac.painel("lig-modal"), /Só a coordenação retira a falta da cobrança/);
});

test("a lista de resultados que valem como tentativa é a mesma do servidor", () => {
  const doServidor = Object.keys(L.RESULTADOS).filter(k => L.RESULTADOS[k].grupo === "tentativa").sort();
  const e = ambiente();
  assert.deepEqual(JSON.parse(e.run("JSON.stringify(FB_TENT.slice().sort())")), doServidor);
  assert.equal(e.run('ligEfetivo({resultado:"SEM_RESPOSTA"})'), false);
  assert.equal(e.run('ligEfetivo({resultado:"EXPLICOU"})'), true);
  assert.equal(e.run("ligEfetivo({})"), true, "contato antigo vale como conversa");
});

test("a mensagem padrão pede que a pessoa ligue e é igual à do servidor", () => {
  const e = ambiente();
  assert.equal(e.run("LIG_MODELO_PADRAO"), L.MODELO_PADRAO);
  assert.match(L.MODELO_PADRAO, /ligue para este número/);
  assert.ok(!/Podemos entrar em contato/.test(L.MODELO_PADRAO));
  assert.equal(e.run('ligZapTexto("ANA SOUZA",["2026-11-08","2026-11-09"])').includes("em 08/11, 09/11"), true);
  assert.ok(!EMOJI.test(L.MODELO_PADRAO), "sem emoji na mensagem");
});

test("celular: do cadastro para a tela", () => {
  const e = ambiente();
  assert.equal(e.run('fbFone("5519999998888")'), "(19) 99999-8888");
  assert.equal(e.run('fbFone("1933334444")'), "(19) 3333-4444");
  assert.equal(e.run('fbFone("")'), "");
});

test("histórico: conversas e tentativas, com exclusão só para a coordenação", () => {
  const contatos = [
    { id: 1, colaborador: "ANA", data_contato: dia(-2), criado_em: dia(-2) + "T10:00:00Z", canal: "LIGAÇÃO", motivo: "Saúde", justificativa: "Gripe", criado_por: "Ingridy Campana", baixa: null },
    { id: 2, colaborador: "BIA", data_contato: dia(-1), criado_em: dia(-1) + "T10:00:00Z", canal: "WHATSAPP", resultado: "SEM_RESPOSTA", criado_por: "Joyce", baixa: null }];
  const coord = ambiente({ contatos, podeBaixar: true }), sac = ambiente({ contatos, podeBaixar: false });
  const mes = `LIG_F.per="periodo";LIG_F.de=${JSON.stringify(dia(-30))};LIG_F.ate=${JSON.stringify(hoje)}`;
  coord.run(mes); sac.run(mes);
  assert.match(coord.html("hist"), /2 registros/);
  coord.run('LIG_F.per="hoje"');
  assert.match(coord.html("hist"), /Acompanhe o comportamento/, "o período do topo também vale para o histórico");
  coord.run(mes);
  const h = coord.html("hist");
  assert.match(h, /Falou com a pessoa/); assert.match(h, /Não conseguiu falar/);
  assert.ok(h.includes("ligExcluir(1)"));
  assert.ok(!sac.html("hist").includes("ligExcluir("));
  assert.match(ambiente().html("hist"), /Acompanhe o comportamento/);
});

test("a busca por nome ou RE guarda o termo e não redesenha", () => {
  const e = ambiente({ pessoas: [msg()] });
  e.html("mensagem");
  e.run('ligFiltraPend("ana")');
  assert.equal(e.run("LIG_BUSCA_P"), "ana");
});

test("quem usa o módulo no index.html continua tendo a mesma conta: abonada, afastado e já tratada não pedem contato", () => {
  const F = (nome, re, d, abono) => ({ NOME: nome, RE: re, DATA: d, ABONO: abono || "I", LOCAL: "POSTO A", AREA: "FRANK" });
  const k = (re, n) => `${re}|PESSOA|${dia(-1)}`;
  const e = ambiente({ faltas: [F("PESSOA UM", 1, dia(-1)), F("PESSOA DOIS", 2, dia(-1)), F("PESSOA TRES", 3, dia(-1)), F("PESSOA QUATRO", 4, dia(-1))], codigos: { [k(2)]: "J", [k(3)]: "AF", [k(4)]: "T" } });
  const inj = JSON.parse(e.run('JSON.stringify(ligFaltasRecentes().filter(p=>p.faltas.some(f=>f.cat==="inj")).map(p=>p.colaborador))'));
  assert.deepEqual(inj, ["PESSOA UM"]);
});

test("visual: sem emoji, sem texto minúsculo, movimento reduzido respeitado, modo escuro e foco visível", () => {
  assert.ok(!EMOJI.test(JS), "sem emoji no código da tela");
  assert.ok(!EMOJI.test(CSS), "sem emoji no estilo");
  const escala = [...CSS.matchAll(/--t(\d+):([\d.]+)rem/g)].map(m => [Number(m[1]), parseFloat(m[2])]);
  assert.deepEqual(escala.map(x => x[0]), [12, 13, 14, 16, 20, 24], "escala tipográfica definida em tokens");
  assert.ok(Math.min(...escala.map(x => x[1])) >= 0.75, "nada abaixo de 12 px");
  assert.equal([...CSS.matchAll(/font-size:\s*[\d.]+rem/g)].length, 0, "tamanhos só pela escala, sem valor solto");
  assert.ok(!/font-weight:\s*900/.test(CSS), "sem peso 900");
  assert.match(CSS, /@font-face\{font-family:"Plus Jakarta Sans";src:url\("\.\.\/fonts\/plus-jakarta-sans\/plus-jakarta-sans-latin\.woff2"\)/, "fonte hospedada no sistema (a política de segurança só aceita fonte própria)");
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "fonts", "plus-jakarta-sans", "plus-jakarta-sans-latin.woff2")) && fs.existsSync(path.join(__dirname, "..", "assets", "fonts", "plus-jakarta-sans", "OFL.txt")), "o arquivo da fonte e a licença estão no projeto");
  assert.match(CSS, /Segoe UI Variable/, "a fonte do Windows fica de reserva");
  ["--e1", "--e2", "--e3", "--r8", "--r14", "--r20", "--s4", "--fb-hair"].forEach(k => assert.ok(CSS.includes(k + ":"), "token " + k));
  assert.ok(!/inset 0 [2-6]px 0 0 var\(--k/.test(CSS) && !/border-(top|left):\s*[2-9]px solid var\(--k/.test(CSS), "sem barras coloridas (pedido do Raphael)");
  assert.match(CSS, /\.fb-pm\{[^}]*background:var\(--kc\)/, "a cor do resultado vem do fundo do card");
  assert.match(CSS, /\.fb-hero\{/); assert.match(CSS, /\.fb-topo\{/); assert.match(CSS, /\.fb-dlg-h\.banner\{/);
  assert.match(CSS, /prefers-reduced-motion:reduce/);
  assert.match(CSS, /html\[data-theme="dark"\]/);
  assert.match(CSS, /focus-visible/);
  assert.match(CSS, /\.fb-pc\{/); assert.match(CSS, /\.fb-cal/);
  assert.ok(!/Central de atividades|fb-ag\b|fb-donut|fb-alertas|\.fb-sit\{|\.fb-mini\{|\.fb-cmp2\{/.test(CSS), "sobras da tela antiga foram removidas");
});

test("tela cheia e trocas suaves: sem margens, funil em 5 colunas iguais, só o pedaço que muda é trocado", () => {
  assert.match(CSS, /body\.pg-lig \.topbar\{display:none\}/, "a barra branca do sistema some nesta tela");
  assert.match(CSS, /body\.pg-lig \.cnt\{padding:0/);
  assert.match(CSS, /#pg-ligacoes \.fb\{max-width:none;margin:0;width:100%\}/, "o módulo ocupa a largura toda");
  assert.match(CSS, /\.fb-funil\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/, "os 5 cards do funil com a mesma largura");
  assert.match(HTML, /document\.body\.classList\.toggle\("pg-lig",lig\)/);
  assert.match(CSS, /\.fb-ind\{[^}]*transition:transform/, "indicador que desliza");
  assert.match(CSS, /prefers-reduced-motion:reduce\)\{\.fb-fc,\.fb-kg\{transform:none!important\}/, "movimento reduzido respeitado");
  const e = ambiente({ pessoas: [msg()], ind: funilInd() });
  const h = e.html("visao");
  assert.match(h, /data-nav="per" data-ind="fundo"/); assert.match(h, /data-cards="funil"/); assert.match(h, /<div id="lig-lista">/);
  assert.equal((h.match(/class="fb-con"/g) || []).length, 5, "conector entre os cards, fora do texto");
  assert.ok(!/fb-seta/.test(h));
  assert.match(e.html("mensagem"), /data-nav="sub" data-ind="fundo"[\s\S]*<div id="lig-lista">/);
  assert.match(e.html("desemp"), /data-nav="dsub"/);
});

test("mês fechado: só depois de chegar planilha com data posterior ao fim do período (reserva: 1º dia útil depois)", () => {
  const e = ambiente();
  e.run('LIG_HOJE="2026-11-16";LIG_IND={desde:"2026-01-10"}');
  // sem a data da planilha: 31/10 é sábado, então outubro fecha na segunda 02/11
  e.run('LIG_HOJE="2026-11-01"'); assert.equal(e.run('fbMesFechado("2026-10-31")'), false);
  e.run('LIG_HOJE="2026-11-02"'); assert.equal(e.run('fbMesFechado("2026-10-31")'), true);
  e.run('LIG_HOJE="2026-10-31"'); assert.equal(e.run('fbMesFechado("2026-10-30")'), false, "sexta 30/10: o sábado não tem planilha");
  // com a data da última planilha (a mesma do "Última planilha" do painel geral), ela decide
  e.run('LIG_HOJE="2026-11-16";this._uploadInfo=()=>({ts:Date.parse("2026-10-26T15:00:00Z")})');
  assert.equal(e.run('fbMesFechado("2026-10-25")'), true, "planilha de 26/10 fecha a folha de outubro (até 25/10)");
  assert.equal(e.run('fbMesFechado("2026-10-31")'), false, "mas não o mês do calendário: a planilha de novembro ainda não chegou");
  assert.deepEqual(JSON.parse(e.run('JSON.stringify(fbMesesDisp("folha"))')), ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "sai a folha de janeiro (dados desde 10/01) e a de novembro");
  assert.deepEqual(JSON.parse(e.run('JSON.stringify(fbMesesDisp("civil"))')).slice(-1), ["2026-09"]);
  e.run("delete this._uploadInfo");
  assert.deepEqual(JSON.parse(e.run('JSON.stringify(fbMesesDisp("civil"))')).slice(0, 1).concat(JSON.parse(e.run('JSON.stringify(fbMesesDisp("civil"))')).slice(-1)), ["2026-02", "2026-10"]);
  e.run('LIG_IND={desde:"2026-01-01"}');
  assert.equal(JSON.parse(e.run('JSON.stringify(fbMesesDisp("civil"))'))[0], "2026-01", "dados desde o dia 1º: o mês está completo");
});

test("Monitoramento: Continuou sem faltas tem filtro próprio e a área é o supervisor gravado no feedback", () => {
  const sem = acomp({ nome: "SEM FALTA", key: "2|S", re: "2", supervisor: "PAULO", contato: { id: 9, data: dia(-30), por: "Joyce", supervisor: "FRANK", baixa: null },
    acomp: { dia: 30, antes: 0, depois: 0, abonadas_depois: 0, ultima_falta_depois: null, faltas_antes: [], faltas_depois: [], veredito: "sem_faltas", sem_baixa: false } });
  const e = ambiente({ pessoas: [acomp(), sem] });
  const h = e.html("acomp", "sem_faltas");
  assert.equal((h.match(/class="fb-pc fb-pm /g) || []).length, 1);
  assert.match(h, /class="fb-pc fb-pm tn-gr"[\s\S]*SEM FALTA[\s\S]*Continuou sem faltas/);
  e.run('LIG_F.area="FRANK"');
  assert.match(e.html("acomp", "sem_faltas"), /SEM FALTA/, "conta na área do supervisor do feedback (FRANK), não na de hoje (PAULO)");
  e.run('LIG_F.area="PAULO"');
  assert.match(e.html("acomp", "todos"), /Todos<span class="n">0<\/span>/);
});

test("panorama e resumo: tom, selo e Resultado vêm só do veredito do servidor; antes = dc−29 a dc", () => {
  const c = { id: 7, data: dia(-10), por: "Ingridy Campana", baixa: null };
  // 3 antes e 1 depois no dia 10: pela conta simples seria "melhorou"; pela regra do servidor ainda é Em observação
  const p = acomp({ contato: c, hist: [[dia(-20), "I"], [dia(-15), "I"], [dia(-10), "I"], [dia(-4), "I"]],
    acomp: { dia: 10, antes: 3, depois: 1, abonadas_depois: 0, ultima_falta_depois: dia(-4), faltas_antes: [dia(-20), dia(-15), dia(-10)], faltas_depois: [dia(-4)], veredito: "comecando", sem_baixa: false } });
  const e = ambiente({ pessoas: [p] });
  e.html("acomp"); e.run("ligAbrir(0)");
  const h = e.painel("lig-perfil-modal");
  assert.match(h, /class="fb-vd tn-br">[\s\S]*?Em observação/);
  assert.match(h, /class="fb-res tn-br"><div class="fb-res-n"><div><b>3<\/b><span>faltas antes<\/span><\/div><i aria-hidden="true">→<\/i><div class="d"><b>1<\/b><span>falta depois<\/span>[\s\S]*?Em observação/);
  assert.ok(!/Melhorou|−67%|−2 faltas/.test(h), "nada recalculado na tela, sem porcentagem por pessoa");
  const ini = e.run(`fbDd(ligSomaDias(${JSON.stringify(c.data)},-29))`);
  assert.ok(h.includes('<div class="fb-res-d"') || h.includes('<dl class="fb-res-d">'), "datas das faltas antes e depois");
  assert.ok(ini < c.data, "o antes começa em dc−29 (regra do servidor; a tela só mostra as faltas dele)");
  // a linha do tempo tem 60 colunas: dc−29 até dc+30 (o dia do feedback é o último do antes)
  const g = e.run(`fbGLinha({c:${JSON.stringify(c.data)},p:${JSON.stringify(p)},fa:[],fd:[]})`);
  assert.equal((g.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="3"/g) || []).length, 60);
  assert.match(g, new RegExp('text-anchor="start"[^>]*>' + ini + "<"));
  const d = e.run(`fbDocResumo(${JSON.stringify(p)})`);
  assert.match(d, /<small>Resultado<\/small><b>Em observação<\/b><span>3 antes, 1 depois<\/span>/);
  assert.ok(d.includes(ini + " a "), "o resumo impresso usa a mesma janela");
});

test("Desempenho, achados da revisão: Postos com 1 mês, soma por área = total, detalhe de motivo = card, panorama sem % e modo escuro", () => {
  const e = ambiente();
  const kHoje = e.run(`fbMesChave(${JSON.stringify(hoje)},"civil")`);
  const mes = (k, n) => { let a = Number(k.slice(0, 4)), m = Number(k.slice(5, 7)) + n; while (m < 1) { m += 12; a--; } while (m > 12) { m -= 12; a++; } return a + "-" + String(m).padStart(2, "0"); };
  const kA = mes(kHoje, -2), kF = mes(kHoje, -1), dA = kA + "-10", dF = kF + "-10";
  const av = (nome, i, sup) => ({ i, nome, re: String(i + 1), sup, d: dF, antes: 0, depois: 2, dias: 30, veredito: "piorou", faltas_antes: [], faltas_depois: [], desligado: false });
  const ind = { hoje, desde: mes(kHoje, -5) + "-01", dias: [[dA, "FRANK", 3, 0], [dF, "FRANK", 1, 0], [dF, "PAULO", 0, 2]], pessoas: [["1", "ANA", "POSTO A", "FRANK"], ["2", "BIA", "POSTO A", "PAULO"]],
    funil: { faltas: [[dA, 0, "I", 0, "E", 0], [dA, 0, "I", 0, "E", 0], [dA, 0, "I", 0, "E", 0], [dF, 0, "I", 0, "E", 0]], envios: [], feedbacks: [] },
    avaliacoes: [av("ANA", 0, ""), av("BIA", 1, "PAULO")], postos: ["POSTO A"],
    conversas: [[dF, "Saúde", null, "FRANK", "Ingridy", 7]], supervisores: ["FRANK", "PAULO"], turnos: { FRANK: "DIURNO", PAULO: "DIURNO" } };
  const contatos = [{ id: 7, colaborador: "ANA", data_contato: dF, motivo: "Saúde", resultado: "EXPLICOU" }];
  const e2 = ambiente({ ind, contatos });
  e2.run(`this._uploadInfo=()=>({ts:Date.parse(${JSON.stringify(hoje + "T15:00:00Z")})});LIG_DES={modo:"civil",ini:${JSON.stringify(kF)},fim:${JSON.stringify(kF)},mot:"",pt:"efetivo"};LIG_DSUB="postos"`);
  let h = e2.html("desemp");
  assert.match(h, /Condomínio com mais faltas · [^<]+<\/small><b>Posto A<\/b><span>1 falta no período/, "cards pelo período escolhido, com a unidade");
  assert.match(h, /Faltas da reserva técnica · [^<]+<\/small><b>0<\/b>/);
  assert.match(h, /Período analisado: <b>[^<]+<\/b> \(1 mês fechado\)/);
  assert.equal((h.match(/class="fb-tab ind fb-heat"/g) || []).length, 1, "um quadro só, mapa de calor");
  assert.match(h, /Faltas por posto, mês a mês[\s\S]*?onclick="ligDesPr\('postos'\)">Postos efetivos<\/button><button type="button" class="" onclick="ligDesPr\('reserva'\)">Reserva técnica/, "botão troca postos e reserva, como na referência");
  // período de 2 meses: célula colorida, diferença para o mês anterior embaixo; a % só no texto do mouse
  e2.run(`LIG_DES.ini=${JSON.stringify(kA)};ligDes("sub","postos")`);
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Período analisado: <b>[^<]+<\/b> \(2 meses fechados\) · comparação: <b>[^<]+<\/b> contra <b>[^<]+<\/b>/);
  assert.match(h, /<b>Posto A<\/b><small>[^<]*<\/small><\/span><\/td><td class="hm h4" data-tip="Posto A · [^\n"]+\n3 faltas sem justificativa neste mês\.\nÉ o primeiro mês do período: não há mês anterior para comparar\.\nQuem faltou: Ana \(3\)\." data-tipj="[^"]+"><b>3<\/b><\/td>/, "mouse no 1º mês: o número, que não há comparação e quem faltou");
  assert.match(h, /<td class="hm h2" data-tip="Posto A · [^\n"]+\n1 falta sem justificativa neste mês\.\nEm [^\n"]+ foram 3 faltas\. Resultado: melhorou, 2 faltas a menos, uma queda de 67%\.\nQuem faltou: Ana \(1\)\." data-tipj="[^"]+"><b>1<\/b><small class="dn">▼ 2<\/small><\/td>/, "mouse no mês: a comparação explicada em palavras, com a %");
  assert.match(h, /<td class="tt" data-tip="Posto A · [^\n"]+\n4 faltas sem justificativa no período, de 1 pessoa\.\nPrimeiro mês \([^)]+\): 3 faltas\. Último mês \([^)]+\): 1 falta\.\nResultado do período: melhorou, 2 faltas a menos, uma queda de 67%\.\nMês com mais faltas: [^"]+\(3\)\." data-tipj="[^"]+"><b>4<\/b>/, "mouse no total: o período inteiro explicado");
  assert.ok(!/<td[^>]*>[^<]*%/.test(h.replace(/data-tipj?="[^"]*"/g, "")), "nenhuma % escrita na tabela, só no mouse");
  assert.match(h, /Passe o mouse num número para ver a explicação e a %/);
  assert.ok(!/Aumentou|Diminuiu|variação/i.test(h), "verbos fixos: Piorou, Melhorou, Estável");
  e2.run("ligDesPa(0)");
  h = e2.els["lig-panel"].innerHTML;
  const pessoas = h.slice(h.indexOf('class="pd-w"'));
  assert.match(pessoas, /1 pessoa faltou<\/b> em Posto A[\s\S]*?<span class="av">A<\/span><span class="nm"><b>Ana<\/b><small>RE 1<\/small><\/span><\/td><td class="n"><span class="mb h4"[^>]*><b>3<\/b><i style="height:28px"><\/i><\/span><\/td><td class="n"><span class="mb h2"[^>]*><b>1<\/b><i style="height:15px"><\/i><\/span><\/td><td class="n t"><b>4<\/b><small>faltas<\/small><\/td>/, "clicar no posto mostra quem faltou; a soma da pessoa fecha com a linha");
  // regra do resultado
  assert.deepEqual(JSON.parse(e2.run("JSON.stringify([fbPostoRes([0,3]),fbPostoRes([2,4]),fbPostoRes([5,5]),fbPostoRes([4])])")), [
    { k: "tn-da", p: "Piorou", g: "+3 faltas", s: "sem base para % (começou em 0)" },
    { k: "tn-da", p: "Piorou", g: "+100%", s: "+2 faltas" },
    { k: "tn-gr", p: "Estável", g: "0%", s: "mesmo número de faltas" }, null]);
  // etiqueta desenhada: as mesmas informações em partes (título, número, selo do resultado, quem faltou)
  const cel2 = h.match(/<td class="hm h2"[^>]*data-tipj="([^"]+)"/);
  const o = JSON.parse(cel2[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.deepEqual([o.h, o.n, o.c.k, o.c.p, o.c.g, o.q], ["Posto A", 1, "dn", "Melhorou", "67%", [["Ana", 1]]], "selo verde: melhorou 67% (só a %, sem sinal), com quem faltou");
  assert.match(e2.run("fbTipRico(" + JSON.stringify(o) + ",String)"), /<div class="tx-c dn"><em>Melhorou <b>67%<\/b><\/em><span>2 faltas a menos que em [^<]+ \(3\)\.<\/span><\/div><div class="tx-q"><small>Quem faltou<\/small><ul><li><span>Ana<\/span><b>1<\/b><\/li><\/ul>/);
  // filtro "Quais faltas contar": feedback em até 30 dias depois da falta; abonadas só quando o filtro pede
  e2.run("LIG_IND.funil.feedbacks=[[" + JSON.stringify(dA) + ",0]];LIG_IND.funil.faltas.push([" + JSON.stringify(dF) + ',0,"A",0,"E",0])');
  const linhaA = pf => { e2.run('ligDesPf("' + pf + '")'); const m = e2.els["lig-panel"].innerHTML.match(/<b>Posto A<\/b><small>[^<]*<\/small><\/span><\/td><td class="hm[^"]*"[^>]*><b>(\d+)<\/b>[\s\S]*?<\/td><td class="hm[^"]*"[^>]*><b>(\d+)<\/b>/); return m ? [Number(m[1]), Number(m[2])] : null; };
  assert.deepEqual(linhaA("sj"), [3, 1], "como hoje: todas sem justificativa");
  assert.deepEqual(linhaA("sj_fb"), [3, 0], "com feedback: as 3 de antes do feedback");
  assert.deepEqual(linhaA("sj_sem"), [0, 1], "sem feedback: a falta depois do feedback");
  assert.deepEqual(linhaA("ab_sem"), [0, 2], "sem feedback + abonadas: entra a abonada");
  assert.deepEqual(linhaA("ab_fb"), [3, 0]);
  assert.match(e2.els["lig-panel"].innerHTML, /<select id="ld-pf"[\s\S]*?<option value="ab_fb" selected>Sem justificativa \+ abonadas, com feedback<\/option>/, "o filtro mostra o que está contando");
  assert.match(e2.els["lig-panel"].innerHTML, /Com feedback: a pessoa teve feedback registrado em até 30 dias depois da falta/);
  e2.run('ligDesPf("sj");LIG_DES.pq="mirante";ligPanel()');
  assert.match(e2.els["lig-panel"].innerHTML, /<tr class="pl" data-n="POSTO A" hidden/, "busca pelo nome esconde o que não bate");
  assert.match(e2.els["lig-panel"].innerHTML, /id="ld-pq-vazio">Nenhum posto com esse nome\./);
  e2.run('LIG_DES.pq="";LIG_IND.funil.feedbacks=[];LIG_IND.funil.faltas.pop()');
  e2.run(`LIG_DES.ini=${JSON.stringify(kF)};LIG_DES_PA=""`);
  const rotF = e2.run(`fbMesCurto(${JSON.stringify(kF)})`);
  assert.ok(!h.includes(rotF + " a " + rotF),"faixa de 1 mês: um nome só, não 'Out/26 a Out/26'");
  e2.run('ligDes("sub","areas")');
  h = e2.els["lig-panel"].innerHTML;
  const col = [...h.matchAll(/<tr><td><b>[^<]+<\/b><\/td><td>[^<]+<\/td><td>\d+<\/td><td>\d+<\/td><td[^>]*><b>[^<]+<\/b><\/td><td>(\d+)<\/td>/g)].reduce((t, m) => t + Number(m[1]), 0);
  const tot = Number((h.match(/<tr class="tot"><td><b>[^<]+<\/b><\/td><td><\/td><td><b>\d+<\/b><\/td><td><b>\d+<\/b><\/td><td[^>]*><b>[^<]+<\/b><\/td><td><b>(\d+)<\/b>/) || [])[1]);
  assert.equal(tot, 2); assert.equal(col, tot, "a coluna Pioraram por área soma o total (Sem supervisor e área só com feedback entram)");
  assert.match(h, /<b>Sem supervisor<\/b>/, "Sem supervisor com s minúsculo");
  assert.match(h, /Áreas com mais faltas que no mês anterior<\/small><b>0 de 1<\/b>/, "área só com abonadas não entra na contagem de áreas");
  e2.run('LIG_F.area="FRANK";ligDes("sub","motivos")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /data-n="Saúde"><i[^>]*><\/i><span class="t">Saúde<\/span><b>1<\/b>/, "card: contato sem supervisor conta pela área da pessoa");
  assert.match(h, /Nenhum feedback com tempo registrado/, "mês sem tempo registrado não vira 0 min");
  e2.run('ligDes("mot","Saúde")');
  assert.match(e2.els["lig-panel"].innerHTML, /Feedbacks com o motivo: Saúde<\/h4><span class="fb-pill-s">1 feedback</, "o detalhe mostra os mesmos feedbacks do card");
  const det = e2.run(`fbDetalhePessoa({hist:[[${JSON.stringify(dA)},"I"],[${JSON.stringify(hoje)},"I"]]})`);
  assert.ok(!/%/.test(det), "panorama, Evolução: sem % por pessoa"); assert.match(det, /\* [^<]+ em andamento/, "o mês em andamento vem marcado");
  e2.run(`ligPanorama({key:"1|ANA",re:"1",nome:"ANA",posto:"POSTO A",supervisor:"FRANK",situacao:"sem",faltas:[],hist:[],envios:[],fb_fim:{data:${JSON.stringify(dF)},antes:0,depois:2,dias:30,veredito:"piorou"}})`);
  assert.match(e2.painel("lig-perfil-modal"), /Resultado do feedback de [^:]+: Piorou \(0 antes, 2 depois\)/, "Ver de quem piorou: o panorama mostra o mesmo resultado do Efeito");
  assert.ok(!/\.fb-abas \.fb-dsub button\{[^}]*#475569/.test(CSS) && /\.fb-tab tbody tr\.tot td\{background:var\(--fb-th\)/.test(CSS) && /html\[data-theme="dark"\] :is\(#pg-ligacoes,\.fb-ov\)\{--fb-th:/.test(CSS), "modo escuro: menus e linha de total pelas cores do tema");
});

test("panorama: histórico disciplinar do ano (faltas sem justificativa, abonadas e medidas, como no painel disciplinar)", () => {
  const e = ambiente();
  const ini = hoje.slice(0, 4) + "-01-01", ant = (Number(hoje.slice(0, 4)) - 1) + "-12-20";
  const pes = { key: "9|CARLA", re: "9", nome: "CARLA MENDES", posto: "POSTO A", supervisor: "FRANK", situacao: "sem", faltas: [], envios: [], _completo: 1,
    hist: [[ant, "I"], [ini, "I"], [hoje, "T"], [ini, "A"], [hoje, "L"], [hoje, "D"]] };
  e.run(`LIG_HIST={desde:${JSON.stringify(ini)},medidas:[
    {re:"9",nome:"CARLA MENDES",data:${JSON.stringify(ini)},tipo:"ADVERTÊNCIA",grau:"VERBAL",dias:0,fase:"CONCLUÍDA",motivo:"Falta sem justificativa"},
    {re:"9",nome:"CARLA MENDES",data:${JSON.stringify(hoje)},tipo:"SUSPENSÃO",grau:"",dias:2,fase:"CONCLUÍDA",motivo:"Reincidência"},
    {re:"9",nome:"CARLA MENDES",data:${JSON.stringify(hoje)},tipo:"ADVERTÊNCIA",grau:"ESCRITA",dias:0,fase:"CANCELADA",motivo:"x"},
    {re:"9",nome:"OUTRA PESSOA",data:${JSON.stringify(hoje)},tipo:"ADVERTÊNCIA",grau:"VERBAL",dias:0,fase:"CONCLUÍDA",motivo:"mesmo RE, outra empresa"}]}`);
  e.run("ligPanorama(" + JSON.stringify(pes) + ")");
  // no panorama: só uma linha com os totais, o selo de reincidência e o botão
  const h0 = e.painel("lig-perfil-modal"), cp = h0.slice(h0.indexOf('class="fb-disc dcc"'));
  assert.match(cp, /Histórico disciplinar · \d{4}<\/b><span>01\/01\/\d{4} a \d\d\/\d\d\/\d{4}<\/span>/);
  assert.match(cp, /<dd>2<\/dd><dt>Sem justificativa<\/dt>[\s\S]*<dd>2<\/dd><dt>Abonadas<\/dt>[\s\S]*<dd>2<\/dd><dt>Medidas<\/dt>[\s\S]*<span class="rnc">Reincidente<\/span>[\s\S]*onclick="ligDiscAbrir\(\)">[\s\S]*Ver histórico<\/button>/, "I e T do ano (a do ano passado não entra); A e L; desligamento não é falta; cancelada e de outra pessoa não contam");
  assert.ok(!/<table|class="bx"/.test(cp), "as tabelas ficam fora do panorama");
  // a janela: ficha, duas abas e tabelas
  e.run("ligDiscAbrir()");
  const h = e.painel("lig-disc-modal"), d = h.slice(h.indexOf('class="fb-disc dsc"'));
  assert.match(h, /Histórico disciplinar de \d{4}/);
  assert.match(d, /<small>Faltas sem justificativa<\/small><b class="neg">2<\/b>[\s\S]*<small>Faltas abonadas<\/small><b>2<\/b>[\s\S]*<small>Medidas disciplinares válidas<\/small><b>2<\/b><em>Reincidente<\/em>[\s\S]*<small>Período<\/small><b>01\/01\/\d{4} a /);
  assert.match(d, /Medidas disciplinares<span>2<\/span>[\s\S]*Faltas do ano<span>4<\/span>/, "duas abas com contagem");
  assert.match(d, /<th>Data<\/th><th>Medida<\/th><th>Motivo<\/th><th>Situação<\/th>[\s\S]*Suspensão de 2 dias<\/span>[\s\S]*Advertência verbal<\/span>/, "tabela; mesmo texto do painel disciplinar, da mais recente para a mais antiga");
  assert.match(d, /<tr class="canc">[\s\S]*Cancelada · não conta/, "cancelada aparece riscada e marcada");
  assert.match(d, /<td class="st ok">Válida<\/td>/);
  assert.match(d, /Faltas mês a mês em \d{4}/); assert.match(d, /<td class="rt">Sem justificativa<\/td>[\s\S]*<td class="tt">2<\/td>/, "o ano mês a mês, com total");
  assert.match(d, /<h5>Faltas abonadas<\/h5><span>2 registros<\/span>[\s\S]*<em>Licença<\/em>/, "o tipo de cada abonada");
  assert.ok(!/mesmo RE, outra empresa/.test(d), "RE repetido em outra empresa não vaza");
  // sem medida: mensagem de primeira ocorrência
  e.run('LIG_HIST={medidas:[]};ligPanorama(' + JSON.stringify(pes) + ")");
  e.run("ligDiscAbrir()");
  assert.match(e.painel("lig-disc-modal"), /<b>Nenhuma medida disciplinar em \d{4}\.<\/b> Esta é a primeira ocorrência da pessoa no ano\./);
  assert.match(e.painel("lig-disc-modal"), /Medidas disciplinares válidas<\/small><b>0<\/b>/);
});


test("fila do SAC: período das faltas com cards de contagem; aba Pastas tira a pessoa da cobrança", () => {
  const pessoas = [
    msg({ nome: "FALTOU HOJE", key: "1|F", re: "1", faltas: [hoje], hist: [[hoje, "I"], [dia(-3), "A"]] }),
    msg({ nome: "FALTOU ANTES", key: "2|F", re: "2", faltas: [dia(-10)] }),
    pessoa("pasta", { nome: "NO INSS", key: "3|N", re: "3", pasta: "inss", pasta_por: "raphaelvictor", pasta_em: dia(-1) + "T12:00:00Z", faltas: [dia(-2)] })
  ];
  const e = ambiente({ pessoas, podeBaixar: true, ind: funilInd() });
  let h = e.html("mensagem");
  assert.match(h, /aria-pressed="true" onclick="ligFilaPer\('todas'\)">Últimos 30 dias<\/button>[\s\S]*>Hoje<\/button>[\s\S]*>Semana<\/button>[\s\S]*>Período<\/button>/);
  assert.match(h, /<small>Faltas no período<\/small><b>5<\/b>[\s\S]*<small>Sem justificativa<\/small><b>4<\/b>[\s\S]*<small>Abonadas<\/small><b>1<\/b>/, "cards com o número de faltas do período");
  assert.match(h, /Enviar mensagem<span class="n">2<\/span>[\s\S]*Pastas<span class="n">1<\/span>/);
  assert.ok(h.includes("FALTOU HOJE") && h.includes("FALTOU ANTES") && !h.includes("NO INSS"), "quem está em pasta não aparece na cobrança");
  assert.match(h, /FALTOU HOJE[\s\S]*?1 falta[\s\S]*?title="Abonada em \d\d\/\d\d"[^>]*>[\s\S]*?1 abonada[\s\S]*?<b>Faltou<\/b> em /, "abonada separada da falta numa etiqueta cinza");
  e.run('ligFilaPer("hoje")');
  h = e.els["lig-panel"].innerHTML;
  assert.ok(h.includes("FALTOU HOJE") && !h.includes("FALTOU ANTES"), "Hoje: só quem faltou hoje");
  assert.match(h, /Enviar mensagem<span class="n">1<\/span>/);
  e.run('ligTab("pasta")');
  h = e.els["lig-panel"].innerHTML;
  assert.match(h, /ligPastaVer\('todas'\)">Todas<span class="n">1<\/span>[\s\S]*>INSS<span class="n">1<\/span>[\s\S]*>Abandono<span class="n">0<\/span>[\s\S]*>Demitido<span class="n">0<\/span>/);
  assert.match(h, /NO INSS[\s\S]*Pasta INSS[\s\S]*Fora da cobrança<\/b> desde \d\d\/\d\d · por raphaelvictor[\s\S]*ligPastaDevolver\(0\)/);
  e.run('ligPastaVer("demitido")');
  assert.ok(!e.els["lig-panel"].innerHTML.includes("NO INSS"), "a pasta escolhida filtra a lista");
});


test("pasta: botão no card escolhe a pasta; na aba Pastas dá para procurar a pessoa pelo nome ou RE", () => {
  const e = ambiente({ pessoas: [msg({ nome: "HUGO PRADO", key: "108|HUGO", re: "108" })], podeBaixar: true, ind: funilInd() });
  let h = e.html("mensagem");
  assert.match(h, /class="fb-pasta-b"[^>]*aria-label="Mover HUGO PRADO para uma pasta" onclick="event.stopPropagation\(\);ligPastaEscolher\(0\)"/);
  e.run("ligPastaEscolher(0)");
  const j = e.painel("lig-pasta-modal");
  assert.match(j, /HUGO PRADO[\s\S]*ligPastaFazer\('inss'\)">[\s\S]*INSS[\s\S]*ligPastaFazer\('abandono'\)[\s\S]*ligPastaFazer\('demitido'\)/);
  assert.equal(e.run("LIG_PASTA_ALVO[0].key"), "108|HUGO");
  // procurar alguém (inclusive quem não está na fila) pelo RE
  e.run('ligTab("pasta")');
  assert.match(e.els["lig-panel"].innerHTML, /ligPastaNova\(\)/);
  e.run("ligPastaNova()");
  e.run('LIG_PASTA_RES=fbPastaCands().filter(c=>c.re==="2")');
  assert.equal(e.run("LIG_PASTA_RES[0].nome"), "BIA LIMA", "acha pelo RE entre quem tem falta no sistema");
  const semPermissao = ambiente({ pessoas: [msg()], podeBaixar: false });
  assert.ok(!/fb-pasta-b/.test(semPermissao.html("mensagem")), "só a coordenação vê o botão de pasta");
});

test("Black List (central): botão só da coordenação; indicadores, distribuição por cargo, fila por prioridade com o motivo", () => {
  assert.ok(!/fb-blb/.test(ambiente({ pessoas: [msg()], podeBaixar: false }).html()), "SAC sem coordenação não vê o botão");
  const e = ambiente({ pessoas: [msg()], podeBaixar: true });
  assert.match(e.html(), /class="fb-blb"[^>]*onclick="ligBL\(this\)"[^>]*><svg class="bx-emb"[\s\S]*?<\/svg><span>BLACK <em>LIST<\/em><\/span>/, "botão com o emblema");
  const p = (re, nome, cargo, extra) => ({ chave: re + "|" + nome.split(" ")[0], re, nome, cargo, posto: "POSTO", supervisor: "FRANK PIMENTEL", admissao: "2021-03-12", ativo: true, obs: "", medidas: [], injustificadas: [], abonadas: [], semRetorno: [], documentos: [], ocorrencias: [], pendentesSar2g: 0, incluidoEm: "2026-11-01T12:00:00Z", ...extra });
  e.run("LIG_HOJE='2026-11-23';LIG_BL=" + JSON.stringify({ pessoas: [
    p("1", "CARLOS ALMEIDA", "PORTEIRO (A)", { injustificadas: ["2026-08-01"], incluidoEm: "2026-08-10T12:00:00Z" }),
    p("2", "SERGIO LIMA", "PORTEIRO (A)", { injustificadas: ["2026-11-01", "2026-11-18", "2026-11-20"] }),
    p("3", "ALINE ROCHA", "AUXILIAR DE LIMPEZA", { pendentesSar2g: 1, medidas: [{ data: "2026-11-10", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, motivo: "" }] }),
    p("4", "NAIR DIAS", "CONTROLADOR DE ACESSO")], historico: [] }) + ";LIG_BL_Q='';LIG_BL_F='todos';LIG_BL_C='';LIG_BL_SEL='';LIG_BL_PASTA='inj';blCentral();");
  const k = e.els["bx-kpis"].innerHTML;
  assert.match(k, /Total no arquivo<\/small><b>4<\/b>[\s\S]*Faltaram em 7 dias<\/small><b>1<\/b>[\s\S]*Com medida no ano<\/small><b>1<\/b>/);
  assert.match(e.els["bx-cargos"].innerHTML, /<span>Porteiro \(A\)<\/span><i style="--p:100%"><\/i><b>2<\/b>[\s\S]*<span>Auxiliar de Limpeza<\/span><i style="--p:50%"><\/i><b>1<\/b>/, "distribuição por cargo, do maior para o menor");
  const l = e.els["bx-lista"].innerHTML;
  assert.match(l, /bx-rank">1<\/span><span class="bx-itx"><b>Sergio Lima<\/b><small class="v">Faltou nos últimos 7 dias[\s\S]*bx-rank">2<\/span><span class="bx-itx"><b>Aline Rocha<\/b><small class="a">Medida a lançar no SAR2G[\s\S]*Carlos Almeida<\/b><small class="g">Sem faltas há 114 dias/, "fila: quem pede ação primeiro, com o motivo; quem está há muito tempo sem faltar por último, em verde");
  assert.match(l, /class="bx-it on" role="option" aria-selected="true"[^>]*data-k="2\|SERGIO"/, "o primeiro da fila já vem aberto");
  assert.match(l, /^<div class="bx-grp-at" role="group" aria-label="Atenção imediata"><p class="bx-grp" aria-hidden="true"><i class="bx-lamp"><\/i>Atenção imediata<\/p><button[^>]*data-k="2\|SERGIO" data-r="v"[^]*?<\/button><\/div><div role="group" aria-label="Demais">[\s\S]*data-r="a"[\s\S]*Aline/, "quem está em vermelho no topo vai para Atenção imediata; o resto em Demais, com a faixa de risco");
  assert.match(l, /data-k="2\|SERGIO"[^]*?<span class="bx-sem" data-tip="Últimas 8 semanas · 3 faltas">(<i[^>]*><\/i>){8}<\/span>/, "8 semanas de faltas na fila");
  assert.deepEqual(JSON.parse(e.run("JSON.stringify([...blSemanas({injustificadas:['2026-11-01','2026-11-18','2026-11-20','2026-09-01']}).matchAll(/<i( class=\"t\")?/g)].map(m=>m[1]?1:0))")), [0, 0, 0, 0, 1, 0, 0, 1], "a barrinha da direita é a semana de hoje; falta de mais de 8 semanas fica de fora");
  e.run("LIG_BL_C='Porteiro (A)';blCentral()");
  assert.ok(/SERGIO|Sergio/.test(e.els["bx-lista"].innerHTML) && !/Aline/.test(e.els["bx-lista"].innerHTML), "clicar no cargo filtra a fila");
  e.run("LIG_BL_C='';ligBLKpi('med')");
  assert.ok(/Aline/.test(e.els["bx-lista"].innerHTML) && !/Sergio|Carlos|Nair/.test(e.els["bx-lista"].innerHTML), "cartão Com medida filtra a fila");
  assert.match(e.els["bx-kpis"].innerHTML, /<button type="button" class="bx-kpi on" aria-pressed="true" onclick="ligBLKpi\('med'\)">/, "cartão ativo marcado");
  e.run("ligBLKpi('med')");
  assert.ok(/Carlos/.test(e.els["bx-lista"].innerHTML) && e.run("LIG_BL_F") === "todos", "clicar de novo mostra todos");
});

test("Black List (central): dossiê com RE, nome, cargo, supervisor, admissão, último posto, campo digitável, documentos; histórico do ano em pastas e linha do tempo", () => {
  const e = ambiente({ pessoas: [msg()], podeBaixar: true });
  const pessoa = { chave: "9402|MARCOS", re: "9402", nome: "MARCOS A SILVA", cargo: "PORTEIRO (A)", posto: "COND. MIRANTE", supervisor: "FRANK PIMENTEL", admissao: "2021-03-12", ativo: true, obs: "Acompanhar comportamento.",
    injustificadas: ["2025-12-20", "2026-02-03", "2026-11-18"], abonadas: [["2026-07-01", "A"]], medidas: [{ data: "2026-06-15", tipo: "ADVERTÊNCIA", grau: "ESCRITA", dias: 0, motivo: "USO INADEQUADO DO CRACHÁ" }],
    semRetorno: [{ data: "2026-11-11", tipo: "Mensagem do SAC sem retorno", detalhe: "WhatsApp" }], ocorrencias: [{ em: "2026-11-19T13:00:00Z", por: "Jussilene Almeida", texto: "Aviso verbal dado." }],
    documentos: [{ chave: "a1b2c3d4e5f60718", numero: "MD-0007", medida: "ADVERTÊNCIA ESCRITA", data: "2026-06-16", arquivo: "advertencia.pdf", tipo: "application/pdf" }],
    pendentesSar2g: 0, incluidoEm: "2026-09-01T12:00:00Z", incluidoPorNome: "Jussilene Almeida", alteradoEm: "2026-11-10T17:32:00Z", alteradoPorNome: "Raphael Victor" };
  e.run("LIG_HOJE='2026-11-23';LIG_BL=" + JSON.stringify({ pessoas: [pessoa], historico: [] }) + ";LIG_BL_Q='';LIG_BL_F='todos';LIG_BL_C='';LIG_BL_SEL='';LIG_BL_MODO='';LIG_BL_PASTA='inj';blCentral();");
  const d = e.els["bx-dos"].innerHTML;
  [["Supervisor", "Frank Pimentel"], ["Admissão", "12\\/03\\/2021"], ["Situação", "Ativo"]]
    .forEach(([r, v]) => assert.match(d, new RegExp("<dt>" + r + "</dt><dd>" + v), r));
  ["RE", "Nome", "Cargo", "Último posto efetivo"].forEach(r => assert.ok(!d.includes("<dt>" + r + "</dt>"), r + " já está na ficha, não repete ao lado"));
  assert.match(d, /RE:<\/span> #9402[\s\S]*Cargo:<\/span> Porteiro \(A\)[\s\S]*Posto:<\/span> Cond\. Mirante/, "a ficha mostra RE, cargo e posto");
  assert.match(d, /<div class="bx-pasta"><span class="bx-pasta-aba">Marcos A Silva · RE 9402<\/span><div class="bx-dtopo">[\s\S]*class="bx-clip bx-clip-f"[\s\S]*<\/div><section class="bx-sec"><p class="bx-h4">Linha do tempo/, "dossiê dentro da pasta com o nome na aba e o clipe na foto");
  assert.match(d, /bx-sil-h3\.webp/, "silhueta de homem pelo nome, variante pelo RE");
  const cols = [...d.matchAll(/class="bx-tm((?: [a-z]+)*)"/g)].map(m => m[1]);
  assert.equal(cols.length, 12, "uma coluna por mês");
  assert.deepEqual([cols[0], cols[10], cols[11]], [" vz", " on", " fut"], "janeiro vazio, novembro é o mês atual, dezembro ainda não chegou");
  assert.match(d, /data-tip="Novembro · 2026&#10;1 falta injustificada&#10;1 sem retorno do SAC&#10;1 ocorrência" aria-label="Novembro · 2026: 1 falta injustificada, 1 sem retorno do SAC, 1 ocorrência" onclick="blMes\(11\)"><span class="bx-tm-b" style="height:\d+px"><i class="f" style="flex-grow:1"><\/i><i class="s"[^>]*><\/i><i class="o"/, "novembro: total do mês empilhado por tipo, com o detalhe no balão");
  assert.match(d, /Setembro · 2026&#10;Nenhum registro&#10;Entrou na Black List"[^>]*><em class="bx-tm-in"/, "bandeirinha no mês em que entrou na lista");
  assert.ok(!/bx-mk/.test(d), "sem as bolinhas soltas");
  assert.ok(!/bx-orn2/.test(d), "ficha sem os enfeites nos cantos");
  assert.ok(!/20\/12\/2025/.test(d), "o histórico é o do ano: falta do ano passado fica de fora");
  assert.match(d, /<div class="bx-fi-div on" style="--i:0" data-k="inj"><button type="button" role="tab" class="bx-fi-tab" aria-selected="true"[^>]*><i[^>]*><\/i>Faltas injustificadas<b>2<\/b>[\s\S]*Medidas disciplinares<b>1<\/b>[\s\S]*Faltas abonadas<b>1<\/b>[\s\S]*Ligações sem retorno<b>1<\/b>/, "fichário: divisórias com a quantidade do ano");
  assert.ok(!/Ocorrências<b>/.test(d), "ocorrências ficam só nas anotações, fora do fichário");
  assert.match(d, /bx-fi-et">Histórico 2026</);
  assert.match(d, /Faltas injustificadas<b>2<\/b><\/button><div class="bx-fi-cont" role="tabpanel" aria-label="Faltas injustificadas"><h5>Faltas injustificadas · 2026<span>2 registros<\/span><button type="button" class="bx-fi-x" aria-label="Fechar Faltas injustificadas e guardar na gaveta"[^>]*onclick="blPasta\(''\)">[\s\S]*?<\/button><\/h5><div class="bx-fi-mb" aria-hidden="true">[\s\S]*?<\/div><ol class="bx-fi-lst"><li class="bx-fi-mes" data-m="11"><b>Novembro<\/b> · 1 falta<\/li><li data-m="11"><time>18\/11\/2026<\/time><span>Quarta<\/span><em><\/em><span class="bx-fi-cb f">Sem justificativa<\/span><\/li><li class="bx-fi-mes" data-m="02"><b>Fevereiro<\/b> · 1 falta<\/li><li data-m="02"><time>03\/02\/2026<\/time><span>Terça/, "a divisória puxada mostra os acontecimentos por mês, do mais recente para o mais antigo, com carimbo");
  assert.equal((d.match(/<i style="height:26px"><\/i>/g) || []).length, 2, "barrinha dos 12 meses: fevereiro e novembro com 1 falta cada");
  assert.equal((d.match(/class="bx-fi-cont"/g) || []).length, 1, "só a divisória puxada mostra o conteúdo");
  assert.match(d, /<button type="button" class="bx-btn bx-amp" onclick="ligBLNotas\(\)">/, "botão para ampliar as anotações");
  assert.ok(!/bx-ler/.test(d), "anotação curta não precisa de Ler tudo");
  assert.match(d, /Anotações internas da coordenação <span class="bx-cont">2<\/span>/);
  assert.match(d, /<article class="bx-nt fixa">[\s\S]*Anotação geral<\/span><time>10\/11\/2026<\/time><\/header><p>Acompanhar comportamento\.<\/p><footer>Raphael Victor<\/footer>[\s\S]*<span class="bx-ntag oc">Ocorrência<\/span><time>19\/11\/2026 \d\d:\d\d<\/time><\/header><p>Aviso verbal dado\.<\/p><footer>Jussilene Almeida/, "cada registro numa ficha, com data, hora e quem registrou");
  assert.ok(!/bx-tend|30 anteriores/.test(d), "sem o card de tendência");
  assert.match(d, /ligBLDoc\('a1b2c3d4e5f60718'\)[\s\S]*advertencia\.pdf/);
  assert.match(d, /Registrar ocorrência[\s\S]*Editar anotação[\s\S]*Remover da Black List/);
  e.run("LIG_BL_MODO='oc';blDossie()");
  assert.match(e.els["bx-dos"].innerHTML, /<textarea id="bx-oc"[\s\S]*ligBLOcorrencia\(\)/, "campo digitável da ocorrência");
  e.run("LIG_BL_MODO='nota';blDossie()");
  assert.match(e.els["bx-dos"].innerHTML, /<textarea id="bx-obs"[^>]*>Acompanhar comportamento\./, "campo digitável da anotação");
  e.run("LIG_BL_MODO='';blDossie();blPasta('med')");
  assert.match(e.els["bx-hist"].innerHTML, /<div class="bx-fi-div on" style="--i:1" data-k="med">[\s\S]*Medidas disciplinares · 2026[\s\S]*<time>15\/06\/2026<\/time><span>Advertência Escrita<\/span><em>Uso Inadequado do Crachá<\/em>/, "puxar outra divisória: ela sobe com os acontecimentos dela");
  e.run("blPasta('')");
  assert.ok(/bx-fi-gav fechada/.test(e.els["bx-hist"].innerHTML) && !/bx-fi-cont|bx-fi-div on/.test(e.els["bx-hist"].innerHTML), "o X guarda a divisória: gaveta fechada, só as abas");
  e.run("blPasta('abo')");
  assert.match(e.els["bx-hist"].innerHTML, /bx-fi-div on" style="--i:2" data-k="abo"/, "e dá para puxar de novo");
  const longa = e.run("blNotas(" + JSON.stringify({ obs: "x".repeat(300), ocorrencias: [] }) + ",false)");
  assert.match(longa, /class="bx-nt fixa longa"[\s\S]*<button type="button" class="bx-ler" aria-expanded="false" onclick="blLer\(this\)">Ler tudo<\/button>/, "texto longo vem recolhido com Ler tudo");
  assert.ok(!/bx-ler|longa/.test(e.run("blNotas(" + JSON.stringify({ obs: "x".repeat(300), ocorrencias: [] }) + ",true)")), "na janela ampliada tudo aparece inteiro");
});

test("Black List: silhueta pelo nome, com a escolha da coordenação valendo mais", () => {
  const e = ambiente({ pessoas: [msg()], podeBaixar: true });
  const sx = n => e.run("blSexo(" + JSON.stringify({ nome: n }) + ")");
  assert.deepEqual(["DEBORA SOUZA", "SERGIO LIMA", "ALINE ROCHA", "NAIR DIAS", "SUELY MOTA", "JOSE SILVA", "MICHELE ALVES", "MICHEL ALVES", "LUCA PRADO", "RAQUEL DIAS"].map(sx), ["f", "m", "f", "f", "f", "m", "f", "m", "m", "f"]);
  assert.equal(e.run("blSexo({nome:'ANDREA COSTA',silhueta:'m'})"), "m", "a correção da coordenação vale mais que o nome");
  assert.match(e.run("blFoto({nome:'DEBORA',re:'15'})"), /bx-sil-f2\.webp/);
  assert.match(e.run("blFoto({nome:'SERGIO',re:'15'})"), /bx-sil-h4\.webp/, "silhueta de homem e de mulher, variante pelo RE");
});
