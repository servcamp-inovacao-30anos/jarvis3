// Guia Celulares: regras (api/_celulares_regras.js) e API (api/_celulares.js, via /api/rh?modulo=celulares)
// contra um Supabase falso em memória. O que mais importa aqui: senha nunca sai para quem não tem a guia,
// e o supervisor recebe só cliente, número e login Zello.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const _auth = require("../api/_auth");
const R = require("../api/_celulares_regras");
const cel = require("../api/_celulares");
const rh = require("../api/rh");
const { supabaseFalso, chamar } = require("./_supabase_falso");

const CAB = ["MODELO", "CLIENTES", "IMEI 1", "IMEI 2", "NUMERO", "E-MAIL", "SENHA GMAIL", "LOGIN - ZELLO", "SENHA ZELLO", "Bloqueio: AppLock"];
const aparelho = (id, extra) => Object.assign({
  id, modelo: "MOTO G14", cliente: "POSTO " + id, cliente_vinculado: null, tipo: "POSTO", situacao: "ATIVO",
  imei1: null, imei2: null, numero: "(19) 9" + String(8000000 + id * 1111).padStart(8, "0"), email: "teste" + id + "@exemplo.com",
  senha_gmail: "gm-" + id, login_zello: "teste" + id, senha_zello: "ze-" + id, applock: "1234" + id, obs: null
}, extra || {});
// IMEIs válidos (Luhn) e diferentes entre si
const IMEI_A = "490154203237518", IMEI_B = "490154203237526", IMEI_C = "352099001761481", IMEI_D = "352099001761499";
const usuarios = () => [
  { user_key: "joaoygor", ativo: true },
  { user_key: "carlos", ativo: true, perms: {} },
  { user_key: "liberada", ativo: true, perms: { guias: { celulares: true } } },
  { user_key: "bloqueada", ativo: false, perms: { guias: { celulares: true } } },
  { user_key: "novoadmin", nome: "Novo Admin", ativo: true, perms: { admin: true } },
  { user_key: "fixocomadmin", ativo: true, perms: { admin: true } } // perms.admin só vale para quem foi criado pela tela
];
const segredoNoTexto = obj => /gm-\d|ze-\d|senha_gmail|senha_zello|applock/.test(JSON.stringify(obj));

// ── regras ──────────────────────────────────────────────────────────────────

test("lerPlanilha reconhece o cabeçalho da planilha CELULARES em qualquer ordem e com variações", () => {
  const r = R.lerPlanilha([
    ["Controle de celulares"],
    ["E-mail", "Login Zello", "Cliente", "Modelo", "Número", "IMEI", "Senha do Gmail", "senha zello", "APPLOCK", "Coluna estranha"],
    ["a@exemplo.com", "teste1", "  ACDC   CAMPINAS ", "MOTOE7", "(19) 91234-6713", IMEI_A + "/26", "  s3nha com espaço  ", "z", "1234", "?"],
    ["", "", "", "", "", "", "", "", "", ""],
    ["", "", "SUP - FRANK", "MOTO G30", "", "", "", "", "", ""]
  ]);
  assert.equal(r.erro, undefined);
  assert.equal(r.linhaCabecalho, 2);
  assert.equal(r.vazias, 1);
  assert.deepEqual(r.naoReconhecidas, ["Coluna estranha"]);
  assert.equal(r.aparelhos.length, 2);
  const [a, b] = r.aparelhos;
  assert.equal(a.cliente, "ACDC CAMPINAS", "espaço sobrando sai");
  assert.equal(a.senha_gmail, "s3nha com espaço", "senha só perde as pontas");
  assert.equal(a.imei1, IMEI_A + "/26");
  assert.equal(a.tipo, "POSTO");
  assert.equal(a.situacao, "ATIVO");
  assert.equal(b.tipo, "INTERNO", "aparelho de supervisor é de uso interno");
  assert.equal(b.numero, null);
});

test("lerPlanilha recusa planilha sem cabeçalho reconhecível", () => {
  assert.ok(R.lerPlanilha([["a", "b"], ["c", "d"]]).erro);
  assert.ok(R.lerPlanilha([]).erro);
  assert.ok(R.lerPlanilha("nada").erro);
});

