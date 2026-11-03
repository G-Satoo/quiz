-- ============================================================
-- 015 - Foto de perfil
--
-- Até aqui o avatar era só a inicial do nome numa cor. Agora a
-- pessoa pode enviar uma foto, que aparece no catálogo, no ranking
-- e no topo — para todo mundo.
--
-- Por isso SÓ FOTO APROVADA MORA AQUI. A IA analisa no envio: se
-- aprovar, a foto entra (e substitui a anterior); se recusar, nada
-- é gravado, a pessoa recebe o motivo e a foto antiga continua. Não
-- existe "foto pendente" visível em lugar nenhum.
--
-- O editor de perfil já manda a foto recortada em quadrado e
-- reduzida no navegador; o teto é para quem chamar a API direto.
-- ============================================================

CREATE TABLE fotos_perfil (
  usuario_id INTEGER     PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       TEXT        NOT NULL CHECK (tipo IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes      BYTEA       NOT NULL CHECK (octet_length(bytes) <= 524288),
  enviada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
