-- ============================================================
-- 014 - Pergunta tem no mínimo 10 segundos
--
-- Com a pontuação pesando o tempo da pergunta (pergunta curta vale
-- mais), 10 segundos virou a referência: vale o fator 1. Abaixo
-- disso a pergunta deixa de medir conhecimento e passa a medir a
-- velocidade de leitura.
--
-- Nenhuma pergunta tinha menos de 10 s quando esta migração foi
-- escrita; o UPDATE é para quem rodar em outro banco.
-- ============================================================

UPDATE perguntas SET segundos = 10 WHERE segundos < 10;

ALTER TABLE perguntas DROP CONSTRAINT segundos_razoaveis;
ALTER TABLE perguntas
  ADD CONSTRAINT segundos_razoaveis CHECK (segundos BETWEEN 10 AND 300);
