// api/_medida_regras.js — regras puras da medida disciplinar gerada pelo Painel ServCamp.
//
// Plano em docs/medida-disciplinar.md (decidido com o Raphael em 26/10/2026):
//   • quem decide a medida é o supervisor: o sistema não escolhe nem cria regra de infração;
//   • o documento gerado aqui NÃO substitui o SAR2G: toda medida gerada fica "pendente de
//     lançar no SAR2G" até a planilha diária trazer a medida (aba DISCIPLINA → fm_medidas)
//     ou alguém marcar à mão que lançou;
//   • quem gera fica registrado, e a coordenação acompanha tudo por supervisor.
//
// Sem tabela nova: cada medida gerada é uma sequência de eventos na fm_auditoria
// (entidade "fm_medida_gerada"), como os atestados. O último evento de cada uma é o que vale.
// Nada aqui fala com o banco: quem lê e grava é o api/_faltas.js.

const ENTIDADE = "fm_medida_gerada";
const ACAO_GERADA = "MEDIDA_GERADA";
const ACAO_LANCADA = "MEDIDA_LANCADA_SAR2G";   // marcada à mão como lançada (ou desmarcada)
const ACAO_CANCELADA = "MEDIDA_CANCELADA";     // documento gerado por engano: sai da lista, fica no histórico
const ACAO_ASSINADA = "MEDIDA_ASSINADA";       // foto ou PDF do documento assinado pelo colaborador (o último vale; { removido: true } tira)
const ACOES = [ACAO_GERADA, ACAO_LANCADA, ACAO_CANCELADA];   // as que a lista lê inteiras; o anexo é lido à parte (é pesado)
const MAX_ANEXO = 2500 * 1024; // bytes do arquivo: a Vercel corta o pedido em 4,5 MB, e a foto já chega reduzida da tela

// Quem gera (pedido do Raphael, 26/10/2026): ele, a coordenadora Jussilene, o João (admin) e os supervisores.
// A coordenação vê e gera para todas as áreas; o supervisor só para a área dele.
const COORDENACAO = new Set(["raphaelvictor", "jussilenealmeida", "joaoygor"]);
const SUPERVISORES = new Set(["rafaelandrade", "adrianomacedo", "edneyferraz", "frankpimentel", "carlos", "jeankleber", "paulosergio", "ronaldocimadon"]);
// Nome de quem gera, para o resumo por e-mail (os mesmos do USERS do index.html; test/medida confere).
const NOMES = {
  raphaelvictor: "Raphael Victor", jussilenealmeida: "Jussilene Almeida", joaoygor: "João Ygor",
  rafaelandrade: "Rafael Andrade", adrianomacedo: "Adriano Macedo", edneyferraz: "Edney Ferraz", frankpimentel: "Frank Pimentel",
  carlos: "Carlos", jeankleber: "Jean Kleber", paulosergio: "Paulo Sérgio", ronaldocimadon: "Ronaldo Cimadon"
};

const TIPOS = {
  ADVERTENCIA_VERBAL: { tipo: "ADVERTÊNCIA", grau: "VERBAL", rot: "Advertência verbal" },
  ADVERTENCIA_ESCRITA: { tipo: "ADVERTÊNCIA", grau: "ESCRITA", rot: "Advertência escrita" },
  SUSPENSAO: { tipo: "SUSPENSÃO", grau: "SUSPENSÃO", rot: "Suspensão" }
};
// O que o supervisor pode marcar além das faltas do caso. Só monta o texto do motivo; não é regra.
const SITUACOES = {
  FALTA_INJUSTIFICADA: "Falta injustificada",
  ATRASO: "Atraso",
  SAIDA_ANTECIPADA: "Saída antecipada sem autorização",
  ABANDONO_POSTO: "Abandono de posto",
  DESCUMPRIMENTO: "Descumprimento de norma ou procedimento",
  CONDUTA: "Conduta inadequada no posto"
};
const MAX_MOTIVO = 1500, MAX_DIAS_SUSPENSAO = 30;

