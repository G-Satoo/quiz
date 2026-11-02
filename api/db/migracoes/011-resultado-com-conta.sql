-- ============================================================
-- 011 - Resultado ligado à conta de quem jogou
--
-- O ranking do dia passou a contar só jogador com conta. O
-- motivo é identidade: sem conta, o jogador é um apelido digitado
-- na hora, e somar os pontos de todos os "Ana" do dia juntaria
-- pessoas diferentes. Com conta, somar é honesto — é a mesma
-- pessoa —, e o ranking pode mostrar o total do dia em vez de
-- uma partida avulsa.
--
-- Anônimo continua podendo jogar: a coluna é opcional, e
-- `apelido` segue guardando o nome que estava no telão.
--
-- ON DELETE SET NULL, e não CASCADE: apagar a conta tira a
-- pessoa do ranking, mas o placar daquela partida aconteceu e
-- continua aconteceu para os outros jogadores dela.
-- ============================================================

ALTER TABLE resultados
  ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

-- O ranking só olha linhas com conta, então o índice também.
CREATE INDEX idx_resultados_conta_dia
  ON resultados (terminado_em DESC, usuario_id)
  WHERE usuario_id IS NOT NULL;
