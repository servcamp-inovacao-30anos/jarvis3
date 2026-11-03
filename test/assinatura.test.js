// Assinatura eletrônica da medida disciplinar: coleta no celular, PDF selado e via pública (QR, SMS, e-mail).
// Plano: plano-medida-disciplinar-assinatura-digital.md. Supabase falso em memória; o SMS e o e-mail são de mentira.
process.env.SUPABASE_URL = "http://supabase.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.AUTH_SECRET = "segredo-de-teste";
process.env.PAINEL_URL = "https://painel.exemplo.com.br";
process.env.FALTAS_MAIL_USER = "remetente@gruposervcamp.com.br";
process.env.FALTAS_MAIL_PASS = "senha-de-teste";
process.env.SMS_PROVIDER = "mock";
delete process.env.AUTH_ENFORCE;

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const crypto = require("crypto");
const { supabaseFalso, chamar } = require("./_supabase_falso");
const MD = require("../api/_medida_regras");
const DOC = require("../api/_medida_doc");
const A = require("../api/_assinatura");
const FE = require("../api/_faltas_email");
const SMS = require("../api/_sms");
const rh = require("../api/rh");
const { PDFDocument } = require("pdf-lib");

// ── imagens de assinatura de teste: PNG de verdade, com um traço ────────────
const crc = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
function chunk(tipo, dados) {
  const t = Buffer.from(tipo), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(dados.length); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
  return Buffer.concat([l, t, dados, c]);
}
function png(w, h, traco) {
  const lin = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4); // filtro 0 + RGBA
    if (traco !== false) for (let x = 20; x < w - 20; x++) { const yy = Math.round(h / 2 + Math.sin(x / 9) * (h / 4)); if (Math.abs(y - yy) < 2) { row[1 + x * 4 + 3] = 255; row[1 + x * 4] = 10; row[1 + x * 4 + 1] = 20; row[1 + x * 4 + 2] = 80; } }
    lin.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const buf = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(lin))), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + buf.toString("base64");
}
const TRACO = { pontos: 80, tracos: 2, larg: 220, alt: 50 };
const sig = () => ({ png: png(300, 100), metricas: TRACO });

// ── cenário ─────────────────────────────────────────────────────────────────
let idem = 0;
const novoIdem = () => "coleta-de-teste-" + String(++idem).padStart(6, "0");
let enviosEmail = [];
FE.definirCorreio(async m => { enviosEmail.push(m); return { ok: true, id: "<id@teste>", aceitos: [...m.para], recusados: [] }; });
// o SMS de mentira é um só, para o teste ler o que "saiu"
const mock = new SMS.MockSmsProvider();
const provedorOriginal = SMS.provedorSMS;
SMS.provedorSMS = () => (String(process.env.SMS_PROVIDER || "") === "mock" ? mock : provedorOriginal());

