// ============================================================
// Põe as capas ilustradas nos quizzes do catálogo inicial.
//
//   npm run capas:catalogo
//
// O `npm run semear:catalogo` já faz isto no fim. Este script é
// para quando chega capa nova (em db/capas/) e o catálogo já
// existe: põe as capas sem recriar os quizzes — e sem apagar o
// histórico de partidas deles.
// ============================================================

import "dotenv/config";

import { pool } from "../db/pool.js";
import { aplicarCapasDoCatalogo } from "../db/capas/aplicar.js";

try {
  const postas = await aplicarCapasDoCatalogo(pool);
  console.log(`${postas} capa(s) aplicada(s).`);
} catch (erro) {
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
