// Votação do novo nome e da nova logo (api/_votacao.js, via /api/rh?modulo=votacao) contra um Supabase falso.
// O que mais importa: um voto por pessoa (trocar vale o último), resultado escondido de quem vota até encerrar,
// só o administrador encerra/reabre e vê quem votou (sem ver em quê), e quem não tem login não vota.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
delete process.env.AUTH_ENFORCE;

const rh = require("../api/rh");
const V = require("../api/_votacao");
const { supabaseFalso, chamar } = require("./_supabase_falso");

const pedir = (opts) => chamar(rh, Object.assign({ query: { modulo: "votacao" } }, opts));
const ver = (usuario) => pedir({ usuario });
const votar = (usuario, opcao) => pedir({ method: "POST", usuario, body: { opcao } });
const acao = (usuario, t) => pedir({ method: "POST", usuario, query: { modulo: "votacao", t }, body: {} });

test("os arquivos da votação existem (vídeo e as duas imagens)", () => {
  V.VOTACAO.opcoes.forEach(o => assert.ok(fs.existsSync(path.join(__dirname, "..", o.img)), o.img));
  assert.ok(fs.existsSync(path.join(__dirname, "..", V.VOTACAO.video)));
});

test("um voto por pessoa: trocar vale o último e não duplica", async () => {
  const t = {}; supabaseFalso(t);
  assert.equal((await votar("carlos", "shamir")).statusCode, 200);
  assert.equal((await votar("carlos", "shamir")).statusCode, 200, "repetir o mesmo voto não grava de novo");
  assert.equal(t.fm_auditoria.length, 1);
  const r = await votar("carlos", "servix");
  assert.equal(r.body.meuVoto, "servix");
  await votar("joyce", "servix");
  const adm = await ver("joaoygor");
  assert.equal(adm.body.totalVotos, 2, "duas pessoas, mesmo com três linhas gravadas");
  const n = Object.fromEntries(adm.body.resultado.map(x => [x.id, x.votos]));
  assert.deepEqual(n, { shamir: 0, servix: 2 });
});

test("opção inexistente e voto sem login são recusados", async () => {
  const t = {}; supabaseFalso(t);
  assert.equal((await votar("carlos", "outro")).statusCode, 400);
  assert.equal((await votar("carlos", undefined)).statusCode, 400);
  const sem = await pedir({ method: "POST", body: { opcao: "shamir" } });
  assert.equal(sem.statusCode, 401);
  assert.equal((t.fm_auditoria || []).length, 0);
});

test("durante a votação quem vota não vê o resultado; o administrador vê contagem e participação, sem o voto de cada um", async () => {
  const t = {}; supabaseFalso(t);
  await votar("carlos", "shamir"); await votar("joyce", "servix");
  const comum = await ver("carlos");
  assert.equal(comum.body.aberta, true);
  assert.equal(comum.body.resultado, undefined, "resultado escondido");
  assert.equal(comum.body.participacao, undefined);
  assert.equal(comum.body.admin, false);
  const adm = await ver("joaoygor");
  assert.equal(adm.body.admin, true);
  assert.equal(adm.body.totalVotos, 2);
  const ps = adm.body.participacao;
  assert.deepEqual(ps.votaram.map(x => x.user_key).sort(), ["carlos", "joyce"]);
  assert.ok(ps.faltam.some(x => x.user_key === "paulocampana") && !ps.faltam.some(x => x.user_key === "carlos"));
  assert.ok(ps.votaram.every(x => !("opcao" in x)), "o voto é secreto: nada de opção por pessoa");
});

test("só o administrador encerra; depois de encerrada ninguém vota e todos veem o resultado; reabrir volta a aceitar", async () => {
  const t = {}; supabaseFalso(t);
  await votar("carlos", "shamir");
  assert.equal((await acao("carlos", "encerrar")).statusCode, 403);
  assert.equal((await ver("carlos")).body.aberta, true);
  const enc = await acao("joaoygor", "encerrar");
  assert.equal(enc.statusCode, 200); assert.equal(enc.body.aberta, false);
  assert.equal((await votar("joyce", "servix")).statusCode, 409);
  const fim = await ver("carlos");
  assert.equal(fim.body.aberta, false);
  assert.equal(fim.body.totalVotos, 1);
  assert.equal(fim.body.resultado.find(x => x.id === "shamir").pct, 100);
  assert.equal(fim.body.meuVoto, "shamir");
  const n = t.fm_auditoria.length;
  await acao("joaoygor", "encerrar");
  assert.equal(t.fm_auditoria.length, n, "encerrar de novo não duplica");
  assert.equal((await acao("carlos", "reabrir")).statusCode, 403);
  const re = await acao("joaoygor", "reabrir");
  assert.equal(re.body.aberta, true);
  assert.equal((await votar("joyce", "servix")).statusCode, 200);
});

