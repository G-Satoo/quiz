-- ============================================================
-- O dia vira à meia-noite do Brasil, não de Londres
--
-- "Hoje" era date_trunc('day', now()), e o banco conta o tempo em
-- UTC: o ranking do dia zerava às 21h de Brasília, no meio da
-- noite de quem está jogando. Estas funções devolvem o começo do
-- dia (e da semana, que começa na segunda) no horário de Brasília,
-- já como instante — é só comparar com uma coluna TIMESTAMPTZ.
--
-- Uma função, e não a expressão repetida: ranking, acessos do dia
-- e a regra de "uma partida por quiz por dia" precisam concordar
-- sobre quando o dia começa.
-- ============================================================

CREATE FUNCTION inicio_do_dia() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
$$;

CREATE FUNCTION inicio_da_semana() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
$$;

-- "Esta pessoa já pontuou neste quiz hoje?" é perguntado no fim de
-- toda partida, para cada jogador com conta.
CREATE INDEX idx_resultados_conta_quiz
  ON resultados (usuario_id, quiz_id, terminado_em DESC)
  WHERE usuario_id IS NOT NULL AND vale_ranking;
