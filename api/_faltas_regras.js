// api/_faltas_regras.js — regras do módulo Faltas x Medidas. Funções puras:
// sem banco, sem rede, sem relógio (o "hoje" vem de fora), para serem testadas.
//
// O caminho de uma falta injustificada (código I da Ficha de Presença), em TODAS as escalas:
//   1ª falta → o prazo para aplicar a medida é até o PRÓXIMO PLANTÃO da pessoa (o próximo dia de trabalho depois da falta)
//   · se ela volta nesse plantão, o prazo termina nele; se ainda não voltou, o prazo é a data prevista do plantão
//   · se esse plantão passa e a planilha não mostra a volta, segue faltando e a coordenação decide
// A medida é presencial (a pessoa assina), por isso o prazo é o dia em que ela volta ao trabalho.
// Qualquer medida do SAR2G dentro do prazo, por qualquer motivo, cobre a falta:
// é o que impede punir duas vezes. Medida anterior à falta não cobre (reset).

const FAMILIAS = {
  // prazo = quantos dias de trabalho seguidos sem voltar mandam o caso para a coordenação (não é o prazo da medida)
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
  COORDENACAO: "COORDENACAO"
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
    // supervisor, posto e cargo do caso: os mais recentes da pessoa (quem cuida da área hoje)
    const ref = injust[injust.length - 1] || lista[lista.length - 1];
    const usadas = new Set(); // medidas que já explicaram um caso anterior desta pessoa

    let i = 0;
    while (i < injust.length) {
      const f1 = injust[i];
      const F = FAMILIAS[f1.familia];
      const dia = agenda({ familia: f1.familia, escala: f1.ESCALA, ancora: f1.data, dias: fichaDias[re] || {}, faltasPorDia, feriados, dataBase });
      // dias sem trabalho entre a 1ª falta e hoje (folga da escala, férias, feriado não): aparecem como folga no calendário de quem continua faltando
      const folgasAte = d => { const l = []; for (let x = somaDias(f1.data, 1), g = 0; x <= d && g < 120; x = somaDias(x, 1), g++) { const y = dia(x); if (!y.trabalho && !y.feriado && y.presente !== true) l.push(x); } return l; };
      // dias de trabalho, depois do dia em que devia ter voltado, em que a planilha não mostra a pessoa de volta
      const semVoltaAte = (de, ate) => { const l = []; for (let x = de, g = 0; x && x <= ate && g < 120; x = somaDias(x, 1), g++) { const y = dia(x); if (y.trabalho && y.presente !== true) l.push(x); } return l; };
      const caso = pessoa(ref, {});
      Object.assign(caso, { familia: f1.familia, escala: f1.ESCALA || "", primeiraFalta: f1.data, faltas: [f1.data], retorno: null, retornoPrevisto: null, prazo: [], prazoFim: null, medida: null, situacao: null, motivo: "" });

      // 1. depois da 1ª falta: volta ou continua faltando?
      let seguidas = 0, ultimaFalta = f1.data, retorno = null, coord = false, primeiroTrabalho = null;
      for (let d = somaDias(f1.data, 1), guarda = 0; guarda < 90 && d <= dataBase; d = somaDias(d, 1), guarda++) {
        const x = dia(d);
        if (!x.trabalho) continue;
        if (!primeiroTrabalho) primeiroTrabalho = d;
        if (x.falta === "I") { seguidas++; ultimaFalta = d; caso.faltas.push(d); if (seguidas >= F.prazo) { coord = true; break; } continue; }
        if (x.presente === true) { retorno = d; break; }
        // falta abonada ou dia sem registro: não conta como retorno nem como falta
      }
      // o SAR2G marca abandono trocando o posto por "ABANDONO"
      // ou a Ficha de Presença passa a marcar ABANDONO num dia depois da primeira falta (alguém tirou a pessoa da pasta de ativos)
      const diasFicha = fichaDias[re] || {};
      const abandono = injust.some(f => f.data >= f1.data && f.data <= ultimaFalta && /ABANDONO/i.test(String(f.LOCAL || "")))
        || Object.keys(diasFicha).some(d => d > f1.data && d <= dataBase && /ABANDONO/i.test(String(diasFicha[d] || "")));

      if (coord || abandono) {
        caso.situacao = SITUACOES.COORDENACAO;
        const unidade = f1.familia === "12X36" ? (seguidas === 1 ? "plantão" : "plantões") : (seguidas === 1 ? "dia de trabalho" : "dias de trabalho");
        caso.motivo = abandono
          ? "Marcado como ABANDONO no SAR2G."
          : `Continua faltando: faltou em ${ddmmSemana(f1.data)} e em mais ${seguidas} ${unidade} seguidos sem voltar (${emLista(caso.faltas.slice(1).map(ddmmSemana))}).`;
        if (abandono) {
          // desde quando: o 1º dia em que o SAR2G trocou o posto por ABANDONO ou a ficha passou a marcar abandono
          const diasF = fichaDias[re] || {};
          const datas = injust.filter(f => f.data >= f1.data && /ABANDONO/i.test(String(f.LOCAL || ""))).map(f => f.data)
            .concat(Object.keys(diasF).filter(d => d >= f1.data && /ABANDONO/i.test(String(diasF[d] || "")))).sort();
          // O SAR2G troca o posto de TODAS as faltas por ABANDONO: isso não diz quando o abandono foi marcado.
          // A data só vale se a Ficha de Presença marcar abandono em algum dia; senão fica em branco.
          const fichaAband = Object.keys(diasF).filter(d => d >= f1.data && /ABANDONO/i.test(String(diasF[d] || ""))).sort();
          caso.abandono = true;
          caso.abandonoDesde = fichaAband[0] || "";
          const antes = lista.filter(f => f.LOCAL && !/ABANDONO/i.test(String(f.LOCAL)));
          caso.postoAnterior = antes.length ? String(antes[antes.length - 1].LOCAL) : "";
          caso.motivo = caso.abandonoDesde ? `Abandono marcado no SAR2G em ${ddmmSemana(caso.abandonoDesde)}. Faltando desde ${ddmmSemana(f1.data)}.` : `Abandono marcado no SAR2G (a planilha não informa a data). Faltando desde ${ddmmSemana(f1.data)}.`;
        } else {
          caso.continua = true;
          caso.deveriaTerVoltado = primeiroTrabalho;
          caso.folgas = folgasAte(hoje && hoje > dataBase ? hoje : dataBase);
        }
        // as faltas seguintes, sem presença no meio, são a mesma ausência
        let k = injust.findIndex(f => f.data > ultimaFalta);
        while (k >= 0 && k < injust.length && !presencaEntre(dia, ultimaFalta, injust[k].data)) { caso.faltas.push(injust[k].data); ultimaFalta = injust[k].data; k++; }
        caso.faltas = [...new Set(caso.faltas)].sort();
        aplicarMedida(caso, medidas, usadas);
        casos.push(caso);
        if (k < 0 || k >= injust.length) break;
        i = k;
        continue;
      }

      if (!retorno) {
        // próximo dia de trabalho depois da última falta; se esse dia já passou
        // sem registro na planilha, o próximo depois do último dia da planilha
        const inicio = somaDias(ultimaFalta >= dataBase ? ultimaFalta : dataBase, 1);
        caso.retornoPrevisto = proximosDiasDeTrabalho(dia, inicio, 1)[0] || null;
        // o prazo para aplicar a medida é até esse próximo plantão
        caso.situacao = caso.retornoPrevisto ? SITUACOES.NO_PRAZO : SITUACOES.AGUARDANDO_RETORNO;
        if (caso.retornoPrevisto) { caso.prazo = [caso.retornoPrevisto]; caso.prazoFim = caso.retornoPrevisto; caso.semRetorno = true; }
        aplicarMedida(caso, medidas, usadas);
        // A volta prevista já passou e a planilha não mostra a pessoa de volta: segue faltando, e a coordenação decide.
        // Quando a planilha for atualizada e mostrar a volta, o caso sai daqui sozinho (tudo é recalculado a cada leitura).
        if (caso.semRetorno && caso.situacao === SITUACOES.NO_PRAZO && hoje && caso.retornoPrevisto && caso.retornoPrevisto < hoje) {
          caso.situacao = SITUACOES.COORDENACAO;
          caso.prazo = []; caso.prazoFim = null; caso.semRetorno = false; // sem prazo: quem decide é a coordenação
          caso.motivo = `Continua faltando: era para ter voltado em ${ddmmSemana(caso.retornoPrevisto)} e a planilha ainda não mostra a volta.`;
          caso.continua = true;
          caso.deveriaTerVoltado = caso.retornoPrevisto;
          caso.folgas = folgasAte(hoje);
          caso.continuouEm = semVoltaAte(somaDias(caso.retornoPrevisto, 1), hoje);
        }
        casos.push(caso);
        i = injust.findIndex(f => f.data > ultimaFalta);
        if (i < 0) break;
        continue;
      }

      // 2. voltou: o prazo é até o próximo plantão, que é o dia em que a pessoa voltou
      caso.retorno = retorno;
      caso.prazo = [retorno];
      caso.prazoFim = retorno;
      caso.situacao = hoje > caso.prazoFim ? SITUACOES.PRAZO_VENCIDO : SITUACOES.NO_PRAZO;
      aplicarMedida(caso, medidas, usadas);
      casos.push(caso);
      // falta depois do retorno é outro caso, com o prazo do próximo plantão dela
      i = injust.findIndex(f => f.data > retorno);
      if (i < 0) break;
    }
  }
  return { casos, abonadas, semCodigo, foraDoModulo, dataBase };
}

