// api/_assinatura.js — assinatura eletrônica da medida disciplinar (plano: plano-medida-disciplinar-assinatura-digital.md).
// Arquivo com prefixo "_" → NÃO vira rota; as rotas entram por api/_faltas.js (módulo faltas) e a página
// pública da via por api/rh.js (?modulo=via → api/_via.js), porque o plano Hobby da Vercel já está nas 12 funções.
//
// O que existe aqui
//   • coletar: o supervisor e o colaborador assinam no celular (ou o colaborador recusa); o servidor monta o PDF,
//     calcula o hash SHA-256 do arquivo final e guarda tudo na fm_auditoria (sem tabela nova);
//   • a assinatura do supervisor guardada no perfil (uma vez, um toque por medida);
//   • a via: o link para o colaborador baixar o PDF (QR de 15 minutos sem senha; SMS ou e-mail de 30 dias com confirmação).
//
// Eventos (entidade = MD.ENTIDADE; a chave é a da medida, salvo onde dito):
//   MEDIDA_COLETA            a trilha da coleta: quem coletou, quando (hora do servidor), IP, aparelho, resultado, idempotência
//   MEDIDA_ASSINADA          o PDF (o mesmo evento do anexo em papel, com digital:true, resultado e sha256)
//   MEDIDA_ASSINATURA_PERFIL a imagem da assinatura do supervisor (chave = login)
//   MEDIDA_VIA               um link da via (chave = SHA-256 do código: o código em si nunca é guardado)
//   MEDIDA_VIA_ABERTA / MEDIDA_VIA_FALHA / MEDIDA_VIA_ENVIO   cada abertura, cada confirmação errada, cada SMS ou e-mail

const crypto = require("crypto");
const MD = require("./_medida_regras");
const DOC = require("./_medida_doc");

const ACAO_COLETA = "MEDIDA_COLETA";
const ACAO_PERFIL = "MEDIDA_ASSINATURA_PERFIL";
const ACAO_VIA = "MEDIDA_VIA";
const ACAO_VIA_ABERTA = "MEDIDA_VIA_ABERTA";
const ACAO_VIA_FALHA = "MEDIDA_VIA_FALHA";
const ACAO_VIA_ENVIO = "MEDIDA_VIA_ENVIO";

const MAX_PNG = 80 * 1024;          // a assinatura é um traço fino: poucos KB; acima disso não é assinatura
const MIN_PNG = 300;                // tela em branco comprime para quase nada
const MAX_TESTEMUNHAS = 4;
const VIA_QR_MS = 15 * 60000;       // o QR vale só enquanto o supervisor está do lado
const VIA_LINK_MS = 30 * 24 * 3600000; // SMS e e-mail: 30 dias
const MAX_TENTATIVAS = 5;           // confirmações erradas por link, nas últimas 24 h
const IDEM_OK = /^[A-Za-z0-9_-]{16,64}$/;
const CHAVE_OK = /^[0-9a-f]{16}$/;

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const hashCodigo = codigo => sha256(String(codigo || ""));

// ── assinatura desenhada ────────────────────────────────────────────────────
// A tela manda a imagem (PNG) e as medidas do traço. O servidor confere o que dá para conferir: formato, tamanho,
// dimensões e um traço mínimo. Não há como provar que o traço é "de verdade": a prova é a trilha de evidências.
function lerPng(url) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(url || ""));
  if (!m) return { erro: ["A assinatura precisa ser uma imagem PNG.", "ASSINATURA_INVALIDA"] };
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_PNG) return { erro: ["A imagem da assinatura ficou grande demais.", "ASSINATURA_GRANDE"] };
  if (buf.length < MIN_PNG || buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { erro: ["A assinatura está em branco ou inválida.", "ASSINATURA_VAZIA"] };
  }
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w < 120 || w > 1600 || h < 40 || h > 800) return { erro: ["Tamanho de assinatura inválido.", "ASSINATURA_INVALIDA"] };
  return { buf, w, h };
}
function conferirTraco(t) {
  t = t || {};
  const n = x => Number(x);
  if (!(n(t.pontos) >= 12) || !(n(t.larg) >= 60) || !(n(t.alt) >= 8)) return ["Assine com o dedo: o traço ficou curto demais.", "TRACO_CURTO"];
  return null;
}
function assinaturaDe(corpo) {
  const p = lerPng(corpo && corpo.png);
  if (p.erro) return p;
  const e = conferirTraco(corpo.metricas);
  return e ? { erro: e } : p;
}

