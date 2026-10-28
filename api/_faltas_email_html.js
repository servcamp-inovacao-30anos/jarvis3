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
  const rotulo = o.teste ? "Envio de teste" : (o.rotulo || "Aviso semanal");
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

// Embaixo do nome, só o resumo do ano; o detalhe vai na tabela "Reincidência no ano".
// Com 2 ou mais medidas, o selo "Reincidente" (o mesmo corte da tela).
const pl = (n, um, v) => n + " " + (n === 1 ? um : v);
const SELO_REIN = `<span style="display:inline-block;padding:2px 8px;border:1px solid #f4b4ad;border-radius:10px;background:#fdecea;color:#b42318;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.5px;white-space:nowrap">REINCIDENTE</span>`;
function noAno(h) {
  if (!h) return "";
  return `<div style="font-size:11px;line-height:16px;font-weight:400;color:${CINZA};padding-top:5px">${h.reincidente ? SELO_REIN + "<br>" : ""}Histórico: ${pl(h.faltasAno, "falta injustificada", "faltas injustificadas")}<br>Medidas disciplinares: ${h.medidas ? h.medidas : "nenhuma"}</div>`;
}
// As datas por baixo do número: quem lê confere de onde vem a contagem (as 5 mais recentes).
function datasHist(h) {
  const ds = [...(h.datasFaltas || [])].sort().reverse();
  if (!ds.length) return "";
  const dm = d => { const s = iso(d); return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(2, 4); };
  const txt = ds.slice(0, 5).map(dm).join(", ") + (ds.length > 5 ? " e mais " + (ds.length - 5) : "");
  return `<div style="font-size:10px;line-height:14px;font-weight:400;color:${CLARO};padding-top:4px">${esc(txt)}</div>`;
}
function medidaTxt(m) {
  if (!m) return "";
  const t = String(m.tipo || "").toUpperCase(), g = String(m.grau || "").toUpperCase();
  if (t.startsWith("SUSPENS")) return "Suspensão" + (m.dias ? " de " + pl(m.dias, "dia", "dias") : "");
  return "Advertência" + (g === "VERBAL" ? " verbal" : g === "ESCRITA" ? " escrita" : "");
}
// Uma linha por colaborador do aviso: faltas injustificadas e medidas desde 01/01, a última medida
// e a situação. Primeiro quem tem mais medidas: é onde o supervisor precisa olhar com mais cuidado.
function tabelaReincidencia(linhas) {
  const com = linhas.filter(l => l.hist);
  if (!com.length) return "";
  const ord = [...com].sort((a, b) => b.hist.medidas - a.hist.medidas || b.hist.faltasAno - a.hist.faltasAno || String(a.nome).localeCompare(String(b.nome)));
  const th = (rot, w, alin, raio) => `<th align="${alin}" width="${w}" bgcolor="#eef3f9" style="background:#eef3f9;${raio ? "border-radius:" + raio + ";" : ""}padding:11px 10px;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.8px;color:#3a4a5e;text-transform:uppercase;font-family:${FONTE}">${rot}</th>`;
  const lbl = t => `<span class="lbl" style="display:none">${t}</span>`;
  const corpo = ord.map((l, i) => {
    const h = l.hist, ult = i === ord.length - 1, b = ult ? "" : `border-bottom:1px solid ${LINHA};`;
    const sit = h.reincidente ? SELO_REIN
      : h.medidas ? `<span style="display:inline-block;padding:2px 8px;border:1px solid #fedf89;border-radius:10px;background:#fffaeb;color:#93370d;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.5px;white-space:nowrap">${h.medidas} ${h.medidas === 1 ? "MEDIDA" : "MEDIDAS"}</span>`
      : `<span style="display:inline-block;padding:2px 8px;border:1px solid #d3dbe6;border-radius:10px;background:#f4f7fb;color:#3a4a5e;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.5px;white-space:nowrap">SEM MEDIDA</span>`;
    const td = (cls, alin, estilo, html) => `<td${cls ? ` class="${cls}"` : ""} align="${alin}" valign="top" style="padding:12px 10px;${b}${estilo};font-family:${FONTE}">${html}</td>`;
    return `<tr>
      ${td("nome", "left", `font-weight:700;color:${MARINHO}`, esc(l.nome) + `<div style="font-size:11px;line-height:16px;font-weight:400;color:${CLARO}">RE ${esc(l.re)}</div>`)}
      ${td("", "center", `font-weight:700;color:${MARINHO};font-size:15px`, lbl("Faltas") + h.faltasAno + datasHist(h))}
      ${td("", "left", "", lbl("Medidas") + (h.medidas ? `<b style="color:${MARINHO}">${h.medidas}</b> · ${esc(h.txt)}` : `<span style="color:${CLARO}">Nenhuma</span>`))}
      ${td("", "left", "white-space:nowrap", lbl("Última") + (h.ultima ? esc(medidaTxt(h.ultima)) + `<div style="font-size:11px;line-height:16px;color:${CLARO}">${esc(ddmmaaaa(h.ultima.data))}</div>` : "—"))}
      ${td("ult", "left", "", sit)}
    </tr>`;
  }).join("\n");
  return `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${CINZA};text-transform:uppercase;padding-bottom:4px;font-family:${FONTE}">Histórico dos colaboradores</td></tr>
    <tr><td style="font-size:12px;line-height:18px;color:#6b7e96;padding-bottom:12px;font-family:${FONTE}">Faltas injustificadas e medidas disciplinares de cada colaborador (abonos, afastamentos e medidas canceladas não contam).</td></tr>
  </table>
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${LINHA};border-radius:12px;border-collapse:separate;font-size:12.5px;line-height:19px;color:#3a4a5e">
    <thead><tr>${th("Colaborador", "28%", "left", "12px 0 0 0")}${th("Faltas injust.", "11%", "center", "")}${th("Medidas", "31%", "left", "")}${th("Última", "16%", "left", "")}${th("Situação", "14%", "left", "0 12px 0 0")}</tr></thead>
    <tbody>
${corpo}
    </tbody>
  </table>
</td></tr>`;
}

