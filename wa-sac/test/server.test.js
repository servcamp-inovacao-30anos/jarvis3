'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidor, lerConfig, chaveConfere } = require('../server');
const { criarGerenciador } = require('../whatsapp');
const { criarFila } = require('../fila');
const { esperar, criarFabricaFalsa, criarDormirFalso } = require('./fakes');

const CHAVE = 'chave-de-teste-com-mais-de-16-caracteres';

async function subir({ opcoesSocket = {}, maxCorpo } = {}) {
  const fabrica = criarFabricaFalsa(opcoesSocket);
  const dormir = criarDormirFalso();
  const logs = [];
  const fila = criarFila({ intervaloMinMs: 0, dormir, aleatorio: () => 0 });
  const gerenciador = criarGerenciador({
    criarSocket: fabrica.criarSocket,
    authDir: '/x/auth',
    fila,
    dormir,
    gerarQr: async (t) => `data:image/png;base64,${Buffer.from(t).toString('base64')}`,
    existeCredenciais: () => false,
    removerCredenciais: async () => {},
    digitacaoMs: () => 0,
  });
  const servidor = criarServidor({ apiKey: CHAVE, gerenciador, log: (n, m) => logs.push(m), ...(maxCorpo ? { maxCorpo } : {}) });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const ctx = {
    fabrica,
    fila,
    logs,
    gerenciador,
    base,
    async chamar(metodo, caminho, { chave = CHAVE, corpo, bruto } = {}) {
      const headers = {};
      if (chave !== null) headers['x-api-key'] = chave;
      let body;
      if (bruto !== undefined) {
        body = bruto;
        headers['content-type'] = 'application/json';
      } else if (corpo !== undefined) {
        body = JSON.stringify(corpo);
        headers['content-type'] = 'application/json';
      }
      const r = await fetch(base + caminho, { method: metodo, headers, body });
      const texto = await r.text();
      let json = null;
      try { json = JSON.parse(texto); } catch (_) { /* resposta não-JSON */ }
      return { status: r.status, json, headers: r.headers };
    },
    async abrirSessao() {
      await gerenciador.conectar();
      fabrica.ultimo.sock.emitir('connection.update', { connection: 'open' });
      await esperar(() => gerenciador.estado === 'open');
    },
    async fechar() {
      gerenciador.encerrar();
      servidor.closeAllConnections();
      await new Promise((r) => servidor.close(r));
    },
  };
  return ctx;
}

async function comServidor(opcoes, fn) {
  const ctx = await subir(opcoes);
  try {
    await fn(ctx);
  } finally {
    await ctx.fechar();
  }
}

const envio = (extra = {}) => ({ numero: '(19) 99999-8888', texto: 'olá', ...extra });

// ---------- autenticação ----------

