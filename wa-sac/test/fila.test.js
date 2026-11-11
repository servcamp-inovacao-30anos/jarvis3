'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarFila, ErroFilaCheia } = require('../fila');
const { tick } = require('./fakes');

function relogioFalso() {
  const r = { t: 1000, esperas: [] };
  r.agora = () => r.t;
  r.dormir = async (ms) => {
    r.esperas.push(ms);
    r.t += ms;
  };
  return r;
}

test('executa na ordem de chegada, uma por vez', async () => {
  const rel = relogioFalso();
  const fila = criarFila({ intervaloMinMs: 100, agora: rel.agora, dormir: rel.dormir, aleatorio: () => 0 });
  const ordem = [];
  let simultaneas = 0;
  let maxSimultaneas = 0;
  const tarefa = (nome) => async () => {
    simultaneas += 1;
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
    await tick();
    ordem.push(nome);
    simultaneas -= 1;
    return nome;
  };
  const resultados = await Promise.all(['a', 'b', 'c', 'd'].map((n) => fila.enfileirar(tarefa(n))));
  assert.deepEqual(ordem, ['a', 'b', 'c', 'd']);
  assert.deepEqual(resultados, ['a', 'b', 'c', 'd']);
  assert.equal(maxSimultaneas, 1);
  assert.equal(fila.pendentes(), 0);
});

test('a primeira tarefa não espera; as seguintes respeitam o intervalo mínimo', async () => {
  const rel = relogioFalso();
  const fila = criarFila({ intervaloMinMs: 5000, agora: rel.agora, dormir: rel.dormir, aleatorio: () => 0 });
  await Promise.all([1, 2, 3].map(() => fila.enfileirar(async () => 'ok')));
  assert.deepEqual(rel.esperas, [5000, 5000]);
});

test('jitter soma de 0% a 40% ao intervalo', async () => {
  for (const [aleatorio, esperado] of [[0, 5000], [0.5, 6000], [0.9999, 6999.8]]) {
    const rel = relogioFalso();
    const fila = criarFila({ intervaloMinMs: 5000, agora: rel.agora, dormir: rel.dormir, aleatorio: () => aleatorio });
    await fila.enfileirar(async () => 1);
    await fila.enfileirar(async () => 2);
    assert.ok(Math.abs(rel.esperas[0] - esperado) < 0.5, `aleatorio=${aleatorio}: ${rel.esperas[0]}`);
    assert.ok(rel.esperas[0] >= 5000 && rel.esperas[0] <= 7000);
  }
});

test('o tempo que a tarefa já levou conta para o intervalo', async () => {
  const rel = relogioFalso();
  const fila = criarFila({ intervaloMinMs: 5000, agora: rel.agora, dormir: rel.dormir, aleatorio: () => 0 });
  await fila.enfileirar(async () => {});
  rel.t += 3000; // 3 s depois do fim da primeira
  await fila.enfileirar(async () => {});
  assert.deepEqual(rel.esperas, [2000]); // faltavam 2 s para completar 5 s
  // depois de muito tempo ocioso, não espera nada
  rel.t += 60000;
  await fila.enfileirar(async () => {});
  assert.deepEqual(rel.esperas, [2000]);
});

test('falha de uma tarefa não trava a fila', async () => {
  const rel = relogioFalso();
  const fila = criarFila({ intervaloMinMs: 10, agora: rel.agora, dormir: rel.dormir, aleatorio: () => 0 });
  const p1 = fila.enfileirar(async () => { throw new Error('boom'); });
  const p2 = fila.enfileirar(async () => 'segue');
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, 'segue');
  assert.equal(fila.pendentes(), 0);
});

test('limite de 20 pendentes: a 21ª é recusada e depois a fila volta ao normal', async () => {
  const rel = relogioFalso();
  const fila = criarFila({ intervaloMinMs: 0, agora: rel.agora, dormir: rel.dormir, aleatorio: () => 0 });
  let liberar;
  const portao = new Promise((r) => { liberar = r; });
  const promessas = [];
  for (let i = 0; i < 20; i += 1) promessas.push(fila.enfileirar(async () => { await portao; return i; }));
  assert.equal(fila.pendentes(), 20);
  await assert.rejects(fila.enfileirar(async () => 'x'), (e) => e instanceof ErroFilaCheia && e.limite === 20);
  assert.equal(fila.pendentes(), 20);
  liberar();
  const resultados = await Promise.all(promessas);
  assert.deepEqual(resultados, Array.from({ length: 20 }, (_, i) => i));
  assert.equal(fila.pendentes(), 0);
  assert.equal(await fila.enfileirar(async () => 'de novo'), 'de novo');
});
