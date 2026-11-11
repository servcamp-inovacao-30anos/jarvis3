'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarGerenciador, ErroEnvio } = require('../whatsapp');
const { criarFila } = require('../fila');
const { esperar, criarFabricaFalsa, erroDeDesconexao, criarDormirFalso, tick } = require('./fakes');

// Códigos reais do DisconnectReason do Baileys 6.7.x
const LOGGED_OUT = 401;
const FORBIDDEN = 403;
const TIMED_OUT = 408;
const CONNECTION_CLOSED = 428;
const CONNECTION_REPLACED = 440;
const RESTART_REQUIRED = 515;

function montar({ credenciais = false, opcoesSocket = {} } = {}) {
  const fabrica = criarFabricaFalsa(opcoesSocket);
  const dormir = criarDormirFalso();
  const removidas = [];
  const logs = [];
  let t = 1000;
  const fila = criarFila({ intervaloMinMs: 0, dormir, aleatorio: () => 0 });
  const gerenciador = criarGerenciador({
    criarSocket: fabrica.criarSocket,
    authDir: '/x/auth',
    fila,
    dormir,
    agora: () => (t += 10),
    log: (nivel, msg) => logs.push(`${nivel}: ${msg}`),
    gerarQr: async (texto) => `data:image/png;base64,${Buffer.from(texto).toString('base64')}`,
    existeCredenciais: () => credenciais,
    removerCredenciais: async (dir) => { removidas.push(dir); },
    digitacaoMs: () => 0,
  });
  return { fabrica, dormir, removidas, logs, gerenciador, fila };
}

const fechar = (item, codigo) => item.sock.emitir('connection.update', { connection: 'close', lastDisconnect: { error: erroDeDesconexao(codigo) } });
const abrir = (item) => item.sock.emitir('connection.update', { connection: 'open' });

async function conectarEAbrir(ctx) {
  await ctx.gerenciador.conectar();
  abrir(ctx.fabrica.ultimo);
  await esperar(() => ctx.gerenciador.estado === 'open');
}

test('sobe fechado; sem credenciais não conecta sozinho', async () => {
  const ctx = montar({ credenciais: false });
  await ctx.gerenciador.iniciar();
  assert.equal(ctx.fabrica.criados.length, 0);
  const s = await ctx.gerenciador.statusPublico();
  assert.deepEqual(s, { state: 'closed', numero: null, qr: null, desde: null });
});

test('com credenciais salvas, reconecta sozinho ao subir', async () => {
  const ctx = montar({ credenciais: true });
  await ctx.gerenciador.iniciar();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.equal(ctx.gerenciador.estado, 'connecting');
  abrir(ctx.fabrica.ultimo);
  await esperar(() => ctx.gerenciador.estado === 'open');
  const s = await ctx.gerenciador.statusPublico();
  assert.equal(s.state, 'open');
  assert.equal(s.numero, '5519999998888');
  assert.equal(typeof s.desde, 'number');
  assert.equal(s.qr, null);
});

test('QR só aparece no estado "qr" e some ao conectar', async () => {
  const ctx = montar();
  await ctx.gerenciador.conectar();
  assert.equal((await ctx.gerenciador.statusPublico()).qr, null);

  ctx.fabrica.ultimo.sock.emitir('connection.update', { qr: 'QR-1' });
  let s = await ctx.gerenciador.statusPublico();
  assert.equal(s.state, 'qr');
  assert.equal(s.qr, `data:image/png;base64,${Buffer.from('QR-1').toString('base64')}`);

  ctx.fabrica.ultimo.sock.emitir('connection.update', { qr: 'QR-2' }); // o QR é renovado
  s = await ctx.gerenciador.statusPublico();
  assert.equal(s.qr, `data:image/png;base64,${Buffer.from('QR-2').toString('base64')}`);

  ctx.fabrica.ultimo.sock.emitir('connection.update', { connection: 'connecting' });
  assert.equal(ctx.gerenciador.estado, 'qr'); // "connecting" não derruba o QR na tela

  abrir(ctx.fabrica.ultimo);
  await esperar(() => ctx.gerenciador.estado === 'open');
  s = await ctx.gerenciador.statusPublico();
  assert.equal(s.qr, null);
  assert.equal(s.numero, '5519999998888');
});

test('salva as credenciais a cada creds.update', async () => {
  const ctx = montar();
  await ctx.gerenciador.conectar();
  ctx.fabrica.ultimo.sock.emitir('creds.update', {});
  ctx.fabrica.ultimo.sock.emitir('creds.update', {});
  await tick();
  assert.equal(ctx.fabrica.ultimo.salvou, 2);
});

test('/connect com a sessão já aberta não faz nada', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  await ctx.gerenciador.conectar();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.equal(ctx.gerenciador.estado, 'open');
});

