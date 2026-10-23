// api/_faltas_email_html.js — o e-mail do aviso semanal de faltas injustificadas.
//
// Só monta texto (puro, testado em test/faltas_email.test.js): quem decide o que
// entra e para quem vai é o api/_faltas_email.js. Visual aprovado pelo Raphael em
// 23/10/2026: cartão com cabeçalho azul-marinho, a mensagem ao supervisor como
// texto normal do e-mail (fora do cartão) e uma linha por colaborador, com todas
// as datas de falta dele na semana.
//
// Feito para o Outlook: tabelas, estilos na própria tag e cores sólidas por trás
// de cada degradê. O celular vira um cartão por colaborador (o <style> do topo).

const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const AZUL = "#1f6fc5", MARINHO = "#13243a", CINZA = "#5a6b80", CLARO = "#7a8aa0", LINHA = "#e6ecf3", ZEBRA = "#f5f8fc";
const FONTE = "'Segoe UI',Arial,sans-serif";

const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const iso = d => String(d || "").slice(0, 10);
const ddmm = d => { const s = iso(d); return s.slice(8, 10) + "/" + s.slice(5, 7); };
const ddmmaaaa = d => { const s = iso(d); return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4); };
const diaDaSemana = d => DIA[new Date(iso(d) + "T12:00:00Z").getUTCDay()];
const somaDias = (d, n) => { const x = new Date(iso(d) + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ehSemanaCheia = (ini, fim) => new Date(iso(ini) + "T12:00:00Z").getUTCDay() === 1 && somaDias(ini, 6) === iso(fim);

// "COND. RESIDENCIAL JARDIM DAS FLORES" → "Cond. Residencial Jardim das Flores".
// Sigla sem vogal ou com número fica como veio: RT, SDF, 12X36.
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos"]);
function titulo(s) {
  return String(s == null ? "" : s).trim().toLowerCase().split(/(\s+)/).map((p, i) => {
    if (!p || /^\s+$/.test(p)) return p;
    if (/\d/.test(p) || !/[aeiouáéíóúâêôãõàü]/.test(p)) return p.toUpperCase();
    if (i > 0 && MINUSCULAS.has(p)) return p;
    const k = p.search(/[a-zà-ü]/);
    return p.slice(0, k) + p.charAt(k).toUpperCase() + p.slice(k + 1);
  }).join("");
}

// "19/10 a 25/10/2026"; virando o ano, as duas datas completas.
function periodoCurto(ini, fim) {
  return iso(ini).slice(0, 4) === iso(fim).slice(0, 4) ? ddmm(ini) + " a " + ddmmaaaa(fim) : ddmmaaaa(ini) + " a " + ddmmaaaa(fim);
}

const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);

// ── pedaços do cartão ────────────────────────────────────────────────────────
function cabecalho(o) {
  const rotulo = o.teste ? "Envio de teste" : "Aviso semanal";
  const direita = `<div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:2px;color:#7fb3f5;text-transform:uppercase">${rotulo}</div>` +
    `<div style="font-size:13px;line-height:20px;font-weight:600;color:#ffffff;padding-top:3px;white-space:nowrap">${esc(periodoCurto(o.inicio, o.fim))}</div>`;
  return `<tr><td bgcolor="#0d1f35" class="px" style="background:#0d1f35;background-image:linear-gradient(180deg,#14304f 0%,#0b1a2e 100%);border-radius:18px 18px 0 0;padding:26px 30px">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td width="78" valign="middle" style="width:78px">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
        <td bgcolor="#ffffff" align="center" valign="middle" width="76" height="76" style="width:76px;height:76px;background:#ffffff;border-radius:16px">
          <img src="${esc(o.logo)}" width="38" height="53" alt="Grupo ServCamp" style="display:block;width:38px;height:53px;margin:0 auto;border:0">
        </td>
      </tr></table>
    </td>
    <td valign="middle" style="padding-left:18px;font-family:${FONTE}">
      <div style="font-size:15px;line-height:20px;font-weight:700;letter-spacing:3px;color:#ffffff;text-transform:uppercase">Grupo ServCamp</div>
      <div style="font-size:13px;line-height:20px;color:#9fb6d3;padding-top:2px">Gestão Operacional</div>
    </td>
    <td align="right" valign="middle" class="hide-sm" style="font-family:${FONTE}">${direita}</td>
  </tr></table>
  <!--[if !mso]><!--><div class="only-sm" style="display:none;max-height:0;overflow:hidden;font-family:${FONTE}">${direita}</div><!--<![endif]-->
</td></tr>
<tr><td height="4" bgcolor="${AZUL}" style="height:4px;line-height:4px;font-size:0;background:${AZUL}">&nbsp;</td></tr>`;
}

function tituloArea(o) {
  const sub = "Período de " + ddmmaaaa(o.inicio) + " a " + ddmmaaaa(o.fim) + (ehSemanaCheia(o.inicio, o.fim) ? " · segunda a domingo" : "");
  return `<tr><td class="px" style="padding:34px 40px 0;font-family:${FONTE}">
  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:2.5px;color:${AZUL};text-transform:uppercase">Faltas injustificadas</div>
  <div class="h1" style="font-size:28px;line-height:34px;font-weight:700;color:${MARINHO};padding-top:6px">Área ${esc(o.area)}</div>
  <div style="font-size:14px;line-height:22px;color:${CINZA};padding-top:4px">${esc(sub)}</div>
</td></tr>`;
}

function numeros(o, faltas, pessoas) {
  const caixa = (rot, val, extra, borda) => `<td class="k" width="${extra}" style="padding:18px 22px;${borda ? "border-left:1px solid #e3eaf3;" : ""}font-family:${FONTE}">
      <div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:1.5px;color:#6b7e96;text-transform:uppercase">${rot}</div>
      ${val}
    </td>`;
  return `<tr><td class="px" style="padding:22px 40px 0">
  <table role="presentation" class="kpi" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f4f7fb" style="background:#f4f7fb;border:1px solid #e3eaf3;border-left:4px solid ${AZUL};border-radius:12px"><tr>
    ${caixa("Ocorrências", `<div style="font-size:26px;line-height:32px;font-weight:700;color:${MARINHO};padding-top:4px">${faltas}</div>`, "33%", false)}
    ${caixa("Colaboradores", `<div style="font-size:26px;line-height:32px;font-weight:700;color:${MARINHO};padding-top:4px">${pessoas}</div>`, "33%", true)}
    ${caixa("Período", `<div class="kv" style="font-size:18px;line-height:32px;font-weight:700;color:${MARINHO};padding-top:4px;white-space:nowrap">${esc(ddmm(o.inicio))} – ${esc(ddmm(o.fim))}</div>`, "34%", true)}
  </tr></table>
</td></tr>`;
}

function tabela(linhas) {
  const th = (rot, w, alin, raio, pad) => `<th align="${alin}" width="${w}" bgcolor="#14304f" style="background:#14304f;${raio ? "border-radius:" + raio + ";" : ""}padding:14px ${pad};font-size:10px;line-height:14px;font-weight:700;letter-spacing:.8px;color:#ffffff;text-transform:uppercase;font-family:${FONTE}">${rot}</th>`;
  const lbl = t => `<span class="lbl" style="display:none">${t}</span>`;
  const corpo = linhas.map((l, i) => {
    const z = i % 2 === 1, fundo = z ? ` bgcolor="${ZEBRA}"` : "", bg = z ? `background:${ZEBRA};` : "";
    const td = (cls, extra, estilo, html) => `<td${cls ? ` class="${cls}"` : ""}${extra}${fundo} valign="top" style="${bg}${estilo};font-family:${FONTE}">${html}</td>`;
    const qtd = l.datas.length;
    const datas = l.datas.map(d => `<div style="white-space:nowrap">${esc(ddmmaaaa(d))} <span style="font-size:11px;font-weight:400;color:${CLARO}">· ${diaDaSemana(d)}</span></div>`).join("");
    return `<tr>
      ${td("nome", "", `padding:16px 12px;border-left:1px solid ${LINHA};border-bottom:1px solid ${LINHA};font-weight:700;color:${MARINHO}`, esc(l.nome) + (qtd > 1 ? `<div style="font-size:11px;line-height:16px;font-weight:700;color:${AZUL};padding-top:3px">${qtd} faltas na semana</div>` : ""))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA};white-space:nowrap`, lbl("RE") + esc(l.re))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA}`, lbl("Posto") + esc(l.posto))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA}`, lbl("Cargo") + esc(l.cargo))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA};white-space:nowrap`, lbl("Escala") + esc(l.escala))}
      ${td("ult", ` align="right"`, `padding:16px 12px;border-right:1px solid ${LINHA};border-bottom:1px solid ${LINHA};font-weight:700;color:${MARINHO};line-height:21px`, lbl(qtd > 1 ? "Datas" : "Data") + datas)}
    </tr>`;
  }).join("\n");
  return `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${CINZA};text-transform:uppercase;padding-bottom:12px;font-family:${FONTE}">Ocorrências do período</td>
    <td align="right" class="hide-sm" style="font-size:12px;line-height:14px;color:#6b7e96;padding-bottom:12px;font-family:${FONTE}">Ordenadas pela primeira falta</td>
  </tr></table>
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate">
    <thead><tr>
      ${th("Colaborador", "24%", "left", "10px 0 0 0", "12px")}${th("RE", "9%", "left", "", "6px")}${th("Posto", "26%", "left", "", "6px")}${th("Cargo", "16%", "left", "", "6px")}${th("Escala", "8%", "left", "", "6px")}${th("Datas", "17%", "right", "0 10px 0 0", "12px")}
    </tr></thead>
    <tbody style="font-size:12.5px;line-height:19px;color:#3a4a5e">
${corpo}
    </tbody>
  </table>
</td></tr>`;
}

