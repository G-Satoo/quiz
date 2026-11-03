-- ============================================================
-- 013 - Capa enviada pelo dono, guardada aqui
--
-- Antes a capa era um endereço de outro site. Isso tinha dois
-- problemas que nenhuma checagem resolvia por completo:
--
--   - o outro site pode trocar a imagem depois da aprovação, e o
--     catálogo passaria a mostrar o que nunca foi analisado;
--   - para analisar, o servidor teria que baixar endereços
--     digitados por usuários — e um servidor que busca qualquer
--     endereço vira ponte para a própria rede interna (SSRF).
--
-- Agora o dono ENVIA o arquivo. Ele mora aqui desde o início: o
-- que a IA analisa, o que o administrador revisa e o que o público
-- vê são os mesmos bytes, e o servidor nunca busca nada lá fora.
--
-- Trocar a capa é editar o conteúdo: sobe a versão do quiz, como
-- trocar uma pergunta. E quiz publicado não troca — duplica-se.
--
-- imagem_url fica na tabela de quizzes só por compatibilidade; não
-- é mais escrita nem lida.
-- ============================================================

CREATE TABLE capas (
  quiz_id    INTEGER     PRIMARY KEY REFERENCES quizzes(id) ON DELETE CASCADE,
  -- SVG fica de fora de propósito: é texto que pode carregar
  -- script. Só formatos que o navegador trata como imagem pura.
  tipo       TEXT        NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  -- O editor já manda 600x800 comprimido, na casa das dezenas de
  -- KB. O teto é para quem chamar a API sem passar pelo editor.
  bytes      BYTEA       NOT NULL CHECK (octet_length(bytes) <= 1048576),
  enviada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
