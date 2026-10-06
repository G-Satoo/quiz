// ============================================================
// Conexão com o Redis
//
// Três trabalhos neste projeto:
//
//   sessao:<token> -> usuário    login do apresentador, revogável
//   limite:<chave>               rate limit
//   sala:<codigo>                estado da partida ao vivo
//
// E, a partir da fase 3, também o pub/sub: quando o sistema roda
// em mais de uma instância, dois jogadores da mesma sala podem
// estar conectados em servidores diferentes. O servidor que
// recebe uma resposta publica o evento no Redis, e o outro
// repassa para os WebSockets que ele atende.
//
// Por que o estado da sala fica aqui e não no Postgres: durante a
// partida ele muda a cada segundo e a cada resposta, e some
// quando o jogo acaba. Gravar isso em disco seria desperdício.
// O que merece o Postgres é o resultado final.
// ============================================================

import Redis from "ioredis";
import "dotenv/config";

export const URL_REDIS = process.env.REDIS_URL || "redis://localhost:6382";

/**
 * Cria uma conexão nova.
 *
 * O BullMQ exige conexões separadas das suas (um cliente que está
 * bloqueado esperando trabalho na fila não consegue responder a um
 * GET de cache no meio), então não dá para ter só uma global.
 *
 * maxRetriesPerRequest: null é exigência do BullMQ — com um número,
 * ele desiste de comandos bloqueantes que são justamente como o
 * worker espera por trabalho.
 */
export function criarConexaoRedis(opcoes = {}) {
  return new Redis(URL_REDIS, {
    maxRetriesPerRequest: null,
    // Sem isso o ioredis enfileira comandos enquanto está sem
    // conexão e eles só falham lá na frente, mascarando um Redis
    // fora do ar como se fosse lentidão.
    enableOfflineQueue: false,
    ...opcoes
  });
}

// A conexão de uso geral da API (cache, sessão, rate limit).
export const redis = criarConexaoRedis();

// Sem este handler, um erro de conexão derruba o processo inteiro.
// O Redis aqui é auxiliar: se ele cair, o redirecionamento ainda
// funciona indo direto ao Postgres (ver servicos/cache.js).
redis.on("error", (erro) => {
  console.error("Redis:", erro.message);
});