test("tipo sugerido: supervisor, mesa, RH, gerente e afins são de uso interno; posto de cliente não", () => {
  for (const n of ["SUP - ADRIANO FIALHO", "SUP -", "MESA OPERACIONAL", "RH SIRLEY", "AMAURI GERENTE", "FINANCEIRO - SERVCAMP", "MARCELLY (BASE)", "EDUARDO - DIRETOR DEPARTAMENTO PESSOAL"]) {
    assert.equal(R.tipoSugerido(n), "INTERNO", n);
  }
  for (const n of ["REVIVA ADM", "VILLA FLORA ADMINISTRATIVO", "SÃO GABRIEL SINDICA", "THE MALL - RECEPÇÃO", "SUPERMERCADO CENTRAL"]) {
    assert.equal(R.tipoSugerido(n), "POSTO", n);
  }
});

test("número: com DDD, sem DDD, +55 e formatação", () => {
  assert.equal(R.formatarNumero("19912346713"), "(19) 91234-6713");
  assert.equal(R.formatarNumero("+55 (19) 91234-6713"), "(19) 91234-6713");
  assert.equal(R.formatarNumero("(19) 9740-14489"), "(19) 97401-4489");
  assert.equal(R.formatarNumero("(19) 3254-1234"), "(19) 3254-1234");
  assert.equal(R.formatarNumero("91234 6417"), "91234-6417");
  assert.ok(R.analisarNumero("933330224").semDDD);
  assert.ok(R.analisarNumero("123").invalido);
  assert.equal(R.comDDD("91234 6417", "19"), "(19) 91234-6417");
});

test("IMEI: Luhn, versão do software depois da barra e tamanhos aceitos", () => {
  assert.ok(R.luhn(IMEI_A));
  assert.ok(R.analisarImei(IMEI_A + "/12").ok);
  assert.ok(R.analisarImei("86000000000001").ok, "14 dígitos: sem o verificador");
  assert.ok(R.analisarImei("490154203237519").digito, "último dígito não confere");
  assert.ok(R.analisarImei("38").invalido);
});

test("pendências: o que falta, o que conferir, X = não se aplica, e baixado não cobra nada", () => {
  const lista = [
    aparelho(1, { applock: null, numero: "933330224", imei1: IMEI_A, imei2: IMEI_B }),
    aparelho(2, { login_zello: "X", senha_zello: "x", applock: "xxxxxx", imei1: IMEI_C, imei2: IMEI_D }),
    aparelho(3, { situacao: "BAIXADO", numero: null, email: null, imei1: IMEI_A }),
    aparelho(4, { situacao: "RESERVA", cliente: null, numero: null, email: null, senha_gmail: null, login_zello: null, senha_zello: null, applock: null, imei1: null }),
    aparelho(5, { cliente: "IGREJA VIVA - CELULAR SUMIU", email: "5", imei1: "38", imei2: null })
  ];
  const P = R.pendencias(lista);
  const msgs = id => P[id].map(p => p.tipo + ":" + p.msg);
  assert.ok(msgs(1).includes("falta:Sem código do AppLock"));
  assert.ok(msgs(1).includes("conferir:Número sem DDD"));
  assert.ok(!msgs(1).some(m => /Mesmo IMEI/.test(m)), "o IMEI repetido é de um aparelho baixado: não conta");
  assert.deepEqual(P[2], [], "X em login, senha e AppLock = não se aplica");
  assert.deepEqual(P[3], [], "baixado não cobra nada");
  assert.deepEqual(msgs(4), ["falta:Sem IMEI 1"], "reserva só precisa ser identificável");
  assert.ok(msgs(5).includes("falta:Sem IMEI 2"));
  assert.ok(msgs(5).includes("conferir:IMEI 1 inválido (o IMEI tem 15 dígitos)"));
  assert.ok(msgs(5).includes("conferir:E-mail inválido"));
  assert.ok(msgs(5).some(m => /O nome diz "sumiu"/.test(m)));
});

