-- ============================================================
-- 008 - Pergunta desativável
--
-- Pergunta de quiz já criado não se apaga: desativa.
--
-- Dois motivos, e o segundo é o que pesa:
--
--   1. Apagar é irreversível e qualquer pessoa com acesso ao
--      editor consegue fazer. Desativar é um clique que outro
--      clique desfaz.
--
--   2. A pergunta é referenciada por histórico — hoje pelas
--      aberturas de sala, e pelo relatório pós-partida que vem
--      na fase 5. Apagar a pergunta levaria junto a estatística
--      de quem respondeu o quê, e aí o histórico passa a mentir
--      sobre partidas que aconteceram de verdade.
--
-- Pergunta desativada continua no editor, apagada, com um botão
-- para reativar. A partida simplesmente não a carrega.
-- ============================================================

ALTER TABLE perguntas
  ADD COLUMN ativa BOOLEAN NOT NULL DEFAULT TRUE;

-- A partida carrega só as ativas, na ordem.
CREATE INDEX idx_perguntas_ativas ON perguntas (quiz_id, ativa, ordem);