// ── assinatura do supervisor guardada no perfil ─────────────────────────────
async function lerPerfil(db, login) {
  const [e] = await db.obter(`fm_auditoria?select=id,criado_em,depois&acao=eq.${ACAO_PERFIL}&chave=eq.${encodeURIComponent(login)}&order=id.desc&limit=1`);
  const d = e && e.depois;
  return d && d.png && !d.removida ? { png: d.png, em: e.criado_em } : null;
}
async function verPerfil({ res, db, ator }) {
  const p = await lerPerfil(db, ator);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ ok: true, tem: !!p, png: p ? p.png : null, em: p ? p.em : null });
}
async function salvarPerfil({ res, db, ator, body }) {
  if (body.remover === true) {
    await db.inserir("fm_auditoria", [{ ator, acao: ACAO_PERFIL, entidade: MD.ENTIDADE, chave: ator, antes: null, depois: { removida: true } }]);
    return res.status(200).json({ ok: true, tem: false });
  }
  const s = assinaturaDe(body);
  if (s.erro) return erro(res, 400, s.erro[0], s.erro[1]);
  await db.inserir("fm_auditoria", [{ ator, acao: ACAO_PERFIL, entidade: MD.ENTIDADE, chave: ator, antes: null, depois: { png: String(body.png) } }]);
  return res.status(200).json({ ok: true, tem: true });
}

// ── PDF ─────────────────────────────────────────────────────────────────────
const SP = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const fmtSP = ms => SP.format(new Date(ms)).replace(",", " às");
const soData = ms => SP.format(new Date(ms)).slice(0, 10);

// Só entra no PDF o que a fonte padrão sabe desenhar (letras com acento do português valem); o resto vira "?".
function limpa(font, s) {
  let out = "";
  for (const ch of String(s == null ? "" : s).replace(/[\t ]/g, " ").replace(/[\r\n]+/g, " ")) {
    try { font.encodeText(ch); out += ch; } catch (e) { out += "?"; }
  }
  return out;
}
function quebrar(font, size, texto, larg) {
  const linhas = [];
  for (const par of String(texto == null ? "" : texto).split(/\r?\n/)) {
    let linha = "";
    for (let w of par.split(/\s+/).filter(Boolean)) {
      while (font.widthOfTextAtSize(w, size) > larg) { // palavra maior que a linha (um e-mail, uma sequência): quebra por letra
        let i = 1;
        while (i < w.length && font.widthOfTextAtSize(w.slice(0, i + 1), size) <= larg) i++;
        if (linha) { linhas.push(linha); linha = ""; }
        linhas.push(w.slice(0, i)); w = w.slice(i);
      }
      const t = linha ? linha + " " + w : w;
      if (font.widthOfTextAtSize(t, size) <= larg) linha = t;
      else { linhas.push(linha); linha = w; }
    }
    linhas.push(linha);
  }
  return linhas;
}

