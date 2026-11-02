-- ============================================================
-- 004 - Dados para o catálogo em destaque
--
-- As fileiras do catálogo ("populares", "favoritos") precisam de
-- um critério real. Sem isto, "popular" seria invenção de tela —
-- e uma vitrine que mente é pior que uma lista simples.
-- ============================================================

-- Quantas vezes uma sala foi aberta para este quiz. É a medida
-- honesta de "popular" que o sistema consegue dar hoje: não
-- conta quantos jogaram (isso é a fase 5, com histórico), mas
-- conta quantas vezes alguém decidiu apresentá-lo.
ALTER TABLE quizzes
  ADD COLUMN partidas INTEGER NOT NULL DEFAULT 0;

-- Marcado à mão por quem criou. Simples assim.
ALTER TABLE quizzes
  ADD COLUMN favorito BOOLEAN NOT NULL DEFAULT FALSE;

-- A fileira "mais jogados" ordena por isto a cada carregamento
-- do catálogo.
CREATE INDEX idx_quizzes_partidas ON quizzes (usuario_id, partidas DESC);
