-- ============================================================
-- O tema do quiz
--
-- Antes o tema era só um campo do gerador: dava para gerar dez
-- perguntas de Naruto e mais dez de futebol no mesmo quiz. Agora
-- a primeira geração define o tema, ele é salvo com o quiz e não
-- muda mais — gerar de novo é sempre sobre o mesmo assunto. A
-- cópia herda o tema do original.
--
-- Nulo em quiz que nunca usou o gerador (escrito à mão, ou anterior
-- a esta migração): o tema é fixado na primeira geração dele.
-- ============================================================

ALTER TABLE quizzes
  ADD COLUMN tema TEXT CHECK (char_length(tema) BETWEEN 2 AND 200);
