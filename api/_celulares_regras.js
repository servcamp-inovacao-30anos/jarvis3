// api/_celulares_regras.js — regras da guia Celulares, sem banco e sem tela (test/celulares.test.js).
// Arquivo com prefixo "_" → não vira rota na Vercel; é só importado (api/_celulares.js).
//
// • lerPlanilha: acha as colunas da planilha CELULARES pelo nome (em qualquer ordem, com ou sem
//   acento, hífen ou dois-pontos) e devolve um aparelho por linha.
// • pendencias: o que FALTA (campo vazio) e o que é para CONFERIR (número sem DDD, IMEI ou e-mail
//   que não fecham, dado repetido em outro aparelho, nome dizendo "desligado"/"sumiu").
// • "X" num campo quer dizer "não se aplica" (o aparelho da cozinha não tem Zello, por exemplo):
//   não conta como falta.

"use strict";

// Colunas da tabela cel_aparelhos que a tela pode gravar.
const CAMPOS = ["modelo", "cliente", "cliente_vinculado", "tipo", "situacao", "imei1", "imei2", "numero", "email",
  "senha_gmail", "login_zello", "senha_zello", "applock", "obs"];
// Nunca saem na lista: só uma a uma (api/_celulares.js ?t=senhas) ou no Excel de backup.
const SEGREDOS = ["senha_gmail", "senha_zello", "applock"];
const TIPOS = ["POSTO", "INTERNO"];
const SITUACOES = ["ATIVO", "RESERVA", "BAIXADO"];
const ROTULO = {
  modelo: "Modelo", cliente: "Cliente", imei1: "IMEI 1", imei2: "IMEI 2", numero: "Número", email: "E-mail",
  senha_gmail: "Senha do Gmail", login_zello: "Login Zello", senha_zello: "Senha Zello", applock: "Bloqueio AppLock"
};
const FALTA = {
  cliente: "Sem cliente", modelo: "Sem modelo", numero: "Sem número", imei1: "Sem IMEI 1", imei2: "Sem IMEI 2",
  email: "Sem e-mail", senha_gmail: "Sem senha do Gmail", login_zello: "Sem login Zello", senha_zello: "Sem senha Zello",
  applock: "Sem código do AppLock"
};
// O que um aparelho ATIVO precisa ter, na ordem em que aparece na tela. O de RESERVA (guardado
// na base) só precisa ser identificável; o BAIXADO não cobra nada.
const OBRIGATORIOS = {
  ATIVO: ["cliente", "modelo", "numero", "imei1", "imei2", "email", "senha_gmail", "login_zello", "senha_zello", "applock"],
  RESERVA: ["modelo", "imei1"],
  BAIXADO: []
};

