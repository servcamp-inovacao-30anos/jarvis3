'use strict';

/**
 * Servidor HTTP (módulo nativo) do microsserviço de WhatsApp do SAC.
 *
 * Dois modos:
 *   - nuvem: exige WA_API_KEY (cabeçalho x-api-key) em todas as rotas, menos /health;
 *   - local (PC do SAC, como o VocalTask): sem chave. Só escuta em 127.0.0.1 e só aceita a página do sistema
 *     (WA_ORIGENS, ex.: https://meu-sistema.com.br). O QR code aparece direto na tela do sistema.
 *
 * Rotas:
 *   GET  /health   -> { ok: true }
 *   GET  /status   -> { state, numero, qr, desde }
 *   POST /connect  -> inicia/reinicia o pareamento; devolve o /status
 *   POST /logout   -> desconecta, apaga credenciais; devolve o /status
 *   POST /send     -> { numero, texto, imagem? } -> { ok, id }
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { normalizarNumero } = require('./numero');
const { criarFila } = require('./fila');
const { criarGerenciador, ErroEnvio } = require('./whatsapp');

const MAX_CORPO_BYTES = 8 * 1024 * 1024;
const MAX_IMAGEM_BYTES = 5 * 1024 * 1024;
const MIMETYPES_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIN_TAMANHO_CHAVE = 16;

const ROTAS = {
  '/status': ['GET'],
  '/connect': ['POST'],
  '/logout': ['POST'],
  '/send': ['POST'],
};

class ErroHttp extends Error {
  constructor(status, motivo) {
    super(motivo);
    this.status = status;
    this.motivo = motivo;
  }
}

function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto)).digest();
}

/** Comparação em tempo constante (hash dos dois lados para igualar o tamanho). */
function chaveConfere(recebida, esperada) {
  if (typeof recebida !== 'string' || recebida.length === 0) return false;
  return crypto.timingSafeEqual(sha256(recebida), sha256(esperada));
}

function responderJson(res, status, corpo, extras = {}) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extras,
  });
  res.end(texto);
}

function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > limite) {
      reject(new ErroHttp(413, 'corpo acima de 8 MB'));
      return;
    }
    const pedacos = [];
    let total = 0;
    let estourou = false;
    req.on('data', (pedaco) => {
      if (estourou) return;
      total += pedaco.length;
      if (total > limite) {
        estourou = true;
        pedacos.length = 0;
        reject(new ErroHttp(413, 'corpo acima de 8 MB'));
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => {
      if (!estourou) resolve(Buffer.concat(pedacos));
    });
    req.on('error', (erro) => {
      if (!estourou) reject(erro);
    });
  });
}

function lerJson(buffer) {
  if (buffer.length === 0) throw new ErroHttp(400, 'corpo JSON ausente');
  let valor;
  try {
    valor = JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    throw new ErroHttp(400, 'JSON inválido');
  }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErroHttp(400, 'o corpo deve ser um objeto JSON');
  }
  return valor;
}