function presencaEntre(dia, de, ate) {
  for (let d = somaDias(de, 1); d < ate; d = somaDias(d, 1)) if (dia(d).presente === true) return true;
  return false;
}

// A primeira medida válida a partir da 1ª falta decide o caso. Uma medida cobre
// todas as faltas anteriores a ela (pode resolver mais de um caso). Mas a medida
// que já resolveu um caso anterior e foi lançada antes de ESTE caso voltar é
// daquele caso: não vale aqui.
const chaveMedida = m => m.HIST || m.chave || [m.RE, m.DATA, m.TIPO, m.GRAU].join("|");
function aplicarMedida(caso, medidas, usadas) {
  const u = usadas || new Set();
  const validas = medidas.filter(m => m.DATA >= caso.primeiraFalta && !(u.has(chaveMedida(m)) && (caso.retorno ? m.DATA < caso.retorno : true)));
  aplicarMedidaValida(caso, validas);
  if (caso.medida) u.add(chaveMedida(caso.medida));
}
function aplicarMedidaValida(caso, validas) {
  if (!validas.length) {
    if (caso.situacao === SITUACOES.PRAZO_VENCIDO) caso.motivo = `O prazo era até o próximo plantão, ${ddmmSemana(caso.prazoFim)}, e ainda não há medida.`;
    return;
  }
  const m = validas[0];
  caso.medida = m;
  if (caso.situacao === SITUACOES.COORDENACAO) { caso.motivo += ` Há ${descreverMedida(m)} em ${ddmm(m.DATA)}.`; return; }
  // medida lançada enquanto a pessoa ainda faltava: conta como medida aplicada
  if (!caso.retorno || m.DATA < caso.retorno) { caso.situacao = SITUACOES.TRATADA; caso.motivo = `${descreverMedida(m)} em ${ddmm(m.DATA)}, antes do retorno.`; return; }
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
  const continuouEm = new Set(caso.continuouEm || []), cont = !!caso.continua, devia = caso.deveriaTerVoltado || null, folgasC = new Set(caso.folgas || []), aband = caso.abandonoDesde || null;
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
    // abandono: do dia em que o SAR2G marcou até hoje; continua faltando: o dia em que devia ter voltado e as faltas seguidas
    if (aband && d >= aband && (!hoje || d <= hoje)) tipo = "ABANDONO";
    else if (cont && d === devia) tipo = "DEVIA_VOLTAR";
    else if (cont && continuouEm.has(d)) tipo = "CONTINUOU";
    // medida lançada num dia de falta: o dia continua falta, com a marca da medida por cima
    else if (faltas.has(d)) tipo = cont && d !== caso.primeiraFalta ? "CONTINUOU" : "FALTA";
    else if (d === medida) tipo = "MEDIDA";
    else if (abon.has(d)) tipo = "ABONADA";
    else if (caso.prazoFim && d === caso.prazoFim) tipo = "PRAZO";
    else if (d === caso.retorno) tipo = "RETORNO";
    else if (d === caso.retornoPrevisto) tipo = "RETORNO_PREVISTO";
    else if (prazo.has(d)) tipo = "PRAZO";
    else {
      // feriado sem presença aparece como feriado; com presença, é dia trabalhado
      // (a marca "feriado" vai junto, para a tela mostrar os dois)
      const t = trabalhouNoDia(dias[d]);
      tipo = t === true ? "TRABALHOU" : feriados.has(d) ? "FERIADO" : t === false ? "FOLGA" : "";
      if (!tipo && folgasC.has(d)) tipo = "FOLGA";
    }
    out.push({ data: d, dia: Number(d.slice(8, 10)), semana: diaDaSemana(d), tipo, medida: d === medida, hoje: d === hoje, futuro: hoje ? d > hoje : false, noPrazo: prazo.has(d), feriado: feriados.has(d), fimDoPrazo: d === caso.prazoFim, retorno: d === caso.retorno, naFolha: d >= folha.inicio && d <= folha.fim, atestado: !!(o.atestado && d >= o.atestado.inicio && d <= o.atestado.fim) });
  }
  return out;
}

