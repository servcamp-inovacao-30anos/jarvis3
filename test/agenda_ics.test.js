// Leitor do calendário público do iCloud (api/_agenda_ics.js): só os horários ocupados, com repetições,
// exceções e fusos. Todos os calendários aqui são inventados (nada de compromisso real).

const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../api/_agenda_ics");

const cal = (...eventos) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Teste//PT", ...eventos.map(e => "BEGIN:VEVENT\r\n" + e.join("\r\n") + "\r\nEND:VEVENT"), "END:VCALENDAR", ""].join("\r\n");
const utc = (s) => Date.parse(s);
const DE = utc("2026-11-01T00:00:00Z"), ATE = utc("2026-12-31T00:00:00Z");
const BRT = (dia, hora) => Date.parse(`${dia}T${hora}:00-03:00`);

test("evento simples em UTC e com fuso de Brasília", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART:20261106T130000Z", "DTEND:20261106T140000Z", "SUMMARY:Segredo do diretor"],
    ["UID:b", "DTSTART;TZID=America/Sao_Paulo:20261109T150000", "DTEND;TZID=America/Sao_Paulo:20261109T153000"]
  ), DE, ATE);
  assert.deepEqual(r, [[utc("2026-11-06T13:00:00Z"), utc("2026-11-06T14:00:00Z")], [BRT("2026-11-09", "15:00"), BRT("2026-11-09", "15:30")]]);
  assert.ok(!JSON.stringify(r).includes("Segredo"), "o título nunca sai");
});

test("hora sem fuso vale Brasília; outro fuso é convertido; DURATION no lugar de DTEND", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART:20261110T090000", "DURATION:PT1H30M"],
    ["UID:b", "DTSTART;TZID=America/New_York:20261112T100000", "DTEND;TZID=America/New_York:20261112T110000"]
  ), DE, ATE);
  assert.deepEqual(r[0], [BRT("2026-11-10", "09:00"), BRT("2026-11-10", "10:30")]);
  assert.deepEqual(r[1], [utc("2026-11-12T15:00:00Z"), utc("2026-11-12T16:00:00Z")], "10h em Nova York em novembro = 15h UTC (EST)");
});

test("cancelado e 'livre' (TRANSPARENT) não ocupam; dia inteiro ocupa o dia todo", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART:20261106T130000Z", "DTEND:20261106T140000Z", "STATUS:CANCELLED"],
    ["UID:b", "DTSTART:20261107T130000Z", "DTEND:20261107T140000Z", "TRANSP:TRANSPARENT"],
    ["UID:c", "DTSTART;VALUE=DATE:20261110", "DTEND;VALUE=DATE:20261111"]
  ), DE, ATE);
  assert.deepEqual(r, [[BRT("2026-11-10", "00:00"), BRT("2026-11-11", "00:00")]]);
});

test("repetição semanal (seg e qua) com COUNT, e diária com UNTIL", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART;TZID=America/Sao_Paulo:20261102T100000", "DTEND;TZID=America/Sao_Paulo:20261102T110000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"],
    ["UID:b", "DTSTART;TZID=America/Sao_Paulo:20261120T160000", "DTEND;TZID=America/Sao_Paulo:20261120T163000", "RRULE:FREQ=DAILY;UNTIL=20261122T235959Z"]
  ), DE, ATE);
  const dias = r.map(([a]) => new Date(a - 3 * 3600000).toISOString().slice(0, 10));
  assert.deepEqual(dias.slice(0, 4), ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"], "4 ocorrências e pára");
  assert.deepEqual(dias.slice(4), ["2026-11-20", "2026-11-21", "2026-11-22"], "diária até o UNTIL");
});

