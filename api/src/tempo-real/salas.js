// ============================================================
// Estado das salas, no Redis
//
// Aqui mora o que a partida sabe sobre si: qual quiz, quem é o
// apresentador, em que fase está e quem entrou.
//
// Por que no Redis e não em memória do processo:
//
//   - Reiniciar a API no meio de uma partida não pode zerar o
//     placar de 40 pessoas. Com `--watch` ligado, isso aconteceria
//     toda vez que você salvasse um arquivo.
//   - Quando o sistema rodar em mais de uma instância, os
//     jogadores da mesma sala podem cair em servidores
//     diferentes. Memória de processo não é compartilhada.
//
// Por que no Redis e não no Postgres: esse estado muda a cada
// segundo e some quando o jogo acaba. O que merece disco é o
// resultado final, e isso é a fase 5.
//
// Todas as chaves têm prazo de validade. Sala abandonada — e vai
// haver muita, porque ninguém "fecha" uma sala, as pessoas só
// fecham a aba — desaparece sozinha.
// ============================================================

import { redis } from "../redis.js";

// 6 horas. Generoso de propósito: é melhor uma sala esquecida
// ocupar memória por uma tarde do que uma apresentação longa
// morrer no meio porque o prazo era curto.
export const VALIDADE_SEGUNDOS = 6 * 60 * 60;

const chaveSala = (codigo) => `sala:${codigo}`;
const chaveJogadores = (codigo) => `sala:${codigo}:jogadores`;

// Quantas pessoas cabem numa sala. Limite existe para o broadcast
// não virar um problema: cada resposta recebida gera uma mensagem
// para todo mundo, então o custo cresce com o quadrado do número
// de jogadores.
export const MAX_JOGADORES = 200;

/**
 * Cria a sala. O código já vem pronto de quem chamou, porque é
 * ele que trata a colisão (ver rotas/salas.js).
 *
 * Devolve false se o código já estiver em uso.
 */
export async function criar(codigo, { quizId, apresentadorId, titulo }) {
  // HSETNX grava só se a chave ainda não tiver aquele campo, numa
  // operação atômica. É o mesmo raciocínio do UNIQUE do banco:
  // duas requisições simultâneas com o mesmo código sorteado não
  // podem criar duas salas — uma das duas precisa perder.
  const criou = await redis.hsetnx(chaveSala(codigo), "quiz_id", String(quizId));

  if (criou === 0) return false;

  await redis
    .multi()
    .hset(chaveSala(codigo), {
      apresentador_id: String(apresentadorId),
      titulo,
      fase: "aguardando",
      criada_em: new Date().toISOString()
    })
    .expire(chaveSala(codigo), VALIDADE_SEGUNDOS)
    .exec();

  return true;
}

/** Devolve os dados da sala, ou null se ela não existe (ou expirou). */
export async function ler(codigo) {
  const dados = await redis.hgetall(chaveSala(codigo));

  // hgetall de chave inexistente devolve um objeto VAZIO, não
  // null. Confundir os dois é um erro clássico com Redis.
  if (!dados || Object.keys(dados).length === 0) return null;

  return {
    codigo,
    quizId: Number(dados.quiz_id),
    apresentadorId: Number(dados.apresentador_id),
    titulo: dados.titulo,
    fase: dados.fase,
    criadaEm: dados.criada_em
  };
}

export async function existe(codigo) {
  return (await redis.exists(chaveSala(codigo))) === 1;
}

/**
 * Entra na sala.
 *
 * Devolve { ok: true } ou { ok: false, motivo }.
 *
 * O apelido é a identidade do jogador na partida, então precisa
 * ser único dentro dela — duas "Ana" no placar não dizem a
 * ninguém quem ganhou.
 */
export async function entrar(codigo, { jogadorId, apelido }) {
  if (!(await existe(codigo))) return { ok: false, motivo: "sala-inexistente" };

  const jogadores = await redis.hgetall(chaveJogadores(codigo));

  if (Object.keys(jogadores).length >= MAX_JOGADORES) {
    return { ok: false, motivo: "sala-cheia" };
  }

  const repetido = Object.entries(jogadores).some(
    ([id, nome]) => id !== jogadorId && nome.toLowerCase() === apelido.toLowerCase()
  );

  if (repetido) return { ok: false, motivo: "apelido-em-uso" };

  await redis
    .multi()
    .hset(chaveJogadores(codigo), jogadorId, apelido)
    .expire(chaveJogadores(codigo), VALIDADE_SEGUNDOS)
    .exec();

  return { ok: true };
}

export async function sair(codigo, jogadorId) {
  await redis.hdel(chaveJogadores(codigo), jogadorId);
}

/** Lista de jogadores, em ordem alfabética para a tela não dançar. */
export async function listarJogadores(codigo) {
  const jogadores = await redis.hgetall(chaveJogadores(codigo));

  return Object.entries(jogadores)
    .map(([id, apelido]) => ({ id, apelido }))
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
}

export async function mudarFase(codigo, fase) {
  await redis.hset(chaveSala(codigo), "fase", fase);
}

/** Apaga a sala e tudo dela. Usado quando o apresentador encerra. */
export async function encerrar(codigo) {
  await redis.del(chaveSala(codigo), chaveJogadores(codigo));
}
