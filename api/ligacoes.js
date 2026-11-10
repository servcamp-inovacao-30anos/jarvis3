// api/ligacoes.js — módulo Feedback de Faltas (contato do SAC com quem faltou) e WhatsApp do SAC.
// Uma função só (o plano Hobby da Vercel já está nas 12): a ação vem em ?acao=.
//
//   GET                    lista os contatos + o que a apuração diz de cada falta + permissões
//   POST                   registra contato (com { baixar:true }, só coordenação, dá a baixa na cobrança)
//   PATCH                  edita contato (guarda o antes e o depois)
//   DELETE ?id=            exclui (só coordenação; o contato inteiro fica no registro)
//   POST   ?acao=baixa     { id, baixar:true|false, re? } só coordenação
//   POST   ?acao=acordo    { id, status:"cumprido"|"descumprido" } (descumprido só coordenação: desfaz a baixa)
//   POST   ?acao=atividade { id, op:"concluir"|"cancelar"|"reagendar", data? }  próxima ação do contato
//   (POST e PATCH aceitam { resultado, proxima, retorno }: tentativa sem conversa não permite retirar da cobrança)
//   GET    ?acao=painel        cada pessoa em uma situação: mandar mensagem, aguardando retorno, chamar na base, acompanhando
//   GET    ?acao=indicadores   números do topo e da aba Desempenho (faltas por dia e supervisor, quem teve feedback, conversas)
//   GET    ?acao=colaborador&re=&nome=   histórico geral de qualquer colaborador (até 400 dias)
//   GET    ?acao=motivos       motivos de falta (padrões e criados pelo SAC)
//   POST   ?acao=motivo        { nome } cria (qualquer pessoa do SAC) · { chave, nome?, ativo? } renomeia ou desativa (coordenação)
//   GET    ?acao=sem_retorno   pasta "Sem posicionamento" (regra antiga, sem uso na tela)
//   GET/POST ?acao=zap_autorizar | zap_registrar | zap_modelo   WhatsApp do SAC (o Baileys roda no PC do SAC, wa-sac/; a tela fala com ele)
//
// Regras em _lig_regras.js. Autorização no servidor: quem não tem "lig" não lê nem grava nada,
// e a baixa na cobrança é só da coordenação (Raphael, Jussilene, João). Quem registrou vem do token, não da tela.

const _auth = require("./_auth");
const ponto = require("./_ponto");
const L = require("./_lig_regras");
const P = require("./_lig_painel");
const IND = require("./_lig_indicadores");
const FR = require("./_faltas_regras");

const erro = (res, status, mensagem, codigo) => res.status(status).json({ error: mensagem, codigo });
const hojeSP = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const ehId = v => /^\d{1,12}$/.test(String(v == null ? "" : v));
const reNum = v => { const r = L.reDe(v); return /^\d{1,15}$/.test(r) ? Number(r) : null; };
const enc = encodeURIComponent;
const MAX_IMAGEM_B64 = 3400000; // ~2,5 MB de foto; a Vercel corta o pedido em 4,5 MB
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/webp"];
const MAX_ENVIOS_DIA_POR_PESSOA = 3, MIN_SEGUNDOS_ENTRE_ENVIOS = 60;

// ── apoio ───────────────────────────────────────────────────────────────────
const evento = (ator, acao, chave, antes, depois) => ({ ator, acao, entidade: L.ENTIDADE, chave: String(chave), antes: antes || null, depois: depois || null });
const eventosDe = (db, acoes, extra) => db.listar(`fm_auditoria?select=id,ator,acao,chave,antes,depois,criado_em&entidade=eq.${L.ENTIDADE}&acao=in.(${acoes.join(",")})${extra || ""}&order=id.asc`);

async function contatoPorId(db, id) {
  const [row] = await db.obter(`lig_contatos?select=*&id=eq.${id}&limit=1`);
  return row || null;
}

// RE da pessoa: o que a tela mandou, conferido com as faltas guardadas; sem RE, pelo nome exato (se só um RE tiver esse nome).
async function resolverRE(db, nome, reTela) {
  const nome1 = L.primeiroNome(nome);
  const re = reNum(reTela);
  if (re != null) {
    const ls = await db.obter(`fm_faltas?select=nome&re=eq.${re}&limit=60`);
    const conhecidos = ls.filter(x => x.nome);
    if (conhecidos.length && !conhecidos.some(x => L.primeiroNome(x.nome) === nome1)) return { erro: "O RE informado é de outra pessoa." };
    return { re, nome1 };
  }
  const ls = await db.obter(`fm_faltas?select=re,nome&nome=eq.${enc(String(nome).trim())}&limit=60`);
  const res = [...new Set(ls.map(x => Number(x.re)))];
  if (res.length === 1) return { re: res[0], nome1 };
  return { erro: res.length ? "Há mais de uma pessoa com esse nome: informe o RE." : "Não achei o RE dessa pessoa nas faltas do módulo." };
}

