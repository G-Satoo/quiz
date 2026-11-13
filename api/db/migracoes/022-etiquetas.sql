-- ============================================================
-- Etiquetas: um quiz pertence a mais de um assunto
--
-- A categoria é uma só e ampla ("Esportes"): serve para a cor e o
-- desenho da capa e para o filtro do catálogo. Mas Fórmula 1 é
-- esporte, é corrida e é carro ao mesmo tempo — e "Esportes" na
-- capa diz pouco. As etiquetas guardam esses assuntos. A PRIMEIRA é a
-- principal, a que aparece na capa: o GRUPO pelo qual alguém
-- procuraria o quiz, o que ele tem em comum com outros (Naruto e
-- Dragon Ball são "anime", não "ninja" e "luta"). As demais descem
-- ao detalhe e servem à busca.
--
-- POR QUE UM ARRAY, E NÃO UMA TABELA
-- São no máximo quatro palavras por quiz, lidas sempre junto com
-- ele e nunca editadas uma a uma (quem escreve é a IA, na
-- aprovação, a lista inteira de uma vez). A ordem importa, e array
-- guarda ordem de graça. Tabela de ligação passa a valer no dia em
-- que etiqueta tiver página própria ou contagem.
-- ============================================================

ALTER TABLE quizzes
  ADD COLUMN etiquetas TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE quizzes
  ADD CONSTRAINT etiquetas_poucas CHECK (cardinality(etiquetas) <= 4);

-- O catálogo inicial foi escrito à mão, sem passar pela IA: as
-- etiquetas dele também. (As mesmas de scripts/semear-catalogo.js.)
UPDATE quizzes q
   SET etiquetas = v.etiquetas
  FROM (VALUES
  ('Capitais do mundo', ARRAY['países', 'capitais', 'mapa']),
  ('Culinária brasileira', ARRAY['comida', 'brasil', 'receitas']),
  ('Reino animal', ARRAY['animais', 'biologia', 'curiosidades']),
  ('Naruto', ARRAY['anime', 'mangá', 'ninja']),
  ('One Piece', ARRAY['anime', 'mangá', 'piratas']),
  ('Dragon Ball', ARRAY['anime', 'mangá', 'luta']),
  ('Pokémon', ARRAY['nintendo', 'rpg', 'monstrinhos']),
  ('Minecraft', ARRAY['games', 'sobrevivência', 'construção']),
  ('Super Mario', ARRAY['nintendo', 'plataforma', 'clássicos']),
  ('Harry Potter', ARRAY['fantasia', 'magia', 'livros']),
  ('Star Wars', ARRAY['sci-fi', 'espaço', 'saga']),
  ('Universo Marvel', ARRAY['super-heróis', 'quadrinhos', 'saga']),
  ('The Beatles', ARRAY['rock', 'banda', 'anos 60']),
  ('MPB', ARRAY['mpb', 'música brasileira', 'cantores']),
  ('Rock nacional', ARRAY['rock', 'banda', 'brasil']),
  ('Copa do Mundo', ARRAY['futebol', 'seleções', 'torneio']),
  ('Fórmula 1', ARRAY['corrida', 'automobilismo', 'carros']),
  ('NBA', ARRAY['basquete', 'liga', 'estados unidos']),
  ('Brasil Império', ARRAY['brasil', 'monarquia', 'século 19']),
  ('Segunda Guerra Mundial', ARRAY['guerra', 'século 20', 'europa']),
  ('Egito Antigo', ARRAY['antiguidade', 'faraós', 'civilizações']),
  ('Sistema Solar', ARRAY['espaço', 'astronomia', 'planetas']),
  ('Corpo humano', ARRAY['biologia', 'anatomia', 'saúde']),
  ('Química básica', ARRAY['química', 'elementos', 'escola']),
  ('JavaScript', ARRAY['programação', 'web', 'linguagem']),
  ('Como a internet funciona', ARRAY['internet', 'redes', 'web']),
  ('Git', ARRAY['programação', 'versionamento', 'ferramentas']),
  ('Gramática portuguesa', ARRAY['português', 'gramática', 'escola']),
  ('Matemática básica', ARRAY['matemática', 'contas', 'escola']),
  ('Geografia do Brasil', ARRAY['brasil', 'estados', 'mapa']),
  ('Naruto Classic', ARRAY['anime', 'mangá', 'ninja']),
  ('História do Brasil', ARRAY['brasil', 'colônia', 'república'])
  ) AS v (titulo, etiquetas)
 WHERE q.titulo = v.titulo
   AND q.situacao = 'publicado';
