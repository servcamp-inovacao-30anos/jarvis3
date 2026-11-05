// api/_agenda_ics.js — lê um calendário .ics (o calendário público do iCloud de cada diretor) e devolve só
// os horários OCUPADOS: [[inicioMs, fimMs], ...], já juntando os que se encostam. Sem rede, só texto.
//
// O que entende (o que o iPhone/iCloud gera na prática):
// • DTSTART/DTEND em UTC ("…Z"), com TZID (America/Sao_Paulo e qualquer fuso do Intl) ou sem fuso (Brasília)
// • dia inteiro (VALUE=DATE) e DURATION
// • repetição RRULE: DAILY, WEEKLY (BYDAY), MONTHLY (BYMONTHDAY ou BYDAY com ordinal: 2ª terça, última sexta),
//   YEARLY; INTERVAL, COUNT e UNTIL
// • exceções: EXDATE (ocorrência apagada) e RECURRENCE-ID (ocorrência movida/alterada)
// • ignora o que não ocupa: STATUS:CANCELLED e TRANSP:TRANSPARENT ("livre" — o padrão do iPhone para dia inteiro)
// Títulos, locais e descrições nunca saem daqui.

"use strict";

const MIN = 60000, DIA = 86400000;
const TZ_PADRAO = "America/Sao_Paulo";
const DIAS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// nomes de fuso do Windows/Outlook que aparecem em .ics
const TZ_WINDOWS = { "E. South America Standard Time": "America/Sao_Paulo", "SA Eastern Standard Time": "America/Cayenne", "UTC": "UTC" };

// linhas dobradas (continuação começa com espaço ou tab) voltam a ser uma só
function desdobrar(txt) { return String(txt || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/); }

// "NOME;P1=V1;P2=\"V:2\":valor" → { nome, params, valor } (o ":" dentro de aspas não separa)
function prop(linha) {
  let i = -1, aspas = false;
  for (let k = 0; k < linha.length; k++) {
    const ch = linha[k];
    if (ch === '"') aspas = !aspas;
    else if (ch === ":" && !aspas) { i = k; break; }
  }
  if (i < 0) return null;
  const partes = linha.slice(0, i).split(";"), params = {};
  partes.slice(1).forEach(p => { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); });
  return { nome: partes[0].toUpperCase(), params, valor: linha.slice(i + 1) };
}

function eventos(txt) {
  const out = [];
  let ev = null, prof = 0;
  for (const l of desdobrar(txt)) {
    if (/^BEGIN:VEVENT\s*$/i.test(l)) { ev = []; prof = 0; continue; }
    if (/^END:VEVENT\s*$/i.test(l)) { if (ev) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    if (/^BEGIN:/i.test(l)) { prof++; continue; }   // VALARM e afins dentro do evento
    if (/^END:/i.test(l)) { prof--; continue; }
    if (prof > 0) continue;
    const p = prop(l);
    if (p) ev.push(p);
  }
  return out.map(props => ({ get: n => props.find(p => p.nome === n) || null, todos: n => props.filter(p => p.nome === n) }));
}

function fusoValido(tz) {
  if (!tz) return null;
  const t = TZ_WINDOWS[tz] || tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: t }); return t; } catch (e) { return null; }
}
// minutos a somar ao UTC para chegar à hora local do fuso, naquele instante
function offsetMin(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {};
  f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / MIN);
}

// "20261106T100000Z" | "20261106T100000" | "20261106" → componentes "de parede"
function lerData(valor, params) {
  const m = String(valor || "").trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
  if (!m) return null;
  const diaInteiro = !m[4] || String((params && params.VALUE) || "").toUpperCase() === "DATE";
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), utc: !!m[7], tz: (params && params.TZID) || null, diaInteiro };
}
// componentes de parede → milissegundos UTC (dia inteiro e hora sem fuso = Brasília)
function paraMs(c) {
  const base = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  if (c.utc) return base;
  const tz = (!c.diaInteiro && fusoValido(c.tz)) || TZ_PADRAO;
  const off = offsetMin(base, tz);
  let ms = base - off * MIN;
  const off2 = offsetMin(ms, tz);
  if (off2 !== off) ms = base - off2 * MIN; // perto de troca de horário de verão
  return ms;
}

