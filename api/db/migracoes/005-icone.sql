-- ============================================================
-- 005 - Símbolo da capa
--
-- Um emoji por quiz, escolhido pela IA junto com as perguntas e
-- editável à mão.
--
-- Por que emoji e não imagem: capa de verdade significa foto de
-- alguém, e usar foto alheia sem licença é problema — tanto
-- buscar no Google quanto gerar por IA um personagem conhecido.
-- Emoji é padrão Unicode: não tem dono, renderiza em qualquer
-- aparelho, não precisa de armazenamento nem de CDN, e carrega
-- junto com o texto.
--
-- TEXT e não CHAR(1): emoji não é um caractere. Uma bandeira é
-- um par de símbolos regionais, e vários emojis são sequências
-- com modificadores. Guardar como texto curto evita cortar um
-- símbolo ao meio.
-- ============================================================

ALTER TABLE quizzes
  ADD COLUMN icone TEXT;

-- Limite de sanidade: cabe a sequência de emoji mais longa em uso
-- e barra alguém colar um parágrafo aqui.
ALTER TABLE quizzes
  ADD CONSTRAINT icone_curto CHECK (icone IS NULL OR length(icone) <= 16);
