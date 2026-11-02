-- ============================================================
-- 009 - A posição só é exclusiva entre as perguntas ATIVAS
--
-- A restrição original dizia "duas perguntas do mesmo quiz não
-- podem ter a mesma posição". Ela fazia sentido quando salvar
-- apagava tudo e reinseria.
--
-- Com a desativação (migração 008), a pergunta aposentada
-- continua na tabela — e continuava ocupando a posição dela.
-- Resultado: salvar um quiz editado estourava com
-- "duplicate key (quiz_id, ordem)", porque a pergunta nova
-- recebia a posição 0 que a desativada ainda segurava.
--
-- Índice PARCIAL resolve: a exclusividade vale só onde `ativa`
-- é verdadeiro. Quem saiu da partida não guarda mais lugar na
-- fila — é o mesmo truque da "uma alternativa correta por
-- pergunta" lá na migração 002.
-- ============================================================

ALTER TABLE perguntas
  DROP CONSTRAINT perguntas_quiz_id_ordem_key;

CREATE UNIQUE INDEX idx_pergunta_ordem_ativa
    ON perguntas (quiz_id, ordem)
 WHERE ativa;