// Botão de verdade (à prova de cliente de e-mail): a área clicável é o botão inteiro, não só o texto; cantos
// arredondados e sombra por baixo onde o cliente deixa; no Outlook (que ignora CSS de botão) vira um retângulo
// arredondado desenhado em VML; no celular ocupa a largura toda. É o ÚNICO link do aviso.
function botaoLink(link, rotulo) {
  const h = esc(link), r = esc(rotulo);
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:50px;v-text-anchor:middle;width:320px" arcsize="20%" stroke="f" fillcolor="${AZUL}"><w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold">${r} &rarr;</center></v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<table role="presentation" class="btn-w" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
  <td align="center" bgcolor="${AZUL}" style="background:${AZUL};background-image:linear-gradient(180deg,#2c82dc,#1a5fae);border-radius:10px;border-bottom:3px solid #14478a;mso-padding-alt:0">
    <a href="${h}" target="_blank" class="btn" style="display:block;padding:15px 34px 14px;font-family:${FONTE};font-size:15px;line-height:20px;font-weight:700;letter-spacing:.2px;color:#ffffff;text-decoration:none;text-align:center;border-radius:10px">${r}&nbsp;&nbsp;&rarr;</a>
  </td>
</tr></table>
<!--<![endif]-->`;
}

// Botão para o painel: lá o supervisor vê as mesmas faltas e gera a medida de cada uma.
function botaoPainel(link) {
  if (!link) return "";
  const passo = (n, t) => `<td valign="top" style="padding:0 14px 0 0;font-family:${FONTE}"><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
        <td width="22" height="22" align="center" valign="middle" bgcolor="${AZUL}" style="width:22px;height:22px;background:${AZUL};border-radius:11px;color:#ffffff;font-size:12px;line-height:22px;font-weight:700;font-family:${FONTE}">${n}</td>
        <td style="padding-left:8px;font-size:12.5px;line-height:18px;color:${CINZA};font-family:${FONTE}">${t}</td></tr></table></td>`;
  return `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f4f8fd" style="background:#f4f8fd;border:1px solid #d9e6f5;border-radius:14px"><tr>
    <td style="padding:24px 26px 26px;font-family:${FONTE}" align="left">
      <div style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${AZUL};text-transform:uppercase">Próximo passo</div>
      <div style="font-size:19px;line-height:26px;font-weight:700;color:${MARINHO};padding-top:6px">Gerar a medida disciplinar</div>
      <div style="font-size:13.5px;line-height:21px;color:${CINZA};padding-top:4px">No painel você vê estas mesmas faltas, com o histórico de cada colaborador, e gera o documento em poucos cliques.</div>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
        ${passo(1, "Escolha a medida")}${passo(2, "Escreva o motivo")}${passo(3, "Imprima e lance no SAR2G")}
      </tr></table>
      <div style="padding-top:20px">${botaoLink(link, "Abrir no Painel ServCamp")}</div>
    </td>
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
      ${td("nome", "", `padding:16px 12px;border-left:1px solid ${LINHA};border-bottom:1px solid ${LINHA};font-weight:700;color:${MARINHO}`, esc(l.nome) + (qtd > 1 ? `<div style="font-size:11px;line-height:16px;font-weight:700;color:${AZUL};padding-top:3px">${qtd} faltas na semana</div>` : "") + noAno(l.hist))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA};white-space:nowrap`, lbl("RE") + esc(l.re))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA}`, lbl("Posto") + esc(l.posto))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA}`, lbl("Cargo") + esc(l.cargo))}
      ${td("", "", `padding:16px 6px;border-bottom:1px solid ${LINHA};white-space:nowrap`, lbl("Escala") + esc(l.escala))}
      ${td("ult", ` align="left"`, `padding:16px 12px;border-right:1px solid ${LINHA};border-bottom:1px solid ${LINHA};font-weight:700;color:${MARINHO};line-height:21px`, lbl(qtd > 1 ? "Datas" : "Data") + datas)}
    </tr>`;
  }).join("\n");
  return `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${CINZA};text-transform:uppercase;padding-bottom:12px;font-family:${FONTE}">Ocorrências do período</td>
    <td align="left" class="hide-sm" style="font-size:12px;line-height:14px;color:#6b7e96;padding-bottom:12px;font-family:${FONTE}">Ordenadas pela primeira falta</td>
  </tr></table>
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate">
    <thead><tr>
      ${th("Colaborador", "24%", "left", "10px 0 0 0", "12px")}${th("RE", "9%", "left", "", "6px")}${th("Posto", "26%", "left", "", "6px")}${th("Cargo", "16%", "left", "", "6px")}${th("Escala", "8%", "left", "", "6px")}${th("Datas", "17%", "left", "0 10px 0 0", "12px")}
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
      <td class="ult" align="left" valign="top" style="padding:14px;${borda}font-family:${FONTE}">
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

// Fecho no corpo do e-mail, abaixo do cartão: só a assinatura do Raphael como imagem (ela já traz o nome).
// A imagem vem do painel (fica no banco, não no código: o repositório é público e ela tem foto e telefones).
// Sem assinatura cadastrada, o e-mail termina no cartão.
function fecho(a) {
  // sem "Atenciosamente, Servcamp": a assinatura do Raphael já fecha o e-mail (pedido dele, 27/10/2026)
  if (!a || !a.src) return "";
  const w = Math.min(Number(a.largura) || 600, 600), h = Number(a.altura) ? Math.round(Number(a.altura) * w / (Number(a.largura) || w)) : 0;
  return `
    <tr><td class="px" style="padding:22px 4px 0"><img src="${esc(a.src)}" width="${w}"${h ? ` height="${h}"` : ""} alt="Assinatura" style="display:block;width:100%;max-width:${w}px;height:auto;border:0"></td></tr>`;
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
    .btn-w{width:100%!important}
    .btn{padding:17px 12px 16px!important}
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
    linhas.length ? numeros(o, faltas, linhas.length) + tabela(linhas) + tabelaReincidencia(linhas) + botaoPainel(o.link) : semOcorrencia(o),
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
    linhas.forEach(l => {
      t.push(`- ${l.nome} · RE ${l.re} · ${l.posto} · ${l.cargo} · ${l.escala} · ${l.datas.length > 1 ? "Faltas" : "Falta"}: ${l.datas.map(d => ddmmaaaa(d) + " (" + diaDaSemana(d) + ")").join(", ")}`);
      if (l.hist) t.push(`  Histórico: ${l.hist.faltasAno} ${l.hist.faltasAno === 1 ? "falta injustificada" : "faltas injustificadas"} (${(l.hist.datasFaltas || []).map(ddmmaaaa).join(", ")}) · medidas disciplinares: ${l.hist.medidas ? l.hist.medidas + " (" + l.hist.txt + ")" : "nenhuma"}${l.hist.ultima ? " · última em " + ddmmaaaa(l.hist.ultima.data) : ""}${l.hist.reincidente ? " · REINCIDENTE" : ""}`);
    });
    t.push("");
    if (o.link) t.push(`Gerar a medida disciplinar no Painel ServCamp: ${o.link}`, "");
  } else {
    t.push(`Não foram identificadas faltas injustificadas na sua área no período de ${periodo}.`, "");
  }
  if (atual) {
    t.push(`ATUALIZAÇÕES DESDE O AVISO ANTERIOR (${ddmm(atual.de)} a ${ddmm(atual.ate)})`);
    atual.itens.forEach(x => t.push(`- ${x.nome} · RE ${x.re} · falta de ${ddmmaaaa(x.data)} · ${(SELO[x.tipo] || SELO.ABONADA).rot}${x.detalhe ? " (" + x.detalhe + ")" : ""}`));
    t.push("");
  }
  t.push(rodape);

  return { assunto, html, texto: t.join("\n") };
}

// ── resumo semanal da coordenação: medidas geradas no painel × SAR2G ────────
// o: { semana: { inicio, fim }, hoje, geradas (de api/_faltas.js lerGeradas), nomes: { login: nome },
//      link, logo, assinatura, teste, saudacao }
// Responde: o que ainda falta lançar no SAR2G (e há quanto tempo), o que cada supervisor gerou e
// lançou na semana e quais medidas ainda não têm o documento assinado anexado.
const ROT_TIPO = { ADVERTENCIA_VERBAL: "Advertência verbal", ADVERTENCIA_ESCRITA: "Advertência escrita", SUSPENSAO: "Suspensão" };
const diaSPde = t => { const x = Date.parse(t); return x ? new Date(x - 3 * 3600000).toISOString().slice(0, 10) : iso(t); };
function montarResumo(o) {
  const ini = iso(o.semana.inicio), fim = iso(o.semana.fim), nomes = o.nomes || {};
  const quem = k => titulo(nomes[k] || k || "");
  const vivas = (o.geradas || []).filter(g => g.status !== "CANCELADA");
  const pend = vivas.filter(g => g.status === "PENDENTE").sort((a, b) => (b.diasPendente || 0) - (a.diasPendente || 0) || String(a.geradaEm).localeCompare(String(b.geradaEm)));
  const naSemana = d => d >= ini && d <= fim;
  const geradasSem = vivas.filter(g => naSemana(diaSPde(g.geradaEm)));
  const lancadasSem = vivas.filter(g => g.status === "LANCADA" && naSemana(g.lancadaPor === "planilha" ? iso(g.lancadaEm) : diaSPde(g.lancadaEm)));
  const semAss = vivas.filter(g => !g.assinado);
  const atras = pend.filter(g => (g.diasPendente || 0) >= 3).length;
  const periodo = ddmmaaaa(ini) + " a " + ddmmaaaa(fim);
  const assunto = (o.teste ? "[TESTE] " : "") + "Resumo semanal das medidas disciplinares — " + (pend.length ? pl(pend.length, "medida falta", "medidas faltam") + " lançar no SAR2G" : "nada pendente no SAR2G");

  const caixa = (rot, val, cor, borda) => `<td class="k" width="25%" valign="top" style="padding:16px 14px;${borda ? "border-left:1px solid #e3eaf3;" : ""}font-family:${FONTE}">
      <div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:1.2px;color:#6b7e96;text-transform:uppercase">${rot}</div>
      <div style="font-size:26px;line-height:32px;font-weight:700;color:${cor || MARINHO};padding-top:4px">${val}</div>
    </td>`;
  const kpis = `<tr><td class="px" style="padding:22px 40px 0">
  <table role="presentation" class="kpi" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f4f7fb" style="background:#f4f7fb;border:1px solid #e3eaf3;border-left:4px solid ${pend.length ? "#f5b000" : AZUL};border-radius:12px"><tr>
    ${caixa("Falta lançar no SAR2G", pend.length, pend.length ? "#b54708" : MARINHO, false)}
    ${caixa("Há 3 dias ou mais", atras, atras ? "#b42318" : MARINHO, true)}
    ${caixa("Geradas na semana", geradasSem.length, null, true)}
    ${caixa("Sem documento assinado", semAss.length, semAss.length ? "#b54708" : MARINHO, true)}
  </tr></table>
