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
  const resumo = { mensagem: 0, aguardando: 0, base: 0, acomp: 0, vereditos: { melhorando: 0, mesma: 0, piorou: 0, comecando: 0 } };
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
  assert.match(h, /<section class="fb-topo"><header class="fb-band">[\s\S]*<h1>Feedback de Faltas<\/h1><p>Grupo ServCamp - Hoje - \d\d\/\d\d\/\d{4}<\/p>[\s\S]*<\/header><div class="fb-filtros">[\s\S]*Turno[\s\S]*Área[\s\S]*fb-abas[\s\S]*<\/section><div id="lig-panel">/, "faixa, filtros e abas num bloco só (referência 1)");
  const topo = h.slice(0, h.indexOf('<div id="lig-panel">'));
  assert.ok(!/Período|fb-kpi|fb-funil/.test(topo), "período e números saíram do topo: ficam só na Visão geral");
  assert.match(h, /<span class="fb-selp"><select id="lig-turno"/, "turno e área em pílula com seta, como na referência");
  assert.match(h, /Fila do SAC<span class="n">4<\/span>/);
  assert.match(h, /Monitoramento 30 dias<span class="n">1<\/span>/);
  assert.match(h, /Enviar mensagem<span class="n">2<\/span>/);
  assert.match(h, /Aguardando ligação<span class="n">1<\/span>/);
  assert.match(h, /Com a coordenação<span class="n">1<\/span>/);
  assert.ok(!/Piorou<span|Melhorou<span/.test(h), "Piorou, Melhorou e cia. não ficam na fila");
  const m = e.html("acomp");
  assert.match(m, /Todos<span class="n">1<\/span>[\s\S]*Piorou<span class="n">0<\/span>[\s\S]*Igual a antes<span class="n">0<\/span>[\s\S]*Em observação<span class="n">0<\/span>[\s\S]*Melhorou<span class="n">1<\/span>/);
  assert.ok(h.includes("Enviar WhatsApp") && h.includes("Registrar feedback"), "as duas ações ficam sempre na linha das abas");
  assert.ok(m.includes("ligZapAbrir('','','',[],null)") && m.includes('onclick="ligForm()"'), "também no Monitoramento");
  assert.match(h, /Enviar WhatsApp<span id="lig-zap-chip" class="fb-zp"><i class="fb-dot off"/, "o estado do WhatsApp é um ponto no botão");
  assert.ok(!/Atividades|Sem posicionamento|Chamar na base|Mandar mensagem/.test(h), "os nomes antigos saíram");
});

/* funil: ANA e ZECA sem mensagem; BIA recebeu e não respondeu; CAIO recebeu e ligou (feedback registrado) */
const funilInd = () => ({ hoje, desde: dia(-120), prazo_resposta_dias: 1,
  dias: [[dia(-5), "FRANK", 3, 1], [dia(-5), "PAULO SOUZA", 1, 0]],
  pessoas: [["1", "ANA SOUZA", "POSTO A", "FRANK"], ["2", "BIA LIMA", "POSTO B", "FRANK"], ["3", "CAIO DIAS", "POSTO C", "FRANK"], ["9", "ZECA REIS", "POSTO Z", "PAULO SOUZA"]],
  funil: { faltas: [[dia(-5), 0, "I"], [dia(-5), 0, "A"], [dia(-5), 1, "I"], [dia(-5), 2, "T"], [dia(-5), 3, "I"]], envios: [[dia(-4), 1], [dia(-4), 2]], feedbacks: [[dia(-3), 2]] },
  com_feedback: [], conversas: [[dia(-3), "Saúde", 10, "FRANK", "Ingridy"], [dia(-3), "Familiar", 20, "FRANK", "Joyce"], [dia(-3), "Saúde", null, "FRANK", "Joyce"]],
  supervisores: ["FRANK", "PAULO SOUZA"], turnos: { FRANK: "DIURNO", "PAULO SOUZA": "NOTURNO" } });

