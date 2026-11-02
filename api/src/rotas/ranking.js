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
 * Empate fica com quem chegou ao total primeiro.
 */
router.get("/hoje", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.nome,
              SUM(r.pontos)::int AS pontos,
              COUNT(*)::int AS partidas
         FROM resultados r
         JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.terminado_em >= date_trunc('day', now())
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
