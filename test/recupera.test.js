// Testes do "Esqueci minha senha" (api/users.js, ações recovery_* e set_recovery; regras em api/_recupera.js).
// Supabase falso em memória e envio trocado por definirEnvio: nada sai da máquina.

const test = require("node:test");
const assert = require("node:assert/strict");
const _auth = require("../api/_auth");
const _senha = require("../api/_senha");
const _rec = require("../api/_recupera");
const handler = require("../api/users");
const { SupabaseFalso } = require("./supabase_falso");

const BASE = "https://falso.supabase.co";
const SEGREDO = "segredo-so-de-teste";
const fetchReal = global.fetch;
let sb, enviados, falhaEnvio;

async function chamar(method, { query = {}, body, token } = {}) {
  const req = { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} };
  let status = 200, dados;
  const res = { status(s) { status = s; return this; }, json(d) { dados = d; return this; }, setHeader() {} };
  await handler(req, res);
  return { status, dados };
}
const post = (body, token) => chamar("POST", { body, token });
const tk = u => _auth.sign(u, SEGREDO, 1);
const opcoes = userKey => post({ action: "recovery_options", userKey });
const enviar = (userKey, canal) => post({ action: "recovery_send", userKey, canal });
const redefinir = (userKey, codigo, newPassword) => post({ action: "recovery_reset", userKey, codigo, newPassword });
const entrar = (userKey, password) => post({ action: "authenticate", userKey, password });
const ultimoCodigo = () => enviados[enviados.length - 1].codigo;

test.beforeEach(async () => {
  sb = new SupabaseFalso(BASE);
  global.fetch = sb.fetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
  process.env.AUTH_SECRET = SEGREDO;
  process.env.DEFAULT_PASSWORD_HASH = await _senha.hash("padrao-de-teste-2026");
  delete process.env.AUTH_ENFORCE;
  enviados = []; falhaEnvio = null;
  _rec.definirEnvio(async m => { if (falhaEnvio) return { ok: false, erro: falhaEnvio }; enviados.push(m); return { ok: true }; });
});
test.after(() => { global.fetch = fetchReal; _rec.definirEnvio(null); });

async function comContato(userKey, extra) {
  sb.semear(userKey, { custom_password: await _senha.hash("senha-esquecida"), must_change: false,
    rec_email: "pessoa.teste@exemplo.com.br", rec_celular: "+5519991234567", ...extra });
}

test("regras: máscara, celular e e-mail", () => {
  assert.equal(_rec.mascararEmail("pessoa.teste@exemplo.com.br"), "pe•••••@exemplo.com.br");
  assert.equal(_rec.mascararCelular("+5519991234567"), "(19) •••••-4567");
  assert.equal(_rec.celularFormatado("+5519991234567"), "(19) 99123-4567");
  assert.deepEqual(_rec.lerCelular("(19) 99123-4567"), { ok: true, valor: "+5519991234567" });
  assert.deepEqual(_rec.lerCelular("19 9123-4567"), { ok: true, valor: "+5519991234567" }, "sem o 9 é corrigido");
  assert.equal(_rec.lerCelular("(19) 3212-3456").ok, false, "fixo não recebe SMS");
  assert.equal(_rec.lerEmail("sem-arroba").ok, false);
  assert.deepEqual(_rec.lerEmail(" Pessoa@Exemplo.com "), { ok: true, valor: "pessoa@exemplo.com" });
  assert.deepEqual(_rec.lerEmail(""), { ok: true, valor: null });
  assert.match(_rec.gerarCodigo(), /^\d{6}$/);
});

test("opções: só mascarado, e nada para quem não tem contato ou não existe", async () => {
  await comContato("adrianomacedo");
  let r = await opcoes("adrianomacedo");
  assert.deepEqual(r.dados, { ok: true, email: "pe•••••@exemplo.com.br", celular: "(19) •••••-4567" });
  assert.ok(!JSON.stringify(r.dados).includes("991234567"), "o número inteiro não sai");
  r = await opcoes("frankpimentel");
  assert.deepEqual(r.dados, { ok: true, email: null, celular: null });
  sb.semear("inventado", { rec_email: "x@exemplo.com" }); // linha sem nome: não é usuário
  r = await opcoes("inventado");
  assert.deepEqual(r.dados, { ok: true, email: null, celular: null });
});

