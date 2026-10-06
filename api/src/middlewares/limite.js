// ============================================================
// Rate limit
//
// Conta requisições por chave (IP ou usuário) numa janela de
// tempo e barra quem passar do teto, com 429.
//
// O que isso protege, na prática:
//
//   - /api/sessoes: sem limite, testar senha vazada vira questão
//     de tempo de máquina.
//   - /api/links: um script criando links sem parar enche a
//     tabela e o Redis de graça.
//
// Implementação: janela fixa (INCR + EXPIRE). O ponto fraco
// conhecido é a virada — quem gasta o limite no fim de uma janela
// e de novo no início da seguinte faz o dobro em poucos segundos.
// Janela deslizante resolveria, ao custo de guardar o horário de
// cada requisição. Para barrar abuso o suficiente é este aqui, e
// são duas operações no Redis.
//
// O par INCR/EXPIRE vai num MULTI: se o processo morresse entre
// os dois comandos, a chave ficaria sem prazo de validade e a
// pessoa ficaria bloqueada para sempre.
// ============================================================

import { redis } from "../redis.js";

/**
 * @param {object} opcoes
 * @param {string} opcoes.nome     identifica o limite na chave do Redis
 * @param {number} opcoes.max      quantas requisições a janela permite
 * @param {number} opcoes.janela   tamanho da janela, em segundos
 * @param {function} [opcoes.chave] como identificar quem está chamando
 */
export function limitar({ nome, max, janela, chave = (req) => req.ip }) {
  return async function middlewareLimite(req, res, next) {
    const identificador = `limite:${nome}:${chave(req)}`;

    try {
      const resultado = await redis
        .multi()
        .incr(identificador)
        .expire(identificador, janela, "NX") // NX: só na primeira vez
        .exec();

      // exec() devolve [[erro, valor], ...] — o valor do INCR é o
      // primeiro par.
      const usadas = resultado[0][1];

      const restantes = Math.max(0, max - usadas);
      res.set("RateLimit-Limit", String(max));
      res.set("RateLimit-Remaining", String(restantes));

      if (usadas > max) {
        const faltando = await redis.ttl(identificador);

        // Retry-After é o cabeçalho padrão do 429 — um cliente bem
        // feito espera esse tempo em vez de martelar de novo.
        res.set("Retry-After", String(Math.max(faltando, 1)));

        return res.status(429).json({
          erro: "Muitas requisições. Tente de novo daqui a pouco.",
          tente_em_segundos: Math.max(faltando, 1)
        });
      }

      next();
    } catch (erro) {
      // Redis fora do ar: deixa passar. Um limitador quebrado não
      // pode derrubar o sistema inteiro junto — a escolha é entre
      // ficar sem proteção contra abuso por alguns minutos ou ficar
      // sem serviço nenhum.
      console.error("Rate limit indisponível:", erro.message);
      next();
    }
  };
}