function base(extra) {
  enviosEmail = [];
  const t = {
    fm_faltas: [{ re: 521, data: "2026-10-20", codigo: "I", nome: "ANA PAULA", supervisor: "FRANK PIMENTEL" }, { re: 600, data: "2026-10-21", codigo: "I", nome: "BIA", supervisor: "JEAN KLEBER" }],
    fm_medidas: [], fm_dias: [], fm_admissoes: [], fm_feriados: [], fm_auditoria: [], dashboard_snapshots: [],
    pt_contatos: [{ re: 521, telefone_e164: "+5519999991234", enviavel: true }, { re: 600, telefone_e164: "+5519999995678", enviavel: false }],
    ...(extra || {})
  };
  supabaseFalso(t);
  return t;
}
const api = (t, o) => chamar(rh, { ...o, query: { modulo: "faltas", t, ...(o && o.query) } });
const via = (o) => chamar(rh, { ...o, query: { modulo: "via", ...(o && o.query) } });
const gerarCorpo = (extra) => ({ tipo: "ADVERTENCIA_ESCRITA", inicio: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), motivo: "Faltou sem justificativa no dia 20/10/2026.", re: 521, nome: "ANA PAULA", empresa: "SERV CAMP TERCEIRIZAÇÃO", supervisor: "FRANK PIMENTEL", situacoes: ["FALTA_INJUSTIFICADA"], faltas: ["2026-10-20"], caso: "521|2026-10-20", ...extra });
async function gerar(usuario, extra) {
  const r = await api("medida", { method: "POST", usuario: usuario || "frankpimentel", body: gerarCorpo(extra) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return r.body.medida;
}
const coletar = (g, o, usuario) => api("medida_coletar", { method: "POST", usuario: usuario || "frankpimentel", headers: { "user-agent": "Navegador de Teste/1.0", "x-forwarded-for": "203.0.113.7" }, body: { chave: g.chave, idem: novoIdem(), supervisor: sig(), colaborador: { ...sig(), aceite: true }, ...o } });
const codigoDe = url => url.split("#")[1];

// ── assinatura desenhada ────────────────────────────────────────────────────
test("assinatura: só PNG de verdade, do tamanho certo e com traço mínimo", () => {
  assert.equal(A.assinaturaDe(sig()).buf.length > 300, true);
  assert.equal(A.assinaturaDe({ png: png(300, 100, false), metricas: TRACO }).erro[1], "ASSINATURA_VAZIA", "tela em branco");
  assert.equal(A.assinaturaDe({ png: "data:image/jpeg;base64,AAAA", metricas: TRACO }).erro[1], "ASSINATURA_INVALIDA");
  assert.equal(A.assinaturaDe({ png: "data:image/png;base64," + Buffer.from("nao sou png nenhum, so texto comprido o bastante").toString("base64").repeat(8), metricas: TRACO }).erro[1], "ASSINATURA_VAZIA");
  assert.equal(A.assinaturaDe({ png: png(1700, 100), metricas: TRACO }).erro[1], "ASSINATURA_INVALIDA", "larga demais");
  assert.equal(A.assinaturaDe({ png: png(300, 100), metricas: { pontos: 3, larg: 220, alt: 50 } }).erro[1], "TRACO_CURTO", "um toque solto");
  assert.equal(A.assinaturaDe({ png: png(300, 100), metricas: { pontos: 80, larg: 10, alt: 50 } }).erro[1], "TRACO_CURTO");
  assert.equal(A.assinaturaDe({ png: png(300, 100) }).erro[1], "TRACO_CURTO", "sem medidas do traço");
  assert.equal(A.assinaturaDe({ png: "data:image/png;base64," + Buffer.alloc(90 * 1024, 1).toString("base64"), metricas: TRACO }).erro[1], "ASSINATURA_GRANDE");
});

// ── o texto do PDF é o texto da tela ────────────────────────────────────────
function carregarMedidaJs() {
  const alvo = {};
  const win = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  win.window = win;
  const ctx = vm.createContext({
    window: win, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    location: { search: "" }, history: { replaceState() {} }, URLSearchParams, setTimeout() {}, alert() {}, fetch: async () => ({}), USERS: { frankpimentel: { nome: "Frank Pimentel" } }, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "medida", "medida.js"), "utf8"), ctx);
  return win;
}
const soTexto = h => h.replace(/<\/?b>/g, "").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().toUpperCase();

test("o texto do PDF é o texto que o colaborador lê na tela: cada trecho do servidor está no docHtml", () => {
  const win = carregarMedidaJs();
  const casos = [
    { tipoId: "SUSPENSAO", dias: 3 }, { tipoId: "ADVERTENCIA_ESCRITA" }, { tipoId: "ADVERTENCIA_VERBAL" }
  ];
  casos.forEach(c => {
    const d = { empresa: "SERV CAMP TERCEIRIZAÇÃO", re: "521", nome: "Ana Paula d'Ávila & Cia", inicio: "2026-10-27", docData: "2026-10-27", motivo: "Faltou ao trabalho <sem> justificativa \"no dia\" 20/10/2026.", numero: "MD-2026-0007", geradoPor: "frankpimentel", geradoEm: "2026-10-27T10:00:00Z", ...c };
    const tela = soTexto(win.mdDocHtml(d));
    const pdf = DOC.conteudo(d);
    ["empresa", "titulo", "re", "abre", "motivoTitulo", "motivo", "fecho", "local", "atenciosamente"].forEach(k => {
      assert.ok(tela.includes(String(pdf[k]).toUpperCase().replace(/\s+/g, " ")), `${c.tipoId}: "${k}" do PDF não está na tela: ${pdf[k]}`);
    });
  });
});

test("a tela de leitura do colaborador não traz as linhas de assinatura do papel", () => {
  const win = carregarMedidaJs();
  const d = { empresa: "E", re: "1", nome: "N", tipoId: "ADVERTENCIA_ESCRITA", inicio: "2026-10-27", motivo: "m", docData: "2026-10-27" };
  assert.ok(win.mdDocHtml(d).includes("Assinatura do Colaborador"));
  assert.ok(!win.mdDocHtml({ ...d, digital: true }).includes("Assinatura do Colaborador"));
});

// ── coleta ──────────────────────────────────────────────────────────────────
test("coletar: assina, gera o PDF selado, guarda a trilha e a medida passa a ter o documento assinado", async () => {
  const t = base();
  const g = await gerar();
  const r = await coletar(g);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.resultado, "ASSINADA");
  assert.match(r.body.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.body.medida.assinado.digital, true);
  assert.equal(r.body.medida.assinado.resultado, "ASSINADA");
  assert.equal(r.body.medida.assinado.sha256, r.body.sha256);
  assert.equal(r.body.medida.assinado.tipo, "application/pdf");
  // o PDF guardado é o do hash, e é um PDF com 2 páginas (documento e evidências)
  const ev = t.fm_auditoria.find(e => e.acao === MD.ACAO_ASSINADA);
  const bytes = Buffer.from(ev.depois.base64, "base64");
  assert.equal(A.sha256(bytes), r.body.sha256, "o hash confere com o arquivo gravado");
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(ev.depois.nome, g.numero + "-assinada.pdf");
  // a trilha: quem, quando (hora do servidor), de onde
  const c = t.fm_auditoria.find(e => e.acao === "MEDIDA_COLETA");
  assert.equal(c.ator, "frankpimentel");
  assert.equal(c.depois.resultado, "ASSINADA");
  assert.equal(c.depois.ip, "203.0.113.7");
  assert.equal(c.depois.aparelho, "Navegador de Teste/1.0");
  assert.equal(c.depois.aceite, "Li e estou ciente");
  assert.ok(Math.abs(c.depois.em - Date.now()) < 5000, "a hora é a do servidor");
  assert.match(c.depois.textoSha, /^[0-9a-f]{64}$/);
  // o QR já sai junto, vale 15 minutos e a URL leva o código na parte "#"
  assert.match(r.body.via.url, /^https:\/\/painel\.exemplo\.com\.br\/via\.html#[A-Za-z0-9_-]{20,}$/);
  assert.ok(Math.abs(r.body.via.expiraEm - (Date.now() + 15 * 60000)) < 5000);
});

test("coletar: o código da via nunca é guardado, só o hash; o link não leva nome, RE nem motivo", async () => {
  const t = base();
  const g = await gerar();
  const r = await coletar(g);
  const codigo = codigoDe(r.body.via.url);
  assert.ok(!JSON.stringify(t.fm_auditoria).includes(codigo), "o código em si não aparece em lugar nenhum");
  const v = t.fm_auditoria.find(e => e.acao === "MEDIDA_VIA");
  assert.equal(v.chave, A.hashCodigo(codigo));
  assert.ok(!/ANA|521|justificativa/i.test(r.body.via.url));
});

test("coletar: sinal ruim e toque duplo não criam segunda assinatura (mesma chave), e outra chave é recusada", async () => {
  const t = base();
  const g = await gerar();
  const chaveIdem = novoIdem();
  const um = await coletar(g, { idem: chaveIdem });
  const dois = await coletar(g, { idem: chaveIdem });
  assert.equal(um.statusCode, 200);
  assert.equal(dois.statusCode, 200, "o reenvio devolve o mesmo resultado");
  assert.equal(dois.body.sha256, um.body.sha256);
  assert.equal(t.fm_auditoria.filter(e => e.acao === "MEDIDA_COLETA").length, 1);
  assert.equal(t.fm_auditoria.filter(e => e.acao === MD.ACAO_ASSINADA).length, 1, "um PDF só");
  const outra = await coletar(g);
  assert.equal(outra.statusCode, 409);
  assert.equal(outra.body.codigo, "JA_COLETADA");
});

test("coletar: sem aceite, sem chave de segurança, traço curto, área alheia, cancelada e quem não gera são recusados", async () => {
  base();
  const g = await gerar();
  assert.equal((await coletar(g, { colaborador: { ...sig(), aceite: false } })).body.codigo, "SEM_ACEITE");
  assert.equal((await coletar(g, { idem: "curto" })).body.codigo, "SEM_IDEM");
  assert.equal((await coletar(g, { colaborador: { png: png(300, 100), metricas: { pontos: 2, larg: 5, alt: 2 }, aceite: true } })).body.codigo, "TRACO_CURTO");
  assert.equal((await coletar(g, { supervisor: { png: png(300, 100), metricas: { pontos: 2, larg: 5, alt: 2 } } })).body.codigo, "TRACO_CURTO");
  assert.equal((await coletar(g, { colaborador: undefined })).body.codigo, "DADOS_INVALIDOS", "nem assinatura nem recusa");
  assert.equal((await coletar(g, { recusa: { testemunhas: [] } })).body.codigo, "DADOS_INVALIDOS", "assinatura e recusa ao mesmo tempo");
  assert.equal((await coletar(g, {}, "jeankleber")).statusCode, 403, "outra área");
  assert.equal((await coletar(g, {}, "sandraalves")).statusCode, 403, "quem não gera medida");
  assert.equal((await api("medida_coletar", { method: "POST", body: { chave: g.chave } })).statusCode, 401, "sem login");
  assert.equal((await coletar({ chave: "zz" })).body.codigo, "CHAVE_INVALIDA");
  await api("medida_cancelar", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, motivo: "gerada por engano" } });
  assert.equal((await coletar(g)).body.codigo, "CANCELADA");
});

