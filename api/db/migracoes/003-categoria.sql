-- ============================================================
-- 003 - Categoria do quiz
--
-- Nasce com valor padrão e sem NOT NULL: os quizzes que já
-- existem precisam continuar válidos. Exigir categoria agora
-- quebraria a migração em qualquer banco com dado dentro — foi a
-- lição da coluna `favorito` lá no projeto atalho.
--
-- Texto livre com CHECK em vez de uma tabela de categorias:
-- são poucas, fixas, e não têm atributo nenhum além do nome. Uma
-- tabela só para isso seria um JOIN em toda listagem para
-- recuperar uma palavra. Se um dia categoria ganhar ícone, cor
-- ou dono, aí vale a tabela.
-- ============================================================

ALTER TABLE quizzes
  ADD COLUMN categoria TEXT NOT NULL DEFAULT 'geral';

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
    'educacao'
  ));

-- A tela de catálogo filtra por categoria; sem índice isso vira
-- varredura da tabela a cada clique num filtro.
CREATE INDEX idx_quizzes_categoria ON quizzes (usuario_id, categoria);
