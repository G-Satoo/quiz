// ============================================================
// Rotas de usuário
// Prefixo: /api/usuarios
//
// Conta é só para quem CRIA e APRESENTA quizzes. Quem joga entra
// na sala com um código e um apelido, sem cadastro.
// ============================================================

import express, { Router } from "express";

import { pool } from "../../db/pool.js";
import { conferirSenha, gerarHash } from "../servicos/senha.js";
import { criarSessao, encerrarSessoesDoUsuario, NOME_COOKIE, opcoesCookie } from "../servicos/sessao.js";
import { limitar } from "../middlewares/limite.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { ErroIA, moderarBanner, moderarFoto, moderarTextoPerfil } from "../servicos/ia.js";
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
      `SELECT u.id, u.nome, u.email, u.criado_em, u.admin, u.bio, u.cor,
              (SELECT '/api/usuarios/' || b.usuario_id || '/banner?v=' || floor(extract(epoch FROM b.enviada_em))::bigint
                 FROM banners_perfil b WHERE b.usuario_id = u.id) AS banner,
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
      `SELECT u.id, u.nome, u.email, u.criado_em, u.admin, u.bio, u.cor,
              (SELECT '/api/usuarios/' || b.usuario_id || '/banner?v=' || floor(extract(epoch FROM b.enviada_em))::bigint
                 FROM banners_perfil b WHERE b.usuario_id = u.id) AS banner,
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
// ------------------------------------------------------------
// Perfil editável: nome, bio, cor e banner
// ------------------------------------------------------------

// As cores do site, por nome. As mesmas do CHECK da migração 016.
const CORES_PERFIL = ["azul", "verde", "laranja", "vermelho", "roxo", "ciano", "rosa", "amarelo"];

/**
 * PATCH /api/usuarios/eu
 * body: { nome?, bio?, cor? }
 *
 * Nome e bio são públicos (catálogo, ranking, perfil): se mudaram,
 * passam pela IA antes de gravar. A cor não precisa — é uma das do
 * site, escolhida de uma lista fechada.
 */
