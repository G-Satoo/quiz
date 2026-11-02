-- ============================================================
-- 006 - Imagem de capa
--
-- Guardamos a URL, não o arquivo. O Wikimedia Commons serve as
-- imagens dele com CDN próprio e estabilidade melhor do que
-- qualquer coisa que este projeto fosse montar.
--
-- O crédito é obrigatório, não enfeite: as licenças livres (CC
-- BY, CC BY-SA) exigem atribuir o autor e dizer a licença. Uma
-- coluna sem a outra seria uso irregular, então as duas nascem
-- juntas.
-- ============================================================

ALTER TABLE quizzes
  ADD COLUMN imagem_url TEXT,
  ADD COLUMN imagem_credito TEXT,
  ADD COLUMN imagem_pagina TEXT;
