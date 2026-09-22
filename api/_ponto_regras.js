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

module.exports = {
  CAMPOS_CONTATO,
  normalizarContato,
  planejarContatos,
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
