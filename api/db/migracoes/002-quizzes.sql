-- ============================================================
-- 002 - Quizzes, perguntas e alternativas
--
-- Três tabelas em vez de uma só com JSON. A alternativa seria
-- guardar as perguntas como JSONB dentro de `quizzes`, o que dá
-- menos tabelas e menos JOIN — mas aí o banco deixa de conseguir
-- responder "quantas perguntas têm mais de 4 alternativas?",
-- "qual alternativa foi mais escolhida nas partidas?", e deixa de
-- impedir um quiz nascer com uma pergunta sem resposta certa.
--
-- A regra geral: JSONB serve bem para o que você só lê inteiro e
-- nunca consulta por dentro. Aqui vamos consultar por dentro o
-- tempo todo — na correção de cada resposta e no relatório final.
-- ============================================================

CREATE TABLE quizzes (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  titulo      TEXT        NOT NULL,
  descricao   TEXT,

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quizzes_usuario ON quizzes (usuario_id, criado_em DESC);

CREATE TABLE perguntas (
  id          SERIAL PRIMARY KEY,
  quiz_id     INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,

  -- A sequência em que as perguntas aparecem na partida. Não dá
  -- para confiar no `id` para isso: inserir uma pergunta no meio
  -- depois geraria um id maior que o das seguintes.
  ordem       INTEGER     NOT NULL,

  enunciado   TEXT        NOT NULL,

  -- Quanto tempo os jogadores têm para responder. Fica por
  -- pergunta, não por quiz: uma de cálculo merece mais tempo que
  -- uma de sim/não.
  segundos    INTEGER     NOT NULL DEFAULT 20,

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Duas perguntas do mesmo quiz não podem disputar a mesma
  -- posição. Sem isto, a ordem da partida dependeria de desempate
  -- arbitrário do banco — e mudaria de uma execução para outra.
  UNIQUE (quiz_id, ordem),

  -- Limites de sanidade. 1 segundo é injogável; 5 minutos numa
  -- pergunta trava a plateia inteira.
  CONSTRAINT segundos_razoaveis CHECK (segundos BETWEEN 5 AND 300)
);

CREATE TABLE alternativas (
  id           SERIAL PRIMARY KEY,
  pergunta_id  INTEGER NOT NULL REFERENCES perguntas(id) ON DELETE CASCADE,

  ordem        INTEGER NOT NULL,
  texto        TEXT    NOT NULL,

  correta      BOOLEAN NOT NULL DEFAULT FALSE,

  UNIQUE (pergunta_id, ordem)
);

-- Índice único PARCIAL: a cláusula WHERE faz ele valer só para as
-- linhas marcadas como corretas. O efeito é garantir, no banco,
-- que cada pergunta tem no MÁXIMO uma alternativa certa.
--
-- Por que no banco e não só na aplicação: é a mesma lição do
-- código único do Atalho — duas requisições simultâneas marcando
-- alternativas diferentes como corretas passariam juntas por
-- qualquer checagem feita antes do UPDATE.
--
-- O "pelo menos uma correta" não cabe aqui (exigiria um gatilho
-- olhando o conjunto todo) e fica com a validação da aplicação,
-- na hora de salvar a pergunta.
CREATE UNIQUE INDEX idx_uma_correta_por_pergunta
    ON alternativas (pergunta_id)
 WHERE correta;