/** Valida o corpo do POST /send. Lança ErroHttp(422) em qualquer problema. */
function validarEnvio(corpo) {
  const num = normalizarNumero(corpo.numero);
  if (!num.ok) throw new ErroHttp(422, num.motivo);

  let texto = '';
  if (corpo.texto !== undefined && corpo.texto !== null) {
    if (typeof corpo.texto !== 'string') throw new ErroHttp(422, 'texto deve ser uma string');
    texto = corpo.texto.trim();
  }

  let imagem = null;
  if (corpo.imagem !== undefined && corpo.imagem !== null) {
    const img = corpo.imagem;
    if (typeof img !== 'object' || Array.isArray(img)) throw new ErroHttp(422, 'imagem inválida');
    if (typeof img.mimetype !== 'string' || !MIMETYPES_IMAGEM.has(img.mimetype.toLowerCase())) {
      throw new ErroHttp(422, 'mimetype da imagem deve ser image/jpeg, image/png ou image/webp');
    }
    if (typeof img.base64 !== 'string' || img.base64.length === 0) {
      throw new ErroHttp(422, 'imagem.base64 ausente');
    }
    if (img.nome !== undefined && img.nome !== null && typeof img.nome !== 'string') {
      throw new ErroHttp(422, 'imagem.nome deve ser uma string');
    }
    const limpo = img.base64.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
    if (limpo.length > Math.ceil((MAX_IMAGEM_BYTES * 4) / 3) + 8) {
      throw new ErroHttp(422, 'imagem acima de 5 MB');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw new ErroHttp(422, 'imagem.base64 inválido');
    const buffer = Buffer.from(limpo, 'base64');
    if (buffer.length === 0) throw new ErroHttp(422, 'imagem vazia');
    if (buffer.length > MAX_IMAGEM_BYTES) throw new ErroHttp(422, 'imagem acima de 5 MB');
    imagem = { buffer, mimetype: img.mimetype.toLowerCase() };
  }

  if (!texto && !imagem) throw new ErroHttp(422, 'informe texto ou imagem');
  return { numero: num.numero, texto, imagem };
}

function logPadrao(nivel, mensagem) {
  const linha = JSON.stringify({ t: new Date().toISOString(), nivel, msg: mensagem });
  (nivel === 'error' ? process.stderr : process.stdout).write(linha + '\n');
}

/**
 * Cria (sem iniciar a escuta) o servidor HTTP.
 * @param {{apiKey:string, gerenciador:object, log?:Function, maxCorpo?:number}} opcoes
 */
function normalizarOrigem(o) {
  return String(o || '').trim().replace(/\/+$/, '').toLowerCase();
}
function origemLocal(o) {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);
}
function hostLocal(h) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(h || ''));
}

function criarServidor({ apiKey, origens, gerenciador, log = () => {}, maxCorpo = MAX_CORPO_BYTES }) {
  const modoLocal = !apiKey && Array.isArray(origens) && origens.length > 0;
  const permitidas = new Set((origens || []).map(normalizarOrigem).filter(Boolean));
  if (!modoLocal && (typeof apiKey !== 'string' || apiKey.length < MIN_TAMANHO_CHAVE)) {
    throw new Error(`WA_API_KEY ausente ou curta demais (mínimo ${MIN_TAMANHO_CHAVE} caracteres)`);
  }
  const origemPermitida = (o) => {
    const n = normalizarOrigem(o);
    return permitidas.has(n) || origemLocal(n);
  };

  async function tratar(req, res) {
    if (modoLocal) {
      // só a página do sistema fala com o serviço: sem isso, qualquer site aberto no PC poderia mandar mensagens
      if (!hostLocal(req.headers.host)) return responderJson(res, 403, { ok: false, motivo: 'acesso recusado' });
      const origem = req.headers.origin;
      if (origem !== undefined) {
        if (!origemPermitida(origem)) return responderJson(res, 403, { ok: false, motivo: 'esta página não tem permissão para usar o WhatsApp do SAC' });
        res.setHeader('Access-Control-Allow-Origin', origem);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }
    let caminho;
    try {
      caminho = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      return responderJson(res, 400, { ok: false, motivo: 'URL inválida' });
    }

    if (caminho === '/health') {
      if (req.method !== 'GET') return responderJson(res, 405, { ok: false, motivo: 'método não permitido' }, { Allow: 'GET' });
      return responderJson(res, 200, { ok: true });
    }

    if (!modoLocal && !chaveConfere(req.headers['x-api-key'], apiKey)) {
      return responderJson(res, 401, { ok: false, motivo: 'api-key ausente ou inválida' });
    }

    const metodos = ROTAS[caminho];
    if (!metodos) return responderJson(res, 404, { ok: false, motivo: 'rota não encontrada' });
    if (!metodos.includes(req.method)) {
      return responderJson(res, 405, { ok: false, motivo: 'método não permitido' }, { Allow: metodos.join(', ') });
    }

    if (caminho === '/status') {
      return responderJson(res, 200, await gerenciador.statusPublico());
    }
    if (caminho === '/connect') {
      await gerenciador.conectar();
      return responderJson(res, 200, await gerenciador.statusPublico());
    }
    if (caminho === '/logout') {
      await gerenciador.logout();
      return responderJson(res, 200, await gerenciador.statusPublico());
    }

    // POST /send
    const corpo = lerJson(await lerCorpo(req, maxCorpo));
    const envio = validarEnvio(corpo);
    const id = await gerenciador.enviar(envio);
    return responderJson(res, 200, { ok: true, id });
  }

  const servidor = http.createServer((req, res) => {
    const inicio = Date.now();
    res.on('finish', () => {
      const caminho = String(req.url || '').split('?')[0];
      log('info', `${req.method} ${caminho} ${res.statusCode} ${Date.now() - inicio}ms`);
    });

    tratar(req, res).catch((erro) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (erro instanceof ErroHttp || erro instanceof ErroEnvio) {
        const extras = erro.status === 413 ? { Connection: 'close' } : {};
        responderJson(res, erro.status, { ok: false, motivo: erro.motivo }, extras);
        if (erro.status === 413) res.on('finish', () => req.destroy());
        return;
      }
      log('error', `erro inesperado em ${req.method} ${String(req.url || '').split('?')[0]}: ${erro && erro.name}: ${erro && erro.message}`);
      responderJson(res, 500, { ok: false, motivo: 'erro interno' });
    });
  });

  servidor.requestTimeout = 120000;
  servidor.headersTimeout = 20000;
  return servidor;
}