</td></tr>`;

  const th = (rot, w, alin, raio) => `<th align="${alin}" width="${w}" bgcolor="#14304f" style="background:#14304f;${raio ? "border-radius:" + raio + ";" : ""}padding:12px 10px;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.8px;color:#ffffff;text-transform:uppercase;font-family:${FONTE}">${rot}</th>`;
  const lbl = t => `<span class="lbl" style="display:none">${t}</span>`;
  const titSec = (t, sub) => `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;color:${CINZA};text-transform:uppercase;padding-bottom:4px;font-family:${FONTE}">${t}</td></tr>
    ${sub ? `<tr><td style="font-size:12px;line-height:18px;color:#6b7e96;padding-bottom:12px;font-family:${FONTE}">${sub}</td></tr>` : ""}
  </table>`;

  // por supervisor: só quem tem algo para mostrar
  const sups = {};
  const reg = s => (sups[s] = sups[s] || { nome: s, pend: 0, mais: 0, geradas: 0, lancadas: 0, semAss: 0 });
  pend.forEach(g => { const x = reg(g.supervisor || "Sem supervisor"); x.pend++; x.mais = Math.max(x.mais, g.diasPendente || 0); });
  geradasSem.forEach(g => { reg(g.supervisor || "Sem supervisor").geradas++; });
  lancadasSem.forEach(g => { reg(g.supervisor || "Sem supervisor").lancadas++; });
  semAss.forEach(g => { reg(g.supervisor || "Sem supervisor").semAss++; });
  const lsup = Object.values(sups).sort((a, b) => b.pend - a.pend || b.mais - a.mais || a.nome.localeCompare(b.nome));
  const tabSup = !lsup.length ? "" : `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  ${titSec("Por supervisor", "Medidas geradas no painel e ainda não lançadas no SAR2G, e o que cada um fez na semana.")}
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate">
    <thead><tr>${th("Supervisor", "30%", "left", "10px 0 0 0")}${th("Falta lançar", "15%", "center", "")}${th("Mais antiga", "15%", "center", "")}${th("Geradas na semana", "14%", "center", "")}${th("Lançadas na semana", "13%", "center", "")}${th("Sem assinatura", "13%", "center", "0 10px 0 0")}</tr></thead>
    <tbody style="font-size:12.5px;line-height:19px;color:#3a4a5e">
