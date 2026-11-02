-- ============================================================
-- 007 - Histórico de aberturas de sala
--
-- A coluna `partidas` guarda só um total, e total não responde
-- "mais acessados da semana" nem "de hoje" — um contador que só
-- cresce não sabe QUANDO cresceu.
--
-- Uma linha por abertura resolve, e é o mesmo desenho dos
-- cliques do projeto atalho: guardar o evento com o horário
-- permite cortar por qualquer período depois, sem ter decidido
-- os períodos antes.
--
-- `partidas` continua existindo como total acumulado. É
-- informação duplicada de propósito: o total aparece em toda
-- listagem, e somar a tabela inteira a cada carregamento seria
-- pagar caro por um número que nunca muda para trás.
-- ============================================================

CREATE TABLE aberturas (
  id          BIGSERIAL PRIMARY KEY,
  quiz_id     INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Toda consulta do catálogo é "aberturas deste quiz, neste
-- período". Sem o índice, cada carregamento varre a tabela.
CREATE INDEX idx_aberturas_quiz ON aberturas (quiz_id, ocorrido_em DESC);

-- Semeia o histórico com o que o contador já acumulou, para os
-- quizzes existentes não nascerem com zero acessos num sistema
-- que diz que eles foram apresentados.
INSERT INTO aberturas (quiz_id, ocorrido_em)
SELECT q.id, now()
  FROM quizzes q, generate_series(1, q.partidas)
 WHERE q.partidas > 0;

-- Favorito sai: a vitrine passou a destacar por acesso, que é
-- medido, em vez de por marcação manual.
ALTER TABLE quizzes DROP COLUMN favorito;