function semOcorrencia(o) {
  return `<tr><td class="px" style="padding:22px 40px 0">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f4f7fb" style="background:#f4f7fb;border:1px solid #e3eaf3;border-left:4px solid ${AZUL};border-radius:12px"><tr>
    <td width="52" valign="middle" style="padding:20px 0 20px 22px;width:52px">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
        <td bgcolor="${AZUL}" align="center" valign="middle" width="32" height="32" style="width:32px;height:32px;background:${AZUL};border-radius:16px;color:#ffffff;font-size:16px;line-height:32px;font-weight:700;font-family:${FONTE}">&#10003;</td>
      </tr></table>
    </td>
    <td valign="middle" style="padding:20px 22px 20px 14px;font-family:${FONTE}">
      <div style="font-size:16px;line-height:22px;font-weight:700;color:${MARINHO}">Nenhuma ocorrência no período</div>
      <div style="font-size:13px;line-height:20px;color:${CINZA};padding-top:3px">Não foram identificadas faltas injustificadas na área de ${esc(ddmmaaaa(o.inicio))} a ${esc(ddmmaaaa(o.fim))}.</div>
    </td>
  </tr></table>
</td></tr>`;
}

// Quadro "Atualizações desde o aviso anterior": o que mudou nas faltas do aviso da semana passada.
const SELO = {
  ABONADA: { rot: "ABONADA", borda: "#d3dbe6", fundo: "#f4f7fb", cor: "#3a4a5e" },
  RETIRADA: { rot: "RETIRADA", borda: "#d3dbe6", fundo: "#f4f7fb", cor: "#3a4a5e" },
  MEDIDA: { rot: "MEDIDA APLICADA", borda: "#bcd6f5", fundo: "#e8f1fc", cor: "#1e4d8c" },
  NOVA: { rot: "REGISTRADA APÓS O AVISO", borda: "#9fb6d3", fundo: "#ffffff", cor: MARINHO }
};
function quadroAtualizacoes(a) {
  if (!a || !a.itens || !a.itens.length) return "";
  const linhas = a.itens.map((x, i) => {
    const s = SELO[x.tipo] || SELO.ABONADA, ult = i === a.itens.length - 1, borda = ult ? "" : `border-bottom:1px solid ${LINHA};`;
    return `<tr>
      <td class="nome" valign="top" style="padding:14px;${borda}font-weight:700;color:${MARINHO};font-family:${FONTE}">${esc(x.nome)}<div style="font-size:11px;line-height:16px;font-weight:400;color:${CLARO}">RE ${esc(x.re)} · falta de ${esc(ddmmaaaa(x.data))}</div></td>
      <td class="ult" align="right" valign="top" style="padding:14px;${borda}font-family:${FONTE}">
        <span style="display:inline-block;padding:4px 12px;border:1px solid ${s.borda};border-radius:20px;background:${s.fundo};color:${s.cor};font-size:11px;line-height:14px;font-weight:700;letter-spacing:.5px;white-space:nowrap">${s.rot}</span>
        ${x.detalhe ? `<div style="font-size:11px;line-height:16px;color:${CLARO};padding-top:5px">${esc(x.detalhe)}</div>` : ""}
      </td>
    </tr>`;
  }).join("\n");
  return `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${CINZA};text-transform:uppercase;padding-bottom:4px;font-family:${FONTE}">Atualizações desde o aviso anterior</td></tr>
    <tr><td style="font-size:12px;line-height:18px;color:#6b7e96;padding-bottom:12px;font-family:${FONTE}">Faltas do aviso de ${esc(ddmm(a.de))} a ${esc(ddmm(a.ate))} que mudaram depois do envio.</td></tr>
  </table>
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${LINHA};border-radius:12px;font-size:12.5px;line-height:19px;color:#3a4a5e">
${linhas}
  </table>
</td></tr>`;
}

