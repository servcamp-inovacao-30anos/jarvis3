// api/_faltas.js — servidor do módulo Faltas x Medidas disciplinares.
//
// Prefixo "_" → não vira rota. É chamado pelo api/rh.js quando a URL traz
// ?modulo=faltas (o plano Hobby da Vercel já está nas 12 funções).
//   /api/rh?modulo=faltas&t=...
//     GET  casos      qualquer pessoa logada: os casos já calculados
//     GET  feriados   qualquer pessoa logada
//     PATCH motivo    só aprovadores: motivo da medida (texto livre, com histórico)
//     POST feriados   só aprovadores: { data, descricao } ou { data, remover: true }
//     GET  historico  qualquer pessoa logada: advertências e suspensões desde 1º de janeiro
//     POST historico  só aprovadores: { medidas: [...] } do relatório de ocorrências do SAR2G
// E o api/import.js chama materializar() a cada planilha recebida.
//
// As regras moram em _faltas_regras.js (puras, testadas). Aqui fica só o que
// fala com o mundo: banco, autorização e o formato das respostas.

const R = require("./_faltas_regras");
const ponto = require("./_ponto");

const ACAO_ABONO_TARDIO = "FALTA_ABONADA_DEPOIS";
const ACAO_ATESTADO = "ATESTADO_REGISTRADO";
const ACAO_ATESTADO_FIM = "ATESTADO_REMOVIDO";
const ACAO_ATESTADO_LANCADO = "ATESTADO_LANCADO_SAR2G"; // o usuário marcou que já lançou no SAR2G
const ACAO_HISTORICO = "HISTORICO_IMPORTADO";
const MAX_HISTORICO = 5000; // linhas por envio
const JANELA_DIAS = 150; // o que a tela carrega: casos mais antigos já se encerraram
const DIAS_ACOMPANHADOS = 45; // quem faltou nesse período ainda tem os dias da ficha guardados

function erro(res, status, mensagem, codigo) { return res.status(status).json({ error: mensagem, codigo }); }
function hojeSP() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
const ehData = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const reNum = v => { const r = R.reDe(v); return /^\d{1,15}$/.test(r) ? Number(r) : null; };