test("Visão geral: o funil faltaram → mensagem → ligaram (feedback) / não responderam, com avatares e a lista que troca", () => {
  const e = ambiente({ pessoas: [msg()], ind: funilInd() });
  e.run(`LIG_F.per="periodo";LIG_F.de=${JSON.stringify(dia(-10))};LIG_F.ate=${JSON.stringify(hoje)}`);
  let h = e.html("visao");
  assert.match(h, /Hoje<\/button><button[^>]*>Semana<\/button><button[^>]*>Folha<\/button><button[^>]*>Período/, "o período fica acima dos cards");
  assert.match(h, /1 · Faltaram<\/small><\/span><span class="mid"><b data-n="\d+">4<\/b>/);
  assert.match(h, /2 · Mensagem enviada<\/small><\/span><span class="mid"><b data-n="\d+">2<\/b>/);
  assert.match(h, /50% de quem faltou/);
  assert.match(h, /3 · Ligaram · feedback registrado<\/small><\/span><span class="mid"><b data-n="\d+">1<\/b>/);
  assert.match(h, /4 · Não responderam<\/small><\/span><span class="mid"><b data-n="\d+">1<\/b>/);
  assert.match(h, /2 sem mensagem/);
  assert.match(h, /<span class="fb-avs"><i title="ANA SOUZA">AS<\/i>/, "avatares de quem está na etapa");
  assert.match(h, /Tempo médio por feedback<\/small><\/span><span class="mid"><b data-n="\d+">15<em>min<\/em><\/b>/, "média só de quem informou o tempo");
  assert.ok(!/class="fb-fc g-amber info"[^>]*onclick/.test(h), "o tempo médio não é clicável");
  assert.match(h, /1 falta abonada no período não entram no funil/);
  assert.match(h, /<b>Faltaram<\/b><span>4 pessoas/, "a lista abaixo começa com quem faltou");
  e.run('ligVG("naoresp")');
  h = e.els["lig-panel"].innerHTML;
  assert.match(h, /<b>Não responderam<\/b><span>1 pessoa/);
  assert.match(h, /BIA LIMA[\s\S]*Não respondeu[\s\S]*ligVGEnviar\(0\)[\s\S]*ligVGRegistrar\(0\)/, "a lista troca e traz as ações");
  e.run('ligVG("ligaram")');
  assert.match(e.els["lig-panel"].innerHTML, /CAIO DIAS[\s\S]*Feedback registrado[\s\S]*Ligou e o feedback foi registrado em \d\d\/\d\d/);
  e.run('LIG_F.turno="NOTURNO"');
  h = e.html("visao");
  assert.match(h, /1 · Faltaram<\/small><\/span><span class="mid"><b data-n="\d+">1<\/b>/, "turno e área valem para o funil");
  assert.equal(e.run('LIG_F.turno="todos";LIG_F.per="periodo";LIG_F.de="2026-11-20";LIG_F.ate="2026-11-01";JSON.stringify(fbPeriodo())'), JSON.stringify({ de: "2026-11-01", ate: "2026-11-20", rot: "01/11 a 20/11" }), "datas trocadas se acertam");
  assert.match(e.run('LIG_F.per="folha";fbPeriodo().rot'), /^Folha até \d\d\/\d\d$/);
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
  assert.equal(e.run("fbPct(10,7)"), -30);
  assert.equal(e.run("fbPct(0,3)"), null);
  assert.equal(e.run("fbPctTxt(-30)"), "−30%");
});

