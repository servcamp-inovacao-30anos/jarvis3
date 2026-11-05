// Agenda Comercial: regras (api/_agenda_regras.js) e API (api/_agenda.js, via /api/rh?modulo=agenda e
// ?modulo=agendapub) contra um Supabase falso. O que mais importa: nunca reunião em cima de reunião (nem
// encostada, sem o intervalo), o link público só mostra horário livre e só a administradora mexe na agenda.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const R = require("../api/_agenda_regras");
const rh = require("../api/rh");
const { supabaseFalso, chamar } = require("./_supabase_falso");

// quinta-feira 05/11/2026, 10:00 em Brasília
const AGORA = Date.parse("2026-11-05T13:00:00Z");
const QUI = "2026-11-12"; // quinta da semana seguinte
const cfg = () => JSON.parse(JSON.stringify(R.CONFIG_PADRAO)); // seg a sex 9h–17h, intervalo 15, antecedência 4h, 30 dias, a cada 30 min
const T60 = { duracao_min: 60 };

// ── regras ──────────────────────────────────────────────────────────────────

test("horário de Brasília: ida e volta para UTC", () => {
  assert.equal(new Date(R.paraUtc("2026-11-12", "09:00")).toISOString(), "2026-11-12T12:00:00.000Z");
  assert.deepEqual(R.deUtc(Date.parse("2026-11-13T01:30:00Z")), { dia: "2026-11-12", hora: "22:30" });
  assert.equal(R.hojeBR(Date.parse("2026-11-06T02:00:00Z")), "2026-11-05", "23h de Brasília ainda é o mesmo dia");
});

test("horários livres: dentro do atendimento, a cada 30 min, cabendo a reunião inteira", () => {
  const h = R.horariosDoDia(cfg(), T60, QUI, [], [], AGORA);
  assert.equal(h[0], "09:00");
  assert.equal(h[h.length - 1], "16:00", "reunião de 1h começa no máximo às 16:00 para acabar às 17:00");
  assert.equal(h.length, 15);
  assert.deepEqual(R.horariosDoDia(cfg(), T60, "2026-11-14", [], [], AGORA), [], "sábado não tem atendimento");
});

test("reunião marcada ocupa o horário e o intervalo dos dois lados", () => {
  const f = R.faixa(QUI, "10:00", 60, 15); // 10:00–11:00, ocupa até 11:15
  const h = R.horariosDoDia(cfg(), T60, QUI, [{ inicio: f.inicio, ocupa_ate: f.ocupa_ate }], [], AGORA);
  assert.ok(!h.includes("09:00"), "09:00–10:00 encostaria sem o intervalo de 15 min");
  assert.ok(!h.includes("10:00") && !h.includes("10:30") && !h.includes("11:00"));
  assert.ok(h.includes("11:30"), "11:30 já respeita o intervalo depois da reunião das 10h");
  // com intervalo zero, encostar é permitido
  const c0 = cfg(); c0.intervalo_min = 0;
  const f0 = R.faixa(QUI, "10:00", 60, 0);
  const h0 = R.horariosDoDia(c0, T60, QUI, [{ inicio: f0.inicio, ocupa_ate: f0.ocupa_ate }], [], AGORA);
  assert.ok(h0.includes("09:00") && h0.includes("11:00"));
});

test("antecedência mínima, janela de dias e bloqueios", () => {
  const hoje = R.horariosDoDia(cfg(), T60, "2026-11-05", [], [], AGORA);
  assert.equal(hoje[0], "14:00", "agora são 10h e a antecedência é de 4h");
  const c = cfg(); c.janela_dias = 5;
  assert.deepEqual(R.horariosDoDia(c, T60, QUI, [], [], AGORA), [], "dia 12 está além dos 5 dias abertos");
  const bl = [{ inicio: R.paraUtc(QUI, "12:00"), fim: R.paraUtc(QUI, "14:00") }];
  const h = R.horariosDoDia(cfg(), T60, QUI, [], bl, AGORA);
  assert.ok(h.includes("11:00") && !h.includes("11:30") && !h.includes("13:30") && h.includes("14:00"));
  const livres = R.horariosLivres(cfg(), T60, [], [], AGORA);
  assert.ok(!livres["2026-11-07"] && !livres["2026-11-08"], "fim de semana fica fora");
  assert.ok(livres[QUI]);
});

test("configuração: recusa faixa que se cruza, hora inválida e números fora do limite", () => {
  assert.ok(R.validarConfig({ semana: { "1": [["09:00", "12:00"], ["11:00", "14:00"]] }, intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30 }).erro);
  assert.ok(R.validarConfig({ semana: { "1": [["9h", "12:00"]] }, intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30 }).erro);
  assert.ok(R.validarConfig({ semana: { "1": [["12:00", "09:00"]] }, intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30 }).erro);
  assert.ok(R.validarConfig(Object.assign(cfg(), { janela_dias: 0 })).erro);
  const ok = R.validarConfig({ semana: { "1": [["14:00", "17:00"], ["09:00", "12:00"]], "9": [["01:00", "02:00"]] }, intervalo_min: 0, antecedencia_h: 0, janela_dias: 7, passo_min: 15 });
  assert.equal(ok.erro, undefined);
  assert.deepEqual(ok.config.semana, { "1": [["09:00", "12:00"], ["14:00", "17:00"]] }, "ordena as faixas e ignora dia inexistente");
});

test("dados de quem marca: nome e telefone com DDD; e-mail opcional mas válido", () => {
  assert.ok(R.validarPessoa({ nome: "A", telefone: "19999999999" }).erro);
  assert.ok(R.validarPessoa({ nome: "Ana", telefone: "99999" }).erro);
  assert.ok(R.validarPessoa({ nome: "Ana", telefone: "(19) 99999-9999", email: "x@" }).erro);
  const v = R.validarPessoa({ nome: "  Ana  ", telefone: "(19) 99999-9999", email: "ANA@EXEMPLO.COM" });
  assert.deepEqual(v.pessoa, { nome: "Ana", telefone: "19999999999", email: "ana@exemplo.com", obs: null });
  assert.equal(R.validarPessoa({ nome: "Ana" }, { telefoneOpcional: true }).pessoa.telefone, null, "na reunião cadastrada à mão o telefone pode faltar");
});