// ── materialização ──────────────────────────────────────────────────────────
// A planilha traz só o mês até hoje e cada envio substitui o anterior: sem
// guardar aqui, a falta de um mês some antes de o caso se resolver.
async function materializar(data, opcoes) {
  const o = opcoes || {};
  const db = o.db || ponto.conectar();
  if (!db) return { ok: false, motivo: "CONFIG_AUSENTE" };
  if (!data || !Array.isArray(data.faltas)) return { ok: true, ignorado: "SEM_FALTAS_NA_PLANILHA" };
  const agora = new Date().toISOString();

  // Só entra quem é do módulo: operacional, em 5x2, 6x1 ou 12x36.
  const faltas = [];
  data.faltas.forEach(f => {
    const re = reNum(f.RE), dia = String(f.DATA || "").slice(0, 10);
    if (re == null || !ehData(dia) || !R.familiaEscala(f.ESCALA) || !R.ehOperacional(f.TIPO)) return;
    faltas.push({
      re, data: dia, codigo: String(f.ABONO || "").toUpperCase().trim() || null,
      nome: f.NOME || null, cargo: f.CARGO || null, posto: f.LOCAL || null,
      supervisor: f.AREA || null, escala: f.ESCALA || null, tipo: f.TIPO || null, atualizado_em: agora
    });
  });
  // Dias da ficha interessam de quem faltou nesta planilha e de quem faltou
  // antes (está no banco): é assim que se vê o retorno numa planilha seguinte.
  const reDoModulo = new Set(faltas.map(f => String(f.re)));
  const recentes = await db.listar(`fm_faltas?select=re&data=gte.${R.somaDias(new Date().toISOString().slice(0, 10), -DIAS_ACOMPANHADOS)}&order=re.asc,data.asc`);
  recentes.forEach(x => reDoModulo.add(String(x.re)));

  const dias = [];
  Object.entries(data.fichaDias || {}).forEach(([reTxt, porDia]) => {
    const re = reNum(reTxt);
    if (re == null || !reDoModulo.has(String(re))) return;
    Object.entries(porDia || {}).forEach(([dia, situacao]) => { if (ehData(dia)) dias.push({ re, data: dia, situacao: situacao || null, atualizado_em: agora }); });
  });

  // Período que esta planilha cobre: é nele que ela manda. Falta que existia no
  // banco e não veio mais (o RH corrigiu o lançamento) sai do módulo.
  const datas = faltas.map(f => f.data).concat(Object.values(data.fichaDias || {}).flatMap(m => Object.keys(m || {}))).filter(ehData).sort();
  let removidas = 0;
  const codigoAntes = new Map(); // código que a falta tinha no banco antes desta planilha
  if (datas.length) {
    const de = datas[0], ate = datas[datas.length - 1];
    const existentes = await db.listar(`fm_faltas?select=re,data,codigo&data=gte.${de}&data=lte.${ate}&order=re.asc,data.asc`);
    existentes.forEach(x => { codigoAntes.set(x.re + "|" + String(x.data).slice(0, 10), x.codigo || null); });
    const novas = new Set(faltas.map(f => f.re + "|" + f.data));
    const sumiram = new Map();
    existentes.forEach(x => {
      const k = x.re + "|" + String(x.data).slice(0, 10);
      if (novas.has(k)) return;
      if (!sumiram.has(x.re)) sumiram.set(x.re, []);
      sumiram.get(x.re).push(String(x.data).slice(0, 10));
    });
    for (const [re, lista] of sumiram) { await db.remover(`fm_faltas?re=eq.${re}&data=in.(${lista.join(",")})`); removidas += lista.length; }
  }
  if (faltas.length) await db.upsert("fm_faltas", faltas, "re,data");
  await anotarAbonosTardios(db, faltas, codigoAntes);
  if (dias.length) await db.upsert("fm_dias", dias, "re,data");

  // Medidas: o motivo editado no JARVIS não vai no upsert, então nunca é sobrescrito.
  const medidas = [];
  (data.disciplina || []).forEach(m => {
    const re = reNum(m.RE), dia = String(m.DATA || "").slice(0, 10);
    if (re == null || !ehData(dia)) return;
    const chave = String(m.HIST || "").trim() || [re, dia, m.TIPO || "", m.GRAU || ""].join("|");
    medidas.push({
      chave, re, data: dia, tipo: m.TIPO || null, grau: m.GRAU || null, dias: Number(m.DIAS) || 0,
      fase: m.FASE || null, motivo_sar2g: m.MOTIVO || null, obs: m.OBS || null, nome: m.NOME || null, local: m.LOCAL || null,
      atualizado_em: agora
    });
  });
  if (medidas.length) await db.upsert("fm_medidas", medidas, "chave");

  // Admissão de quem tem o RE hoje. Sem data na planilha, não apaga a que já existe.
  const admissoes = (data.ativos || [])
    .map(a => ({ re: reNum(a.RE), admissao: String(a.ADMISSAO || "").slice(0, 10), atualizado_em: agora }))
    .filter(a => a.re != null && ehData(a.admissao));
  if (admissoes.length) await db.upsert("fm_admissoes", admissoes, "re");

  return { ok: true, faltas: faltas.length, removidas, dias: dias.length, medidas: medidas.length, admissoes: admissoes.length };
}