router.patch("/eu", exigirLogin, async (req, res, next) => {
  try {
    const { nome, bio, cor } = req.body ?? {};

    if (nome !== undefined) {
      const erro = validarNome(nome);
      if (erro) return res.status(400).json({ erro });
    }
    if (bio !== undefined && bio !== null && (typeof bio !== "string" || bio.trim().length > 200)) {
      return res.status(400).json({ erro: "A bio pode ter no máximo 200 caracteres" });
    }
    if (cor !== undefined && cor !== null && !CORES_PERFIL.includes(cor)) {
      return res.status(400).json({ erro: "Cor inválida" });
    }

    const { rows: atuais } = await pool.query("SELECT nome, bio FROM usuarios WHERE id = $1", [req.usuarioId]);
    const atual = atuais[0];

    const novoNome = nome === undefined ? atual.nome : nome.trim();
    const novaBio = bio === undefined ? atual.bio : (bio?.trim() || null);

    // Só gasta IA com texto novo. Apagar a bio não precisa de análise
    // (e não pode ficar travado se a IA estiver fora do ar).
    if (novoNome !== atual.nome || (novaBio !== null && novaBio !== atual.bio)) {
      let veredito;
      try {
        veredito = await moderarTextoPerfil({ nome: novoNome, bio: novaBio });
      } catch (erro) {
        if (!(erro instanceof ErroIA)) throw erro;
        return res.status(erro.codigo === "cota" ? 429 : 503).json({ erro: erro.message });
      }

      if (!veredito.aprovada) {
        return res.status(422).json({ erro: `Não deu para salvar: ${veredito.motivo}` });
      }
    }

    const { rows } = await pool.query(
      `UPDATE usuarios
          SET nome = $2, bio = $3, cor = CASE WHEN $4::bool THEN $5 ELSE cor END
        WHERE id = $1
        RETURNING id, nome, bio, cor`,
      [req.usuarioId, novoNome, novaBio, cor !== undefined, cor ?? null]
    );

    res.json({ usuario: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

/**
 * PUT /api/usuarios/eu/banner
 * corpo: a imagem (PNG, JPEG ou WEBP)
 *
 * A imagem de fundo do topo do perfil. Mesmo caminho da foto: a IA
 * olha antes, e só o aprovado é gravado.
 */
router.put(
  "/eu/banner",
  exigirLogin,
  limitar({ nome: "banner", max: 10, janela: 60 * 60, chave: (req) => req.usuarioId }),
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: 1024 * 1024 }),
  async (req, res, next) => {
    try {
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ erro: "Envie a imagem como PNG, JPEG ou WEBP" });
      }

      const tipo = tipoPelosBytes(bytes);
      if (!tipo) return res.status(400).json({ erro: "O arquivo não é uma imagem PNG, JPEG ou WEBP" });

      let veredito;
      try {
        veredito = await moderarBanner({ tipo, bytes });
      } catch (erro) {
        if (!(erro instanceof ErroIA)) throw erro;
        return res.status(erro.codigo === "cota" ? 429 : 503).json({ erro: erro.message });
      }

      if (!veredito.aprovada) {
        return res.status(422).json({ erro: `A imagem não foi aceita: ${veredito.motivo}` });
      }

      const { rows } = await pool.query(
        `INSERT INTO banners_perfil (usuario_id, tipo, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id) DO UPDATE
           SET tipo = EXCLUDED.tipo, bytes = EXCLUDED.bytes, enviada_em = now()
         RETURNING '/api/usuarios/' || usuario_id || '/banner?v=' || floor(extract(epoch FROM enviada_em))::bigint AS banner`,
        [req.usuarioId, tipo, bytes]
      );

      res.json({ banner: rows[0].banner });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * GET /api/usuarios/eu/partidas
 *
 * As últimas partidas que a pessoa jogou LOGADA: quiz, posição,
 * pontos e quantos jogaram. Partida jogada sem conta não aparece —
 * não há como saber que aquele apelido era ela.
 *
 * `valeu` diz se a partida somou no ranking (ver gravarResultados):
 * a tela mostra, para ninguém estranhar pontos que não entraram.
 */
router.get("/eu/partidas", exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.pontos, r.posicao, r.terminado_em, r.vale_ranking AS valeu,
              q.id AS quiz_id, q.titulo AS quiz,
              (q.situacao = 'publicado') AS no_catalogo,
              (SELECT COUNT(*) FROM resultados o WHERE o.sala = r.sala)::int AS jogadores
         FROM resultados r
         JOIN quizzes q ON q.id = r.quiz_id
        WHERE r.usuario_id = $1
        ORDER BY r.terminado_em DESC
        LIMIT 20`,
      [req.usuarioId]
    );

    res.json({ partidas: rows });
  } catch (erro) {
    next(erro);
  }
});

/**
 * DELETE /api/usuarios/eu
 * body: { senha }
 *
 * Apaga a conta. Pede a senha de novo: é irreversível, e uma sessão
 * esquecida aberta num computador não pode bastar para isso.
 *
 * O que vai junto e o que fica está na migração 017: rascunhos,
 * foto, banner e denúncias saem com a conta; os quizzes que já são
 * do catálogo ficam no site, sem autor; as partidas jogadas ficam
 * como resultado anônimo (não quebram o placar de quem jogou junto).
 */
router.delete(
  "/eu",
  exigirLogin,
  limitar({ nome: "apagar-conta", max: 5, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const { senha } = req.body ?? {};
      if (typeof senha !== "string" || senha === "") {
        return res.status(400).json({ erro: "Digite a sua senha para confirmar" });
      }

      const { rows } = await pool.query("SELECT senha_hash FROM usuarios WHERE id = $1", [req.usuarioId]);
      if (rows.length === 0 || !(await conferirSenha(senha, rows[0].senha_hash))) {
        return res.status(403).json({ erro: "Senha incorreta" });
      }

      await pool.query("DELETE FROM usuarios WHERE id = $1", [req.usuarioId]);
      await encerrarSessoesDoUsuario(req.usuarioId);
      res.clearCookie(NOME_COOKIE, { ...opcoesCookie(), maxAge: undefined });

      res.status(204).end();
    } catch (erro) {
      next(erro);
    }
  }
);

/** DELETE /api/usuarios/eu/banner — volta para a cor do perfil. */
router.delete("/eu/banner", exigirLogin, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM banners_perfil WHERE usuario_id = $1", [req.usuarioId]);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

/** GET /api/usuarios/:id/banner — público, como o perfil. */
router.get("/:id/banner", async (req, res, next) => {
  try {
    const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (id === null) return res.status(404).json({ erro: "Imagem não encontrada" });

    const { rows } = await pool.query("SELECT tipo, bytes FROM banners_perfil WHERE usuario_id = $1", [id]);
    if (rows.length === 0) return res.status(404).json({ erro: "Imagem não encontrada" });

    res.set({
      "Content-Type": rows[0].tipo,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400"
    });
    res.send(rows[0].bytes);
  } catch (erro) {
    next(erro);
  }
});

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
      `SELECT u.id, u.nome, u.criado_em, u.bio, u.cor,
              (SELECT '/api/usuarios/' || b.usuario_id || '/banner?v=' || floor(extract(epoch FROM b.enviada_em))::bigint
                 FROM banners_perfil b WHERE b.usuario_id = u.id) AS banner,
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
