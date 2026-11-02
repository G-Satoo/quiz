-- ============================================================
-- 010 - Resultados das partidas e avaliações dos quizzes
--
-- Até aqui o placar vivia só no Redis e sumia junto com a sala.
-- Duas coisas novas precisam dele depois que a partida acaba:
--
--   - o ranking de melhores jogadores do dia;
--   - a nota que quem jogou dá ao quiz.
--
-- RESULTADOS: uma linha por jogador por partida, gravada quando
-- a última pergunta fecha. Jogador não tem conta, então a
-- identidade é o par (sala, jogador_id) — o id que o servidor
-- deu a ele ao entrar. O apelido vai junto como texto, do jeito
-- que estava no telão naquela partida.
--
-- AVALIAÇÕES: a chave estrangeira composta para `resultados` é a
-- regra de negócio escrita no banco: SÓ AVALIA QUEM TERMINOU A
-- PARTIDA. Não é o código da aplicação que precisa lembrar de
-- conferir; uma avaliação sem resultado correspondente
-- simplesmente não entra. Nota de quem nunca jogou o quiz seria
-- a forma mais barata de inflar ou afundar um quiz alheio.
-- ============================================================

CREATE TABLE resultados (
  id            BIGSERIAL   PRIMARY KEY,
  quiz_id       INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  sala          TEXT        NOT NULL,
  jogador_id    TEXT        NOT NULL,
  apelido       TEXT        NOT NULL,
  pontos        INTEGER     NOT NULL CHECK (pontos >= 0),
  posicao       INTEGER     NOT NULL CHECK (posicao >= 1),
  terminado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Gravar duas vezes o fim da mesma partida (uma reconexão, um
  -- clique duplo em "próxima") não pode duplicar ninguém.
  UNIQUE (sala, jogador_id)
);

-- O ranking do dia é "as maiores pontuações desde a meia-noite".
CREATE INDEX idx_resultados_dia ON resultados (terminado_em DESC, pontos DESC);

CREATE TABLE avaliacoes (
  id          BIGSERIAL   PRIMARY KEY,
  quiz_id     INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  sala        TEXT        NOT NULL,
  jogador_id  TEXT        NOT NULL,
  nota        SMALLINT    NOT NULL CHECK (nota BETWEEN 1 AND 5),
  avaliado_em TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma nota por jogador por partida. Votar de novo troca a nota
  -- (ON CONFLICT no código), não soma outra.
  UNIQUE (sala, jogador_id),

  FOREIGN KEY (sala, jogador_id)
    REFERENCES resultados (sala, jogador_id) ON DELETE CASCADE
);

-- Toda listagem do catálogo calcula a média por quiz.
CREATE INDEX idx_avaliacoes_quiz ON avaliacoes (quiz_id);
