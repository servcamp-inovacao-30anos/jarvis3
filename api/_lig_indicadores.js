// api/_lig_indicadores.js — números do Feedback de Faltas: topo da tela, aba Desempenho e motivos. Regras puras.
// Prefixo "_" → não vira rota. Quem lê o banco é o api/ligacoes.js (GET ?acao=indicadores).
//
// Pedido do Raphael (10/11/2026):
//   • topo: faltas de hoje, do período da folha (26 a 25) e de um período escolhido, separando "sem justificativa"
//     de "abonadas" (atestado, justificada, licença, afastamento). Filtros de turno e área valem para tudo;
//   • Desempenho, mês a mês (folha 26–25 ou mês do calendário, a tela escolhe):
//       1) cada feedback com o antes x depois e o veredito (a mesma regra do Monitoramento: P.antesDepois), e quantas % melhoraram;
//       2) as faltas da empresa toda;
//       3) a % de cada motivo sobre as faltas tratadas (conversas registradas);
//       4) a média de minutos de cada feedback;
//       5) o veredito de cada colaborador;
//   • motivos novos: qualquer pessoa do SAC cria; a coordenação renomeia ou desativa. Sem tabela nova: eventos
//     LIG_MOTIVO na fm_auditoria (o último de cada chave vale), como a mensagem padrão do WhatsApp.
// A tela recebe os dados já resumidos por dia e por supervisor, e faz as contas do filtro escolhido.

"use strict";

const L = require("./_lig_regras");
const P = require("./_lig_painel"); // antesDepois: a mesma regra do Monitoramento

const ACAO_MOTIVO = "LIG_MOTIVO";
const DIAS_INDICADORES = 400;      // ~13 meses: dá para comparar o mesmo mês do ano anterior
const SEM_JUSTIFICATIVA = ["I", "T"];             // T = injustificada já tratada pelo SAC (continua sendo falta sem justificativa)
const ABONADAS = ["A", "J", "L", "AF"];           // D (desligamento) não é falta

const iso = v => (v == null ? "" : String(v).slice(0, 10));
const dataSP = ts => { const t = Date.parse(ts); return isNaN(t) ? "" : new Date(t - 3 * 3600000).toISOString().slice(0, 10); };
const dataDoContato = c => iso(c.data_contato) || dataSP(c.criado_em);
const chaveMotivo = nome => L.norm(nome);

// ── motivos ─────────────────────────────────────────────────────────────────
// eventos LIG_MOTIVO (chave = motivo original normalizado; depois = { nome, ativo }) → lista atual.
// Cada motivo guarda os nomes antigos: um contato gravado com o nome velho conta no motivo renomeado.
function motivosAtuais(eventos) {
  const m = new Map();
  L.MOTIVOS.forEach(nome => m.set(chaveMotivo(nome), { chave: chaveMotivo(nome), nome, ativo: true, padrao: true, antigos: [] }));
  [...(eventos || [])].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).forEach(e => {
    if (e.acao !== ACAO_MOTIVO || !e.depois) return;
    const k = String(e.chave), d = e.depois, nome = L.limpa(d.nome, 40);
    if (!nome) return;
    const atual = m.get(k);
    if (!atual) { m.set(k, { chave: k, nome, ativo: d.ativo !== false, padrao: false, antigos: [], por: e.ator || "" }); return; }
    if (atual.nome !== nome && !atual.antigos.includes(atual.nome)) atual.antigos.push(atual.nome);
    atual.nome = nome;
    atual.ativo = d.ativo !== false;
  });
  return [...m.values()];
}
// Nomes que o servidor aceita no contato: os atuais (ativos ou não, para não travar a edição de um contato antigo) e os antigos.
function motivosAceitos(lista) {
  const s = new Set();
  (lista || []).forEach(x => { s.add(x.nome); x.antigos.forEach(n => s.add(n)); });
  return [...s];
}
// nome gravado no contato → nome atual do motivo (renomeado ou não)
function nomeAtual(lista, nome) {
  if (!nome) return "";
  const n = L.norm(nome);
  const x = (lista || []).find(m => L.norm(m.nome) === n || m.antigos.some(a => L.norm(a) === n));
  return x ? x.nome : String(nome);
}
function validarNovoMotivo(nome, lista) {
  const n = L.limpa(nome, 40);
  if (n.length < 3) return { ok: false, erro: "O motivo precisa ter pelo menos 3 letras." };
  const k = chaveMotivo(n);
  if ((lista || []).some(m => chaveMotivo(m.nome) === k || m.chave === k || m.antigos.some(a => chaveMotivo(a) === k))) return { ok: false, erro: "Esse motivo já existe." };
  return { ok: true, nome: n, chave: k };
}

