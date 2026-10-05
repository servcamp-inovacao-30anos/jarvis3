// api/_faltas_excel.js — dados do "Excel conectado" do Faltas x Medidas.
// Arquivo com prefixo "_" → NÃO vira rota na Vercel; só é importado por api/_faltas.js.
//
// O Excel conectado puxa estas tabelas direto do JARVIS (consulta "Da Web" gravada dentro do
// arquivo). Aqui só se monta o que o Excel vai ler, a partir do que o módulo já calcula
// (casos e histórico): nenhuma conta nova, nenhuma tabela nova no banco.

const R = require("./_faltas_regras");

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const dd = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ddS = d => `${DIAS[new Date(d + "T12:00:00Z").getUTCDay()]} ${dd(d)}`;
// número de série do Excel (dias desde 1899-12-30); vazio quando não há data
function serial(d) {
  const s = String(d || "").slice(0, 10);
  if (!ehData(s)) return "";
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000) + 25569;
}
function textoMedida(tipo, grau, dias) {
  const t = String(tipo || "").toUpperCase(), g = String(grau || "").toUpperCase(), n = Number(dias) || 0;
  if (t.indexOf("SUSPENS") === 0) return "Suspensão" + (n ? ` de ${n} dia(s)` : "");
  return "Advertência" + (g === "VERBAL" ? " verbal" : g === "ESCRITA" ? " escrita" : "");
}
const rotuloFolha = f => `${dd(f.inicio)} a ${dd(f.fim)}`;
const re = v => (/^\d{1,15}$/.test(String(v)) ? Number(v) : String(v == null ? "" : v));
function vinculo(tipo) {
  const t = String(tipo || "").toUpperCase();
  return t === "CONTRATO" ? "Efetivo" : t === "RESERVA" ? "Reserva técnica" : "";
}
// dias de falta no texto: sempre com o dia da semana ("sáb 26/09"), para o Excel não confundir "26/09" com uma data
function datasDasFaltas(l) {
  const u = [...new Set(l || [])].sort();
  return (u.length > 5 ? u.slice(0, 4).map(ddS).concat("+" + (u.length - 4)) : u.map(ddS)).join(" · ");
}

const CASOS_CAB = ["RE", "Colaborador", "Cargo", "Posto", "Supervisor", "Turno", "Escala", "Vínculo", "Folha", "1ª falta", "Faltas (nº)", "Datas das faltas", "Retorno", "Prazo até", "Medida aplicada", "Data da medida", "Medidas no ano", "Regra", "Motivo"];
const LISTAS_CAB = ["Folha", "Início", "Fim", "Supervisor", "Posto", "Supervisor do posto", "Posto com medida", "Supervisor com medida"];
const MEDIDAS_CAB = ["RE", "Colaborador", "Posto", "Supervisor", "Data", "Medida", "Dias", "Motivo no SAR2G", "Situação", "Origem"];
const REINC_CAB = ["Colaborador", "RE", "Posto", "Supervisor", "Medidas no ano", "Última medida", "Data da última"];
const ORDEM = { PRAZO_VENCIDO: 0, NO_PRAZO: 1, COORDENACAO: 2, AGUARDANDO_RETORNO: 3, TRATADA_FORA_DO_PRAZO: 4, TRATADA: 5 };

