// ============================================================
// Preparo do banco e do Redis para os testes
//
// Cada arquivo de teste chama prepararBanco() no before() e
// limpar() antes de cada caso.
// ============================================================

import { pool } from "../../db/pool.js";
import { migrar } from "../../db/migrar.js";
import { redis } from "../../src/redis.js";
import { gerarHash } from "../../src/servicos/senha.js";

/**
 * Espera o Postgres aceitar conexão.
 *
 * O container responde à porta antes de estar pronto para
 * consultas, e no CI o teste roda no segundo seguinte ao
 * "docker compose up". Sem esta espera, o primeiro arquivo de
 * teste falha e o resto passa — o tipo de intermitência que faz
 * as pessoas desconfiarem da suíte inteira.
 */
async function esperarBanco(tentativas = 30) {
  for (let i = 0; i < tentativas; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolver) => setTimeout(resolver, 500));
    }
  }

  throw new Error(
    "Banco de teste não respondeu. Rode: " +
    "docker compose --profile teste up -d db-teste redis-teste"
  );
}

/**
 * Deixa o banco pronto: espera subir e aplica as migrações.
 *
 * Rodar as migrações em vez de aplicar um schema.sql é de
 * propósito — assim a suíte também prova, toda vez, que uma
 * migração do zero funciona.
 */
export async function prepararBanco() {
  await esperarBanco();
  await migrar();
}

/**
 * Zera os dados entre os casos.
 *
 * TRUNCATE ... CASCADE e não DELETE: é muito mais rápido, e
 * RESTART IDENTITY faz os ids voltarem a 1, então um teste não
 * depende de quantos rodaram antes dele.
 *
 * O Redis também precisa ser limpo: um destino em cache de um
 * teste anterior faria o próximo redirecionar para o lugar
 * errado, e um contador de rate limit sobrando faria um teste de
 * login falhar com 429 do nada.
 */
export async function limpar() {
  await pool.query("TRUNCATE alternativas, perguntas, quizzes, usuarios RESTART IDENTITY CASCADE");
  await redis.flushdb();
}

/**
 * Cria um usuário direto no banco, sem passar pela API.
 *
 * Um teste de link não deveria quebrar porque a rota de cadastro
 * mudou — quem testa cadastro é o arquivo de autenticação.
 */
export async function criarUsuario(email = "teste@exemplo.com", senha = "senha-de-teste") {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash)
     VALUES ($1, $2, $3) RETURNING id, nome, email`,
    ["Pessoa de Teste", email, await gerarHash(senha)]
  );

  return { ...rows[0], senha };
}

/**
 * Fecha tudo que segura o processo vivo.
 *
 * O node:test encerra quando o event loop esvazia — e o pool do
 * Postgres, a conexão do Redis e a fila do BullMQ ficam abertos
 * esperando trabalho. Sem isto a suíte passa e depois trava, que
 * é pior do que falhar: no CI, vira um job de 6 horas.
 */
export async function encerrarConexoes() {
  await pool.end();
  await redis.quit();
}