function lerConfig(env) {
  const apiKey = env.WA_API_KEY || '';
  const origens = String(env.WA_ORIGENS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const local = !apiKey && origens.length > 0;
  if (!local && apiKey.length < MIN_TAMANHO_CHAVE) {
    throw new Error(`WA_API_KEY ausente ou curta demais (mínimo ${MIN_TAMANHO_CHAVE} caracteres); no PC do SAC informe WA_ORIGENS (endereço do sistema)`);
  }
  const intervalo = env.WA_INTERVALO_MIN_MS === undefined || env.WA_INTERVALO_MIN_MS === '' ? 5000 : Number(env.WA_INTERVALO_MIN_MS);
  if (!Number.isFinite(intervalo) || intervalo < 0) throw new Error('WA_INTERVALO_MIN_MS inválido');
  const porta = env.PORT === undefined || env.PORT === '' ? (local ? 3939 : 3000) : Number(env.PORT);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error('PORT inválida');
  return {
    apiKey,
    origens,
    local,
    intervaloMinMs: intervalo,
    porta,
    host: local ? '127.0.0.1' : env.HOST || '0.0.0.0',
    authDir: env.WA_AUTH_DIR || './auth',
  };
}

async function main() {
  let config;
  try {
    config = lerConfig(process.env);
  } catch (erro) {
    logPadrao('error', erro.message);
    process.exit(1);
  }
  if (config.intervaloMinMs < 3000) {
    logPadrao('warn', 'WA_INTERVALO_MIN_MS abaixo de 3000: aumenta o risco de banimento');
  }

  const fila = criarFila({ intervaloMinMs: config.intervaloMinMs });
  const gerenciador = criarGerenciador({ authDir: config.authDir, fila, log: logPadrao });
  const servidor = criarServidor({ apiKey: config.apiKey, origens: config.origens, gerenciador, log: logPadrao });

  servidor.listen(config.porta, config.host, () => {
    logPadrao('info', `wa-sac ouvindo em ${config.host}:${config.porta}`);
  });
  gerenciador.iniciar().catch((erro) => logPadrao('error', `falha ao iniciar a conexão: ${erro && erro.message}`));

  let encerrando = false;
  const desligar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    logPadrao('info', `${sinal} recebido; encerrando`);
    gerenciador.encerrar();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => desligar('SIGTERM'));
  process.on('SIGINT', () => desligar('SIGINT'));
  process.on('unhandledRejection', (motivo) => {
    logPadrao('error', `promessa rejeitada sem tratamento: ${motivo && motivo.message ? motivo.message : String(motivo)}`);
  });
  process.on('uncaughtException', (erro) => {
    logPadrao('error', `exceção não capturada: ${erro && erro.message}`);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { criarServidor, validarEnvio, lerConfig, chaveConfere, MAX_CORPO_BYTES, MAX_IMAGEM_BYTES };