// Cabeçalho da planilha, já sem acento e sem nada que não seja letra ou número → campo.
const CABECALHOS = {
  MODELO: "modelo", MODELODOAPARELHO: "modelo",
  CLIENTE: "cliente", CLIENTES: "cliente", POSTO: "cliente",
  IMEI: "imei1", IMEI1: "imei1", IMEI2: "imei2",
  NUMERO: "numero", NUMERODOCELULAR: "numero", NUMEROCELULAR: "numero", CELULAR: "numero", TELEFONE: "numero", LINHA: "numero",
  EMAIL: "email", GMAIL: "email", CONTAGOOGLE: "email",
  SENHAGMAIL: "senha_gmail", SENHADOGMAIL: "senha_gmail", SENHAEMAIL: "senha_gmail", SENHADOEMAIL: "senha_gmail",
  LOGINZELLO: "login_zello", LOGINDOZELLO: "login_zello", USUARIOZELLO: "login_zello", ZELLO: "login_zello",
  SENHAZELLO: "senha_zello", SENHADOZELLO: "senha_zello",
  BLOQUEIOAPPLOCK: "applock", APPLOCK: "applock", SENHAAPPLOCK: "applock", BLOQUEIO: "applock", SENHADEBLOQUEIO: "applock",
  TIPO: "tipo", SITUACAO: "situacao", STATUS: "situacao",
  CLIENTENOSISTEMA: "cliente_vinculado", VINCULO: "cliente_vinculado",
  OBS: "obs", OBSERVACAO: "obs", OBSERVACOES: "obs"
};
// Cabeçalho do Excel de backup: as 10 primeiras são as da planilha CELULARES, para quem abrir
// reconhecer — e para o mesmo arquivo poder voltar pela importação.
const COLUNAS_EXCEL = [
  ["modelo", "MODELO"], ["cliente", "CLIENTES"], ["imei1", "IMEI 1"], ["imei2", "IMEI 2"], ["numero", "NUMERO"],
  ["email", "E-MAIL"], ["senha_gmail", "SENHA GMAIL"], ["login_zello", "LOGIN - ZELLO"], ["senha_zello", "SENHA ZELLO"],
  ["applock", "Bloqueio: AppLock"], ["tipo", "TIPO"], ["situacao", "SITUAÇÃO"], ["cliente_vinculado", "CLIENTE NO SISTEMA"], ["obs", "OBS"]
];
const MAX_LINHAS_PLANILHA = 3000;

const semAcento = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const chaveCabecalho = s => semAcento(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const digitos = s => String(s == null ? "" : s).replace(/\D/g, "");
const vazio = v => v == null || String(v).trim() === "";
// "X", "xxxxxx", "-", "N/A", "não tem", "sem": o campo não se aplica a este aparelho.
const naoSeAplica = v => /^(x+|-+|—+|n\/?a|na|nao se aplica|nao tem|sem)$/i.test(semAcento(String(v == null ? "" : v)).replace(/\s+/g, " ").trim());

// Texto que vai para o banco: sem espaço sobrando e com tamanho limitado. Senha só perde as
// pontas — espaço no meio dela pode ser de verdade.
function limpar(campo, v) {
  if (v == null) return "";
  const s = String(v);
  if (SEGREDOS.indexOf(campo) >= 0) return s.trim().slice(0, 200);
  return s.replace(/\s+/g, " ").trim().slice(0, campo === "obs" ? 1000 : 200);
}

// Número de telefone: 10 ou 11 dígitos com o DDD. Aceita +55 e o zero da operadora na frente.
function analisarNumero(v) {
  let d = digitos(v);
  if (d.length >= 12 && d.indexOf("55") === 0) d = d.slice(2);
  d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return { ok: true, ddd: d.slice(0, 2), local: d.slice(2), digitos: d };
  if (d.length === 8 || d.length === 9) return { ok: false, semDDD: true, local: d };
  return { ok: false, invalido: true };
}
function formatarLocal(d) {
  return d.length === 9 ? d.slice(0, 5) + "-" + d.slice(5) : d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4) : d;
}
// "(19) 98258-6713"; o que não fecha volta como veio.
function formatarNumero(v) {
  const a = analisarNumero(v);
  if (a.ok) return "(" + a.ddd + ") " + formatarLocal(a.local);
  if (a.semDDD) return formatarLocal(a.local);
  return String(v == null ? "" : v).trim();
}

