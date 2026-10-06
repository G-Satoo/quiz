// ============================================================
// Sessões
//
// Login sem JWT: o cookie carrega só um token aleatório, e quem
// sabe o que esse token significa é o Redis.
//
// Por que não JWT: um JWT é auto-suficiente — o servidor confere
// a assinatura e acredita. Isso significa que não dá para
// invalidar um antes de expirar. "Sair de todos os dispositivos",
// banir uma conta, derrubar a sessão depois de trocar a senha:
// nada disso funciona sem uma lista de bloqueio no servidor — e
// aí você já tem o estado que o JWT prometia evitar.
//
// Aqui apagar a chave do Redis encerra a sessão na hora. O preço
// é uma ida ao Redis por requisição autenticada, que custa menos
// de um milissegundo.
// ============================================================

import { randomBytes } from "node:crypto";
import { redis } from "../redis.js";

const PREFIXO = "sessao:";

// Prefixo da lista de sessões de cada usuário, para conseguir
// encerrar todas de uma vez sem varrer o Redis inteiro (o comando
// KEYS trava o servidor num banco grande — nunca em produção).
const PREFIXO_USUARIO = "sessoes-do-usuario:";

export const TTL_PADRAO = Number(process.env.SESSAO_TTL) || 60 * 60 * 24 * 7;

export const NOME_COOKIE = "quiz_sessao";

/**
 * Cria uma sessão e devolve o token que vai no cookie.
 *
 * 32 bytes aleatórios: o token é a única coisa que separa um
 * desconhecido da conta, então precisa ser impossível de adivinhar
 * ou de enumerar.
 */
export async function criarSessao(usuarioId, ttl = TTL_PADRAO) {
  const token = randomBytes(32).toString("base64url");

  // Uma transação: as duas chaves entram juntas ou nenhuma entra.
  // Uma sessão que existe mas não está na lista do usuário
  // sobreviveria a um "sair de todos os dispositivos".
  await redis
    .multi()
    .set(PREFIXO + token, String(usuarioId), "EX", ttl)
    .sadd(PREFIXO_USUARIO + usuarioId, token)
    .expire(PREFIXO_USUARIO + usuarioId, ttl)
    .exec();

  return token;
}

/**
 * Devolve o id do usuário dono do token, ou null.
 *
 * Renova o TTL a cada uso: a sessão expira por inatividade, não
 * no meio do trabalho de quem está usando o sistema agora.
 */
export async function lerSessao(token) {
  if (!token) return null;

  const valor = await redis.get(PREFIXO + token);
  if (valor === null) return null;

  await redis.expire(PREFIXO + token, TTL_PADRAO);

  return Number(valor);
}

export async function encerrarSessao(token) {
  if (!token) return;

  const usuarioId = await redis.get(PREFIXO + token);

  await redis.del(PREFIXO + token);

  if (usuarioId !== null) {
    await redis.srem(PREFIXO_USUARIO + usuarioId, token);
  }
}

/**
 * Encerra todas as sessões de um usuário. É o que deve rodar
 * depois de uma troca de senha.
 */
export async function encerrarSessoesDoUsuario(usuarioId) {
  const tokens = await redis.smembers(PREFIXO_USUARIO + usuarioId);

  if (tokens.length > 0) {
    await redis.del(...tokens.map((token) => PREFIXO + token));
  }

  await redis.del(PREFIXO_USUARIO + usuarioId);
}

/**
 * Opções do cookie, num lugar só para não divergirem entre o
 * login (que cria) e o logout (que apaga) — se divergirem, o
 * navegador trata como outro cookie e o logout não apaga nada.
 *
 *   httpOnly: JavaScript da página não lê o cookie. Sem isso, um
 *             XSS em qualquer canto do painel rouba a sessão.
 *   sameSite: o cookie não viaja em requisição vinda de outro
 *             site, que é a defesa contra CSRF.
 *   secure:   só trafega em HTTPS. Falso em desenvolvimento
 *             porque localhost é http.
 */
export function opcoesCookie() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SEGURO === "true",
    maxAge: TTL_PADRAO * 1000, // aqui é em milissegundos
    path: "/"
  };
}
