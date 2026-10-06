// ============================================================
// Testes das garantias do banco
//
// Aqui falamos direto com o Postgres, sem passar pela API. O
// assunto é o que o BANCO garante sozinho — as regras que
// continuam valendo mesmo que um bug futuro escape da validação
// da aplicação, ou que alguém insira dado na mão pelo Adminer.
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes, criarUsuario } from "../ajuda/banco.js";
import { pool } from "../../db/pool.js";

// Códigos de erro do Postgres. Conferimos o CÓDIGO e não o texto
// da mensagem, porque a mensagem muda com a versão e com o idioma
// do servidor.
const VIOLACAO_UNIQUE = "23505";
const VIOLACAO_CHECK = "23514";

let usuarioId;
let quizId;

before(prepararBanco);

beforeEach(async () => {
  await limpar();

  const usuario = await criarUsuario();
  usuarioId = usuario.id;

  const { rows } = await pool.query(
    "INSERT INTO quizzes (usuario_id, titulo) VALUES ($1, 'Teste') RETURNING id",
    [usuarioId]
  );
  quizId = rows[0].id;
});

after(encerrarConexoes);

async function criarPergunta(ordem = 0) {
  const { rows } = await pool.query(
    `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
     VALUES ($1, $2, 'Enunciado', 20) RETURNING id`,
    [quizId, ordem]
  );
  return rows[0].id;
}

describe("migrações", () => {
  it("criam todas as tabelas", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`
    );

    const tabelas = rows.map((l) => l.table_name);

    for (const esperada of ["alternativas", "migracoes", "perguntas", "quizzes", "usuarios"]) {
      assert.ok(tabelas.includes(esperada), `faltou a tabela ${esperada}`);
    }
  });
});

describe("perguntas", () => {
  it("não aceitam duas na mesma posição do mesmo quiz", async () => {
    // Sem isto, a ordem da partida dependeria de desempate
    // arbitrário do banco e mudaria de uma execução para outra.
    await criarPergunta(0);

    await assert.rejects(
      criarPergunta(0),
      (erro) => erro.code === VIOLACAO_UNIQUE
    );
  });

  it("aceitam a mesma posição em quizzes diferentes", async () => {
    await criarPergunta(0);

    const { rows } = await pool.query(
      "INSERT INTO quizzes (usuario_id, titulo) VALUES ($1, 'Outro') RETURNING id",
      [usuarioId]
    );

    await assert.doesNotReject(
      pool.query(
        `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
         VALUES ($1, 0, 'Enunciado', 20)`,
        [rows[0].id]
      )
    );
  });

  it("recusam tempo fora dos limites", async () => {
    for (const segundos of [1, 4, 301, 9999]) {
      await assert.rejects(
        pool.query(
          `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
           VALUES ($1, 99, 'Enunciado', $2)`,
          [quizId, segundos]
        ),
        (erro) => erro.code === VIOLACAO_CHECK,
        `${segundos} segundos deveria ser recusado`
      );
    }
  });
});

describe("alternativas", () => {
  it("aceitam no máximo uma correta por pergunta", async () => {
    // É o índice único parcial da migração 002. A validação da
    // aplicação também barra isso — mas ela não protege contra um
    // bug futuro nem contra quem insere pelo Adminer.
    const perguntaId = await criarPergunta();

    await pool.query(
      "INSERT INTO alternativas (pergunta_id, ordem, texto, correta) VALUES ($1, 0, 'A', TRUE)",
      [perguntaId]
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO alternativas (pergunta_id, ordem, texto, correta) VALUES ($1, 1, 'B', TRUE)",
        [perguntaId]
      ),
      (erro) => erro.code === VIOLACAO_UNIQUE
    );
  });

  it("aceitam várias erradas na mesma pergunta", async () => {
    // O índice é PARCIAL (WHERE correta): ele não existe para as
    // linhas marcadas como falsas. Se fosse um UNIQUE comum, só
    // caberia uma alternativa errada por pergunta — e o quiz
    // inteiro seria impossível.
    const perguntaId = await criarPergunta();

    for (let ordem = 0; ordem < 4; ordem++) {
      await pool.query(
        "INSERT INTO alternativas (pergunta_id, ordem, texto, correta) VALUES ($1, $2, 'X', FALSE)",
        [perguntaId, ordem]
      );
    }

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM alternativas WHERE pergunta_id = $1",
      [perguntaId]
    );

    assert.equal(rows[0].total, 4);
  });

  it("somem quando o quiz é apagado", async () => {
    // CASCADE em cadeia: quiz -> perguntas -> alternativas.
    const perguntaId = await criarPergunta();
    await pool.query(
      "INSERT INTO alternativas (pergunta_id, ordem, texto, correta) VALUES ($1, 0, 'A', TRUE)",
      [perguntaId]
    );

    await pool.query("DELETE FROM quizzes WHERE id = $1", [quizId]);

    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM alternativas");
    assert.equal(rows[0].total, 0);
  });
});