// Fecho no corpo do e-mail, abaixo do cartão: "Atenciosamente," e a assinatura do Raphael
// como imagem (pedido dele). A imagem vem do painel (fica no banco, não no código: o
// repositório é público e ela tem foto e telefones). Sem assinatura cadastrada, fecha com
// "Atenciosamente, Servcamp".
function fecho(a) {
  const atenciosamente = `    <tr><td class="px" style="padding:28px 4px 0;font-family:${FONTE};font-size:15px;line-height:24px;color:#1f2a37">Atenciosamente,${a && a.src ? "" : "<br><b>Servcamp</b>"}</td></tr>`;
  if (!a || !a.src) return atenciosamente;
  const w = Math.min(Number(a.largura) || 600, 600), h = Number(a.altura) ? Math.round(Number(a.altura) * w / (Number(a.largura) || w)) : 0;
  return atenciosamente + `
    <tr><td class="px" style="padding:14px 4px 0"><img src="${esc(a.src)}" width="${w}"${h ? ` height="${h}"` : ""} alt="Assinatura" style="display:block;width:100%;max-width:${w}px;height:auto;border:0"></td></tr>`;
}

const ESTILO = `<style>
  body{margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table{border-collapse:separate;mso-table-lspace:0;mso-table-rspace:0}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  @media screen and (max-width:620px){
    .wrap{width:100%!important}
    .px{padding-left:20px!important;padding-right:20px!important}
    .h1{font-size:24px!important;line-height:30px!important}
    .hide-sm{display:none!important}
    .only-sm{display:block!important;max-height:none!important;overflow:visible!important;padding-top:16px}
    .kpi td.k{padding:12px 10px!important}
    .kpi .kv{font-size:13px!important}
    .rt thead{display:none!important}
    .rt tr{display:block!important;border:1px solid #e3eaf3!important;border-radius:10px!important;margin:0 0 10px!important;background:#ffffff!important}
    .rt td{display:block!important;width:auto!important;border:0!important;padding:4px 14px!important;text-align:left!important;background:#ffffff!important}
    .rt td.nome{padding-top:14px!important;font-size:15px!important}
    .rt td.ult{padding-bottom:14px!important}
    .rt .lbl{display:inline-block!important;width:64px;font-size:10px!important;letter-spacing:1px;text-transform:uppercase;color:#6b7e96!important}
  }
</style>`;