// Abonadas juntadas pelo período que o abono cobriu, lido da Ficha de Presença
// (sem tabela nova): dias da mesma pessoa, com o mesmo código, um seguido do
// outro. Pode pular até 4 dias em que ela não trabalhou (folga ou feriado no
// meio do atestado); um dia trabalhado no meio separa em dois períodos.
function periodosDeAbono(abonadas, fichaDias, lancadas, atestados) {
  // lancadas: { "re|data": "AAAA-MM-DD" } = dia em que o sistema percebeu que a falta
  // deixou de ser injustificada (o atestado chegou depois)
  // atestados: os registrados à mão (dobrarAtestados); cada abonada traz .manual (a
  // chave do atestado que a cobre) e .noSar2g (o SAR2G já a mostra como abonada)
  const porChave = {};
  (atestados || []).forEach(a => { porChave[a.chave] = a; });
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
      if (!junta) {
        atual = { re: a.re, nome: a.nome, cargo: a.cargo, posto: a.posto, supervisor: a.supervisor, escala: a.escala, tipo: a.tipo, codigo: a.codigo, faltas: [], inicio: d, fim: d, _chaves: new Set(), _pendentes: 0 };
        out.push(atual);
      }
      atual.fim = d; atual.faltas.push(d);
      if (a.manual) { atual._chaves.add(a.manual); if (!a.noSar2g) atual._pendentes++; }
    });
  });
  out.forEach(p => {
    p.dias = Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 864e5) + 1;
    const quando = p.faltas.map(d => (lancadas || {})[p.re + "|" + d]).filter(Boolean).sort();
    p.lancadoDepois = quando.length > 0;
    p.lancadoEm = quando.length ? quando[quando.length - 1] : null;
    // atestado registrado à mão: manda a data e os dias que a pessoa informou
    p.manuais = [...p._chaves].map(c => porChave[c]).filter(Boolean);
    p.aguardaSar2g = p._pendentes > 0;
    p.atestado = p.manuais.length === 1 ? p.manuais[0] : null;
    if (p.manuais.length) { p.lancadoDepois = false; p.lancadoEm = null; }
    delete p._chaves; delete p._pendentes;
  });
  return out.sort((x, y) => y.fim.localeCompare(x.fim) || String(x.nome).localeCompare(String(y.nome)));
}