test("envio: vai só para o contato cadastrado, e o banco guarda só o HMAC", async () => {
  await comContato("adrianomacedo");
  let r = await enviar("adrianomacedo", "sms");
  assert.equal(r.status, 200);
  assert.equal(r.dados.destino, "(19) •••••-4567");
  assert.equal(enviados[0].canal, "sms");
  assert.equal(enviados[0].destino, "+5519991234567");
  const linha = sb.linhas.get("adrianomacedo");
  assert.notEqual(linha.rec_codigo, ultimoCodigo());
  assert.equal(linha.rec_codigo, _rec.hashCodigo("adrianomacedo", ultimoCodigo(), SEGREDO));
  assert.ok(!JSON.stringify(r.dados).includes(ultimoCodigo()), "o código nunca volta na resposta");
  // destino escolhido pelo navegador é ignorado
  sb.linhas.get("adrianomacedo").rec_envios = [];
  r = await post({ action: "recovery_send", userKey: "adrianomacedo", canal: "email", destino: "atacante@exemplo.com" });
  assert.equal(enviados[1].destino, "pessoa.teste@exemplo.com.br");
});

test("envio: sem contato, canal inválido e falha do provedor", async () => {
  sb.semear("frankpimentel", { custom_password: await _senha.hash("x-123456"), must_change: false, rec_email: "f@exemplo.com" });
  assert.equal((await enviar("frankpimentel", "sms")).status, 400, "sem celular cadastrado");
  assert.equal((await enviar("frankpimentel", "whatsapp")).status, 400);
  assert.equal((await enviar("naoexiste", "email")).status, 404);
  falhaEnvio = "Não consegui enviar o e-mail agora.";
  const r = await enviar("frankpimentel", "email");
  assert.equal(r.status, 502);
  assert.match(r.dados.error, /Não consegui/);
});

test("envio: 1 por minuto e 5 por hora", async () => {
  await comContato("adrianomacedo");
  assert.equal((await enviar("adrianomacedo", "email")).status, 200);
  const r = await enviar("adrianomacedo", "email");
  assert.equal(r.status, 429);
  assert.ok(r.dados.espera > 0 && r.dados.espera <= 60);
  const agora = Date.now();
  sb.linhas.get("adrianomacedo").rec_envios = [1, 2, 3, 4, 5].map(i => agora - i * 5 * 60000);
  assert.equal((await enviar("adrianomacedo", "email")).status, 429, "5 na última hora");
  sb.linhas.get("adrianomacedo").rec_envios = [agora - 2 * 3600000];
  assert.equal((await enviar("adrianomacedo", "email")).status, 200, "envios antigos não contam");
});

test("redefinir: código certo troca a senha, entra e encerra as outras sessões", async () => {
  await comContato("adrianomacedo");
  await enviar("adrianomacedo", "sms");
  const r = await redefinir("adrianomacedo", ultimoCodigo(), "senha-nova-123");
  assert.equal(r.status, 200);
  assert.ok(_auth.verify(r.dados.token, SEGREDO), "já sai com token");
  const linha = sb.linhas.get("adrianomacedo");
  assert.equal(linha.rec_codigo, null, "código usado some");
  assert.equal(linha.must_change, false);
  assert.equal((await entrar("adrianomacedo", "senha-nova-123")).status, 200);
  assert.equal((await entrar("adrianomacedo", "senha-esquecida")).status, 401);
  assert.ok(sb.auditoria.some(a => a.chave === "adrianomacedo" && a.entidade === "sessao"), "sessões antigas encerradas");
  assert.equal((await redefinir("adrianomacedo", ultimoCodigo(), "outra-senha-9")).status, 400, "o mesmo código não serve duas vezes");
});

test("redefinir: código errado conta tentativa e para em 5", async () => {
  await comContato("adrianomacedo");
  await enviar("adrianomacedo", "email");
  const certo = ultimoCodigo(), errado = certo === "000000" ? "111111" : "000000";
  for (let i = 4; i >= 1; i--) {
    const r = await redefinir("adrianomacedo", errado, "senha-nova-123");
    assert.equal(r.status, 401);
    assert.equal(r.dados.restam, i);
  }
  assert.equal((await redefinir("adrianomacedo", errado, "senha-nova-123")).dados.restam, 0);
  assert.equal((await redefinir("adrianomacedo", certo, "senha-nova-123")).status, 429, "esgotou: nem o certo passa");
  assert.equal((await entrar("adrianomacedo", "senha-esquecida")).status, 200, "senha não mudou");
});