// resultado e próxima ação de cada contato (eventos LIG_RESULTADO e LIG_ATIVIDADE)
async function atividadesDe(db, extra) { return L.atividadesAtuais(await eventosDe(db, [L.ACAO_RESULTADO, L.ACAO_ATIVIDADE], extra)); }
const SO_CONVERSA = "Só dá para retirar da cobrança depois de conversar com o colaborador. Tentativa sem contato não conta.";

async function reapurar(db) {
  try { return { reapuradas: await require("./_faltas").reapurarComBanco(db) }; }
  catch (e) { console.error("[ligacoes] reapuração falhou:", e && e.message); return { reapuradas: 0, aviso: "A baixa foi registrada, mas a conferência das faltas falhou; ela roda de novo na próxima planilha." }; }
}

// Dá (ou refaz, com a data nova) a baixa do contato: as faltas injustificadas da janela saem da cobrança.
async function darBaixa(db, ator, contato, reTela) {
  const r = await resolverRE(db, contato.colaborador, reTela);
  if (r.erro) return { ok: false, motivo: r.erro };
  const dataContato = String(contato.data_contato || contato.criado_em || hojeSP()).slice(0, 10);
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_BAIXA, contato.id, null, { re: r.re, nome1: r.nome1, nome: contato.colaborador, dataContato })]);
  const ap = await reapurar(db);
  return { ok: true, re: r.re, janela: L.janela(dataContato), ...ap };
}
async function desfazerBaixa(db, ator, contato) {
  const ativas = L.baixasAtivas(await eventosDe(db, [L.ACAO_BAIXA, L.ACAO_BAIXA_FIM], `&chave=eq.${contato.id}`));
  if (!ativas.length) return { ok: true, desfeita: false };
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_BAIXA_FIM, contato.id, { re: ativas[0].re }, { motivo: "baixa desfeita" })]);
  return { ok: true, desfeita: true, ...(await reapurar(db)) };
}
async function salvarPrazo(db, ator, contatoId, prazo, status) {
  if (!L.ehData(prazo)) return;
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_ACORDO, contatoId, null, { prazo, status: status || "aberto" })]);
}

// ── contatos ────────────────────────────────────────────────────────────────
// cada contato com a baixa, o prazo do acordo e o resultado em vigor (eventos da fm_auditoria)
async function contatosCompletos(db) {
  const [rows, baixasEv, acordosEv, atv] = await Promise.all([
    db.listar("lig_contatos?select=*&order=id.desc"),
    eventosDe(db, [L.ACAO_BAIXA, L.ACAO_BAIXA_FIM]),
    eventosDe(db, [L.ACAO_ACORDO]),
    atividadesDe(db)
  ]);
  const baixas = {}; L.baixasAtivas(baixasEv).forEach(b => { baixas[b.contato] = b; });
  const acordos = L.acordosAtuais(acordosEv);
  return rows.slice(0, 5000).map(c => {
    const b = baixas[String(c.id)], a = acordos[String(c.id)], t = atv[String(c.id)];
    return { ...c, resultado: t ? t.resultado : null, proxima: t ? t.proxima : null, retorno: t ? t.retorno : null, atividade: t ? t.situacao : null, atividade_em: t ? t.em : null, baixa: b ? { por: L.NOMES[b.por] || b.por, em: b.em, de: b.de, ate: b.ate, re: b.re } : null, acordo_prazo: a ? a.prazo : null, acordo_status: a ? a.status : null };
  });
}

async function listar({ res, db, ator }) {
  const hoje = hojeSP();
  const [lista, fm] = await Promise.all([
    contatosCompletos(db),
    // o que a apuração do módulo de faltas diz de cada falta recente que NÃO é injustificada: A/J/L abonada, AF afastamento,
    // D demitido, T feedback baixado. Quem não está aqui é injustificada (ou não é do módulo: vale o código da planilha).
    db.listar(`fm_faltas?select=re,data,nome,codigo&codigo=in.(A,J,L,AF,D,T)&data=gte.${L.somaDias(hoje, -120)}&order=re.asc,data.asc`)
  ]);
  const codigos = {};
  fm.forEach(f => { codigos[L.reDe(f.re) + "|" + L.primeiroNome(f.nome) + "|" + String(f.data).slice(0, 10)] = f.codigo; });
  return res.status(200).json({ ok: true, rows: lista, codigos, hoje, pode_baixar: L.podeBaixar(ator), resultados: L.RESULTADOS, proximas: L.PROXIMAS, usuario: L.NOMES[ator] || ator, janela_dias: L.JANELA_DIAS });
}

