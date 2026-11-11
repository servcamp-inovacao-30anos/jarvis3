'use strict';

/**
 * Gerenciador da conexão WhatsApp (Baileys) do SAC.
 *
 * A fábrica de socket é injetável (`criarSocket`) para permitir testes sem rede.
 * Contrato da fábrica: async ({ authDir, logger }) => { sock, salvarCreds, DisconnectReason? }
 *   - sock: objeto no formato do Baileys (ev.on, onWhatsApp, sendMessage,
 *     sendPresenceUpdate, logout, end, user).
 *   - salvarCreds: função async chamada a cada evento 'creds.update'.
 *
 * Estados: 'closed' | 'connecting' | 'qr' | 'open'.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ErroFilaCheia } = require('./fila');
const { jidDoNumero, mascararNumero } = require('./numero');

// Códigos reais de DisconnectReason do Baileys 6.7.x (conferidos no pacote instalado).
const MOTIVOS_PADRAO = { loggedOut: 401, forbidden: 403, connectionReplaced: 440, restartRequired: 515 };

class ErroEnvio extends Error {
  constructor(status, motivo) {
    super(motivo);
    this.name = 'ErroEnvio';
    this.status = status;
    this.motivo = motivo;
  }
}

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function comTimeout(promessa, ms, rotulo) {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tempo esgotado: ${rotulo}`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(promessa), limite]).finally(() => clearTimeout(timer));
}

/**
 * Fábrica real. O Baileys 6.7.x é ESM puro (e `require` falha), por isso o
 * `import()` dinâmico: funciona a partir de código CommonJS em qualquer Node 20+.
 */
async function criarSocketBaileys({ authDir }) {
  const baileys = await import('@whiskeysockets/baileys');
  const pino = require('pino');
  const logger = pino({ level: 'silent' });
  const makeWASocket = baileys.makeWASocket || baileys.default;

  const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);

  let version;
  try {
    const ultima = await baileys.fetchLatestBaileysVersion({ timeout: 5000 });
    version = ultima && ultima.version;
  } catch (_) {
    version = undefined; // usa a versão embutida no pacote
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: state.creds,
      keys: baileys.makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: baileys.Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false, // não "rouba" as notificações do celular
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  return { sock, salvarCreds: saveCreds, DisconnectReason: baileys.DisconnectReason };
}