test("redefinir: pedidos em paralelo não ganham tentativas a mais", async () => {
  await comContato("adrianomacedo");
  await enviar("adrianomacedo", "email");
  const errado = ultimoCodigo() === "000000" ? "111111" : "000000";
  const rs = await Promise.all(Array.from({ length: 20 }, () => redefinir("adrianomacedo", errado, "senha-nova-123")));
  const conferidas = rs.filter(r => r.status === 401).length;
  assert.ok(conferidas <= 5, `conferiu ${conferidas} vezes`);
  assert.ok(sb.linhas.get("adrianomacedo").rec_tentativas <= 5);
});

test("redefinir: vencido, bloqueado, senha padrão e senha curta", async () => {
  await comContato("adrianomacedo");
  await enviar("adrianomacedo", "email");
  assert.equal((await redefinir("adrianomacedo", ultimoCodigo(), "123")).status, 400);
  assert.equal((await redefinir("adrianomacedo", ultimoCodigo(), "padrao-de-teste-2026")).status, 400);
  sb.linhas.get("adrianomacedo").ativo = false;
  let r = await redefinir("adrianomacedo", ultimoCodigo(), "senha-nova-123");
  assert.equal(r.status, 403);
  assert.equal((await entrar("adrianomacedo", "senha-esquecida")).status, 403, "senha não mudou (403 = senha certa, mas bloqueado)");
  sb.linhas.get("adrianomacedo").ativo = true;
  sb.linhas.get("adrianomacedo").rec_envios = [];
  await enviar("adrianomacedo", "email");
  sb.linhas.get("adrianomacedo").rec_expira = new Date(Date.now() - 1000).toISOString();
  r = await redefinir("adrianomacedo", ultimoCodigo(), "senha-nova-123");
  assert.equal(r.status, 400);
  assert.match(r.dados.error, /venceu/);
});

test("cadastrar contato: a própria pessoa com a senha atual; outra só o administrador", async () => {
  sb.semear("adrianomacedo", { custom_password: await _senha.hash("minha-senha-1"), must_change: false });
  const dados = { action: "set_recovery", email: "pessoa.teste@exemplo.com.br", celular: "(19) 99123-4567" };
  assert.equal((await post(dados)).status, 401, "sem login");
  assert.equal((await post(dados, tk("adrianomacedo"))).status, 401, "sem a senha atual");
  assert.equal((await post({ ...dados, currentPassword: "errada-000" }, tk("adrianomacedo"))).status, 401);
  let r = await post({ ...dados, currentPassword: "minha-senha-1" }, tk("adrianomacedo"));
  assert.equal(r.status, 200);
  assert.equal(sb.linhas.get("adrianomacedo").rec_celular, "+5519991234567");
  assert.equal(r.dados.celular, "(19) 99123-4567");
  r = await chamar("GET", { query: { recuperacao: "1" }, token: tk("adrianomacedo") });
  assert.deepEqual(r.dados, { email: "pessoa.teste@exemplo.com.br", celular: "(19) 99123-4567" });
  // outra pessoa
  assert.equal((await post({ ...dados, userKey: "frankpimentel", currentPassword: "minha-senha-1" }, tk("adrianomacedo"))).status, 403);
  r = await post({ ...dados, userKey: "frankpimentel" }, tk("joaoygor"));
  assert.equal(r.status, 200, "administrador cadastra sem senha");
  assert.equal(sb.linhas.get("frankpimentel").rec_email, "pessoa.teste@exemplo.com.br");
  // inválidos e limpar
  assert.equal((await post({ ...dados, userKey: "frankpimentel", celular: "3212-3456" }, tk("joaoygor"))).status, 400);
  r = await post({ action: "set_recovery", userKey: "frankpimentel", email: "", celular: "" }, tk("joaoygor"));
  assert.equal(r.status, 200);
  assert.equal(sb.linhas.get("frankpimentel").rec_email, null);
});

test("lista da Configuração mostra o contato de recuperação ao administrador", async () => {
  sb.semear("adrianomacedo", { custom_password: await _senha.hash("x-123456"), must_change: false, rec_email: "pessoa.teste@exemplo.com.br", rec_celular: "+5519991234567", rec_codigo: "abc" });
  const r = await chamar("GET", { query: { all: "1" }, token: tk("joaoygor") });
  const u = r.dados.users.find(x => x.user_key === "adrianomacedo");
  assert.equal(u.rec_email, "pessoa.teste@exemplo.com.br");
  assert.equal(u.rec_celular, "(19) 99123-4567");
  assert.ok(!("rec_codigo" in u), "o código em andamento nunca sai");
});