// IMEI: 15 dígitos com o último conferindo pelo Luhn. O "/26" do fim é a versão do software
// (IMEISV) e não entra; 14 dígitos (sem o verificador) e 16 (IMEISV inteiro) também valem.
function luhn(d) {
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    soma += n;
  }
  return soma % 10 === 0;
}
function analisarImei(v) {
  const d = digitos(String(v == null ? "" : v).split("/")[0]);
  if (d.length === 15) return luhn(d) ? { ok: true, chave: d.slice(0, 14) } : { ok: false, digito: true, chave: d.slice(0, 14) };
  if (d.length === 14 || d.length === 16) return { ok: true, chave: d.slice(0, 14) };
  return { ok: false, invalido: true, chave: d.length >= 8 ? d : "" };
}
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Aparelho de uso interno (supervisor, mesa, RH, financeiro…): não é de posto, não procura
// cliente no sistema e não aparece na guia Clientes. Só um palpite da importação; a tela muda.
const INTERNO = /^(SUP\b|SUPERVIS)|MESA OPERACIONAL|FINANCEIRO|RECRUTAMENTO|^RH\b|\bDIRETOR|\bGERENTE\b|UNIFORME|\(BASE\)|COZINHA/;
function tipoSugerido(cliente) { return INTERNO.test(semAcento(cliente).toUpperCase().trim()) ? "INTERNO" : "POSTO"; }
// Nome que já conta o fim da história do aparelho.
const NOME_DE_BAIXA = /\b(DESLIGAD[OA]S?|SUMIU|PERDID[OA]|ROUBAD[OA]|FURTAD[OA]|QUEBRAD[OA]|DEVOLVID[OA])\b/;

function normTipo(v) {
  const s = semAcento(v).toUpperCase().trim();
  if (!s) return "";
  return /INTERN/.test(s) ? "INTERNO" : "POSTO";
}
function normSituacao(v) {
  const s = semAcento(v).toUpperCase().trim();
  if (!s) return "";
  if (/^(ATIV|EM USO|USO)/.test(s)) return "ATIVO";
  if (/^(RESERV|ESTOQUE|BACKUP)/.test(s)) return "RESERVA";
  if (/^(BAIXAD|DESATIVAD|DESLIGAD|PERDID|ROUBAD|FURTAD|QUEBRAD|INATIV)/.test(s)) return "BAIXADO";
  return "";
}

// Linha da planilha (já lida pelo navegador: lista de listas de texto) → aparelhos.
function lerPlanilha(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) return { erro: "A planilha está vazia." };
  let iCab = -1, mapa = null;
  for (let i = 0; i < Math.min(linhas.length, 15) && iCab < 0; i++) {
    const m = {}, linha = Array.isArray(linhas[i]) ? linhas[i] : [];
    linha.forEach((c, j) => { const campo = CABECALHOS[chaveCabecalho(c)]; if (campo && !(campo in m)) m[campo] = j; });
    if (Object.keys(m).length >= 3) { iCab = i; mapa = m; }
  }
  if (iCab < 0) return { erro: "Não achei o cabeçalho (MODELO, CLIENTES, NUMERO…) nas primeiras linhas da planilha." };
  const cab = linhas[iCab];
  const usadas = new Set(Object.values(mapa));
  const naoReconhecidas = cab.map((c, j) => (!usadas.has(j) && !vazio(c)) ? String(c).trim() : "").filter(Boolean);
  const corpo = linhas.slice(iCab + 1);
  if (corpo.length > MAX_LINHAS_PLANILHA) return { erro: "A planilha passa de " + MAX_LINHAS_PLANILHA + " linhas." };
  const aparelhos = [];
  let vazias = 0;
  for (const linha of corpo) {
    const a = {};
    for (const campo of Object.keys(mapa)) a[campo] = limpar(campo, Array.isArray(linha) ? linha[mapa[campo]] : "");
    if (!Object.keys(mapa).some(c => a[c])) { vazias++; continue; }
    a.tipo = normTipo(a.tipo) || tipoSugerido(a.cliente);
    a.situacao = normSituacao(a.situacao) || "ATIVO";
    for (const c of CAMPOS) if (!(c in a) || a[c] === "") a[c] = (c === "tipo" || c === "situacao") ? a[c] : null;
    aparelhos.push(a);
  }
  return {
    aparelhos, vazias, linhaCabecalho: iCab + 1, naoReconhecidas,
    colunas: Object.keys(mapa).map(c => ({ campo: c, cabecalho: String(cab[mapa[c]]).trim() }))
  };
}