// ── o e-mail inteiro ────────────────────────────────────────────────────────
// o: { area, saudacao, inicio, fim, linhas: [{ nome, re, posto, cargo, escala, datas }],
//      atualizacoes: null | { de, ate, itens: [{ nome, re, data, tipo, detalhe }] },
//      teste, logo, assinatura: null | { src, largura, altura } }
// As linhas já chegam agrupadas por colaborador e ordenadas (api/_faltas_email.js).
function montar(o) {
  const linhas = (o.linhas || []).map(l => ({ ...l, nome: titulo(l.nome) || "Sem nome", posto: titulo(l.posto) || "Reserva técnica", cargo: titulo(l.cargo) || "—", escala: titulo(l.escala) || "—", datas: (l.datas || []).map(iso).sort() }));
  const area = titulo(o.area) || "Sem área";
  const saudacao = titulo(o.saudacao) || area;
  const faltas = linhas.reduce((t, l) => t + l.datas.length, 0);
  const periodo = ddmmaaaa(o.inicio) + " a " + ddmmaaaa(o.fim);
  const atual = o.atualizacoes && o.atualizacoes.itens && o.atualizacoes.itens.length
    ? { ...o.atualizacoes, itens: o.atualizacoes.itens.map(x => ({ ...x, nome: titulo(x.nome) || "Sem nome" })) } : null;
  const assunto = (o.teste ? "[TESTE] " : "") + "Aviso semanal de faltas injustificadas — " + area;
  const rodape = "Envio automatizado"; // pedido do Raphael (23/10/2026), no automático e no manual

  const p = t => `<p style="margin:0 0 14px">${t}</p>`;
  const mensagem = (o.teste ? `<p style="margin:0 0 18px;padding:10px 14px;border:1px solid #d3dbe6;border-left:4px solid ${AZUL};border-radius:8px;background:#f4f7fb;font-size:13px;line-height:20px;color:#3a4a5e"><b style="color:${MARINHO}">Envio de teste.</b> Período escolhido no painel; não substitui o aviso oficial da semana.</p>` : "") +
    p(`Olá, ${esc(saudacao)}.`) +
    (linhas.length
      ? p(`Segue o aviso das faltas injustificadas registradas na sua área, referentes ao período de ${esc(periodo)}.`) +
        `<p style="margin:0">Por gentileza, analise cada situação e avalie se cabe a aplicação de medida disciplinar, conforme os procedimentos da empresa.</p>`
      : `<p style="margin:0">Não foram identificadas faltas injustificadas na sua área no período de ${esc(periodo)}.</p>`);

  const cartao = [
    cabecalho({ ...o, inicio: o.inicio, fim: o.fim }),
    tituloArea({ ...o, area }),
    linhas.length ? numeros(o, faltas, linhas.length) + tabela(linhas) : semOcorrencia(o),
    quadroAtualizacoes(atual),
    `<tr><td class="px" style="padding:30px 40px 26px;font-family:${FONTE};font-size:11px;line-height:17px;color:${CLARO}">${esc(rodape)}</td></tr>`,
    `<tr><td height="5" bgcolor="${AZUL}" style="height:5px;line-height:5px;font-size:0;background:${AZUL};border-radius:0 0 18px 18px">&nbsp;</td></tr>`
  ].join("\n");

  const previa = linhas.length ? `${plural(faltas, "falta injustificada", "faltas injustificadas")} na área ${area}, de ${periodo}.` : `Nenhuma falta injustificada na área ${area}, de ${periodo}.`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<title>${esc(assunto)}</title>
<!--[if mso]><style>table,td,th,p,a,span,div{font-family:"Segoe UI",Arial,sans-serif!important}</style><![endif]-->
${ESTILO}
</head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(previa)}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff">
<tr><td align="center" style="padding:28px 12px 36px">
  <!--[if mso]><table role="presentation" width="640" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
  <table role="presentation" class="wrap" width="640" border="0" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px">
    <tr><td class="px" style="padding:0 4px 24px;font-family:${FONTE};font-size:15px;line-height:24px;color:#1f2a37">
