-- ============================================================
-- Três categorias novas: geografia, natureza e culinária
--
-- A lista tinha dez, e o que não cabia em nenhuma caía em "geral":
-- "Culinária brasileira", "Reino animal" e "Capitais do mundo"
-- ficavam juntos sem ter nada em comum. Com a categoria agora
-- escolhida pela IA (migração 018 em diante), "geral" tem que ser
-- a sobra de verdade, não o destino de assuntos comuns.
--
-- A lista vive em três lugares que precisam andar juntos: este
-- CHECK, CATEGORIAS em src/util/validacao.js e os rótulos das telas.
-- ============================================================

ALTER TABLE quizzes DROP CONSTRAINT categoria_conhecida;

ALTER TABLE quizzes
  ADD CONSTRAINT categoria_conhecida CHECK (categoria IN (
    'geral',
    'anime',
    'games',
    'filmes',
    'musica',
    'esportes',
    'historia',
    'ciencia',
    'tecnologia',
    'educacao',
    'geografia',
    'natureza',
    'culinaria'
  ));

-- Os quizzes do catálogo inicial que estavam no lugar errado. Só
-- os do site (ver quiz_e_do_site, migração 017): rascunho de
-- usuário com o mesmo título é reclassificado quando for publicado.
UPDATE quizzes SET categoria = 'culinaria'
 WHERE titulo = 'Culinária brasileira' AND quiz_e_do_site(id);

UPDATE quizzes SET categoria = 'natureza'
 WHERE titulo = 'Reino animal' AND quiz_e_do_site(id);

UPDATE quizzes SET categoria = 'geografia'
 WHERE titulo IN ('Capitais do mundo', 'Geografia do Brasil') AND quiz_e_do_site(id);
