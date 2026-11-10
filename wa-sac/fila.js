'use strict';

/**
 * Fila SERIAL de envios com intervalo mínimo + jitter (anti-banimento).
 *
 * - Uma tarefa por vez, na ordem de chegada.
 * - Entre o FIM de uma tarefa e o INÍCIO da próxima passa pelo menos
 *   intervaloMinMs * (1 + jitter * aleatorio()), ou seja, de 100% a 140% do intervalo.
 * - A primeira tarefa (após ficar ociosa há tempo suficiente) não espera.
 * - "Pendentes" = aguardando + a que está em execução. Se já houver `limite`
 *   pendentes, a próxima é recusada com ErroFilaCheia.
 *
 * Relógio (`agora`), espera (`dormir`) e aleatoriedade (`aleatorio`) são injetáveis.
 */

class ErroFilaCheia extends Error {
  constructor(limite) {
    super(`fila de envio cheia (limite de ${limite} pendentes)`);
    this.name = 'ErroFilaCheia';
    this.limite = limite;
  }
}

const dormirReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function criarFila({
  intervaloMinMs = 5000,
  jitter = 0.4,
  limite = 20,
  agora = Date.now,
  dormir = dormirReal,
  aleatorio = Math.random,
} = {}) {
  const itens = [];
  let rodando = false;
  let pendentes = 0;
  let ultimoFim = null;

  async function laco() {
    if (rodando) return;
    rodando = true;
    try {
      while (itens.length > 0) {
        const item = itens.shift();
        try {
          if (ultimoFim !== null) {
            const alvo = intervaloMinMs * (1 + jitter * aleatorio());
            const espera = alvo - (agora() - ultimoFim);
            if (espera > 0) await dormir(espera);
          }
          item.resolve(await item.tarefa());
        } catch (erro) {
          item.reject(erro);
        } finally {
          ultimoFim = agora();
          pendentes -= 1;
        }
      }
    } finally {
      rodando = false;
    }
  }

  function enfileirar(tarefa) {
    if (pendentes >= limite) return Promise.reject(new ErroFilaCheia(limite));
    return new Promise((resolve, reject) => {
      pendentes += 1;
      itens.push({ tarefa, resolve, reject });
      laco();
    });
  }

  return {
    enfileirar,
    pendentes: () => pendentes,
    limite,
  };
}

module.exports = { criarFila, ErroFilaCheia };