test("pendências: o mesmo aparelho em duas linhas vira um aviso só, com o nome da outra", () => {
  const P = R.pendencias([
    aparelho(1, { cliente: "AGUAS CLARAS ZELADOR", imei1: IMEI_A + "/01", imei2: IMEI_B + "/01", numero: "(19) 91234-6713", login_zello: "teste224" }),
    aparelho(2, { cliente: "CAMBUI - SQUARE", imei1: IMEI_A, imei2: IMEI_B, numero: "91234-6713", login_zello: "TESTE224" }),
    aparelho(3, { cliente: "ALDEIA DA MATA", imei1: "860000000000017", imei2: "86000000000001" })
  ]);
  const de1 = P[1].map(p => p.msg);
  assert.deepEqual(de1.filter(m => /IMEI/.test(m)), ["Mesmo IMEI em: CAMBUI - SQUARE"]);
  assert.ok(de1.includes("Número repetido em: CAMBUI - SQUARE"), "com e sem DDD é o mesmo número");
  assert.ok(de1.includes("Login Zello repetido em: CAMBUI - SQUARE"), "login não diferencia maiúscula");
  assert.ok(P[3].some(p => p.msg === "IMEI 2 igual ao IMEI 1"));
});

test("validar: limpa, confere tipo/situação e exige algo que identifique o aparelho", () => {
  assert.ok(R.validar({}, false).erro);
  assert.ok(R.validar({ cliente: "A", tipo: "OUTRO" }, false).erro);
  assert.ok(R.validar({ cliente: "A", situacao: "SUMIDO" }, false).erro);
  assert.ok(R.validar({ cliente: { x: 1 } }, false).erro);
  assert.ok(R.validar({ naoexiste: 1 }, true).erro, "PATCH sem campo conhecido");
  const v = R.validar({ cliente: "  POSTO   NOVO ", tipo: "interno", numero: "", campo_intruso: "x" }, false);
  assert.deepEqual(v.campos, { cliente: "POSTO NOVO", tipo: "INTERNO", numero: null, situacao: "ATIVO" });
});

test("impressão do aparelho ignora as senhas (trocar a senha não faz virar outro aparelho)", () => {
  assert.equal(R.impressao(aparelho(1)), R.impressao(Object.assign(aparelho(1), { senha_gmail: "outra", applock: "9" })));
  assert.notEqual(R.impressao(aparelho(1)), R.impressao(aparelho(2)));
});

// ── API ─────────────────────────────────────────────────────────────────────

const base = () => ({
  app_users: usuarios(),
  cel_aparelhos: [
    aparelho(1, { imei1: IMEI_A, imei2: IMEI_B, applock: null }),
    aparelho(2, { tipo: "INTERNO", cliente: "SUP - FRANK" }),
    aparelho(3, { situacao: "BAIXADO" }),
    aparelho(4, { login_zello: "X", numero: "X" })
  ],
  fm_auditoria: []
});
const pedir = (opts) => chamar(cel, opts);

test("supervisor: os contatos saem só com cliente, número e login Zello, só dos ativos de posto", async () => {
  const tabelas = base();
  supabaseFalso(tabelas);
  _auth.esquecerBloqueio();
  const r = await chamar(rh, { query: { modulo: "celulares", t: "contatos" }, usuario: "carlos" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.contatos.map(c => c.id), [1, 4], "nem o interno nem o baixado");
  for (const c of r.body.contatos) assert.deepEqual(Object.keys(c).sort(), ["cliente", "cliente_vinculado", "id", "login_zello", "numero"]);
  assert.equal(r.body.contatos[1].numero, "", "X não é número");
  assert.equal(r.body.contatos[1].login_zello, "");
  assert.ok(!segredoNoTexto(r.body));
});

test("sem token não passa nem nos contatos (o rh.js barra antes)", async () => {
  supabaseFalso(base());
  const r = await chamar(rh, { query: { modulo: "celulares", t: "contatos" } });
  assert.equal(r.statusCode, 401);
});

test("quem não tem a guia não lista, não vê senha, não exporta, não grava", async t => {
  const tabelas = base();
  supabaseFalso(tabelas);
  const casos = [
    { query: {} }, { query: { t: "senhas", id: "1" } }, { query: { t: "exportar" } },
    { method: "POST", query: {}, body: { cliente: "X" } }, { method: "PATCH", query: { id: "1" }, body: { cliente: "Y" } },
    { method: "DELETE", query: { id: "1" } }, { method: "POST", query: { t: "importar" }, body: { linhas: [CAB], confirmar: true } },
    { method: "POST", query: { t: "ddd" }, body: { ddd: "19", confirmar: true } }
  ];
  for (const quem of ["carlos", "fixocomadmin", "bloqueada", null]) {
    await t.test(String(quem), async () => {
      for (const c of casos) {
        const r = await pedir(Object.assign({ usuario: quem || undefined }, c));
        assert.equal(r.statusCode, 403, JSON.stringify(c));
        assert.ok(!segredoNoTexto(r.body));
      }
    });
  }
  assert.equal(tabelas.cel_aparelhos.length, 4, "nada gravado");
  assert.equal(tabelas.cel_aparelhos[0].cliente, "POSTO 1");
  assert.equal(tabelas.fm_auditoria.length, 0);
});

test("sem AUTH_SECRET (modo de emergência) só os contatos saem", async () => {
  supabaseFalso(base());
  const antes = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    assert.equal((await pedir({ query: { t: "contatos" } })).statusCode, 200);
    assert.equal((await pedir({ query: {} })).statusCode, 403);
    assert.equal((await pedir({ query: { t: "senhas", id: "1" } })).statusCode, 403);
  } finally { process.env.AUTH_SECRET = antes; }
});