// Quando o atestado chega depois, o SAR2G troca a falta de injustificada para
// abonada e o banco só guarda o código de agora. Para saber que a falta JÁ FOI
// injustificada, anota-se a troca no momento em que ela é percebida (na tabela
// de registros que já existe, sem coluna nova). Falta que já nasce abonada não
// tem o que anotar.
async function anotarAbonosTardios(db, faltas, codigoAntes) {
  const trocas = faltas.filter(f => {
    const k = f.re + "|" + f.data;
    return codigoAntes.get(k) === "I" && R.ABONADAS.has(f.codigo);
  }).map(f => ({ ator: "sistema", acao: ACAO_ABONO_TARDIO, entidade: "fm_faltas", chave: f.re + "|" + f.data, antes: { codigo: codigoAntes.get(f.re + "|" + f.data) }, depois: { codigo: f.codigo } }));
  if (!trocas.length) return;
  try { await db.inserir("fm_auditoria", trocas); } catch (e) { console.error("faltas: não anotou abono tardio:", e && e.message); }
}

// ── leituras ────────────────────────────────────────────────────────────────

async function verCasos({ res, db, ator }) {
  const hoje = hojeSP(), desde = R.somaDias(hoje, -JANELA_DIAS);
  const [faltas, dias, medidasLidas, adm, feriados, trocas, eventosAtestado] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,codigo,nome,cargo,posto,supervisor,escala,tipo&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar(`fm_dias?select=re,data,situacao&data=gte.${desde}&order=re.asc,data.asc`),
    db.listar(`fm_medidas?select=chave,re,data,tipo,grau,dias,fase,motivo_sar2g,obs,motivo,motivo_editado_por,motivo_editado_em&data=gte.${desde}&order=re.asc,data.asc,chave.asc`),
    db.listar("fm_admissoes?select=re,admissao&order=re.asc"),
    db.listar("fm_feriados?select=data,descricao&order=data.asc"),
    db.listar(`fm_auditoria?select=id,chave,criado_em&acao=eq.${ACAO_ABONO_TARDIO}&order=criado_em.asc,id.asc`),
    db.listar(`fm_auditoria?select=id,ator,acao,chave,depois,criado_em&acao=in.(${ACAO_ATESTADO},${ACAO_ATESTADO_FIM},${ACAO_ATESTADO_LANCADO})&order=criado_em.asc,id.asc`)
  ]);
  // a mesma medida pode estar no histórico importado e na planilha diária: conta uma vez só
  const medidas = R.dedupMedidas(medidasLidas);
  // atestados registrados à mão: valem já, sem esperar o lançamento no SAR2G
  const { ativos: atestados, sem: semAtestado } = R.dobrarAtestados(eventosAtestado);
  const cobertura = (re, dia) => atestados.find(a => a.re === String(re) && dia >= a.inicio && dia <= a.fim) || null;
  const codigoSar = {};
  faltas.forEach(f => { codigoSar[f.re + "|" + String(f.data).slice(0, 10)] = f.codigo; });
  // dia (horário de Brasília) em que o sistema percebeu a troca injustificada → abonada
  const lancadas = {};
  trocas.forEach(t => { lancadas[t.chave] = new Date(new Date(t.criado_em).getTime() - 3 * 3600000).toISOString().slice(0, 10); });
  const fichaDias = {};
  dias.forEach(d => { (fichaDias[d.re] = fichaDias[d.re] || {})[String(d.data).slice(0, 10)] = d.situacao; });
  const admissoes = {};
  adm.forEach(a => { if (a.admissao) admissoes[a.re] = String(a.admissao).slice(0, 10); });

  const r = R.montarCasos({
    hoje,
    feriados: feriados.map(f => String(f.data).slice(0, 10)),
    admissoes, fichaDias,
    faltas: faltas.map(f => ({ RE: f.re, DATA: f.data, ABONO: (!R.ABONADAS.has(f.codigo) && cobertura(f.re, String(f.data).slice(0, 10))) ? "A" : f.codigo, NOME: f.nome, CARGO: f.cargo, LOCAL: f.posto, AREA: f.supervisor, ESCALA: f.escala, TIPO: f.tipo })),
    medidas: medidas.map(m => ({ RE: m.re, DATA: m.data, TIPO: m.tipo, GRAU: m.grau, DIAS: m.dias, FASE: m.fase, HIST: m.chave, MOTIVO: m.motivo_sar2g, chave: m.chave, motivo: m.motivo, motivo_editado_por: m.motivo_editado_por, motivo_editado_em: m.motivo_editado_em }))
  });

  r.abonadas.forEach(a => {
    const dia = String(a.data).slice(0, 10), cob = cobertura(a.re, dia);
    a.manual = cob ? cob.chave : null;
    a.noSar2g = R.ABONADAS.has(codigoSar[a.re + "|" + dia]) || !!(cob && cob.lancadoSar2g);
  });
  r.casos.forEach(c => { c.turno = R.turnoDoSupervisor(c.supervisor); });
  r.abonadas.forEach(a => { a.turno = R.turnoDoSupervisor(a.supervisor); });
  const resumo = {};
  r.casos.forEach(c => { resumo[c.situacao] = (resumo[c.situacao] || 0) + 1; });
  const abonadasPorRE = {};
  r.abonadas.forEach(a => { (abonadasPorRE[a.re] = abonadasPorRE[a.re] || []).push(a.data); });
  const listaFeriados = feriados.map(f => String(f.data).slice(0, 10));
  r.casos.forEach(c => {
    c.folha = R.competenciaDe(c.primeiraFalta);
    const ultimo = [c.prazoFim, c.retornoPrevisto, ...(c.faltas || [])].filter(Boolean).sort().pop() || c.primeiraFalta;
    const desdeCaso = R.somaDias(c.primeiraFalta, -7); // atestado que abonou a(s) primeira(s) falta(s) do caso
    c.atestados = atestados.filter(a => a.re === String(c.re) && a.fim >= desdeCaso && a.inicio <= ultimo);
    c.semAtestado = semAtestado[c.re + "|" + c.primeiraFalta] || null;
    c.cal = R.compactarCalendario(R.calendario(c, { dias: fichaDias[c.re] || {}, abonadas: abonadasPorRE[c.re] || [], feriados: listaFeriados, hoje, meses: true }));
  });
  const abonos = R.periodosDeAbono(r.abonadas, fichaDias, lancadas, atestados);
  abonos.forEach(p => {
    p.turno = R.turnoDoSupervisor(p.supervisor);
    p.primeiraFalta = p.inicio;
    p.folha = R.competenciaDe(p.inicio);
    // o calendário mostra as faltas abonadas e, marcados, os dias que o atestado cobriu
    const cob = p.atestado ? { inicio: p.atestado.inicio, fim: p.atestado.fim } : { inicio: p.inicio, fim: p.fim };
    p.cal = R.compactarCalendario(R.calendario({ faltas: [], primeiraFalta: p.inicio, prazo: [], medida: null }, { dias: fichaDias[p.re] || {}, abonadas: p.faltas, feriados: listaFeriados, hoje, meses: true, atestado: cob }));
  });
  const doCaso = new Set(r.casos.map(c => String(c.re)));
  const diasDosCasos = {};
  Object.keys(fichaDias).forEach(re => { if (doCaso.has(String(re))) diasDosCasos[re] = fichaDias[re]; });
  // Medidas anteriores de cada pessoa, para o card (reincidência).
  const historico = {};
  medidas.forEach(m => { if (doCaso.has(String(m.re))) (historico[m.re] = historico[m.re] || []).push(m); });

  return res.status(200).json({
    ok: true, hoje, dataBase: r.dataBase, vazio: faltas.length === 0 && dias.length === 0, resumo, casos: r.casos, abonadas: r.abonadas,
    // abonadas juntadas pelo período que o atestado/justificativa cobriu
    abonos, atestados,
    dias: diasDosCasos, historico, feriados, pode_editar: !!(ator && ponto.APROVADORES.has(ator))
  });
}

