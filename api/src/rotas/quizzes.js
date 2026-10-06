// ============================================================
// Rotas de quizzes
// Prefixo: /api/quizzes  (todas exigem login)
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { lerInteiro, validarTitulo, validarPerguntas } from "../util/validacao.js";

const router = Router();

router.use(exigirLogin);

/** Lê o :id da URL. Devolve null se não for um inteiro válido. */
function lerId(valor) {
  return lerInteiro(valor, { padrao: null, minimo: 1, maximo: 2147483647 });
}

/**
 * GET /api/quizzes
 *
 * Lista os quizzes do usuário com a contagem de perguntas — é o
 * que a tela de lista mostra, e evita o front ter que buscar
 * cada quiz inteiro só para contar.
 */
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.id, q.titulo, q.descricao, q.criado_em,
              (SELECT COUNT(*) FROM perguntas p WHERE p.quiz_id = q.id)::int AS perguntas
         FROM quizzes q
        WHERE q.usuario_id = $1
        ORDER BY q.criado_em DESC`,
      [req.usuarioId]
    );

    res.json({ quizzes: rows });
  } catch (erro) {
    next(erro);
  }
});

/**
 * GET /api/quizzes/:id
 *
 * O quiz inteiro: perguntas e alternativas, na ordem.
 *
 * São duas consultas e uma montagem em JavaScript, em vez de um
 * JOIN só. Com JOIN, um quiz de 10 perguntas com 4 alternativas
 * cada volta em 40 linhas repetindo o enunciado 4 vezes — e o
 * código para remontar a árvore a partir disso é pior do que
 * este. Duas idas ao banco custam menos que isso.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rows: quizzes } = await pool.query(
      `SELECT id, titulo, descricao, criado_em
         FROM quizzes
        WHERE id = $1 AND usuario_id = $2`,
      [id, req.usuarioId]
    );

    // 404 e não 403: dizer "existe, mas não é seu" já entrega que
    // aquele id existe. Para quem não é dono, o quiz não existe.
    if (quizzes.length === 0) {
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    const { rows: linhas } = await pool.query(
      `SELECT p.id, p.ordem, p.enunciado, p.segundos,
              a.id AS alternativa_id, a.ordem AS alternativa_ordem,
              a.texto, a.correta
         FROM perguntas p
         LEFT JOIN alternativas a ON a.pergunta_id = p.id
        WHERE p.quiz_id = $1
        ORDER BY p.ordem, a.ordem`,
      [id]
    );

    // LEFT JOIN acima: uma pergunta sem alternativa nenhuma (que
    // não deveria existir, mas pode aparecer com dado inserido na
    // mão) continua aparecendo, em vez de sumir do resultado.
    const perguntas = [];
    let atual = null;

    for (const linha of linhas) {
      if (!atual || atual.id !== linha.id) {
        atual = {
          id: linha.id,
          ordem: linha.ordem,
          enunciado: linha.enunciado,
          segundos: linha.segundos,
          alternativas: []
        };
        perguntas.push(atual);
      }

      if (linha.alternativa_id !== null) {
        atual.alternativas.push({
          id: linha.alternativa_id,
          ordem: linha.alternativa_ordem,
          texto: linha.texto,
          correta: linha.correta
        });
      }
    }

    res.json({ quiz: { ...quizzes[0], perguntas } });
  } catch (erro) {
    next(erro);
  }
});

/**
 * POST /api/quizzes
 * body: { titulo, descricao? }
 *
 * Cria o quiz vazio. As perguntas entram depois, pelo PUT — é
 * como o editor funciona: você nomeia, depois preenche.
 */
router.post("/", async (req, res, next) => {
  try {
    const { titulo, descricao } = req.body ?? {};

    const erro = validarTitulo(titulo);
    if (erro) return res.status(400).json({ erro });

    const { rows } = await pool.query(
      `INSERT INTO quizzes (usuario_id, titulo, descricao)
       VALUES ($1, $2, $3)
       RETURNING id, titulo, descricao, criado_em`,
      [req.usuarioId, titulo.trim(), descricao?.trim() || null]
    );

    res.status(201).json({ quiz: { ...rows[0], perguntas: [] } });
  } catch (erro) {
    next(erro);
  }
});

/**
 * PATCH /api/quizzes/:id
 * body: { titulo?, descricao? }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { titulo, descricao } = req.body ?? {};

    if (titulo !== undefined) {
      const erro = validarTitulo(titulo);
      if (erro) return res.status(400).json({ erro });
    }

    // COALESCE($1, coluna): parâmetro nulo mantém o valor atual.
    // Evita montar um SQL diferente para cada combinação de campos.
    const { rows } = await pool.query(
      `UPDATE quizzes
          SET titulo    = COALESCE($1, titulo),
              descricao = COALESCE($2, descricao)
        WHERE id = $3 AND usuario_id = $4
        RETURNING id, titulo, descricao, criado_em`,
      [titulo?.trim() ?? null, descricao?.trim() ?? null, id, req.usuarioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    res.json({ quiz: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

/**
 * DELETE /api/quizzes/:id
 *
 * As perguntas e alternativas vão junto, pelo ON DELETE CASCADE.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rowCount } = await pool.query(
      "DELETE FROM quizzes WHERE id = $1 AND usuario_id = $2",
      [id, req.usuarioId]
    );

    if (rowCount === 0) return res.status(404).json({ erro: "Quiz não encontrado" });

    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

/**
 * PUT /api/quizzes/:id/perguntas
 * body: { perguntas: [{ enunciado, segundos, alternativas: [{ texto, correta }] }] }
 *
 * Substitui TODAS as perguntas do quiz de uma vez.
 *
 * Por que substituir tudo em vez de ter rotas separadas para
 * criar, editar e apagar cada pergunta: o editor é uma tela só,
 * onde a pessoa mexe em várias perguntas, reordena e salva no
 * fim. Mandar o conjunto inteiro faz o estado da tela e o estado
 * do banco serem a mesma coisa — não existe "salvei a pergunta 3
 * mas não a 4".
 *
 * O preço é que isso só funciona dentro de uma TRANSAÇÃO.
 */
router.put("/:id/perguntas", async (req, res, next) => {
  const id = lerId(req.params.id);
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const { perguntas } = req.body ?? {};

  const erro = validarPerguntas(perguntas);
  if (erro) return res.status(400).json({ erro });

  // Pega UMA conexão do pool e segura.
  //
  // Isso é obrigatório numa transação: BEGIN, os comandos e
  // COMMIT precisam acontecer todos na mesma conexão. Se usasse
  // `pool.query` direto, cada comando poderia sair por uma
  // conexão diferente — e o banco veria um BEGIN sozinho numa, um
  // INSERT solto noutra.
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    // O dono é conferido DENTRO da transação. Fora dela, alguém
    // poderia apagar o quiz entre a checagem e a escrita.
    const { rows: donos } = await cliente.query(
      "SELECT id FROM quizzes WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
      [id, req.usuarioId]
    );

    if (donos.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    // Apaga tudo e reinsere. As alternativas somem junto pelo
    // CASCADE. Parece desperdício, mas é o que torna o resultado
    // igual ao que a tela mostra — tentar descobrir o que mudou
    // (o "diff") é mais código e mais chance de erro, para um
    // conjunto de no máximo 50 perguntas.
    await cliente.query("DELETE FROM perguntas WHERE quiz_id = $1", [id]);

    for (const [posicao, pergunta] of perguntas.entries()) {
      const { rows: criadas } = await cliente.query(
        `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [id, posicao, pergunta.enunciado.trim(), pergunta.segundos]
      );

      const perguntaId = criadas[0].id;

      for (const [ordem, alternativa] of pergunta.alternativas.entries()) {
        await cliente.query(
          `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
           VALUES ($1, $2, $3, $4)`,
          [perguntaId, ordem, alternativa.texto.trim(), alternativa.correta === true]
        );
      }
    }

    // Até aqui, nada do que foi feito existe para mais ninguém.
    // É o COMMIT que torna tudo visível, de uma vez.
    await cliente.query("COMMIT");

    res.json({ ok: true, perguntas: perguntas.length });
  } catch (erro) {
    // Qualquer falha no meio desfaz TUDO — inclusive o DELETE lá
    // de cima. Sem isso, um erro na décima pergunta deixaria o
    // quiz com as nove primeiras e o resto perdido: pior do que
    // ter falhado inteiro.
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    // Devolve a conexão ao pool, sempre. Esquecer isto é um
    // vazamento: depois de algumas requisições o pool esvazia e a
    // aplicação trava esperando conexão que nunca volta.
    cliente.release();
  }
});

export default router;
