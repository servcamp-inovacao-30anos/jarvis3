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

module.exports = {
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
