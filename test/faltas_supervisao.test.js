// Tela da supervisão (Faltas da Supervisão): quem vê o quê e como o supervisor logado é reconhecido.
// As funções são lidas direto do index.html, para o teste valer para a tela de verdade.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

function usuarios() {
  const a = html.indexOf("const USERS={"), b = html.indexOf("\n};", a);
  assert.ok(a > 0 && b > a, "USERS não encontrado");
  return new Function(html.slice(a, b + 3) + "\nreturn USERS;")();
}
function funcao(nome, depois) {
  const i = html.indexOf("function " + nome + "(");
  assert.ok(i > 0, nome + " não encontrada");
  let d = 0, k = html.indexOf("{", i);
  for (; k < html.length; k++) { if (html[k] === "{") d++; else if (html[k] === "}" && --d === 0) break; }
  return html.slice(i, k + 1);
}

test("todo usuário com cargo Supervisor tem a tela da supervisão; ninguém mais é marcado como supervisor", () => {
  const U = usuarios();
  const sups = Object.entries(U).filter(([, u]) => u.cargo === "Supervisor");
  assert.ok(sups.length >= 7, "esperava os supervisores cadastrados");
  sups.forEach(([k, u]) => assert.equal(u.sup, true, k + " deveria ter sup:true"));
  Object.entries(U).filter(([, u]) => u.cargo !== "Supervisor").forEach(([k, u]) => assert.ok(!u.sup, k + " não é supervisor"));
});

test("menu: supervisor não vê o painel operacional; coordenação (lig) e admin veem a tela da supervisão", () => {
  const m = html.match(/const navOk=\{[^}]*\};/);
  assert.ok(m, "navOk não encontrado");
  const navOk = ({ isAdmin, isSup, isLig, isFm }) => new Function("isAdmin", "isSup", "isLig", "isFm", "isRh", "isRhDash", "isCom", "isComDash", "isPrj", "isQual", "isMetas", m[0] + "\nreturn navOk;")(isAdmin, isSup, isLig, !!isFm, false, false, false, false, false, false, false);
  const sup = navOk({ isAdmin: false, isSup: true, isLig: false });
  assert.equal(sup.sup, true); assert.equal(sup.fm, false, "o supervisor não vê o painel operacional");
  const coord = navOk({ isAdmin: false, isSup: false, isLig: true, isFm: true });
  assert.equal(coord.sup, true); assert.equal(coord.fm, true);
  const admin = navOk({ isAdmin: true, isSup: false, isLig: false });
  assert.equal(admin.sup, true); assert.equal(admin.fm, true);
  const outro = navOk({ isAdmin: false, isSup: false, isLig: false });
  assert.equal(outro.fm, false, "quem não está na lista não vê o painel operacional");
  assert.equal(outro.sup, false);
  assert.match(html, /data-pg="faltasmed" data-perm="fm"/);
  assert.match(html, /data-pg="faltassup" data-perm="sup"/);
});

test("o supervisor logado é reconhecido pelo nome (completo ou só o primeiro nome)", () => {
  const fsNorm = html.match(/const fsNorm=.*;\n/)[0];
  const f = (nome, lista) => new Function("sessionStorage", "fsSupsLista", fsNorm + funcao("fsMeuSup") + "\nreturn fsMeuSup;")({ getItem: () => nome }, () => lista)();
  const lista = ["ADRIANO MACEDO", "CARLOS NOGUEIRA", "PAULO SÉRGIO", "RONALDO CIMADON"];
  assert.equal(f("Adriano Macedo", lista), "ADRIANO MACEDO");
  assert.equal(f("Paulo Sérgio", lista), "PAULO SÉRGIO", "com acento");
  assert.equal(f("Paulo Sergio", lista), "PAULO SÉRGIO", "sem acento também");
  assert.equal(f("Carlos", lista), "CARLOS NOGUEIRA", "login só com o primeiro nome");
  assert.equal(f("Jussilene Almeida", lista), "", "a coordenação não é supervisor de área");
  assert.equal(f("Pau", lista), "", "nome parcial não casa");
  assert.equal(f("", lista), "");
});

test("limite para a medida: o texto certo para cada situação", () => {
  const esc = { fmDif: (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5), fmDdS: d => "dia " + d, fmDd: d => d, fmMedidaTxt: () => "Advertência escrita" };
  const cat = html.indexOf("function fsCat("), lim = funcao("fsLimite");
  const fsCat = funcao("fsCat");
  const f = (c, hoje) => new Function("FM", "fmDif", "fmDdS", "fmDd", "fmMedidaTxt", fsCat + lim + "\nreturn fsLimite;")({ dados: { hoje } }, esc.fmDif, esc.fmDdS, esc.fmDd, esc.fmMedidaTxt)(c);
  assert.ok(cat > 0);
  assert.deepEqual(f({ situacao: "PRAZO_VENCIDO", prazoFim: "2026-09-29" }, "2026-10-01"), { tom: "da", t: "Venceu dia 2026-09-29", s: "Atrasada há 2 dias" });
  assert.deepEqual(f({ situacao: "NO_PRAZO", prazoFim: "2026-10-01" }, "2026-10-01"), { tom: "am", t: "Hoje, 2026-10-01", s: "Último dia para aplicar" });
  assert.deepEqual(f({ situacao: "NO_PRAZO", prazoFim: "2026-10-04" }, "2026-10-01"), { tom: "am", t: "dia 2026-10-04", s: "Faltam 3 dias" });
  assert.equal(f({ situacao: "AGUARDANDO_RETORNO", retornoPrevisto: "2026-10-03" }, "2026-10-01").s, "Volta prevista dia 2026-10-03");
  assert.equal(f({ situacao: "COORDENACAO", posto: "ABANDONO" }, "2026-10-01").s, "Abandono de posto");
  assert.equal(f({ situacao: "COORDENACAO", posto: "POSTO A", motivo: "" }, "2026-10-01").s, "Mais de 3 dias sem voltar");
  assert.equal(f({ situacao: "TRATADA", medida: { DATA: "2026-09-30" } }, "2026-10-01").t, "Medida aplicada");
});

test("painel operacional Faltas x Medidas: só João (admin), Raphael, Ingridy, Campana, Jussilene e Amauri", () => {
  const U = usuarios();
  const com = Object.entries(U).filter(([, u]) => u.fm).map(([k]) => k).sort();
  assert.deepEqual(com, ["amauriantonio", "ingridycampana", "jussilenealmeida", "paulocampana", "raphaelvictor"]);
  assert.equal(U.joaoygor.admin, true, "o João entra por ser administrador");
  Object.entries(U).filter(([, u]) => u.cargo === "Supervisor").forEach(([k, u]) => assert.ok(!u.fm, k + " (supervisor) não vê o painel operacional"));
});

test("porta de entrada: sem permissão, navTo('faltasmed') não abre o painel operacional", () => {
  const dentro = t => assert.ok(html.includes(t), "faltou no index.html: " + t);
  dentro('function fmPermitido(){return sessionStorage.getItem("userAdmin")==="1"||sessionStorage.getItem("userFm")==="1";}');
  dentro('if(p==="faltasmed"&&!fmPermitido()){p=fsPermitido()?"faltassup":"visao";btn=null;}');
  dentro("function fmVgResumo(){\n  if(!vgFmPermitido())return;");
});
