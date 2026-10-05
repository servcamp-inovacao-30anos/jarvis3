// api/_bdv_excel.js — dados do "Excel conectado" do relatório de Coberturas do supervisor (BDV).
// Arquivo com prefixo "_" → NÃO vira rota na Vercel; só é importado por api/_bdv.js.
//
// O Excel conectado puxa estas tabelas direto do JARVIS (consulta "Da Web" gravada dentro do arquivo).
// Aqui só se monta o que o Excel lê, a partir das idas que a tela já calcula (api/_bdv.js): nenhuma
// conta nova e nenhuma tabela nova no banco. Os números são inteiros e textos: assim o Excel entende
// igual em qualquer idioma (nada de decimal com ponto).

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const p2 = n => String(n).padStart(2, "0");
const ddmmaaaa = d => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// número de série do Excel (dias desde 1899-12-30); vazio quando não há data
function serial(d) {
  const s = String(d || "").slice(0, 10);
  if (!ehData(s)) return "";
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000) + 25569;
}
const semana = d => DIAS[new Date(d + "T12:00:00Z").getUTCDay()];
const somaDias = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// Folha de pagamento: do dia 26 de um mês ao dia 25 do seguinte.
function folhaDe(d) {
  const a = +d.slice(0, 4), m = +d.slice(5, 7), dia = +d.slice(8, 10);
  let ia = a, im = m;
  if (dia < 26) { im = m - 1; if (im < 1) { im = 12; ia = a - 1; } }
  const ini = `${ia}-${p2(im)}-26`;
  let fa = ia, fm = im + 1; if (fm > 12) { fm = 1; fa++; }
  const fim = `${fa}-${p2(fm)}-25`;
  return { inicio: ini, fim, rotulo: `${ddmmaaaa(ini)} a ${ddmmaaaa(fim)}` };
}

const SIT = { ANTES: "Antes do início da vaga", NO_PRAZO: "Até 1h de atraso", ATRASO: "1 a 3h de atraso", GRAVE: "Mais de 3h de atraso", SEM_HORARIO: "Sem horário" };
const FONTE = { FALTA: "horário da vaga de quem faltou", JORNADA: "jornada de quem faltou", POSTO: "turno do posto" };
const motivoTxt = m => { if (!m) return "—"; if (m === "FALTA") return "Falta"; const s = String(m).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const re = v => (/^\d{1,15}$/.test(String(v)) ? Number(v) : String(v == null ? "" : v));
const hhmm = v => { const m = String(v == null ? "" : v).match(/(\d{1,2}):(\d{2})/); return m ? `${p2(+m[1])}:${p2(+m[2])}` : ""; };

const IDAS_CAB = ["Data", "Dia", "Supervisor", "Posto", "Motivo", "Quem faltou", "RE", "Início da vaga", "Chegada", "Minutos", "Situação", "Referência do início", "Folha", "Metros do dia", "Tempo do dia (min)"];
const LISTAS_CAB = ["Folha", "Início", "Fim", "Supervisor", "Posto", "Motivo"];
const MOTIVOS = ["Todos os motivos", "Só faltas", "Outros motivos"];
const MAX_IDAS = 4000; // espaço que o arquivo reserva (linhas das fórmulas)

// linhas: idas montadas (api/_bdv.js idasDoPeriodo); hoje: dia de hoje (AAAA-MM-DD)
function montar(linhas, hoje, extra) {
  const idas = (linhas || []).filter(x => x.situacao !== "NAO_E_POSTO" && ehData(x.data))
    .sort((a, b) => a.data.localeCompare(b.data) || String(a.chegada).localeCompare(String(b.chegada)));
  // km e tempo do dia vão como a planilha traz, em cada linha: é o Excel que conta uma vez por supervisor e dia (igual à tela).
  // O km vai em metros (inteiro) para não depender do separador decimal do Excel.
  const linhasIdas = idas.map(x => [
    serial(x.data), semana(x.data), x.supervisor || "", x.posto || x.destino || "", motivoTxt(x.motivo),
    x.falta_nome || "", x.falta_re ? re(x.falta_re) : "", hhmm(x.inicio), hhmm(x.chegada),
    x.diferenca_min == null ? "" : Math.round(x.diferenca_min), SIT[x.situacao] || SIT.SEM_HORARIO, FONTE[x.fonte_inicio] || "",
    folhaDe(x.data).rotulo, x.km == null ? "" : Math.round(Number(x.km) * 1000), x.tempo_min == null ? "" : Math.round(Number(x.tempo_min))
  ]);

  // listas das caixas de escolha: folhas (da mais nova para a mais antiga), supervisores, postos, motivos
  const fAtual = folhaDe(hoje);
  const inis = [...new Set(idas.map(x => folhaDe(x.data).inicio))].concat(fAtual.inicio).sort();
  const folhas = [];
  for (let i = inis[0], g = 0; i && i <= fAtual.inicio && g < 36; g++) {
    const f = folhaDe(i);
    folhas.unshift(f);
    i = somaDias(f.fim, 1);
  }
  const unicos = campo => [...new Set(idas.map(campo).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sups = unicos(x => x.supervisor), postos = unicos(x => x.posto || x.destino);
  const nL = Math.max(folhas.length + 1, sups.length + 1, postos.length + 1, MOTIVOS.length);
  const linhasListas = [];
  for (let i = 0; i < nL; i++) {
    const f = i === 0 ? null : folhas[i - 1];
    linhasListas.push([
      i === 0 ? "Todas as folhas" : f ? f.rotulo : "", i === 0 || !f ? "" : serial(f.inicio), i === 0 || !f ? "" : serial(f.fim),
      i === 0 ? "Todos" : sups[i - 1] || "", i === 0 ? "Todos" : postos[i - 1] || "", MOTIVOS[i] || ""
    ]);
  }
  return {
    hoje, dataBase: (extra && extra.ultimo) || hoje, desde: (extra && extra.primeiro) || null, geradoEm: new Date().toISOString(),
    tabelas: { idas: { cab: IDAS_CAB, linhas: linhasIdas }, listas: { cab: LISTAS_CAB, linhas: linhasListas } }
  };
}

const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A consulta do Excel lê a primeira tabela da página.
function html(t, titulo) {
  return "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + esc(titulo || "Coberturas do supervisor") + "</title></head><body><table>" +
    "<tr>" + t.cab.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr>" +
    t.linhas.map(l => "<tr>" + l.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
    "</table></body></html>";
}

module.exports = { montar, html, serial, folhaDe, IDAS_CAB, LISTAS_CAB, MOTIVOS, SIT, MAX_IDAS };