test('GET /health é aberto (sem chave)', () => comServidor({}, async (c) => {
  const r = await c.chamar('GET', '/health', { chave: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
}));

test('sem x-api-key: 401 em todas as rotas protegidas', () => comServidor({}, async (c) => {
  for (const [m, p] of [['GET', '/status'], ['POST', '/connect'], ['POST', '/logout'], ['POST', '/send'], ['GET', '/qualquer']]) {
    const r = await c.chamar(m, p, { chave: null, corpo: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.json.ok, false);
  }
}));

test('x-api-key errada: 401 (inclusive de tamanho diferente, ou vazia)', () => comServidor({}, async (c) => {
  for (const chave of ['errada', CHAVE + 'x', CHAVE.slice(0, -1), CHAVE.toUpperCase(), '']) {
    const r = await c.chamar('GET', '/status', { chave });
    assert.equal(r.status, 401, JSON.stringify(chave));
  }
  assert.equal(c.fabrica.criados.length, 0);
}));

test('x-api-key certa: 200', () => comServidor({}, async (c) => {
  const r = await c.chamar('GET', '/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { state: 'closed', numero: null, qr: null, desde: null });
}));

test('chaveConfere usa comparação segura e aceita só a chave exata', () => {
  assert.equal(chaveConfere(CHAVE, CHAVE), true);
  assert.equal(chaveConfere(CHAVE + ' ', CHAVE), false);
  assert.equal(chaveConfere(undefined, CHAVE), false);
});

test('o serviço não sobe sem WA_API_KEY de pelo menos 16 caracteres', () => {
  const gerenciador = {};
  assert.throws(() => criarServidor({ apiKey: undefined, gerenciador }), /WA_API_KEY/);
  assert.throws(() => criarServidor({ apiKey: '123456789012345', gerenciador }), /WA_API_KEY/);
  assert.doesNotThrow(() => criarServidor({ apiKey: '1234567890123456', gerenciador }));
  assert.throws(() => lerConfig({}), /WA_API_KEY/);
  assert.throws(() => lerConfig({ WA_API_KEY: 'curta' }), /WA_API_KEY/);
  const cfg = lerConfig({ WA_API_KEY: CHAVE });
  assert.equal(cfg.intervaloMinMs, 5000);
  assert.equal(cfg.authDir, './auth');
  assert.equal(cfg.porta, 3000);
  assert.equal(lerConfig({ WA_API_KEY: CHAVE, WA_INTERVALO_MIN_MS: '8000', WA_AUTH_DIR: '/data/auth', PORT: '8080' }).intervaloMinMs, 8000);
  assert.throws(() => lerConfig({ WA_API_KEY: CHAVE, WA_INTERVALO_MIN_MS: 'abc' }), /WA_INTERVALO_MIN_MS/);
});

// ---------- roteamento ----------

test('rota desconhecida: 404; método errado: 405 com Allow', () => comServidor({}, async (c) => {
  assert.equal((await c.chamar('GET', '/nada')).status, 404);
  assert.equal((await c.chamar('POST', '/status')).status, 405);
  const r = await c.chamar('GET', '/send');
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'POST');
  assert.equal((await c.chamar('GET', '/connect')).status, 405);
  assert.equal((await c.chamar('GET', '/logout')).status, 405);
  assert.equal((await c.chamar('POST', '/health', { chave: null })).status, 405);
  assert.equal((await c.chamar('DELETE', '/send')).status, 405);
}));

test('não envia cabeçalhos CORS', () => comServidor({}, async (c) => {
  const r = await c.chamar('GET', '/status');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
}));

// ---------- /connect, /status, /logout ----------

test('/connect inicia o pareamento; /status mostra o QR; /logout volta a closed', () => comServidor({}, async (c) => {
  let r = await c.chamar('POST', '/connect');
  assert.equal(r.status, 200);
  assert.equal(r.json.state, 'connecting');
  assert.equal(r.json.qr, null);

  c.fabrica.ultimo.sock.emitir('connection.update', { qr: 'CODIGO' });
  r = await c.chamar('GET', '/status');
  assert.equal(r.json.state, 'qr');
  assert.match(r.json.qr, /^data:image\/png;base64,/);

  c.fabrica.ultimo.sock.emitir('connection.update', { connection: 'open' });
  await esperar(() => c.gerenciador.estado === 'open');
  r = await c.chamar('POST', '/connect'); // já aberto: não faz nada
  assert.equal(r.json.state, 'open');
  assert.equal(r.json.numero, '5519999998888');
  assert.equal(c.fabrica.criados.length, 1);

  r = await c.chamar('POST', '/logout');
  assert.equal(r.status, 200);
  assert.equal(r.json.state, 'closed');
  assert.equal(r.json.numero, null);
}));

test('o QR real é um PNG em data URL (biblioteca qrcode)', async () => {
  const { criarGerenciador: criar } = require('../whatsapp');
  const fabrica = criarFabricaFalsa();
  const g = criar({
    criarSocket: fabrica.criarSocket,
    fila: criarFila({ intervaloMinMs: 0, dormir: async () => {} }),
    existeCredenciais: () => false,
    removerCredenciais: async () => {},
  });
  await g.conectar();
  fabrica.ultimo.sock.emitir('connection.update', { qr: '2@abc,def,ghi' });
  const s = await g.statusPublico();
  assert.match(s.qr, /^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/);
  g.encerrar();
});

// ---------- /send ----------

test('/send desconectado: 409', () => comServidor({}, async (c) => {
  const r = await c.chamar('POST', '/send', { corpo: envio() });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { ok: false, motivo: 'WhatsApp desconectado' });
}));

test('/send OK: 200 com id; número é normalizado e o texto vai como está', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  const r = await c.chamar('POST', '/send', { corpo: envio() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, id: 'MSG1' });
  assert.deepEqual(c.fabrica.ultimo.sock.enviados[0], { jid: '5519999998888@s.whatsapp.net', conteudo: { text: 'olá' } });
}));

