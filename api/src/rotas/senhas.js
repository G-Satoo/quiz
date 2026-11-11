// ============================================================
// Recuperação de senha
// Prefixo: /api/senhas  (públicas: quem esqueceu não está logado)
//
// O caminho de sempre: a pessoa informa o e-mail, recebe um link
// com um token de uso único e prazo curto, e escolhe a senha nova.
//
// SEM SERVIÇO DE E-MAIL
//
// Este projeto não envia e-mail (não há provedor configurado, e um
// de verdade exigiria domínio e conta). O link é escrito no LOG DO
// SERVIDOR: em desenvolvimento é só olhar o terminal. Para produção,
// troque `entregarLink` por uma chamada ao provedor de e-mail — o
// resto do fluxo (token, prazo, uso único) já é o definitivo.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { redis } from "../redis.js";
import { limitar } from "../middlewares/limite.js";
import { gerarHash } from "../servicos/senha.js";
import { encerrarSessoesDoUsuario } from "../servicos/sessao.js";
import { validarEmail, validarSenha } from "../util/validacao.js";

const router = Router();

const VALIDADE_SEGUNDOS = 30 * 60;

// No Redis fica o HASH do token, não o token: quem ler o banco de
// chaves não consegue montar um link válido a partir do que vê.
const chaveDoToken = (token) =>
  `redefinir:${createHash("sha256").update(token).digest("hex")}`;

/** Onde o link chegaria por e-mail. Hoje, o log do servidor. */
function entregarLink(email, link) {
  console.log(`\n[recuperar senha] link para ${email} (vale 30 min):\n  ${link}\n`);
}

/**
 * POST /api/senhas/esqueci
 * body: { email }
 *
 * Responde a MESMA coisa exista a conta ou não. Dizer "e-mail não
 * cadastrado" transformaria esta rota num jeito de descobrir quem
 * tem conta no site.
 */
router.post(
  "/esqueci",
  limitar({ nome: "esqueci-senha", max: 5, janela: 60 * 60 }),
  async (req, res, next) => {
    try {
      const { email } = req.body ?? {};

      const erro = validarEmail(email);
      if (erro) return res.status(400).json({ erro });

      const { rows } = await pool.query(
        "SELECT id, email FROM usuarios WHERE email = $1",
        [email.trim().toLowerCase()]
      );

      if (rows.length > 0) {
        const token = randomBytes(32).toString("base64url");
        await redis.set(chaveDoToken(token), String(rows[0].id), "EX", VALIDADE_SEGUNDOS);

        const origem = `${req.protocol}://${req.get("host")}`;
        entregarLink(rows[0].email, `${origem}/redefinir.html?token=${token}`);
      }

      res.json({
        mensagem: "Se existir uma conta com este e-mail, o link para criar uma senha nova foi enviado."
      });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * POST /api/senhas/redefinir
 * body: { token, senha }
 *
 * Troca a senha e derruba todas as sessões da conta: se alguém
 * estava logado com a senha antiga (o motivo mais sério para
 * trocar), deixa de estar.
 */
router.post(
  "/redefinir",
  limitar({ nome: "redefinir-senha", max: 10, janela: 60 * 60 }),
  async (req, res, next) => {
    try {
      const { token, senha } = req.body ?? {};

      if (typeof token !== "string" || token.length < 20 || token.length > 200) {
        return res.status(400).json({ erro: "Link inválido ou vencido. Peça um novo." });
      }

      const erro = validarSenha(senha);
      if (erro) return res.status(400).json({ erro });

      // GETDEL: lê e apaga num passo só. Dois pedidos com o mesmo
      // token não conseguem os dois passar — o link vale uma vez.
      const usuarioId = await redis.getdel(chaveDoToken(token));
      if (!usuarioId) {
        return res.status(400).json({ erro: "Link inválido ou vencido. Peça um novo." });
      }

      await pool.query("UPDATE usuarios SET senha_hash = $1 WHERE id = $2", [
        await gerarHash(senha),
        Number(usuarioId)
      ]);
      await encerrarSessoesDoUsuario(Number(usuarioId));

      res.json({ mensagem: "Senha trocada. Entre com a senha nova." });
    } catch (erro) {
      next(erro);
    }
  }
);

export default router;