// cj: resposta de "casos"; hj: resposta de "historico"
function montar(cj, hj) {
  const hoje = cj.hoje;
  const casosJ = cj.casos || [];
  // medidas válidas (não canceladas) por pessoa, da mais recente para a mais antiga
  const porRE = {};
  ((hj && hj.medidas) || []).forEach(m => { if (/CANCEL/i.test(m.fase || "")) return; (porRE[m.re] = porRE[m.re] || []).push(m); });
  Object.values(porRE).forEach(l => l.sort((a, b) => b.data.localeCompare(a.data)));
  const quem = {};
  casosJ.forEach(c => { if (!quem[c.re]) quem[c.re] = c; });

  const regra = s => (s === "TRATADA" ? "TRAT_OK" : s === "TRATADA_FORA_DO_PRAZO" ? "TRAT_FORA" : s === "COORDENACAO" ? "COORD" : "");
  // na mesma ordem da tela: os empates das listas do Excel saem iguais aos do painel
  const casos = casosJ.slice();

  const linhasCasos = casos.map(c => {
    const f = c.folha || R.competenciaDe(c.primeiraFalta);
    const md = c.medida ? String(c.medida.DATA || "").slice(0, 10) : "";
    return [
      re(c.re), c.nome || "", c.cargo || "", c.posto || "Reserva técnica", c.supervisor || "Sem supervisor",
      c.turno === "NOTURNO" ? "Noturno" : "Diurno", c.escala || "", vinculo(c.tipo), rotuloFolha(f),
      serial(c.primeiraFalta), (c.faltas || []).length, datasDasFaltas(c.faltas), serial(c.retorno), serial(c.prazoFim),
      c.medida ? textoMedida(c.medida.TIPO, c.medida.GRAU, c.medida.DIAS) : "", serial(md),
      (porRE[c.re] || []).length, regra(c.situacao), c.situacao === "COORDENACAO" ? String(c.motivo || "") : ""
    ];
  });

  // ── listas que alimentam as caixas de escolha e as abas por supervisor, por posto e por folha ──
  const atrasada = c => (c.situacao === "PRAZO_VENCIDO" ? 1 : 0);
  const supN = {}, posN = {};
  casosJ.forEach(c => {
    const s = c.supervisor || "Sem supervisor", p = c.posto || "Reserva técnica";
    (supN[s] = supN[s] || { n: 0, at: 0 }).n++; supN[s].at += atrasada(c);
    const x = (posN[p] = posN[p] || { n: 0, at: 0, sups: {} }); x.n++; x.at += atrasada(c); x.sups[s] = (x.sups[s] || 0) + 1;
  });
  const sups = Object.keys(supN).sort((a, b) => supN[b].at - supN[a].at || supN[b].n - supN[a].n || a.localeCompare(b));
  const postos = Object.keys(posN).sort((a, b) => posN[b].at - posN[a].at || posN[b].n - posN[a].n || a.localeCompare(b));
  // folhas: da mais antiga com caso até a de hoje, sem buraco, da mais nova para a mais velha
  const fAtual = R.competenciaDe(hoje);
  const inis = [...new Set(casosJ.map(c => (c.folha || R.competenciaDe(c.primeiraFalta)).inicio))].concat(fAtual.inicio).sort();
  const folhas = [];
  for (let i = inis[0], g = 0; i && i <= fAtual.inicio && g < 24; g++) {
    const f = R.competenciaDe(i);
    folhas.unshift(f);
    i = R.somaDias(f.fim, 1);
  }
  // postos e supervisores que têm medida no ano, do que mais tem para o que menos tem (como no ranking da tela)
  const nomeMed = m => (m.nome && m.nome !== "—" ? m.nome : (quem[m.re] && quem[m.re].nome) || "");
  const validas = [];
  Object.keys(porRE).forEach(k => porRE[k].forEach(m => validas.push(m)));
  const contaPor = campo => {
    const c = {};
    validas.forEach(m => { const n = String(campo(m) || "").trim(); if (n) c[n] = (c[n] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b));
  };
  const postosMed = contaPor(m => m.local), supsMed = contaPor(m => m.supervisor);
  const nL = Math.max(folhas.length + 1, sups.length + 1, postos.length + 1, postosMed.length, supsMed.length);
  const linhasListas = [];
  for (let i = 0; i < nL; i++) {
    const f = i === 0 ? null : folhas[i - 1], s = i === 0 ? "Todos" : sups[i - 1], p = i === 0 ? "" : postos[i - 1];
    const sp = p ? Object.entries(posN[p].sups).sort((a, b) => b[1] - a[1])[0][0] : "";
    linhasListas.push([i === 0 ? "Todas as folhas" : f ? rotuloFolha(f) : "", i === 0 || !f ? "" : serial(f.inicio), i === 0 || !f ? "" : serial(f.fim), s || "", p, sp, postosMed[i] || "", supsMed[i] || ""]);
  }

  // ── reincidência: quem tem 2 ou mais medidas no ano ──
  const linhasReinc = Object.keys(porRE).filter(k => porRE[k].length >= 2).map(k => {
    const l = porRE[k], u = l[0], c = quem[k];
    return { n: l.length, linha: [(u.nome && u.nome !== "—" ? u.nome : (c && c.nome) || ""), re(k), (u.local && u.local !== "—" ? u.local : (c && c.posto) || ""), u.supervisor || (c && c.supervisor) || "", l.length, textoMedida(u.tipo, u.grau, u.dias), serial(u.data)] };
  }).sort((a, b) => b.n - a.n || String(a.linha[0]).localeCompare(String(b.linha[0]))).map(x => x.linha);

  // ── todas as medidas do ano (a aba Histórico), da mais recente para a mais antiga ──
  const tipoMed = m => (String(m.tipo || "").toUpperCase().indexOf("SUSPENS") === 0 ? "Suspensão" : "Advertência" + (/VERBAL/i.test(m.grau || "") ? " verbal" : /ESCRITA/i.test(m.grau || "") ? " escrita" : ""));
  const sitMed = m => (/CANCEL/i.test(m.fase || "") ? "Cancelada" : /ELABORA/i.test(m.fase || "") ? "Em elaboração" : "Concluída");
  const linhasMed = ((hj && hj.medidas) || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(a.nome).localeCompare(String(b.nome))).map(m => [
    re(m.re), nomeMed(m), m.local && m.local !== "—" ? m.local : "Reserva técnica", m.supervisor || "", serial(m.data), tipoMed(m),
    Number(m.dias) || "", m.motivo || "", sitMed(m), m.origem === "historico" ? "Histórico importado" : "Planilha diária"
  ]);

  return {
    hoje, dataBase: cj.dataBase, geradoEm: new Date().toISOString(),
    tabelas: {
      casos: { cab: CASOS_CAB, linhas: linhasCasos },
      listas: { cab: LISTAS_CAB, linhas: linhasListas },
      reinc: { cab: REINC_CAB, linhas: linhasReinc },
      medidas: { cab: MEDIDAS_CAB, linhas: linhasMed }
    }
  };
}

const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A consulta do Excel lê a primeira tabela da página: números ficam como número, o resto como texto.
function html(t, titulo) {
  return "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + esc(titulo || "Faltas x Medidas") + "</title></head><body><table>" +
    "<tr>" + t.cab.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>" +
    t.linhas.map(l => "<tr>" + l.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
    "</table></body></html>";
}

module.exports = { montar, html, serial, textoMedida, datasDasFaltas, CASOS_CAB, LISTAS_CAB, REINC_CAB, MEDIDAS_CAB };