test("coletar: medida com documento em papel já anexado não recebe assinatura digital, e o PDF digital não é trocado por anexo", async () => {
  base();
  const g1 = await gerar();
  const JPG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
  await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g1.chave, arquivo: JPG, nome: "foto.jpg" } });
  assert.equal((await coletar(g1)).body.codigo, "JA_ASSINADA_EM_PAPEL");
  const g2 = await gerar("frankpimentel", { repetir: true });
  assert.equal((await coletar(g2)).statusCode, 200);
  const troca = await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g2.chave, arquivo: JPG } });
  assert.equal(troca.statusCode, 409);
  assert.equal(troca.body.codigo, "ASSINADA_NO_CELULAR");
  assert.equal((await api("medida_assinado", { method: "POST", usuario: "frankpimentel", body: { chave: g2.chave, remover: true } })).statusCode, 409);
});

test("coletar: a assinatura do supervisor fica no perfil e vale com um toque; sem ela guardada, pede para desenhar", async () => {
  const t = base();
  const g = await gerar();
  assert.equal((await coletar(g, { supervisor: { usarPerfil: true } })).body.codigo, "SEM_ASSINATURA_PERFIL");
  assert.equal((await api("assinatura_perfil", { usuario: "frankpimentel" })).body.tem, false);
  assert.equal((await api("assinatura_perfil", { method: "POST", usuario: "frankpimentel", body: { png: png(300, 100), metricas: { pontos: 2, larg: 5, alt: 2 } } })).body.codigo, "TRACO_CURTO");
  const s = await api("assinatura_perfil", { method: "POST", usuario: "frankpimentel", body: sig() });
  assert.equal(s.body.tem, true);
  assert.equal((await api("assinatura_perfil", { usuario: "jeankleber" })).body.tem, false, "cada um tem a sua");
  assert.equal((await api("assinatura_perfil", { usuario: "frankpimentel" })).body.png, sig().png);
  const r = await coletar(g, { supervisor: { usarPerfil: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(t.fm_auditoria.find(e => e.acao === "MEDIDA_COLETA").depois.doPerfil, true);
  await api("assinatura_perfil", { method: "POST", usuario: "frankpimentel", body: { remover: true } });
  assert.equal((await api("assinatura_perfil", { usuario: "frankpimentel" })).body.tem, false);
});

test("coletar: desenhar e marcar 'guardar' grava no perfil para as próximas medidas", async () => {
  base();
  const g = await gerar();
  await coletar(g, { supervisor: { ...sig(), guardar: true } });
  assert.equal((await api("assinatura_perfil", { usuario: "frankpimentel" })).body.tem, true);
});

test("recusa: testemunhas não são obrigatórias; sem nenhuma, registra o fato e entrega a via do mesmo jeito", async () => {
  const t = base();
  const g = await gerar();
  const r = await coletar(g, { recusa: { testemunhas: [], observacao: "Disse que não concorda." }, colaborador: undefined });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.resultado, "RECUSADA");
  assert.ok(r.body.via, "a via sai do mesmo jeito");
  assert.deepEqual(t.fm_auditoria.find(e => e.acao === "MEDIDA_COLETA").depois.testemunhas, []);
  const pdf = await PDFDocument.load(Buffer.from(t.fm_auditoria.find(e => e.acao === MD.ACAO_ASSINADA).depois.base64, "base64"));
  assert.equal(pdf.getPageCount(), 2);
});

test("recusa: testemunha informada precisa ter o nome (o documento é opcional); no máximo duas", async () => {
  const t = base();
  const g = await gerar();
  assert.equal((await coletar(g, { recusa: { testemunhas: [{ nome: "", doc: "123" }] }, colaborador: undefined })).body.codigo, "TESTEMUNHA_SEM_NOME");
  assert.equal((await coletar(g, { recusa: { testemunhas: [{ nome: "A" }, { nome: "B" }, { nome: "C" }] }, colaborador: undefined })).body.codigo, "TESTEMUNHAS_DEMAIS");
  const um = await coletar(g, { recusa: { testemunhas: [{ nome: "Fulano de Tal", doc: "" }] }, colaborador: undefined });
  assert.equal(um.statusCode, 200, "uma testemunha só, sem documento, vale");
  const g2 = await gerar("frankpimentel", { repetir: true });
  const r = await coletar(g2, { recusa: { testemunhas: [{ nome: "Fulano de Tal", doc: "111" }, { nome: "Sicrana de Tal", doc: "222" }], observacao: "Disse que não concorda." }, colaborador: undefined });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.resultado, "RECUSADA");
  assert.equal(r.body.medida.assinado.resultado, "RECUSADA");
  assert.ok(r.body.via, "a via sai do mesmo jeito");
  const c = t.fm_auditoria.filter(e => e.acao === "MEDIDA_COLETA" && e.chave === g2.chave)[0];
  assert.equal(c.depois.resultado, "RECUSADA");
  assert.deepEqual(c.depois.testemunhas.map(x => x.nome), ["Fulano de Tal", "Sicrana de Tal"]);
});

test("PDF: aguenta texto longo, quebra de linha, caracteres fora do alfabeto e várias páginas", async () => {
  const t = base();
  const g = await gerar("frankpimentel", { motivo: ("Faltou ao trabalho sem justificativa 😀 → ✓ " + "palavra ".repeat(60) + "\nsegunda linha " + "x".repeat(200) + "\n").repeat(6).slice(0, 1400) });
  const r = await coletar(g);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const pdf = await PDFDocument.load(Buffer.from(t.fm_auditoria.find(e => e.acao === MD.ACAO_ASSINADA).depois.base64, "base64"));
  assert.ok(pdf.getPageCount() >= 2);
});

// ── via pública ─────────────────────────────────────────────────────────────
test("via QR: abre sem senha, entrega o PDF do hash, registra cada abertura e vence em 15 minutos", async () => {
  const t = base();
  const g = await gerar();
  const r = await coletar(g);
  const c = codigoDe(r.body.via.url);
  const meta = await via({ query: { c } });
  assert.deepEqual([meta.statusCode, meta.body.tipo], [200, "QR"]);
  assert.deepEqual(Object.keys(meta.body).sort(), ["ok", "tipo"], "antes de abrir não sai nada do documento nem do colaborador");
  const d = await via({ method: "POST", body: { c }, headers: { "user-agent": "Celular do Colaborador", "x-forwarded-for": "198.51.100.9" } });
  assert.equal(d.statusCode, 200, JSON.stringify(d.body));
  assert.equal(A.sha256(Buffer.from(d.body.base64, "base64")), r.body.sha256);
  assert.equal(d.body.sha256, r.body.sha256);
  const ab = t.fm_auditoria.filter(e => e.acao === "MEDIDA_VIA_ABERTA");
  assert.equal(ab.length, 1);
  assert.equal(ab[0].depois.ip, "198.51.100.9");
  assert.equal(ab[0].chave, A.hashCodigo(c));
  // vence
  const v = t.fm_auditoria.find(e => e.acao === "MEDIDA_VIA");
  v.depois.expiraEm = Date.now() - 1;
  const velho = await via({ method: "POST", body: { c } });
  assert.deepEqual([velho.statusCode, velho.body.codigo], [410, "LINK_VENCIDO"]);
  assert.equal((await via({ query: { c } })).statusCode, 410);
});

test("via: código inventado, curto ou de outro documento dá a mesma resposta, sem pista", async () => {
  base();
  const respostas = [];
  for (const c of ["", "abc", "a".repeat(32), "../../etc/passwd", "x".repeat(200)]) {
    const r = await via({ method: "POST", body: { c } });
    respostas.push([r.statusCode, r.body.codigo]);
  }
  respostas.forEach(x => assert.deepEqual(x, [410, "LINK_VENCIDO"]));
});

test("via por SMS: vale 30 dias, pede RE e os 4 últimos dígitos do celular, trava depois de 5 erros", async () => {
  const t = base();
  const g = await gerar();
  await coletar(g);
  const envio =await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, canal: "sms" } });
  assert.equal(envio.statusCode, 200, JSON.stringify(envio.body));
  assert.equal(envio.body.destino, "(**) *****-1234", "o número sai mascarado");
  assert.ok(!JSON.stringify(t.fm_auditoria.filter(e => e.acao === "MEDIDA_VIA_ENVIO")).includes("999991234"), "o número inteiro não fica na trilha");
  const sms = mock.enviados[mock.enviados.length - 1];
  assert.equal(sms.destinatario, "+5519999991234");
  const url = /https:\/\/\S+/.exec(sms.texto)[0];
  assert.ok(sms.texto.includes(g.numero));
  const c = codigoDe(url);
  assert.equal((await via({ query: { c } })).body.tipo, "LINK");
  const v = t.fm_auditoria.filter(e => e.acao === "MEDIDA_VIA").pop();
  assert.ok(Math.abs(v.depois.expiraEm - (Date.now() + 30 * 24 * 3600000)) < 5000);
  // sem confirmação ou com confirmação errada, não sai o PDF
  assert.equal((await via({ method: "POST", body: { c } })).statusCode, 403);
  assert.equal((await via({ method: "POST", body: { c, re: "521", ult4: "0000" } })).statusCode, 403);
  assert.equal((await via({ method: "POST", body: { c, re: "999", ult4: "1234" } })).statusCode, 403);
  const ok = await via({ method: "POST", body: { c, re: "521", ult4: "1234" } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.base64);
  // limite de tentativas: 5 erros bloqueiam o link (até a resposta certa)
  const g2 = await gerar("frankpimentel", { repetir: true });
  await coletar(g2);
  await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g2.chave, canal: "sms" } });
  const c2 = codigoDe(/https:\/\/\S+/.exec(mock.enviados[mock.enviados.length - 1].texto)[0]);
  for (let i = 0; i < 5; i++) assert.equal((await via({ method: "POST", body: { c: c2, re: "521", ult4: "000" + i } })).statusCode, 403);
  const trava = await via({ method: "POST", body: { c: c2, re: "521", ult4: "1234" } });
  assert.deepEqual([trava.statusCode, trava.body.codigo], [429, "MUITAS_TENTATIVAS"]);
});

