'use strict';

// Utilitários de teste: socket falso do Baileys, fábrica falsa e relógio falso.
// (Este arquivo não tem testes; só é importado pelos *.test.js.)

const { EventEmitter } = require('node:events');

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function esperar(condicao, { tentativas = 200 } = {}) {
  for (let i = 0; i < tentativas; i += 1) {
    if (condicao()) return;
    await tick();
  }
  throw new Error('condição não foi atendida a tempo');
}

function criarSocketFalso({ id = '5519999998888:12@s.whatsapp.net', existe = () => true, bloqueio = null } = {}) {
  const emissor = new EventEmitter();
  let contador = 0;
  const sock = {
    ev: { on: (nome, fn) => emissor.on(nome, fn) },
    user: { id },
    chamadas: [], // ordem de tudo que o gerenciador pediu ao socket
    enviados: [],
    finalizado: 0,
    deslogado: 0,
    emitir: (nome, dados) => emissor.emit(nome, dados),
    async onWhatsApp(jid) {
      sock.chamadas.push(['onWhatsApp', jid]);
      const resultado = existe(jid);
      if (!resultado) return [];
      return [{ jid: typeof resultado === 'string' ? resultado : jid, exists: true }];
    },
    async sendPresenceUpdate(tipo, jid) {
      sock.chamadas.push(['presenca', tipo, jid]);
    },
    async sendMessage(jid, conteudo) {
      sock.chamadas.push(['sendMessage', jid]);
      if (bloqueio) await bloqueio;
      contador += 1;
      sock.enviados.push({ jid, conteudo });
      return { key: { id: `MSG${contador}` } };
    },
    async logout() {
      sock.deslogado += 1;
    },
    end() {
      sock.finalizado += 1;
    },
  };
  return sock;
}

function criarFabricaFalsa(opcoesSocket = {}) {
  const fabrica = {
    criados: [],
    falhas: 0, // quantas próximas criações devem falhar
    async criarSocket() {
      if (fabrica.falhas > 0) {
        fabrica.falhas -= 1;
        throw new Error('falha simulada');
      }
      const sock = criarSocketFalso(opcoesSocket);
      const item = { sock, salvou: 0, salvarCreds: async () => { item.salvou += 1; } };
      fabrica.criados.push(item);
      return item;
    },
    get ultimo() {
      return fabrica.criados[fabrica.criados.length - 1];
    },
  };
  return fabrica;
}

function erroDeDesconexao(codigo) {
  const erro = new Error('desconectado');
  erro.output = { statusCode: codigo };
  return erro;
}

function criarDormirFalso() {
  const esperas = [];
  const dormir = async (ms) => {
    esperas.push(ms);
  };
  dormir.esperas = esperas;
  return dormir;
}

module.exports = { tick, esperar, criarSocketFalso, criarFabricaFalsa, erroDeDesconexao, criarDormirFalso };