${mensagem}
    </td></tr>
    <tr><td>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e3e9f1;border-radius:18px;box-shadow:0 10px 30px rgba(13,31,53,.10)">
${cartao}
      </table>
    </td></tr>
${fecho(o.assinatura)}
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  // versão em texto simples: quem lê o e-mail sem HTML vê o mesmo conteúdo
  const t = [];
  if (o.teste) t.push("[ENVIO DE TESTE — período escolhido no painel; não substitui o aviso oficial da semana]", "");
  t.push(`Olá, ${saudacao}.`, "");
  if (linhas.length) {
    t.push(`Segue o aviso das faltas injustificadas registradas na sua área, referentes ao período de ${periodo}.`, "");
    t.push("Por gentileza, analise cada situação e avalie se cabe a aplicação de medida disciplinar, conforme os procedimentos da empresa.", "");
    t.push(`FALTAS INJUSTIFICADAS — ÁREA ${area.toUpperCase()}`, `Período: ${periodo}`, `Ocorrências: ${faltas} · Colaboradores: ${linhas.length}`, "");
    linhas.forEach(l => t.push(`- ${l.nome} · RE ${l.re} · ${l.posto} · ${l.cargo} · ${l.escala} · ${l.datas.length > 1 ? "Faltas" : "Falta"}: ${l.datas.map(d => ddmmaaaa(d) + " (" + diaDaSemana(d) + ")").join(", ")}`));
    t.push("");
  } else {
    t.push(`Não foram identificadas faltas injustificadas na sua área no período de ${periodo}.`, "");
  }
  if (atual) {
    t.push(`ATUALIZAÇÕES DESDE O AVISO ANTERIOR (${ddmm(atual.de)} a ${ddmm(atual.ate)})`);
    atual.itens.forEach(x => t.push(`- ${x.nome} · RE ${x.re} · falta de ${ddmmaaaa(x.data)} · ${(SELO[x.tipo] || SELO.ABONADA).rot}${x.detalhe ? " (" + x.detalhe + ")" : ""}`));
    t.push("");
  }
  t.push(rodape, "", "Atenciosamente,");
  if (!(o.assinatura && o.assinatura.src)) t.push("Servcamp");

  return { assunto, html, texto: t.join("\n") };
}

module.exports = { montar, titulo, periodoCurto, esc, ehSemanaCheia, somaDias };
