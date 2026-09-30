// api/_faltas_regras.js — regras do módulo Faltas x Medidas. Funções puras:
// sem banco, sem rede, sem relógio (o "hoje" vem de fora), para serem testadas.
//
// O caminho de uma falta injustificada (código I da Ficha de Presença):
//   1ª falta → a pessoa volta ao trabalho (retorno) → prazo para aplicar a medida
//   · 5x2 e 6x1: 3 dias de trabalho, contando o dia do retorno
//   · 12x36:     2 plantões, contando o dia do retorno
// A medida é presencial (a pessoa assina), por isso o prazo conta do retorno.
// Qualquer medida do SAR2G dentro do prazo, por qualquer motivo, cobre a falta:
// é o que impede punir duas vezes. Medida anterior à falta não cobre (reset).

const FAMILIAS = {
  "5X2": { prazo: 3, folgaNaSemana: new Set([0, 6]) }, // folga sábado e domingo
  "6X1": { prazo: 3, folgaNaSemana: new Set([0]) },    // folga domingo (todas as siglas 6x1)
  "12X36": { prazo: 2, alternado: true }                // dia sim, dia não
};

const ABONADAS = new Set(["A", "J", "L"]); // abonada · justificada · licença

const SITUACOES = {
  AGUARDANDO_RETORNO: "AGUARDANDO_RETORNO",
  NO_PRAZO: "NO_PRAZO",
  TRATADA: "TRATADA",
  TRATADA_FORA_DO_PRAZO: "TRATADA_FORA_DO_PRAZO",
  PRAZO_VENCIDO: "PRAZO_VENCIDO",
  COORDENACAO: "COORDENACAO",
  VERIFICAR: "VERIFICAR"
};

