-- ============================================================
-- 001 - Usuários
--
-- Quem cria e apresenta quizzes. Quem só joga NÃO precisa de
-- conta: entra na sala com um código e um apelido, como em
-- qualquer quiz ao vivo. Exigir cadastro para jogar mataria o
-- produto — ninguém cria conta no meio de uma apresentação.
-- ============================================================

CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,

  email       TEXT        NOT NULL UNIQUE,

  -- Formato "scrypt$<salt hex>$<hash hex>" — ver src/servicos/senha.js.
  senha_hash  TEXT        NOT NULL,

  nome        TEXT        NOT NULL,

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
