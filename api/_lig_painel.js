// api/_lig_painel.js — regras puras da tela do Feedback de Faltas (modelo receptivo do SAC). Prefixo "_" → não vira rota.
//
// O SAC NÃO liga: manda um WhatsApp pedindo que a pessoa ligue. Cada pessoa fica em UMA situação:
//   mensagem    faltou sem justificar e ainda não recebeu o WhatsApp do SAC (ou faltou de novo depois da última mensagem)
//   aguardando  a mensagem foi; a pessoa ainda não ligou (dentro do prazo, ou já como "não respondeu")
//   base        2 tentativas sem retorno: a coordenação chama a pessoa para conversar
//   acomp       ligou, o SAC registrou a conversa: 30 dias de acompanhamento (antes x depois do contato)
//
// TENTATIVA = mensagem enviada que passou do prazo (fim do dia seguinte) sem a pessoa ligar, ou "não consegui falar"
// registrado à mão. A segunda só conta se a pessoa FALTOU DE NOVO depois da primeira. Conversa registrada zera tudo.
// Nada aqui fala com o banco: o api/ligacoes.js lê e entrega as listas.

"use strict";

const L = require("./_lig_regras");

const PRAZO_RESPOSTA_DIAS = 1;   // a pessoa tem até o fim do dia seguinte ao envio para ligar
const TENTATIVAS_PARA_BASE = 2;  // 2 tentativas sem retorno → "Chamar na base"
const DIAS_ACOMPANHAMENTO = L.JANELA_DIAS;
const COMECANDO_ATE_DIAS = 6;    // antes do 7º dia sem falta ainda é cedo para chamar de melhora