test("calendário .ics: linhas CRLF de até 75 caracteres e texto escapado", () => {
  const s = R.ics([{ id: 7, inicio: R.paraUtc(QUI, "10:00"), fim: R.paraUtc(QUI, "11:00"), titulo: "Captação; Ana, Silva", descricao: "linha 1\nlinha 2 " + "x".repeat(120), local: "Rua A, 10" }], { nome: "Agenda", agora: AGORA });
  assert.ok(s.startsWith("BEGIN:VCALENDAR\r\n") && s.endsWith("END:VCALENDAR\r\n"));
  assert.ok(s.includes("DTSTART:20261112T130000Z"));
  assert.ok(s.includes("SUMMARY:Captação\\; Ana\\, Silva"));
  assert.ok(s.includes("linha 1\\nlinha 2"));
  assert.ok(s.split("\r\n").every(l => l.length <= 75), "nenhuma linha passa de 75");
});

// ── API ─────────────────────────────────────────────────────────────────────

function comRelogio(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  return Promise.resolve().then(fn).finally(() => { Date.now = real; });
}
const pub = (t, opts) => chamar(rh, Object.assign({}, opts, { query: Object.assign({ modulo: "agendapub", t }, (opts && opts.query) || {}) }));
const adm = (t, opts) => chamar(rh, Object.assign({ usuario: "joaoygor" }, opts, { query: Object.assign({ modulo: "agenda" }, t ? { t } : {}, (opts && opts.query) || {}) }));
const pessoa = (n, extra) => Object.assign({ nome: "Pessoa " + n, telefone: "1999999" + String(1000 + n).slice(-4), email: "p" + n + "@exemplo.com" }, extra || {});
async function preparar() {
  const tabelas = { app_users: [{ user_key: "carlos", ativo: true, perms: {} }, { user_key: "liberada", nome: "Liberada", ativo: true, perms: { guias: { agenda: true } } }] };
  supabaseFalso(tabelas);
  const r = await adm(""); // a primeira abertura cria a configuração e os tipos iniciais
  assert.equal(r.statusCode, 200);
  return { tabelas, slug60: tabelas.ag_tipos.find(t => t.duracao_min === 60).slug, slug30: tabelas.ag_tipos.find(t => t.duracao_min === 30).slug };
}

test("API: só o admin (e quem recebeu a guia) mexe na agenda; por enquanto a Gabriela ainda não", async () => {
  await comRelogio(AGORA, async () => {
    await preparar();
    assert.equal((await adm("", { usuario: "carlos" })).statusCode, 403);
    assert.equal((await adm("", { usuario: "gabrielaalvarenga" })).statusCode, 403, "liberada só quando a agenda estiver completa");
    assert.equal((await adm("", { usuario: "joaoygor" })).statusCode, 200);
    assert.equal((await adm("", { usuario: "liberada" })).statusCode, 200);
    assert.equal((await chamar(rh, { query: { modulo: "agenda" } })).statusCode, 401, "sem login nem chega");
    const r = await adm("");
    assert.deepEqual(r.body.tipos.map(t => t.nome), ["Reunião com cliente", "Captação"]);
    assert.ok(r.body.ics_chave && r.body.ics_chave.length >= 30);
  });
});

test("API pública: sem login mostra só os horários livres; link desconhecido não existe", async () => {
  await comRelogio(AGORA, async () => {
    const { slug60 } = await preparar();
    const r = await pub("horarios", { query: { s: slug60 } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.tipo.duracao_min, 60);
    assert.equal(r.body.dias["2026-11-05"][0], "14:00");
    assert.ok(!JSON.stringify(r.body).includes("telefone"));
    assert.equal((await pub("horarios", { query: { s: "naoexiste" } })).statusCode, 404);
  });
});

test("API pública: marca, e o mesmo horário não pode ser marcado de novo (nem encostado sem intervalo)", async () => {
  await comRelogio(AGORA, async () => {
    const { tabelas, slug60, slug30 } = await preparar();
    const a = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "10:00" }, pessoa(1)) });
    assert.equal(a.statusCode, 201, JSON.stringify(a.body));
    assert.ok(a.body.convite && a.body.convite.c);
    assert.equal(tabelas.ag_reunioes.length, 1);
    assert.equal(tabelas.ag_reunioes[0].ocupa_ate, "2026-11-12T14:15:00.000Z");
    const b = await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "10:30" }, pessoa(2)) });
    assert.equal(b.statusCode, 409, "em cima");
    const c = await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "09:30" }, pessoa(3)) });
    assert.equal(c.statusCode, 409, "09:30–10:00 encosta sem os 15 min de intervalo");
    const d = await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "11:30" }, pessoa(4)) });
    assert.equal(d.statusCode, 201);
    const h = await pub("horarios", { query: { s: slug30 } });
    assert.ok(!h.body.dias[QUI].includes("10:00") && !h.body.dias[QUI].includes("11:30"));
    assert.equal(tabelas.ag_reunioes.length, 2);
  });
});

test("API pública: se o banco recusar por sobreposição (dois cliques ao mesmo tempo), responde 'ocupado'", async () => {
  await comRelogio(AGORA, async () => {
    const { slug60 } = await preparar();
    const fetchFalso = global.fetch;
    global.fetch = async (url, init) => {
      if (init && init.method === "POST" && String(url).includes("/ag_reunioes")) return { ok: false, status: 409, json: async () => ({}), text: async () => '{"code":"23P01","message":"conflicting key value violates exclusion constraint \\"ag_reunioes_sem_sobreposicao\\""}' };
      return fetchFalso(url, init);
    };
    try {
      const r = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "10:00" }, pessoa(1)) });
      assert.equal(r.statusCode, 409);
      assert.equal(r.body.codigo, "OCUPADO");
    } finally { global.fetch = fetchFalso; }
  });
});

test("API pública: robô (campo escondido), dados faltando, horário fora do atendimento e limite por endereço de internet", async () => {
  await comRelogio(AGORA, async () => {
    const { tabelas, slug30 } = await preparar();
    assert.equal((await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "10:00", site: "x" }, pessoa(1)) })).statusCode, 400);
    assert.equal((await pub("agendar", { method: "POST", body: { s: slug30, dia: QUI, hora: "10:00", nome: "Ana" } })).statusCode, 400);
    assert.equal((await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "20:00" }, pessoa(1)) })).statusCode, 409);
    assert.equal((await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: "2026-11-14", hora: "10:00" }, pessoa(1)) })).statusCode, 409, "sábado");
    const ip = { "x-forwarded-for": "200.1.2.3" };
    const horas = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
    for (let i = 0; i < 5; i++) {
      const r = await pub("agendar", { method: "POST", headers: ip, body: Object.assign({ s: slug30, dia: QUI, hora: horas[i] }, pessoa(10 + i)) });
      assert.equal(r.statusCode, 201, JSON.stringify(r.body));
    }
    const sexto = await pub("agendar", { method: "POST", headers: ip, body: Object.assign({ s: slug30, dia: QUI, hora: horas[5] }, pessoa(20)) });
    assert.equal(sexto.statusCode, 429);
    assert.equal(tabelas.ag_reunioes.length, 5);
  });
});