test('/connect fora do "open" reinicia o pareamento com um socket novo', async () => {
  const ctx = montar();
  await ctx.gerenciador.conectar();
  const primeiro = ctx.fabrica.ultimo;
  primeiro.sock.emitir('connection.update', { qr: 'velho' });
  await ctx.gerenciador.conectar();
  assert.equal(ctx.fabrica.criados.length, 2);
  assert.equal(primeiro.sock.finalizado, 1);
  assert.equal(ctx.gerenciador.estado, 'connecting');
  // eventos do socket antigo são ignorados
  primeiro.sock.emitir('connection.update', { qr: 'velho-2' });
  assert.equal(ctx.gerenciador.estado, 'connecting');
});

test('queda de conexão: reconecta com backoff exponencial de 1 s até 60 s', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  const esperadas = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
  for (let i = 0; i < esperadas.length; i += 1) {
    const total = ctx.fabrica.criados.length;
    fechar(ctx.fabrica.ultimo, CONNECTION_CLOSED);
    await esperar(() => ctx.fabrica.criados.length === total + 1);
  }
  assert.deepEqual(ctx.dormir.esperas, esperadas);
  assert.equal(ctx.gerenciador.estado, 'connecting');

  // ao reconectar com sucesso o backoff zera
  abrir(ctx.fabrica.ultimo);
  await esperar(() => ctx.gerenciador.estado === 'open');
  const total = ctx.fabrica.criados.length;
  fechar(ctx.fabrica.ultimo, CONNECTION_CLOSED);
  await esperar(() => ctx.fabrica.criados.length === total + 1);
  assert.equal(ctx.dormir.esperas[ctx.dormir.esperas.length - 1], 1000);
});

test('falha ao criar o socket também entra no backoff', async () => {
  const ctx = montar();
  ctx.fabrica.falhas = 2;
  await ctx.gerenciador.conectar();
  await esperar(() => ctx.fabrica.criados.length === 1);
  assert.deepEqual(ctx.dormir.esperas, [1000, 2000]);
});

test('loggedOut: apaga credenciais, vai para "closed" e não reconecta', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  fechar(ctx.fabrica.ultimo, LOGGED_OUT);
  await esperar(() => ctx.gerenciador.estado === 'closed');
  assert.deepEqual(ctx.removidas, ['/x/auth']);
  await tick();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.deepEqual(ctx.dormir.esperas, []);
  const s = await ctx.gerenciador.statusPublico();
  assert.equal(s.state, 'closed');
  assert.equal(s.numero, null);

  // depois disso o /connect volta a parear
  await ctx.gerenciador.conectar();
  assert.equal(ctx.fabrica.criados.length, 2);
});

test('connectionReplaced: não entra em loop de reconexão e mantém as credenciais', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  fechar(ctx.fabrica.ultimo, CONNECTION_REPLACED);
  await esperar(() => ctx.gerenciador.estado === 'closed');
  await tick();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.deepEqual(ctx.dormir.esperas, []);
  assert.deepEqual(ctx.removidas, []);
  // só volta quando alguém pedir
  await ctx.gerenciador.conectar();
  assert.equal(ctx.fabrica.criados.length, 2);
});

test('forbidden (403): não insiste', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  fechar(ctx.fabrica.ultimo, FORBIDDEN);
  await esperar(() => ctx.gerenciador.estado === 'closed');
  await tick();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.deepEqual(ctx.removidas, []);
});

test('QR que expira sem leitura volta para "closed" (sem ficar gerando QR para sempre)', async () => {
  const ctx = montar();
  await ctx.gerenciador.conectar();
  ctx.fabrica.ultimo.sock.emitir('connection.update', { qr: 'x' });
  fechar(ctx.fabrica.ultimo, TIMED_OUT);
  await esperar(() => ctx.gerenciador.estado === 'closed');
  await tick();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.deepEqual(ctx.removidas, []);
});

test('restartRequired logo após ler o QR reconecta na hora', async () => {
  const ctx = montar();
  await ctx.gerenciador.conectar();
  ctx.fabrica.ultimo.sock.emitir('connection.update', { qr: 'x' });
  fechar(ctx.fabrica.ultimo, RESTART_REQUIRED);
  await esperar(() => ctx.fabrica.criados.length === 2);
  assert.deepEqual(ctx.dormir.esperas, [0]);
  abrir(ctx.fabrica.ultimo);
  await esperar(() => ctx.gerenciador.estado === 'open');
});