// Histórico: todas as advertências e suspensões desde 1º de janeiro (importadas + planilha diária).
async function verHistorico({ res, db }) {
  const hoje = hojeSP(), desde = hoje.slice(0, 4) + "-01-01";
  const [lidas, ult] = await Promise.all([
    db.listar(`fm_medidas?select=chave,re,data,tipo,grau,dias,fase,motivo_sar2g,nome,local&data=gte.${desde}&order=re.asc,data.asc,chave.asc`),
    db.obter(`fm_auditoria?select=ator,depois,criado_em&acao=eq.${ACAO_HISTORICO}&order=criado_em.desc,id.desc&limit=1`)
  ]);
  const medidas = R.dedupMedidas(lidas).map(m => ({
    re: m.re, data: iso10(m.data), tipo: m.tipo, grau: m.grau, dias: Number(m.dias) || 0, fase: m.fase || "",
    motivo: m.motivo_sar2g || "", nome: m.nome || "", local: m.local || "", origem: String(m.chave).startsWith("HIST|") ? "historico" : "planilha"
  }));
  const u = (ult || [])[0];
  return res.status(200).json({ ok: true, hoje, desde, medidas, importacao: u ? { por: u.ator, em: u.criado_em, linhas: (u.depois || {}).gravadas || 0 } : null });
}
async function salvarHistorico({ res, db, ator, body }) {
  const lista = Array.isArray(body.medidas) ? body.medidas : null;
  if (!lista || !lista.length) return erro(res, 400, "Nenhuma medida recebida.", "VAZIO");
  if (lista.length > MAX_HISTORICO) return erro(res, 400, `Arquivo grande demais: no máximo ${MAX_HISTORICO} medidas por envio.`, "GRANDE_DEMAIS");
  const linhas = [], recusadas = {};
  const vistas = new Set();
  const agora = new Date().toISOString();
  lista.forEach(l => {
    const r = R.medidaDoHistorico(l);
    if (r.erro) { recusadas[r.erro] = (recusadas[r.erro] || 0) + 1; return; }
    if (vistas.has(r.linha.chave)) return; // repetida no próprio arquivo (pessoa com duas vagas)
    vistas.add(r.linha.chave);
    linhas.push(Object.assign(r.linha, { atualizado_em: agora }));
  });
  if (linhas.length) await db.upsert("fm_medidas", linhas, "chave");
  const datas = linhas.map(l => l.data).sort();
  const resumo = { recebidas: lista.length, gravadas: linhas.length, recusadas, de: datas[0] || null, ate: datas[datas.length - 1] || null };
  await db.inserir("fm_auditoria", [{ ator, acao: ACAO_HISTORICO, entidade: "fm_medidas", chave: "historico", antes: {}, depois: resumo }]);
  return res.status(200).json(Object.assign({ ok: true }, resumo));
}