function duracaoMs(v) {
  const m = String(v || "").trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const ms = (+(m[2] || 0) * 7 + +(m[3] || 0)) * DIA + +(m[4] || 0) * 3600000 + +(m[5] || 0) * MIN + +(m[6] || 0) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const somaDias = (c, n) => { const t = new Date(Date.UTC(c.y, c.mo - 1, c.d + n)); return Object.assign({}, c, { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }); };
const diaDaSemana = c => new Date(Date.UTC(c.y, c.mo - 1, c.d)).getUTCDay();
const ultimoDia = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function lerRrule(txt) {
  const r = {};
  String(txt || "").split(";").forEach(p => { const [k, v] = p.split("="); if (k && v != null) r[k.toUpperCase()] = v; });
  return r;
}
// dias do mês que casam com BYDAY (com ordinal: 2MO = 2ª segunda, -1FR = última sexta) ou BYMONTHDAY
function diasDoMes(y, mo, byday, bymd, padrao) {
  const ult = ultimoDia(y, mo);
  let ds = [];
  if (bymd) ds = bymd.map(x => x < 0 ? ult + x + 1 : x);
  else if (byday) {
    byday.forEach(b => {
      const todos = [];
      for (let d = 1; d <= ult; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.d) todos.push(d);
      if (!b.n) ds.push(...todos);
      else { const x = b.n > 0 ? todos[b.n - 1] : todos[todos.length + b.n]; if (x) ds.push(x); }
    });
  } else ds = [padrao];
  return [...new Set(ds.filter(d => d >= 1 && d <= ult))].sort((a, b) => a - b);
}

// Inícios (componentes de parede) das ocorrências até "ate" (ms). COUNT conta desde o DTSTART, como manda a regra.
function expandir(c0, rr, ate, max) {
  const int = Math.max(1, Number(rr.INTERVAL) || 1), count = rr.COUNT ? Number(rr.COUNT) : Infinity;
  let untilMs = Infinity;
  if (rr.UNTIL) {
    const u = lerData(rr.UNTIL, {});
    if (u) untilMs = u.diaInteiro ? paraMs(Object.assign({}, u, { h: 23, mi: 59, s: 59 })) : paraMs(Object.assign({}, u, u.utc ? {} : { tz: c0.tz }));
  }
  const byday = rr.BYDAY ? rr.BYDAY.split(",").map(s => { const m = s.trim().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i); return m ? { n: m[1] ? Number(m[1]) : 0, d: DIAS[m[2].toUpperCase()] } : null; }).filter(Boolean) : null;
  const bymd = rr.BYMONTHDAY ? rr.BYMONTHDAY.split(",").map(Number).filter(Boolean) : null;
  const bymo = rr.BYMONTH ? rr.BYMONTH.split(",").map(Number).filter(Boolean) : null;
  const inicio = paraMs(c0), out = [];
  let n = 0;
  // false = parar
  const emite = c => {
    const ms = paraMs(c);
    if (ms < inicio) return true;
    if (ms > untilMs || n >= count) return false;
    n++;
    if (ms > ate) return false;
    out.push(c);
    return out.length < max;
  };
  const f = String(rr.FREQ || "").toUpperCase();
  if (f === "DAILY") {
    for (let i = 0; i < 40000; i++) {
      const c = somaDias(c0, i * int);
      if (bymo && !bymo.includes(c.mo)) continue;
      if (byday && !byday.some(b => b.d === diaDaSemana(c))) continue;
      if (!emite(c)) break;
    }
  } else if (f === "WEEKLY") {
    const dias = byday ? byday.map(b => b.d) : [diaDaSemana(c0)];
    const wkst = DIAS[String(rr.WKST || "MO").toUpperCase()] || 1;
    const comeco = somaDias(c0, -((diaDaSemana(c0) - wkst + 7) % 7));
    for (let w = 0; w < 6000; w++) {
      const base = somaDias(comeco, w * 7 * int);
      let parar = false;
      for (let i = 0; i < 7 && !parar; i++) { const c = somaDias(base, i); if (dias.includes(diaDaSemana(c)) && !emite(c)) parar = true; }
      if (parar || paraMs(base) > ate) break;
    }
  } else if (f === "MONTHLY") {
    for (let k = 0; k < 3000; k++) {
      const t = c0.mo - 1 + k * int, y = c0.y + Math.floor(t / 12), mo = t % 12 + 1;
      let parar = false;
      for (const d of diasDoMes(y, mo, byday, bymd, c0.d)) if (!emite(Object.assign({}, c0, { y, mo, d }))) { parar = true; break; }
      if (parar || Date.UTC(y, mo - 1, 1) > ate) break;
    }
  } else if (f === "YEARLY") {
    for (let k = 0; k < 300; k++) {
      const y = c0.y + k * int;
      let parar = false;
      for (const mo of (bymo || [c0.mo])) {
        for (const d of diasDoMes(y, mo, byday, bymd, c0.d)) if (!emite(Object.assign({}, c0, { y, mo, d }))) { parar = true; break; }
        if (parar) break;
      }
      if (parar || Date.UTC(y, 0, 1) > ate) break;
    }
  } else emite(c0);
  return out;
}

