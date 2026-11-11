'use strict';

/**
 * Normalização de números de celular brasileiro. Função pura, sem I/O.
 *
 * Regras:
 *  - mantém só dígitos;
 *  - se começar com 55 e tiver 12+ dígitos, considera que o DDI já veio; senão prefixa 55;
 *  - depois do 55: DDD de 2 dígitos (sem zero inicial) + 9 dígitos começando em 9
 *    (apenas celular; telefone fixo é recusado).
 */

const MOTIVOS = {
  vazio: 'número não informado',
  curto: 'número muito curto',
  longo: 'número muito longo',
  ddd: 'DDD inválido (use 2 dígitos, sem zero inicial)',
  celular: 'só é aceito celular brasileiro (DDD + 9 dígitos começando em 9)',
};

function normalizarNumero(entrada) {
  if (entrada === null || entrada === undefined) return { ok: false, motivo: MOTIVOS.vazio };
  if (typeof entrada !== 'string' && typeof entrada !== 'number') {
    return { ok: false, motivo: MOTIVOS.vazio };
  }
  let digitos = String(entrada).replace(/\D+/g, '');
  if (!digitos) return { ok: false, motivo: MOTIVOS.vazio };

  if (digitos.startsWith('0')) return { ok: false, motivo: MOTIVOS.ddd }; // 019... / 0 (19) ...

  if (!(digitos.startsWith('55') && digitos.length >= 12)) digitos = '55' + digitos;

  const local = digitos.slice(2); // DDD + número
  if (local.length < 10) return { ok: false, motivo: MOTIVOS.curto };
  if (local.length > 11) return { ok: false, motivo: MOTIVOS.longo };

  const ddd = local.slice(0, 2);
  if (!/^[1-9][1-9]$/.test(ddd)) return { ok: false, motivo: MOTIVOS.ddd };

  const assinante = local.slice(2);
  if (!/^9\d{8}$/.test(assinante)) return { ok: false, motivo: MOTIVOS.celular };

  return { ok: true, numero: digitos, jid: jidDoNumero(digitos) };
}

function jidDoNumero(numero) {
  return `${numero}@s.whatsapp.net`;
}

/** 5519999998888 -> 5519*****8888 (para logs). */
function mascararNumero(numero) {
  const d = String(numero == null ? '' : numero).replace(/\D+/g, '');
  if (d.length < 9) return '*'.repeat(d.length);
  return `${d.slice(0, 4)}${'*'.repeat(d.length - 8)}${d.slice(-4)}`;
}

module.exports = { normalizarNumero, jidDoNumero, mascararNumero };