test('logout(): desloga, apaga credenciais, volta a "closed" e ignora eventos antigos', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  const item = ctx.fabrica.ultimo;
  await ctx.gerenciador.logout();
  assert.equal(item.sock.deslogado, 1);
  assert.equal(item.sock.finalizado, 1);
  assert.deepEqual(ctx.removidas, ['/x/auth']);
  const s = await ctx.gerenciador.statusPublico();
  assert.equal(s.state, 'closed');
  assert.equal(s.numero, null);

  // o Baileys emite "close/loggedOut" depois do logout; não pode apagar de novo nem reconectar
  fechar(item, LOGGED_OUT);
  await tick();
  assert.deepEqual(ctx.removidas, ['/x/auth']);
  assert.equal(ctx.fabrica.criados.length, 1);
});

test('logout() sem socket também apaga as credenciais', async () => {
  const ctx = montar();
  await ctx.gerenciador.logout();
  assert.deepEqual(ctx.removidas, ['/x/auth']);
  assert.equal(ctx.gerenciador.estado, 'closed');
});

test('encerrar() fecha o socket sem deslogar nem apagar credenciais', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  ctx.gerenciador.encerrar();
  const item = ctx.fabrica.ultimo;
  assert.equal(item.sock.finalizado, 1);
  assert.equal(item.sock.deslogado, 0);
  fechar(item, CONNECTION_CLOSED);
  await tick();
  assert.equal(ctx.fabrica.criados.length, 1);
  assert.deepEqual(ctx.removidas, []);
});

test('envio de texto: valida o número, mostra "digitando", envia e devolve o id', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  const id = await ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'olá', imagem: null });
  assert.equal(id, 'MSG1');
  const { sock } = ctx.fabrica.ultimo;
  assert.deepEqual(sock.chamadas.map((c) => c[0] + (c[1] && c[0] === 'presenca' ? `:${c[1]}` : '')), [
    'onWhatsApp',
    'presenca:composing',
    'sendMessage',
    'presenca:paused',
  ]);
  assert.deepEqual(sock.enviados[0], { jid: '5519999998888@s.whatsapp.net', conteudo: { text: 'olá' } });
});

test('usa o JID devolvido pelo onWhatsApp (ex.: número sem o nono dígito)', async () => {
  const ctx = montar({ opcoesSocket: { existe: () => '551999998888@s.whatsapp.net' } });
  await conectarEAbrir(ctx);
  await ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'oi', imagem: null });
  assert.equal(ctx.fabrica.ultimo.sock.enviados[0].jid, '551999998888@s.whatsapp.net');
});

test('envio de imagem: texto vira legenda', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  const buffer = Buffer.from([1, 2, 3]);
  await ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'legenda', imagem: { buffer, mimetype: 'image/png' } });
  assert.deepEqual(ctx.fabrica.ultimo.sock.enviados[0].conteudo, { image: buffer, mimetype: 'image/png', caption: 'legenda' });
  await ctx.gerenciador.enviar({ numero: '5519999998888', texto: '', imagem: { buffer, mimetype: 'image/png' } });
  assert.deepEqual(ctx.fabrica.ultimo.sock.enviados[1].conteudo, { image: buffer, mimetype: 'image/png' });
});

test('número sem WhatsApp: 422 e nada é enviado', async () => {
  const ctx = montar({ opcoesSocket: { existe: () => false } });
  await conectarEAbrir(ctx);
  await assert.rejects(
    ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'oi', imagem: null }),
    (e) => e instanceof ErroEnvio && e.status === 422 && /WhatsApp/.test(e.motivo),
  );
  assert.equal(ctx.fabrica.ultimo.sock.enviados.length, 0);
});

test('desconectado: 409', async () => {
  const ctx = montar();
  await assert.rejects(
    ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'oi', imagem: null }),
    (e) => e instanceof ErroEnvio && e.status === 409 && e.motivo === 'WhatsApp desconectado',
  );
});

test('fila cheia (mais de 20 pendentes): 429', async () => {
  let liberar;
  const bloqueio = new Promise((r) => { liberar = r; });
  const ctx = montar({ opcoesSocket: { bloqueio } });
  await conectarEAbrir(ctx);
  const envios = [];
  for (let i = 0; i < 20; i += 1) envios.push(ctx.gerenciador.enviar({ numero: '5519999998888', texto: `m${i}`, imagem: null }));
  await assert.rejects(
    ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'extra', imagem: null }),
    (e) => e instanceof ErroEnvio && e.status === 429,
  );
  liberar();
  const ids = await Promise.all(envios);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

test('o log nunca traz o número completo', async () => {
  const ctx = montar();
  await conectarEAbrir(ctx);
  await ctx.gerenciador.enviar({ numero: '5519999998888', texto: 'segredo', imagem: null });
  const tudo = ctx.logs.join('\n');
  assert.ok(!tudo.includes('5519999998888'));
  assert.ok(!tudo.includes('segredo'));
  assert.ok(tudo.includes('5519*****8888'));
});