// O mesmo aparelho, digitado igual: a importação não cadastra de novo. Senha fica de fora —
// trocar a senha na planilha não faz virar outro aparelho.
function impressao(a) {
  const n = s => semAcento(s).toUpperCase().replace(/\s+/g, " ").trim();
  return [n(a.cliente), n(a.modelo), digitos(a.imei1), digitos(a.imei2), digitos(a.numero), n(a.login_zello), n(a.email)].join("|");
}

// Corpo de POST/PATCH da tela → campos para o banco. parcial: só os campos que vieram (PATCH).
function validar(body, parcial) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { erro: "Dados inválidos." };
  const out = {};
  for (const c of CAMPOS) {
    if (!Object.prototype.hasOwnProperty.call(body, c)) continue;
    const v = body[c];
    if (v != null && typeof v !== "string" && typeof v !== "number") return { erro: "Campo inválido: " + c + "." };
    let s = limpar(c, v);
    if (c === "tipo") { s = s.toUpperCase(); if (TIPOS.indexOf(s) < 0) return { erro: "Tipo inválido." }; }
    if (c === "situacao") { s = s.toUpperCase(); if (SITUACOES.indexOf(s) < 0) return { erro: "Situação inválida." }; }
    out[c] = s === "" ? null : s;
  }
  if (!parcial) {
    if (!out.cliente && !out.numero && !out.imei1) return { erro: "Preencha pelo menos o cliente, o número ou o IMEI 1." };
    out.tipo = out.tipo || "POSTO";
    out.situacao = out.situacao || "ATIVO";
  } else if (!Object.keys(out).length) return { erro: "Nada para alterar." };
  return { campos: out };
}

