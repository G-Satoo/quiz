-- ============================================================
-- Quiz aprovado é do site; o autor fica com o crédito
--
-- Até aqui, quiz era da conta: apagar a conta (ON DELETE CASCADE)
-- ou apagar o quiz levava junto partidas, avaliações e pontos do
-- ranking de todo mundo que jogou. Um quiz popular sumindo do
-- catálogo porque o dono quis é ruim para o site inteiro.
--
-- Agora são duas coisas:
--   - rascunho (e recusado) é da pessoa: ela apaga quando quiser;
--   - quiz que entrou no catálogo é do site: o autor continua
--     aparecendo no perfil e no catálogo, mas não apaga. Se a conta
--     for apagada, o quiz fica, só sem autor.
-- ============================================================

-- "É do site": está no catálogo, está em revisão (estava no
-- catálogo e foi denunciado — apagar seria sumir com a prova), ou já
-- teve partida que contou no ranking. Uma função só, usada pela rota
-- de apagar e pelo gatilho abaixo, para a regra não divergir.
CREATE FUNCTION quiz_e_do_site(id_do_quiz INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM quizzes q
     WHERE q.id = id_do_quiz
       AND (q.situacao IN ('publicado', 'revisao')
            OR EXISTS (SELECT 1 FROM resultados r
                        WHERE r.quiz_id = q.id AND r.vale_ranking))
  )
$$;

-- O autor pode deixar de existir.
ALTER TABLE quizzes ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE quizzes DROP CONSTRAINT quizzes_usuario_id_fkey;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

-- Ao apagar uma conta, os rascunhos dela vão junto (sem dono, não
-- serviriam para ninguém); os do site ficam, com usuario_id nulo.
CREATE FUNCTION apagar_rascunhos_da_conta() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM quizzes
   WHERE usuario_id = OLD.id
     AND NOT quiz_e_do_site(id);
  RETURN OLD;
END
$$;

CREATE TRIGGER rascunhos_saem_com_a_conta
  BEFORE DELETE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION apagar_rascunhos_da_conta();
