-- ============================================================
-- 016 - Perfil editável: bio, cor e banner
--
-- A página de perfil passa a ser da pessoa: ela escolhe uma frase
-- sobre si (bio), uma cor e uma imagem de fundo para o topo.
--
-- Tudo isso é público — aparece no perfil e no cartãozinho do
-- catálogo —, então passa pela IA antes de ser gravado, como a foto.
-- Só o aprovado mora aqui.
--
-- A cor é uma das do site, por nome, e não um código livre: assim
-- o perfil nunca fica ilegível (texto claro sobre fundo claro), e a
-- tela não precisa confiar num valor que veio de fora.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN bio TEXT CHECK (char_length(bio) <= 200),
  ADD COLUMN cor TEXT CHECK (cor IN ('azul', 'verde', 'laranja', 'vermelho', 'roxo', 'ciano', 'rosa', 'amarelo'));

CREATE TABLE banners_perfil (
  usuario_id INTEGER     PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       TEXT        NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes      BYTEA       NOT NULL CHECK (octet_length(bytes) <= 1048576),
  enviada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