// o: { c (conteúdo de _medida_doc), numero, geradoPor, geradoEm, re, nome, resultado: "ASSINADA"|"RECUSADA", em (ms),
//      supervisor: { nome, login, png }, colaborador: { png }|null, recusa: { testemunhas }|null,
//      evid: { ip, aparelho, textoSha, perfil } }
async function montarPdf(o) {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle((o.numero || "Medida disciplinar") + " — " + o.nome);
  pdf.setAuthor("Painel ServCamp");
  pdf.setProducer("Painel ServCamp");
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold), I = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await pdf.embedPng(Buffer.from(require("./_faltas_email_logo"), "base64"));
  const PRETO = rgb(0.07, 0.07, 0.07), CINZA = rgb(0.38, 0.4, 0.45);
  const W = 595.28, H = 841.89, M = 60, LARG = W - 2 * M, RODAPE = 70;
  const paginas = [];
  let pg, y;
  const nova = () => { pg = pdf.addPage([W, H]); paginas.push(pg); y = H - 52; };
  const garante = h => { if (y - h < RODAPE) nova(); };
  const texto = (s, x, y0, font, size, cor) => pg.drawText(limpa(font, s), { x, y: y0, font, size, color: cor || PRETO });
  const centro = (s, font, size, cor) => { const t = limpa(font, s); texto(t, (W - font.widthOfTextAtSize(t, size)) / 2, y, font, size, cor); y -= size * 1.5; };
  const paragrafo = (s, font, size, opt) => {
    opt = opt || {};
    for (const l of quebrar(font, size, limpa(font, s), LARG)) {
      garante(size * 1.55);
      texto(l, M, y, font, size);
      if (opt.sublinhado && l) pg.drawLine({ start: { x: M, y: y - 1.5 }, end: { x: M + font.widthOfTextAtSize(l, size), y: y - 1.5 }, thickness: 0.7, color: PRETO });
      y -= size * 1.55;
    }
    y -= opt.depois == null ? 8 : opt.depois;
  };

  nova();
  const lw = 36, lh = lw * logo.height / logo.width;
  pg.drawImage(logo, { x: (W - lw) / 2, y: y - lh + 12, width: lw, height: lh });
  y -= lh + 6;
  centro("GRUPO SERVCAMP · terceirizações", B, 9, CINZA);
  y -= 2;
  centro(o.c.empresa || "", B, 12);
  y -= 8;
  centro(o.c.titulo, B, 12);
  y -= 10;
  paragrafo(o.c.re, B, 11, { depois: 10 });
  paragrafo(o.c.abre, F, 11);
  paragrafo(o.c.motivoTitulo, B, 11, { sublinhado: true, depois: 4 });
  paragrafo(o.c.motivo, B, 11, { sublinhado: true, depois: 12 });
  paragrafo(o.c.fecho, F, 11, { depois: 14 });
  garante(24);
  texto(o.c.local, M, y, F, 11);
  const at = limpa(F, o.c.atenciosamente);
  texto(at, W - M - F.widthOfTextAtSize(at, 11), y, F, 11);
  y -= 30;

  // assinaturas
  const BLOCO = 150;
  garante(BLOCO + (o.recusa ? 90 : 0));
  const meio = M + LARG / 2 + 10, colW = LARG / 2 - 24;
  const imagem = async (buf, x, larguraMax) => {
    const img = await pdf.embedPng(buf);
    const esc = Math.min(larguraMax / img.width, 62 / img.height, 1);
    pg.drawImage(img, { x, y: y - 64 + (62 - img.height * esc) / 2 + 8, width: img.width * esc, height: img.height * esc });
  };
  texto(o.resultado === "RECUSADA" ? "RECUSOU-SE A ASSINAR: " + soData(o.em) : "CIENTE: " + soData(o.em), M, y, F, 10);
  if (o.colaborador && o.colaborador.png) await imagem(o.colaborador.png, M, colW);
  if (o.supervisor.png) await imagem(o.supervisor.png, meio, colW);
  y -= 74;
  pg.drawLine({ start: { x: M, y }, end: { x: M + colW, y }, thickness: 0.7, color: PRETO });
  pg.drawLine({ start: { x: meio, y }, end: { x: meio + colW, y }, thickness: 0.7, color: PRETO });
  y -= 12;
  texto("Assinatura do Colaborador", M, y, F, 9.5);
  texto("ASSINATURA DO EMPREGADOR", meio, y, F, 9.5);
  y -= 12;
  texto(String(o.nome || "").toUpperCase().slice(0, 44), M, y, F, 8.5, CINZA);
  texto(`${o.supervisor.nome} · ${fmtSP(o.em)}`.slice(0, 60), meio, y, F, 8.5, CINZA);
  y -= 22;
  if (o.recusa) {
    const ts = o.recusa.testemunhas || [];
    texto(ts.length ? "O colaborador recusou-se a assinar. Testemunhas:" : "O colaborador recusou-se a assinar.", M, y, B, 10);
    y -= 16;
    for (const t of ts) { garante(30); texto(`Nome: ${t.nome}${t.doc ? "    Doc.: " + t.doc : ""}`, M, y, F, 10); y -= 15; }
    if (o.recusa.observacao) { y -= 4; paragrafo("Observação: " + o.recusa.observacao, I, 9.5, { depois: 4 }); }
  }

  // página de evidências: o documento se explica sozinho, mesmo impresso depois
  nova();
  centro("Página de evidências da assinatura eletrônica", B, 13);
  y -= 6;
  paragrafo("Este documento foi " + (o.resultado === "RECUSADA" ? "registrado com a recusa do colaborador em assinar" : "assinado eletronicamente") + " no Painel ServCamp. Os dados abaixo foram gravados pelo servidor no momento da coleta.", F, 10, { depois: 10 });
  const linha = (rot, valor) => {
    const ls = quebrar(F, 10, limpa(F, valor), LARG - 130);
    garante(ls.length * 14 + 6);
    texto(rot, M, y, B, 9.5, CINZA);
    ls.forEach(l => { texto(l, M + 130, y, F, 10); y -= 14; });
    y -= 4;
  };
  linha("Documento", `${o.numero} · ${o.c.titulo}`);
  linha("Colaborador", `RE ${o.re} · ${o.nome}`);
  linha("Resultado", o.resultado === "RECUSADA" ? "Colaborador recusou-se a assinar" : "Assinado pelo colaborador, que marcou “Li e estou ciente”");
  linha("Data e hora (servidor)", `${fmtSP(o.em)} (horário de Brasília) · ${new Date(o.em).toISOString()} (UTC)`);
  linha("Coletado por", `${o.supervisor.nome} (login ${o.supervisor.login})`);
  linha("Assinatura do supervisor", o.evid.perfil ? "Imagem guardada no perfil do supervisor, aplicada com um toque" : "Desenhada na hora, na tela do celular");
  if (o.resultado !== "RECUSADA") linha("Assinatura do colaborador", "Nome escrito pelo colaborador com o dedo, na tela, depois de ler o documento inteiro");
  else linha("Testemunhas", (o.recusa && o.recusa.testemunhas && o.recusa.testemunhas.length) ? o.recusa.testemunhas.map(t => t.nome + (t.doc ? " (doc. " + t.doc + ")" : "")).join("; ") : "Nenhuma informada");
  linha("Endereço de rede (IP)", o.evid.ip || "não informado");
  linha("Aparelho e navegador", o.evid.aparelho || "não informado");
  linha("Texto lido e aceito", `SHA-256 do texto do documento: ${o.evid.textoSha}`);
  linha("Gerado por", `${o.geradoPor} em ${o.geradoEm}`);
  y -= 6;
  paragrafo("O hash SHA-256 deste arquivo é calculado e registrado no sistema no instante em que ele é gerado e acompanha a via entregue ao colaborador. Ele não pode constar dentro do próprio arquivo. Assinatura eletrônica simples, com a trilha de evidências acima.", I, 9, { depois: 0 });

  paginas.forEach((p, i) => {
    const t = limpa(F, `Painel ServCamp · documento ${o.numero} · página ${i + 1} de ${paginas.length}`);
    p.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    p.drawText(t, { x: M, y: 34, font: F, size: 8.5, color: CINZA });
  });
  return Buffer.from(await pdf.save());
}

