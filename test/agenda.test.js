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
const adm = (t, opts) => chamar(rh, Object.assign({ usuario: "gabrielaalvarenga" }, opts, { query: Object.assign({ modulo: "agenda" }, t ? { t } : {}, (opts && opts.query) || {}) }));
const pessoa = (n, extra) => Object.assign({ nome: "Pessoa " + n, telefone: "1999999" + String(1000 + n).slice(-4), email: "p" + n + "@exemplo.com" }, extra || {});
async function preparar() {
  const tabelas = { app_users: [{ user_key: "carlos", ativo: true, perms: {} }, { user_key: "liberada", nome: "Liberada", ativo: true, perms: { guias: { agenda: true } } }] };
  supabaseFalso(tabelas);
  const r = await adm(""); // a primeira abertura cria a configuração e os tipos iniciais
  assert.equal(r.statusCode, 200);
  return { tabelas, slug60: tabelas.ag_tipos.find(t => t.duracao_min === 60).slug, slug30: tabelas.ag_tipos.find(t => t.duracao_min === 30).slug };
}

test("API: só a administradora (e admin, e quem recebeu a guia) mexe na agenda", async () => {
  await comRelogio(AGORA, async () => {
    await preparar();
    assert.equal((await adm("", { usuario: "carlos" })).statusCode, 403);
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

test("index.html: guia Agenda só para a administradora e o admin, com a página e o módulo", () => {
  const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(HTML.includes('data-pg="agenda" data-perm="agenda"'));
  assert.ok(HTML.includes('navOk.agenda=isAdmin||sessionStorage.getItem("userKey")==="gabrielaalvarenga";'));
  assert.deepEqual(require("../api/_agenda").GESTORES, ["gabrielaalvarenga"], "a mesma lista do servidor");
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