test("API: reunião cadastrada à mão, remarcar e cancelar — sempre sem sobreposição", async () => {
  await comRelogio(AGORA, async () => {
    const { tabelas, slug60 } = await preparar();
    const tipo = tabelas.ag_tipos.find(t => t.slug === slug60);
    const m = await adm("reuniao", { method: "POST", body: { tipo_id: tipo.id, dia: QUI, hora: "19:00", nome: "Diretor X" } });
    assert.equal(m.statusCode, 201, "à mão pode ser fora do atendimento e sem telefone");
    const p = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "10:00" }, pessoa(1)) });
    assert.equal(p.statusCode, 201);
    const em = await adm("reuniao", { method: "POST", body: { tipo_id: tipo.id, dia: QUI, hora: "10:30", nome: "Em cima" } });
    assert.equal(em.statusCode, 409);
    const idPub = tabelas.ag_reunioes.find(r => r.origem === "link").id;
    assert.equal((await adm("reuniao", { method: "PATCH", query: { id: String(idPub) }, body: { dia: QUI, hora: "18:30" } })).statusCode, 409, "remarcar para cima da das 19h");
    assert.equal((await adm("reuniao", { method: "PATCH", query: { id: String(idPub) }, body: { dia: QUI, hora: "14:00" } })).statusCode, 200);
    assert.equal(tabelas.ag_reunioes.find(r => r.id === idPub).inicio, "2026-11-12T17:00:00.000Z");
    assert.equal((await adm("cancelar", { method: "POST", query: { id: String(idPub) } })).statusCode, 200);
    const h = await pub("horarios", { query: { s: slug60 } });
    assert.ok(h.body.dias[QUI].includes("14:00"), "cancelada libera o horário");
  });
});

test("API: bloqueio some com o horário do link; configuração inválida é recusada", async () => {
  await comRelogio(AGORA, async () => {
    const { slug30 } = await preparar();
    assert.equal((await adm("bloqueio", { method: "POST", body: { dia: QUI, ateDia: QUI, motivo: "Feriado" } })).statusCode, 200);
    const h = await pub("horarios", { query: { s: slug30 } });
    assert.equal(h.body.dias[QUI], undefined, "o dia inteiro some");
    assert.equal((await adm("config", { method: "POST", body: { semana: { "1": [["12:00", "09:00"]] }, intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30 } })).statusCode, 400);
    assert.equal((await adm("config", { method: "POST", body: { semana: { "4": [["09:00", "10:00"]] }, intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30 } })).statusCode, 200);
    const h2 = await pub("horarios", { query: { s: slug30 } });
    assert.deepEqual(Object.keys(h2.body.dias).map(d => new Date(d + "T12:00:00Z").getUTCDay()).filter((v, i, a) => a.indexOf(v) === i), [4], "agora só às quintas");
  });
});

test("API: assinatura do iPhone só com a chave; convite de quem marcou só com a assinatura dele", async () => {
  await comRelogio(AGORA, async () => {
    const { slug60 } = await preparar();
    const a = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "10:00" }, pessoa(1)) });
    const chave = (await adm("")).body.ics_chave;
    assert.equal((await pub("ics", { query: { k: "errada" } })).statusCode, 404);
    const ics = await pub("ics", { query: { k: chave } });
    assert.equal(ics.statusCode, 200);
    assert.ok(ics.cab["Content-Type"].startsWith("text/calendar"));
    assert.ok(ics.body.includes("Pessoa 1") && ics.body.includes("19999991001"));
    const { id, c } = a.body.convite;
    assert.equal((await pub("convite", { query: { id: String(id), c: "x" + c.slice(1) } })).statusCode, 404);
    assert.equal((await pub("convite", { query: { id: String(Number(id) + 1), c } })).statusCode, 404, "a assinatura de uma não abre a outra");
    const conv = await pub("convite", { query: { id: String(id), c } });
    assert.equal(conv.statusCode, 200);
    assert.ok(!conv.body.includes("1999999") && !conv.body.includes("Pessoa 1"), "o convite não leva dados da agenda");
    // trocar a chave derruba a antiga
    await adm("ics", { method: "POST" });
    assert.equal((await pub("ics", { query: { k: chave } })).statusCode, 404);
  });
});

test("index.html: guia Agenda só para o admin por enquanto, com a página e o módulo", () => {
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(HTML.includes('data-pg="agenda" data-perm="agenda"'));
  assert.ok(HTML.includes("navOk.agenda=isAdmin;"));
  assert.deepEqual(require("../api/_agenda").GESTORES, [], "a Gabriela ainda não: o menu e o servidor dizem o mesmo");
  assert.ok(HTML.includes('id="ag-content"'));
  assert.ok(HTML.includes('else if(p==="agenda"){if(typeof agLoad==="function")agLoad();}'));
  assert.ok(HTML.includes("/assets/agenda/agenda.js"));
  const PUB = fs.readFileSync(path.join(__dirname, "..", "agendar.html"), "utf8");
  assert.ok(PUB.includes('name="robots" content="noindex,nofollow"'));
  assert.ok(PUB.includes('/assets/agendar/agendar.js'));
});

test("API pública: o mesmo telefone (ou e-mail) não segura mais que 2 reuniões futuras pelo link", async () => {
  await comRelogio(AGORA, async () => {
    const { slug30 } = await preparar();
    const eu = { nome: "Ana", telefone: "(19) 98888-7777", email: "ana@exemplo.com" };
    assert.equal((await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "09:00" }, eu) })).statusCode, 201);
    assert.equal((await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "10:00" }, eu) })).statusCode, 201);
    const terceira = await pub("agendar", { method: "POST", body: Object.assign({ s: slug30, dia: QUI, hora: "11:00" }, eu, { telefone: "19911112222" }) });
    assert.equal(terceira.statusCode, 429, "trocar o telefone com o mesmo e-mail não escapa");
  });
});

