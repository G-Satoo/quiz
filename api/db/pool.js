// ============================================================
// Conexão com o Postgres
//
// Um "pool" é um conjunto de conexões abertas que ficam sendo
// reaproveitadas. Abrir conexão nova a cada consulta é caro,
// então criamos o pool uma vez e todo o projeto usa este mesmo.
// ============================================================

import pg from "pg";
import "dotenv/config"; // carrega o arquivo .env para process.env

const { Pool } = pg;

// Falhar agora com mensagem clara é melhor do que dar erro
// confuso de conexão lá na frente.
if (!process.env.DATABASE_URL) {
  console.error(
    "\nERRO: DATABASE_URL não encontrada.\n" +
    "Copie o arquivo .env.example para .env e preencha a string de conexão.\n"
  );
  process.exit(1);
}

// Postgres local (Docker) não usa SSL. Bancos na nuvem exigem.
const usarSSL = process.env.DATABASE_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usarSSL ? { rejectUnauthorized: false } : false
});