// ── coletar (assinar ou recusar) ────────────────────────────────────────────
const quemColeta = login => MD.NOMES[login] || login;
function limparTestemunhas(lista) {
  const t = (Array.isArray(lista) ? lista : []).slice(0, MAX_TESTEMUNHAS)
    .map(x => ({ nome: String((x && x.nome) || "").trim().slice(0, 80), doc: String((x && x.doc) || "").trim().slice(0, 40) }))
    .filter(x => x.nome || x.doc);
  return t;
}
const ipDe = req => String(((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "")).split(",")[0].trim().slice(0, 64);
const aparelhoDe = req => String((req.headers && req.headers["user-agent"]) || "").slice(0, 200);

// ctx: { req, res, db, ator, body, ler (lerGeradas), visivel (visivelPara) }
async function coletar(ctx) {
  const { req, res, db, ator, body } = ctx;
  const chave = String(body.chave || "").trim();
  if (!CHAVE_OK.test(chave)) return erro(res, 400, "Medida inválida.", "CHAVE_INVALIDA");
  const idem = String(body.idem || "");
  if (!IDEM_OK.test(idem)) return erro(res, 400, "Coleta sem chave de segurança. Atualize a tela e tente de novo.", "SEM_IDEM");
  const g = (await ctx.ler(db)).find(x => x.chave === chave);
  if (!g) return erro(res, 404, "Medida não encontrada.", "NAO_ENCONTRADA");
  if (!ctx.visivel(ator, g)) return erro(res, 403, "Esta medida é de outra área.", "NAO_AUTORIZADO");
  if (g.status === "CANCELADA") return erro(res, 409, "Esta medida foi cancelada.", "CANCELADA");
  if (g.assinado && !g.assinado.digital) return erro(res, 409, "Esta medida já tem o documento assinado em papel anexado.", "JA_ASSINADA_EM_PAPEL");

  const recusou = !!body.recusa;
  if (recusou === !!body.colaborador) return erro(res, 400, "Informe a assinatura do colaborador ou a recusa.", "DADOS_INVALIDOS");
  let col = null, recusa = null;
  if (recusou) {
    // testemunhas não são obrigatórias (pedido do Raphael, 03/11/2026): até duas; quem for informada precisa ter o nome
    const t = limparTestemunhas(body.recusa.testemunhas);
    if (t.length > 2) return erro(res, 400, "Informe no máximo duas testemunhas.", "TESTEMUNHAS_DEMAIS");
    if (t.some(x => !x.nome)) return erro(res, 400, "Informe o nome da testemunha (o documento é opcional).", "TESTEMUNHA_SEM_NOME");
    recusa = { testemunhas: t, observacao: String(body.recusa.observacao || "").trim().slice(0, 300) };
  } else {
    if (body.colaborador.aceite !== true) return erro(res, 400, "O colaborador precisa marcar que leu o documento.", "SEM_ACEITE");
    col = assinaturaDe(body.colaborador);
    if (col.erro) return erro(res, 400, col.erro[0], col.erro[1]);
  }
  let sup, doPerfil = false;
  if (body.supervisor && body.supervisor.usarPerfil === true) {
    const p = await lerPerfil(db, ator);
    if (!p) return erro(res, 409, "Você ainda não guardou sua assinatura no perfil. Desenhe-a agora.", "SEM_ASSINATURA_PERFIL");
    sup = assinaturaDe({ png: p.png, metricas: { pontos: 99, larg: 99, alt: 99 } });
    doPerfil = true;
  } else sup = assinaturaDe(body.supervisor);
  if (sup.erro) return erro(res, 400, sup.erro[0], sup.erro[1]);

  // A mesma coleta pode chegar duas vezes (sinal ruim, toque duplo): a chave "idem" garante uma só.
  const lerColetas = () => db.listar(`fm_auditoria?select=id,ator,criado_em,depois&acao=eq.${ACAO_COLETA}&chave=eq.${chave}&order=id.asc`);
  let coletas = await lerColetas();
  if (coletas.length && (coletas[0].depois || {}).idem !== idem) return erro(res, 409, "Esta medida já teve uma coleta de assinatura.", "JA_COLETADA");
  const em = Date.now();
  if (!coletas.length) {
    const d = DOC.conteudo(docDaGerada(g));
    const textoSha = sha256(JSON.stringify(d));
    await db.inserir("fm_auditoria", [{
      ator, acao: ACAO_COLETA, entidade: MD.ENTIDADE, chave, antes: null,
      depois: { idem, resultado: recusou ? "RECUSADA" : "ASSINADA", em, ip: ipDe(req), aparelho: aparelhoDe(req), textoSha, doPerfil, testemunhas: recusa ? recusa.testemunhas : null, aceite: recusou ? null : "Li e estou ciente" }
    }]);
    coletas = await lerColetas();
    if ((coletas[0].depois || {}).idem !== idem) return erro(res, 409, "Esta medida já teve uma coleta de assinatura.", "JA_COLETADA"); // outra chamada chegou antes
  }
  const coleta = coletas[0], cd = coleta.depois;

  // o PDF sai uma vez por coleta; um reenvio da mesma chave devolve o que já existe
  let sha;
  const [atual] = await db.obter(`fm_auditoria?select=id,coleta:depois->>coleta,sha256:depois->>sha256&acao=eq.${MD.ACAO_ASSINADA}&chave=eq.${chave}&order=id.desc&limit=1`);
  if (!(atual && String(atual.coleta) === String(coleta.id))) {
    const d = DOC.conteudo(docDaGerada(g));
    const pdf = await montarPdf({
      c: d, numero: g.numero, geradoPor: quemColeta(g.geradaPor), geradoEm: fmtSP(Date.parse(g.geradaEm)), re: g.re, nome: g.nome,
      resultado: cd.resultado, em: cd.em, supervisor: { nome: quemColeta(coleta.ator), login: coleta.ator, png: sup.buf },
      colaborador: col ? { png: col.buf } : null, recusa,
      evid: { ip: cd.ip, aparelho: cd.aparelho, textoSha: cd.textoSha, perfil: cd.doPerfil }
    });
    sha = sha256(pdf);
    await db.inserir("fm_auditoria", [{
      ator, acao: MD.ACAO_ASSINADA, entidade: MD.ENTIDADE, chave, antes: null,
      depois: { tipo: "application/pdf", base64: pdf.toString("base64"), bytes: pdf.length, nome: `${g.numero}-assinada.pdf`, digital: true, resultado: cd.resultado, sha256: sha, coleta: coleta.id }
    }]);
    if (!doPerfil && body.supervisor && body.supervisor.guardar === true) {
      await db.inserir("fm_auditoria", [{ ator, acao: ACAO_PERFIL, entidade: MD.ENTIDADE, chave: ator, antes: null, depois: { png: String(body.supervisor.png) } }]);
    }
  } else sha = atual.sha256;

  const nova = (await ctx.ler(db)).find(x => x.chave === chave);
  const via = await criarVia(db, req, ator, chave, "QR");
  return res.status(200).json({ ok: true, resultado: cd.resultado, sha256: sha, medida: nova, via: via.ok ? { url: via.url, expiraEm: via.expiraEm } : null, viaErro: via.ok ? null : via.erro });
}

// os dados que o docHtml usa, a partir da medida gerada (a mesma conversão de docDaGerada em medida.js)
function docDaGerada(g) {
  const sp = new Date(Date.parse(g.geradaEm) - 3 * 3600000).toISOString();
  return { empresa: g.empresa, re: g.re, nome: g.nome, tipoId: g.tipoId, dias: g.dias, inicio: g.inicio, motivo: g.motivo, docData: sp.slice(0, 10), numero: g.numero, geradoPor: g.geradaPor, geradoEm: sp };
}

// ── a via: o link para o colaborador baixar o PDF ───────────────────────────
const LINK_OK = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;
async function baseDoPainel(db, req) {
  const env = String(process.env.PAINEL_URL || "").trim().replace(/\/+$/, "");
  if (LINK_OK.test(env)) return env;
  try { const v = await require("./_faltas_email").lerLink(db); if (v) return v; } catch (e) { /* cai para o endereço da chamada */ }
  const h = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim().toLowerCase();
  const u = "https://" + h;
  return h && LINK_OK.test(u) && !/localhost|127\.0\.0\.1/.test(h) ? u : null;
}
// tipo QR: 15 min, sem confirmação (o supervisor está do lado). tipo LINK: 30 dias, com confirmação.
async function criarVia(db, req, ator, chave, tipo, extra) {
  const base = await baseDoPainel(db, req);
  if (!base) return { ok: false, erro: "Não sei o endereço do painel para montar o link. Abra o painel do aviso semanal uma vez ou defina PAINEL_URL." };
  const codigo = crypto.randomBytes(24).toString("base64url");
  const expiraEm = Date.now() + (tipo === "QR" ? VIA_QR_MS : VIA_LINK_MS);
  await db.inserir("fm_auditoria", [{ ator, acao: ACAO_VIA, entidade: MD.ENTIDADE, chave: hashCodigo(codigo), antes: null, depois: { medida: chave, tipo, expiraEm, ...(extra || {}) } }]);
  return { ok: true, url: `${base}/via.html#${codigo}`, expiraEm, codigo };
}

const mascara = tel => { const d = String(tel || "").replace(/\D/g, ""); return d.length >= 4 ? "(**) *****-" + d.slice(-4) : ""; };
async function contatoDe(db, re) {
  const [c] = await db.obter(`pt_contatos?select=re,telefone_e164,enviavel&re=eq.${encodeURIComponent(String(re))}&limit=1`);
  return c && c.enviavel === true && c.telefone_e164 ? c : null;
}

// ctx: { req, res, db, ator, body, ler, visivel }
async function medidaDoPedido(ctx) {
  const chave = String(ctx.body.chave || (ctx.req.query && ctx.req.query.chave) || "").trim();
  if (!CHAVE_OK.test(chave)) return { erro: erro(ctx.res, 400, "Medida inválida.", "CHAVE_INVALIDA") };
  const g = (await ctx.ler(ctx.db)).find(x => x.chave === chave);
  if (!g || !ctx.visivel(ctx.ator, g)) return { erro: erro(ctx.res, 404, "Medida não encontrada.", "NAO_ENCONTRADA") };
  if (g.status === "CANCELADA") return { erro: erro(ctx.res, 409, "Esta medida foi cancelada.", "CANCELADA") };
  if (!g.assinado || !g.assinado.digital) return { erro: erro(ctx.res, 409, "Esta medida ainda não foi assinada no celular.", "SEM_PDF_DIGITAL") };
  return { chave, g };
}
// Quais vias dá para enviar: o celular cadastrado (se o cadastro o marcou como enviável) e se o SMS está ligado.
async function verContato(ctx) {
  const m = await medidaDoPedido(ctx);
  if (m.erro) return;
  const c = await contatoDe(ctx.db, m.g.re);
  const sms = require("./_sms").provedorSMS();
  ctx.res.setHeader("Cache-Control", "private, no-store");
  return ctx.res.status(200).json({ ok: true, sms: { celular: !!c, mascara: c ? mascara(c.telefone_e164) : "", ligado: !!(sms && sms.configurado) } });
}
// canal "qr": um QR novo de 15 min. "sms": link de 30 dias para o celular cadastrado. "email": link de 30 dias para o e-mail informado.
async function enviarVia(ctx) {
  const { req, res, db, ator, body } = ctx;
  const m = await medidaDoPedido(ctx);
  if (m.erro) return;
  const canal = String(body.canal || "");
  if (canal === "qr") {
    const v = await criarVia(db, req, ator, m.chave, "QR");
    if (!v.ok) return erro(res, 409, v.erro, "SEM_ENDERECO");
    return res.status(200).json({ ok: true, via: { url: v.url, expiraEm: v.expiraEm } });
  }
  const registrar = (status, extra) => db.inserir("fm_auditoria", [{ ator, acao: ACAO_VIA_ENVIO, entidade: MD.ENTIDADE, chave: m.chave, antes: null, depois: { canal, status, ...(extra || {}) } }]);
  if (canal === "sms") {
    const c = await contatoDe(db, m.g.re);
    if (!c) return erro(res, 409, "Não há celular cadastrado e liberado para este colaborador. Use o QR code.", "SEM_CELULAR");
    const prov = require("./_sms").provedorSMS();
    if (!prov || !prov.configurado) return erro(res, 409, "O envio de SMS está desligado. Use o QR code.", "SMS_DESLIGADO");
    const v = await criarVia(db, req, ator, m.chave, "LINK", { canal: "sms" });
    if (!v.ok) return erro(res, 409, v.erro, "SEM_ENDERECO");
    const r = await prov.enviar(c.telefone_e164, `ServCamp: seu documento ${m.g.numero} está disponível: ${v.url} Para abrir, informe seu RE e os 4 últimos dígitos deste celular. Vale por 30 dias.`);
    await registrar(r && r.ok ? "ENVIADO" : "FALHOU", { destino: mascara(c.telefone_e164), id: (r && r.id) || null, erro: r && !r.ok ? String(r.mensagem || r.codigo || "").slice(0, 160) : null });
    if (!r || !r.ok) return erro(res, 502, "O SMS não foi enviado. Use o QR code.", "SMS_FALHOU");
    return res.status(200).json({ ok: true, canal, destino: mascara(c.telefone_e164) });
  }
  if (canal === "email") {
    const para = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s<>"',;:()[\]\\]+@[^@\s<>"',;:()[\]\\]+\.[^@\s<>"',;:()[\]\\]+$/.test(para) || para.length > 120) return erro(res, 400, "E-mail inválido.", "EMAIL_INVALIDO");
    const v = await criarVia(db, req, ator, m.chave, "LINK", { canal: "email" });
    if (!v.ok) return erro(res, 409, v.erro, "SEM_ENDERECO");
    const FE = require("./_faltas_email");
    const r = await FE.enviarAvulso(db, {
      para, assunto: `Seu documento ${m.g.numero} — Grupo ServCamp`,
      texto: `Seu documento ${m.g.numero} está disponível para baixar: ${v.url}\n\nPara abrir, informe seu RE e os 4 últimos dígitos do celular cadastrado. O link vale por 30 dias.`,
      html: `<p>Seu documento <b>${m.g.numero}</b> está disponível para baixar:</p><p><a href="${v.url}">Baixar meu documento</a></p><p>Para abrir, informe seu RE e os 4 últimos dígitos do celular cadastrado. O link vale por 30 dias.</p>`
    });
    await registrar(r.ok ? "ENVIADO" : "FALHOU", { destino: para.replace(/^(.).*(@.*)$/, "$1***$2"), erro: r.ok ? null : r.erro });
    if (!r.ok) return erro(res, 502, "O e-mail não foi enviado. Use o QR code.", "EMAIL_FALHOU");
    return res.status(200).json({ ok: true, canal });
  }
  return erro(res, 400, "Canal inválido (qr, sms ou email).", "CANAL_INVALIDO");
}

module.exports = {
  ACAO_COLETA, ACAO_PERFIL, ACAO_VIA, ACAO_VIA_ABERTA, ACAO_VIA_FALHA, ACAO_VIA_ENVIO, VIA_QR_MS, VIA_LINK_MS, MAX_TENTATIVAS,
  sha256, hashCodigo, lerPng, conferirTraco, assinaturaDe, montarPdf, docDaGerada, mascara, contatoDe, criarVia, baseDoPainel,
  verPerfil, salvarPerfil, coletar, verContato, enviarVia
};
