// ============================================================
// Rotas de sessão (login e logout)
// Prefixo: /api/sessoes
//
// Login é "criar uma sessão" e logout é "apagar a sessão" — por
// isso as rotas são POST e DELETE do mesmo recurso, em vez de
// /login e /logout. É o mesmo raciocínio de qualquer outro CRUD.
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { conferirSenha } from "../servicos/senha.js";
import {
  criarSessao,
  encerrarSessao,
  NOME_COOKIE,
  opcoesCookie
} from "../servicos/sessao.js";
import { limitar } from "../middlewares/limite.js";
import { validarEmail, validarSenha } from "../util/validacao.js";

const router = Router();

/**
 * POST /api/sessoes
 * body: { email, senha }
 */
router.post(
  "/",
  // 10 tentativas por IP a cada 15 minutos. O suficiente para
  // quem errou a senha algumas vezes, pouco demais para quem está
  // testando uma lista de senhas vazadas.
  limitar({ nome: "login", max: 10, janela: 15 * 60 }),
  async (req, res, next) => {
    try {
      const { email, senha } = req.body ?? {};

      if (validarEmail(email) || validarSenha(senha)) {
        // Mensagem genérica de propósito, igual à de senha errada:
        // dizer "formato de e-mail inválido" aqui não ajuda ninguém
        // e diferenciar as respostas ensina o atacante.
        return res.status(401).json({ erro: "E-mail ou senha incorretos" });
      }

      const { rows } = await pool.query(
        "SELECT id, nome, email, senha_hash FROM usuarios WHERE email = $1",
        [email.trim().toLowerCase()]
      );

      const usuario = rows[0];

      // Confere a senha mesmo quando o usuário não existe, contra
      // um hash descartável. Sem isso, "e-mail não cadastrado"
      // responde em 1ms e "senha errada" em 100ms — a diferença de
      // tempo revela quais e-mails têm conta aqui.
      const hashParaConferir = usuario?.senha_hash ?? HASH_FALSO;
      const senhaConfere = await conferirSenha(senha, hashParaConferir);

      if (!usuario || !senhaConfere) {
        return res.status(401).json({ erro: "E-mail ou senha incorretos" });
      }

      const token = await criarSessao(usuario.id);
      res.cookie(NOME_COOKIE, token, opcoesCookie());

      res.status(201).json({
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
      });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * DELETE /api/sessoes
 *
 * Responde 204 mesmo sem sessão: sair de uma conta em que você já
 * não está é o resultado que a pessoa queria de qualquer forma.
 */
router.delete("/", async (req, res, next) => {
  try {
    await encerrarSessao(req.cookies?.[NOME_COOKIE]);

    // Mesmas opções do cookie original (menos maxAge) — o
    // navegador só apaga se path e sameSite baterem.
    res.clearCookie(NOME_COOKIE, { ...opcoesCookie(), maxAge: undefined });

    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

// Hash de uma senha qualquer, gerado uma vez quando o módulo
// carrega. Só serve para gastar o mesmo tempo de CPU do caminho
// real (ver comentário acima).
const HASH_FALSO =
  "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

export default router;