test("via por SMS: sem celular liberado no cadastro ou com SMS desligado, avisa e o QR continua funcionando", async () => {
  base();
  const g = await gerar("jeankleber", { re: 600, nome: "BIA", supervisor: "JEAN KLEBER", caso: "600|2026-10-21", faltas: ["2026-10-21"] });
  assert.equal((await coletar(g, {}, "jeankleber")).statusCode, 200);
  const ctt = await api("medida_contato", { usuario: "jeankleber", query: { chave: g.chave } });
  assert.deepEqual([ctt.body.sms.celular, ctt.body.sms.ligado], [false, true]);
  const r = await api("medida_via", { method: "POST", usuario: "jeankleber", body: { chave: g.chave, canal: "sms" } });
  assert.equal(r.body.codigo, "SEM_CELULAR");
  const qr = await api("medida_via", { method: "POST", usuario: "jeankleber", body: { chave: g.chave, canal: "qr" } });
  assert.equal(qr.statusCode, 200);
  assert.ok(qr.body.via.url);
  const antes = process.env.SMS_PROVIDER;
  process.env.SMS_PROVIDER = "";
  try {
    base();
    const g2 = await gerar();
    await coletar(g2);
    assert.equal((await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g2.chave, canal: "sms" } })).body.codigo, "SMS_DESLIGADO");
    assert.equal((await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g2.chave, canal: "qr" } })).statusCode, 200, "sem SMS o QR segue sem erro");
  } finally { process.env.SMS_PROVIDER = antes; }
});