// ── tela: calendário ────────────────────────────────────────────────────────
const vm = require("vm");
function telaAgenda(dados) {
  const pagina = { innerHTML: "", addEventListener() {}, __ag: false };
  const store = new Map([["userKey", "joaoygor"], ["logged", "1"]]);
  const ctx = {
    console, Promise, setTimeout, clearTimeout, Date, JSON, Map, Set, encodeURIComponent, location: { origin: "https://painel.exemplo" },
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    localStorage: { getItem: () => null, setItem() {} },
    document: { readyState: "complete", addEventListener() {}, querySelector: () => null, getElementById: id => (id === "ag-content" ? pagina : null) },
    fetch: async () => ({ ok: true, status: 200, json: async () => dados }),
    ST: { pg: "agenda" }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "agenda", "agenda.js"), "utf8"), ctx, { filename: "agenda.js" });
  return { ctx, pagina };
}
test("tela: semana como o iPhone (seg a sex), reunião no horário e na altura da duração, bloqueio e nome escapado", async () => {
  const real = Date.now;
  Date.now = () => AGORA;
  try {
    const dados = {
      config: R.CONFIG_PADRAO, ics_chave: "k",
      tipos: [{ id: 1, nome: "Captação", duracao_min: 30, cor: "#ea580c", slug: "abc", ativo: true }],
      bloqueios: [{ id: 9, inicio: new Date(R.paraUtc("2026-11-06", "12:00")).toISOString(), fim: new Date(R.paraUtc("2026-11-06", "14:00")).toISOString(), motivo: "Almoço" }],
      reunioes: [
        { id: 5, tipo_id: 1, tipo_nome: "Captação", inicio: new Date(R.paraUtc("2026-11-06", "10:00")).toISOString(), fim: new Date(R.paraUtc("2026-11-06", "11:00")).toISOString(), nome: "<b>Ana</b>", telefone: "19999998888", origem: "link", status: "ativa" },
        { id: 6, tipo_id: 1, tipo_nome: "Captação", inicio: new Date(R.paraUtc("2026-11-06", "15:00")).toISOString(), fim: new Date(R.paraUtc("2026-11-06", "15:30")).toISOString(), nome: "Cancelada", origem: "link", status: "cancelada" }
      ]
    };
    const { ctx, pagina } = telaAgenda(dados);
    ctx.agLoad();
    await new Promise(r => setTimeout(r, 15));
    const h = pagina.innerHTML;
    assert.ok(h.includes("2 a 8 de novembro"), "título da semana");
    assert.equal((h.match(/class="agc-col/g) || []).length, 5, "seg a sex (fim de semana sem atendimento fica fora)");
    assert.ok(h.includes('class="agc-cd hoje" data-ag="dia" data-dia="2026-11-05"'), "quinta (hoje) destacada");
    // grade das 8h às 18h (1h de folga): 10:00 fica 2h abaixo do topo = 112px; 1h de duração = 54px
    assert.ok(/data-id="5" style="top:112px;height:54px/.test(h), "bloco no horário e com a altura da duração");
    assert.ok(!h.includes("<b>Ana</b>") && h.includes("&lt;b&gt;Ana&lt;/b&gt;"), "nada do banco vira HTML");
    assert.ok(!h.includes('data-id="6"'), "cancelada não aparece no calendário");
    assert.ok(h.includes("⛔ Almoço"), "bloqueio na coluna");
    assert.ok(h.includes('class="agc-agora"'), "linha do agora no dia de hoje");
    // mês: bolinha na sexta 6 e clique no dia
    const el = pagina;
    ctx.agLoad();
    assert.ok(typeof ctx.agLoad === "function");
    assert.ok(h.includes('data-ag="vista" data-v="mes"'));
  } finally { Date.now = real; }
});

// ── diretores: calendário público do iCloud ─────────────────────────────────
const ICS_DIR = (inicio, fim, titulo) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:x1", "SUMMARY:" + (titulo || "Segredo do diretor"),
  "DTSTART;TZID=America/Sao_Paulo:" + inicio, "DTEND;TZID=America/Sao_Paulo:" + fim, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const LINK_DIR = "webcal://p12-caldav.icloud.com/published/2/AAAAsegredoDoLink123456";
const auditoriaTemLink = tabelas => JSON.stringify(tabelas.fm_auditoria || []).includes("AAAAsegredoDoLink123456");
// põe o iCloud de mentira na frente do Supabase falso; "estado" controla o que ele responde e conta as leituras
function icloudFalso(estado) {
  const antes = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes("icloud.com")) {
      estado.leituras = (estado.leituras || 0) + 1;
      if (estado.falha) throw new Error("rede caiu");
      return { ok: true, status: 200, url: String(url), text: async () => estado.ics };
    }
    return antes(url, init);
  };
  return () => { global.fetch = antes; };
}
async function comDiretor(est) {
  const base = await preparar();
  const solta = icloudFalso(est);
  const r = await adm("diretor", { method: "POST", body: { nome: "Paulo", url: LINK_DIR } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const dir = base.tabelas.ag_diretores[0];
  const tipo = base.tabelas.ag_tipos.find(t => t.slug === base.slug60);
  tipo.diretores = [dir.id]; // "Reunião com cliente" exige o Paulo; Captação não
  return Object.assign(base, { dir, tipo, solta });
}

test("diretor: cadastrar lê o calendário, guarda só os horários ocupados e nunca devolve o link inteiro", async () => {
  await comRelogio(AGORA, async () => {
    const base = await preparar();
    const solta = icloudFalso({ ics: ICS_DIR("20261112T100000", "20261112T113000") });
    try {
      const r = await adm("diretor", { method: "POST", body: { nome: "Paulo", url: LINK_DIR } });
      assert.equal(r.statusCode, 200);
      assert.equal(r.body.compromissos, 1);
      const d = base.tabelas.ag_diretores[0];
      assert.deepEqual(d.ocupado, [[R.paraUtc("2026-11-12", "10:00"), R.paraUtc("2026-11-12", "11:30")]]);
      assert.ok(!JSON.stringify(d.ocupado).includes("Segredo"), "título do compromisso não é guardado");
      assert.ok(d.url.startsWith("https://p12-caldav.icloud.com/"), "webcal vira https");
      const t = await adm("");
      const txt = JSON.stringify(t.body);
      assert.ok(!txt.includes("AAAAsegredoDoLink123456"), "o link inteiro nunca volta para a tela");
      assert.ok(!txt.includes("Segredo do diretor"));
      assert.equal(t.body.diretores[0].compromissos, 1);
      assert.equal(t.body.ocupados[0].nome, "Paulo");
      assert.equal(auditoriaTemLink(base.tabelas), false, "o link não vai para o registro de auditoria");
    } finally { solta(); }
  });
});

test("diretor: link que não é de calendário, endereço estranho e calendário ilegível são recusados", async () => {
  await comRelogio(AGORA, async () => {
    const { tabelas } = await preparar();
    const solta = icloudFalso({ ics: "isto não é um calendário" });
    try {
      for (const url of ["https://exemplo.com/cal.ics", "http://p12-caldav.icloud.com/x", "file:///etc/passwd", "", "https://169.254.169.254/latest"]) {
        const r = await adm("diretor", { method: "POST", body: { nome: "Paulo", url } });
        assert.equal(r.statusCode, 400, url);
        assert.equal(r.body.codigo, "LINK_INVALIDO");
      }
      const ilegivel = await adm("diretor", { method: "POST", body: { nome: "Paulo", url: LINK_DIR } });
      assert.equal(ilegivel.statusCode, 400);
      assert.equal(ilegivel.body.codigo, "LINK_ILEGIVEL");
      assert.equal((await adm("diretor", { method: "POST", body: { nome: "P", url: LINK_DIR } })).statusCode, 400, "nome curto");
      assert.equal((tabelas.ag_diretores || []).length, 0);
    } finally { solta(); }
  });
});

test("diretor: o tipo que exige o diretor some nos horários dele; o que não exige continua; e não dá para marcar nele", async () => {
  await comRelogio(AGORA, async () => {
    const { slug60, slug30, solta } = await comDiretor({ ics: ICS_DIR("20261112T100000", "20261112T113000") });
    try {
      const cliente = await pub("horarios", { query: { s: slug60 } });
      assert.equal(cliente.statusCode, 200);
      const h = cliente.body.dias[QUI];
      assert.ok(!h.includes("10:00") && !h.includes("10:30") && !h.includes("11:00"), "o diretor está ocupado das 10h às 11h30");
      assert.ok(!h.includes("09:30"), "uma reunião de 1h às 9h30 invadiria as 10h");
      assert.ok(h.includes("09:00") && h.includes("11:30"), "9h–10h e 11h30 encaixam");
      const captacao = await pub("horarios", { query: { s: slug30 } });
      assert.ok(captacao.body.dias[QUI].includes("10:00"), "Captação não exige o Paulo");
      const marca = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "10:30" }, pessoa(1)) });
      assert.equal(marca.statusCode, 409, "não marca em cima do diretor");
      const ok = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: QUI, hora: "11:30" }, pessoa(2)) });
      assert.equal(ok.statusCode, 201);
    } finally { solta(); }
  });
});