// ── datas (texto AAAA-MM-DD, contas em UTC para não depender do fuso) ────────
function iso(v) { return v == null ? "" : String(v).slice(0, 10); }
function paraData(d) { const [a, m, dd] = iso(d).split("-").map(Number); return new Date(Date.UTC(a, m - 1, dd)); }
function somaDias(d, n) { const x = paraData(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function diasEntre(a, b) { return Math.round((paraData(b) - paraData(a)) / 86400000); }
function diaDaSemana(d) { return paraData(d).getUTCDay(); }
function ddmm(d) { const [, m, dd] = iso(d).split("-"); return dd + "/" + m; }
const NOME_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function ddmmSemana(d) { return NOME_DIA[diaDaSemana(d)] + " " + ddmm(d); }
// "07/10", "07/10 e 08/10", "07/10, 08/10 e 09/10"
function emLista(itens) { return itens.length < 2 ? itens.join("") : itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1]; }

// ── quem entra no módulo ─────────────────────────────────────────────────────
function familiaEscala(escala) {
  const e = String(escala || "").toUpperCase().replace(/\s+/g, "");
  if (e.startsWith("12X36")) return "12X36";
  if (e.startsWith("6X1")) return "6X1";
  if (e.startsWith("5X2")) return "5X2";
  return null;
}
function ehOperacional(tipo) { return String(tipo || "").toUpperCase().trim() !== "DEPARTAMENTO"; }
function reDe(v) { const s = String(v == null ? "" : v).trim().replace(/\.0+$/, ""); return /^\d+$/.test(s) ? String(Number(s)) : s; }

// Situação do dia na Ficha de Presença → a pessoa estava lá?
// true = trabalhou · false = não trabalhou (folga, férias, afastamento...) · null = não diz.
// "FALT" fica de fora de propósito: a falta vem da lista de faltas, com o código.
// Valores reais do SAR2G (29/09): TRABALHO, FOLGA, FALTA, LIB. PAR. COB., LIB. PAR. FUNC., LIB. TOTAL.
// Liberação parcial = a pessoa esteve lá; liberação total = dispensada do dia.
const NAO_TRABALHOU = ["FALT", "AUSEN", "FOLGA", "FERIAS", "FÉRIAS", "INSS", "AFAST", "ATESTADO", "LICEN", "SUSPENS", "ABANDONO", "DESLIG", "DEMIT", "LIB. TOTAL", "LIB TOTAL"];
function trabalhouNoDia(situacoes) {
  if (situacoes == null || String(situacoes).trim() === "") return null;
  const lista = String(situacoes).toUpperCase().split("|").map(s => s.trim()).filter(s => s && s !== "—");
  if (!lista.length) return null;
  return lista.some(s => !NAO_TRABALHOU.some(p => s.includes(p)));
}

// ── agenda de uma pessoa ─────────────────────────────────────────────────────
// Diz, para cada dia, se era dia de trabalho e se a pessoa estava presente.
// Dia até a data da planilha: o que a Ficha de Presença diz manda.
// Depois dela (futuro): previsão pela escala. Feriado só conta como dia de
// trabalho se a pessoa teve presença nele (regra da coordenação).
// A 5X2 DSF ("FOLGA DOM/SEG/FER") folga domingo e segunda, não sábado e domingo.
function folgasDaEscala(familia, escala) {
  const e = String(escala || "").toUpperCase();
  if (familia === "5X2" && (/DOM\/SEG/.test(e) || /\bDSF\b/.test(e))) return new Set([0, 1]);
  return FAMILIAS[familia].folgaNaSemana;
}

function agenda({ familia, escala, ancora, dias, faltasPorDia, feriados, dataBase }) {
  const F = FAMILIAS[familia];
  const folgas = F.alternado ? null : folgasDaEscala(familia, escala);
  const escalado = d => {
    if (F.alternado) return ((diasEntre(ancora, d) % 2) + 2) % 2 === 0;
    return !folgas.has(diaDaSemana(d));
  };
  return function (d) {
    const falta = faltasPorDia[d];
    if (falta) return { trabalho: true, presente: false, falta: falta.codigo };
    const t = trabalhouNoDia(dias[d]);
    if (t === true) return { trabalho: true, presente: true };
    if (t === false) return { trabalho: false, presente: false };
    if (feriados.has(d)) return { trabalho: false, presente: false, feriado: true };
    // sem registro: segue a escala, sem afirmar presença
    return { trabalho: escalado(d), presente: null, previsto: d > dataBase };
  };
}

// Próximos n dias de trabalho a partir de "inicio" (inclusive).
function proximosDiasDeTrabalho(dia, inicio, n) {
  const out = [];
  for (let d = inicio, guarda = 0; out.length < n && guarda < 60; d = somaDias(d, 1), guarda++) {
    if (dia(d).trabalho) out.push(d);
  }
  return out;
}

function descreverMedida(m) {
  if (!m) return "";
  const tipo = String(m.TIPO || "").toUpperCase();
  if (tipo.startsWith("SUSPENS")) return "suspensão" + (Number(m.DIAS) ? " de " + Number(m.DIAS) + " dia(s)" : "");
  const grau = String(m.GRAU || "").toUpperCase();
  return "advertência" + (grau === "VERBAL" ? " verbal" : grau === "ESCRITA" ? " escrita" : "");
}
const cancelada = m => String(m && m.FASE || "").toUpperCase().includes("CANCEL");

// Texto do alerta de medida lançada com a pessoa ausente: o motivo por extenso,
// com os dados do caso, para a coordenação entender sem abrir mais nada.
function textoMedidaComAusencia(caso, medida, outra) {
  const faltou = emLista(caso.faltas.map(ddmm));
  const volta = caso.retorno ? "só voltou em " + ddmm(caso.retorno) : "ainda não voltou";
  let t = "⚠ Medida registrada enquanto o colaborador estava ausente. " +
    `${caso.nome} (RE ${caso.re}) faltou em ${faltou}, e ${volta}. ` +
    `No SAR2G consta ${descreverMedida(medida)} com data de ${ddmm(medida.DATA)}` +
    (caso.supervisor ? ` (supervisor da equipe: ${caso.supervisor})` : "") +
    ", quando a pessoa ainda não tinha voltado. A medida precisa ser assinada presencialmente, então essa data não bate com a presença. ";
  t += outra
    ? `Depois, em ${ddmm(outra.DATA)}, foi lançada outra medida (${descreverMedida(outra)}): a mesma falta pode ter sido punida duas vezes. `
    : "Risco: se aplicarem outra medida agora pela mesma falta, a pessoa terá sido punida duas vezes. ";
  t += "O que conferir: se a data foi lançada errada no SAR2G, ou se a medida foi mesmo aplicada sem a pessoa presente.";
  return t;
}

// ── os casos ─────────────────────────────────────────────────────────────────
// entrada:
//   faltas     [{ RE, NOME, DATA, ABONO, CARGO, LOCAL, AREA, ESCALA, TIPO }]
//   fichaDias  { RE: { "AAAA-MM-DD": "SITUACAO|SITUACAO" } }
//   medidas    [{ RE, DATA, TIPO, GRAU, DIAS, FASE, HIST, MOTIVO }]
//   admissoes  { RE: "AAAA-MM-DD" }   (RE reaproveitado: o que é de antes não vale)
//   hoje, dataBase (último dia que a planilha cobre), feriados [datas]
function montarCasos(entrada) {
  const e = entrada || {};
  const hoje = iso(e.hoje);
  const feriados = new Set((e.feriados || []).map(iso));
  const fichaDias = e.fichaDias || {};
  const admissoes = e.admissoes || {};
  let dataBase = iso(e.dataBase);
  if (!dataBase) {
    const todas = [];
    Object.values(fichaDias).forEach(m => Object.keys(m || {}).forEach(d => todas.push(d)));
    (e.faltas || []).forEach(f => todas.push(iso(f.DATA)));
    dataBase = todas.sort().pop() || hoje;
  }

  const porRE = new Map();
  let foraDoModulo = 0;
  (e.faltas || []).forEach(f => {
    const re = reDe(f.RE), data = iso(f.DATA);
    if (!re || !data) return;
    const familia = familiaEscala(f.ESCALA);
    if (!familia || !ehOperacional(f.TIPO)) { foraDoModulo++; return; }
    const adm = iso(admissoes[re]);
    if (adm && data < adm) return; // falta de quem teve o RE antes
    if (!porRE.has(re)) porRE.set(re, []);
    porRE.get(re).push({ ...f, re, data, familia, codigo: String(f.ABONO || "").toUpperCase().trim() });
  });

  const medidasPorRE = new Map();
  (e.medidas || []).forEach(m => {
    const re = reDe(m.RE), data = iso(m.DATA);
    if (!re || !data || cancelada(m)) return;
    const adm = iso(admissoes[re]);
    if (adm && data < adm) return;
    if (!medidasPorRE.has(re)) medidasPorRE.set(re, []);
    medidasPorRE.get(re).push({ ...m, DATA: data });
  });
  medidasPorRE.forEach(l => l.sort((a, b) => (a.DATA < b.DATA ? -1 : a.DATA > b.DATA ? 1 : 0)));

  const casos = [], abonadas = [], semCodigo = [];
  for (const [re, lista] of porRE) {
    lista.sort((a, b) => (a.data < b.data ? -1 : 1));
    const faltasPorDia = {};
    lista.forEach(f => { faltasPorDia[f.data] = f; });
    // Só A, J e L são abonadas. Falta sem código ainda não foi classificada no
    // SAR2G: não vira caso nem entra nas abonadas; conta em semCodigo.
    lista.filter(f => ABONADAS.has(f.codigo)).forEach(f => abonadas.push(pessoa(f, { data: f.data, codigo: f.codigo })));
    lista.filter(f => f.codigo !== "I" && !ABONADAS.has(f.codigo)).forEach(f => semCodigo.push(pessoa(f, { data: f.data })));
    const injust = lista.filter(f => f.codigo === "I");
    const medidas = medidasPorRE.get(re) || [];
    const ref = injust[injust.length - 1] || lista[lista.length - 1];

    let i = 0;
    while (i < injust.length) {
      const f1 = injust[i];
      const F = FAMILIAS[f1.familia];
      const dia = agenda({ familia: f1.familia, escala: f1.ESCALA, ancora: f1.data, dias: fichaDias[re] || {}, faltasPorDia, feriados, dataBase });
      const caso = pessoa(ref, {});
      Object.assign(caso, { familia: f1.familia, escala: f1.ESCALA || "", primeiraFalta: f1.data, faltas: [f1.data], retorno: null, retornoPrevisto: null, prazo: [], prazoFim: null, medida: null, situacao: null, motivo: "" });

      // 1. depois da 1ª falta: volta ou continua faltando?
      let seguidas = 0, ultimaFalta = f1.data, retorno = null, coord = false;
      for (let d = somaDias(f1.data, 1), guarda = 0; guarda < 90 && d <= dataBase; d = somaDias(d, 1), guarda++) {
        const x = dia(d);
        if (!x.trabalho) continue;
        if (x.falta === "I") { seguidas++; ultimaFalta = d; caso.faltas.push(d); if (seguidas >= F.prazo) { coord = true; break; } continue; }
        if (x.presente === true) { retorno = d; break; }
        // falta abonada ou dia sem registro: não conta como retorno nem como falta
      }
      // o SAR2G marca abandono trocando o posto por "ABANDONO"
      const abandono = injust.some(f => f.data >= f1.data && f.data <= ultimaFalta && /ABANDONO/i.test(String(f.LOCAL || "")));

      if (coord || abandono) {
        caso.situacao = SITUACOES.COORDENACAO;
        const unidade = f1.familia === "12X36" ? (seguidas === 1 ? "plantão" : "plantões") : (seguidas === 1 ? "dia de trabalho" : "dias de trabalho");
        caso.motivo = abandono
          ? "Marcado como ABANDONO no SAR2G."
          : `Continua faltando: faltou em ${ddmmSemana(f1.data)} e em mais ${seguidas} ${unidade} seguidos sem voltar (${emLista(caso.faltas.slice(1).map(ddmmSemana))}).`;
        // as faltas seguintes, sem presença no meio, são a mesma ausência
        let k = injust.findIndex(f => f.data > ultimaFalta);
        while (k >= 0 && k < injust.length && !presencaEntre(dia, ultimaFalta, injust[k].data)) { caso.faltas.push(injust[k].data); ultimaFalta = injust[k].data; k++; }
        caso.faltas = [...new Set(caso.faltas)].sort();
        aplicarMedida(caso, medidas);
        casos.push(caso);
        if (k < 0 || k >= injust.length) break;
        i = k;
        continue;
      }

      if (!retorno) {
        caso.situacao = SITUACOES.AGUARDANDO_RETORNO;
        // próximo dia de trabalho depois da última falta; se esse dia já passou
        // sem registro na planilha, o próximo depois do último dia da planilha
        const inicio = somaDias(ultimaFalta >= dataBase ? ultimaFalta : dataBase, 1);
        caso.retornoPrevisto = proximosDiasDeTrabalho(dia, inicio, 1)[0] || null;
        aplicarMedida(caso, medidas);
        casos.push(caso);
        i = injust.findIndex(f => f.data > ultimaFalta);
        if (i < 0) break;
        continue;
      }

      // 2. voltou: o prazo são os próximos dias de trabalho, contando o retorno
      caso.retorno = retorno;
      caso.prazo = proximosDiasDeTrabalho(dia, retorno, F.prazo);
      caso.prazoFim = caso.prazo[caso.prazo.length - 1] || retorno;
      // falta de novo dentro do prazo: mesmo caso, o prazo não muda
      injust.forEach(f => { if (f.data > retorno && f.data <= caso.prazoFim) caso.faltas.push(f.data); });
      caso.faltas = [...new Set(caso.faltas)].sort();
      caso.situacao = hoje > caso.prazoFim ? SITUACOES.PRAZO_VENCIDO : SITUACOES.NO_PRAZO;
      aplicarMedida(caso, medidas);
      casos.push(caso);
      i = injust.findIndex(f => f.data > caso.prazoFim);
      if (i < 0) break;
    }
  }
  return { casos, abonadas, semCodigo, foraDoModulo, dataBase };
}

function presencaEntre(dia, de, ate) {
  for (let d = somaDias(de, 1); d < ate; d = somaDias(d, 1)) if (dia(d).presente === true) return true;
  return false;
}

// A primeira medida válida a partir da 1ª falta decide o caso.
function aplicarMedida(caso, medidas) {
  const validas = medidas.filter(m => m.DATA >= caso.primeiraFalta);
  if (!validas.length) {
    if (caso.situacao === SITUACOES.PRAZO_VENCIDO) caso.motivo = `Voltou em ${ddmm(caso.retorno)} e o prazo acabou em ${ddmm(caso.prazoFim)} sem medida. Aplicar no mínimo uma advertência.`;
    return;
  }
  const m = validas[0];
  const antesDoRetorno = caso.retorno ? m.DATA < caso.retorno : true;
  if (antesDoRetorno && caso.situacao !== SITUACOES.COORDENACAO) {
    caso.medida = m;
    caso.situacao = SITUACOES.VERIFICAR;
    caso.motivo = textoMedidaComAusencia(caso, m, validas[1]);
    return;
  }
  caso.medida = m;
  if (caso.situacao === SITUACOES.COORDENACAO) { caso.motivo += ` Há ${descreverMedida(m)} em ${ddmm(m.DATA)}.`; return; }
  if (caso.prazoFim && m.DATA <= caso.prazoFim) { caso.situacao = SITUACOES.TRATADA; caso.motivo = `${descreverMedida(m)} em ${ddmm(m.DATA)}, dentro do prazo.`; }
  else { caso.situacao = SITUACOES.TRATADA_FORA_DO_PRAZO; caso.motivo = `${descreverMedida(m)} em ${ddmm(m.DATA)}, depois do prazo (acabava em ${ddmm(caso.prazoFim)}).`; }
}

// Folha do dia 26 ao dia 25 do mês seguinte (a mesma competência do ponto).
function competenciaDe(d) {
  let [a, m, dd] = iso(d).split("-").map(Number);
  if (dd < 26) { m -= 1; if (m < 1) { m = 12; a -= 1; } }
  const p = n => String(n).padStart(2, "0");
  const inicio = `${a}-${p(m)}-26`;
  let a2 = a, m2 = m + 1; if (m2 > 12) { m2 = 1; a2 += 1; }
  return { inicio, fim: `${a2}-${p(m2)}-25` };
}

// Os quadradinhos do card: um por dia da folha em que a 1ª falta caiu.
// Calculado aqui, com a mesma regra do prazo, para a tela nunca mostrar uma
// cor que não bate com a conta.
function calendario(caso, opcoes) {
  const o = opcoes || {};
  const dias = o.dias || {}, abon = new Set(o.abonadas || []), feriados = new Set((o.feriados || []).map(iso)), hoje = iso(o.hoje);
  const faltas = new Set(caso.faltas || []), prazo = new Set(caso.prazo || []);
  const medida = caso.medida && iso(caso.medida.DATA);
  // A folha da 1ª falta; se o prazo (ou o retorno, ou a medida) passa para a
  // folha seguinte, vai até ele: falta no dia 25 tem o prazo inteiro no mês seguinte.
  const folha = competenciaDe(caso.primeiraFalta);
  let inicio = folha.inicio;
  let fim = [folha.fim, caso.prazoFim, caso.retornoPrevisto, medida].filter(Boolean).sort().pop();
  // meses: calendário de mês cheio (dia 1 ao último), com um mês a mais de
  // cada lado, para a tela poder passar de um mês para o outro
  if (o.meses) {
    const mes = (d, n) => { let [a, m] = d.split("-").map(Number); m += n; while (m < 1) { m += 12; a -= 1; } while (m > 12) { m -= 12; a += 1; } return `${a}-${String(m).padStart(2, "0")}-01`; };
    inicio = mes(caso.primeiraFalta, -1);
    fim = somaDias(mes([fim, hoje].filter(Boolean).sort().pop(), 2), -1);
  }
  const out = [];
  for (let d = inicio; d <= fim; d = somaDias(d, 1)) {
    let tipo;
    // medida lançada num dia de falta: o dia continua falta (é o que explica o
    // alerta "medida com a pessoa ausente"), com a marca da medida por cima
    if (faltas.has(d)) tipo = "FALTA";
    else if (d === medida) tipo = "MEDIDA";
    else if (abon.has(d)) tipo = "ABONADA";
    else if (d === caso.retorno) tipo = "RETORNO";
    else if (d === caso.retornoPrevisto) tipo = "RETORNO_PREVISTO";
    else if (prazo.has(d)) tipo = "PRAZO";
    else {
      // feriado sem presença aparece como feriado; com presença, é dia trabalhado
      // (a marca "feriado" vai junto, para a tela mostrar os dois)
      const t = trabalhouNoDia(dias[d]);
      tipo = t === true ? "TRABALHOU" : feriados.has(d) ? "FERIADO" : t === false ? "FOLGA" : "";
    }
    out.push({ data: d, dia: Number(d.slice(8, 10)), semana: diaDaSemana(d), tipo, medida: d === medida, hoje: d === hoje, futuro: hoje ? d > hoje : false, noPrazo: prazo.has(d), feriado: feriados.has(d), fimDoPrazo: d === caso.prazoFim, naFolha: d >= folha.inicio && d <= folha.fim });
  }
  return out;
}

// Abonadas juntadas pelo período que o abono cobriu, lido da Ficha de Presença
// (sem tabela nova): dias da mesma pessoa, com o mesmo código, um seguido do
// outro. Pode pular até 4 dias em que ela não trabalhou (folga ou feriado no
// meio do atestado); um dia trabalhado no meio separa em dois períodos.
function periodosDeAbono(abonadas, fichaDias, lancadas) {
  // lancadas: { "re|data": "AAAA-MM-DD" } = dia em que o sistema percebeu que a falta
  // deixou de ser injustificada (o atestado chegou depois)
  const grupos = {};
  (abonadas || []).forEach(a => { const k = a.re + "|" + a.codigo; (grupos[k] = grupos[k] || []).push(a); });
  const out = [];
  Object.values(grupos).forEach(lista => {
    lista.sort((x, y) => iso(x.data).localeCompare(iso(y.data)));
    const dias = (fichaDias || {})[lista[0].re] || {};
    let atual = null;
    lista.forEach(a => {
      const d = iso(a.data);
      let junta = false;
      if (atual && d > atual.fim) {
        const vazios = [];
        for (let x = somaDias(atual.fim, 1); x < d; x = somaDias(x, 1)) vazios.push(x);
        junta = vazios.length <= 4 && vazios.every(x => trabalhouNoDia(dias[x]) !== true);
      }
      if (junta) { atual.fim = d; atual.faltas.push(d); return; }
      atual = { re: a.re, nome: a.nome, cargo: a.cargo, posto: a.posto, supervisor: a.supervisor, escala: a.escala, codigo: a.codigo, faltas: [d], inicio: d, fim: d };
      out.push(atual);
    });
  });
  out.forEach(p => {
    p.dias = Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 864e5) + 1;
    const quando = p.faltas.map(d => (lancadas || {})[p.re + "|" + d]).filter(Boolean).sort();
    p.lancadoDepois = quando.length > 0;
    p.lancadoEm = quando.length ? quando[quando.length - 1] : null;
  });
  return out.sort((x, y) => y.fim.localeCompare(x.fim) || String(x.nome).localeCompare(String(y.nome)));
}

function pessoa(f, extra) {
  return { re: reDe(f.RE), nome: f.NOME || "", cargo: f.CARGO || "", posto: f.LOCAL || "", supervisor: f.AREA || "", escala: f.ESCALA || "", ...extra };
}

module.exports = {
  FAMILIAS, SITUACOES, ABONADAS, familiaEscala, ehOperacional, trabalhouNoDia, montarCasos, reDe, competenciaDe, calendario, periodosDeAbono,
  textoMedidaComAusencia, descreverMedida, somaDias, ddmm
};
