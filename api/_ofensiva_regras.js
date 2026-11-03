// api/_ofensiva_regras.js — regras da Ofensiva (dias seguidos de uso do Dashboard). Sem banco, só contas.
//
// • Só contam dias úteis (segunda a sexta). Sábado e domingo não contam nem quebram a sequência.
// • O dia vale quando a pessoa abre 3 guias diferentes (por clique dela: a tela só avisa quando é clique,
//   então quem deixa a TV aberta, ou o Modo TV trocando de tela sozinho, não ganha o dia).
// • Congelamento: cada pessoa tem 2 por mês. Um dia útil perdido gasta 1 automaticamente e a sequência
//   segue; acabaram os congelamentos do mês, a sequência volta a zero.
// • O dia é o de Brasília (o servidor roda em UTC).

"use strict";

const META_GUIAS = 3;
const CONGELAMENTOS_POR_MES = 2;
const JANELA_DIAS = 400; // o ranking e a sequência olham até aqui para trás

// "2026-11-03" no horário de Brasília
function hojeBR(agora) {
  return new Date(agora == null ? Date.now() : agora).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
const data = dia => new Date(dia + "T12:00:00Z");
function somaDias(dia, n) { const d = data(dia); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function ehUtil(dia) { const s = data(dia).getUTCDay(); return s >= 1 && s <= 5; }
const guiaValida = g => typeof g === "string" && /^[a-z0-9_-]{1,30}$/i.test(g);

// diasOk: dias ("AAAA-MM-DD") em que a pessoa completou as 3 guias. hoje: o dia de agora (Brasília).
// Hoje ainda em aberto nunca quebra a sequência: a pessoa tem até o fim do dia.
function calcular(diasOk, hoje, opcoes) {
  const por = (opcoes && opcoes.congelamentosPorMes) != null ? opcoes.congelamentosPorMes : CONGELAMENTOS_POR_MES;
  const ok = new Set((diasOk || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje && ehUtil(d)));
  const mes = hoje.slice(0, 7);
  const vazio = { sequencia: 0, melhor: 0, hojeOk: false, congeladosNoMes: 0, congelamentosRestantes: por, congeladoRecente: false, ultimoDia: null };
  if (!ok.size) return vazio;
  const ordenados = [...ok].sort();
  let seq = 0, melhor = 0, congelouOntem = false;
  const usados = {};
  for (let d = ordenados[0]; d <= hoje; d = somaDias(d, 1)) {
    if (!ehUtil(d)) continue;
    if (ok.has(d)) { seq++; if (seq > melhor) melhor = seq; continue; }
    if (d === hoje) continue; // hoje ainda dá tempo
    const m = d.slice(0, 7);
    if (seq > 0 && (usados[m] || 0) < por) { usados[m] = (usados[m] || 0) + 1; if (d === ultimoUtilAntes(hoje)) congelouOntem = true; }
    else seq = 0;
  }
  return {
    sequencia: seq, melhor, hojeOk: ok.has(hoje),
    congeladosNoMes: usados[mes] || 0, congelamentosRestantes: Math.max(0, por - (usados[mes] || 0)),
    congeladoRecente: congelouOntem, ultimoDia: ordenados[ordenados.length - 1]
  };
}
function ultimoUtilAntes(dia) { let d = somaDias(dia, -1); while (!ehUtil(d)) d = somaDias(d, -1); return d; }

// porUsuario: { chave: [dias] } → lista ordenada: maior sequência; no empate, quem já completou hoje e quem
// está mais perto das 3 guias (é isso que faz a pessoa subir na lista durante o dia); depois o recorde e o nome.
// opcoes.todos: chaves que entram mesmo sem nenhum dia (sequência 0). Sem isso, só entra quem tem sequência > 0.
// opcoes.guiasHoje: { chave: quantas guias já abriu hoje }.
function ranking(porUsuario, hoje, nomes, opcoes) {
  const o = opcoes || {}, guias = o.guiasHoje || {};
  const chaves = new Set(Object.keys(porUsuario || {}));
  (o.todos || []).forEach(k => chaves.add(k));
  const lista = [];
  for (const k of chaves) {
    const c = calcular((porUsuario || {})[k], hoje);
    if (c.sequencia > 0 || (o.todos && o.todos.indexOf(k) >= 0)) {
      lista.push({ user_key: k, nome: (nomes && nomes[k]) || null, sequencia: c.sequencia, melhor: c.melhor, hojeOk: c.hojeOk, guiasHoje: c.hojeOk ? META_GUIAS : Math.min(META_GUIAS, guias[k] || 0) });
    }
  }
  const nomeDe = x => String(x.nome || x.user_key);
  lista.sort((a, b) => b.sequencia - a.sequencia || (b.hojeOk - a.hojeOk) || b.guiasHoje - a.guiasHoje || b.melhor - a.melhor || nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
  return lista;
}

module.exports = { META_GUIAS, CONGELAMENTOS_POR_MES, JANELA_DIAS, hojeBR, somaDias, ehUtil, guiaValida, calcular, ranking };