test("diretor: o calendário é relido no máximo a cada 5 minutos, e a mudança do diretor entra depois disso", async () => {
  const est = { ics: ICS_DIR("20261112T100000", "20261112T113000") };
  let slug60, solta;
  await comRelogio(AGORA, async () => { ({ slug60, solta } = await comDiretor(est)); });
  try {
    const leituras0 = est.leituras;
    await comRelogio(AGORA + 2 * 60000, async () => {
      await pub("horarios", { query: { s: slug60 } });
      await pub("horarios", { query: { s: slug60 } });
    });
    assert.equal(est.leituras, leituras0, "dentro de 5 minutos usa o que já leu");
    est.ics = ICS_DIR("20261112T140000", "20261112T150000"); // o diretor mudou a agenda
    await comRelogio(AGORA + 6 * 60000, async () => {
      const r = await pub("horarios", { query: { s: slug60 } });
      assert.equal(est.leituras, leituras0 + 1, "passou de 5 minutos: relê uma vez");
      assert.ok(r.body.dias[QUI].includes("10:00") && !r.body.dias[QUI].includes("14:00"), "10h liberou e 14h ocupou");
    });
  } finally { solta(); }
});

test("diretor: se o iCloud cair, usa a última leitura por até 6 horas; depois o tipo sai do ar em vez de arriscar", async () => {
  const est = { ics: ICS_DIR("20261112T100000", "20261112T113000") };
  let slug60, slug30, solta;
  await comRelogio(AGORA, async () => { ({ slug60, slug30, solta } = await comDiretor(est)); });
  try {
    est.falha = true;
    await comRelogio(AGORA + 3 * 3600000, async () => {
      const r = await pub("horarios", { query: { s: slug60 } });
      assert.equal(r.statusCode, 200, "3h depois ainda vale a última leitura");
      assert.ok(!r.body.dias[QUI].includes("10:00"));
    });
    await comRelogio(AGORA + 7 * 3600000, async () => {
      const r = await pub("horarios", { query: { s: slug60 } });
      assert.equal(r.statusCode, 503);
      assert.equal(r.body.codigo, "INDISPONIVEL");
      const m = await pub("agendar", { method: "POST", body: Object.assign({ s: slug60, dia: R.somaDias(R.hojeBR(AGORA + 7 * 3600000), 8), hora: "09:00" }, pessoa(1)) });
      assert.equal(m.statusCode, 503, "também não marca");
      assert.equal((await pub("horarios", { query: { s: slug30 } })).statusCode, 200, "o tipo sem diretor segue funcionando");
      const t = await adm("");
      assert.equal(t.body.diretores[0].valido, false);
      assert.ok(t.body.diretores[0].erro, "a administradora vê o motivo");
    });
  } finally { solta(); }
});

test("diretor: tirar o diretor tira a exigência dos tipos; o tipo guarda quais diretores exige; só o admin cadastra", async () => {
  await comRelogio(AGORA, async () => {
    const { tabelas, dir, tipo, solta } = await comDiretor({ ics: ICS_DIR("20261112T100000", "20261112T113000") });
    try {
      
      const salvo = await adm("tipo", { method: "POST", body: { id: tipo.id, nome: tipo.nome, duracao_min: 60, diretores: [dir.id, dir.id, "x", -3] } });
      assert.equal(salvo.statusCode, 200);
      assert.deepEqual(tabelas.ag_tipos.find(t => t.id === tipo.id).diretores, [dir.id], "só ids válidos e sem repetir");
      assert.equal((await adm("diretor", { method: "DELETE", query: { id: String(dir.id) } })).statusCode, 200);
      assert.equal(tabelas.ag_diretores.length, 0);
      assert.deepEqual(tabelas.ag_tipos.find(t => t.id === tipo.id).diretores, []);
      assert.equal((await adm("diretor", { method: "POST", body: { nome: "Paulo", url: LINK_DIR }, usuario: "carlos" })).statusCode, 403);
    } finally { solta(); }
  });
});

