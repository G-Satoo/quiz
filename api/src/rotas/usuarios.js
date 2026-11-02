// ============================================================
// Rotas de usuário
// Prefixo: /api/usuarios
//
// Conta é só para quem CRIA e APRESENTA quizzes. Quem joga entra
// na sala com um código e um apelido, sem cadastro.
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { gerarHash } from "../servicos/senha.js";
import { criarSessao, NOME_COOKIE, opcoesCookie } from "../servicos/sessao.js";
import { limitar } from "../middlewares/limite.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { validarEmail, validarNome, validarSenha } from "../util/validacao.js";

const router = Router();

/**
 * POST /api/usuarios
 * body: { nome, email, senha }
 */
router.post(
  "/",
  limitar({ nome: "cadastro", max: 5, janela: 60 * 60 }),
  async (req, res, next) => {
    try {
      const { nome, email, senha } = req.body ?? {};

      const erro = validarNome(nome) ?? validarEmail(email) ?? validarSenha(senha);
      if (erro) return res.status(400).json({ erro });

      // ON CONFLICT DO NOTHING em vez de "consulta se já existe e
      // depois insere": entre a consulta e o INSERT cabe outra
      // requisição com o mesmo e-mail. Quem decide é o UNIQUE.
      const { rows } = await pool.query(
        `INSERT INTO usuarios (nome, email, senha_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, nome, email, criado_em`,
        [nome.trim(), email.trim().toLowerCase(), await gerarHash(senha)]
      );

      if (rows.length === 0) {
        return res.status(409).json({ erro: "Este e-mail já está cadastrado" });
      }

      const usuario = rows[0];
      res.cookie(NOME_COOKIE, await criarSessao(usuario.id), opcoesCookie());

      res.status(201).json({ usuario });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * GET /api/usuarios/eu
 *
 * O painel chama ao abrir, para saber se mostra a tela de login
 * ou a lista de quizzes. O cookie é httpOnly: o JavaScript não
 * consegue ler a sessão, então perguntar é o único jeito.
 */
router.get("/eu", exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nome, email, criado_em FROM usuarios WHERE id = $1",
      [req.usuarioId]
    );

    // Sessão viva no Redis mas usuário apagado do banco.
    if (rows.length === 0) {
      return res.status(401).json({ erro: "Faça login para continuar" });
    }

    res.json({ usuario: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

/**
 * GET /api/usuarios/eu/perfil
 *
 * O que a página de perfil mostra: a conta e o que ela já fez.
 *
 * Subconsultas em vez de JOINs: com dois JOINs (quizzes e
 * resultados) cada quiz se multiplicaria por cada partida, e os
 * COUNTs sairiam errados. Cada número aqui vem da sua tabela.
 */
router.get("/eu/perfil", exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.email, u.criado_em,
              (SELECT COUNT(*) FROM quizzes q WHERE q.usuario_id = u.id)::int AS quizzes,
              (SELECT COUNT(*) FROM resultados r WHERE r.usuario_id = u.id)::int AS partidas,
              (SELECT COALESCE(SUM(r.pontos), 0) FROM resultados r WHERE r.usuario_id = u.id)::int AS pontos,
              (SELECT COALESCE(MAX(r.pontos), 0) FROM resultados r WHERE r.usuario_id = u.id)::int AS recorde,
              (SELECT COUNT(*) FROM resultados r
                WHERE r.usuario_id = u.id AND r.posicao = 1)::int AS vitorias
         FROM usuarios u
        WHERE u.id = $1`,
      [req.usuarioId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ erro: "Faça login para continuar" });
    }

    res.json({ perfil: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

export default router;
