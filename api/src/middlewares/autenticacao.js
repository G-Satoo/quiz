// ============================================================
// Middleware de autenticação
//
// Lê o cookie de sessão, resolve quem é o usuário e coloca em
// req.usuarioId. Rota que não passa por aqui não conhece usuário
// nenhum — é a regra que evita o esquecimento clássico de deixar
// um endpoint aberto por acidente.
// ============================================================

import { pool } from "../../db/pool.js";
import { lerSessao, NOME_COOKIE } from "../servicos/sessao.js";

/**
 * Exige login. Sem sessão válida, responde 401 e a rota nem roda.
 */
export async function exigirLogin(req, res, next) {
  try {
    const token = req.cookies?.[NOME_COOKIE];
    const usuarioId = await lerSessao(token);

    if (!usuarioId) {
      return res.status(401).json({ erro: "Faça login para continuar" });
    }

    req.usuarioId = usuarioId;
    next();
  } catch (erro) {
    next(erro);
  }
}

/**
 * Descobre quem é, sem exigir que seja alguém.
 *
 * Existe para o catálogo público: a lista de quizzes abre para
 * visitante, mas quando há sessão a resposta pode dizer o que é
 * seu e o que não é. Sem isto, a rota teria que escolher entre
 * ser pública e conhecer o usuário.
 *
 * Nunca responde 401: sessão ausente, expirada ou corrompida
 * leva ao mesmo lugar — segue sem usuário. Quem precisa de dono
 * usa exigirLogin; quem só quer saber, usa este.
 */
export async function loginOpcional(req, res, next) {
  try {
    const token = req.cookies?.[NOME_COOKIE];
    req.usuarioId = (await lerSessao(token)) || null;
    next();
  } catch (erro) {
    next(erro);
  }
}

/**
 * Exige que quem está logado seja administrador. Vem DEPOIS de
 * exigirLogin, que já resolveu quem é.
 *
 * Consulta o banco a cada pedido em vez de guardar o papel na
 * sessão: tirar o papel de alguém tem que valer na hora, não só
 * quando a sessão dele expirar.
 */
export async function exigirAdmin(req, res, next) {
  try {
    const { rows } = await pool.query("SELECT admin FROM usuarios WHERE id = $1", [req.usuarioId]);

    if (!rows[0]?.admin) {
      return res.status(403).json({ erro: "Só administradores podem fazer isso" });
    }

    next();
  } catch (erro) {
    next(erro);
  }
}
