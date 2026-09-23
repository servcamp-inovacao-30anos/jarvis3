// api/_ponto_regras.js — motor de regras do monitoramento de ponto.
//
// Prefixo "_" → não vira rota na Vercel (não conta no limite de 12 funções).
// Só funções puras: nada de banco, de rede nem de relógio do sistema. Tudo o
// que decide se uma marcação vira ocorrência mora aqui, para ser testado
// isolado em test/ponto_regras.test.js.

const crypto = require("crypto");

const TOLERANCIA_PADRAO_MIN = 5;

function semAcento(v) {
  return String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isoDe(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function lerData(v) {
  const m = String(v == null ? "" : v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function diaAbs(iso) {
  const d = lerData(iso);
  return Date.UTC(d.y, d.m - 1, d.d) / 86400000;
}

function isoDeDiaAbs(n) {
  const dt = new Date(n * 86400000);
  return isoDe(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// "HH:MM", "HH:MM:SS" ou data-hora "AAAA-MM-DDTHH:MM". Os segundos são
// descartados: o relógio de ponto marca minuto e as regras são em minutos.
// Devolve { dia: "AAAA-MM-DD" | null, min: minutos desde 00:00 }.
function lerHorario(v) {
  if (v == null) return null;
  const m = String(v).trim().match(/^(?:(\d{4}-\d{2}-\d{2})[T ])?(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!m) return null;
  const h = Number(m[2]), mi = Number(m[3]);
  if (h > 23 || mi > 59) return null;
  if (m[1] && !lerData(m[1])) return null;
  return { dia: m[1] || null, min: h * 60 + mi };
}

// Marcado − previsto, em minutos, com sinal. Com data dos dois lados é exato.
// Só com a hora, fica a leitura mais curta dentro de ±12h: a entrada batida às
// 23:55 para uma jornada prevista às 00:10 é 15 min ANTES, não 23h45 depois.
function diferencaMinutos(previsto, marcado) {
  if (previsto.dia && marcado.dia) {
    return (diaAbs(marcado.dia) - diaAbs(previsto.dia)) * 1440 + marcado.min - previsto.min;
  }
  const d = marcado.min - previsto.min;
  return ((d % 1440) + 1440 + 720) % 1440 - 720;
}

// "EXTRA ENTRADA" / "EXTRA SAIDA" (com ou sem acento) → "ENTRADA" / "SAIDA".
function tipoMarcacao(tipo) {
  const t = semAcento(tipo).toUpperCase();
  if (t.includes("ENTRADA")) return "ENTRADA";
  if (t.includes("SAIDA")) return "SAIDA";
  return null;
}

// Devolve { tipo, minutos } ou null (dentro da tolerância, ou fora do escopo).
//
// ENTRADA ANTECIPADA: marcada < prevista − tolerância → minutos = prevista − marcada
// SAIDA APOS HORARIO: marcada > prevista + tolerância → minutos = marcada − prevista
//
// Exatamente na tolerância ainda é normal. Ultrapassou, conta a diferença
// INTEIRA — a tolerância não é descontada. Atraso na entrada e saída antecipada
// (LATE_ENTRY / EARLY_EXIT) são fase 2: hoje não há fonte para eles.
function classificar(previsto, marcado, tipo, toleranciaMin) {
  const tol = toleranciaMin == null || toleranciaMin === "" ? TOLERANCIA_PADRAO_MIN : Number(toleranciaMin);
  if (!Number.isFinite(tol) || tol < 0) return null;
  const p = lerHorario(previsto), m = lerHorario(marcado), t = tipoMarcacao(tipo);
  if (!p || !m || !t) return null;
  const dif = diferencaMinutos(p, m);
  if (t === "ENTRADA" && -dif > tol) return { tipo: "EARLY_ENTRY", minutos: -dif };
  if (t === "SAIDA" && dif > tol) return { tipo: "LATE_EXIT", minutos: dif };
  return null;
}

// Competência vai do dia 26 ao dia 25 do mês seguinte.
function competenciaDe(data) {
  const d = lerData(data);
  if (!d) return null;
  let y = d.y, m = d.m;
  if (d.d < 26) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
  const yf = m === 12 ? y + 1 : y, mf = m === 12 ? 1 : m + 1;
  return { inicio: isoDe(y, m, 26), fim: isoDe(yf, mf, 25) };
}

// A ocorrência pertence ao dia em que a jornada COMEÇOU: a saída das 06:30 de
// 25/09, numa jornada das 22:00 às 06:00, é da jornada de 24/09.
//
// linha = { marcacao, tipo, entradaPrevista, saidaPrevista, data }
//   marcacao         "AAAA-MM-DDTHH:MM" — a batida real, com o dia em que aconteceu
//   entradaPrevista  "HH:MM"
//   saidaPrevista    "HH:MM"
//   data             só é usada quando a marcação não traz o dia
//
// Entre o dia da batida e os dois vizinhos, fica o início de jornada cuja batida
// PREVISTA cai mais perto da real. Sem a entrada prevista não dá para saber se a
// jornada vira a noite; nesse caso vale o dia da própria batida.
function dataDaJornada(linha) {
  const l = linha || {};
  const mar = lerHorario(l.marcacao);
  if (!mar || !mar.dia) {
    const d = lerData(l.data);
    return d ? isoDe(d.y, d.m, d.d) : null;
  }
  const t = tipoMarcacao(l.tipo);
  const ent = lerHorario(l.entradaPrevista), sai = lerHorario(l.saidaPrevista);
  const alvo = t === "ENTRADA" ? ent : t === "SAIDA" ? sai : null;
  if (!alvo) return mar.dia;
  const viraNoite = t === "SAIDA" && ent && sai.min < ent.min ? 1 : 0;
  const base = diaAbs(mar.dia), real = base * 1440 + mar.min;
  let melhor = base, menor = Infinity;
  for (const delta of [-1, 0, 1]) {
    const inicio = base + delta;
    const dist = Math.abs((inicio + viraNoite) * 1440 + alvo.min - real);
    if (dist < menor) { menor = dist; melhor = inicio; }
  }
  return isoDeDiaAbs(melhor);
}

// RE só com dígitos perde os zeros à esquerda: "0521" e 521 são a mesma pessoa.
function normRE(re) {
  const s = String(re == null ? "" : re).trim();
  if (/^\d+$/.test(s)) return String(BigInt(s));
  return s.toUpperCase();
}

// RE|DATA_JORNADA|TIPO|HORARIO_MARCADO, em hash. O horário entra só como HH:MM
// para que "06:30" e "2026-09-25T06:30:00" (formatos diferentes de exportações
// diferentes) não virem duas ocorrências da mesma batida.
function chaveDedup(re, dataJornada, tipo, horarioMarcado) {
  const h = lerHorario(horarioMarcado);
  const hora = h ? hhmm(h.min) : String(horarioMarcado == null ? "" : horarioMarcado).trim();
  const partes = [normRE(re), String(dataJornada == null ? "" : dataJornada).trim().slice(0, 10), String(tipo == null ? "" : tipo).trim().toUpperCase(), hora];
  return crypto.createHash("sha256").update(partes.join("|")).digest("hex");
}

// O campo MINUTOS da HR EXTRA guarda SEGUNDOS (nome histórico — ver api/rh.js).
// Ler MINUTOS como minutos deixa tudo 60× maior e ninguém percebe, porque "78"
// continua parecendo plausível. Toda conversão passa por aqui.
function minutosDeSegundos(seg) {
  const n = Number(seg);
  return Number.isFinite(n) ? Math.round(n / 60) : 0;
}

// Contagem de SMS. GSM-7 (160 por SMS, 153 por parte quando concatenado) só vale
// se TODO caractere estiver na tabela GSM; um único "ã", "ç" ou emoji joga a
// mensagem inteira para UCS-2 (70 / 67). Os caracteres da tabela de extensão
// custam duas posições cada (escape + caractere).
const GSM7_BASICO = new Set(Array.from(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
));
const GSM7_EXTENSAO = new Set(Array.from("\f^{}\\[~]|€"));

function analisarSMS(texto) {
  const s = String(texto == null ? "" : texto);
  let unidades = 0, gsm = true;
  for (const ch of s) {
    if (GSM7_BASICO.has(ch)) unidades += 1;
    else if (GSM7_EXTENSAO.has(ch)) unidades += 2;
    else { gsm = false; break; }
  }
  if (!gsm) unidades = s.length;
  const lim1 = gsm ? 160 : 70, limN = gsm ? 153 : 67;
  const segmentos = unidades === 0 ? 0 : unidades <= lim1 ? 1 : Math.ceil(unidades / limN);
  return { codificacao: gsm ? "GSM-7" : "UCS-2", caracteres: Array.from(s).length, unidades, limite: lim1, segmentos };
}

function segmentosSMS(texto) {
  return analisarSMS(texto).segmentos;
}

// ── Base de contatos ────────────────────────────────────────────────────────
// Só estas colunas entram no banco. A planilha de origem traz CPF, RG, PIS,
// título de eleitor, nome da mãe, endereço, raça, altura e peso: o que não está
// nesta lista é descartado antes de qualquer gravação.
const CAMPOS_CONTATO = ["re", "nome_cadastro", "nome_norm", "telefone_original", "telefone_e164", "tipo_telefone", "enviavel", "origem", "data_base"];
const TIPOS_CELULAR = new Set(["CELULAR", "CELULAR_CORRIGIDO"]);
const CELULAR_BR = /^\+55[1-9][1-9]9\d{8}$/;

function textoOuNulo(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function lerBooleano(v) {
  if (typeof v === "boolean") return v;
  return ["TRUE", "1", "SIM", "S", "VERDADEIRO"].includes(semAcento(v).trim().toUpperCase());
}

function lerDataBR(v) {
  const s = textoOuNulo(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return lerData(s) ? s.slice(0, 10) : null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = isoDe(Number(m[3]), Number(m[2]), Number(m[1]));
  return lerData(iso) ? iso : null;
}

function normalizarTelefone(v) {
  const s = textoOuNulo(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d ? "+" + d : null;
}

// Uma linha da planilha → contato, ou { erro }. O "enviavel" do arquivo só vale
// se o número for de fato um celular brasileiro em E.164: um fixo marcado como
// enviável por engano não pode virar SMS.
function normalizarContato(bruta) {
  const src = {};
  for (const [k, v] of Object.entries(bruta || {})) src[semAcento(k).trim().toLowerCase().replace(/\s+/g, "_")] = v;
  const re = normRE(src.re);
  if (!/^\d{1,15}$/.test(re) || /^0+$/.test(re)) return { erro: "RE_INVALIDO" };
  const tel = normalizarTelefone(src.telefone_e164);
  const tipoInformado = textoOuNulo(src.tipo_telefone);
  const tipo = tipoInformado ? semAcento(tipoInformado).toUpperCase() : (tel ? null : "SEM_TELEFONE");
  const declarado = lerBooleano(src.enviavel);
  const celularValido = !!tel && TIPOS_CELULAR.has(tipo) && CELULAR_BR.test(tel);
  return {
    contato: {
      re: Number(re),
      nome_cadastro: textoOuNulo(src.nome_cadastro),
      nome_norm: textoOuNulo(src.nome_norm),
      telefone_original: textoOuNulo(src.telefone_original),
      telefone_e164: tel,
      tipo_telefone: tipo,
      enviavel: declarado && celularValido,
      origem: textoOuNulo(src.origem),
      data_base: lerDataBR(src.data_base)
    },
    inconsistente: declarado && !celularValido
  };
}

function mesmoValor(a, b) {
  const na = a == null || a === "" ? null : a, nb = b == null || b === "" ? null : b;
  return String(na) === String(nb);
}

// Compara o arquivo com o que já está no banco e devolve o que gravar, sem
// gravar nada: a tela mostra este resumo antes de a pessoa confirmar.
// Telefone que mudou gera auditoria com o valor anterior.
function planejarContatos(existentes, linhas, opcoes) {
  const o = opcoes || {};
  const porRE = new Map((existentes || []).map(c => [normRE(c.re), c]));
  const vistos = new Set();
  const resumo = {
    total: 0, validas: 0, rejeitadas: 0,
    novos: 0, atualizados: 0, inalterados: 0, telefones_alterados: 0,
    enviaveis: 0, nao_enviaveis: 0, sem_telefone: 0, inconsistentes: 0, por_tipo: {}
  };
  const rejeitadas = [], upserts = [], auditorias = [];
  (linhas || []).forEach((bruta, i) => {
    resumo.total++;
    const linha = i + 2; // a linha 1 da planilha é o cabeçalho
    const { contato: c, erro, inconsistente } = normalizarContato(bruta);
    if (erro) { rejeitadas.push({ linha, motivo: erro }); return; }
    const k = String(c.re);
    if (vistos.has(k)) { rejeitadas.push({ linha, re: c.re, motivo: "RE_REPETIDO_NO_ARQUIVO" }); return; }
    vistos.add(k);
    resumo.validas++;
    if (inconsistente) resumo.inconsistentes++;
    if (c.enviavel) resumo.enviaveis++; else resumo.nao_enviaveis++;
    if (!c.telefone_e164) resumo.sem_telefone++;
    const tp = c.tipo_telefone || "SEM_TIPO";
    resumo.por_tipo[tp] = (resumo.por_tipo[tp] || 0) + 1;

    const ant = porRE.get(k);
    if (ant && CAMPOS_CONTATO.every(f => mesmoValor(ant[f], c[f]))) { resumo.inalterados++; return; }
    if (ant) resumo.atualizados++; else resumo.novos++;
    const u = { ...c };
    if (o.agora) u.atualizado_em = o.agora;
    upserts.push(u);
    if (ant && !mesmoValor(ant.telefone_e164, c.telefone_e164)) {
      resumo.telefones_alterados++;
      auditorias.push({
        ator: o.ator || null, acao: "TELEFONE_ALTERADO", entidade: "pt_contatos", entidade_id: c.re,
        antes: { telefone_e164: ant.telefone_e164 || null, tipo_telefone: ant.tipo_telefone || null, enviavel: !!ant.enviavel },
        depois: { telefone_e164: c.telefone_e164, tipo_telefone: c.tipo_telefone, enviavel: c.enviavel }
      });
    }
  });
  resumo.rejeitadas = rejeitadas.length;
  return { resumo, rejeitadas, upserts, auditorias };
}

// ── Configuração ────────────────────────────────────────────────────────────

function lerConfig(linhas) {
  const v = {};
  (linhas || []).forEach(l => { v[l.chave] = l.valor; });
  const num = (k, padrao) => { const n = Number(v[k]); return v[k] != null && v[k] !== "" && Number.isFinite(n) ? n : padrao; };
  const modelos = {};
  Object.keys(MODELOS_PADRAO).forEach(id => { if (textoOuNulo(v["modelo_" + id])) modelos[id] = v["modelo_" + id]; });
  return {
    tolerancia_minutos: num("tolerancia_minutos", TOLERANCIA_PADRAO_MIN),
    data_virada: lerData(v.data_virada) ? String(v.data_virada).slice(0, 10) : null,
    sms_limite_dia: num("sms_limite_dia", 50),
    sms_limite_mes: num("sms_limite_mes", 300),
    alerta_pct: num("alerta_pct", 80),
    critico_pct: num("critico_pct", 90),
    modelos
  };
}

// ── Ocorrências a partir da aba HR EXTRA ────────────────────────────────────

const TIPOS_HE = new Set(["EXTRA ENTRADA", "EXTRA SAIDA"]);

function tipoHE(tipo) {
  const t = semAcento(tipo).toUpperCase().trim().replace(/\s+/g, " ");
  return TIPOS_HE.has(t) ? t : null;
}

function soHora(v) {
  const h = lerHorario(v);
  return h ? hhmm(h.min) : null;
}

function reValido(s) {
  return /^\d{1,15}$/.test(s) && !/^0+$/.test(s) ? Number(s) : null;
}

function campoSistema(v) {
  const s = textoOuNulo(v);
  return s && s !== "—" ? s : null;
}

// Lê as linhas da HR EXTRA e devolve as ocorrências a gravar, já com RE e
// chave de deduplicação. Nada de banco aqui.
//
// opcoes = { tolerancia, dataVirada, normNome, origem }
//   dataVirada vazia → o módulo está desligado e nada é criado.
//   normNome → a MESMA normalização do ativosNomeMap (api/_parse.js).
//
// O RE vem da própria linha quando a aba traz a coluna; senão, do nome no
// quadro de ativos. Nome sem par, ou com mais de um par, fica pendente de
// reconciliação e não gera mensagem.
function detectarOcorrencias(hrextra, ativos, opcoes) {
  const o = opcoes || {};
  const normNome = o.normNome;
  const stats = { linhas: 0, consideradas: 0, sem_horario: 0, dentro_tolerancia: 0, antes_da_virada: 0, repetidas: 0, ocorrencias: 0, pendentes_reconciliacao: 0 };
  const virada = lerData(o.dataVirada) ? String(o.dataVirada).slice(0, 10) : null;
  if (!virada) return { ativo: false, ocorrencias: [], stats };

  const porNome = new Map(), porRE = new Map();
  (ativos || []).forEach(a => {
    const re = reValido(normRE(a.RE));
    if (re != null) porRE.set(String(re), a);
    if (a.NOME) {
      const k = normNome(a.NOME);
      if (!porNome.has(k)) porNome.set(k, []);
      porNome.get(k).push(a);
    }
  });

  const vistas = new Set(), ocorrencias = [];
  (hrextra || []).forEach(l => {
    stats.linhas++;
    const tipoLinha = tipoHE(l.TIPO);
    if (!tipoLinha) return;
    stats.consideradas++;
    const entrada = tipoLinha === "EXTRA ENTRADA";
    const previsto = entrada ? l.HRENTRADA : l.HRSAIDA;
    const marcado = entrada ? l.HRMRENTRADA : l.HRMRSAIDA;
    if (!lerHorario(previsto) || !lerHorario(marcado)) { stats.sem_horario++; return; }
    const c = classificar(previsto, marcado, tipoLinha, o.tolerancia);
    if (!c) { stats.dentro_tolerancia++; return; }
    const dataJornada = dataDaJornada({ marcacao: marcado, data: l.DATA, tipo: tipoLinha, entradaPrevista: l.HRENTRADA, saidaPrevista: l.HRSAIDA });
    if (!dataJornada) { stats.sem_horario++; return; }
    if (dataJornada < virada) { stats.antes_da_virada++; return; }

    let re = null, reconciliacao = null, ativo = null;
    const reLinha = reValido(normRE(l.RE));
    if (reLinha != null) {
      re = reLinha;
      ativo = porRE.get(String(reLinha)) || null;
      if (!ativo) reconciliacao = "RE_NAO_ENCONTRADO";
    } else {
      const achados = porNome.get(normNome(l.NOME)) || [];
      if (achados.length === 1) { ativo = achados[0]; re = reValido(normRE(ativo.RE)); }
      if (re == null) reconciliacao = achados.length > 1 ? "NOME_AMBIGUO" : "NOME_NAO_ENCONTRADO";
    }

    const identidade = re != null ? re : "NOME:" + normNome(l.NOME);
    const chave = chaveDedup(identidade, dataJornada, c.tipo, marcado);
    if (vistas.has(chave)) { stats.repetidas++; return; }
    vistas.add(chave);
    stats.ocorrencias++;
    if (reconciliacao) stats.pendentes_reconciliacao++;

    ocorrencias.push({
      re,
      nome: textoOuNulo(l.NOME) || (ativo && textoOuNulo(ativo.NOME)) || "—",
      data_jornada: dataJornada,
      tipo: c.tipo,
      horario_previsto: soHora(previsto),
      horario_marcado: soHora(marcado),
      diferenca_minutos: c.minutos,
      posto: campoSistema(l.LOCAL) || (ativo && campoSistema(ativo.LOCAL)) || null,
      cliente: campoSistema(l.CLIENTE) || (ativo && campoSistema(ativo.TPCLIENTE)) || null,
      supervisor: campoSistema(l.AREA) || (ativo && campoSistema(ativo.AREA)) || null,
      origem: o.origem || "SAR2G_PLANILHA",
      chave_dedup: chave,
      status: "DETECTADA",
      reconciliacao,
      is_test: false,
      dado_original: {
        NOME: l.NOME == null ? null : l.NOME, DATA: l.DATA == null ? null : l.DATA, TIPO: l.TIPO == null ? null : l.TIPO,
        RE: textoOuNulo(l.RE), MINUTOS: l.MINUTOS == null ? null : l.MINUTOS,
        HRENTRADA: l.HRENTRADA || null, HRMRENTRADA: l.HRMRENTRADA || null, HRSAIDA: l.HRSAIDA || null, HRMRSAIDA: l.HRMRSAIDA || null,
        LOCAL: l.LOCAL == null ? null : l.LOCAL, CLIENTE: l.CLIENTE == null ? null : l.CLIENTE, AREA: l.AREA == null ? null : l.AREA
      }
    });
  });
  return { ativo: true, ocorrencias, stats };
}

// Competências tocadas pelas ocorrências. A que contém a data de virada nasce
// PARCIAL, com o corte na virada: os dias anteriores não existem no módulo.
function competenciasNecessarias(ocorrencias, dataVirada) {
  const mapa = new Map();
  (ocorrencias || []).forEach(oc => {
    const c = competenciaDe(oc.data_jornada);
    if (!c || mapa.has(c.inicio)) return;
    const parcial = !!dataVirada && dataVirada > c.inicio && dataVirada <= c.fim;
    mapa.set(c.inicio, { data_inicio: c.inicio, data_fim: c.fim, parcial, data_corte: parcial ? dataVirada : null });
  });
  return [...mapa.values()];
}

// ── Mensagens ───────────────────────────────────────────────────────────────
// Sem acento e sem mencionar custo, hora extra, pagamento ou desconto: o
// objetivo é só orientar a marcar dentro do horário.
const MODELOS_PADRAO = {
  entrada_antecipada: "SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua entrada foi as {{horario_marcado}}, {{minutos}} min antes do previsto ({{horario_previsto}}). Oriente-se a marcar no horario. RE {{re}}.",
  saida_apos_horario: "SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua saida foi as {{horario_marcado}}, {{minutos}} min apos o previsto ({{horario_previsto}}). Oriente-se a marcar no horario. RE {{re}}.",
  ambas_no_mesmo_dia: "SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua entrada foi as {{entrada_marcada}} e a saida as {{saida_marcada}}, fora do previsto ({{entrada_prevista}} as {{saida_prevista}}). Oriente-se a marcar no horario. RE {{re}}."
};

const VARIAVEIS_MODELO = {
  entrada_antecipada: ["nome", "data", "horario_marcado", "minutos", "horario_previsto", "re"],
  saida_apos_horario: ["nome", "data", "horario_marcado", "minutos", "horario_previsto", "re"],
  ambas_no_mesmo_dia: ["nome", "data", "entrada_marcada", "saida_marcada", "entrada_prevista", "saida_prevista", "re"]
};

// Valores no limite do que é realista aqui (nome de 10 letras, RE de 5 dígitos,
// 95 minutos): se o modelo couber em 1 SMS com eles, cabe para quase todo mundo.
// A mensagem de cada pessoa é contada de novo quando é gerada.
const AMOSTRA_MODELO = {
  nome: "Alessandra", data: "25/09", horario_marcado: "17:54", horario_previsto: "18:00", minutos: 95, re: "12345",
  entrada_marcada: "06:40", saida_marcada: "19:35", entrada_prevista: "07:00", saida_prevista: "19:00"
};

// Validação ao salvar um modelo. Regras do plano: sem acento, até 160
// caracteres, sem falar de custo/hora extra/pagamento/desconto e sem variável
// que o sistema não sabe preencher.
function validarModelo(id, texto) {
  const permitidas = VARIAVEIS_MODELO[id];
  if (!permitidas) return { erro: "MODELO_DESCONHECIDO" };
  const t = String(texto == null ? "" : texto).replace(/\r\n/g, "\n").trim();
  if (!t) return { erro: "TEXTO_VAZIO" };
  const usadas = [...t.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(m => m[1]);
  const desconhecidas = [...new Set(usadas.filter(v => !permitidas.includes(v)))];
  if (desconhecidas.length) return { erro: "VARIAVEL_DESCONHECIDA", variaveis: desconhecidas, permitidas };
  if (/\{\{|\}\}/.test(t.replace(/\{\{\s*[a-z_]+\s*\}\}/g, ""))) return { erro: "CHAVES_SOLTAS" };
  if (PROIBIDO_NA_MENSAGEM.test(semAcento(t))) return { erro: "TERMO_PROIBIDO" };
  const amostra = renderizar(t, AMOSTRA_MODELO);
  const sms = analisarSMS(amostra);
  if (sms.codificacao !== "GSM-7") return { erro: "COM_ACENTO" };
  if (sms.unidades > 160) return { erro: "ACIMA_DE_160", caracteres: sms.unidades };
  return { texto: t, amostra, caracteres: sms.unidades, segmentos: sms.segmentos, variaveis: [...new Set(usadas)] };
}

// Ajustes do módulo. A data de virada só pode ser hoje ou depois: uma data no
// passado faria a próxima importação criar ocorrências retroativas. E depois
// que já existem ocorrências, ela não muda mais.
function validarConfig(pedido, atual, contexto) {
  const p = pedido || {}, c = contexto || {};
  const patch = {};
  const inteiro = (k, min, max) => {
    if (p[k] === undefined) return null;
    const n = Number(p[k]);
    if (!Number.isInteger(n) || n < min || n > max) return { erro: "VALOR_INVALIDO", campo: k, min, max };
    if (n !== atual[k]) patch[k] = n;
    return null;
  };
  const falha = inteiro("tolerancia_minutos", 0, 60) || inteiro("sms_limite_dia", 1, 10000) || inteiro("sms_limite_mes", 1, 300000) ||
    inteiro("alerta_pct", 1, 100) || inteiro("critico_pct", 1, 100);
  if (falha) return falha;
  const alerta = patch.alerta_pct != null ? patch.alerta_pct : atual.alerta_pct;
  const critico = patch.critico_pct != null ? patch.critico_pct : atual.critico_pct;
  if (alerta >= critico) return { erro: "ALERTA_ACIMA_DO_CRITICO" };
  const dia = patch.sms_limite_dia != null ? patch.sms_limite_dia : atual.sms_limite_dia;
  const mes = patch.sms_limite_mes != null ? patch.sms_limite_mes : atual.sms_limite_mes;
  if (dia > mes) return { erro: "LIMITE_DIA_ACIMA_DO_MES" };
  if (p.data_virada !== undefined && p.data_virada !== atual.data_virada) {
    const d = textoOuNulo(p.data_virada);
    if (!d || !lerData(d) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { erro: "DATA_INVALIDA", campo: "data_virada" };
    if (c.hoje && d < c.hoje) return { erro: "VIRADA_NO_PASSADO" };
    if (atual.data_virada && c.haOcorrencias) return { erro: "VIRADA_JA_EM_USO" };
    patch.data_virada = d;
  }
  return { patch };
}

function renderizar(modelo, vars) {
  return String(modelo || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}

// Só o primeiro nome, sem acento: um "José" no meio do texto jogaria a mensagem
// inteira para UCS-2 (70 caracteres por SMS em vez de 160).
function primeiroNome(nome) {
  const p = semAcento(nome).trim().split(/\s+/)[0] || "";
  return p.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join("-");
}

function ddmm(iso) {
  const d = lerData(iso);
  return d ? `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}` : "";
}

function montarMensagem(lista, modelos) {
  const maior = arr => arr.reduce((a, b) => (!a || b.diferenca_minutos > a.diferenca_minutos ? b : a), null);
  const ent = maior(lista.filter(x => x.tipo === "EARLY_ENTRY"));
  const sai = maior(lista.filter(x => x.tipo === "LATE_EXIT"));
  const ref = ent || sai;
  const base = { nome: primeiroNome(ref.nome), data: ddmm(ref.data_jornada), re: String(ref.re) };
  let template_id, vars;
  if (ent && sai) {
    template_id = "ambas_no_mesmo_dia";
    vars = { ...base, entrada_marcada: ent.horario_marcado, saida_marcada: sai.horario_marcado, entrada_prevista: ent.horario_previsto, saida_prevista: sai.horario_previsto };
  } else {
    template_id = ent ? "entrada_antecipada" : "saida_apos_horario";
    vars = { ...base, horario_marcado: ref.horario_marcado, horario_previsto: ref.horario_previsto, minutos: ref.diferenca_minutos };
  }
  const texto = renderizar(modelos[template_id], vars);
  return { template_id, texto_gerado: texto, segmentos: segmentosSMS(texto) };
}

// Telefone que a mensagem usaria e, se não puder ser enviada, por quê.
// No envio o telefone é conferido de novo: isto aqui é o retrato da fila.
function situacaoTelefone(contato) {
  if (!contato || !contato.telefone_e164) return { telefone: null, bloqueio: "TELEFONE_AUSENTE" };
  if (String(contato.tipo_telefone || "").toUpperCase() === "FIXO") return { telefone: contato.telefone_e164, bloqueio: "TELEFONE_FIXO" };
  if (!contato.enviavel || !CELULAR_BR.test(contato.telefone_e164)) return { telefone: contato.telefone_e164, bloqueio: "TELEFONE_INVALIDO" };
  return { telefone: contato.telefone_e164, bloqueio: null };
}

// Uma mensagem por colaborador por dia; duas ocorrências no mesmo dia viram um
// texto só, que menciona as duas. Pendente de reconciliação não entra.
//
// opcoes = { contatosPorRE: Map(re → contato), existentes: Map("re|data" → mensagem), modelos }
// Mensagem já aprovada, enviada ou rejeitada não é tocada; a que ainda aguarda
// validação é atualizada — mas um texto editado por alguém não é sobrescrito.
function planejarMensagens(ocorrencias, opcoes) {
  const o = opcoes || {};
  const modelos = { ...MODELOS_PADRAO, ...(o.modelos || {}) };
  const grupos = new Map();
  (ocorrencias || []).forEach(oc => {
    if (oc.re == null || oc.reconciliacao || oc.is_test || oc.id == null) return;
    const k = `${oc.re}|${oc.data_jornada}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(oc);
  });
  const inserir = [], atualizar = [];
  for (const [k, lista] of grupos) {
    const { re, data_jornada } = lista[0];
    const msg = montarMensagem(lista, modelos);
    const { telefone, bloqueio } = situacaoTelefone(o.contatosPorRE && o.contatosPorRE.get(String(re)));
    const ids = lista.map(x => Number(x.id)).sort((a, b) => a - b);
    const ex = o.existentes && o.existentes.get(k);
    if (!ex) {
      inserir.push({
        re, data_jornada, ocorrencia_ids: ids, telefone_e164: telefone,
        template_id: msg.template_id, texto_gerado: msg.texto_gerado, texto_final: null, segmentos: msg.segmentos,
        status: "AGUARDANDO_VALIDACAO", motivo_bloqueio: bloqueio, is_test: false
      });
      continue;
    }
    if (ex.status !== "AGUARDANDO_VALIDACAO") continue;
    const patch = {};
    if (!ex.editado_em) {
      const uniao = [...new Set([...(ex.ocorrencia_ids || []).map(Number), ...ids])].sort((a, b) => a - b);
      if (uniao.join(",") !== (ex.ocorrencia_ids || []).map(Number).sort((a, b) => a - b).join(",")) patch.ocorrencia_ids = uniao;
      if (ex.texto_gerado !== msg.texto_gerado) Object.assign(patch, msg);
    }
    if ((ex.telefone_e164 || null) !== telefone) patch.telefone_e164 = telefone;
    if ((ex.motivo_bloqueio || null) !== bloqueio) patch.motivo_bloqueio = bloqueio;
    if (Object.keys(patch).length) atualizar.push({ id: ex.id, patch });
  }
  return { inserir, atualizar };
}

// ── Painel ──────────────────────────────────────────────────────────────────
// Teste (is_test) nunca entra em indicador, ficha ou reincidência.

function somaMinutos(lista) {
  return lista.reduce((t, o) => t + (Number(o.diferenca_minutos) || 0), 0);
}

function resumoCompetencia(ocorrencias, mensagens) {
  const oc = (ocorrencias || []).filter(o => !o.is_test);
  const ms = (mensagens || []).filter(m => !m.is_test);
  const ent = oc.filter(o => o.tipo === "EARLY_ENTRY"), sai = oc.filter(o => o.tipo === "LATE_EXIT");
  const conta = s => ms.filter(m => m.status === s).length;
  const aguardando = ms.filter(m => m.status === "AGUARDANDO_VALIDACAO");
  return {
    ocorrencias: oc.length,
    colaboradores: new Set(oc.filter(o => o.re != null).map(o => String(o.re))).size,
    entradas_antecipadas: { qtd: ent.length, minutos: somaMinutos(ent) },
    saidas_apos_horario: { qtd: sai.length, minutos: somaMinutos(sai) },
    minutos_excedentes: somaMinutos(oc),
    pendentes_reconciliacao: oc.filter(o => o.reconciliacao).length,
    mensagens: {
      aguardando: aguardando.length,
      bloqueadas: aguardando.filter(m => m.motivo_bloqueio).length,
      aprovadas: conta("APROVADA"), enviadas: conta("ENVIADA"), falhas: conta("FALHA"), rejeitadas: conta("REJEITADA")
    },
    colaboradores_sem_telefone: new Set(aguardando.filter(m => /^TELEFONE_/.test(m.motivo_bloqueio || "")).map(m => String(m.re))).size
  };
}

// Quem não aprova vê o telefone mascarado: +55 19 ****-5432.
function mascararTelefone(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (!d) return null;
  return d.length < 8 ? "****" : `+${d.slice(0, 2)} ${d.slice(2, 4)} ****-${d.slice(-4)}`;
}

function linhaDaFila(m, porId, mascarar) {
  const itens = (m.ocorrencia_ids || []).map(id => porId.get(Number(id))).filter(Boolean)
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "EARLY_ENTRY" ? -1 : 1));
  const texto = m.texto_final || m.texto_gerado || "";
  const sms = analisarSMS(texto);
  const ref = itens[0] || {};
  return {
    id: m.id, re: m.re, nome: ref.nome || null, posto: ref.posto || null, cliente: ref.cliente || null, supervisor: ref.supervisor || null,
    data_jornada: String(m.data_jornada).slice(0, 10),
    itens: itens.map(x => ({ id: x.id, tipo: x.tipo, previsto: x.horario_previsto, marcado: x.horario_marcado, minutos: x.diferenca_minutos })),
    minutos: somaMinutos(itens),
    telefone: mascarar ? mascararTelefone(m.telefone_e164) : (m.telefone_e164 || null),
    texto, editado: !!m.editado_em, segmentos: sms.segmentos, codificacao: sms.codificacao, caracteres: sms.caracteres,
    status: m.status, motivo_bloqueio: m.motivo_bloqueio || null,
    aprovado_por: m.aprovado_por || null, aprovado_em: m.aprovado_em || null, enviado_em: m.enviado_em || null,
    rejeitado_por: m.rejeitado_por || null, motivo_rejeicao: m.motivo_rejeicao || null,
    erro_codigo: m.erro_codigo || null, erro_mensagem: m.erro_mensagem || null
  };
}

// Mais recente primeiro; no mesmo dia, quem tem mais tempo fora do horário.
function montarFila(mensagens, ocorrencias, opcoes) {
  const porId = new Map((ocorrencias || []).map(x => [Number(x.id), x]));
  const mascarar = !!(opcoes && opcoes.mascarar);
  return (mensagens || []).filter(m => !m.is_test).map(m => linhaDaFila(m, porId, mascarar))
    .sort((a, b) => (a.data_jornada === b.data_jornada ? b.minutos - a.minutos : a.data_jornada < b.data_jornada ? 1 : -1));
}

// Ficha de um RE. Reincidência = ocorrência depois de uma orientação já enviada.
function montarFicha(re, dados) {
  const d = dados || {};
  const mascarar = !!d.mascarar;
  const oc = (d.ocorrencias || []).filter(x => !x.is_test)
    .sort((a, b) => (a.data_jornada === b.data_jornada ? 0 : a.data_jornada < b.data_jornada ? 1 : -1));
  const ms = (d.mensagens || []).filter(x => !x.is_test);
  const enviadas = ms.filter(m => m.status === "ENVIADA" && m.enviado_em).map(m => String(m.enviado_em).slice(0, 10)).sort();
  const primeira = enviadas[0] || null;
  const historico = oc.map(x => ({
    id: x.id, data_jornada: String(x.data_jornada).slice(0, 10), tipo: x.tipo,
    previsto: x.horario_previsto, marcado: x.horario_marcado, minutos: x.diferenca_minutos,
    posto: x.posto || null, supervisor: x.supervisor || null,
    apos_orientacao: !!primeira && String(x.data_jornada).slice(0, 10) > primeira
  }));
  const comp = d.competencia || null;
  const dentro = x => comp && String(x.data_jornada).slice(0, 10) >= comp.inicio && String(x.data_jornada).slice(0, 10) <= comp.fim;
  const ocComp = oc.filter(dentro), msComp = ms.filter(dentro);
  const porId = new Map(oc.map(x => [Number(x.id), x]));
  const a = d.ativo || null, c = d.contato || null;
  return {
    re,
    nome: (a && textoOuNulo(a.NOME)) || (oc[0] && oc[0].nome) || null,
    no_quadro_ativo: !!a,
    posto_atual: a ? campoSistema(a.LOCAL) : null,
    supervisor_atual: a ? campoSistema(a.AREA) : null,
    cargo: a ? campoSistema(a.CARGO) : null,
    telefone: c ? (mascarar ? mascararTelefone(c.telefone_e164) : c.telefone_e164 || null) : null,
    tipo_telefone: c ? c.tipo_telefone || null : null,
    enviavel: !!(c && c.enviavel),
    competencia: comp ? { ...comp, resumo: resumoCompetencia(ocComp, msComp), dias_com_ocorrencia: new Set(ocComp.map(x => String(x.data_jornada).slice(0, 10))).size } : null,
    historico,
    reincidente: historico.some(h => h.apos_orientacao),
    acoes: ms.map(m => linhaDaFila(m, porId, mascarar)).sort((x, y) => (x.data_jornada < y.data_jornada ? 1 : -1))
  };
}

// Nomes da HR EXTRA sem par (ou com mais de um par) no quadro ativo. Enquanto
// estiverem aqui, essas ocorrências não entram na fila de envio. Para nome
// ambíguo, lista quem são os candidatos — a correção é feita na origem.
function agruparReconciliacao(ocorrencias, ativos, normNome) {
  const candidatos = new Map();
  (ativos || []).forEach(a => {
    if (!a.NOME) return;
    const k = normNome(a.NOME);
    if (!candidatos.has(k)) candidatos.set(k, []);
    candidatos.get(k).push({ re: reValido(normRE(a.RE)), nome: textoOuNulo(a.NOME), supervisor: campoSistema(a.AREA), posto: campoSistema(a.LOCAL) });
  });
  const grupos = new Map();
  (ocorrencias || []).filter(o => o.reconciliacao && !o.is_test).forEach(o => {
    const k = `${o.reconciliacao}|${o.reconciliacao === "RE_NAO_ENCONTRADO" ? o.re : normNome(o.nome)}`;
    if (!grupos.has(k)) grupos.set(k, { motivo: o.reconciliacao, nome: o.nome, re: o.re == null ? null : o.re, supervisor: o.supervisor || null, ocorrencias: 0, minutos: 0, dias: new Set(), ultima_data: null });
    const g = grupos.get(k);
    const dia = String(o.data_jornada).slice(0, 10);
    g.ocorrencias++;
    g.minutos += Number(o.diferenca_minutos) || 0;
    g.dias.add(dia);
    if (!g.ultima_data || dia > g.ultima_data) g.ultima_data = dia;
  });
  return [...grupos.values()]
    .map(g => ({ ...g, dias: g.dias.size, candidatos: g.motivo === "NOME_AMBIGUO" ? candidatos.get(normNome(g.nome)) || [] : [] }))
    .sort((a, b) => b.ocorrencias - a.ocorrencias || String(a.nome).localeCompare(String(b.nome)));
}

// ── Validação humana ────────────────────────────────────────────────────────
// Devolvem null quando pode, ou o código do motivo quando não pode.

function motivoParaNaoAprovar(m) {
  if (!m) return "NAO_ENCONTRADA";
  if (m.status === "ENVIADA") return "JA_ENVIADA";
  if (m.status !== "AGUARDANDO_VALIDACAO") return "STATUS_" + m.status;
  if (m.motivo_bloqueio) return m.motivo_bloqueio;
  if (!m.telefone_e164) return "TELEFONE_AUSENTE";
  if (!textoOuNulo(m.texto_final || m.texto_gerado)) return "SEM_TEXTO";
  return null;
}

function motivoParaNaoRejeitar(m) {
  if (!m) return "NAO_ENCONTRADA";
  if (m.status === "ENVIADA") return "JA_ENVIADA";
  if (!["AGUARDANDO_VALIDACAO", "APROVADA", "FALHA"].includes(m.status)) return "STATUS_" + m.status;
  return null;
}

// O objetivo é orientar a marcar no horário: a mensagem não fala de custo,
// hora extra, pagamento ou desconto — nem depois de editada à mão.
const PROIBIDO_NA_MENSAGEM = /\b(horas?\s+extras?|custos?|pagamentos?|pagar|pago|descontos?|descontar|descontad[oa]s?)\b/i;

function validarTextoMensagem(texto) {
  const t = String(texto == null ? "" : texto).trim();
  if (!t) return { erro: "TEXTO_VAZIO" };
  if (t.length > 670) return { erro: "TEXTO_LONGO" };
  if (PROIBIDO_NA_MENSAGEM.test(semAcento(t))) return { erro: "TERMO_PROIBIDO" };
  return { texto: t, ...analisarSMS(t) };
}

// ── Cota de SMS ─────────────────────────────────────────────────────────────
// Conta SEGMENTOS, não mensagens. "Mês" é o mês do calendário.

function estadoCota(usado, limite, cfg) {
  if (!(limite > 0) || usado >= limite) return "LIMITE_ATINGIDO";
  const pct = (usado / limite) * 100;
  if (pct >= cfg.critico_pct) return "PROXIMO_DO_LIMITE";
  if (pct >= cfg.alerta_pct) return "ATENCAO";
  return "NORMAL";
}

function resumoCota(usos, hoje, cfg) {
  const lista = usos || [];
  const dia = lista.filter(u => String(u.dia).slice(0, 10) === hoje).reduce((t, u) => t + (Number(u.segmentos_dia) || 0), 0);
  const mes = lista.filter(u => String(u.dia).slice(0, 7) === hoje.slice(0, 7)).reduce((t, u) => t + (Number(u.segmentos_dia) || 0), 0);
  const item = (usado, limite) => ({ usado, limite, disponivel: Math.max(0, limite - usado), estado: estadoCota(usado, limite, cfg) });
  const r = { dia: hoje, hoje: item(dia, cfg.sms_limite_dia), mes: item(mes, cfg.sms_limite_mes) };
  r.disponivel = Math.min(r.hoje.disponivel, r.mes.disponivel);
  return r;
}

module.exports = {
  CAMPOS_CONTATO,
  normalizarContato,
  planejarContatos,
  resumoCompetencia,
  mascararTelefone,
  montarFila,
  montarFicha,
  agruparReconciliacao,
  motivoParaNaoAprovar,
  motivoParaNaoRejeitar,
  PROIBIDO_NA_MENSAGEM,
  validarTextoMensagem,
  resumoCota,
  lerConfig,
  detectarOcorrencias,
  competenciasNecessarias,
  MODELOS_PADRAO,
  VARIAVEIS_MODELO,
  AMOSTRA_MODELO,
  validarModelo,
  validarConfig,
  renderizar,
  primeiroNome,
  situacaoTelefone,
  planejarMensagens,
  TOLERANCIA_PADRAO_MIN,
  classificar,
  competenciaDe,
  dataDaJornada,
  chaveDedup,
  segmentosSMS,
  analisarSMS,
  minutosDeSegundos,
  lerHorario,
  tipoMarcacao,
  normRE
};
