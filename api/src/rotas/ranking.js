// ============================================================
// Rotas de ranking
// Prefixo: /api/ranking  (públicas, como o catálogo)
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";

const router = Router();

/**
 * GET /api/ranking/hoje
 *
 * Os dez jogadores COM CONTA que mais somaram pontos hoje.
 *
 * SÓ CONTA QUEM TEM CONTA
 *
 * Sem conta, o jogador é um apelido digitado na hora. Somar os
 * pontos de todos os "Ana" do dia juntaria pessoas diferentes num
 * total que não é de ninguém. Com conta a identidade é real, e
 * somar passa a ser honesto: é a mesma pessoa em várias partidas.
 * Quem joga anônimo continua jogando — só não aparece aqui.
 *
 * O nome mostrado é o da conta, não o apelido da partida: a mesma
 * pessoa pode ter entrado como "Ana" numa sala e "aninha" noutra.
 *
 * Só contam partidas de quiz publicado (aprovado pela moderação)
 * na hora em que foram jogadas, e que continua publicado.
 *
 * Empate fica com quem chegou ao total primeiro.
 */
router.get("/hoje", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.nome,
              (SELECT '/api/usuarios/' || f.usuario_id || '/foto?v=' || floor(extract(epoch FROM f.enviada_em))::bigint
                 FROM fotos_perfil f WHERE f.usuario_id = u.id) AS foto,
              SUM(r.pontos)::int AS pontos,
              COUNT(*)::int AS partidas
         FROM resultados r
         JOIN usuarios u ON u.id = r.usuario_id
         -- Quiz tirado do ar leva os pontos junto: se era ruim o
         -- bastante para sair do catálogo, não deveria ter rendido
         -- ranking a ninguém.
         JOIN quizzes q ON q.id = r.quiz_id AND q.situacao = 'publicado'
        WHERE r.terminado_em >= date_trunc('day', now())
          AND r.vale_ranking
        GROUP BY u.id, u.nome
       HAVING SUM(r.pontos) > 0
        ORDER BY pontos DESC, MAX(r.terminado_em) ASC
        LIMIT 10`
    );

    res.json({ jogadores: rows });
  } catch (erro) {
    next(erro);
  }
});

export default router;