// Pendências de cada aparelho: { id → [{ campo, tipo: "falta" | "conferir", msg }] }.
// Precisa das senhas (para saber se estão vazias); quem chama tira as senhas antes de responder.
// O repetido é procurado entre os que não foram baixados: o número de um aparelho baixado pode
// ter ido, de propósito, para o aparelho novo.
function pendencias(aparelhos) {
  const lista = Array.isArray(aparelhos) ? aparelhos : [];
  const out = {};
  const vivos = lista.filter(a => a && a.situacao !== "BAIXADO");
  // valor → ids que o usam, por tipo de dado
  const indices = { numero: new Map(), imei: new Map(), login_zello: new Map(), email: new Map() };
  const marca = (tipo, chave, id) => { if (!chave) return; const m = indices[tipo]; if (!m.has(chave)) m.set(chave, new Set()); m.get(chave).add(id); };
  for (const a of vivos) {
    if (!vazio(a.numero) && !naoSeAplica(a.numero)) { const d = digitos(a.numero); if (d.length >= 8) marca("numero", d.slice(-8), a.id); }
    for (const c of ["imei1", "imei2"]) if (!vazio(a[c]) && !naoSeAplica(a[c])) marca("imei", analisarImei(a[c]).chave, a.id);
    if (!vazio(a.login_zello) && !naoSeAplica(a.login_zello)) marca("login_zello", String(a.login_zello).trim().toLowerCase(), a.id);
    if (emailOk(a.email)) marca("email", String(a.email).trim().toLowerCase(), a.id);
  }
  const nomePorId = new Map(lista.map(a => [a.id, String(a.cliente || "").trim() || "(sem cliente)"]));
  const outros = (ids, id) => {
    const nomes = [...ids].filter(x => x !== id).map(x => nomePorId.get(x));
    return nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? " e mais " + (nomes.length - 3) : "");
  };
  const repetido = (tipo, chave, id) => { const ids = chave && indices[tipo].get(chave); return ids && ids.size > 1 ? outros(ids, id) : ""; };

  for (const a of lista) {
    if (!a) continue;
    const p = [];
    const situacao = SITUACOES.indexOf(a.situacao) >= 0 ? a.situacao : "ATIVO";
    for (const c of OBRIGATORIOS[situacao]) if (vazio(a[c])) p.push({ campo: c, tipo: "falta", msg: FALTA[c] });
    if (situacao !== "BAIXADO") {
      if (!vazio(a.numero) && !naoSeAplica(a.numero)) {
        const n = analisarNumero(a.numero);
        if (n.semDDD) p.push({ campo: "numero", tipo: "conferir", msg: "Número sem DDD" });
        else if (n.invalido) p.push({ campo: "numero", tipo: "conferir", msg: "Número incompleto ou com dígitos a mais" });
        const r = repetido("numero", digitos(a.numero).slice(-8), a.id);
        if (r) p.push({ campo: "numero", tipo: "conferir", msg: "Número repetido em: " + r });
      }
      // O mesmo aparelho em mais de uma linha (trocou de posto e a linha antiga ficou) repete os
      // dois IMEIs de uma vez: vira um aviso só.
      const chaves = [], mesmos = new Set();
      for (const c of ["imei1", "imei2"]) {
        if (vazio(a[c]) || naoSeAplica(a[c])) continue;
        const im = analisarImei(a[c]);
        if (im.invalido) p.push({ campo: c, tipo: "conferir", msg: ROTULO[c] + " inválido (o IMEI tem 15 dígitos)" });
        else if (im.digito) p.push({ campo: c, tipo: "conferir", msg: ROTULO[c] + " com algum dígito errado" });
        if (im.chave) { chaves.push(im.chave); (indices.imei.get(im.chave) || []).forEach(x => { if (x !== a.id) mesmos.add(x); }); }
      }
      if (chaves.length === 2 && chaves[0] === chaves[1]) p.push({ campo: "imei2", tipo: "conferir", msg: "IMEI 2 igual ao IMEI 1" });
      if (mesmos.size) p.push({ campo: "imei1", tipo: "conferir", msg: "Mesmo IMEI em: " + outros(mesmos, a.id) });
      if (!vazio(a.email) && !naoSeAplica(a.email)) {
        if (!emailOk(a.email)) p.push({ campo: "email", tipo: "conferir", msg: "E-mail inválido" });
        else { const r = repetido("email", String(a.email).trim().toLowerCase(), a.id); if (r) p.push({ campo: "email", tipo: "conferir", msg: "E-mail repetido em: " + r }); }
      }
      if (!vazio(a.login_zello) && !naoSeAplica(a.login_zello)) {
        const r = repetido("login_zello", String(a.login_zello).trim().toLowerCase(), a.id);
        if (r) p.push({ campo: "login_zello", tipo: "conferir", msg: "Login Zello repetido em: " + r });
      }
      const fim = semAcento(a.cliente).toUpperCase().match(NOME_DE_BAIXA);
      if (situacao === "ATIVO" && fim) p.push({ campo: "situacao", tipo: "conferir", msg: "O nome diz \"" + fim[1].toLowerCase() + "\": se o aparelho saiu do posto, mude a situação" });
    }
    out[a.id] = p;
  }
  return out;
}

// Números sem DDD que a correção em massa vai completar (só dos aparelhos não baixados).
function semDDD(aparelhos) {
  return (aparelhos || []).filter(a => a && a.situacao !== "BAIXADO" && !vazio(a.numero) && !naoSeAplica(a.numero) && analisarNumero(a.numero).semDDD);
}
function comDDD(numero, ddd) { return "(" + ddd + ") " + formatarLocal(analisarNumero(numero).local); }

module.exports = {
  CAMPOS, SEGREDOS, TIPOS, SITUACOES, ROTULO, OBRIGATORIOS, COLUNAS_EXCEL, MAX_LINHAS_PLANILHA,
  lerPlanilha, validar, pendencias, impressao, tipoSugerido, naoSeAplica, analisarNumero, analisarImei,
  formatarNumero, semDDD, comDDD, luhn
};
