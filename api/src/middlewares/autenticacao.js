// ============================================================
// Middleware de autenticação
//
// Lê o cookie de sessão, resolve quem é o usuário e coloca em
// req.usuarioId. Rota que não passa por aqui não conhece usuário
// nenhum — é a regra que evita o esquecimento clássico de deixar
// um endpoint aberto por acidente.
// ============================================================

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
