// api/_agenda_regras.js — regras da Agenda Comercial (sem banco, só contas e validação).
//
// • Tudo no horário de Brasília (UTC-3, sem horário de verão desde 2019). No banco fica em UTC.
// • Horário livre: dentro do horário de atendimento do dia da semana, depois da antecedência mínima, até a
//   janela de dias, fora dos bloqueios e sem encostar em outra reunião. Cada reunião "ocupa" do início até
//   o fim + o intervalo; duas reuniões nunca podem ter essas faixas se cruzando (o banco garante isso com
//   uma restrição de exclusão — estas contas só mostram o que está livre).
// • O convite do iPhone (assinatura) é um calendário .ics simples, só de leitura.

"use strict";

const OFFSET = "-03:00";
const MIN = 60000;
const DIAS_SEMANA = ["0", "1", "2", "3", "4", "5", "6"]; // 0 = domingo

const CONFIG_PADRAO = {
  semana: { "1": [["09:00", "17:00"]], "2": [["09:00", "17:00"]], "3": [["09:00", "17:00"]], "4": [["09:00", "17:00"]], "5": [["09:00", "17:00"]] },
  intervalo_min: 15, antecedencia_h: 4, janela_dias: 30, passo_min: 30
};
const TIPOS_PADRAO = [
  { nome: "Reunião com cliente", duracao_min: 60, cor: "#1e4d8c", ordem: 1 },
  { nome: "Captação", duracao_min: 30, cor: "#ea580c", ordem: 2 }
];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const minutos = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// "2026-11-06" + "14:30" (Brasília) → milissegundos UTC
function paraUtc(dia, hora) { return Date.parse(dia + "T" + hora + ":00" + OFFSET); }
// milissegundos UTC → { dia, hora } em Brasília
function deUtc(ms) {
  const d = new Date(ms - 3 * 3600000).toISOString();
  return { dia: d.slice(0, 10), hora: d.slice(11, 16) };
}
function somaDias(dia, n) { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const diaSemana = dia => String(new Date(dia + "T12:00:00Z").getUTCDay());
const hojeBR = agora => deUtc(agora == null ? Date.now() : agora).dia;
const intN = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const txt = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const cruza = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// ── validação ──────────────────────────────────────────────────────────────

function validarConfig(b) {
  if (!b || typeof b !== "object") return { erro: "Configuração inválida." };
  const semana = {};
  const s = b.semana && typeof b.semana === "object" ? b.semana : {};
  for (const d of DIAS_SEMANA) {
    const faixas = Array.isArray(s[d]) ? s[d] : [];
    if (faixas.length > 4) return { erro: "No máximo 4 faixas de horário por dia." };
    const limpas = [];
    for (const f of faixas) {
      if (!Array.isArray(f) || !HORA.test(f[0]) || !HORA.test(f[1])) return { erro: "Horário inválido: use HH:MM." };
      if (minutos(f[0]) >= minutos(f[1])) return { erro: "O fim do horário precisa ser depois do início (" + f[0] + "–" + f[1] + ")." };
      limpas.push([f[0], f[1]]);
    }
    limpas.sort((x, y) => minutos(x[0]) - minutos(y[0]));
    for (let i = 1; i < limpas.length; i++) if (minutos(limpas[i][0]) < minutos(limpas[i - 1][1])) return { erro: "Faixas de horário do mesmo dia não podem se cruzar." };
    if (limpas.length) semana[d] = limpas;
  }
  const intervalo_min = intN(b.intervalo_min, 0, 120), antecedencia_h = intN(b.antecedencia_h, 0, 168);
  const janela_dias = intN(b.janela_dias, 1, 120), passo_min = intN(b.passo_min, 5, 240);
  if (intervalo_min == null) return { erro: "Intervalo entre reuniões: de 0 a 120 minutos." };
  if (antecedencia_h == null) return { erro: "Antecedência mínima: de 0 a 168 horas." };
  if (janela_dias == null) return { erro: "Agenda aberta: de 1 a 120 dias." };
  if (passo_min == null) return { erro: "Horários a cada: de 5 a 240 minutos." };
  // online/presencial de cada dia da semana (padrão; um dia específico pode mudar em modalidade_dias)
  const ms = b.modalidade_semana && typeof b.modalidade_semana === "object" ? b.modalidade_semana : {};
  const modalidade_semana = {};
  for (const d of DIAS_SEMANA) if (MOD_DIA.includes(ms[d]) && ms[d] !== "ambos") modalidade_semana[d] = ms[d];
  // e-mail que recebe o aviso de reunião nova, remarcada ou cancelada (vazio = a caixa do Comercial, MAIL_USER)
  const aviso = txt(b.email_aviso, 120).toLowerCase();
  if (aviso && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(aviso)) return { erro: "E-mail dos avisos inválido." };
  return { config: { semana, intervalo_min, antecedencia_h, janela_dias, passo_min, email_aviso: aviso || null, modalidade_semana } };
}

// ── online ou presencial ───────────────────────────────────────────────────
// Cada dia atende "ambos", só "online" ou só "presencial". Vale o que a Comercial marcou para aquele dia
// (modalidade_dias), senão o padrão do dia da semana (modalidade_semana), senão os dois.
const MODALIDADES = { online: "Online", presencial: "Presencial" };
const MOD_DIA = ["ambos", "online", "presencial"];
function modalidadeDoDia(cfg, dia) {
  const d = ((cfg && cfg.modalidade_dias) || {})[dia];
  if (MOD_DIA.includes(d)) return d;
  const s = ((cfg && cfg.modalidade_semana) || {})[diaSemana(dia)];
  return MOD_DIA.includes(s) ? s : "ambos";
}
const aceita = (doDia, m) => doDia === "ambos" ? !!MODALIDADES[m] : m === doDia;
// { dia, modalidade } — modalidade null/"" = volta ao padrão da semana
function validarModalidadeDia(b) {
  const dia = String((b && b.dia) || "");
  if (!DIA.test(dia)) return { erro: "Dia inválido." };
  const m = b.modalidade == null || b.modalidade === "" || b.modalidade === "padrao" ? null : String(b.modalidade);
  if (m && !MOD_DIA.includes(m)) return { erro: "Escolha online, presencial ou os dois." };
  return { dia, modalidade: m };
}
// Onde fica a reunião: online usa o link/instruções do tipo; presencial, o endereço.
const localDe = (tipo, m) => m === "online" ? ((tipo && tipo.local_online) || null) : ((tipo && tipo.local) || null);

function validarTipo(b) {
  const nome = txt(b && b.nome, 60);
  if (nome.length < 2) return { erro: "Dê um nome ao tipo de reunião." };
  const duracao_min = intN(b.duracao_min, 10, 480);
  if (duracao_min == null) return { erro: "Duração: de 10 a 480 minutos." };
  const cor = /^#[0-9a-f]{6}$/i.test(String(b.cor || "")) ? b.cor : "#1e4d8c";
  // diretores que precisam estar livres para este tipo de reunião (ids de ag_diretores)
  const diretores = [...new Set((Array.isArray(b.diretores) ? b.diretores : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 20);
  return { tipo: { nome, duracao_min, local: txt(b.local, 300) || null, local_online: txt(b.local_online, 300) || null, cor, ativo: b.ativo !== false, diretores } };
}

// Dados de quem marca. Pelo link o telefone é obrigatório (é como a Comercial confirma); e-mail opcional.
// Na reunião que a Comercial cadastra à mão o telefone pode ficar em branco (telefoneOpcional).
function validarPessoa(b, opcoes) {
  const nome = txt(b && b.nome, 80);
  if (nome.length < 2) return { erro: "Informe o nome." };
  const tel = String((b && b.telefone) || "").replace(/\D/g, "");
  const semTel = !tel && opcoes && opcoes.telefoneOpcional;
  if (!semTel && (tel.length < 10 || tel.length > 13)) return { erro: "Informe um telefone com DDD." };
  const email = txt(b && b.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erro: "E-mail inválido." };
  return { pessoa: { nome, telefone: tel || null, email: email || null, obs: txt(b && b.obs, 500) || null } };
}

// A "cara" da página do cliente e dos e-mails: quem atende (nome, cargo, foto) e a mensagem de boas-vindas.
// A foto chega já reduzida pela tela (quadrada, JPEG); aqui só se confere que é imagem e não é grande.
// foto: undefined = mantém a atual · "" ou null = tira · "data:image/...;base64,..." = troca.
const FOTO_MAX = 200000;
function validarMarca(b) {
  if (!b || typeof b !== "object") return { erro: "Dados inválidos." };
  const marca = { anfitriao_nome: txt(b.nome, 60) || null, anfitriao_cargo: txt(b.cargo, 60) || null, boas_vindas: txt(b.boas_vindas, 300) || null };
  if (b.foto !== undefined) {
    const f = b.foto == null ? "" : String(b.foto);
    if (f && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f)) return { erro: "A foto precisa ser uma imagem JPG, PNG ou WebP." };
    if (f.length > FOTO_MAX) return { erro: "Foto grande demais. Escolha outra." };
    marca.anfitriao_foto = f || null;
  }
  return { marca };
}

// Resultado de uma reunião que já começou: aconteceu ou a pessoa não veio, e o próximo passo.
const RESULTADOS = { realizada: "Realizada", faltou: "Não compareceu" };
const PROXIMOS = { proposta: "Enviar proposta", visita: "Agendar visita", nova_reuniao: "Nova reunião", fechou: "Fechou negócio", sem_interesse: "Sem interesse", remarcar: "Remarcar", outro: "Outro" };
function validarResultado(b) {
  if (!b || typeof b !== "object") return { erro: "Dados inválidos." };
  if (b.resultado == null || b.resultado === "") return { resultado: { resultado: null, proximo_passo: null, resultado_obs: null } }; // desfaz
  if (!RESULTADOS[b.resultado]) return { erro: "Escolha se a reunião aconteceu ou se a pessoa não veio." };
  const proximo = b.proximo == null || b.proximo === "" ? null : String(b.proximo);
  if (proximo && !PROXIMOS[proximo]) return { erro: "Próximo passo inválido." };
  return { resultado: { resultado: b.resultado, proximo_passo: proximo, resultado_obs: txt(b.anotacao, 1000) || null } };
}

// ── números (Painel Comercial) ─────────────────────────────────────────────
// reunioes: [{ inicio, tipo_nome, origem, status, cancelado_por, resultado, proximo_passo }] · mes: "2026-11"
const mesDe = ms => deUtc(+new Date(ms)).dia.slice(0, 7);
function mesAntes(mes, n) { const [a, m] = mes.split("-").map(Number), d = new Date(Date.UTC(a, m - 1 - n, 15)); return d.toISOString().slice(0, 7); }
function numerosDoMes(rs, mes, agora) {
  const doMes = rs.filter(r => mesDe(r.inicio) === mes);
  const valem = doMes.filter(r => r.status === "ativa");
  const canceladas = doMes.filter(r => r.status !== "ativa");
  const realizadas = valem.filter(r => r.resultado === "realizada").length, faltas = valem.filter(r => r.resultado === "faltou").length;
  return {
    marcadas: valem.length, realizadas, faltas,
    pendentes: valem.filter(r => !r.resultado && +new Date(r.inicio) <= agora).length,
    futuras: valem.filter(r => +new Date(r.inicio) > agora).length,
    canceladas: canceladas.length, canceladas_cliente: canceladas.filter(r => r.cancelado_por === "cliente").length,
    pelo_link: valem.filter(r => r.origem === "link").length,
    comparecimento: realizadas + faltas ? Math.round(realizadas / (realizadas + faltas) * 100) : null,
    viraram_proposta: valem.filter(r => r.resultado === "realizada" && (r.proximo_passo === "proposta" || r.proximo_passo === "fechou")).length,
    fecharam: valem.filter(r => r.resultado === "realizada" && r.proximo_passo === "fechou").length
  };
}
function numeros(rs, mes, agora) {
  const lista = Array.isArray(rs) ? rs : [];
  const atual = numerosDoMes(lista, mes, agora), anterior = numerosDoMes(lista, mesAntes(mes, 1), agora);
  const contar = (arr, fn) => { const m = {}; arr.forEach(r => { const k = fn(r); m[k] = (m[k] || 0) + 1; }); return m; };
  const doMes = lista.filter(r => mesDe(r.inicio) === mes && r.status === "ativa");
  const porTipo = Object.entries(contar(doMes, r => r.tipo_nome || "Reunião")).sort((a, b) => b[1] - a[1]);
  const porModalidade = Object.entries(contar(doMes.filter(r => MODALIDADES[r.modalidade]), r => MODALIDADES[r.modalidade])).sort((a, b) => b[1] - a[1]);
  const porResultado =Object.entries(contar(doMes.filter(r => r.resultado === "realizada"), r => PROXIMOS[r.proximo_passo] || "Sem próximo passo")).sort((a, b) => b[1] - a[1]);
  // procura: tudo o que foi marcado (inclusive o que depois foi cancelado) nos últimos 6 meses até o mês escolhido
  const seis = new Set([0, 1, 2, 3, 4, 5].map(i => mesAntes(mes, i)));
  const procura = lista.filter(r => seis.has(mesDe(r.inicio)));
  const horas = contar(procura, r => deUtc(+new Date(r.inicio)).hora.slice(0, 2) + "h");
  const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dias = contar(procura, r => SEMANA[new Date(deUtc(+new Date(r.inicio)).dia + "T12:00:00Z").getUTCDay()]);
  return {
    mes, atual, anterior,
    por_tipo: porTipo, por_modalidade: porModalidade, proximos_passos: porResultado,
    por_hora: Object.entries(horas).sort((a, b) => a[0] < b[0] ? -1 : 1),
    por_dia: SEMANA.filter(d => dias[d]).map(d => [d, dias[d]]),
    serie: [5, 4, 3, 2, 1, 0].map(i => { const m = mesAntes(mes, i), n = numerosDoMes(lista, m, agora); return { mes: m, marcadas: n.marcadas, realizadas: n.realizadas, faltas: n.faltas }; })
  };
}

// Faixa que a reunião ocupa (com o intervalo depois dela).
function faixa(dia, hora, duracao_min, intervalo_min) {
  const inicio = paraUtc(dia, hora), fim = inicio + duracao_min * MIN;
  return { inicio, fim, ocupa_ate: fim + intervalo_min * MIN };
}

// ── horários livres ────────────────────────────────────────────────────────

// ocupados: [{inicio, ocupa_ate}] (reuniões ativas) · bloqueios: [{inicio, fim}] (ISO ou ms)
function horariosDoDia(cfg, tipo, dia, ocupados, bloqueios, agora) {
  const faixas = (cfg.semana || {})[diaSemana(dia)] || [];
  if (!faixas.length) return [];
  const hoje = hojeBR(agora), ate = somaDias(hoje, cfg.janela_dias);
  if (dia < hoje || dia > ate) return [];
  const minInicio = (agora == null ? Date.now() : agora) + cfg.antecedencia_h * 3600000;
  const oc = (ocupados || []).map(o => [+new Date(o.inicio), +new Date(o.ocupa_ate)]);
  const bl = (bloqueios || []).map(o => [+new Date(o.inicio), +new Date(o.fim)]);
  const out = [];
  for (const [ini, fimF] of faixas) {
    for (let m = minutos(ini); m + tipo.duracao_min <= minutos(fimF); m += cfg.passo_min) {
      const f = faixa(dia, hhmm(m), tipo.duracao_min, cfg.intervalo_min);
      if (f.inicio < minInicio) continue;
      if (oc.some(([a, b]) => cruza(f.inicio, f.ocupa_ate, a, b))) continue;
      if (bl.some(([a, b]) => cruza(f.inicio, f.fim, a, b))) continue;
      out.push(hhmm(m));
    }
  }
  return out;
}

// { "2026-11-06": ["09:00", ...], ... } só com os dias que têm algum horário
function horariosLivres(cfg, tipo, ocupados, bloqueios, agora) {
  const hoje = hojeBR(agora), dias = {};
  for (let i = 0; i <= cfg.janela_dias; i++) {
    const d = somaDias(hoje, i), h = horariosDoDia(cfg, tipo, d, ocupados, bloqueios, agora);
    if (h.length) dias[d] = h;
  }
  return dias;
}

// ── convite / assinatura (.ics) ────────────────────────────────────────────

const icsTxt = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsData = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// linhas de no máximo 75 caracteres, continuação começando com espaço (RFC 5545)
function dobrar(linha) {
  const out = [];
  let s = linha;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
}
// eventos: [{ id, inicio, fim, titulo, descricao, local }]
function ics(eventos, opcoes) {
  const o = opcoes || {}, agora = icsData(o.agora == null ? Date.now() : o.agora);
  const l = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Grupo ServCamp//Agenda Comercial//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (o.nome) l.push("X-WR-CALNAME:" + icsTxt(o.nome));
  l.push("X-WR-TIMEZONE:America/Sao_Paulo", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M");
  for (const e of eventos || []) {
    l.push("BEGIN:VEVENT", "UID:" + icsTxt(e.id) + "@agenda.servcamp", "DTSTAMP:" + agora,
      "DTSTART:" + icsData(+new Date(e.inicio)), "DTEND:" + icsData(+new Date(e.fim)), "SUMMARY:" + icsTxt(e.titulo));
    if (e.descricao) l.push("DESCRIPTION:" + icsTxt(e.descricao));
    if (e.local) l.push("LOCATION:" + icsTxt(e.local));
    if (e.cancelada) l.push("STATUS:CANCELLED");
    l.push("END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.map(dobrar).join("\r\n") + "\r\n";
}

module.exports = {
  OFFSET, CONFIG_PADRAO, TIPOS_PADRAO, HORA, DIA,
  paraUtc, deUtc, somaDias, diaSemana, hojeBR, faixa,
  validarConfig, validarTipo, validarPessoa, horariosDoDia, horariosLivres, ics, icsTxt,
  validarMarca, validarResultado, numeros, mesAntes, RESULTADOS, PROXIMOS, FOTO_MAX,
  MODALIDADES, MOD_DIA, modalidadeDoDia, aceita, validarModalidadeDia, localDe
};