// ── painel: cada pessoa em uma situação (mensagem, aguardando, base, acompanhando) ──
async function painel({ res, db, ator }) {
  const hoje = hojeSP(), desde = L.somaDias(hoje, -105), desdeEnvios = L.somaDias(hoje, -45);
  const [lista, faltas, envEv] = await Promise.all([
    contatosCompletos(db),
    db.listar(`fm_faltas?select=re,data,nome,posto,supervisor,codigo,tipo&data=gte.${desde}&order=re.asc,data.asc`),
    eventosDe(db, [L.ACAO_ZAP_ENVIO], `&criado_em=gte.${desdeEnvios}T00:00:00Z`)
  ]);
  const contatos = lista.map(c => ({ ...c, efetivo: L.efetivo(c.resultado) }));
  const envios = envEv.filter(e => e.depois && e.depois.ok === true).map(e => ({ chave: e.chave, data: P.dataSP(e.criado_em) }));
  // telefones que o sistema já tem (base de contatos do ponto): só de quem faltou há pouco ou tem contato
  const res_ = new Set(faltas.filter(f => String(f.data) >= desdeEnvios).map(f => L.reDe(f.re)));
  contatos.forEach(c => { if (c.baixa && c.baixa.re) res_.add(L.reDe(c.baixa.re)); });
  const lista_re = [...res_].filter(r => /^\d{1,15}$/.test(r));
  const telefones = {};
  try {
    for (let i = 0; i < lista_re.length; i += 150) {
      const lote = lista_re.slice(i, i + 150);
      const linhas = await db.listar(`pt_contatos?select=re,telefone_e164,enviavel&re=in.(${lote.join(",")})&order=re.asc`);
      linhas.forEach(l => { const n = l.enviavel ? L.celular(l.telefone_e164) : null; if (n) telefones[L.reDe(l.re)] = n; });
    }
  } catch (e) { console.error("[ligacoes] telefones do cadastro:", e && e.message); }
  const r = P.montarPainel({ hoje, faltas, contatos, envios, telefones });
  return res.status(200).json({ ok: true, hoje, pode_baixar: L.podeBaixar(ator), prazo_resposta_dias: P.PRAZO_RESPOSTA_DIAS, tentativas_para_base: P.TENTATIVAS_PARA_BASE, ...r });
}

