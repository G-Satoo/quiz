// ============================================================
// Runner de migrações
//
// Rode com:  npm run migrar
//
// Uma migração é um arquivo .sql em db/migracoes/ que muda o
// banco. Elas rodam em ordem alfabética (por isso o prefixo
// numérico: 001-, 002-, ...) e cada uma roda UMA vez só — o que
// já rodou fica registrado na tabela `migracoes`.
//
// Por que não um schema.sql único: com schema.sql, um banco que
// já existe nunca recebe as mudanças novas; você acaba aplicando
// ALTER TABLE na mão e torcendo para não esquecer nenhum
// ambiente. Com migrações, banco novo e banco velho chegam no
// mesmo lugar rodando o mesmo comando.
//
// Duas garantias que valem mais do que parecem:
//
//   - Cada migração roda dentro de uma transação. Se o arquivo
//     tiver cinco comandos e o terceiro falhar, os dois primeiros
//     são desfeitos. O banco nunca fica num meio-termo.
//
//   - Um lock no banco (pg_advisory_lock) impede duas instâncias
//     de migrarem ao mesmo tempo. Isso acontece de verdade quando
//     o deploy sobe duas cópias da API juntas.
// ============================================================

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./pool.js";

const PASTA_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "migracoes");

// Número arbitrário, só precisa ser o mesmo em todo processo que
// tentar migrar este banco. É a "chave" do cadeado.
const CHAVE_LOCK = 5182;

/**
 * Cria a tabela de controle, se ainda não existe. Ela é a única
 * coisa que o runner cria sozinho — todo o resto vem dos arquivos.
 */
async function garantirTabelaControle(cliente) {
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS migracoes (
      nome        TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Aplica as migrações que ainda não rodaram e devolve os nomes
 * das que foram aplicadas agora.
 *
 * Recebe um cliente pronto (em vez de usar o pool direto) porque
 * o lock e as transações precisam acontecer todos na MESMA
 * conexão — o pool poderia entregar outra a cada query.
 */
export async function aplicarMigracoes(cliente) {
  await garantirTabelaControle(cliente);

  const arquivos = (await readdir(PASTA_MIGRACOES))
    .filter((nome) => nome.endsWith(".sql"))
    .sort(); // "001-" < "002-" < "010-"

  const { rows } = await cliente.query("SELECT nome FROM migracoes");
  const jaAplicadas = new Set(rows.map((linha) => linha.nome));

  const aplicadasAgora = [];

  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) continue;

    const sql = await readFile(join(PASTA_MIGRACOES, arquivo), "utf8");

    try {
      await cliente.query("BEGIN");
      await cliente.query(sql);
      await cliente.query("INSERT INTO migracoes (nome) VALUES ($1)", [arquivo]);
      await cliente.query("COMMIT");
    } catch (erro) {
      await cliente.query("ROLLBACK");
      // Deixa claro QUAL arquivo quebrou — o erro cru do Postgres
      // fala de sintaxe e coluna, não de arquivo.
      erro.message = `Falha na migração ${arquivo}: ${erro.message}`;
      throw erro;
    }

    aplicadasAgora.push(arquivo);
  }

  return aplicadasAgora;
}

/**
 * Pega o lock, migra, solta o lock. É o que o `npm run migrar`
 * e os testes de integração chamam.
 */
export async function migrar() {
  const cliente = await pool.connect();

  try {
    // Fica esperando se outro processo estiver migrando.
    await cliente.query("SELECT pg_advisory_lock($1)", [CHAVE_LOCK]);
    return await aplicarMigracoes(cliente);
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CHAVE_LOCK]);
    cliente.release();
  }
}

// Só executa quando chamado direto (node db/migrar.js). Importar
// este arquivo não deve migrar nada sozinho.
const executadoDiretamente = process.argv[1] === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  try {
    const aplicadas = await migrar();

    if (aplicadas.length === 0) {
      console.log("Banco já está atualizado, nada a fazer.");
    } else {
      console.log(`${aplicadas.length} migração(ões) aplicada(s):`);
      for (const nome of aplicadas) console.log(`  - ${nome}`);
    }
    } catch (erro) {
    // Erro de conexão vem como AggregateError: o Node tenta ::1 e
    // 127.0.0.1 e junta as duas falhas num erro só, cuja .message
    // é VAZIA — o detalhe fica em .errors. Sem isto, o programa
    // falha sem dizer por quê.
    const detalhe =
      erro.errors?.map((e) => e.message).join(" / ") || erro.message;

    console.error(`\n${detalhe}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