function criarGerenciador({
  criarSocket = criarSocketBaileys,
  authDir = './auth',
  fila,
  log = () => {},
  agora = Date.now,
  dormir = dormirReal,
  gerarQr = (texto) => require('qrcode').toDataURL(texto, { margin: 2, width: 320 }),
  existeCredenciais = (dir) => fs.existsSync(path.join(dir, 'creds.json')),
  removerCredenciais = (dir) => fs.promises.rm(dir, { recursive: true, force: true }),
  backoffBaseMs = 1000,
  backoffMaxMs = 60000,
  digitacaoMs = (texto) => Math.min(4000, 800 + String(texto || '').length * 25),
  timeoutEnvioMs = 90000,
  timeoutConsultaMs = 20000,
  timeoutLogoutMs = 5000,
} = {}) {
  if (!fila) throw new Error('fila é obrigatória');

  let estado = 'closed';
  let desde = null;
  let numero = null;
  let qrBruto = null;
  let qrCache = { bruto: null, url: null };
  let sock = null;
  let motivos = MOTIVOS_PADRAO;
  let geracao = 0; // invalida callbacks de sockets antigos
  let tentativas = 0; // falhas seguidas, para o backoff
  let limpeza = Promise.resolve(); // exclusão de credenciais em andamento

  function mudarEstado(novo) {
    if (estado !== novo) log('info', `estado: ${estado} -> ${novo}`);
    estado = novo;
    desde = agora();
    if (novo !== 'qr') qrBruto = null;
    if (novo !== 'open') numero = null;
  }

  function fecharSocketAtual() {
    const s = sock;
    sock = null;
    if (!s) return;
    try {
      s.end(undefined);
    } catch (_) {
      /* já estava fechado */
    }
  }

  function numeroDoSocket(s) {
    const id = s && s.user && s.user.id;
    if (typeof id !== 'string') return null;
    const digitos = id.split('@')[0].split(':')[0].replace(/\D+/g, '');
    return digitos || null;
  }

  function atrasoBackoff(codigo) {
    if (codigo === motivos.restartRequired && tentativas <= 3) return 0; // normal logo após ler o QR
    return Math.min(backoffMaxMs, backoffBaseMs * 2 ** Math.max(0, tentativas - 1));
  }

  function agendarReconexao(minha, codigo) {
    tentativas += 1;
    const atraso = atrasoBackoff(codigo);
    mudarEstado('connecting');
    log('warn', `reconectando em ${atraso} ms (tentativa ${tentativas}, código ${codigo === undefined ? '?' : codigo})`);
    (async () => {
      await dormir(atraso);
      if (minha !== geracao) return; // /connect, /logout ou novo socket assumiu
      await abrirSocket();
    })().catch((erro) => log('error', `falha ao reconectar: ${erro && erro.message}`));
  }

  async function aoAtualizar(minha, update) {
    if (minha !== geracao) return;
    const { connection, lastDisconnect, qr } = update || {};

    if (qr) {
      qrBruto = qr;
      mudarEstado('qr');
    }

    if (connection === 'connecting' && estado !== 'qr') mudarEstado('connecting');

    if (connection === 'open') {
      tentativas = 0;
      numero = numeroDoSocket(sock);
      mudarEstado('open');
      log('info', `conectado${numero ? ' como ' + mascararNumero(numero) : ''}`);
      return;
    }

    if (connection === 'close') {
      const codigo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : undefined;
      const antes = estado;
      sock = null;

      if (codigo === motivos.loggedOut) {
        log('warn', 'sessão encerrada pelo WhatsApp (loggedOut); credenciais apagadas');
        geracao += 1;
        limpeza = Promise.resolve(removerCredenciais(authDir)).catch((e) => log('error', `erro ao apagar credenciais: ${e && e.message}`));
        await limpeza;
        tentativas = 0;
        mudarEstado('closed');
        return;
      }
      if (codigo === motivos.connectionReplaced) {
        log('warn', 'sessão substituída por outro login (connectionReplaced); aguardando /connect');
        geracao += 1;
        tentativas = 0;
        mudarEstado('closed');
        return;
      }
      if (codigo === motivos.forbidden) {
        log('error', 'WhatsApp recusou a conta (forbidden/403): possível bloqueio; não vou insistir');
        geracao += 1;
        mudarEstado('closed');
        return;
      }
      if (antes === 'qr' && codigo !== motivos.restartRequired) {
        log('warn', 'QR expirou sem leitura; aguardando /connect');
        geracao += 1;
        tentativas = 0;
        mudarEstado('closed');
        return;
      }
      agendarReconexao(minha, codigo);
    }
  }

  async function abrirSocket() {
    await limpeza;
    const minha = ++geracao;
    fecharSocketAtual();
    qrBruto = null;
    mudarEstado('connecting');

    let criado;
    try {
      criado = await criarSocket({ authDir });
    } catch (erro) {
      log('error', `falha ao criar socket: ${erro && erro.message}`);
      if (minha === geracao) agendarReconexao(minha, undefined);
      return;
    }
    if (minha !== geracao) {
      try {
        criado.sock.end(undefined);
      } catch (_) {
        /* ignora */
      }
      return;
    }

    motivos = { ...MOTIVOS_PADRAO, ...(criado.DisconnectReason || {}) };
    sock = criado.sock;
    sock.ev.on('creds.update', async () => {
      if (minha !== geracao) return;
      try {
        await criado.salvarCreds();
      } catch (erro) {
        log('error', `falha ao salvar credenciais: ${erro && erro.message}`);
      }
    });
    sock.ev.on('connection.update', (update) => {
      aoAtualizar(minha, update).catch((erro) => log('error', `erro no evento de conexão: ${erro && erro.message}`));
    });
  }

  async function iniciar() {
    if (existeCredenciais(authDir)) {
      log('info', 'credenciais encontradas; reconectando sozinho');
      await abrirSocket();
    } else {
      log('info', 'sem credenciais; aguardando /connect para parear');
    }
  }

  async function conectar() {
    if (estado === 'open') return;
    tentativas = 0;
    await abrirSocket();
  }

  async function logout() {
    geracao += 1; // invalida eventos do socket atual
    const s = sock;
    sock = null;
    if (s) {
      try {
        await comTimeout(s.logout(), timeoutLogoutMs, 'logout');
      } catch (_) {
        /* sem conexão: segue para apagar as credenciais locais */
      }
      try {
        s.end(undefined);
      } catch (_) {
        /* ignora */
      }
    }
    tentativas = 0;
    mudarEstado('closed');
    limpeza = Promise.resolve(removerCredenciais(authDir));
    try {
      await limpeza;
    } finally {
      limpeza = Promise.resolve();
    }
  }

  /** Encerra o socket sem deslogar (usado ao desligar o processo). */
  function encerrar() {
    geracao += 1;
    fecharSocketAtual();
  }

  /** Mesmo JSON do GET /status. O data URL do QR só é gerado aqui (sob demanda). */
  async function statusPublico() {
    const estadoAgora = estado;
    const bruto = qrBruto;
    let qr = null;
    if (estadoAgora === 'qr' && bruto) {
      if (qrCache.bruto !== bruto) qrCache = { bruto, url: await gerarQr(bruto) };
      qr = qrCache.url;
    }
    return {
      state: estadoAgora,
      numero: estadoAgora === 'open' ? numero : null,
      qr,
      desde,
    };
  }

  async function resolverJid(numeroLimpo) {
    const consulta = await comTimeout(sock.onWhatsApp(jidDoNumero(numeroLimpo)), timeoutConsultaMs, 'consulta onWhatsApp');
    const achado = Array.isArray(consulta) ? consulta.find((r) => r && r.exists) : null;
    if (!achado) throw new ErroEnvio(422, 'número sem WhatsApp');
    return achado.jid || jidDoNumero(numeroLimpo);
  }

  /**
   * Enfileira um envio. `numero` já normalizado (só dígitos, com 55).
   * `imagem` (opcional): { buffer, mimetype }.
   * Lança ErroEnvio (409/422/429) ou erro inesperado.
   */
  function enviar({ numero: numeroLimpo, texto, imagem }) {
    if (estado !== 'open' || !sock) return Promise.reject(new ErroEnvio(409, 'WhatsApp desconectado'));

    return fila
      .enfileirar(async () => {
        if (estado !== 'open' || !sock) throw new ErroEnvio(409, 'WhatsApp desconectado');
        const s = sock;
        const jid = await resolverJid(numeroLimpo);

        try {
          await s.sendPresenceUpdate('composing', jid);
          await dormir(digitacaoMs(texto));
        } catch (_) {
          /* presença é só cosmética; não impede o envio */
        }

        const conteudo = imagem
          ? { image: imagem.buffer, mimetype: imagem.mimetype, ...(texto ? { caption: texto } : {}) }
          : { text: texto };
        const resposta = await comTimeout(s.sendMessage(jid, conteudo), timeoutEnvioMs, 'envio');

        try {
          await s.sendPresenceUpdate('paused', jid);
        } catch (_) {
          /* ignora */
        }

        const id = resposta && resposta.key && resposta.key.id;
        if (!id) throw new Error('o WhatsApp não devolveu o id da mensagem');
        log('info', `mensagem enviada para ${mascararNumero(numeroLimpo)}${imagem ? ' (com imagem)' : ''}`);
        return id;
      })
      .catch((erro) => {
        if (erro instanceof ErroFilaCheia) throw new ErroEnvio(429, 'fila de envio cheia, tente novamente em instantes');
        throw erro;
      });
  }

  return {
    iniciar,
    conectar,
    logout,
    encerrar,
    statusPublico,
    enviar,
    get estado() {
      return estado;
    },
  };
}

module.exports = { criarGerenciador, criarSocketBaileys, ErroEnvio, MOTIVOS_PADRAO };