async function criar({ res, db, ator, body }) {
  const baixar = body.baixar === true;
  if (baixar && !L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação dá a baixa na cobrança.", "NAO_AUTORIZADO");
  const hoje = hojeSP();
  const s = L.sanitizarContato(body, { completo: true, hoje, motivos: IND.motivosAceitos(await lerMotivos(db)) });
  if (!s.ok) return erro(res, 400, s.erro, "DADOS_INVALIDOS");
  const rs = L.sanitizarResultado(body, hoje);
  if (!rs.ok) return erro(res, 400, rs.erro, "DADOS_INVALIDOS");
  if (baixar && rs.valor && !L.efetivo(rs.valor.resultado)) return erro(res, 422, SO_CONVERSA, "SO_CONVERSA");
  if (body.acordo_prazo && !L.ehData(body.acordo_prazo)) return erro(res, 400, "Prazo do acordo inválido.", "DADOS_INVALIDOS");
  const row = { ...s.row, criado_por: L.NOMES[ator] || ator };
  const criado = ((await fetchContato("POST", "lig_contatos", row)) || [])[0];
  if (!criado) return erro(res, 500, "Não consegui salvar o contato.", "ERRO_BANCO");
  if (body.acordo_prazo) await salvarPrazo(db, ator, criado.id, body.acordo_prazo);
  if (rs.valor) await db.inserir("fm_auditoria", [evento(ator, L.ACAO_RESULTADO, criado.id, null, rs.valor)]);
  const out = { ok: true, row: criado };
  if (baixar) out.baixa = await darBaixa(db, ator, criado, body.re);
  return res.status(200).json(out);
}
// insert/patch com retorno das linhas (o db.inserir do módulo de ponto não devolve nada)
async function fetchContato(metodo, caminho, corpo) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/rest/v1/${caminho}`, { method: metodo, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text().catch(() => "")).slice(0, 200));
  return r.json();
}

async function editar({ res, db, ator, body }) {
  if (!ehId(body.id)) return erro(res, 400, "Campo id é obrigatório.", "SEM_ID");
  const antes = await contatoPorId(db, body.id);
  if (!antes) return erro(res, 404, "Contato não encontrado.", "NAO_ENCONTRADO");
  if ((body.baixar === true || body.baixar === false) && !L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação dá ou desfaz a baixa na cobrança.", "NAO_AUTORIZADO");
  const s = L.sanitizarContato(body, { completo: false, hoje: hojeSP(), motivos: body.motivo ? IND.motivosAceitos(await lerMotivos(db)) : undefined });
  if (!s.ok) return erro(res, 400, s.erro, "DADOS_INVALIDOS");
  const rs = L.sanitizarResultado(body, hojeSP());
  if (!rs.ok) return erro(res, 400, rs.erro, "DADOS_INVALIDOS");
  if (body.baixar === true) {
    const atual = rs.valor ? rs.valor.resultado : ((await atividadesDe(db, `&chave=eq.${body.id}`))[String(body.id)] || {}).resultado;
    if (!L.efetivo(atual)) return erro(res, 422, SO_CONVERSA, "SO_CONVERSA");
  }
  if (body.acordo_prazo && !L.ehData(body.acordo_prazo)) return erro(res, 400, "Prazo do acordo inválido.", "DADOS_INVALIDOS");
  let depois = antes;
  if (Object.keys(s.row).length) {
    const rows = await fetchContato("PATCH", `lig_contatos?id=eq.${body.id}`, s.row);
    depois = (rows && rows[0]) || { ...antes, ...s.row };
    const mudou = {}, era = {};
    Object.keys(s.row).forEach(k => { if (String(antes[k] == null ? "" : antes[k]) !== String(depois[k] == null ? "" : depois[k])) { mudou[k] = depois[k]; era[k] = antes[k]; } });
    if (Object.keys(mudou).length) await db.inserir("fm_auditoria", [evento(ator, L.ACAO_EDITADO, body.id, era, mudou)]);
  }
  if (body.acordo_prazo) await salvarPrazo(db, ator, body.id, body.acordo_prazo);
  if (rs.valor) await db.inserir("fm_auditoria", [evento(ator, L.ACAO_RESULTADO, body.id, null, rs.valor)]);
  const out = { ok: true, row: depois };
  const ativas = L.baixasAtivas(await eventosDe(db, [L.ACAO_BAIXA, L.ACAO_BAIXA_FIM], `&chave=eq.${body.id}`));
  if (body.baixar === false) out.baixa = await desfazerBaixa(db, ator, depois);
  else if (body.baixar === true) out.baixa = await darBaixa(db, ator, depois, body.re);
  else if (ativas.length && s.row.data_contato && s.row.data_contato !== String(antes.data_contato || "").slice(0, 10)) out.baixa = await darBaixa(db, ator, depois, ativas[0].re); // mudou a data do contato: a janela anda junto
  return res.status(200).json(out);
}

async function excluir({ req, res, db, ator, body }) {
  if (!L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação exclui contatos.", "NAO_AUTORIZADO");
  const id = (req.query && req.query.id) || body.id;
  if (!ehId(id)) return erro(res, 400, "Parâmetro id é obrigatório.", "SEM_ID");
  const antes = await contatoPorId(db, id);
  if (!antes) return erro(res, 404, "Contato não encontrado.", "NAO_ENCONTRADO");
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_EXCLUIDO, id, antes, null)]); // primeiro o registro: se o apagar falhar, nada se perde
  await db.remover(`lig_contatos?id=eq.${id}`);
  const out = { ok: true };
  const b = await desfazerBaixa(db, ator, antes);
  if (b.desfeita) out.baixa = b;
  return res.status(200).json(out);
}

async function baixa({ res, db, ator, body }) {
  if (!L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação dá ou desfaz a baixa na cobrança.", "NAO_AUTORIZADO");
  if (!ehId(body.id)) return erro(res, 400, "Campo id é obrigatório.", "SEM_ID");
  const c = await contatoPorId(db, body.id);
  if (!c) return erro(res, 404, "Contato não encontrado.", "NAO_ENCONTRADO");
  if (body.baixar !== false && !L.efetivo(((await atividadesDe(db, `&chave=eq.${body.id}`))[String(body.id)] || {}).resultado)) return erro(res, 422, SO_CONVERSA, "SO_CONVERSA");
  const r = body.baixar === false ? await desfazerBaixa(db, ator, c) : await darBaixa(db, ator, c, body.re);
  if (!r.ok) return erro(res, 422, r.motivo, "SEM_RE");
  return res.status(200).json({ ok: true, baixa: r });
}

async function acordo({ res, db, ator, body }) {
  if (!ehId(body.id)) return erro(res, 400, "Campo id é obrigatório.", "SEM_ID");
  if (!["cumprido", "descumprido"].includes(body.status)) return erro(res, 400, "Status inválido.", "DADOS_INVALIDOS");
  if (body.status === "descumprido" && !L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação registra o descumprimento (as faltas voltam à cobrança).", "NAO_AUTORIZADO");
  const c = await contatoPorId(db, body.id);
  if (!c) return erro(res, 404, "Contato não encontrado.", "NAO_ENCONTRADO");
  const atual = L.acordosAtuais(await eventosDe(db, [L.ACAO_ACORDO], `&chave=eq.${body.id}`))[String(body.id)];
  if (!atual) return erro(res, 404, "Este contato não tem prazo de acordo.", "SEM_ACORDO");
  await salvarPrazo(db, ator, body.id, atual.prazo, body.status);
  const out = { ok: true };
  if (body.status === "descumprido") out.baixa = await desfazerBaixa(db, ator, c); // não cumpriu: as faltas voltam à cobrança
  return res.status(200).json(out);
}

// ── próxima ação: concluir, cancelar ou reagendar ─────────────────────────
async function atividade({ res, db, ator, body }) {
  if (!ehId(body.id)) return erro(res, 400, "Campo id é obrigatório.", "SEM_ID");
  const op = String(body.op || "");
  if (!["concluir", "cancelar", "reagendar"].includes(op)) return erro(res, 400, "Operação inválida.", "DADOS_INVALIDOS");
  const hoje = hojeSP();
  if (op === "reagendar" && (!L.ehData(body.data) || body.data < hoje || body.data > L.somaDias(hoje, 90))) return erro(res, 400, "Escolha uma data a partir de hoje (até 90 dias).", "DADOS_INVALIDOS");
  if (!(await contatoPorId(db, body.id))) return erro(res, 404, "Contato não encontrado.", "NAO_ENCONTRADO");
  const atual = (await atividadesDe(db, `&chave=eq.${body.id}`))[String(body.id)];
  if (!atual || !atual.proxima) return erro(res, 404, "Este contato não tem próxima ação.", "SEM_ATIVIDADE");
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_ATIVIDADE, body.id, { situacao: atual.situacao, retorno: atual.retorno }, { op, data: op === "reagendar" ? body.data : null })]);
  return res.status(200).json({ ok: true });
}

// ── pasta "Sem posicionamento" ──────────────────────────────────────────────
async function semRetorno({ res, db }) {
  const hoje = hojeSP(), desde = L.somaDias(hoje, -L.JANELA_DIAS);
  const [faltas, contatosLidos, envios, atv] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,nome,posto,supervisor,tipo&codigo=eq.I&data=gte.${desde}&order=re.asc,data.asc`).then(l => l.filter(f => f.tipo !== "HISTORICO")),
    db.listar("lig_contatos?select=id,colaborador,data_contato,criado_em&order=id.asc"),
    eventosDe(db, [L.ACAO_ZAP_ENVIO], `&criado_em=gte.${desde}T00:00:00Z`),
    atividadesDe(db)
  ]);
  const contatos = contatosLidos.map(c => ({ ...c, efetivo: L.efetivo((atv[String(c.id)] || {}).resultado) }));
  return res.status(200).json({ ok: true, hoje, desde, minimo: L.MIN_FALTAS_SEM_RETORNO, pessoas: L.semPosicionamento(faltas, contatos, envios) });
}

