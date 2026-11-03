-- ============================================================
-- 012 - Moderação: só entra no catálogo o que foi aprovado
--
-- Até aqui, criar um quiz era publicá-lo: aparecia no catálogo
-- para todo mundo, na hora, sem ninguém ler. A partir daqui:
--
--   rascunho   é do dono. Abre sala privada por código, mas não
--              aparece no catálogo e não conta para o ranking.
--   publicado  passou pela IA (ou por um administrador). Está no
--              catálogo e vale no ranking.
--   recusado   a IA ou o administrador disse não, e disse por
--              quê. O dono corrige e envia de novo.
--   revisao    a IA ficou em dúvida, ou o quiz foi denunciado
--              demais. Fora do catálogo até um humano decidir.
--
-- Pedir aprovação é escolha do dono: quiz para jogar com os
-- amigos não precisa passar por ninguém. O que precisa de
-- aprovação é aparecer para estranhos e dar pontos no ranking.
-- ============================================================

ALTER TABLE usuarios ADD COLUMN admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE quizzes
  ADD COLUMN situacao TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (situacao IN ('rascunho', 'publicado', 'recusado', 'revisao')),
  -- Por que foi recusado ou foi para revisão. É o que o dono lê.
  ADD COLUMN moderacao_motivo TEXT,
  -- Quem decidiu por último: 'ia', 'admin', 'denuncias' ou
  -- 'anterior' (quiz de antes desta regra).
  ADD COLUMN moderacao_por TEXT,
  ADD COLUMN moderacao_em TIMESTAMPTZ,
  -- Sobe a cada edição de conteúdo. A análise da IA leva alguns
  -- segundos; sem isto, dava para pedir aprovação e, durante a
  -- análise, trocar o conteúdo — e a aprovação valeria para um
  -- texto que ninguém leu. A aprovação só é gravada se a versão
  -- ainda for a mesma que foi analisada.
  ADD COLUMN versao INTEGER NOT NULL DEFAULT 0;

-- O que já existe estava no catálogo antes da regra e continua
-- lá. Marcado como 'anterior' para dar para achar depois, se
-- alguém quiser passar esses pela IA também.
UPDATE quizzes
   SET situacao = 'publicado', moderacao_por = 'anterior', moderacao_em = now();

-- O catálogo público só lê publicados.
CREATE INDEX idx_quizzes_publicados ON quizzes (criado_em DESC) WHERE situacao = 'publicado';

-- ------------------------------------------------------------
-- Denúncias: a rede de segurança para o que a IA deixar passar.
-- ------------------------------------------------------------
CREATE TABLE denuncias (
  id           BIGSERIAL   PRIMARY KEY,
  quiz_id      INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  usuario_id   INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  motivo       TEXT        NOT NULL CHECK (motivo IN (
                 'ofensivo', 'sexual', 'odio', 'golpe',
                 'dados-pessoais', 'imagem', 'sem-sentido', 'outro')),
  detalhe      TEXT        CHECK (char_length(detalhe) <= 300),
  criada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvida_em TIMESTAMPTZ
);

-- Uma denúncia aberta por pessoa por quiz. Sem isto, uma pessoa
-- sozinha tiraria qualquer quiz do ar clicando três vezes.
CREATE UNIQUE INDEX denuncia_aberta_unica
  ON denuncias (quiz_id, usuario_id) WHERE resolvida_em IS NULL;

CREATE INDEX idx_denuncias_abertas ON denuncias (quiz_id) WHERE resolvida_em IS NULL;

-- ------------------------------------------------------------
-- Ranking: só vale partida de quiz publicado.
--
-- Gravado no momento da partida, e não consultado depois: jogar o
-- próprio rascunho sabendo as respostas e só então publicá-lo não
-- pode transformar aquelas partidas em pontos.
-- ------------------------------------------------------------
ALTER TABLE resultados ADD COLUMN vale_ranking BOOLEAN NOT NULL DEFAULT TRUE;