test("AUTH_ENFORCE=0 (emergência): nem a chave do Excel nem o token do administrador abrem as senhas", async () => {
  supabaseFalso(base());
  process.env.AUTH_ENFORCE = "0";
  try {
    const chaveXl = _auth.sign("joaoygor", process.env.AUTH_SECRET, 90 * 24, { s: "xl" });
    for (const t of ["", "exportar"]) {
      const r = await chamar(rh, { query: { modulo: "celulares", t }, token: chaveXl });
      assert.equal(r.statusCode, 403, "chave do Excel em t=" + t);
      assert.ok(!segredoNoTexto(r.body));
    }
    assert.equal((await pedir({ query: { t: "senhas", id: "1" }, usuario: "joaoygor" })).statusCode, 403);
    assert.equal((await pedir({ query: { t: "contatos" } })).statusCode, 200, "os contatos continuam saindo");
  } finally { delete process.env.AUTH_ENFORCE; }
});

test("a chave do Excel não passa nem com a exigência ligada", async () => {
  supabaseFalso(base());
  const chaveXl = _auth.sign("joaoygor", process.env.AUTH_SECRET, 24, { s: "xl" });
  assert.equal((await chamar(rh, { query: { modulo: "celulares", t: "exportar" }, token: chaveXl })).statusCode, 401);
});