const iso = v => (v == null ? "" : String(v).slice(0, 10));
const ehData = v => { // 2026-13-40 não passa
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return false;
  const t = Date.parse(v + "T12:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};
const sem = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const primeiroNome = s => sem(s).toUpperCase().trim().split(/\s+/)[0] || "";
const soLetras = s => sem(s).toLowerCase().replace(/[^a-z]/g, "");
const somaDias = (d, n) => { const x = new Date(iso(d) + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function podeGerar(ator) { return !!ator && (COORDENACAO.has(ator) || SUPERVISORES.has(ator)); }
function ehCoordenacao(ator) { return !!ator && COORDENACAO.has(ator); }
// A área é o nome do supervisor na planilha ("FRANK PIMENTEL", "CARLOS NOGUEIRA") e a conta é o
// login ("frankpimentel", "carlos"). Casa pelo primeiro nome: é o que as duas sempre têm igual
// (o sobrenome às vezes vem escrito diferente na planilha: Cimadon / Cimadom).
function daArea(ator, supervisor) {
  if (ehCoordenacao(ator)) return true;
  if (!SUPERVISORES.has(ator)) return false;
  const p = soLetras(primeiroNome(supervisor));
  return !!p && String(ator).startsWith(p);
}

// Confere o que veio da tela. Devolve { erro: [mensagem, codigo] } ou { dados }.
function validar(b, hoje) {
  b = b || {};
  const t = TIPOS[String(b.tipo || "")];
  if (!t) return { erro: ["Escolha o tipo da medida.", "TIPO_INVALIDO"] };
  const re = String(b.re == null ? "" : b.re).trim();
  if (!/^\d{1,15}$/.test(re)) return { erro: ["Colaborador inválido.", "SEM_RE"] };
  const nome = String(b.nome || "").trim().slice(0, 120);
  if (!nome) return { erro: ["Colaborador sem nome.", "SEM_NOME"] };
  let dias = 0;
  if (t.tipo === "SUSPENSÃO") {
    dias = Number(b.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS_SUSPENSAO) return { erro: [`Informe os dias de suspensão (de 1 a ${MAX_DIAS_SUSPENSAO}).`, "DIAS_INVALIDOS"] };
  }
  const inicio = iso(b.inicio);
  if (!ehData(inicio)) return { erro: ["Informe a data da medida.", "DATA_INVALIDA"] };
  if (hoje && (inicio < somaDias(hoje, -120) || inicio > somaDias(hoje, 60))) return { erro: ["Data da medida fora do período aceito.", "DATA_FORA"] };
  const motivo = String(b.motivo == null ? "" : b.motivo).replace(/\s+$/g, "").trim().slice(0, MAX_MOTIVO);
  if (motivo.length < 5) return { erro: ["Escreva o motivo da medida.", "SEM_MOTIVO"] };
  const situacoes = [...new Set((Array.isArray(b.situacoes) ? b.situacoes : []).map(String))].filter(s => SITUACOES[s]);
  const faltas = [...new Set((Array.isArray(b.faltas) ? b.faltas : []).map(iso))].filter(ehData).sort().slice(0, 60);
  const caso = String(b.caso || "").slice(0, 40);
  const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  return {
    dados: {
      tipoId: String(b.tipo), tipo: t.tipo, grau: t.grau, dias, inicio, motivo, situacoes, faltas, caso,
      re, nome, empresa: txt(b.empresa, 80), cargo: txt(b.cargo, 80), posto: txt(b.posto, 120), supervisor: txt(b.supervisor, 80)
    }
  };
}

// Número do documento: MD-AAAA-NNNN, na ordem em que as medidas foram geradas no ano.
// Sai da ordem dos registros (o id da fm_auditoria só cresce), então não muda depois.
function numerar(geradas) {
  const porAno = {};
  return [...geradas].sort((a, b) => Number(a.id) - Number(b.id)).map(g => {
    const ano = String(g.criado_em || "").slice(0, 4) || "0000";
    porAno[ano] = (porAno[ano] || 0) + 1;
    return { chave: g.chave, numero: `MD-${ano}-${String(porAno[ano]).padStart(4, "0")}` };
  });
}

// A medida já está no SAR2G? A planilha diária traz a aba DISCIPLINA para fm_medidas: vale
// medida do mesmo RE (e do mesmo primeiro nome, quando a linha tem nome — o RE se repete entre
// as empresas do grupo), não cancelada, com data a partir de 3 dias antes da geração (a data
// lançada no SAR2G pode ser a da aplicação, um pouco antes do dia em que o documento saiu).
function noSar2g(g, medidas) {
  const desde = somaDias(iso(g.geradaEm), -3), nome1 = primeiroNome(g.nome);
  return (medidas || []).filter(m => String(m.re) === String(g.re) && iso(m.data) >= desde && !/CANCEL/i.test(String(m.fase || "")) && (!m.nome || primeiroNome(m.nome) === nome1))
    .sort((a, b) => iso(a.data).localeCompare(iso(b.data)))[0] || null;
}

// Foto ou PDF do documento assinado: "data:<tipo>;base64,...", conferido pelos primeiros bytes
// (não só pelo nome). Devolve { erro: [mensagem, codigo] } ou { tipo, base64, bytes }.
function validarAnexo(dataUrl) {
  const m = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ""));
  if (!m) return { erro: ["Envie uma foto (JPG ou PNG) ou um PDF do documento assinado.", "ARQUIVO_INVALIDO"] };
  const b = Buffer.from(m[2], "base64");
  const ok = m[1] === "application/pdf" ? b.slice(0, 5).toString("latin1") === "%PDF-"
    : m[1] === "image/png" ? b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (!ok) return { erro: ["O arquivo não é uma foto ou um PDF de verdade.", "ARQUIVO_INVALIDO"] };
  if (b.length > MAX_ANEXO) return { erro: ["O arquivo passa de 2,5 MB. Tire a foto de novo ou reduza o PDF.", "ARQUIVO_GRANDE"] };
  return { tipo: m[1], base64: m[2], bytes: b.length };
}

// Junta os eventos de cada medida gerada e diz em que pé está cada uma:
//   PENDENTE   gerada, ainda não apareceu no SAR2G nem foi marcada como lançada
//   LANCADA    a planilha trouxe a medida (automático) ou alguém marcou à mão
//   CANCELADA  documento gerado por engano
// anexos: só os dados de cada anexo (sem o arquivo): [{ id, chave, ator, criado_em, tipo, bytes, nome, removido }].
function dobrar(eventos, medidas, hoje, anexos) {
  const assinado = new Map();
  [...(anexos || [])].sort((a, b) => Number(a.id) - Number(b.id)).forEach(a => {
    const removido = a.removido === true || a.removido === "true";
    assinado.set(a.chave, removido ? null : { em: a.criado_em, por: a.ator, tipo: a.tipo || "", bytes: Number(a.bytes) || 0, nome: a.nome || "" });
  });
  const por = new Map();
  [...(eventos || [])].sort((a, b) => Number(a.id) - Number(b.id)).forEach(e => {
    if (e.acao === ACAO_GERADA) { por.set(e.chave, { ev: e, lancada: null, cancelada: null }); return; }
    const x = por.get(e.chave);
    if (!x) return;
    if (e.acao === ACAO_LANCADA) x.lancada = e.depois && e.depois.lancado === true ? e : null;
    if (e.acao === ACAO_CANCELADA) x.cancelada = e;
  });
  const numeros = new Map(numerar([...por.values()].map(x => x.ev)).map(n => [n.chave, n.numero]));
  return [...por.values()].map(({ ev, lancada, cancelada }) => {
    const d = ev.depois || {};
    const g = {
      chave: ev.chave, numero: numeros.get(ev.chave), geradaPor: ev.ator, geradaEm: ev.criado_em,
      re: String(d.re), nome: d.nome, empresa: d.empresa || "", cargo: d.cargo || "", posto: d.posto || "", supervisor: d.supervisor || "",
      tipoId: d.tipoId, tipo: d.tipo, grau: d.grau, dias: Number(d.dias) || 0, inicio: iso(d.inicio), motivo: d.motivo || "",
      situacoes: d.situacoes || [], faltas: d.faltas || [], caso: d.caso || "",
      assinado: assinado.get(ev.chave) || null
    };
    const sar = noSar2g(g, medidas);
    if (cancelada) Object.assign(g, { status: "CANCELADA", canceladaPor: cancelada.ator, canceladaEm: cancelada.criado_em, motivoCancelamento: (cancelada.depois || {}).motivo || "" });
    else if (sar) Object.assign(g, { status: "LANCADA", lancadaPor: "planilha", lancadaEm: iso(sar.data), sar2g: { data: iso(sar.data), tipo: sar.tipo, grau: sar.grau, dias: Number(sar.dias) || 0 } });
    else if (lancada) Object.assign(g, { status: "LANCADA", lancadaPor: lancada.ator, lancadaEm: lancada.criado_em, manual: true });
    else Object.assign(g, { status: "PENDENTE", diasPendente: hoje ? Math.max(0, Math.round((Date.parse(iso(hoje) + "T12:00:00Z") - Date.parse(iso(g.geradaEm) + "T12:00:00Z")) / 864e5)) : null });
    return g;
  }).sort((a, b) => String(b.geradaEm).localeCompare(String(a.geradaEm)));
}

// Histórico do colaborador no ano, para o e-mail e para o lado do formulário:
// medidas válidas (sem as canceladas) e faltas injustificadas que continuam injustificadas.
// medidas: [{ re, data, tipo, grau, dias, fase, nome? }]; faltasI: [{ re, data, nome? }]
function historicoDe(re, nome, medidas, faltasI) {
  const nome1 = primeiroNome(nome), mesma = x => String(x.re) === String(re) && (!x.nome || !nome1 || primeiroNome(x.nome) === nome1);
  const val = (medidas || []).filter(m => mesma(m) && !/CANCEL/i.test(String(m.fase || ""))).sort((a, b) => iso(b.data).localeCompare(iso(a.data)));
  const cont = { verbal: 0, escrita: 0, suspensao: 0, diasSuspensao: 0 };
  val.forEach(m => {
    const t = String(m.tipo || "").toUpperCase(), g = String(m.grau || "").toUpperCase();
    if (t.startsWith("SUSPENS")) { cont.suspensao++; cont.diasSuspensao += Number(m.dias) || 0; }
    else if (g === "VERBAL") cont.verbal++;
    else cont.escrita++;
  });
  const faltas = [...new Set((faltasI || []).filter(mesma).map(f => iso(f.data)))].sort();
  return { medidas: val.length, ...cont, ultima: val[0] ? { data: iso(val[0].data), tipo: val[0].tipo, grau: val[0].grau, dias: Number(val[0].dias) || 0 } : null, faltasAno: faltas.length, reincidente: val.length >= 2 }; // mesmo corte da tela: 2 ou mais medidas no ano
}
// "1 advertência verbal, 2 escritas e 1 suspensão (3 dias)" — curto, para o e-mail.
function historicoTxt(h) {
  if (!h || !h.medidas) return "Nenhuma medida no ano";
  const p = [];
  if (h.verbal) p.push(h.verbal + (h.verbal === 1 ? " advertência verbal" : " advertências verbais"));
  if (h.escrita) p.push(h.escrita + (h.escrita === 1 ? " advertência escrita" : " advertências escritas"));
  if (h.suspensao) p.push(h.suspensao + (h.suspensao === 1 ? " suspensão" : " suspensões") + (h.diasSuspensao ? " (" + h.diasSuspensao + (h.diasSuspensao === 1 ? " dia)" : " dias)") : ""));
  return p.length < 2 ? p.join("") : p.slice(0, -1).join(", ") + " e " + p[p.length - 1];
}

module.exports = {
  ENTIDADE, ACAO_GERADA, ACAO_LANCADA, ACAO_CANCELADA, ACAO_ASSINADA, ACOES, COORDENACAO, SUPERVISORES, NOMES, TIPOS, SITUACOES, MAX_MOTIVO, MAX_DIAS_SUSPENSAO, MAX_ANEXO,
  podeGerar, ehCoordenacao, daArea, validar, validarAnexo, numerar, noSar2g, dobrar, historicoDe, historicoTxt, primeiroNome
};
