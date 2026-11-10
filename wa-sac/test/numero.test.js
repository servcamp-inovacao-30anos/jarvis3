'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarNumero, mascararNumero, jidDoNumero } = require('../numero');

test('celular com máscara vira 55 + DDD + 9 dígitos', () => {
  const r = normalizarNumero('(19) 99999-8888');
  assert.equal(r.ok, true);
  assert.equal(r.numero, '5519999998888');
  assert.equal(r.jid, '5519999998888@s.whatsapp.net');
});

test('aceita variações de formatação e tipos', () => {
  for (const entrada of ['19999998888', '+55 19 99999-8888', '55 (19) 9 9999 8888', '5519999998888', ' 19.99999.8888 ', 19999998888]) {
    const r = normalizarNumero(entrada);
    assert.equal(r.ok, true, String(entrada));
    assert.equal(r.numero, '5519999998888', String(entrada));
  }
});

test('DDD 55 sem o código do país não é confundido com o DDI', () => {
  const r = normalizarNumero('(55) 99999-8888'); // 11 dígitos começando em 55
  assert.equal(r.ok, true);
  assert.equal(r.numero, '5555999998888');
});

test('com 55 e 12+ dígitos o DDI é respeitado', () => {
  assert.equal(normalizarNumero('5511987654321').numero, '5511987654321');
});

test('telefone fixo é recusado', () => {
  for (const fixo of ['(19) 3333-4444', '1933334444', '551933334444', '5519 33334444']) {
    const r = normalizarNumero(fixo);
    assert.equal(r.ok, false, fixo);
    assert.match(r.motivo, /celular|curto/);
  }
});

test('celular antigo sem o nono dígito é recusado', () => {
  assert.equal(normalizarNumero('(19) 8888-7777').ok, false);
});

test('número curto, vazio e lixo', () => {
  for (const ruim of ['', '   ', '12345', '999998888', 'abc', '---', null, undefined, {}, [], true]) {
    assert.equal(normalizarNumero(ruim).ok, false, JSON.stringify(ruim));
  }
});

test('número longo demais é recusado', () => {
  assert.equal(normalizarNumero('55199999988889999').ok, false);
  assert.equal(normalizarNumero('+55 19 99999-8888 ramal 12').ok, false);
});

test('zero inicial (DDD com 0) é recusado', () => {
  const r = normalizarNumero('019999998888');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /DDD/);
  assert.equal(normalizarNumero('0 (19) 99999-8888').ok, false);
});

test('DDD começando em 0 depois do 55 é recusado', () => {
  assert.equal(normalizarNumero('5509999998888').ok, false);
});

test('celular que não começa em 9 é recusado', () => {
  assert.equal(normalizarNumero('(19) 79999-8888').ok, false);
});

test('mascararNumero e jidDoNumero', () => {
  assert.equal(mascararNumero('5519999998888'), '5519*****8888');
  assert.equal(mascararNumero('123'), '***');
  assert.equal(mascararNumero(null), '');
  assert.equal(jidDoNumero('5519999998888'), '5519999998888@s.whatsapp.net');
});
