// ============================================================
// Rotas de moderação (administrador)
// Prefixo: /api/moderacao
//
// A fila do que precisa de um humano: o que a IA não teve certeza
// e o que foi denunciado. A IA é a primeira barreira; isto é para
// o que passou por ela e não deveria, ou para o que ela parou e
// talvez não precisasse.
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirAdmin, exigirLogin } from "../middlewares/autenticacao.js";
import { lerInteiro } from "../util/validacao.js";

const router = Router();

router.use(exigirLogin, exigirAdmin);

/**
 * GET /api/moderacao/fila
 *
 * Quizzes em revisão e quizzes publicados com denúncia aberta,
 * com tudo que o administrador precisa para decidir sem abrir
 * outra tela: o conteúdo inteiro (bloqueadas incluídas, que podem
 * voltar a qualquer momento), as denúncias e o porquê de estar ali.
 *
 * Primeiro os que estão fora do ar esperando decisão; depois os
 * publicados denunciados, que ainda estão visíveis.
 */
router.get("/fila", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.id, q.titulo, q.descricao, q.categoria,
              -- A mesma capa que a IA viu e que o público veria.
              (CASE WHEN EXISTS (SELECT 1 FROM capas c WHERE c.quiz_id = q.id)
                    THEN '/api/quizzes/' || q.id || '/capa?v=' || q.versao END) AS capa_url,
              q.situacao, q.moderacao_motivo, q.moderacao_por, q.versao,
              u.nome AS autor,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'motivo', d.motivo, 'detalhe', d.detalhe, 'criada_em', d.criada_em
                       ) ORDER BY d.criada_em)
                  FROM denuncias d
                 WHERE d.quiz_id = q.id AND d.resolvida_em IS NULL
              ), '[]') AS denuncias,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'enunciado', p.enunciado,
                         'ativa', p.ativa,
                         'alternativas', (
                           SELECT json_agg(json_build_object('texto', a.texto, 'correta', a.correta)
                                           ORDER BY a.ordem)
                             FROM alternativas a WHERE a.pergunta_id = p.id)
                       ) ORDER BY p.ativa DESC, p.ordem, p.id)
                  FROM perguntas p WHERE p.quiz_id = q.id
              ), '[]') AS perguntas
         FROM quizzes q
         LEFT JOIN usuarios u ON u.id = q.usuario_id
        WHERE q.situacao = 'revisao'
           OR EXISTS (SELECT 1 FROM denuncias d
                       WHERE d.quiz_id = q.id AND d.resolvida_em IS NULL)
        ORDER BY (q.situacao = 'revisao') DESC, q.moderacao_em ASC NULLS LAST`
    );

    res.json({ fila: rows });
  } catch (erro) {
    next(erro);
  }
});

/**
 * POST /api/moderacao/:id
 * body: { decisao: "publicar" | "recusar", motivo?, versao }
 *
 * Decide e encerra as denúncias abertas do quiz.
 *
 * A `versao` é a que o administrador LEU. Se o dono editou depois
 * disso, a decisão é recusada: aprovar seria aprovar um texto que
 * o administrador não viu. Mesma regra da análise da IA.
 */
router.post("/:id", async (req, res, next) => {
  const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const { decisao, motivo } = req.body ?? {};
  const versao = lerInteiro(req.body?.versao, { padrao: null, minimo: 0, maximo: 2147483647 });

  if (!["publicar", "recusar"].includes(decisao)) {
    return res.status(400).json({ erro: "Decisão inválida" });
  }
  if (versao === null) return res.status(400).json({ erro: "Informe a versão que você revisou" });

  // Recusar sem dizer por quê deixa o dono sem saber o que corrigir.
  const texto = typeof motivo === "string" ? motivo.trim().slice(0, 300) : "";
  if (decisao === "recusar" && !texto) {
    return res.status(400).json({ erro: "Diga ao autor o motivo da recusa" });
  }

  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    const { rowCount } = await cliente.query(
      `UPDATE quizzes
          SET situacao = $1,
              moderacao_motivo = $2,
              moderacao_por = 'admin',
              moderacao_em = now()
        WHERE id = $3 AND versao = $4`,
      [
        decisao === "publicar" ? "publicado" : "recusado",
        decisao === "publicar" ? texto || "Aprovado por um administrador." : texto,
        id,
        versao
      ]
    );

    if (rowCount === 0) {
      await cliente.query("ROLLBACK");

      const { rows } = await pool.query("SELECT 1 FROM quizzes WHERE id = $1", [id]);
      return rows.length === 0
        ? res.status(404).json({ erro: "Quiz não encontrado" })
        : res.status(409).json({ erro: "O autor editou o quiz depois que você abriu. Recarregue a fila." });
    }

    await cliente.query(
      "UPDATE denuncias SET resolvida_em = now() WHERE quiz_id = $1 AND resolvida_em IS NULL",
      [id]
    );

    await cliente.query("COMMIT");
    res.json({ quiz: { id, situacao: decisao === "publicar" ? "publicado" : "recusado" } });
  } catch (erro) {
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    cliente.release();
  }
});

export default router;