${lsup.map((x, i) => {
    const z = i % 2 ? `background:${ZEBRA};` : "", fundo = i % 2 ? ` bgcolor="${ZEBRA}"` : "";
    const td = (cls, alin, est, h) => `<td${cls ? ` class="${cls}"` : ""}${fundo} align="${alin}" valign="top" style="${z}padding:13px 10px;border-bottom:1px solid ${LINHA};${est};font-family:${FONTE}">${h}</td>`;
    return `<tr>
      ${td("nome", "left", `border-left:1px solid ${LINHA};font-weight:700;color:${MARINHO}`, esc(titulo(x.nome)))}
      ${td("", "center", `font-weight:700;color:${x.pend ? "#b54708" : MARINHO}`, lbl("Falta lançar") + x.pend)}
      ${td("", "center", x.mais >= 3 ? "font-weight:700;color:#b42318" : "", lbl("Mais antiga") + (x.pend ? (x.mais ? pl(x.mais, "dia", "dias") : "hoje") : "—"))}
      ${td("", "center", "", lbl("Geradas") + x.geradas)}
      ${td("", "center", "", lbl("Lançadas") + x.lancadas)}
      ${td("ult", "center", `border-right:1px solid ${LINHA};${x.semAss ? "color:#b54708;font-weight:700" : ""}`, lbl("Sem assinatura") + x.semAss)}
    </tr>`;
  }).join("\n")}
    </tbody>
  </table>