test("repetição mensal: 2ª terça do mês e última sexta; e a cada 2 semanas", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART;TZID=America/Sao_Paulo:20261110T140000", "DTEND;TZID=America/Sao_Paulo:20261110T150000", "RRULE:FREQ=MONTHLY;BYDAY=2TU"],
    ["UID:b", "DTSTART;TZID=America/Sao_Paulo:20261127T170000", "DTEND;TZID=America/Sao_Paulo:20261127T180000", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"],
    ["UID:c", "DTSTART;TZID=America/Sao_Paulo:20261103T080000", "DTEND;TZID=America/Sao_Paulo:20261103T083000", "RRULE:FREQ=WEEKLY;INTERVAL=2"]
  ), DE, ATE);
  const f = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 16).replace("T", " ");
  const lista = r.map(([a]) => f(a));
  assert.ok(lista.includes("2026-11-10 14:00") && lista.includes("2026-12-08 14:00"), "2ª terça de nov e de dez");
  assert.ok(lista.includes("2026-11-27 17:00") && lista.includes("2026-12-25 17:00"), "última sexta de nov e de dez");
  assert.ok(lista.includes("2026-11-03 08:00") && lista.includes("2026-11-17 08:00") && !lista.includes("2026-11-10 08:00"), "a cada 2 semanas");
});

test("exceções: EXDATE apaga uma ocorrência; RECURRENCE-ID move outra", () => {
  const r = I.ocupados(cal(
    ["UID:serie", "DTSTART;TZID=America/Sao_Paulo:20261102T100000", "DTEND;TZID=America/Sao_Paulo:20261102T110000", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE;TZID=America/Sao_Paulo:20261109T100000"],
    ["UID:serie", "RECURRENCE-ID;TZID=America/Sao_Paulo:20261116T100000", "DTSTART;TZID=America/Sao_Paulo:20261117T150000", "DTEND;TZID=America/Sao_Paulo:20261117T160000"]
  ), DE, ATE);
  const f = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 16).replace("T", " ");
  assert.deepEqual(r.map(([a]) => f(a)), ["2026-11-02 10:00", "2026-11-17 15:00", "2026-11-23 10:00"], "dia 9 apagado, dia 16 foi para o 17 às 15h");
});

test("eventos que se encostam ou sobrepõem viram um só; fora da janela não entra", () => {
  const r = I.ocupados(cal(
    ["UID:a", "DTSTART:20261106T130000Z", "DTEND:20261106T140000Z"],
    ["UID:b", "DTSTART:20261106T140000Z", "DTEND:20261106T150000Z"],
    ["UID:c", "DTSTART:20261106T143000Z", "DTEND:20261106T160000Z"],
    ["UID:d", "DTSTART:20250106T130000Z", "DTEND:20250106T140000Z"]
  ), DE, ATE);
  assert.deepEqual(r, [[utc("2026-11-06T13:00:00Z"), utc("2026-11-06T16:00:00Z")]]);
});

test("texto dobrado, alarmes dentro do evento e linhas estranhas não atrapalham; lixo não quebra", () => {
  const txt = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Reuni\r\n ao longa\r\nDTSTART:20261106T130000Z\r\nDTEND:20261106T140000Z\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nDTSTART:19990101T000000Z\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  assert.deepEqual(I.ocupados(txt, DE, ATE), [[utc("2026-11-06T13:00:00Z"), utc("2026-11-06T14:00:00Z")]]);
  for (const lixo of ["", null, undefined, "nada a ver", "BEGIN:VEVENT\r\nDTSTART:xx\r\nEND:VEVENT"]) assert.deepEqual(I.ocupados(lixo, DE, ATE), []);
});

test("regra de repetição sem fim não trava (limite de ocorrências)", () => {
  const ini = Date.now();
  const r = I.ocupados(cal(["UID:a", "DTSTART:20200101T100000Z", "DTEND:20200101T103000Z", "RRULE:FREQ=DAILY"]), utc("2026-11-01T00:00:00Z"), utc("2027-01-01T00:00:00Z"));
  assert.ok(r.length > 30 && r.length <= 62);
  assert.ok(Date.now() - ini < 2000, "rápido");
});

test("link do calendário: webcal vira https e só endereços de calendário conhecidos", () => {
  assert.equal(I.normalizarUrl("webcal://p12-caldav.icloud.com/published/2/ABC"), "https://p12-caldav.icloud.com/published/2/ABC");
  assert.equal(I.normalizarUrl("https://calendar.google.com/calendar/ical/x/basic.ics"), "https://calendar.google.com/calendar/ical/x/basic.ics");
  for (const ruim of ["http://p12-caldav.icloud.com/x", "https://exemplo.com/cal.ics", "https://icloud.com.evil.com/x", "https://user:senha@icloud.com/x", "file:///etc/passwd", "https://169.254.169.254/", "", null]) {
    assert.equal(I.normalizarUrl(ruim), null, String(ruim));
  }
});
