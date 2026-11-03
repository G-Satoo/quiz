// ============================================================
// Rotas de usuário
// Prefixo: /api/usuarios
//
// Conta é só para quem CRIA e APRESENTA quizzes. Quem joga entra
// na sala com um código e um apelido, sem cadastro.
// ============================================================

import express, { Router } from "express";

import { pool } from "../../db/pool.js";
import { gerarHash } from "../servicos/senha.js";
import { criarSessao, NOME_COOKIE, opcoesCookie } from "../servicos/sessao.js";
import { limitar } from "../middlewares/limite.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { ErroIA, moderarFoto } from "../servicos/ia.js";
import { tipoPelosBytes } from "../servicos/capa.js";
import { lerInteiro, validarEmail, validarNome, validarSenha } from "../util/validacao.js";

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
      `SELECT u.id, u.nome, u.email, u.criado_em, u.admin,
              (SELECT '/api/usuarios/' || f.usuario_id || '/foto?v=' || floor(extract(epoch FROM f.enviada_em))::bigint
                 FROM fotos_perfil f WHERE f.usuario_id = u.id) AS foto
         FROM usuarios u WHERE u.id = $1`,
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
      `SELECT u.id, u.nome, u.email, u.criado_em, u.admin,
              (SELECT '/api/usuarios/' || f.usuario_id || '/foto?v=' || floor(extract(epoch FROM f.enviada_em))::bigint
                 FROM fotos_perfil f WHERE f.usuario_id = u.id) AS foto,
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

/**
 * GET /api/usuarios/:id
 *
 * O perfil PÚBLICO de alguém: o que o catálogo mostra quando se
 * clica no autor de um quiz. Público, como o catálogo.
 *
 * Só o que a própria pessoa já tornou público: o nome, desde quando
 * está aqui, e números sobre o que ela publicou e jogou valendo
 * ranking. Nada de e-mail, nada de rascunho ou quiz recusado — isso
 * é do perfil particular (/eu/perfil), que exige ser a pessoa.
 *
 * Vem depois das rotas /eu de propósito: o Express testa na ordem,
 * e "/:id" na frente engoliria "/eu" como se fosse um id.
 */
/**
 * PUT /api/usuarios/eu/foto
 * corpo: a imagem (PNG, JPEG ou WEBP)
 *
 * Troca a foto de perfil. A IA analisa ANTES de gravar: aprovada,
 * substitui a anterior; recusada, nada muda e a resposta diz por
 * quê. A foto aparece para todo mundo, ao lado de cada quiz e no
 * ranking — não existe foto "em análise" visível.
 */
router.put(
  "/eu/foto",
  exigirLogin,
  // Cada envio é uma chamada à IA, e a cota é do projeto todo.
  limitar({ nome: "foto", max: 10, janela: 60 * 60, chave: (req) => req.usuarioId }),
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: 512 * 1024 }),
  async (req, res, next) => {
    try {
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ erro: "Envie a foto como PNG, JPEG ou WEBP" });
      }

      // O tipo pelos bytes, não pelo que o cliente declarou.
      const tipo = tipoPelosBytes(bytes);
      if (!tipo) return res.status(400).json({ erro: "O arquivo não é uma imagem PNG, JPEG ou WEBP" });

      let veredito;
      try {
        veredito = await moderarFoto({ tipo, bytes });
      } catch (erro) {
        if (!(erro instanceof ErroIA)) throw erro;
        // Sem análise, sem foto: falhar aberto aqui seria publicar
        // uma imagem que ninguém olhou.
        return res.status(erro.codigo === "cota" ? 429 : 503).json({ erro: erro.message });
      }

      if (!veredito.aprovada) {
        return res.status(422).json({ erro: `A foto não foi aceita: ${veredito.motivo}` });
      }

      const { rows } = await pool.query(
        `INSERT INTO fotos_perfil (usuario_id, tipo, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id) DO UPDATE
           SET tipo = EXCLUDED.tipo, bytes = EXCLUDED.bytes, enviada_em = now()
         RETURNING '/api/usuarios/' || usuario_id || '/foto?v=' || floor(extract(epoch FROM enviada_em))::bigint AS foto`,
        [req.usuarioId, tipo, bytes]
      );

      res.json({ foto: rows[0].foto });
    } catch (erro) {
      next(erro);
    }
  }
);

/** DELETE /api/usuarios/eu/foto — volta para a inicial do nome. */
router.delete("/eu/foto", exigirLogin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM fotos_perfil WHERE usuario_id = $1", [req.usuarioId]);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

/**
 * GET /api/usuarios/:id/foto
 *
 * Pública: só existe foto aprovada, e ela aparece no catálogo.
 */
router.get("/:id/foto", async (req, res, next) => {
  try {
    const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (id === null) return res.status(404).json({ erro: "Foto não encontrada" });

    const { rows } = await pool.query("SELECT tipo, bytes FROM fotos_perfil WHERE usuario_id = $1", [id]);
    if (rows.length === 0) return res.status(404).json({ erro: "Foto não encontrada" });

    res.set({
      "Content-Type": rows[0].tipo,
      "X-Content-Type-Options": "nosniff",
      // A URL carrega ?v=, que muda a cada foto nova.
      "Cache-Control": "public, max-age=86400"
    });
    res.send(rows[0].bytes);
  } catch (erro) {
    next(erro);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (id === null) return res.status(404).json({ erro: "Pessoa não encontrada" });

    const { rows } = await pool.query(
      `SELECT u.id, u.nome, u.criado_em,
              (SELECT COUNT(*) FROM quizzes q
                WHERE q.usuario_id = u.id AND q.situacao = 'publicado')::int AS quizzes,
              (SELECT COALESCE(SUM(q.partidas), 0) FROM quizzes q
                WHERE q.usuario_id = u.id AND q.situacao = 'publicado')::int AS acessos,
              (SELECT ROUND(AVG(v.nota), 1)::float
                 FROM avaliacoes v
                 JOIN resultados r USING (sala, jogador_id)
                 JOIN quizzes q ON q.id = v.quiz_id
                WHERE q.usuario_id = u.id AND q.situacao = 'publicado' AND r.vale_ranking) AS nota,
              (SELECT COUNT(*) FROM resultados r
                WHERE r.usuario_id = u.id AND r.vale_ranking)::int AS partidas,
              (SELECT COALESCE(SUM(r.pontos), 0) FROM resultados r
                WHERE r.usuario_id = u.id AND r.vale_ranking)::int AS pontos,
              (SELECT COUNT(*) FROM resultados r
                WHERE r.usuario_id = u.id AND r.vale_ranking AND r.posicao = 1)::int AS vitorias,
              (SELECT '/api/usuarios/' || f.usuario_id || '/foto?v=' || floor(extract(epoch FROM f.enviada_em))::bigint
                 FROM fotos_perfil f WHERE f.usuario_id = u.id) AS foto,
              -- O quiz dela que mais gente abriu: o melhor cartão de
              -- visita de quem cria.
              (SELECT json_build_object('id', q.id, 'titulo', q.titulo, 'acessos', q.partidas)
                 FROM quizzes q
                WHERE q.usuario_id = u.id AND q.situacao = 'publicado'
                ORDER BY q.partidas DESC, q.id
                LIMIT 1) AS quiz_destaque,
              -- Onde ela mais cria. Empate fica com a ordem alfabética,
              -- para a resposta não mudar a cada visita.
              (SELECT q.categoria
                 FROM quizzes q
                WHERE q.usuario_id = u.id AND q.situacao = 'publicado'
                GROUP BY q.categoria
                ORDER BY COUNT(*) DESC, q.categoria
                LIMIT 1) AS categoria_favorita
         FROM usuarios u
        WHERE u.id = $1`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ erro: "Pessoa não encontrada" });

    res.json({ usuario: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

export default router;