async function verFeriados({ res, db }) {
  return res.status(200).json({ ok: true, feriados: await db.listar("fm_feriados?select=data,descricao&order=data.asc") });
}

// ── escritas (só aprovadores) ───────────────────────────────────────────────

async function editarMotivo({ res, db, ator, body }) {
  const chave = String(body.chave || "").trim();
  if (!chave) return erro(res, 400, "Informe a medida.", "SEM_MEDIDA");
  const motivo = String(body.motivo == null ? "" : body.motivo).trim().slice(0, 1000);
  const [m] = await db.obter(`fm_medidas?select=chave,motivo&chave=eq.${encodeURIComponent(chave)}`);
  if (!m) return erro(res, 404, "Medida não encontrada.", "NAO_ENCONTRADA");
  if ((m.motivo || "") === motivo) return res.status(200).json({ ok: true, alterado: false });
  const agora = new Date().toISOString();
  // A auditoria vai antes: se a gravação falhar no meio, o texto anterior não se perde.
  await db.inserir("fm_auditoria", [{ ator, acao: "MOTIVO_EDITADO", entidade: "fm_medidas", chave, antes: { motivo: m.motivo || null }, depois: { motivo: motivo || null } }]);
  await db.atualizar(`fm_medidas?chave=eq.${encodeURIComponent(chave)}`, { motivo: motivo || null, motivo_editado_por: ator, motivo_editado_em: agora });
  return res.status(200).json({ ok: true, alterado: true, motivo: motivo || null, motivo_editado_por: ator, motivo_editado_em: agora });
}