test("tela: horários do diretor aparecem em cinza no calendário e o botão avisa quando algum diretor está sem leitura", async () => {
  const real = Date.now;
  Date.now = () => AGORA;
  try {
    const dados = {
      config: R.CONFIG_PADRAO, ics_chave: "k", bloqueios: [], reunioes: [],
      tipos: [{ id: 1, nome: "Reunião com cliente", duracao_min: 60, cor: "#1e4d8c", slug: "abc", ativo: true, diretores: [7] }],
      diretores: [{ id: 7, nome: "Paulo <b>", ativo: true, valido: false, erro: "rede caiu", link: "icloud.com/…23456", compromissos: 0, lido_em: null }],
      ocupados: [{ dir: 7, nome: "Paulo <b>", inicio: new Date(R.paraUtc("2026-11-06", "10:00")).toISOString(), fim: new Date(R.paraUtc("2026-11-06", "11:30")).toISOString() }]
    };
    const { ctx, pagina } = telaAgenda(dados);
    ctx.agLoad();
    await new Promise(r => setTimeout(r, 15));
    const h = pagina.innerHTML;
    assert.ok(/class="agc-dir" style="top:112px;height:84px/.test(h), "bloco cinza das 10h às 11h30 (1,5h = 84px)");
    assert.ok(h.includes("👔 Paulo &lt;b&gt;") && !h.includes("Paulo <b>"), "nome do diretor escapado");
    assert.ok(/data-ag="diretores">👔 Diretores ⚠️/.test(h), "o botão avisa que há diretor sem leitura");
  } finally { Date.now = real; }
});

// ── e-mails e o cliente mexendo na própria reunião ──────────────────────────
const EMAILM = require("../api/_agenda_email");
const agendaMod = require("../api/_agenda");
const HOST = { host: "painel.exemplo" };
function correioFalso(falha) {
  const enviados = [];
  const antes = EMAILM.definirCorreio(async m => { if (falha) return { ok: false, motivo: falha }; enviados.push(m); return { ok: true }; });
  return { enviados, solta: () => EMAILM.definirCorreio(antes) };
}
const marcar = (slug, hora, p, extra) => pub("agendar", { method: "POST", headers: HOST, body: Object.assign({ s: slug, dia: QUI, hora }, p || pessoa(1), extra || {}) });
const aviso = enviados => enviados.find(m => /Reunião nova/.test(m.assunto));

test("e-mail: marcar pelo link manda a confirmação (com convite e link de remarcar) para a pessoa e o aviso para a Comercial", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { tabelas, slug60 } = await preparar();
      const r = await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com", obs: "quero saber de portaria" }));
      assert.equal(r.statusCode, 201, JSON.stringify(r.body));
      assert.equal(r.body.email_cliente, "enviado");
      assert.match(r.body.gerenciar, /^\d+\.[A-Za-z0-9_-]{32}$/);
      const cli = c.enviados.find(m => m.para === "ana@exemplo.com");
      assert.ok(cli, "confirmação para a pessoa");
      assert.match(cli.assunto, /^Reunião confirmada — Reunião com cliente · 12\/11 às 10:00$/);
      assert.ok(cli.html.includes("https://painel.exemplo/agendar.html?r=" + r.body.gerenciar), "link de remarcar/cancelar");
      assert.ok(cli.convite.includes("BEGIN:VCALENDAR") && cli.convite.includes("DTSTART:20261112T130000Z"), "convite anexo");
      assert.ok(!/1999999|portaria/.test(cli.html + cli.texto), "nada de telefone nem observação no e-mail da pessoa");
      const av = aviso(c.enviados);
      assert.equal(av.para, "comercial@exemplo.com", "aviso vai para a caixa do Comercial");
      assert.ok(av.html.includes("quero saber de portaria") && av.html.includes("Pessoa 1"), "o aviso leva os dados de contato");
      assert.equal(tabelas.ag_reunioes[0].email_status, "enviado");
    });
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("e-mail: sem e-mail da pessoa só avisa a Comercial; e se o e-mail falhar, a reunião vale do mesmo jeito", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const ok = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { tabelas, slug60, slug30 } = await preparar();
      const sem = await marcar(slug60, "09:00", pessoa(1, { email: "" }));
      assert.equal(sem.statusCode, 201);
      assert.equal(sem.body.email_cliente, "sem e-mail");
      assert.equal(ok.enviados.length, 1);
      assert.equal(ok.enviados[0].para, "comercial@exemplo.com");
      ok.solta();
      const quebrado = correioFalso("servidor de e-mail fora do ar");
      try {
        const r = await marcar(slug30, "14:00", pessoa(2, { email: "bia@exemplo.com" }));
        assert.equal(r.statusCode, 201, "a reunião não depende do e-mail");
        assert.match(r.body.email_cliente, /^falhou: servidor de e-mail fora do ar/);
        assert.match(tabelas.ag_reunioes.find(x => x.nome === "Pessoa 2").email_status, /^falhou/);
        const lista = await adm("");
        assert.match(lista.body.reunioes.find(x => x.nome === "Pessoa 2").email_status, /^falhou/, "a Comercial vê que o e-mail não saiu");
      } finally { quebrado.solta(); }
    });
  } finally { ok.solta(); delete process.env.MAIL_USER; }
});

test("e-mail: nome e dados de quem marcou entram escapados nos e-mails", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { slug30 } = await preparar();
      await marcar(slug30, "14:00", pessoa(1, { nome: "<script>alert(1)</script> Zé", email: "ze@exemplo.com", obs: "<img src=x onerror=alert(1)>" }));
      for (const m of c.enviados) assert.ok(!/<script>|<img src=x/.test(m.html), m.assunto);
    });
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("minha reunião: só abre com o código certo e nunca devolve telefone, e-mail ou observação", async () => {
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { slug60 } = await preparar();
      const r = await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com", obs: "segredo" }));
      const cod = r.body.gerenciar;
      const m = await pub("minha", { query: { r: cod } });
      assert.equal(m.statusCode, 200);
      assert.equal(m.body.nome, "Pessoa");
      assert.equal(m.body.pode_cancelar, true);
      assert.equal(m.body.pode_remarcar, true);
      assert.ok(!/1999999|ana@|segredo/.test(JSON.stringify(m.body)));
      const [id] = cod.split(".");
      for (const ruim of ["", "x", id + ".", id + ".0000000000000000000000000000000a", String(Number(id) + 1) + "." + cod.split(".")[1], "../" + cod]) {
        assert.equal((await pub("minha", { query: { r: ruim } })).statusCode, 404, ruim);
      }
    });
  } finally { c.solta(); }
});