test("Desempenho: painel com 4 sub-abas, indicadores precisos, colunas e projeção", () => {
  const e = ambiente();
  const kHoje = e.run(`fbMesChave(${JSON.stringify(hoje)},"civil")`);
  const mes = (k, n) => { let a = Number(k.slice(0, 4)), m = Number(k.slice(5, 7)) + n; while (m < 1) { m += 12; a--; } while (m > 12) { m -= 12; a++; } return a + "-" + String(m).padStart(2, "0"); };
  const kI = mes(kHoje, -3), kF = mes(kHoje, -1), d1 = kI + "-05", d2 = kI + "-06", d3 = kI + "-07", dF = kF + "-10";
  const ind = { hoje, desde: mes(kHoje, -5) + "-01", dias: [[d1, "FRANK", 10, 2], [dF, "FRANK", 5, 1]], pessoas: [["1", "ANA SOUZA", "POSTO A", "FRANK"]],
    funil: { faltas: [[d1, 0, "I"], [d2, 0, "I"], [dF, 0, "I"]], envios: [[d3, 0]], feedbacks: [[d3, 0]] },
    com_feedback: [{ key: "1|ANA", re: "1", nome: "ANA SOUZA", posto: "", supervisor: "FRANK", contatos: [d3], faltas: [[d1, "S"], [d2, "S"], [dF, "S"]] }],
    conversas: [[dF, "Saúde", 10, "FRANK", "Ingridy"], [dF, "Transporte", 6, "FRANK", "Joyce"]], supervisores: ["FRANK"], turnos: { FRANK: "DIURNO" } };
  const e2 = ambiente({ ind });
  e2.run(`LIG_DES={modo:"civil",ini:${JSON.stringify(kI)},fim:${JSON.stringify(kF)},ord:"var",dir:1};LIG_DSUB="resumo"`);
  let h = e2.html("desemp");
  assert.match(h, /Resumo executivo[\s\S]*Efeito do feedback[\s\S]*Empresa e áreas[\s\S]*Motivos e atendimento/, "as 4 sub-abas");
  assert.match(h, /Folha 26 a 25/); assert.match(h, /Mês do calendário/);
  assert.match(h, /class="fb-kg g-green"><span class="ic">[\s\S]*?Faltas da empresa<\/small><b>−50%<\/b>/, "10 → 5: queda, em verde");
  assert.match(h, /Efeito do feedback<\/small><b>−100%<\/b>/, "2 faltas antes do feedback, nenhuma depois");
  assert.match(h, /Taxa de melhora<\/small><b>100%<\/b>/);
  assert.match(h, /Tempo médio por feedback<\/small><b>8 min<\/b>/);
  assert.match(h, /<svg class="fb-g"[\s\S]*class="gln"/, "curva mês a mês");
  assert.match(h, /data-tip="[^"]*: 10"/, "valor exato ao passar o mouse");
  assert.match(h, /Fechamento do mês/);
  assert.match(h, /Mensagens enviadas[\s\S]*Feedbacks registrados[\s\S]*Retorno das mensagens/);
  e2.run('ligDes("sub","efeito")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Pessoas avaliadas<\/small><b>1<\/b>/);
  assert.match(h, /Melhoraram<\/small><b>100%<\/b>/);
  assert.match(h, /class="fb-rosca"/);
  assert.match(h, /Faltas antes × depois do feedback, por mês do contato/);
  assert.match(h, /Maiores melhoras[\s\S]*ANA SOUZA[\s\S]*2 → 0/);
  assert.match(h, /Cada colaborador[\s\S]*ANA SOUZA[\s\S]*−50%[\s\S]*Melhorou/);
  assert.ok(h.includes('onclick="ligDesAbrir(0)"'), "a linha abre o panorama");
  e2.run('ligDes("sub","areas")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Faltas da empresa por mês e projeção/);
  assert.match(h, /class="gc"/, "colunas");
  assert.match(h, /Cada supervisor: melhorou ou piorou[\s\S]*Frank/);
  e2.run('ligDes("sub","motivos")');
  h = e2.els["lig-panel"].innerHTML;
  assert.match(h, /Faltas tratadas<\/small><b>2<\/b>/);
  assert.match(h, /Motivos das faltas tratadas[\s\S]*Saúde[\s\S]*50%/);
  assert.match(h, /Tempo médio por pessoa do SAC[\s\S]*Ingridy[\s\S]*10 min/);
  assert.match(ambiente().html("desemp"), /Acompanhe o comportamento/, "sem números, a tela vazia");
});

test("projeção: fechamento do mês pelo ritmo e tendência pelos meses fechados", () => {
  const e = ambiente();
  assert.equal(e.run("fbTeto(37)"), 50);
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

test("Monitoramento 30 dias (referência 4): fundo na cor do resultado, faltas antes × depois com as datas e o ícone de tendência", () => {
  const e = ambiente({ pessoas: [
    acomp(), acomp({ nome: "PIOR", key: "2|P", re: "2", acomp: { dia: 9, antes: 2, depois: 4, abonadas_depois: 0, ultima_falta_depois: dia(-1), faltas_depois: [dia(-6), dia(-4), dia(-2), dia(-1)], veredito: "piorou", sem_baixa: true } }),
    acomp({ nome: "COMBINADO", key: "3|C", re: "3", contato: { id: 8, data: dia(-5), por: "Raphael Victor", acordo_prazo: dia(-1), acordo_auto: "nao_cumpriu", baixa: null } })] });
  const h = e.html("acomp");
  assert.equal((h.match(/class="fb-pc fb-pm /g) || []).length, 3);
  assert.match(h, /class="fb-pc fb-pm tn-da"/, "piorou: fundo vermelho claro");
  assert.match(h, /class="fb-pc fb-pm tn-ok"/, "melhorou: fundo verde claro");
  assert.match(h, /<span class="fb-vp"><svg[^>]*>.*?<\/svg>Piorou<\/span>/);
  assert.match(h, /title="Antes do feedback"><div><b>2<\/b><span>Faltas<\/span><\/div><em>em 30 dias<\/em><em>\(\d\d\/\d\d a \d\d\/\d\d\)<\/em>/);
  assert.match(h, /title="Depois do feedback"><div><b>4<\/b><span>Faltas<\/span><\/div><em>em 9 dias<\/em><em>\(\d\d\/\d\d a \d\d\/\d\d\)<\/em>/);
  assert.match(h, /class="fb-pm-ic">/); assert.match(h, /class="fb-pm-go">/);
  assert.match(h, /RE 1 • Posto A/);
  assert.match(h, /Aguardando baixa da coordenação/);
  assert.match(h, /Combinado não cumprido/);
  assert.ok(!/fb-cal|fb-mini/.test(h), "o calendário fica só no panorama");
  assert.ok(!/Dia \d+ de 30/.test(h));
  assert.match(h, /title="Faltou mais vezes do que antes."/);
  const f = e.html("acomp", "piorou");
  assert.equal((f.match(/class="fb-pc fb-pm /g) || []).length, 1);
  assert.match(f, /PIOR/);
  assert.match(e.html("acomp", "comecando"), /Acompanhe o comportamento/);
});

test("o rótulo dos vereditos é o mesmo no filtro, no card e no texto de ajuda", () => {
  const e = ambiente({ pessoas: [acomp()] });
  const h = e.html("acomp");
  ["Melhorou", "Igual a antes", "Piorou", "Em observação"].forEach(r => assert.ok(h.includes(r), r));
  assert.ok(!/Na mesma|Começando|Faltou de novo/.test(h), "palavras antigas fora");
  assert.deepEqual(JSON.parse(e.run("JSON.stringify(Object.values(FB_VD).map(v=>v.t))")).sort(), ["Em observação", "Igual a antes", "Melhorou", "Piorou"]);
});

test("a faixa e o calendário marcam falta, abonada, dia futuro, hoje e mensagem do SAC", () => {
  const e = ambiente({ pessoas: [acomp()] });
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
  assert.match(h, /Antes do feedback<\/small><b>2 faltas<\/b><em>\d\d\/\d\d a \d\d\/\d\d<\/em>/);
  assert.match(h, /Depois do feedback<\/small><b>0 faltas<\/b><em>/);
  assert.match(h, /Acompanhamento<\/small><b>até \d\d\/\d\d<\/b><span>faltam 18 dias<\/span>/);
  assert.match(h, /fb-prog/); assert.match(h, /role="progressbar"/);
  // evolução: barras com o número em cima e a variação
  assert.match(h, /fb-evoc/);
  assert.match(h, /Faltas antes e depois do feedback/); assert.match(h, /<svg class="fb-g fb-gl"/);
  assert.match(h, /Resultado/);
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
  assert.match(linha, /Faltou \(já tratada pelo SAC\)/);
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
  assert.match(barra, /15<\/b> pessoas selecionadas · limite de 15 por vez/);
  assert.match(barra, /Enviar mensagem para 15/);
  // o 16º não entra
  const cx = { checked: true, closest: () => null };
  e.run("ligSel(15,{checked:true,closest:()=>null})");
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
  assert.equal((h.match(/class="fb-con"/g) || []).length, 4, "conector entre os cards, fora do texto");
  assert.ok(!/fb-seta/.test(h));
  assert.match(e.html("mensagem"), /data-nav="sub" data-ind="linha"[\s\S]*<div id="lig-lista">/);
  assert.match(e.html("desemp"), /data-nav="dsub"/);
});