// Os atestados registrados à mão ficam como eventos na tabela de registros
// (quem registrou, quando). O estado de agora é o último evento de cada chave:
// ATESTADO_REGISTRADO vale, ATESTADO_REMOVIDO apaga. Recebe os eventos do mais
// antigo para o mais novo.
function dobrarAtestados(eventos) {
  const ultimo = new Map(), pos = new Map(), lanc = new Map();
  (eventos || []).forEach((e, idx) => {
    // "já lancei no SAR2G": só vale se for mais novo que o último registro daquele atestado
    if (e.acao === "ATESTADO_LANCADO_SAR2G") { if (e.depois) lanc.set(e.depois.chave, { idx, lancado: e.depois.lancado === true, por: e.ator || null, em: e.criado_em || null }); return; }
    ultimo.set(e.chave, e); pos.set(e.chave, idx);
  });
  const ativos = [], sem = {};
  ultimo.forEach((e, chave) => {
    if (e.acao !== "ATESTADO_REGISTRADO" || !e.depois) return;
    const d = e.depois, em = e.criado_em || null, por = e.ator || null;
    if (d.tem === false) { sem[d.re + "|" + d.caso] = { chave, por, em, caso: d.caso }; return; }
    const inicio = iso(d.inicio), dias = Number(d.dias) || 1;
    const l = lanc.get(chave), lancou = !!(l && l.lancado && l.idx > pos.get(chave));
    ativos.push({ chave, re: String(d.re), inicio, dias, fim: somaDias(inicio, dias - 1), envio: d.envio ? iso(d.envio) : null, codigo: d.codigo || "A", por, em, lancadoSar2g: lancou, lancadoPor: lancou ? l.por : null, lancadoEm: lancou ? l.em : null });
  });
  return { ativos, sem };
}