test("minha reunião: cancelar libera o horário e avisa a Comercial; dentro de 2 horas não deixa", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    let cod, slug60, tabelas;
    await comRelogio(AGORA, async () => {
      ({ tabelas, slug60 } = await preparar());
      cod = (await marcar(slug60, "10:00")).body.gerenciar;
      c.enviados.length = 0;
      const r = await pub("cancelar-minha", { method: "POST", headers: HOST, body: { r: cod } });
      assert.equal(r.statusCode, 200);
      assert.equal(tabelas.ag_reunioes[0].status, "cancelada");
      assert.equal(tabelas.ag_reunioes[0].cancelado_por, "cliente");
      assert.match(c.enviados[0].assunto, /^Reunião cancelada pelo cliente/);
      assert.equal(c.enviados[0].para, "comercial@exemplo.com");
      assert.ok((await pub("horarios", { query: { s: slug60 } })).body.dias[QUI].includes("10:00"), "o horário voltou ao link");
      assert.equal((await pub("cancelar-minha", { method: "POST", body: { r: cod } })).body.ja, true, "cancelar de novo não faz nada");
      assert.equal((await pub("minha", { query: { r: cod } })).body.pode_cancelar, false);
    });
    let outra;
    await comRelogio(AGORA, async () => { outra = (await marcar(slug60, "13:00", pessoa(2))).body.gerenciar; });
    await comRelogio(Date.parse("2026-11-12T15:30:00Z"), async () => { // 12:30 de Brasília: falta 30 min para as 13h
      const r = await pub("cancelar-minha", { method: "POST", body: { r: outra } });
      assert.equal(r.statusCode, 409);
      assert.equal(r.body.codigo, "FORA_DO_PRAZO");
      assert.equal(tabelas.ag_reunioes.find(x => x.nome === "Pessoa 2").status, "ativa");
      assert.equal((await pub("remarcar-minha", { method: "POST", body: { r: outra, dia: QUI, hora: "16:00" } })).body.codigo, "FORA_DO_PRAZO");
    });
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("minha reunião: remarcar muda o horário (o dela próprio conta como livre), recusa horário ocupado e para na 3ª vez", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { tabelas, slug60 } = await preparar();
      const eu = await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com" }));
      await marcar(slug60, "14:00", pessoa(2));
      const cod = eu.body.gerenciar;
      // remarcando, o próprio horário (10:00) e o vizinho (10:30) aparecem livres; o das 14h da outra não
      const h = (await pub("horarios", { query: { s: slug60, r: cod } })).body.dias[QUI];
      assert.ok(h.includes("10:00") && h.includes("10:30"), "o horário dela não bloqueia a si mesma");
      assert.ok(!h.includes("14:00"));
      const sem = (await pub("horarios", { query: { s: slug60 } })).body.dias[QUI];
      assert.ok(!sem.includes("10:30"), "sem o código, 10:30 está ocupado pela própria reunião");
      assert.equal((await pub("remarcar-minha", { method: "POST", body: { r: cod, dia: QUI, hora: "14:00" } })).statusCode, 409, "em cima da outra");
      c.enviados.length = 0;
      const r1 = await pub("remarcar-minha", { method: "POST", headers: HOST, body: { r: cod, dia: QUI, hora: "10:30" } });
      assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
      const linha = tabelas.ag_reunioes.find(x => x.nome === "Pessoa 1");
      assert.equal(linha.inicio, "2026-11-12T13:30:00.000Z");
      assert.equal(linha.remarcacoes, 1);
      assert.ok(c.enviados.some(m => m.para === "ana@exemplo.com" && /Reunião remarcada/.test(m.assunto) && m.convite.includes("DTSTART:20261112T133000Z")), "a pessoa recebe o novo convite");
      assert.ok(c.enviados.some(m => /remarcada pelo cliente/.test(m.assunto)), "a Comercial é avisada");
      assert.equal((await pub("remarcar-minha", { method: "POST", body: { r: cod, dia: QUI, hora: "11:30" } })).statusCode, 200);
      const terceira = await pub("remarcar-minha", { method: "POST", body: { r: cod, dia: QUI, hora: "09:00" } });
      assert.equal(terceira.statusCode, 409);
      assert.equal(terceira.body.codigo, "LIMITE");
      assert.equal((await pub("minha", { query: { r: cod } })).body.pode_remarcar, false);
    });
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("e-mail pela Comercial: reunião à mão, remarcar e cancelar avisam a pessoa (se tiver e-mail e a Comercial deixar)", async () => {
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { tabelas, slug60 } = await preparar();
      const tipo = tabelas.ag_tipos.find(t => t.slug === slug60);
      const m = await adm("reuniao", { method: "POST", headers: HOST, body: { tipo_id: tipo.id, dia: QUI, hora: "10:00", nome: "Carla", email: "carla@exemplo.com" } });
      assert.equal(m.statusCode, 201);
      assert.equal(m.body.email_cliente, "enviado");
      assert.equal(c.enviados.length, 1, "à mão não avisa a própria Comercial");
      assert.equal(c.enviados[0].para, "carla@exemplo.com");
      const id = String(tabelas.ag_reunioes[0].id);
      c.enviados.length = 0;
      assert.equal((await adm("reuniao", { method: "PATCH", headers: HOST, query: { id }, body: { dia: QUI, hora: "15:00" } })).body.email_cliente, "enviado");
      assert.match(c.enviados[0].assunto, /^Reunião remarcada/);
      c.enviados.length = 0;
      const x = await adm("cancelar", { method: "POST", headers: HOST, query: { id }, body: {} });
      assert.equal(x.body.email_cliente, "enviado");
      assert.match(c.enviados[0].assunto, /^Reunião cancelada/);
      assert.ok(c.enviados[0].html.includes("https://painel.exemplo/agendar.html?s=" + slug60), "oferece marcar outro horário");
      c.enviados.length = 0;
      const sem = await adm("reuniao", { method: "POST", body: { tipo_id: tipo.id, dia: QUI, hora: "09:00", nome: "Davi", email: "davi@exemplo.com", avisar: false } });
      assert.equal(sem.body.email_cliente, null);
      assert.equal(c.enviados.length, 0, "a Comercial pode marcar sem enviar nada");
    });
  } finally { c.solta(); }
});

