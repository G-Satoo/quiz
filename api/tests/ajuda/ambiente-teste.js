// ============================================================
// Ambiente dos testes de integração
//
// PRECISA ser o primeiro import de todo arquivo de teste de
// integração. Não é preferência de estilo: pool.js e redis.js
// leem as variáveis de ambiente no momento em que são
// carregados, e os imports de um módulo ESM são avaliados na
// ordem em que aparecem. Se o import do app vier antes deste, a
// conexão já terá nascido apontando para o banco de
// desenvolvimento — e os testes apagariam os seus dados.
//
// Sobe os containers de teste com:
//   docker compose --profile teste up -d db-teste redis-teste
// ============================================================

// Portas 5436 e 6381: os containers do profile "teste", que
// nascem vazios a cada restart.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TESTE ||
  "postgres://quiz:quiz123@localhost:5438/quiz_teste";

process.env.REDIS_URL = process.env.REDIS_URL_TESTE || "redis://localhost:6383";

process.env.DATABASE_SSL = "false";
process.env.COOKIE_SEGURO = "false";

// Os testes NUNCA chamam a IA de verdade: sem chave, sem cota,
// sem internet, sem resposta diferente a cada execução. Um teste
// que depende de um modelo de linguagem não testa o seu código —
// testa o humor do modelo naquele dia.
process.env.IA_PROVEDOR = "falso";

// Trava de segurança: se por algum motivo a URL apontar para o
// banco de desenvolvimento, é melhor o teste nem começar do que
// truncar tabelas que têm dados de verdade.
if (!process.env.DATABASE_URL.includes("_teste")) {
  console.error(
    "\nERRO: os testes de integração só rodam contra um banco com " +
    "'_teste' no nome.\nURL recebida: " + process.env.DATABASE_URL + "\n"
  );
  process.exit(1);
}