async function salvarFeriado({ res, db, ator, body }) {
  const dia = String(body.data || "").slice(0, 10);
  if (!ehData(dia)) return erro(res, 400, "Data inválida.", "DATA_INVALIDA");
  if (body.remover === true) {
    await db.remover(`fm_feriados?data=eq.${dia}`);
    await db.inserir("fm_auditoria", [{ ator, acao: "FERIADO_REMOVIDO", entidade: "fm_feriados", chave: dia, antes: null, depois: null }]);
    return res.status(200).json({ ok: true, removido: dia });
  }
  const descricao = String(body.descricao == null ? "" : body.descricao).trim().slice(0, 120) || null;
  await db.upsert("fm_feriados", [{ data: dia, descricao }], "data");
  await db.inserir("fm_auditoria", [{ ator, acao: "FERIADO_SALVO", entidade: "fm_feriados", chave: dia, antes: null, depois: { descricao } }]);
  return res.status(200).json({ ok: true, data: dia, descricao });
}

// Registro do atestado à mão. Fica como evento na tabela de registros: o último
// evento de cada atestado é o que vale; quem registrou e quando já ficam anotados.
async function salvarAtestado({ res, db, ator, body }) {
  const re = reNum(body.re);
  if (re == null) return erro(res, 400, "Informe o colaborador.", "SEM_RE");
  const [existe] = await db.obter(`fm_faltas?select=re&re=eq.${re}&limit=1`);
  if (!existe) return erro(res, 404, "Este colaborador não tem falta registrada no módulo.", "NAO_ENCONTRADA");
  const hoje = hojeSP();
  const ultimo = async chave => (await db.obter(`fm_auditoria?select=id,acao,depois&entidade=eq.fm_atestados&chave=eq.${encodeURIComponent(chave)}&order=criado_em.desc,id.desc&limit=1`))[0] || null;
  const ev = (acao, chave, depois) => ({ ator, acao, entidade: "fm_atestados", chave, antes: null, depois });

  if (body.lancado === true || body.lancado === false) {
    const chave = String(body.chave || "").trim();
    if (!chave.startsWith(re + "|")) return erro(res, 400, "Atestado inválido.", "CHAVE_INVALIDA");
    const u = await ultimo(chave);
    if (!u || u.acao !== ACAO_ATESTADO) return erro(res, 404, "Atestado não encontrado.", "NAO_ENCONTRADA");
    const ul = await ultimo("lancado|" + chave);
    const atual = !!(ul && ul.depois && ul.depois.lancado === true && Number(ul.id) > Number(u.id));
    if (atual === body.lancado) return res.status(200).json({ ok: true, alterado: false, lancado: atual });
    await db.inserir("fm_auditoria", [ev(ACAO_ATESTADO_LANCADO, "lancado|" + chave, { re, chave, lancado: body.lancado })]);
    return res.status(200).json({ ok: true, alterado: true, lancado: body.lancado });
  }

  if (body.remover === true) {
    const chave = String(body.chave || "").trim();
    if (!chave.startsWith(re + "|")) return erro(res, 400, "Atestado inválido.", "CHAVE_INVALIDA");
    const u = await ultimo(chave);
    if (!u || u.acao !== ACAO_ATESTADO) return res.status(200).json({ ok: true, alterado: false });
    await db.inserir("fm_auditoria", [ev(ACAO_ATESTADO_FIM, chave, null)]);
    return res.status(200).json({ ok: true, alterado: true, removido: chave });
  }

  if (body.tem === false) {
    const caso = String(body.caso || "").slice(0, 10);
    if (!ehData(caso)) return erro(res, 400, "Informe a data da primeira falta do caso.", "CASO_INVALIDO");
    const chave = `${re}|sem|${caso}`, depois = { re, tem: false, caso };
    const u = await ultimo(chave);
    if (u && u.acao === ACAO_ATESTADO) return res.status(200).json({ ok: true, alterado: false, chave });
    await db.inserir("fm_auditoria", [ev(ACAO_ATESTADO, chave, depois)]);
    return res.status(200).json({ ok: true, alterado: true, chave });
  }

  const inicio = String(body.inicio || "").slice(0, 10);
  if (!ehData(inicio)) return erro(res, 400, "Informe a data do atestado.", "DATA_INVALIDA");
  if (inicio < R.somaDias(hoje, -JANELA_DIAS) || inicio > R.somaDias(hoje, 30)) return erro(res, 400, "Data do atestado fora do período aceito.", "DATA_FORA");
  const dias = Number(body.dias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 180) return erro(res, 400, "Informe a quantidade de dias (de 1 a 180).", "DIAS_INVALIDOS");
  const envio = String(body.envio || "").slice(0, 10) || null;
  if (envio && !ehData(envio)) return erro(res, 400, "Data de envio inválida.", "ENVIO_INVALIDO");
  if (envio && envio > hoje) return erro(res, 400, "A data de envio não pode ser no futuro.", "ENVIO_FUTURO");
  const chave = `${re}|${inicio}`, depois = { re, tem: true, inicio, dias, envio, codigo: "A" };
  const u = await ultimo(chave);
  const novos = [];
  const velha = String(body.substitui || "").trim();
  if (velha && velha !== chave && velha.startsWith(re + "|")) { const uv = await ultimo(velha); if (uv && uv.acao === ACAO_ATESTADO) novos.push(ev(ACAO_ATESTADO_FIM, velha, null)); }
  if (velha && velha !== chave && u && u.acao === ACAO_ATESTADO) return erro(res, 409, "Já existe outro atestado registrado começando nesse dia. Remova ou corrija aquele primeiro.", "JA_EXISTE");
  const d0 = u && u.acao === ACAO_ATESTADO && u.depois;
  const igual = d0 && d0.tem === true && iso10(d0.inicio) === inicio && Number(d0.dias) === dias && (iso10(d0.envio) || null) === envio;
  if (!igual) novos.push(ev(ACAO_ATESTADO, chave, depois));
  if (!novos.length) return res.status(200).json({ ok: true, alterado: false, chave });
  await db.inserir("fm_auditoria", novos);
  return res.status(200).json({ ok: true, alterado: true, chave, inicio, fim: R.somaDias(inicio, dias - 1), dias, envio });
}
const iso10 = v => (v == null ? "" : String(v).slice(0, 10));

// ── roteamento ──────────────────────────────────────────────────────────────

const ROTAS = {
  "GET casos": { fn: verCasos },
  "GET feriados": { fn: verFeriados },
  "GET historico": { fn: verHistorico },
  "POST historico": { aprovador: true, fn: salvarHistorico },
  "PATCH motivo": { aprovador: true, fn: editarMotivo },
  "POST feriados": { aprovador: true, fn: salvarFeriado },
  "POST atestado": { aprovador: true, fn: salvarAtestado }
};

module.exports = async function faltas(req, res) {
  const t = String((req.query && req.query.t) || "");
  const rota = ROTAS[`${req.method} ${t}`];
  if (!rota) return erro(res, 404, `Rota desconhecida: ${req.method} ${t || "(sem t)"}`, "ROTA_DESCONHECIDA");
  const ator = ponto.usuarioDoToken(req);
  if (rota.aprovador && !(ator && ponto.APROVADORES.has(ator))) return erro(res, 403, "Ação restrita aos aprovadores.", "NAO_AUTORIZADO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.", "CONFIG_AUSENTE");
  try {
    return await rota.fn({ req, res, db, ator, body: req.body || {} });
  } catch (e) {
    console.error("[faltas] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};

module.exports.materializar = materializar;