test("lembrete: o cron diário avisa quem tem reunião amanhã, uma vez só; falha não marca como enviado", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    let tabelas, slug60;
    await comRelogio(AGORA, async () => {
      ({ tabelas, slug60 } = await preparar());
      await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com" }));
      await marcar(slug60, "14:00", pessoa(2, { email: "" }));
      await marcar(slug60, "15:30", pessoa(3, { email: "caio@exemplo.com" }));
    });
    // quarta 11/11, 17h de Brasília: "amanhã" é quinta 12/11
    const roda = () => comRelogio(Date.parse("2026-11-11T20:00:00Z"), () => chamar(rh, { query: { modulo: "agenda", t: "cron" }, headers: HOST }));
    c.enviados.length = 0;
    const r = await roda();
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.amanha, QUI);
    assert.equal(r.body.reunioes, 3);
    assert.equal(r.body.enviados, 2, "quem não tem e-mail não recebe");
    assert.deepEqual(c.enviados.map(m => m.para).sort(), ["ana@exemplo.com", "caio@exemplo.com"]);
    assert.match(c.enviados[0].assunto, /^Lembrete: sua reunião é amanhã às 10:00/);
    assert.ok(c.enviados[0].html.includes("agendar.html?r="), "o lembrete leva o link de remarcar");
    assert.ok(tabelas.ag_reunioes.every(x => x.lembrete_em), "todas marcadas (a sem e-mail também, para não repetir)");
    c.enviados.length = 0;
    assert.equal((await roda()).body.reunioes, 0, "segunda rodada não repete");
    assert.equal(c.enviados.length, 0);
    // remarcada: volta a ser lembrada; e falha de envio não marca
    tabelas.ag_reunioes[0].lembrete_em = null;
    c.solta();
    const quebrado = correioFalso("fora do ar");
    try {
      const f = await roda();
      assert.equal(f.body.enviados, 0);
      assert.equal(f.body.falhas.length, 1);
      assert.equal(tabelas.ag_reunioes[0].lembrete_em, null, "tenta de novo na próxima rodada");
    } finally { quebrado.solta(); }
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("lembrete: com CRON_SECRET só dispara quem manda a chave; cancelada não é lembrada; reunião de hoje e de depois de amanhã não entram", async () => {
  process.env.CRON_SECRET = "chave-do-cron";
  const c = correioFalso();
  try {
    let tabelas, slug60;
    await comRelogio(AGORA, async () => {
      ({ tabelas, slug60 } = await preparar());
      const a = await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com" }));
      await pub("cancelar-minha", { method: "POST", body: { r: a.body.gerenciar } });
    });
    const cron = h => comRelogio(Date.parse("2026-11-11T20:00:00Z"), () => chamar(rh, { query: { modulo: "agenda", t: "cron" }, headers: h }));
    assert.equal((await cron({})).statusCode, 401);
    assert.equal((await cron({ authorization: "Bearer errada" })).statusCode, 401);
    const ok = await cron({ authorization: "Bearer chave-do-cron" });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.reunioes, 0, "a cancelada não entra");
    // hoje (quarta) e depois de amanhã (sexta) não são "amanhã"
    for (const [dia, hora, n] of [["2026-11-11", "15:00", 1], ["2026-11-13", "10:00", 2]]) {
      const tipo = tabelas.ag_tipos.find(t => t.slug === slug60);
      await comRelogio(AGORA, () => adm("reuniao", { method: "POST", body: { tipo_id: tipo.id, dia, hora, nome: "Pessoa " + n, email: "p" + n + "@exemplo.com", avisar: false } }));
    }
    assert.equal((await cron({ authorization: "Bearer chave-do-cron" })).body.reunioes, 0);
  } finally { c.solta(); delete process.env.CRON_SECRET; }
});

test("e-mail dos avisos: configurável (vazio = caixa do Comercial) e validado", async () => {
  process.env.MAIL_USER = "comercial@exemplo.com";
  const c = correioFalso();
  try {
    await comRelogio(AGORA, async () => {
      const { tabelas, slug60 } = await preparar();
      const cfg = Object.assign({}, R.CONFIG_PADRAO);
      assert.equal((await adm("config", { method: "POST", body: Object.assign({}, cfg, { email_aviso: "isso não é e-mail" }) })).statusCode, 400);
      assert.equal((await adm("config", { method: "POST", body: Object.assign({}, cfg, { email_aviso: "Gabriela@Exemplo.com" }) })).statusCode, 200);
      assert.equal(tabelas.ag_config[0].email_aviso, "gabriela@exemplo.com");
      assert.equal((await adm("")).body.config.email_aviso, "gabriela@exemplo.com");
      await marcar(slug60, "10:00", pessoa(1, { email: "" }));
      assert.equal(aviso(c.enviados).para, "gabriela@exemplo.com");
    });
  } finally { c.solta(); delete process.env.MAIL_USER; }
});

test("e-mail: a conta do Comercial não configurada não derruba nada, e o convite e o texto saem completos", async () => {
  delete process.env.MAIL_USER; delete process.env.MAIL_PASS;
  await comRelogio(AGORA, async () => {
    const { slug60 } = await preparar();
    const r = await marcar(slug60, "10:00", pessoa(1, { email: "ana@exemplo.com" }));
    assert.equal(r.statusCode, 201);
    assert.match(r.body.email_cliente, /^falhou: sem conta de e-mail configurada/);
  });
  const m = EMAILM.confirmacao({ id: 1, tipo: "Captação", nome: "Ana Silva", inicio: R.paraUtc(QUI, "10:00"), fim: R.paraUtc(QUI, "10:30"), duracao_min: 30, local: "Rua A, 10", gerenciar: "https://x.com/agendar.html?r=1.abc" });
  assert.ok(m.texto.includes("quinta-feira, 12 de novembro, às 10:00") && m.texto.includes("Rua A, 10") && m.texto.includes("https://x.com/agendar.html?r=1.abc"));
  assert.ok(m.html.includes("Olá, Ana!"));
});

test("vercel.json agenda o lembrete diário às 17h de Brasília (20h UTC) e o rh.js deixa o cron passar sem login", () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(v.crons.some(c => c.path === "/api/rh?modulo=agenda&t=cron" && c.schedule === "0 20 * * *"));
  assert.equal(typeof agendaMod.cron, "function");
});
