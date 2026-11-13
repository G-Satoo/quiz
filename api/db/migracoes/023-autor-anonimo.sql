-- ============================================================
-- 023 - Publicar como anônimo
--
-- Quem publica um quiz aparece no catálogo: nome, foto e um clique
-- até o perfil. Nem todo mundo quer isso. Com `anonimo` ligado, os
-- quizzes da pessoa continuam no catálogo, mas assinados como
-- "Anônimo": a API não devolve nome, id, cor nem foto do autor para
-- os outros, e o perfil público dela deixa de listar o que publicou
-- (senão bastaria abrir o perfil para descobrir de quem é o quiz).
--
-- É diferente de quiz SEM autor (usuario_id nulo, a conta foi
-- apagada): esse aparece como "Autor desconhecido".
--
-- O ranking não muda: lá a pessoa aparece como jogadora, não como
-- autora.
-- ============================================================

ALTER TABLE usuarios ADD COLUMN anonimo BOOLEAN NOT NULL DEFAULT FALSE;