// ── motivos de falta ────────────────────────────────────────────────────────
async function lerMotivos(db) { return IND.motivosAtuais(await eventosDe(db, [IND.ACAO_MOTIVO])); }
async function motivos({ res, db, ator }) {
  const lista = await lerMotivos(db);
  return res.status(200).json({ ok: true, motivos: lista.map(m => ({ chave: m.chave, nome: m.nome, ativo: m.ativo, padrao: m.padrao, antigos: m.antigos })), pode_editar: L.podeBaixar(ator) });
}
async function motivo({ res, db, ator, body }) {
  const lista = await lerMotivos(db);
  if (body.chave) {
    if (!L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação renomeia ou desativa motivos.", "NAO_AUTORIZADO");
    const m = lista.find(x => x.chave === String(body.chave));
    if (!m) return erro(res, 404, "Motivo não encontrado.", "NAO_ENCONTRADO");
    let nome = m.nome;
    if (body.nome !== undefined && L.limpa(body.nome, 40) !== m.nome) {
      const v = IND.validarNovoMotivo(body.nome, lista.filter(x => x.chave !== m.chave));
      if (!v.ok) return erro(res, 400, v.erro, "DADOS_INVALIDOS");
      nome = v.nome;
    }
    const ativo = body.ativo === undefined ? m.ativo : body.ativo !== false;
    await db.inserir("fm_auditoria", [evento(ator, IND.ACAO_MOTIVO, m.chave, { nome: m.nome, ativo: m.ativo }, { nome, ativo })]);
    return res.status(200).json({ ok: true, motivo: { chave: m.chave, nome, ativo } });
  }
  const v = IND.validarNovoMotivo(body.nome, lista);
  if (!v.ok) return erro(res, 400, v.erro, "DADOS_INVALIDOS");
  await db.inserir("fm_auditoria", [evento(ator, IND.ACAO_MOTIVO, v.chave, null, { nome: v.nome, ativo: true })]);
  return res.status(200).json({ ok: true, motivo: { chave: v.chave, nome: v.nome, ativo: true, padrao: false } });
}

// ── indicadores: topo da tela e aba Desempenho ─────────────────────────────
async function indicadores({ res, db }) {
  const hoje = hojeSP(), desde = L.somaDias(hoje, -IND.DIAS_INDICADORES);
  const [faltas, lista, mot, envEv] = await Promise.all([
    db.listar(`fm_faltas?select=re,data,nome,posto,supervisor,codigo&data=gte.${desde}&order=data.asc,re.asc`),
    contatosCompletos(db),
    lerMotivos(db),
    eventosDe(db, [L.ACAO_ZAP_ENVIO], `&criado_em=gte.${desde}T00:00:00Z`)
  ]);
  const contatos = lista.map(c => ({ ...c, efetivo: L.efetivo(c.resultado) }));
  const envios = envEv.filter(e => e.depois && e.depois.ok === true).map(e => ({ chave: e.chave, data: P.dataSP(e.criado_em) }));
  return res.status(200).json({ ok: true, prazo_resposta_dias: P.PRAZO_RESPOSTA_DIAS, ...IND.montarIndicadores({ hoje, faltas, contatos, motivos: mot, turnoDe: FR.turnoDoSupervisor, envios }) });
}

// ── histórico geral de qualquer colaborador (mesmo sem feedback) ───────────
async function colaborador({ req, res, db }) {
  const q = req.query || {}, hoje = hojeSP(), desde = L.somaDias(hoje, -IND.DIAS_INDICADORES);
  const re = reNum(q.re), nome = L.limpa(q.nome, 120);
  if (re == null && !nome) return erro(res, 400, "Informe o RE ou o nome.", "DADOS_INVALIDOS");
  const faltas = await db.listar(`fm_faltas?select=re,data,nome,posto,supervisor,codigo,tipo&${re != null ? "re=eq." + re : "nome=eq." + enc(nome)}&data=gte.${desde}&order=data.asc`);
  const nome1 = L.primeiroNome(nome || (faltas[0] && faltas[0].nome) || "");
  const minhas = faltas.filter(f => !nome1 || L.primeiroNome(f.nome) === nome1);
  const nomeCompleto = (minhas[minhas.length - 1] && minhas[minhas.length - 1].nome) || nome;
  if (!nomeCompleto) return erro(res, 404, "Colaborador não encontrado.", "NAO_ENCONTRADO");
  const chave = (re != null ? re : (minhas[0] ? L.reDe(minhas[0].re) : "0")) + "|" + L.primeiroNome(nomeCompleto);
  const [todos, envEv] = await Promise.all([contatosCompletos(db), eventosDe(db, [L.ACAO_ZAP_ENVIO], `&chave=eq.${enc(chave)}`)]);
  const contatos = todos.filter(c => L.norm(c.colaborador) === L.norm(nomeCompleto) || (re != null && c.baixa && Number(c.baixa.re) === re)).map(c => ({ ...c, efetivo: L.efetivo(c.resultado) }));
  const envios = envEv.filter(e => e.depois && e.depois.ok === true).map(e => ({ chave: e.chave, data: P.dataSP(e.criado_em) }));
  let telefone = "";
  if (re != null) {
    try { const [t] = await db.obter(`pt_contatos?select=telefone_e164,enviavel&re=eq.${re}&limit=1`); telefone = t && t.enviavel ? (L.celular(t.telefone_e164) || "") : ""; } catch (e) { /* sem telefone */ }
  }
  const r = P.montarPainel({ hoje, faltas: minhas, contatos, envios, telefones: re != null ? { [String(re)]: telefone } : {}, diasHist: IND.DIAS_INDICADORES });
  let p = r.pessoas.find(x => L.primeiroNome(x.nome) === L.primeiroNome(nomeCompleto)) || null;
  if (!p) { // sem pendência e sem acompanhamento: só o histórico
    const u = minhas[minhas.length - 1] || {};
    p = { key: chave, re: re != null ? String(re) : L.reDe(u.re), nome: nomeCompleto, posto: u.posto || (contatos[0] && contatos[0].posto) || "", supervisor: u.supervisor || (contatos[0] && contatos[0].supervisor) || "", telefone,
      hist: minhas.map(f => [String(f.data).slice(0, 10), f.codigo || "I"]), envios: envios.map(e => e.data).sort(), situacao: "sem", faltas: [] };
  } else p.hist = minhas.map(f => [String(f.data).slice(0, 10), f.codigo || "I"]); // o histórico inteiro, não só a janela do painel
  return res.status(200).json({ ok: true, hoje, pessoa: p });
}

// ── WhatsApp do SAC ─────────────────────────────────────────────────────────
async function zapModelo({ req, res, db, ator, body }) {
  if (req.method === "POST") {
    if (!L.podeBaixar(ator)) return erro(res, 403, "Só a coordenação edita a mensagem padrão.", "NAO_AUTORIZADO");
    const texto = String(body.texto == null ? "" : body.texto).replace(/\r/g, "").trim();
    if (texto.length < 10 || texto.length > 1000) return erro(res, 400, "A mensagem padrão precisa ter de 10 a 1000 caracteres.", "DADOS_INVALIDOS");
    await db.inserir("fm_auditoria", [evento(ator, L.ACAO_ZAP_MODELO, "modelo", null, { texto })]);
    return res.status(200).json({ ok: true, texto });
  }
  const [e] = await db.obter(`fm_auditoria?select=depois&entidade=eq.${L.ENTIDADE}&acao=eq.${L.ACAO_ZAP_MODELO}&chave=eq.modelo&order=id.desc&limit=1`);
  return res.status(200).json({ ok: true, texto: (e && e.depois && e.depois.texto) || L.MODELO_PADRAO, padrao: !(e && e.depois && e.depois.texto), pode_editar: L.podeBaixar(ator) });
}
async function zapAutorizar({ res, db, ator, body }) {
  const texto = String(body.texto == null ? "" : body.texto).replace(/\r/g, "").trim();
  const img = body.imagem && typeof body.imagem === "object" ? body.imagem : null;
  if (!texto && !img) return erro(res, 400, "Escreva a mensagem ou anexe uma foto.", "DADOS_INVALIDOS");
  if (texto.length > 1000) return erro(res, 400, "Mensagem longa demais (máximo 1000 caracteres).", "DADOS_INVALIDOS");
  const numero = L.celular(body.telefone);
  if (!numero) return erro(res, 422, "O telefone não é um celular válido (DDD + 9 dígitos).", "TELEFONE_INVALIDO");
  let imagem = null;
  if (img) {
    const b64 = String(img.base64 || "").replace(/^data:[^,]*,/, "");
    if (!TIPOS_IMAGEM.includes(img.mimetype)) return erro(res, 400, "A foto precisa ser JPG, PNG ou WebP.", "DADOS_INVALIDOS");
    if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 100) return erro(res, 400, "Foto inválida.", "DADOS_INVALIDOS");
    if (b64.length > MAX_IMAGEM_B64) return erro(res, 413, "Foto grande demais (máximo ~2,5 MB).", "IMAGEM_GRANDE");
    imagem = { base64: b64, mimetype: img.mimetype, nome: L.limpa(img.nome, 80) || "foto" };
  }
  const nome = L.limpa(body.colaborador, 120);
  if (!nome) return erro(res, 400, "Informe o colaborador.", "DADOS_INVALIDOS");
  const r0 = await resolverRE(db, nome, body.re);
  const chave = (r0.erro ? "0" : r0.re) + "|" + L.primeiroNome(nome);
  // Não vira disparo em massa: poucas mensagens por pessoa e um intervalo mínimo (o serviço também enfileira e espaça tudo)
  const hoje = hojeSP();
  const doDia = (await eventosDe(db, [L.ACAO_ZAP_ENVIO], `&chave=eq.${enc(chave)}&criado_em=gte.${hoje}T03:00:00Z`)).filter(e => e.depois && e.depois.ok === true);
  if (doDia.length >= MAX_ENVIOS_DIA_POR_PESSOA) return erro(res, 429, "Já foram enviadas " + MAX_ENVIOS_DIA_POR_PESSOA + " mensagens para essa pessoa hoje.", "LIMITE_DIA");
  const ultimo = doDia[doDia.length - 1];
  if (ultimo && Date.now() - new Date(ultimo.criado_em).getTime() < MIN_SEGUNDOS_ENTRE_ENVIOS * 1000) return erro(res, 429, "Aguarde um minuto antes de enviar outra mensagem para essa pessoa.", "INTERVALO");
  return res.status(200).json({ ok: true, numero, chave, final: numero.slice(-4), tamanho: texto.length, comFoto: !!imagem });
}
// Depois que a tela mandou a mensagem pelo WhatsApp do SAC (Baileys rodando no PC), ela avisa aqui o resultado para ficar registrado
async function zapRegistrar({ res, db, ator, body }) {
  const chave = String(body.chave || "");
  if (!/^[0-9]{1,12}\|[A-ZÀ-Ú0-9 .'-]{1,60}$/i.test(chave)) return erro(res, 400, "Registro inválido.", "DADOS_INVALIDOS");
  const certo = body.ok === true;
  await db.inserir("fm_auditoria", [evento(ator, L.ACAO_ZAP_ENVIO, chave, null, { ok: certo, motivo: certo ? null : L.limpa(body.motivo, 160) || "falhou", comFoto: !!body.comFoto, tamanho: Math.min(1000, Math.max(0, Number(body.tamanho) || 0)), final: /^[0-9]{4}$/.test(String(body.final)) ? String(body.final) : "", contato: ehId(body.contato_id) ? Number(body.contato_id) : null })]).catch(() => {});
  return res.status(200).json({ ok: true });
}

// ── roteamento ──────────────────────────────────────────────────────────────
const ROTAS = {
  "GET ": listar, "POST ": criar, "PATCH ": editar, "DELETE ": excluir,
  "GET painel": painel, "GET indicadores": indicadores, "GET colaborador": colaborador, "GET motivos": motivos, "POST motivo": motivo, "POST baixa": baixa, "POST acordo": acordo, "POST atividade": atividade, "GET sem_retorno": semRetorno,
  "POST zap_autorizar": zapAutorizar, "POST zap_registrar": zapRegistrar,
  "GET zap_modelo": zapModelo, "POST zap_modelo": zapModelo
};

module.exports = async function handler(req, res) {
  const _ga = _auth.requireAuth(req);
  if (!_ga.ok) return res.status(401).json({ error: "Não autenticado." });
  if (await _auth.recusarSeBloqueado(req, res, _ga)) return; // bloqueado na Configuração (inclui chave do Excel)
  const ator = _ga.user && _ga.user.u ? String(_ga.user.u) : null;
  if (!ator) return erro(res, 401, "Não autenticado.", "SEM_USUARIO");
  const db = ponto.conectar();
  if (!db) return erro(res, 500, "Envs do Supabase não configuradas.", "CONFIG_AUSENTE");
  const acao = String((req.query && req.query.acao) || "");
  const rota = ROTAS[`${req.method} ${acao}`];
  if (!rota) {
    if (acao === "" || ["baixa", "acordo", "atividade", "sem_retorno", "painel", "indicadores", "colaborador", "motivos", "motivo"].includes(acao) || acao.startsWith("zap_")) { res.setHeader("Allow", "GET, POST, PATCH, DELETE"); return erro(res, 405, "Método não permitido.", "METODO"); }
    return erro(res, 404, "Ação desconhecida.", "ROTA_DESCONHECIDA");
  }
  try {
    // quem não tem "lig" (nem na lista fixa, nem no perfil do banco) não passa
    let perms = null;
    if (!L.USUARIOS.has(ator)) {
      const [u] = await db.obter(`app_users?select=perms,ativo&user_key=eq.${enc(ator)}&limit=1`);
      perms = u && u.ativo !== false ? (u.perms || null) : null;
    }
    if (!L.podeUsar(ator, perms)) return erro(res, 403, "Sem permissão para o Feedback de Faltas.", "NAO_AUTORIZADO");
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    return await rota({ req, res, db, ator, body });
  } catch (e) {
    console.error("[ligacoes] " + (e && e.message ? e.message : e));
    return erro(res, 500, "Falha ao falar com o banco.", "ERRO_BANCO");
  }
};
