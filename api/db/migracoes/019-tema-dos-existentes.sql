-- ============================================================
-- Tema para os quizzes que já existiam
--
-- A 018 deixou nulo o tema de quem veio antes dela. Na prática o
-- título já é o tema ("Segunda Guerra Mundial", "Naruto"), então é
-- dele que o tema sai — sem o "(cópia)" que o Duplicar acrescenta,
-- que não é assunto de nada.
-- ============================================================

UPDATE quizzes
   SET tema = btrim(regexp_replace(titulo, '(\s*\(c[óo]pia\))+\s*$', '', 'i'))
 WHERE tema IS NULL
   AND char_length(btrim(regexp_replace(titulo, '(\s*\(c[óo]pia\))+\s*$', '', 'i'))) BETWEEN 2 AND 200;