function juntar(lista) {
  lista.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of lista) {
    const u = out[out.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Horários ocupados entre "de" e "ate" (ms)
function ocupados(txt, de, ate) {
  const evs = eventos(txt);
  // ocorrências que foram movidas/alteradas: a original sai, a nova entra como evento próprio
  const movidas = new Map();
  for (const e of evs) {
    const rid = e.get("RECURRENCE-ID"), uid = (e.get("UID") || {}).valor;
    if (!rid || !uid) continue;
    const c = lerData(rid.valor, rid.params);
    if (c) { if (!movidas.has(uid)) movidas.set(uid, new Set()); movidas.get(uid).add(paraMs(c)); }
  }
  const lista = [];
  for (const e of evs) {
    if (/CANCELLED/i.test((e.get("STATUS") || {}).valor || "")) continue;
    if (/TRANSPARENT/i.test((e.get("TRANSP") || {}).valor || "")) continue;
    const ds = e.get("DTSTART");
    const c0 = ds && lerData(ds.valor, ds.params);
    if (!c0) continue;
    let dur = null;
    const dt = e.get("DTEND"), du = e.get("DURATION");
    if (dt) { const c1 = lerData(dt.valor, dt.params); if (c1) dur = paraMs(Object.assign({}, c1, c1.tz || c1.utc ? {} : { tz: c0.tz })) - paraMs(c0); }
    else if (du) dur = duracaoMs(du.valor);
    if (dur == null) dur = c0.diaInteiro ? DIA : 0;
    if (!(dur > 0)) continue;
    const exc = new Set();
    e.todos("EXDATE").forEach(p => String(p.valor).split(",").forEach(v => {
      const c = lerData(v, p.params);
      if (c) exc.add(paraMs(Object.assign({}, c, c.tz || c.utc ? {} : { tz: c0.tz })));
    }));
    const uid = (e.get("UID") || {}).valor;
    const mov = !e.get("RECURRENCE-ID") && uid ? movidas.get(uid) : null;
    const rr = e.get("RRULE");
    const inicios = rr ? expandir(c0, lerRrule(rr.valor), ate, 5000) : [c0];
    for (const c of inicios) {
      const a = paraMs(c);
      if (exc.has(a) || (mov && mov.has(a))) continue;
      const b = a + dur;
      if (b <= de || a >= ate) continue;
      lista.push([a, b]);
    }
  }
  return juntar(lista);
}

// Link do calendário: webcal:// vira https://; só endereços de calendário conhecidos (iCloud, Google, Outlook),
// para o servidor não sair buscando qualquer endereço que alguém colar.
const HOSTS_OK = /(^|\.)(icloud\.com|google\.com|outlook\.office365\.com|outlook\.live\.com|office365\.com)$/i;
function normalizarUrl(u) {
  let s = String(u || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = "https://" + s.replace(/^webcals?:\/\//i, "");
  let x;
  try { x = new URL(s); } catch (e) { return null; }
  if (x.protocol !== "https:" || !HOSTS_OK.test(x.hostname) || x.username || x.password) return null;
  return x.toString();
}

module.exports = { ocupados, normalizarUrl, lerData, paraMs, duracaoMs, expandir, lerRrule, TZ_PADRAO };
