// ============================================================
// Dá (ou tira) o papel de administrador de uma conta
//
// Rode com:  npm run admin -- email@exemplo.com
//            npm run admin -- email@exemplo.com --tirar
//
// Não existe tela para isto de propósito. Quem pode dar o papel
// de administrador é quem tem acesso ao servidor; uma tela que
// fizesse isso precisaria de um administrador para existir — e o
// primeiro teria que nascer de algum jeito mesmo.
// ============================================================

import "dotenv/config";

import { pool } from "../db/pool.js";

const [email, opcao] = process.argv.slice(2);

if (!email) {
  console.error("Use: npm run admin -- email@exemplo.com [--tirar]");
  process.exit(1);
}

const admin = opcao !== "--tirar";

try {
  const { rows } = await pool.query(
    "UPDATE usuarios SET admin = $1 WHERE email = $2 RETURNING nome, email",
    [admin, email.trim().toLowerCase()]
  );

  if (rows.length === 0) {
    console.error(`Nenhuma conta com o e-mail ${email}.`);
    process.exitCode = 1;
  } else {
    console.log(`${rows[0].nome} (${rows[0].email}) ${admin ? "agora é" : "deixou de ser"} administrador.`);
  }
} finally {
  await pool.end();
}
