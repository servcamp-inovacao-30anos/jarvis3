// Sessão salva no aparelho (assets/sessao/sessao.js): roda o script de verdade num navegador de mentira.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const _auth = require("../api/_auth");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "assets", "sessao", "sessao.js"), "utf8");
const SEGREDO = "segredo-so-de-teste";
const DIA = 24 * 3600000;

class Armazem {
  constructor(i) { this.m = new Map(Object.entries(i || {})); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

// Carrega o script como o navegador faria. "pagina" simula o que o script principal define depois.
function abrir({ local = {}, sessao = {}, respostas = [], toque = false } = {}) {
  const ls = new Armazem(local), ss = new Armazem(sessao);
  const pedidos = [], ouvintes = {}, avisos = [];
  let recarregou = 0;
  const pagina = {
    expirou: [], abriu: 0,
    _sessaoExpirou(m) { pagina.expirou.push(m); },
    _abrirSessao() { pagina.abriu++; }
  };
  const caixa = { checked: false };
  const win = {
    localStorage: ls, sessionStorage: ss,
    matchMedia: () => ({ matches: toque }),
    addEventListener: (n, f) => { ouvintes[n] = f; },
    confirm: () => true, alert: m => avisos.push(m),
    ...pagina
  };
  win.window = win;
  const ctx = vm.createContext({
    window: win, sessionStorage: ss, localStorage: ls,
    document: { readyState: "complete", getElementById: id => (id === "loginManter" ? caixa : null), addEventListener() {} },
    location: { reload() { recarregou++; } },
    fetch: async (url, opt) => {
      pedidos.push({ url, opt });
      const r = respostas.shift() || { status: 200, json: {} };
      return { status: r.status, ok: r.status < 400, json: async () => r.json };
    },
    setInterval() { return 1; }, atob: s => Buffer.from(s, "base64").toString("binary"),
    TextDecoder, Uint8Array, JSON, Date, Object, String, Math
  });
  // as funções do script principal que o sessao.js embrulha ficam no window; o script lê pelo escopo global
  ctx.window._sessaoExpirou = pagina._sessaoExpirou; ctx.window._abrirSessao = pagina._abrirSessao;
  vm.runInContext(SCRIPT, ctx);
  return { win, ls, ss, pedidos, ouvintes, avisos, pagina, caixa, recarregou: () => recarregou };
}
const espera = () => new Promise(ok => setImmediate(ok));
const tokenSalvo = (horas = 30 * 24, extra = { m: 1 }) => _auth.sign("raphaelvictor", SEGREDO, horas, extra);
const copia = (token, exp, em) => JSON.stringify({ v: 1, exp, em: em || Date.now(), k: { logged: "1", authToken: token, userKey: "raphaelvictor", userNome: "Fulano", userSup: "1" } });

test("abrir a página com sessão salva válida: volta logado, sem pedir login", () => {
  const t = tokenSalvo();
  const { ss } = abrir({ local: { jarvisSessao: copia(t, Date.now() + 29 * DIA) } });
  assert.equal(ss.getItem("logged"), "1");
  assert.equal(ss.getItem("authToken"), t);
  assert.equal(ss.getItem("userKey"), "raphaelvictor");
  assert.equal(ss.getItem("userSup"), "1");
});

test("sessão salva vencida, adulterada ou incompleta não restaura e é apagada", () => {
  const casos = [
    copia(tokenSalvo(), Date.now() - 1000),
    "isto não é json",
    JSON.stringify({ v: 2, exp: Date.now() + DIA, k: { logged: "1", authToken: "x" } }),
    JSON.stringify({ v: 1, exp: Date.now() + DIA, k: { logged: "1" } }),
    JSON.stringify({ v: 1, exp: Date.now() + DIA, k: { authToken: "x" } })
  ];
  casos.forEach((c, i) => {
    const { ss, ls } = abrir({ local: { jarvisSessao: c } });
    assert.equal(ss.getItem("logged"), null, "caso " + i);
    assert.equal(ls.getItem("jarvisSessao"), null, "apagou o caso " + i);
  });
});

test("quem já está logado nesta aba não tem a sessão trocada pela guardada", () => {
  const { ss } = abrir({ sessao: { logged: "1", userKey: "joaoygor", authToken: "da-aba" }, local: { jarvisSessao: copia(tokenSalvo(), Date.now() + DIA) } });
  assert.equal(ss.getItem("userKey"), "joaoygor");
});

test("só a sessão de 'manter conectado' vai para o aparelho; a de 12 h não", () => {
  const manter = tokenSalvo();
  const a = abrir({ sessao: { logged: "1", userKey: "raphaelvictor", userNome: "Fulano", authToken: manter, introVisto: "1" } });
  a.win._abrirSessao();
  const s = JSON.parse(a.ls.getItem("jarvisSessao"));
  assert.equal(s.k.authToken, manter);
  assert.equal(s.k.userNome, "Fulano");
  assert.equal(s.k.introVisto, undefined, "só a sessão vai, nada mais");
  assert.ok(Math.abs(s.exp - (Date.now() + 30 * DIA)) < 5000, "o prazo é o do token");

  const comum = abrir({ sessao: { logged: "1", userKey: "raphaelvictor", authToken: tokenSalvo(12, null) }, local: { jarvisSessao: copia("antigo", Date.now() + DIA) } });
  comum.win._abrirSessao();
  assert.equal(comum.ls.getItem("jarvisSessao"), null, "entrou sem marcar: nada fica guardado (e a cópia antiga sai)");
});

test("login vencido, bloqueado ou 'sair' apaga a cópia do aparelho", () => {
  const a = abrir({ sessao: { logged: "1", authToken: tokenSalvo() } });
  a.win._abrirSessao();
  assert.ok(a.ls.getItem("jarvisSessao"));
  a.win._sessaoExpirou("Seu acesso foi bloqueado pelo administrador.");
  assert.equal(a.ls.getItem("jarvisSessao"), null);
  assert.deepEqual(a.pagina.expirou, ["Seu acesso foi bloqueado pelo administrador."], "e o aviso original continua saindo");

  const b = abrir({ sessao: { logged: "1", authToken: tokenSalvo() } });
  b.win._abrirSessao();
  b.win.sessaoSair();
  assert.equal(b.ls.getItem("jarvisSessao"), null);
  assert.equal(b.ss.getItem("logged"), null);
  assert.equal(b.recarregou(), 1, "recarrega a página: nada da sessão anterior fica na memória");
});

test("ao abrir, a sessão é renovada: o token novo substitui o velho no navegador e no aparelho", async () => {
  const velho = tokenSalvo(), novo = tokenSalvo(30 * 24, { m: 1, novo: 1 });
  const a = abrir({ local: { jarvisSessao: copia(velho, Date.now() + 5 * DIA, Date.now() - 7 * 3600000) }, respostas: [{ status: 200, json: { ok: true, token: novo } }] });
  await espera(); await espera();
  assert.equal(a.pedidos.length, 1);
  assert.equal(a.pedidos[0].url, "/api/users");
  assert.equal(JSON.parse(a.pedidos[0].opt.body).action, "renew");
  assert.equal(a.pedidos[0].opt.headers.Authorization, "Bearer " + velho);
  assert.equal(a.ss.getItem("authToken"), novo);
  assert.equal(JSON.parse(a.ls.getItem("jarvisSessao")).k.authToken, novo);
});

test("renovada há pouco, não pede de novo (não sobrecarrega a cada recarregar)", async () => {
  const a = abrir({ local: { jarvisSessao: copia(tokenSalvo(), Date.now() + 29 * DIA, Date.now() - 60000) } });
  await espera();
  assert.equal(a.pedidos.length, 0);
});

test("servidor recusa a renovação (bloqueado ou encerrada): volta ao login com o aviso certo", async () => {
  const vencida = copia(tokenSalvo(), Date.now() + 5 * DIA, Date.now() - 7 * 3600000);
  const b = abrir({ local: { jarvisSessao: vencida }, respostas: [{ status: 401, json: { bloqueado: true } }] });
  await espera(); await espera();
  assert.deepEqual(b.pagina.expirou, ["Seu acesso foi bloqueado pelo administrador."]);
  assert.equal(b.ls.getItem("jarvisSessao"), null);
  const e = abrir({ local: { jarvisSessao: vencida }, respostas: [{ status: 401, json: { encerrada: true } }] });
  await espera(); await espera();
  assert.deepEqual(e.pagina.expirou, ["Sua sessão foi encerrada. Entre de novo."]);
});

test("sem sinal ou servidor fora na renovação: continua logado e tenta depois", async () => {
  const vencida = copia(tokenSalvo(), Date.now() + 5 * DIA, Date.now() - 7 * 3600000);
  const a = abrir({ local: { jarvisSessao: vencida }, respostas: [{ status: 503, json: {} }] });
  await espera(); await espera();
  assert.deepEqual(a.pagina.expirou, []);
  assert.equal(a.ss.getItem("logged"), "1");
  assert.ok(a.ls.getItem("jarvisSessao"));
});

test("no celular a caixa 'Manter conectado' já vem marcada; no notebook, desmarcada", () => {
  assert.equal(abrir({ toque: true }).caixa.checked, true);
  assert.equal(abrir({ toque: false }).caixa.checked, false);
});

test("sair de todos os aparelhos: pede ao servidor e só sai deste se o servidor confirmar", async () => {
  const recente = () => ({ jarvisSessao: copia(tokenSalvo(), Date.now() + 29 * DIA) });
  const ok = abrir({ sessao: { logged: "1", authToken: tokenSalvo() }, local: recente(), respostas: [{ status: 200, json: { ok: true } }] });
  ok.win.sessaoSairDeTodos();
  await espera(); await espera();
  assert.equal(JSON.parse(ok.pedidos[0].opt.body).action, "logout_all");
  assert.equal(ok.recarregou(), 1);
  const falha = abrir({ sessao: { logged: "1", authToken: tokenSalvo() }, local: recente(), respostas: [{ status: 502, json: { error: "Não consegui encerrar as sessões agora. Tente de novo." } }] });
  falha.win.sessaoSairDeTodos();
  await espera(); await espera();
  assert.equal(falha.recarregou(), 0, "falhou: continua logado e avisa");
  assert.equal(falha.avisos.length, 1);
});

test("saiu em outra aba: esta aba também volta ao login", () => {
  const a = abrir({ sessao: { logged: "1", authToken: tokenSalvo() } });
  a.ouvintes.storage({ key: "jarvisSessao", newValue: null });
  assert.equal(a.recarregou(), 1);
  assert.equal(a.ss.getItem("logged"), null);
  const b = abrir({ sessao: { logged: "1", authToken: tokenSalvo(12, null) } });
  b.ouvintes.storage({ key: "jarvisSessao", newValue: null });
  assert.equal(b.recarregou(), 0, "a sessão comum de 12 h não depende da cópia do aparelho");
});

test("o index.html carrega o script antes do principal e a tela de login tem a caixa", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const iSessao = html.indexOf('<script src="/assets/sessao/sessao.js"></script>');
  assert.ok(iSessao > 0 && iSessao < html.indexOf('<script id="ds">'), "o script de sessão vem antes do principal");
  assert.ok(html.includes('id="loginManter"'));
  assert.ok(html.includes("manter:_manterLogin=!!"), "o pedido de login diz se é para manter conectado");
  assert.ok(html.includes('onclick="sessaoSair();return false"') && html.includes('onclick="sessaoSairDeTodos();return false"'));
});

test("o manifesto pede para o link reaproveitar a janela do app instalado (extra do Android: o sistema decide, sem garantia)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "site.webmanifest"), "utf8"));
  assert.deepEqual(m.launch_handler, { client_mode: ["navigate-existing", "auto"] });
  assert.equal(m.scope, "/");
});