// ── indicadores ─────────────────────────────────────────────────────────────
// faltas: fm_faltas [{ re, data, nome, posto, supervisor, codigo }] (DIAS_INDICADORES dias)
// contatos: lig_contatos já com { efetivo } (resultado do contato: conversa ou tentativa)
// motivos: motivosAtuais(...)
// turnoDe: supervisor → "DIURNO" | "NOTURNO"
// envios: [{ chave: "RE|PRIMEIRONOME", data }] WhatsApp do SAC enviado com sucesso (o funil da Visão geral)
// Efetivo × reserva técnica: tipo RESERVA da planilha; nas faltas importadas (HISTORICO) a reserva aparece sem
// posto ou com o nome do supervisor no lugar do posto. A reserva de cada supervisor vira um "posto" só dela.
const semPosto = p => { const t = String(p == null ? "" : p).trim(); return !t || t === "—" || t === "-"; };
function postoDaFalta(f, sup) {
  const tipo = String(f.tipo || "").toUpperCase(), posto = String(f.posto || "").trim();
  const reserva = tipo === "RESERVA" || (tipo !== "CONTRATO" && (semPosto(posto) || (sup && L.norm(posto) === L.norm(sup))));
  return reserva ? { reserva: true, nome: "Reserva técnica · " + (sup || "sem supervisor") } : { reserva: false, nome: posto || "Sem posto" };
}
function montarIndicadores({ hoje, faltas, contatos, motivos, turnoDe, envios }) {
  hoje = iso(hoje);
  const postos = [], posPosto = new Map();
  const idxPosto = nome => { if (!posPosto.has(nome)) { posPosto.set(nome, postos.length); postos.push(nome); } return posPosto.get(nome); };
  const cargos = [], posCargo = new Map();
  const idxCargo = nome => { nome = String(nome || "").trim(); if (!nome) return null; if (!posCargo.has(nome)) { posCargo.set(nome, cargos.length); cargos.push(nome); } return posCargo.get(nome); };
  const brutas = [];             // [data, chave da pessoa, código, posto, "R" reserva | "E" efetivo, supervisor da falta, cargo] (I pendente, T tratada, A abonada)
  const dias = new Map();        // "data|supervisor" → [data, supervisor, sem justificativa, abonadas]
  const pessoas = new Map();     // "RE|PRIMEIRONOME" → { re, nome, posto, supervisor, sj: [datas I/T], dl: [datas de desligamento] }
  const sups = new Set();
  (faltas || []).forEach(f => {
    const cod = String(f.codigo || "I").toUpperCase(), d = iso(f.data);
    if (!d || d > hoje) return;
    const sj = SEM_JUSTIFICATIVA.includes(cod), ab = ABONADAS.includes(cod);
    const sup = String(f.supervisor || "").trim();
    if (sup) sups.add(sup);
    const k = L.reDe(f.re) + "|" + L.primeiroNome(f.nome);
    let p = pessoas.get(k);
    if (!p) { p = { key: k, re: L.reDe(f.re), nome: f.nome || "", posto: f.posto || "", supervisor: sup, sj: [], dl: [] }; pessoas.set(k, p); }
    if (f.posto) p.posto = f.posto;
    if (sup) p.supervisor = sup;
    if (cod === "D") p.dl.push(d);
    if (!sj && !ab) return;
    if (sj) p.sj.push(d);
    const po = postoDaFalta(f, sup);
    brutas.push([d, k, cod === "T" ? "T" : sj ? "I" : "A", idxPosto(po.nome), po.reserva ? "R" : "E", sup, idxCargo(f.cargo)]);
    const kd = d + "|" + sup;
    if (!dias.has(kd)) dias.set(kd, [d, sup, 0, 0]);
    dias.get(kd)[sj ? 2 : 3]++;
  });

  // conversas registradas (as tentativas não são feedback): cada uma vira uma avaliação antes x depois
  const porNome = new Map(), porRE = new Map();
  pessoas.forEach(p => { porNome.set(L.norm(p.nome), p); if (p.re) porRE.set(p.re, p); });
  const conversas = [], convP = [];
  const fb = new Map();          // "chave da pessoa|data" → avaliação (uma por feedback, sem repetir pessoa + data)
  (contatos || []).forEach(c => {
    if (!c.efetivo) return;
    const d = dataDoContato(c);
    if (!d) return;
    const re = c.baixa && c.baixa.re ? L.reDe(c.baixa.re) : "";
    const p = (re && porRE.get(re)) || porNome.get(L.norm(c.colaborador));
    const sup = String(c.supervisor || (p && p.supervisor) || "").trim();
    if (sup) sups.add(sup);
    conversas.push([d, nomeAtual(motivos, c.motivo) || "Sem motivo", Number.isInteger(c.duracao_min) && c.duracao_min > 0 ? c.duracao_min : null, sup, String(c.criado_por || "").split(" ")[0], c.id]);
    const k = p ? p.key : "?|" + L.norm(c.colaborador);
    if (p) convP.push([d, k]);
    if (fb.has(k + "|" + d)) return;
    // sem pessoa na planilha: nenhuma falta → sem_faltas aos 30 dias (Em observação antes disso)
    const ad = P.antesDepois(p ? p.sj : [], d, hoje);
    fb.set(k + "|" + d, { key: k, nome: p ? p.nome : String(c.colaborador || ""), re: p ? p.re : re, sup, d,
      antes: ad.antes, depois: ad.depois, dias: ad.dias, veredito: ad.veredito, faltas_antes: ad.faltas_antes, faltas_depois: ad.faltas_depois,
      desligado: !!p && p.dl.some(x => x >= d) }); // desligado depois do feedback: fora das contas (D de antes não tira)
  });

  const supervisores = [...sups].sort((a, b) => a.localeCompare(b));
  const turnos = {};
  supervisores.forEach(s => { turnos[s] = turnoDe ? turnoDe(s) : "DIURNO"; });
  // pessoas em ordem de nome; o funil se refere a elas pela posição na lista
  const lista = [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome)), pos = new Map(lista.map((p, i) => [p.key, i]));
  const ordem = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  const posSup = new Map(supervisores.map((s, i) => [s, i]));
  const enviosP = [];
  (envios || []).forEach(e => { const d = iso(e.data), i = pos.get(String(e.chave)); if (d && d <= hoje && i !== undefined) enviosP.push([d, i]); });
  return {
    hoje,
    desde: L.somaDias(hoje, -DIAS_INDICADORES),
    dias: [...dias.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1]))),
    // todas as pessoas que aparecem na planilha no período: a busca do "histórico geral"
    pessoas: lista.map(p => [p.re, p.nome, p.posto, p.supervisor]),
    // funil das faltas (Visão geral): cada falta, cada WhatsApp enviado e cada feedback registrado, por pessoa (posição em "pessoas")
    funil: {
      // 7º campo: posição do cargo em "cargos" (null sem cargo na planilha)
      // 6º campo: posição do supervisor DA FALTA em "supervisores" (o filtro de área vale pelo fato, não pela pessoa hoje)
      faltas: brutas.map(x => [x[0], pos.get(x[1]), x[2], x[3], x[4], posSup.has(x[5]) ? posSup.get(x[5]) : null, x[6]]).sort(ordem),
      envios: enviosP.sort(ordem),
      feedbacks: convP.map(x => [x[0], pos.get(x[1])]).sort(ordem)
    },
    // cada feedback efetivo com o antes x depois e o veredito (P.antesDepois); i = posição em "pessoas" ou null;
    // sup = supervisor gravado no contato (reserva: o da pessoa)
    avaliacoes: [...fb.values()].map(x => {
      const i = pos.get(x.key);
      return { i: i === undefined ? null : i, nome: x.nome, re: x.re, sup: x.sup, d: x.d, antes: x.antes, depois: x.depois, dias: x.dias, veredito: x.veredito,
        faltas_antes: x.faltas_antes, faltas_depois: x.faltas_depois, desligado: x.desligado };
    }).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.nome.localeCompare(b.nome))),
    conversas: conversas.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    // nomes dos postos (o 4º campo de cada falta do funil aponta para cá); a reserva técnica de cada supervisor é um deles
    postos, cargos,
    supervisores, turnos
  };
}

module.exports = { ACAO_MOTIVO, DIAS_INDICADORES, SEM_JUSTIFICATIVA, ABONADAS, postoDaFalta, motivosAtuais, motivosAceitos, nomeAtual, validarNovoMotivo, chaveMotivo, montarIndicadores };