test('/send com imagem: legenda e mimetype chegam ao socket', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  const bytes = Buffer.from('imagem-de-mentira');
  const r = await c.chamar('POST', '/send', {
    corpo: envio({ texto: 'foto do pedido', imagem: { base64: bytes.toString('base64'), mimetype: 'image/jpeg', nome: 'foto.jpg' } }),
  });
  assert.equal(r.status, 200);
  const conteudo = c.fabrica.ultimo.sock.enviados[0].conteudo;
  assert.equal(conteudo.caption, 'foto do pedido');
  assert.equal(conteudo.mimetype, 'image/jpeg');
  assert.deepEqual(conteudo.image, bytes);
}));

test('/send só com imagem (sem texto) é aceito', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  const r = await c.chamar('POST', '/send', {
    corpo: { numero: '19999998888', imagem: { base64: Buffer.from('x').toString('base64'), mimetype: 'image/png' } },
  });
  assert.equal(r.status, 200);
  assert.equal(c.fabrica.ultimo.sock.enviados[0].conteudo.caption, undefined);
}));

test('/send 422: número inválido, fixo, curto, ausente', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  for (const numero of ['abc', '(19) 3333-4444', '12345', '', null, undefined, 123456789012345678]) {
    const r = await c.chamar('POST', '/send', { corpo: { numero, texto: 'oi' } });
    assert.equal(r.status, 422, JSON.stringify(numero));
    assert.equal(r.json.ok, false);
    assert.equal(typeof r.json.motivo, 'string');
  }
  assert.equal(c.fabrica.ultimo.sock.enviados.length, 0);
}));

test('/send 422: texto vazio e sem imagem; texto que não é string', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  for (const corpo of [envio({ texto: '' }), envio({ texto: '   \n ' }), { numero: '19999998888' }, envio({ texto: 42 }), envio({ texto: { a: 1 } })]) {
    const r = await c.chamar('POST', '/send', { corpo });
    assert.equal(r.status, 422, JSON.stringify(corpo));
  }
}));

test('/send 422: mimetype fora de jpeg/png/webp', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  const b64 = Buffer.from('x').toString('base64');
  for (const mimetype of ['image/gif', 'application/pdf', 'text/html', '', undefined, 5]) {
    const r = await c.chamar('POST', '/send', { corpo: envio({ imagem: { base64: b64, mimetype } }) });
    assert.equal(r.status, 422, String(mimetype));
  }
  for (const mimetype of ['image/jpeg', 'image/png', 'image/webp']) {
    const r = await c.chamar('POST', '/send', { corpo: envio({ imagem: { base64: b64, mimetype } }) });
    assert.equal(r.status, 200, mimetype);
  }
}));

test('/send 422: imagem acima de 5 MB (e 5 MB exatos passam)', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  const cinco = 5 * 1024 * 1024;
  const grande = Buffer.alloc(cinco + 1, 7).toString('base64');
  let r = await c.chamar('POST', '/send', { corpo: envio({ imagem: { base64: grande, mimetype: 'image/jpeg' } }) });
  assert.equal(r.status, 422);
  assert.match(r.json.motivo, /5 MB/);

  const exato = Buffer.alloc(cinco, 7).toString('base64');
  r = await c.chamar('POST', '/send', { corpo: envio({ imagem: { base64: exato, mimetype: 'image/jpeg' } }) });
  assert.equal(r.status, 200);
}));

test('/send 422: imagem malformada (base64 inválido, vazia, sem objeto)', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  for (const imagem of [{ base64: '@@@@', mimetype: 'image/png' }, { base64: '', mimetype: 'image/png' }, { mimetype: 'image/png' }, 'texto', [1]]) {
    const r = await c.chamar('POST', '/send', { corpo: envio({ imagem }) });
    assert.equal(r.status, 422, JSON.stringify(imagem));
  }
}));

test('/send 422: número sem WhatsApp', () => comServidor({ opcoesSocket: { existe: () => false } }, async (c) => {
  await c.abrirSessao();
  const r = await c.chamar('POST', '/send', { corpo: envio() });
  assert.equal(r.status, 422);
  assert.match(r.json.motivo, /sem WhatsApp/);
  assert.equal(c.fabrica.ultimo.sock.enviados.length, 0);
}));