const iso = v => (v == null ? "" : String(v).slice(0, 10));
// carimbo UTC do banco → data de Brasília (UTC-3)
const dataSP = ts => { const t = Date.parse(ts); return isNaN(t) ? "" : new Date(t - 3 * 3600000).toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((Date.parse(iso(b) + "T12:00:00Z") - Date.parse(iso(a) + "T12:00:00Z")) / 86400000);
const conta = cod => cod === "I" || cod === "T"; // falta que pesa no antes x depois (abonada, afastamento e desligamento não)
const dataDoContato = c => iso(c.data_contato) || dataSP(c.criado_em);

// A mensagem venceu quando passou o dia seguinte ao envio.
const venceu = (dataEnvio, hoje) => iso(hoje) > L.somaDias(dataEnvio, PRAZO_RESPOSTA_DIAS);

// pend: datas das faltas injustificadas pendentes (asc); marcas: [{ data, manual }] asc (WhatsApp enviado ou "não consegui falar").
function tentativasSemRetorno(pend, marcas, hoje) {
  let n = 0, ultima = null;
  (marcas || []).forEach(m => {
    if (!pend.length || m.data < pend[0]) return;                 // mensagem de antes da falta não conta
    if (!(m.manual || venceu(m.data, hoje))) return;              // ainda dentro do prazo: está aguardando, não é tentativa
    if (ultima && !pend.some(d => d > ultima && d <= m.data)) return; // a seguinte precisa de falta nova
    n++; ultima = m.data;
  });
  return { n, ultima };
}

// antes (30 dias até o contato) x depois (do contato até hoje). Só falta injustificada ou tratada pesa.
function veredito(antes, depois, dias) {
  if (depois === 0 && dias <= COMECANDO_ATE_DIAS) return "comecando";
  if (depois === 0 || depois < antes) return "melhorando";
  if (depois === antes) return "mesma";
  return "piorou";
}

// Acordo com prazo: o sistema confere sozinho quando a planilha sobe. A falta combinada virou abonada (atestado no
// sistema) → cumpriu; passou o prazo e continua sem justificativa → não cumpriu; senão pendente. A marcação manual
// da coordenação (cumprido/descumprido) vale mais que a conferência.
function acordoAuto(c, hist, hoje) {
  if (!c || !c.acordo_prazo) return null;
  if (c.acordo_status === "cumprido") return "cumpriu";
  if (c.acordo_status === "descumprido") return "nao_cumpriu";
  const dc = dataDoContato(c);
  const alvo = iso(c.data_falta) || (hist.filter(h => h[0] <= dc).map(h => h[0]).sort().pop() || "");
  const cod = alvo ? (hist.find(h => h[0] === alvo) || [])[1] : "";
  if (cod === "A" || cod === "J" || cod === "L") return "cumpriu";
  return iso(c.acordo_prazo) < iso(hoje) ? "nao_cumpriu" : "pendente";
}

// faltas: [{ re, data, nome, posto, supervisor, codigo, tipo }] (≈105 dias, todos os códigos)
// contatos: lig_contatos já com { efetivo, baixa, acordo_prazo, acordo_status }
// envios: [{ chave:"RE|PRIMEIRONOME", data }] (WhatsApp enviado com sucesso)
// telefones: { RE: "+5519..." } só os enviáveis (pt_contatos)
// diasHist: quantos dias de histórico vão para a tela (o painel usa 105; o histórico geral de uma pessoa, mais)
function montarPainel({ hoje, faltas, contatos, envios, telefones, diasHist }) {
  hoje = iso(hoje);
  const desde30 = L.somaDias(hoje, -DIAS_ACOMPANHAMENTO);
  const pessoas = new Map(), porNome = new Map(), porRE = new Map();
  const nova = (re, nome, posto, sup) => ({ key: L.reDe(re) + "|" + L.primeiroNome(nome), re: L.reDe(re), nome: nome || "", posto: posto || "", supervisor: sup || "", hist: [], contatos: [], envios: [] });
  const indexa = p => { pessoas.set(p.key, p); porNome.set(L.norm(p.nome), p); if (p.re) porRE.set(p.re, p); };

  (faltas || []).forEach(f => {
    const k = L.reDe(f.re) + "|" + L.primeiroNome(f.nome);
    let p = pessoas.get(k);
    if (!p) { p = nova(f.re, f.nome, f.posto, f.supervisor); indexa(p); }
    if (f.posto) p.posto = f.posto;
    if (f.supervisor) p.supervisor = f.supervisor;
    p.hist.push([iso(f.data), f.codigo || "I", f.tipo === "HISTORICO"]);
  });

  (contatos || []).forEach(c => {
    const re = c.baixa && c.baixa.re ? L.reDe(c.baixa.re) : "";
    let p = (re && porRE.get(re)) || porNome.get(L.norm(c.colaborador));
    if (!p) {
      if (!(c.efetivo && diasEntre(dataDoContato(c), hoje) <= DIAS_ACOMPANHAMENTO)) return;
      p = nova(re, c.colaborador, c.posto, c.supervisor); indexa(p);
    }
    p.contatos.push(c);
  });

  (envios || []).forEach(e => { const p = pessoas.get(String(e.chave)); if (p) p.envios.push(iso(e.data)); });

  const saida = [];
  pessoas.forEach(p => {
    p.hist.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    p.envios.sort();
    const efetivos = p.contatos.filter(c => c.efetivo).sort((a, b) => dataDoContato(b).localeCompare(dataDoContato(a)) || (Number(b.id) || 0) - (Number(a.id) || 0));
    const ult = efetivos[0] || null;
    const dcUlt = ult ? dataDoContato(ult) : "";
    const telefone = (p.re && telefones && telefones[p.re]) || "";
    const base = { key: p.key, re: p.re, nome: p.nome, posto: p.posto, supervisor: p.supervisor, telefone, hist: p.hist.filter(h => h[0] >= L.somaDias(hoje, -(diasHist || 105))).map(h => [h[0], h[1]]), envios: p.envios };

    // 1) ligou e foi registrado há até 30 dias: acompanhamento
    if (ult && diasEntre(dcUlt, hoje) <= DIAS_ACOMPANHAMENTO) {
      if (p.hist.some(h => h[1] === "D")) return; // desligado: acabou o acompanhamento
      const dias = Math.max(0, diasEntre(dcUlt, hoje));
      const ini = L.somaDias(dcUlt, -DIAS_ACOMPANHAMENTO);
      const antesL = p.hist.filter(h => conta(h[1]) && h[0] >= ini && h[0] <= dcUlt).map(h => h[0]), antes = antesL.length;
      const depoisL = p.hist.filter(h => conta(h[1]) && h[0] > dcUlt && h[0] <= hoje).map(h => h[0]);
      const aboDepois = p.hist.filter(h => !conta(h[1]) && h[1] !== "D" && h[0] > dcUlt && h[0] <= hoje).length;
      const cobrando = p.hist.some(h => h[1] === "I" && h[0] >= ini && h[0] <= L.somaDias(dcUlt, DIAS_ACOMPANHAMENTO));
      saida.push({ ...base, situacao: "acomp",
        contato: { id: ult.id, data: dcUlt, por: ult.criado_por || "", canal: ult.canal || "", motivo: ult.motivo || "", justificativa: ult.justificativa || "", acordo: ult.acordo || "",
          acordo_prazo: ult.acordo_prazo || null, acordo_status: ult.acordo_status || null, acordo_auto: acordoAuto(ult, p.hist, hoje), baixa: ult.baixa || null },
        acomp: { dia: Math.min(dias, DIAS_ACOMPANHAMENTO), antes, depois: depoisL.length, abonadas_depois: aboDepois, ultima_falta_depois: depoisL.length ? depoisL[depoisL.length - 1] : null, faltas_depois: depoisL, faltas_antes: antesL,
          veredito: veredito(antes, depoisL.length, dias), sem_baixa: !ult.baixa && cobrando } });
      return;
    }

    // 2) sem conversa recente: faltas injustificadas pendentes depois da última conversa
    const pend = p.hist.filter(h => h[1] === "I" && !h[2] && h[0] >= desde30 && h[0] <= hoje && (!dcUlt || h[0] > dcUlt)).map(h => h[0]);
    if (!pend.length) return;
    const marcas = p.envios.map(d => ({ data: d, manual: false }))
      .concat(p.contatos.filter(c => !c.efetivo).map(c => ({ data: dataDoContato(c), manual: true })))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const t = tentativasSemRetorno(pend, marcas, hoje);
    const ultimaFalta = pend[pend.length - 1];
    const doPeriodo = marcas.filter(m => m.data >= pend[0]);
    const ultimaMarca = doPeriodo[doPeriodo.length - 1] || null;
    let situacao;
    if (t.n >= TENTATIVAS_PARA_BASE) situacao = "base";
    else if (!ultimaMarca || ultimaMarca.data < ultimaFalta) situacao = "mensagem";
    else situacao = "aguardando";
    saida.push({ ...base, situacao, faltas: pend, ultima_falta: ultimaFalta, tentativas: t.n, ultima_tentativa: t.ultima,
      ultima_marca: ultimaMarca ? ultimaMarca.data : null, ultima_marca_manual: !!(ultimaMarca && ultimaMarca.manual),
      envio: ultimaMarca ? (ultimaMarca.manual || venceu(ultimaMarca.data, hoje) ? "sem_retorno" : "prazo") : null,
      prazo_ate: ultimaMarca && !ultimaMarca.manual ? L.somaDias(ultimaMarca.data, PRAZO_RESPOSTA_DIAS) : null,
      mensagens: p.envios.filter(d => d >= pend[0]).length });
  });

  const ordem = { piorou: 0, mesma: 1, comecando: 2, melhorando: 3 };
  saida.sort((a, b) => {
    if (a.situacao === "acomp" && b.situacao === "acomp") return ordem[a.acomp.veredito] - ordem[b.acomp.veredito] || a.acomp.dia - b.acomp.dia || a.nome.localeCompare(b.nome);
    if (a.situacao === "base" && b.situacao === "base") return b.faltas.length - a.faltas.length || a.nome.localeCompare(b.nome);
    if (a.situacao === "aguardando" && b.situacao === "aguardando") return String(a.ultima_marca).localeCompare(String(b.ultima_marca)) || a.nome.localeCompare(b.nome);
    return String(a.faltas && a.faltas[0] || "").localeCompare(String(b.faltas && b.faltas[0] || "")) || a.nome.localeCompare(b.nome);
  });
  const resumo = { mensagem: 0, aguardando: 0, base: 0, acomp: 0, vereditos: { melhorando: 0, mesma: 0, piorou: 0, comecando: 0 } };
  saida.forEach(p => { resumo[p.situacao]++; if (p.acomp) resumo.vereditos[p.acomp.veredito]++; });
  return { pessoas: saida, resumo };
}

module.exports = { PRAZO_RESPOSTA_DIAS, TENTATIVAS_PARA_BASE, DIAS_ACOMPANHAMENTO, venceu, tentativasSemRetorno, veredito, acordoAuto, montarPainel, dataSP, dataDoContato, diasEntre };