// Turno da noite: os colaboradores dos supervisores abaixo. Todos os demais são
// diurnos. Regra definida pela coordenação; o turno não vem da planilha.
const SUPERVISORES_NOTURNOS = ["PAULO", "RONALDO"];
function turnoDoSupervisor(nome) {
  const primeiro = String(nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().split(/\s+/)[0];
  return SUPERVISORES_NOTURNOS.includes(primeiro) ? "NOTURNO" : "DIURNO";
}

// Calendário compacto para a resposta da tela: cada dia vira UM número
// (tipo * 256 + bandeiras). A data e o dia da semana a tela calcula. Sem isso,
// cada caso levava ~16 KB de calendário e 250 casos estouravam o limite de 4,5 MB
// de resposta da Vercel.
const TIPOS_CAL = ["", "TRABALHOU", "FOLGA", "FERIADO", "FALTA", "ABONADA", "RETORNO", "RETORNO_PREVISTO", "PRAZO", "MEDIDA", "CONTINUOU", "DEVIA_VOLTAR", "ABANDONO"];
function compactarCalendario(cal) {
  if (!cal || !cal.length) return { i: "", d: [] };
  return { i: cal[0].data, d: cal.map(x => TIPOS_CAL.indexOf(x.tipo || "") * 256 + (x.retorno ? 128 : 0) + (x.medida ? 1 : 0) + (x.hoje ? 2 : 0) + (x.futuro ? 4 : 0) + (x.feriado ? 8 : 0) + (x.fimDoPrazo ? 16 : 0) + (x.naFolha ? 32 : 0) + (x.atestado ? 64 : 0)) };
}
function expandirCalendario(k) {
  const out = [];
  if (!k || !k.i) return out;
  let d = k.i;
  k.d.forEach(v => {
    const f = v & 255, x = paraData(d);
    out.push({ data: d, dia: x.getUTCDate(), semana: x.getUTCDay(), tipo: TIPOS_CAL[v >> 8], retorno: !!(f & 128), medida: !!(f & 1), hoje: !!(f & 2), futuro: !!(f & 4), feriado: !!(f & 8), fimDoPrazo: !!(f & 16), naFolha: !!(f & 32), atestado: !!(f & 64) });
    d = somaDias(d, 1);
  });
  return out;
}

function pessoa(f, extra) {
  return { re: reDe(f.RE), nome: f.NOME || "", cargo: f.CARGO || "", posto: f.LOCAL || "", supervisor: f.AREA || "", escala: f.ESCALA || "", tipo: f.TIPO || "", horario: f.HORARIO || "", ...extra };
}


// ── Histórico de medidas (advertências e suspensões desde janeiro) ──────────
// Vem de um relatório do SAR2G enviado uma vez, sem o número do processo
// (HISTDISCIPLINAR). A chave é montada com os dados da medida e começa com
// "HIST|", para não colidir com as chaves da aba DISCIPLINA da planilha diária.
const TIPOS_MEDIDA = new Set(["ADVERTÊNCIA", "SUSPENSÃO"]);
const GRAUS_MEDIDA = new Set(["VERBAL", "ESCRITA", "SUSPENSÃO"]);
function medidaDoHistorico(l) {
  const re = reDe(l && l.re);
  const data = String((l && l.data) || "").slice(0, 10);
  const tipo = String((l && l.tipo) || "").toUpperCase(), grau = String((l && l.grau) || "").toUpperCase();
  const dias = Number((l && l.dias) || 0);
  if (!/^\d{1,15}$/.test(re)) return { erro: "RE inválido" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data + "T12:00:00Z"))) return { erro: "data inválida" };
  if (!TIPOS_MEDIDA.has(tipo)) return { erro: "tipo de medida desconhecido" };
  if (!GRAUS_MEDIDA.has(grau)) return { erro: "grau desconhecido" };
  if (!Number.isInteger(dias) || dias < 0 || dias > 30) return { erro: "dias de suspensão inválidos" };
  const txt = (v, n) => (v == null || v === "" ? null : String(v).trim().slice(0, n));
  const hist = txt(l.hist, 40);
  return {
    linha: {
      chave: hist || ["HIST", re, data, tipo, grau, dias].join("|"),
      re: Number(re), data, tipo, grau, dias,
      fase: txt(l.fase, 60), motivo_sar2g: txt(l.motivo, 120), nome: txt(l.nome, 120), local: txt(l.local, 120)
    }
  };
}
// A mesma medida pode chegar duas vezes: pelo histórico (chave "HIST|...") e
// pela aba DISCIPLINA (chave = número do processo). Fica uma só, a da planilha.
function dedupMedidas(lista) {
  const porDado = new Map();
  (lista || []).forEach(m => {
    const k = [m.re, String(m.data).slice(0, 10), m.tipo, m.grau, Number(m.dias) || 0].join("|");
    const ja = porDado.get(k);
    if (!ja || (String(ja.chave).startsWith("HIST|") && !String(m.chave).startsWith("HIST|"))) porDado.set(k, m);
  });
  const ficam = new Set(porDado.values());
  return (lista || []).filter(m => ficam.has(m));
}

module.exports = {
  FAMILIAS, SITUACOES, ABONADAS, familiaEscala, ehOperacional, trabalhouNoDia, montarCasos, reDe, competenciaDe, calendario, compactarCalendario, expandirCalendario, periodosDeAbono, dobrarAtestados, turnoDoSupervisor, SUPERVISORES_NOTURNOS,
  descreverMedida, somaDias, ddmm, medidaDoHistorico, dedupMedidas
};