</td></tr>`;

  const tabPend = !pend.length ? `<tr><td class="px" style="padding:22px 40px 0">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ecfdf3" style="background:#ecfdf3;border:1px solid #abefc6;border-radius:12px"><tr>
    <td style="padding:18px 22px;font-family:${FONTE}"><div style="font-size:15px;line-height:22px;font-weight:700;color:#067647">Nada pendente no SAR2G</div>
    <div style="font-size:13px;line-height:20px;color:#3a4a5e;padding-top:3px">Todas as medidas geradas no painel já aparecem na planilha do SAR2G ou foram marcadas como lançadas.</div></td>
  </tr></table>
</td></tr>` : `<tr><td class="px" style="padding:30px 40px 0;font-family:${FONTE}">
  ${titSec("Falta lançar no SAR2G", "Da mais antiga para a mais nova. Sai da lista sozinha quando a planilha diária trouxer a medida.")}
  <table role="presentation" class="rt" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid ${LINHA};border-radius:12px;border-collapse:separate;font-size:12.5px;line-height:19px;color:#3a4a5e">
${pend.map((g, i) => {
    const b = i === pend.length - 1 ? "" : `border-bottom:1px solid ${LINHA};`, n = g.diasPendente || 0;
    const td = (cls, alin, est, h) => `<td${cls ? ` class="${cls}"` : ""} align="${alin}" valign="top" style="padding:12px 12px;${b}${est};font-family:${FONTE}">${h}</td>`;
    const med = (ROT_TIPO[g.tipoId] || titulo(g.tipo)) + (g.tipoId === "SUSPENSAO" ? " · " + pl(g.dias, "dia", "dias") : "");
    return `<tr>
      ${td("nome", "left", `font-weight:700;color:${MARINHO}`, esc(titulo(g.nome)) + `<div style="font-size:11px;line-height:16px;font-weight:400;color:${CLARO}">RE ${esc(g.re)} · ${esc(g.numero)}</div>`)}
      ${td("", "left", "", lbl("Medida") + esc(med) + `<div style="font-size:11px;line-height:16px;color:${CLARO}">${esc(titulo(g.supervisor))}</div>`)}
      ${td("", "left", "", lbl("Gerada") + `${esc(ddmmaaaa(diaSPde(g.geradaEm)))}<div style="font-size:11px;line-height:16px;color:${CLARO}">por ${esc(quem(g.geradaPor))}</div>`)}
      ${td("ult", "right", "white-space:nowrap", `<span style="display:inline-block;padding:3px 10px;border:1px solid ${n >= 3 ? "#f4b4ad" : "#fedf89"};border-radius:12px;background:${n >= 3 ? "#fdecea" : "#fffaeb"};color:${n >= 3 ? "#b42318" : "#93370d"};font-size:11px;line-height:14px;font-weight:700">${n ? "há " + pl(n, "dia", "dias") : "gerada hoje"}</span>` + (g.assinado ? "" : `<div style="font-size:11px;line-height:16px;color:${CLARO};padding-top:4px">sem assinatura anexada</div>`))}
    </tr>`;
  }).join("\n")}
  </table>
</td></tr>`;

  const botao = o.link ? `<tr><td class="px" style="padding:26px 40px 0;font-family:${FONTE}">
  ${botaoLink(o.link, "Abrir as medidas geradas no Painel ServCamp")}
</td></tr>` : "";

  const titulo1 = `<tr><td class="px" style="padding:34px 40px 0;font-family:${FONTE}">
  <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:2.5px;color:${AZUL};text-transform:uppercase">Medidas disciplinares</div>
  <div class="h1" style="font-size:28px;line-height:34px;font-weight:700;color:${MARINHO};padding-top:6px">Painel ServCamp × SAR2G</div>
  <div style="font-size:14px;line-height:22px;color:${CINZA};padding-top:4px">Semana de ${esc(periodo)} · situação em ${esc(ddmmaaaa(o.hoje))}</div>
</td></tr>`;
  const cartao = [
    cabecalho({ inicio: ini, fim, teste: o.teste, logo: o.logo, rotulo: "Resumo semanal" }),
    titulo1, kpis, tabPend, tabSup, botao,
    `<tr><td class="px" style="padding:30px 40px 26px;font-family:${FONTE};font-size:11px;line-height:17px;color:${CLARO}">Envio automatizado · o SAR2G continua sendo o sistema oficial: o painel só gera o documento.</td></tr>`,
    `<tr><td height="5" bgcolor="${AZUL}" style="height:5px;line-height:5px;font-size:0;background:${AZUL};border-radius:0 0 18px 18px">&nbsp;</td></tr>`
  ].join("\n");
  const sauda = titulo(o.saudacao || "") || "coordenação";
  const mensagem = (o.teste ? `<p style="margin:0 0 18px;padding:10px 14px;border:1px solid #d3dbe6;border-left:4px solid ${AZUL};border-radius:8px;background:#f4f7fb;font-size:13px;line-height:20px;color:#3a4a5e"><b style="color:${MARINHO}">Envio de teste.</b> Não substitui o resumo oficial da semana.</p>` : "") +
    `<p style="margin:0 0 14px">Olá, ${esc(sauda)}.</p>` +
    `<p style="margin:0">${pend.length ? `Segue o resumo das medidas disciplinares geradas no Painel ServCamp: <b>${pl(pend.length, "medida ainda não foi lançada", "medidas ainda não foram lançadas")} no SAR2G</b>${atras ? `, ${atras} há 3 dias ou mais` : ""}.` : "Segue o resumo das medidas disciplinares geradas no Painel ServCamp: nenhuma está pendente de lançamento no SAR2G."}</p>`;
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
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(pend.length ? pl(pend.length, "medida", "medidas") + " para lançar no SAR2G." : "Nada pendente no SAR2G.")}</div>
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
  const t = [];
  if (o.teste) t.push("[ENVIO DE TESTE — não substitui o resumo oficial da semana]", "");
  t.push(`Olá, ${sauda}.`, "", `RESUMO DAS MEDIDAS DISCIPLINARES — semana de ${periodo}`, `Falta lançar no SAR2G: ${pend.length} (${atras} há 3 dias ou mais) · Geradas na semana: ${geradasSem.length} · Lançadas na semana: ${lancadasSem.length} · Sem documento assinado: ${semAss.length}`, "");
  if (pend.length) {
    t.push("FALTA LANÇAR NO SAR2G");
    pend.forEach(g => t.push(`- ${g.numero} · ${titulo(g.nome)} (RE ${g.re}) · ${ROT_TIPO[g.tipoId] || g.tipo}${g.tipoId === "SUSPENSAO" ? " " + pl(g.dias, "dia", "dias") : ""} · ${titulo(g.supervisor)} · gerada em ${ddmmaaaa(diaSPde(g.geradaEm))} por ${quem(g.geradaPor)} · ${g.diasPendente ? "há " + pl(g.diasPendente, "dia", "dias") : "hoje"}${g.assinado ? "" : " · sem assinatura"}`));
    t.push("");
  }
  if (o.link) t.push(`Abrir no Painel ServCamp: ${o.link}`, "");
  t.push("Envio automatizado");
  return { assunto, html, texto: t.join("\n"), pendentes: pend.length, atrasadas: atras, geradasSemana: geradasSem.length, lancadasSemana: lancadasSem.length, semAssinatura: semAss.length };
}

module.exports = { montar, montarResumo, titulo, periodoCurto, esc, ehSemanaCheia, somaDias };