test("via por e-mail: link de 30 dias para o endereço informado; endereço inválido é recusado", async () => {
  const t = base({ fm_auditoria: [{ id: 1, ator: "raphaelvictor", acao: "FALTAS_EMAIL_CONTA", entidade: "fm_email", chave: "conta", antes: null, depois: null, criado_em: "2026-10-01T00:00:00Z" }] });
  const g = await gerar();
  await coletar(g);
  assert.equal((await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, canal: "email", email: "nao-e-email" } })).body.codigo, "EMAIL_INVALIDO");
  const r = await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, canal: "email", email: "colaborador@exemplo.com.br" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(enviosEmail.length, 1);
  assert.deepEqual(enviosEmail[0].para, ["colaborador@exemplo.com.br"]);
  assert.match(enviosEmail[0].texto, /via\.html#/);
  assert.ok(!JSON.stringify(t.fm_auditoria.filter(e => e.acao === "MEDIDA_VIA_ENVIO")).includes("colaborador@exemplo"), "o e-mail inteiro não fica na trilha");
});

test("via: quem não é da área não gera link; medida sem PDF digital não gera link; canal inválido é recusado", async () => {
  base();
  const g = await gerar();
  assert.equal((await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, canal: "qr" } })).body.codigo, "SEM_PDF_DIGITAL");
  await coletar(g);
  assert.equal((await api("medida_via", { method: "POST", usuario: "jeankleber", body: { chave: g.chave, canal: "qr" } })).statusCode, 404);
  assert.equal((await api("medida_via", { method: "POST", usuario: "sandraalves", body: { chave: g.chave, canal: "qr" } })).statusCode, 403);
  assert.equal((await api("medida_via", { method: "POST", usuario: "frankpimentel", body: { chave: g.chave, canal: "pombo" } })).body.codigo, "CANAL_INVALIDO");
});

test("a página pública não exige login e a via não aparece no painel de ninguém sem a chave", async () => {
  base();
  const r = await chamar(rh, { query: { modulo: "via", c: "a".repeat(30) } });
  assert.notEqual(r.statusCode, 401, "a rota da via passa antes da exigência de token");
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(vercel.headers[0].headers.some(h => h.key === "Content-Security-Policy"));
});

test("tela: os botões não dependem de a assinatura já ter carregado (sinal fraco no celular do supervisor)", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "assets", "medida", "medida.js"), "utf8");
  // sem o assinatura.js o botão não fazia nada; sem o .css a janela ficava sem estilo, fora da tela
  assert.ok(!/onclick="mdAssinar\(|onclick="mdVia\(/.test(md), "o botão passa pela versão que confere os arquivos");
  assert.ok(!/typeof window\.mdAssinar==="function"\)window\.mdAssinar/.test(md), "depois de gerar, não fecha a janela calado");
  for (const arq of ["/assets/medida/assinatura.css", "/assets/vendor/qrcode-generator.js", "/assets/medida/assinatura.js"]) {
    assert.ok(md.includes(arq), "busca de novo " + arq);
    assert.ok(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").includes(arq), "o mesmo arquivo que o index.html carrega: " + arq);
  }
});