test("prazo: passado o prazo fecha sozinha; o administrador pode reabrir", async () => {
  const t = {}; supabaseFalso(t);
  const antes = V.VOTACAO.ate;
  V.VOTACAO.ate = "2026-11-20T12:00:00Z";
  const real = Date.now;
  try {
    Date.now = () => Date.parse("2026-11-20T11:00:00Z");
    assert.equal((await votar("carlos", "shamir")).statusCode, 200);
    Date.now = () => Date.parse("2026-11-20T12:00:01Z");
    assert.equal((await votar("joyce", "servix")).statusCode, 409);
    assert.equal((await ver("carlos")).body.aberta, false);
    assert.equal((await acao("joaoygor", "reabrir")).body.aberta, true, "reaberta pelo administrador vale mais que o prazo");
  } finally { Date.now = real; V.VOTACAO.ate = antes; }
});

test("bloqueado não conta como eleitor; voto de outra votação não entra", async () => {
  const t = { app_users: [{ user_key: "joyce", nome: null, ativo: false, perms: {} }] }; supabaseFalso(t);
  await votar("carlos", "shamir");
  t.fm_auditoria.push({ id: 99, ator: "joyce", acao: "VOTACAO_VOTO", entidade: "votacao", chave: "outra-votacao|joyce", antes: null, depois: { opcao: "servix" }, criado_em: new Date().toISOString() });
  const adm = await ver("joaoygor");
  assert.equal(adm.body.totalVotos, 1);
  assert.ok(![...adm.body.participacao.faltam, ...adm.body.participacao.votaram].some(x => x.user_key === "joyce" && x.em == null), "bloqueada não aparece em quem falta");
});

// ── tela ────────────────────────────────────────────────────────────────────

function telaVotacao(estado) {
  const vm = require("vm");
  const el = { innerHTML: "", querySelectorAll() { return []; } };
  const chamadas = [];
  const ctx = {
    window: null, document: { getElementById: id => (id === "vt-content" ? el : null), body: { appendChild() {} }, querySelector() { return null; }, createElement: () => ({ addEventListener() {}, querySelector() { return { focus() {} }; } }) },
    sessionStorage: { getItem: k => ({ logged: "1", userKey: "carlos" }[k] || null), setItem() {} },
    fetch: async (u, o) => { chamadas.push({ u, o }); return { ok: true, status: 200, json: async () => estado }; },
    setTimeout, console, Date
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "votacao", "votacao.js"), "utf8"), ctx);
  return { ctx, el, chamadas };
}
const VOT = { id: "x", titulo: "Novo nome", chamada: "Escolha.", video: "/assets/votacao/apresentacao.mp4", ate: null, opcoes: V.VOTACAO.opcoes };

test("tela: aberta e sem voto mostra o vídeo, as duas opções e o botão de confirmar desligado", async () => {
  const { ctx, el } = telaVotacao({ ativo: true, votacao: VOT, aberta: true, meuVoto: null, admin: false });
  await ctx.votLoad();
  assert.ok(el.innerHTML.includes('<video class="vt-video"') && el.innerHTML.includes("apresentacao.mp4"));
  assert.ok(el.innerHTML.includes("SHAMIR") && el.innerHTML.includes("SERVIX"));
  assert.ok(/id="vt-ok" disabled>Confirmar meu voto/.test(el.innerHTML));
  assert.ok(!el.innerHTML.includes("Resultado") && !el.innerHTML.includes("Acompanhamento"));
});

test("tela: quem já votou vê o seu voto e pode trocar; encerrada mostra o resultado e o mais votado", async () => {
  let { ctx, el } = telaVotacao({ ativo: true, votacao: VOT, aberta: true, meuVoto: "servix", admin: false });
  await ctx.votLoad();
  assert.ok(el.innerHTML.includes("seu voto") && el.innerHTML.includes("Trocar meu voto"));
  ({ ctx, el } = telaVotacao({ ativo: true, votacao: VOT, aberta: false, encerradaEm: "2026-11-20T12:00:00Z", meuVoto: "servix", admin: false,
    resultado: [{ id: "shamir", nome: "SHAMIR", votos: 3, pct: 75 }, { id: "servix", nome: "SERVIX", votos: 1, pct: 25 }], totalVotos: 4 }));
  await ctx.votLoad();
  assert.ok(el.innerHTML.includes("Encerrada") && el.innerHTML.includes("mais votado") && el.innerHTML.includes("75%") && el.innerHTML.includes("4 pessoas votaram"));
  assert.ok(!el.innerHTML.includes("vt-ok"), "sem botão de votar");
});

test("tela: administrador vê o acompanhamento e o botão de encerrar; sem login não mostra nada", async () => {
  let { ctx, el } = telaVotacao({ ativo: true, votacao: VOT, aberta: true, meuVoto: null, admin: true,
    resultado: [{ id: "shamir", nome: "SHAMIR", votos: 0, pct: 0 }, { id: "servix", nome: "SERVIX", votos: 0, pct: 0 }], totalVotos: 0,
    participacao: { eleitores: 2, votaram: [], faltam: [{ user_key: "carlos", nome: "Carlos <b>" }] } });
  await ctx.votLoad();
  assert.ok(el.innerHTML.includes("Encerrar votação") && el.innerHTML.includes("Ainda faltam (1)"));
  assert.ok(el.innerHTML.includes("Carlos &lt;b&gt;"), "nomes escapados");
  ({ ctx, el } = telaVotacao({ ativo: false }));
  await ctx.votLoad();
  assert.ok(el.innerHTML.includes("depois que você entra"));
});