test('/send 429: fila com mais de 20 pendentes', () => {
  let liberar;
  const bloqueio = new Promise((r) => { liberar = r; });
  return comServidor({ opcoesSocket: { bloqueio } }, async (c) => {
    await c.abrirSessao();
    const em_andamento = [];
    for (let i = 0; i < 20; i += 1) em_andamento.push(c.chamar('POST', '/send', { corpo: envio({ texto: `m${i}` }) }));
    await esperar(() => c.fila.pendentes() === 20);
    const r = await c.chamar('POST', '/send', { corpo: envio({ texto: 'a 21ª' }) });
    assert.equal(r.status, 429);
    assert.equal(r.json.ok, false);
    liberar();
    const respostas = await Promise.all(em_andamento);
    assert.ok(respostas.every((x) => x.status === 200));
  });
});

test('/send: JSON inválido 400; corpo acima do limite 413', () => comServidor({ maxCorpo: 2048 }, async (c) => {
  await c.abrirSessao();
  let r = await c.chamar('POST', '/send', { bruto: '{nao é json' });
  assert.equal(r.status, 400);
  r = await c.chamar('POST', '/send', { bruto: '[1,2]' });
  assert.equal(r.status, 400);
  r = await c.chamar('POST', '/send', { bruto: '' });
  assert.equal(r.status, 400);
  r = await c.chamar('POST', '/send', { corpo: envio({ texto: 'x'.repeat(5000) }) });
  assert.equal(r.status, 413);
}));

test('/send: erro inesperado vira 500 sem vazar stack', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  c.fabrica.ultimo.sock.sendMessage = async () => { throw new Error('segredo interno /caminho/arquivo.js:10'); };
  const r = await c.chamar('POST', '/send', { corpo: envio() });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { ok: false, motivo: 'erro interno' });
}));

test('logs não trazem o texto nem o número completo', () => comServidor({}, async (c) => {
  await c.abrirSessao();
  await c.chamar('POST', '/send', { corpo: envio({ texto: 'conteudo-secreto-do-cliente' }) });
  const tudo = c.logs.join('\n');
  assert.ok(tudo.includes('POST /send 200'));
  assert.ok(!tudo.includes('conteudo-secreto-do-cliente'));
  assert.ok(!tudo.includes('5519999998888'));
  assert.ok(!tudo.includes('99999-8888'));
  assert.ok(!tudo.includes(CHAVE));
}));

test('modo local (PC do SAC): sem chave, mas só a página do sistema fala com o serviço', async () => {
  const fabrica = criarFabricaFalsa({});
  const dormir = criarDormirFalso();
  const fila = criarFila({ intervaloMinMs: 0, dormir, aleatorio: () => 0 });
  const gerenciador = criarGerenciador({
    criarSocket: fabrica.criarSocket, authDir: '/x/auth', fila, dormir,
    gerarQr: async (t) => `data:image/png;base64,${Buffer.from(t).toString('base64')}`,
    existeCredenciais: () => false, removerCredenciais: async () => {}, digitacaoMs: () => 0,
  });
  const servidor = criarServidor({ origens: ['https://sistema.exemplo.com.br/'], gerenciador });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    // a página do sistema: pré-voo e /status sem chave
    const pre = await fetch(base + '/status', { method: 'OPTIONS', headers: { origin: 'https://sistema.exemplo.com.br', 'access-control-request-method': 'GET' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://sistema.exemplo.com.br');
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    const ok = await fetch(base + '/status', { headers: { origin: 'https://sistema.exemplo.com.br' } });
    assert.equal(ok.status, 200);
    assert.ok(['closed', 'close', 'disconnected', 'connecting', 'open', 'qr'].includes((await ok.json()).state));
    // outro site aberto no mesmo PC é recusado
    const outro = await fetch(base + '/status', { headers: { origin: 'https://site-malicioso.com' } });
    assert.equal(outro.status, 403);
    const outroPre = await fetch(base + '/send', { method: 'OPTIONS', headers: { origin: 'https://site-malicioso.com' } });
    assert.equal(outroPre.status, 403);
    // sem Origin (programa local, não navegador) é aceito
    assert.equal((await fetch(base + '/status')).status, 200);
  } finally {
    gerenciador.encerrar();
    await new Promise((r) => servidor.close(r));
  }
  assert.throws(() => criarServidor({ origens: [], gerenciador }), /WA_API_KEY/);
  const cfg = lerConfig({ WA_ORIGENS: 'https://sistema.exemplo.com.br' });
  assert.deepEqual([cfg.local, cfg.host, cfg.porta], [true, '127.0.0.1', 3939]);
});