test("administrador lista com as pendências e SEM as senhas (só quais estão preenchidas)", async () => {
  supabaseFalso(base());
  const r = await pedir({ query: {}, usuario: "joaoygor" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.aparelhos.length, 4);
  assert.ok(!segredoNoTexto(r.body.aparelhos.map(a => { const o = Object.assign({}, a); delete o.com; delete o.pend; return o; })));
  const a1 = r.body.aparelhos.find(a => a.id === 1);
  assert.deepEqual(a1.com, ["senha_gmail", "senha_zello"]);
  assert.ok(a1.pend.some(p => p.msg === "Sem código do AppLock"));
  for (const a of r.body.aparelhos) for (const s of R.SEGREDOS) assert.ok(!(s in a), s);
});

test("guia liberada em 👁️ Guias e administrador criado pela tela também entram", async () => {
  supabaseFalso(base());
  for (const quem of ["liberada", "novoadmin"]) {
    const r = await pedir({ query: {}, usuario: quem });
    assert.equal(r.statusCode, 200, quem);
  }
});

test("senhas de um aparelho: só com registro na auditoria, e só daquele aparelho", async () => {
  const tabelas = base();
  supabaseFalso(tabelas);
  const r = await pedir({ query: { t: "senhas", id: "2" }, usuario: "liberada" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { id: 2, senha_gmail: "gm-2", senha_zello: "ze-2", applock: "12342" });
  assert.equal(tabelas.fm_auditoria.length, 1);
  const reg = tabelas.fm_auditoria[0];
  assert.equal(reg.acao, "CEL_SENHAS_VISTAS");
  assert.equal(reg.ator, "liberada");
  assert.equal(reg.chave, "2");
  assert.ok(!segredoNoTexto(reg));
  assert.equal((await pedir({ query: { t: "senhas", id: "99" }, usuario: "joaoygor" })).statusCode, 404);
  assert.equal((await pedir({ query: { t: "senhas", id: "1 or 1=1" }, usuario: "joaoygor" })).statusCode, 400);
});

test("se a auditoria falhar, a senha não sai", async () => {
  supabaseFalso(base(), { falhar: (m, tabela) => m === "POST" && tabela === "fm_auditoria" });
  const r = await pedir({ query: { t: "senhas", id: "1" }, usuario: "joaoygor" });
  assert.equal(r.statusCode, 500);
  assert.ok(!segredoNoTexto(r.body));
});

test("exportar leva tudo com as senhas e fica registrado", async () => {
  const tabelas = base();
  supabaseFalso(tabelas);
  const r = await pedir({ query: { t: "exportar" }, usuario: "joaoygor" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.aparelhos.length, 4);
  assert.equal(r.body.aparelhos[0].senha_gmail, "gm-1");
  assert.equal(r.body.colunas[0][1], "MODELO");
  assert.equal(tabelas.fm_auditoria[0].acao, "CEL_EXPORTADO");
});

test("cadastrar, alterar e apagar: quem fez fica gravado, e o registro não guarda senha", async () => {
  const tabelas = base();
  supabaseFalso(tabelas);
  const c = await pedir({ method: "POST", query: {}, usuario: "joaoygor", body: { cliente: "POSTO NOVO", numero: "19 98888-7777", senha_zello: "segredo-novo" } });
  assert.equal(c.statusCode, 201);
  const novo = tabelas.cel_aparelhos.find(a => a.id === c.body.id);
  assert.equal(novo.cliente, "POSTO NOVO");
  assert.equal(novo.tipo, "POSTO");
  assert.equal(novo.situacao, "ATIVO");
  assert.equal(novo.criado_por, "joaoygor");
  assert.ok(!JSON.stringify(tabelas.fm_auditoria).includes("segredo-novo"));

  const a = await pedir({ method: "PATCH", query: { id: "1" }, usuario: "joaoygor", body: { situacao: "BAIXADO", senha_gmail: "trocada", modelo: "MOTO G14" } });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.body.mudou.sort(), ["senha_gmail", "situacao"], "o modelo não mudou");
  const um = tabelas.cel_aparelhos.find(x => x.id === 1);
  assert.equal(um.situacao, "BAIXADO");
  assert.equal(um.senha_gmail, "trocada");
  assert.equal(um.atualizado_por, "joaoygor");
  const reg = tabelas.fm_auditoria.find(x => x.acao === "CEL_ALTERADO");
  assert.deepEqual(reg.antes, { senha_gmail: "(preenchida)", situacao: "ATIVO" });
  assert.deepEqual(reg.depois, { senha_gmail: "(preenchida)", situacao: "BAIXADO" });
  assert.ok(!JSON.stringify(tabelas.fm_auditoria).includes("trocada"));

  assert.equal((await pedir({ method: "PATCH", query: { id: "1" }, usuario: "joaoygor", body: { situacao: "SUMIU" } })).statusCode, 400);
  assert.equal((await pedir({ method: "PATCH", query: { id: "77" }, usuario: "joaoygor", body: { cliente: "Z" } })).statusCode, 404);

  const d = await pedir({ method: "DELETE", query: { id: "4" }, usuario: "joaoygor" });
  assert.equal(d.statusCode, 200);
  assert.ok(!tabelas.cel_aparelhos.some(x => x.id === 4));
  const ap = tabelas.fm_auditoria.find(x => x.acao === "CEL_APAGADO");
  assert.equal(ap.antes.cliente, "POSTO 4");
  assert.ok(!("senha_gmail" in ap.antes));
});

test("importar: a prévia não grava; confirmar grava; importar de novo não duplica", async () => {
  const tabelas = { app_users: usuarios(), cel_aparelhos: [], fm_auditoria: [] };
  supabaseFalso(tabelas);
  const linhas = [CAB,
    ["MOTOE7", "ACDC CAMPINAS", IMEI_A + "/26", IMEI_B + "/26", "(19) 91234-6713", "teste107@exemplo.com", "senha-teste-1", "teste107", "senha-teste-1", "202130"],
    ["MOTO G30", "SUP - FRANK", IMEI_C, IMEI_D, "91234 6417", "teste97@exemplo.com", "senha-teste-1", "teste97", "senha-teste-1", ""],
    ["", "", "", "", "", "", "", "", "", ""]];
  const p = await pedir({ method: "POST", query: { t: "importar" }, usuario: "joaoygor", body: { linhas } });
  assert.equal(p.statusCode, 200);
  assert.equal(p.body.previa.novos, 2);
  assert.equal(p.body.previa.vazias, 1);
  assert.equal(p.body.previa.internos, 1);
  assert.equal(tabelas.cel_aparelhos.length, 0, "prévia não grava");

  const c = await pedir({ method: "POST", query: { t: "importar" }, usuario: "joaoygor", body: { linhas, confirmar: true } });
  assert.equal(c.body.inseridos, 2);
  assert.equal(tabelas.cel_aparelhos.length, 2);
  assert.equal(tabelas.cel_aparelhos[0].senha_gmail, "senha-teste-1");
  assert.equal(tabelas.cel_aparelhos[1].tipo, "INTERNO");
  assert.equal(tabelas.cel_aparelhos[0].criado_por, "joaoygor");
  assert.ok(!JSON.stringify(tabelas.fm_auditoria).includes("senha-teste-1"));

  const de_novo = await pedir({ method: "POST", query: { t: "importar" }, usuario: "joaoygor", body: { linhas, confirmar: true } });
  assert.equal(de_novo.body.inseridos, 0);
  assert.equal(de_novo.body.previa.iguais, 2);
  assert.equal(tabelas.cel_aparelhos.length, 2);

  const ruim = await pedir({ method: "POST", query: { t: "importar" }, usuario: "joaoygor", body: { linhas: [["a", "b"]] } });
  assert.equal(ruim.statusCode, 400);
});

test("DDD: prévia conta, confirmar completa só quem está sem (e não mexe no baixado)", async () => {
  const tabelas = base();
  tabelas.cel_aparelhos.push(aparelho(5, { numero: "91234 6417" }), aparelho(6, { numero: "933330224", situacao: "BAIXADO" }), aparelho(7, { numero: "944443981", situacao: "RESERVA" }));
  supabaseFalso(tabelas);
  const p = await pedir({ method: "POST", query: { t: "ddd" }, usuario: "joaoygor", body: { ddd: "19" } });
  assert.equal(p.body.previa.quantos, 2);
  assert.equal(tabelas.cel_aparelhos.find(a => a.id === 5).numero, "91234 6417", "prévia não grava");
  const c = await pedir({ method: "POST", query: { t: "ddd" }, usuario: "joaoygor", body: { ddd: "19", confirmar: true } });
  assert.equal(c.body.alterados, 2);
  assert.equal(tabelas.cel_aparelhos.find(a => a.id === 5).numero, "(19) 91234-6417");
  assert.equal(tabelas.cel_aparelhos.find(a => a.id === 7).numero, "(19) 94444-3981");
  assert.equal(tabelas.cel_aparelhos.find(a => a.id === 6).numero, "933330224");
  assert.equal(tabelas.cel_aparelhos.find(a => a.id === 1).numero, aparelho(1).numero);
  assert.equal((await pedir({ method: "POST", query: { t: "ddd" }, usuario: "joaoygor", body: { ddd: "1" } })).statusCode, 400);
});

test("tabela ainda não criada: a tela recebe um aviso claro", async () => {
  supabaseFalso({ app_users: usuarios() });
  const real = global.fetch;
  global.fetch = async (url, init) => String(url).includes("/cel_aparelhos")
    ? { ok: false, status: 404, json: async () => ({}), text: async () => '{"code":"PGRST205","message":"Could not find the table \'public.cel_aparelhos\' in the schema cache"}' }
    : real(url, init);
  const r = await pedir({ query: {}, usuario: "joaoygor" });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.codigo, "SEM_TABELA");
});

test("rota desconhecida", async () => {
  supabaseFalso(base());
  const r = await pedir({ method: "PUT", query: {}, usuario: "joaoygor" });
  assert.equal(r.statusCode, 404);
});

test("os administradores da guia são os mesmos do login", () => {
  assert.deepEqual(require("../api/users").ADMINS, ["joaoygor"]);
});
