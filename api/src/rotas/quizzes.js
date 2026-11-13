// ============================================================
// Rotas de quizzes
// Prefixo: /api/quizzes
//
// QUEM PODE O QUE
//
//   ler a lista e o quiz ....... qualquer um, sem login (só publicados)
//   apresentar e duplicar ...... qualquer um logado (publicados ou seus)
//   editar e trocar a capa ..... só o dono, e só fora do catálogo
//   bloquear, apagar ........... só o dono
//   pedir aprovação ............ só o dono
//   denunciar .................. qualquer um logado, menos o dono
//
// O CATÁLOGO SÓ MOSTRA O QUE FOI APROVADO. Quiz novo nasce
// rascunho: é do dono, abre sala privada por código, mas não
// aparece para estranhos nem vale no ranking. Ver
// servicos/moderacao.js.
//
// O catálogo é a porta de entrada do site, então ler não pede
// login. Mudar pede, e mudar o que é de outra pessoa não é
// permitido a ninguém — é o que separa "copiar para mexer" de
// "mexer no que já funciona".
//
// O gabarito é a exceção que vale repetir: GET /:id devolve a
// alternativa correta só para o dono. Catálogo aberto não pode
// virar lista de respostas.
// ============================================================

import express, { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirLogin, loginOpcional } from "../middlewares/autenticacao.js";
import { limitar } from "../middlewares/limite.js";
import { ErroIA } from "../servicos/ia.js";
import { LIMITE_CAPA_BYTES, tipoPelosBytes } from "../servicos/capa.js";
import {
  analisarComIA,
  carregarParaModeracao,
  marcarEditado,
  registrarDenuncia
} from "../servicos/moderacao.js";
import {
  lerInteiro,
  validarTitulo,
  validarDescricao,
  validarCategoria,
  validarIcone,
  validarTema,
  validarPerguntas,
  validarDenuncia,
  MIN_PERGUNTAS
} from "../util/validacao.js";

const router = Router();

// Toda rota aqui sabe QUEM é, mesmo quando não é ninguém: as
// públicas usam isso para marcar o que é seu, e as privadas
// acrescentam exigirLogin uma por uma. Preferi repetir o
// exigirLogin em cada rota a trocá-lo por um router.use parcial
// — assim quem lê a definição da rota vê a permissão dela ali, e
// uma rota nova nasce com a decisão explícita em vez de herdar
// silenciosamente a de cima.
router.use(loginOpcional);

const MENSAGEM_PUBLICADO =
  "Quiz no catálogo não se edita. Para mudar o conteúdo, use Duplicar: a cópia é sua e passa pela aprovação de novo.";

/**
 * Responde por que uma edição não aconteceu: o quiz não existe
 * (ou não é seu — para quem não é dono, dá no mesmo), ou está
 * publicado e por isso travado.
 */
async function responderNaoEditavel(res, id, usuarioId) {
  const { rows } = await pool.query(
    "SELECT situacao FROM quizzes WHERE id = $1 AND usuario_id = $2",
    [id, usuarioId]
  );

  if (rows[0]?.situacao === "publicado") return res.status(409).json({ erro: MENSAGEM_PUBLICADO });
  return res.status(404).json({ erro: "Quiz não encontrado" });
}

/** Lê o :id da URL. Devolve null se não for um inteiro válido. */
function lerId(valor) {
  return lerInteiro(valor, { padrao: null, minimo: 1, maximo: 2147483647 });
}

/**
 * GET /api/quizzes
 *
 * O catálogo. Público: é a primeira tela do site.
 *
 * Traz a contagem de perguntas junto para o front não ter que
 * buscar cada quiz inteiro só para contar.
 *
 * ?categoria=anime  limita a uma categoria
 * ?meus=1           só os seus (exige sessão; sem ela, vem vazio)
 * ?autor=ID         só os publicados de uma pessoa (perfil público);
 *                   vazio se ela publica como anônima
 */
router.get("/", async (req, res, next) => {
  try {
    const pedida = req.query.categoria;
    const categoriaFiltro = validarCategoria(pedida) === null && pedida ? pedida : null;

    // "Meus quizzes" sem estar logado devolve lista vazia, e não
    // o catálogo inteiro. Errar para o lado de mostrar menos:
    // devolver tudo a quem pediu "só os meus" seria mentir sobre
    // de quem são aquelas linhas.
    const soMeus = req.query.meus === "1";
    if (soMeus && !req.usuarioId) return res.json({ quizzes: [] });

    // ?autor=ID: os quizzes publicados de uma pessoa, para o perfil
    // público dela. Continua só o que está no catálogo — rascunho
    // alheio não aparece por aqui.
    const autorFiltro = req.query.autor === undefined ? null : lerId(req.query.autor);

    const { rows } = await pool.query(
      // O filtro é opcional: $2 nulo devolve tudo. Assim a mesma
      // consulta serve o catálogo inteiro e cada aba de categoria.
      // Os dois recortes de período saem de subconsultas sobre
      // `aberturas`. COUNT(*) FILTER faz as duas numa varredura
      // só do índice, em vez de uma subconsulta para cada.
      `SELECT q.id, q.titulo, q.descricao, q.categoria, q.criado_em,
              q.partidas, q.icone, q.tema, q.etiquetas,
              (CASE WHEN c.quiz_id IS NOT NULL
                         AND (q.situacao = 'publicado' OR q.usuario_id = $1)
                    THEN '/api/quizzes/' || q.id || '/capa?v=' || q.versao END) AS imagem_url,
              q.imagem_credito, q.imagem_pagina,
              (SELECT COUNT(*) FROM perguntas p
                WHERE p.quiz_id = q.id AND p.ativa)::int AS perguntas,
              (SELECT COUNT(*) FILTER (WHERE a.ocorrido_em >= now() - interval '7 days')
                 FROM aberturas a WHERE a.quiz_id = q.id)::int AS acessos_semana,
              (SELECT COUNT(*) FILTER (WHERE a.ocorrido_em >= inicio_do_dia())
                 FROM aberturas a WHERE a.quiz_id = q.id)::int AS acessos_hoje,
              (SELECT ROUND(AVG(v.nota), 1)::float FROM avaliacoes v
                 JOIN resultados r USING (sala, jogador_id)
                WHERE v.quiz_id = q.id AND r.vale_ranking) AS nota,
              (SELECT COUNT(*) FROM avaliacoes v
                 JOIN resultados r USING (sala, jogador_id)
                WHERE v.quiz_id = q.id AND r.vale_ranking)::int AS avaliacoes,
              ${camposDoAutor(1)},
              (q.usuario_id = $1) AS meu,
              q.situacao,
              -- Só faz sentido para o dono: pode apagar, ou já é do site?
              CASE WHEN q.usuario_id = $1 THEN quiz_e_do_site(q.id) END AS do_site,
              -- O motivo de uma recusa é conversa entre a moderação
              -- e o dono; não vai para a listagem de mais ninguém.
              CASE WHEN q.usuario_id = $1 THEN q.moderacao_motivo END AS moderacao_motivo
         FROM quizzes q
         LEFT JOIN usuarios u ON u.id = q.usuario_id
         LEFT JOIN capas c ON c.quiz_id = q.id
        WHERE (CASE WHEN $3::bool THEN q.usuario_id = $1
                    ELSE q.situacao = 'publicado' END)
          AND ($2::text IS NULL OR q.categoria = $2)
          AND ($4::int IS NULL OR q.usuario_id = $4)
          -- Pedir "os quizzes da pessoa X" não pode entregar os de quem
          -- publica como anônimo: seria o caminho para descobrir o autor.
          -- (Com $1 nulo a comparação dá nulo, e a linha fica de fora.)
          AND ($4::int IS NULL OR NOT u.anonimo OR u.id = $1)
        ORDER BY q.criado_em DESC`,
      // $1 pode ser nulo (visitante): aí `meu` vem nulo em toda
      // linha, que é a verdade — não há "seu" sem sessão.
      [req.usuarioId, categoriaFiltro, soMeus, autorFiltro]
    );

    res.json({ quizzes: rows });
  } catch (erro) {
    next(erro);
  }
});

/**
 * As colunas do autor, para quem está olhando (`viewer` é a posição
 * do parâmetro com o id de quem pede; o valor pode ser nulo).
 *
 * O autor só vai na resposta se existe e se quer aparecer. Quem
 * publica como anônimo (migração 023) é escondido AQUI, no servidor:
 * nome, id, cor e foto voltam nulos para os outros — esconder só na
 * tela deixaria tudo à vista na resposta da API. O próprio autor
 * continua se vendo.
 *
 * `autor_situacao` diz à tela POR QUE não há autor:
 *   'anonimo'       a pessoa existe e preferiu não aparecer;
 *   'desconhecido'  a conta foi apagada (o quiz do catálogo fica);
 *   null            há autor, nas outras colunas.
 */
function camposDoAutor(viewer) {
  const aparece = `(u.id IS NOT NULL AND (NOT u.anonimo OR u.id = $${viewer}))`;

  return `
              CASE WHEN ${aparece} THEN u.nome END AS autor,
              CASE WHEN ${aparece} THEN u.id END AS autor_id,
              CASE WHEN ${aparece} THEN u.cor END AS autor_cor,
              CASE WHEN ${aparece} THEN
                (SELECT '/api/usuarios/' || f.usuario_id || '/foto?v=' || floor(extract(epoch FROM f.enviada_em))::bigint
                   FROM fotos_perfil f WHERE f.usuario_id = u.id) END AS autor_foto,
              CASE WHEN ${aparece} THEN NULL
                   WHEN u.id IS NULL THEN 'desconhecido'
                   ELSE 'anonimo' END AS autor_situacao`;
}

/**
 * GET /api/quizzes/:id
 *
 * O quiz inteiro: perguntas e alternativas, na ordem.
 *
 * São duas consultas e uma montagem em JavaScript, em vez de um
 * JOIN só. Com JOIN, um quiz de 10 perguntas com 4 alternativas
 * cada volta em 40 linhas repetindo o enunciado 4 vezes — e o
 * código para remontar a árvore a partir disso é pior do que
 * este. Duas idas ao banco custam menos que isso.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rows: quizzes } = await pool.query(
      `SELECT q.id, q.titulo, q.descricao, q.categoria, q.criado_em,
              q.partidas, q.icone, q.tema, q.etiquetas,
              (CASE WHEN c.quiz_id IS NOT NULL
                         AND (q.situacao = 'publicado' OR q.usuario_id = $2)
                    THEN '/api/quizzes/' || q.id || '/capa?v=' || q.versao END) AS imagem_url,
              q.imagem_credito, q.imagem_pagina,
              (SELECT ROUND(AVG(v.nota), 1)::float FROM avaliacoes v
                 JOIN resultados r USING (sala, jogador_id)
                WHERE v.quiz_id = q.id AND r.vale_ranking) AS nota,
              (SELECT COUNT(*) FROM avaliacoes v
                 JOIN resultados r USING (sala, jogador_id)
                WHERE v.quiz_id = q.id AND r.vale_ranking)::int AS avaliacoes,
              ${camposDoAutor(2)},
              (q.usuario_id = $2) AS meu,
              q.situacao, q.moderacao_motivo
         FROM quizzes q
         LEFT JOIN usuarios u ON u.id = q.usuario_id
         LEFT JOIN capas c ON c.quiz_id = q.id
        WHERE q.id = $1`,
      [id, req.usuarioId]
    );

    // Rascunho, recusado ou em revisão é invisível para quem não é
    // o dono — e 404, não 403: dizer "existe, mas não pode ver" já
    // entrega que aquele id existe.
    if (
      quizzes.length === 0 ||
      (quizzes[0].situacao !== "publicado" && quizzes[0].meu !== true)
    ) {
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    if (quizzes[0].meu !== true) delete quizzes[0].moderacao_motivo;

    // DONO VÊ O QUIZ; VISITANTE VÊ A VITRINE.
    //
    // Esta é a linha mais importante da rota. O editor precisa do
    // gabarito e das perguntas aposentadas; o catálogo público
    // precisa de título, capa e de quantas perguntas tem. Se os
    // dois recebessem a mesma coisa, bastaria abrir o DevTools
    // antes de entrar na sala para jogar sabendo todas as
    // respostas.
    //
    // Some `correta` e somem as inativas — que são rascunho
    // aposentado, e não interessam a quem está só olhando.
    const dono = quizzes[0].meu === true;

    const { rows: linhas } = await pool.query(
      `SELECT p.id, p.ordem, p.enunciado, p.segundos, p.ativa,
              a.id AS alternativa_id, a.ordem AS alternativa_ordem,
              a.texto, a.correta
         FROM perguntas p
         LEFT JOIN alternativas a ON a.pergunta_id = p.id
        WHERE p.quiz_id = $1
        -- Três critérios, e o do meio evita um bug sutil: desde
        -- que a posição passou a ser exclusiva só entre as
        -- ativas, duas perguntas podem ter a mesma ordem (uma
        -- ativa, outra não). Sem desempatar por id, as linhas
        -- das duas se intercalam — e o agrupamento abaixo, que
        -- só compara com a linha anterior, parte a mesma
        -- pergunta em vários pedaços.
        --
        -- O "ativa DESC" põe as da partida primeiro; as
        -- aposentadas ficam no fim, que é onde o editor deve
        -- mostrá-las.
        ORDER BY p.ativa DESC, p.ordem, p.id, a.ordem`,
      [id]
    );

    // LEFT JOIN acima: uma pergunta sem alternativa nenhuma (que
    // não deveria existir, mas pode aparecer com dado inserido na
    // mão) continua aparecendo, em vez de sumir do resultado.
    const perguntas = [];
    let atual = null;

    for (const linha of linhas) {
      if (!atual || atual.id !== linha.id) {
        atual = {
          id: linha.id,
          ordem: linha.ordem,
          enunciado: linha.enunciado,
          segundos: linha.segundos,
          ativa: linha.ativa,
          alternativas: []
        };
        perguntas.push(atual);
      }

      if (linha.alternativa_id !== null) {
        atual.alternativas.push({
          id: linha.alternativa_id,
          ordem: linha.alternativa_ordem,
          texto: linha.texto,
          // Omitir a chave é diferente de mandá-la falsa: um
          // `correta: false` em toda alternativa seria uma
          // afirmação errada. Ausente diz "não é da sua conta".
          ...(dono ? { correta: linha.correta } : {})
        });
      }
    }

    res.json({
      quiz: {
        ...quizzes[0],
        perguntas: dono ? perguntas : perguntas.filter((p) => p.ativa)
      }
    });
  } catch (erro) {
    next(erro);
  }
});

/**
 * POST /api/quizzes
 * body: { titulo, descricao?, categoria?, imagem?, perguntas: [...] }
 *
 * Cria o quiz COM as perguntas, numa transação só.
 *
 * Antes criava vazio e as perguntas vinham numa segunda
 * requisição. O problema não era de estilo: quando a segunda
 * falhava — validação, rede, aba fechada no meio —, sobrava um
 * quiz sem pergunta nenhuma. Ele aparecia no catálogo, não
 * abria sala, e ninguém sabia de onde tinha vindo.
 *
 * Quiz sem pergunta não é um quiz incompleto, é um quiz que não
 * existe. Então ou nasce inteiro, ou não nasce.
 */
router.post("/", exigirLogin, async (req, res, next) => {
  const { titulo, descricao, categoria, icone, imagem, perguntas, tema } = req.body ?? {};

  const erro =
    validarTitulo(titulo) ??
    validarDescricao(descricao) ??
    validarCategoria(categoria) ??
    validarIcone(icone) ??
    validarTema(tema) ??
    validarPerguntas(perguntas);

  if (erro) return res.status(400).json({ erro });

  // Uma conexão só: BEGIN, os INSERTs e COMMIT precisam
  // acontecer na mesma, senão o banco vê um BEGIN solto.
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    const { rows } = await cliente.query(
      `INSERT INTO quizzes
         (usuario_id, titulo, descricao, categoria, icone,
          imagem_url, imagem_credito, imagem_pagina, tema)
       VALUES ($1, $2, $3, COALESCE($4, 'geral'), $5, $6, $7, $8, $9)
       RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone, situacao,
                 imagem_url, imagem_credito, imagem_pagina, tema`,
      [
        req.usuarioId,
        titulo.trim(),
        descricao?.trim() || null,
        categoria ?? null,
        icone || null,
        // A capa é enviada depois, como arquivo, em PUT /:id/capa.
        null,
        null,
        null,
        tema?.trim() || null
      ]
    );

    await inserirPerguntas(cliente, rows[0].id, perguntas);

    await cliente.query("COMMIT");

    res.status(201).json({ quiz: { ...rows[0], perguntas } });
  } catch (erro) {
    // Falhou em qualquer ponto: desfaz tudo, inclusive o quiz.
    // É isso que impede o quiz órfão de existir.
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    cliente.release();
  }
});

/**
 * Insere as perguntas e alternativas de um quiz.
 *
 * Recebe o cliente de fora porque quem chama já está no meio de
 * uma transação — abrir outra aqui dentro quebraria a garantia
 * de tudo-ou-nada.
 */
async function inserirPerguntas(cliente, quizId, perguntas) {
  for (const [posicao, pergunta] of perguntas.entries()) {
    const { rows } = await cliente.query(
      `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos, ativa)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [quizId, posicao, pergunta.enunciado.trim(), pergunta.segundos, pergunta.ativa !== false]
    );

    for (const [ordem, alternativa] of pergunta.alternativas.entries()) {
      await cliente.query(
        `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
         VALUES ($1, $2, $3, $4)`,
        [rows[0].id, ordem, alternativa.texto.trim(), alternativa.correta === true]
      );
    }
  }
}

/**
 * PATCH /api/quizzes/:id
 * body: { titulo?, descricao? }
 */
router.patch("/:id", exigirLogin, async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { titulo, descricao, categoria, icone, tema } = req.body ?? {};

    const erro =
      (titulo !== undefined ? validarTitulo(titulo) : null) ??
      validarDescricao(descricao) ??
      validarCategoria(categoria) ??
      validarIcone(icone) ??
      validarTema(tema);

    if (erro) return res.status(400).json({ erro });

    // COALESCE($1, coluna): parâmetro nulo mantém o valor atual.
    // Evita montar um SQL diferente para cada combinação de campos.
    const { rows } = await pool.query(
      `UPDATE quizzes
          SET titulo    = COALESCE($1, titulo),
              descricao = COALESCE($2, descricao),
              -- Rascunho guarda a sugestão do gerador; depois da
              -- análise, a categoria é a que a IA definiu.
              categoria = CASE WHEN situacao IN ('rascunho', 'recusado')
                               THEN COALESCE($3, categoria) ELSE categoria END,
              icone     = COALESCE($4, icone),
              -- O tema é fixado uma vez e não muda mais: COALESCE
              -- ao contrário, o valor atual ganha do enviado.
              tema      = COALESCE(tema, $7)
        -- Publicado não se edita: o que está no catálogo é o que
        -- foi aprovado. Para mudar, duplica-se.
        WHERE id = $5 AND usuario_id = $6 AND situacao <> 'publicado'
        RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone, situacao,
                  imagem_url, imagem_credito, imagem_pagina, tema`,
      [
        titulo?.trim() ?? null,
        descricao?.trim() ?? null,
        categoria ?? null,
        icone || null,
        id,
        req.usuarioId,
        tema?.trim() || null
      ]
    );

    if (rows.length === 0) return responderNaoEditavel(res, id, req.usuarioId);

    // Título e descrição também são conteúdo: a versão sobe e uma
    // análise em andamento deixa de valer.
    const situacao = await marcarEditado(pool, id);

    res.json({ quiz: { ...rows[0], situacao } });
  } catch (erro) {
    next(erro);
  }
});

/**
 * PATCH /api/quizzes/:id/perguntas/:perguntaId
 * body: { ativa }
 *
 * Liga ou desliga UMA pergunta, na hora.
 *
 * Existe separado do PUT porque num quiz já apresentado não há
 * "salvar": a única mudança permitida é tirar uma pergunta de
 * circulação, e isso tem que valer no clique. Um botão que só
 * surte efeito depois de outro botão é um convite a esquecer o
 * segundo.
 */
router.patch("/:id/perguntas/:perguntaId", exigirLogin, async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    const perguntaId = lerId(req.params.perguntaId);

    if (id === null || perguntaId === null) {
      return res.status(400).json({ erro: "Id inválido" });
    }

    const { ativa } = req.body ?? {};

    if (typeof ativa !== "boolean") {
      return res.status(400).json({ erro: "Informe se a pergunta fica ativa" });
    }

    // A ORDEM destas duas checagens importa, e eu errei nela
    // antes: a contagem vinha primeiro e, para quem não é dono,
    // ela devolvia zero — o que disparava "esta é a última
    // pergunta ativa" num quiz que a pessoa nem podia ver. Além
    // de confuso, isso confirmava que o quiz existe.
    //
    // Primeiro: é sua? Depois: a regra do jogo.
    const { rows: donas } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE p.ativa)::int AS ativas
         FROM perguntas p
         JOIN quizzes q ON q.id = p.quiz_id
        WHERE p.quiz_id = $1 AND q.usuario_id = $2`,
      [id, req.usuarioId]
    );

    const { rows: existe } = await pool.query(
      `SELECT 1
         FROM perguntas p
         JOIN quizzes q ON q.id = p.quiz_id
        WHERE p.id = $1 AND p.quiz_id = $2 AND q.usuario_id = $3`,
      [perguntaId, id, req.usuarioId]
    );

    if (existe.length === 0) {
      return res.status(404).json({ erro: "Pergunta não encontrada" });
    }

    // Bloquear abaixo do mínimo deixaria o quiz sem poder abrir
    // sala. Num quiz travado — que não aceita pergunta nova —
    // isso não teria volta, então a recusa vem antes.
    if (!ativa && donas[0].ativas <= MIN_PERGUNTAS) {
      return res.status(400).json({
        erro: `O quiz precisa de pelo menos ${MIN_PERGUNTAS} perguntas ativas. Desbloqueie outra antes de bloquear esta.`
      });
    }

    // O usuario_id entra no WHERE pelo mesmo motivo de sempre:
    // é ele que impede mexer na pergunta de outra pessoa
    // trocando o id na URL.
    const { rows } = await pool.query(
      `UPDATE perguntas p
          SET ativa = $1
         FROM quizzes q
        WHERE p.id = $2
          AND p.quiz_id = $3
          AND q.id = p.quiz_id
          AND q.usuario_id = $4
        RETURNING p.id, p.ativa`,
      [ativa, perguntaId, id, req.usuarioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Pergunta não encontrada" });
    }

    res.json({ pergunta: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

/**
 * POST /api/quizzes/:id/copia
 *
 * Cria uma cópia independente do quiz, para quem quiser mudar
 * sem mexer no original.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * Um quiz que foi apresentado dezenas de vezes é um quiz que
 * funciona: as perguntas foram testadas com gente de verdade.
 * Deixar qualquer um editá-lo é deixar qualquer um estragá-lo —
 * por descuido ou de propósito — e o estrago cai em cima de
 * todas as apresentações futuras.
 *
 * Copiar resolve sem proibir nada: quem quer mudar leva uma
 * versão própria e mexe à vontade. O original segue intacto.
 * É o mesmo raciocínio de um fork.
 *
 * O que a cópia NÃO leva: o histórico de acessos. A audiência é
 * do original, não vem de brinde — uma cópia nascer com 300
 * acessos seria mentira sobre algo que nunca foi apresentado.
 *
 * Só perguntas ATIVAS vêm junto: as desativadas foram
 * aposentadas por algum motivo, e carregar o lixo de outro quiz
 * para dentro do novo não ajudaria ninguém.
 */
router.post("/:id/copia", exigirLogin, async (req, res, next) => {
  const id = lerId(req.params.id);
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    // Sem usuario_id no WHERE, de propósito: copiar vale para
    // qualquer quiz do catálogo, não só para os seus. É o que
    // torna o catálogo público utilizável — quem gostou de um
    // quiz alheio leva uma versão própria em vez de pedir
    // permissão para mexer no original.
    //
    // A cópia nasce no nome de quem copiou (o usuario_id do
    // INSERT abaixo é req.usuarioId), então editar a cópia é
    // editar o que é seu.
    // Publicado (está no catálogo) ou seu. Copiar o rascunho de
    // outra pessoa seria ler o que ela ainda não mostrou a ninguém.
    // A cópia nasce rascunho, como todo quiz novo: o conteúdo pode
    // ser o mesmo, mas quem vai mexer nele é outra pessoa.
    const { rows: originais } = await cliente.query(
      `SELECT titulo, descricao, categoria, icone, tema,
              imagem_url, imagem_credito, imagem_pagina
         FROM quizzes
        WHERE id = $1 AND (situacao = 'publicado' OR usuario_id = $2)`,
      [id, req.usuarioId]
    );

    if (originais.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    const original = originais[0];

    const { rows: criados } = await cliente.query(
      `INSERT INTO quizzes
         (usuario_id, titulo, descricao, categoria, icone,
          imagem_url, imagem_credito, imagem_pagina, tema)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone, situacao,
                 imagem_url, imagem_credito, imagem_pagina, tema`,
      [
        req.usuarioId,
        `${original.titulo} (cópia)`.slice(0, 140),
        original.descricao,
        original.categoria,
        original.icone,
        null,
        original.imagem_credito,
        original.imagem_pagina,
        original.tema
      ]
    );

    const novoId = criados[0].id;

    // A capa vem junto, como arquivo. A cópia é rascunho: quando o
    // novo dono pedir aprovação, a IA olha a capa de novo.
    await cliente.query(
      "INSERT INTO capas (quiz_id, tipo, bytes) SELECT $1, tipo, bytes FROM capas WHERE quiz_id = $2",
      [novoId, id]
    );

    // Copia perguntas e alternativas no banco, sem trazer para o
    // servidor e devolver. INSERT ... SELECT faz o trabalho de
    // uma vez; buscar 50 perguntas com 200 alternativas só para
    // reinseri-las seria trabalho à toa.
    const { rows: copiadas } = await cliente.query(
      `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos, ativa)
       SELECT $1, ordem, enunciado, segundos, TRUE
         FROM perguntas
        WHERE quiz_id = $2 AND ativa
        ORDER BY ordem
       RETURNING id, ordem`,
      [novoId, id]
    );

    // As alternativas precisam achar a pergunta NOVA que
    // corresponde à antiga. A posição (ordem) é o que liga as
    // duas, já que os ids são outros.
    for (const nova of copiadas) {
      await cliente.query(
        `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
         SELECT $1, a.ordem, a.texto, a.correta
           FROM alternativas a
           JOIN perguntas p ON p.id = a.pergunta_id
          WHERE p.quiz_id = $2 AND p.ativa AND p.ordem = $3`,
        [nova.id, id, nova.ordem]
      );
    }

    await cliente.query("COMMIT");

    res.status(201).json({ quiz: { ...criados[0], perguntas: copiadas.length } });
  } catch (erro) {
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    cliente.release();
  }
});

/**
 * POST /api/quizzes/:id/publicar
 *
 * O dono pede para o quiz entrar no catálogo. A IA lê tudo e
 * decide na hora: publicado, recusado (com o motivo) ou revisão
 * por um humano.
 *
 * É pedido, não automático. Quiz para jogar com os amigos não
 * precisa passar por ninguém; o que precisa de aprovação é
 * aparecer para estranhos e valer pontos no ranking.
 */
router.post(
  "/:id/publicar",
  exigirLogin,
  // Cada pedido é uma chamada à IA, e a cota é do projeto todo.
  limitar({ nome: "publicar", max: 20, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const id = lerId(req.params.id);
      if (id === null) return res.status(400).json({ erro: "Id inválido" });

      const quiz = await carregarParaModeracao(id);

      if (!quiz || quiz.usuario_id !== req.usuarioId) {
        return res.status(404).json({ erro: "Quiz não encontrado" });
      }

      // Pedir de novo o que já está publicado não gasta IA.
      if (quiz.situacao === "publicado") {
        return res.json({ quiz: { id, situacao: "publicado" } });
      }

      if (quiz.situacao === "revisao") {
        return res.status(409).json({
          erro: "Este quiz está esperando a revisão de um administrador."
        });
      }

      if (quiz.ativas < MIN_PERGUNTAS) {
        return res.status(400).json({
          erro: `O quiz precisa de pelo menos ${MIN_PERGUNTAS} perguntas ativas para ir ao catálogo.`
        });
      }

      let resultado;

      try {
        resultado = await analisarComIA(quiz);
      } catch (erro) {
        if (!(erro instanceof ErroIA)) throw erro;

        // A IA não respondeu: o quiz continua como estava. Falhar
        // aberto aqui — publicar porque não deu para analisar —
        // seria entregar o catálogo justamente quando a proteção
        // está fora do ar.
        return res.status(erro.codigo === "cota" ? 429 : 503).json({ erro: erro.message });
      }

      if (resultado.mudou) {
        return res.status(409).json({
          erro: "O quiz foi editado durante a análise. Envie de novo para analisar a versão atual."
        });
      }

      res.json({
        quiz: { id, situacao: resultado.situacao, moderacao_motivo: resultado.motivo }
      });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * POST /api/quizzes/:id/denuncias
 * body: { motivo, detalhe? }
 *
 * A rede de segurança para o que a IA deixar passar. Exige conta:
 * denúncia anônima seria o jeito mais barato de derrubar o quiz de
 * outra pessoa. Uma aberta por pessoa por quiz; com três pessoas
 * diferentes, o quiz sai do ar até um administrador olhar.
 */
router.post(
  "/:id/denuncias",
  exigirLogin,
  limitar({ nome: "denunciar", max: 20, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const id = lerId(req.params.id);
      if (id === null) return res.status(400).json({ erro: "Id inválido" });

      const { motivo, detalhe } = req.body ?? {};
      const erro = validarDenuncia({ motivo, detalhe });
      if (erro) return res.status(400).json({ erro });

      const { rows } = await pool.query(
        "SELECT usuario_id, situacao FROM quizzes WHERE id = $1",
        [id]
      );

      // Só se denuncia o que está no catálogo: rascunho alheio
      // não é visível, e fingir que não existe é a resposta certa.
      if (rows.length === 0 || rows[0].situacao !== "publicado") {
        return res.status(404).json({ erro: "Quiz não encontrado" });
      }

      if (rows[0].usuario_id === req.usuarioId) {
        return res.status(400).json({ erro: "Não dá para denunciar o próprio quiz" });
      }

      const { registrada } = await registrarDenuncia({
        quizId: id,
        usuarioId: req.usuarioId,
        motivo,
        detalhe: detalhe?.trim() || null
      });

      if (!registrada) {
        return res.status(409).json({ erro: "Você já denunciou este quiz. Obrigado — ele está na fila." });
      }

      res.status(201).json({ denuncia: { recebida: true } });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * GET /api/quizzes/:id/capa
 *
 * A imagem de capa, servida daqui. Quem pode ver o quiz vê a capa:
 * qualquer um, se publicado; o dono e os administradores, sempre —
 * o administrador precisa ver a capa de um quiz em revisão para
 * decidir sobre ele.
 */
router.get("/:id/capa", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rows } = await pool.query(
      `SELECT c.tipo, c.bytes, q.situacao, q.usuario_id,
              COALESCE((SELECT admin FROM usuarios WHERE id = $2), FALSE) AS admin
         FROM capas c
         JOIN quizzes q ON q.id = c.quiz_id
        WHERE c.quiz_id = $1`,
      [id, req.usuarioId]
    );

    const capa = rows[0];
    const pode = capa && (capa.situacao === "publicado" || capa.usuario_id === req.usuarioId || capa.admin);
    if (!pode) return res.status(404).json({ erro: "Capa não encontrada" });

    res.set({
      "Content-Type": capa.tipo,
      // Sem isto, um navegador antigo poderia "adivinhar" que os
      // bytes são HTML e executar. O tipo é o que dissemos.
      "X-Content-Type-Options": "nosniff",
      // Publicado não muda (não se edita), e a URL carrega ?v=versao:
      // dá para guardar em cache à vontade. Rascunho é particular.
      "Cache-Control": capa.situacao === "publicado" ? "public, max-age=86400" : "private, no-store"
    });

    res.send(capa.bytes);
  } catch (erro) {
    next(erro);
  }
});

/**
 * Lê o crédito da imagem, que vem em cabeçalho porque o corpo é a
 * própria imagem. Só existe quando a capa veio da sugestão do
 * Wikimedia, que exige atribuição. Foto do próprio dono não tem.
 */
function lerCredito(req) {
  const ler = (nome, limite) => {
    const bruto = req.get(nome);
    if (!bruto) return null;
    try {
      return decodeURIComponent(bruto).trim().slice(0, limite) || null;
    } catch {
      return null;
    }
  };

  const pagina = ler("X-Capa-Pagina", 500);

  return {
    credito: ler("X-Capa-Credito", 200),
    // Só link https para a página da imagem; qualquer outra coisa
    // viraria um link arbitrário exibido no site.
    pagina: pagina?.startsWith("https://") ? pagina : null
  };
}

/**
 * PUT /api/quizzes/:id/capa
 * corpo: o arquivo da imagem (Content-Type image/png, jpeg ou webp)
 *
 * O dono envia a capa. O editor já manda recortada em 3:4 e
 * reduzida a 600x800, mas quem chamar a API direto pode mandar
 * qualquer coisa — por isso o tipo é conferido pelos bytes, e não
 * pelo Content-Type.
 *
 * Trocar a capa é editar o conteúdo: a versão sobe (invalidando uma
 * análise em andamento) e quiz publicado não troca.
 */
router.put(
  "/:id/capa",
  exigirLogin,
  limitar({ nome: "capa", max: 60, janela: 60 * 60, chave: (req) => req.usuarioId }),
  // Lê o corpo como bytes, só nesta rota. O limite é o da tabela;
  // acima disso o leitor nem termina de receber.
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: LIMITE_CAPA_BYTES }),
  async (req, res, next) => {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ erro: "Envie a imagem como PNG, JPEG ou WEBP" });
    }

    const tipo = tipoPelosBytes(bytes);
    if (!tipo) return res.status(400).json({ erro: "O arquivo não é uma imagem PNG, JPEG ou WEBP" });

    const { credito, pagina } = lerCredito(req);
    const cliente = await pool.connect();

    try {
      await cliente.query("BEGIN");

      const { rows } = await cliente.query(
        "SELECT situacao FROM quizzes WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
        [id, req.usuarioId]
      );

      if (rows.length === 0) {
        await cliente.query("ROLLBACK");
        return res.status(404).json({ erro: "Quiz não encontrado" });
      }
      if (rows[0].situacao === "publicado") {
        await cliente.query("ROLLBACK");
        return res.status(409).json({ erro: MENSAGEM_PUBLICADO });
      }

      await cliente.query(
        `INSERT INTO capas (quiz_id, tipo, bytes) VALUES ($1, $2, $3)
         ON CONFLICT (quiz_id) DO UPDATE
           SET tipo = EXCLUDED.tipo, bytes = EXCLUDED.bytes, enviada_em = now()`,
        [id, tipo, bytes]
      );

      await cliente.query(
        "UPDATE quizzes SET imagem_credito = $2, imagem_pagina = $3 WHERE id = $1",
        [id, credito, pagina]
      );

      const situacao = await marcarEditado(cliente, id);
      const { rows: depois } = await cliente.query("SELECT versao FROM quizzes WHERE id = $1", [id]);

      await cliente.query("COMMIT");

      res.json({ capa: { url: `/api/quizzes/${id}/capa?v=${depois[0].versao}` }, situacao });
    } catch (erro) {
      await cliente.query("ROLLBACK");
      next(erro);
    } finally {
      cliente.release();
    }
  }
);

/**
 * DELETE /api/quizzes/:id/capa
 *
 * Tira a capa; o quiz volta ao desenho da categoria. Também é
 * edição de conteúdo, com as mesmas regras de trocar.
 */
router.delete("/:id/capa", exigirLogin, async (req, res, next) => {
  const id = lerId(req.params.id);
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    const { rows } = await cliente.query(
      "SELECT situacao FROM quizzes WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
      [id, req.usuarioId]
    );

    if (rows.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }
    if (rows[0].situacao === "publicado") {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ erro: MENSAGEM_PUBLICADO });
    }

    await cliente.query("DELETE FROM capas WHERE quiz_id = $1", [id]);
    await cliente.query(
      "UPDATE quizzes SET imagem_credito = NULL, imagem_pagina = NULL WHERE id = $1",
      [id]
    );
    const situacao = await marcarEditado(cliente, id);

    await cliente.query("COMMIT");
    res.json({ situacao });
  } catch (erro) {
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    cliente.release();
  }
});

/**
 * DELETE /api/quizzes/:id
 *
 * As perguntas e alternativas vão junto, pelo ON DELETE CASCADE.
 */
const MENSAGEM_DO_SITE =
  "Este quiz já faz parte do catálogo, e quem jogou conta com ele: ele continua no site com o seu nome como autor. " +
  "Para mudar alguma coisa, duplique.";

router.delete("/:id", exigirLogin, async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    // Quiz que entrou no catálogo é do site (migração 017): apagar
    // levaria junto partidas, notas e pontos de quem jogou. O autor
    // pode duplicar, bloquear perguntas, pedir revisão — apagar, não.
    const { rows } = await pool.query(
      `DELETE FROM quizzes
        WHERE id = $1 AND usuario_id = $2 AND NOT quiz_e_do_site(id)
        RETURNING id`,
      [id, req.usuarioId]
    );

    if (rows.length === 0) {
      const { rows: existe } = await pool.query(
        "SELECT 1 FROM quizzes WHERE id = $1 AND usuario_id = $2",
        [id, req.usuarioId]
      );
      if (existe.length === 0) return res.status(404).json({ erro: "Quiz não encontrado" });
      return res.status(409).json({ erro: MENSAGEM_DO_SITE });
    }

    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

/**
 * PUT /api/quizzes/:id/perguntas
 * body: { perguntas: [{ enunciado, segundos, alternativas: [{ texto, correta }] }] }
 *
 * Substitui TODAS as perguntas do quiz de uma vez.
 *
 * Por que substituir tudo em vez de ter rotas separadas para
 * criar, editar e apagar cada pergunta: o editor é uma tela só,
 * onde a pessoa mexe em várias perguntas, reordena e salva no
 * fim. Mandar o conjunto inteiro faz o estado da tela e o estado
 * do banco serem a mesma coisa — não existe "salvei a pergunta 3
 * mas não a 4".
 *
 * O preço é que isso só funciona dentro de uma TRANSAÇÃO.
 */
router.put("/:id/perguntas", exigirLogin, async (req, res, next) => {
  const id = lerId(req.params.id);
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const { perguntas } = req.body ?? {};

  const erro = validarPerguntas(perguntas);
  if (erro) return res.status(400).json({ erro });

  // Pega UMA conexão do pool e segura.
  //
  // Isso é obrigatório numa transação: BEGIN, os comandos e
  // COMMIT precisam acontecer todos na mesma conexão. Se usasse
  // `pool.query` direto, cada comando poderia sair por uma
  // conexão diferente — e o banco veria um BEGIN sozinho numa, um
  // INSERT solto noutra.
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    // O dono é conferido DENTRO da transação. Fora dela, alguém
    // poderia apagar o quiz entre a checagem e a escrita.
    const { rows: donos } = await cliente.query(
      "SELECT id, situacao FROM quizzes WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
      [id, req.usuarioId]
    );

    if (donos.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    if (donos[0].situacao === "publicado") {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ erro: MENSAGEM_PUBLICADO });
    }

    // Apaga tudo e reinsere. As alternativas somem junto pelo
    // CASCADE. Parece desperdício, mas é o que torna o resultado
    // igual ao que a tela mostra — tentar descobrir o que mudou
    // (o "diff") é mais código e mais chance de erro, para um
    // conjunto de no máximo 50 perguntas.
    // ----- nada é apagado aqui -----
    //
    // Antes este bloco fazia DELETE de tudo e reinseria. Era
    // simples e destrutivo: cada salvamento trocava os ids das
    // perguntas, e qualquer histórico ligado a elas virava pó.
    //
    // Agora: quem veio com id é atualizado; quem veio sem id é
    // criado; e quem estava no banco e NÃO veio é DESATIVADO,
    // nunca removido.
    const { rows: existentes } = await cliente.query(
      "SELECT id FROM perguntas WHERE quiz_id = $1",
      [id]
    );

    const idsNoBanco = new Set(existentes.map((linha) => linha.id));
    const idsRecebidos = new Set();

    // Tira todas as posições do caminho antes de reatribuir.
    //
    // Reordenar no lugar colide: mover a pergunta 2 para a
    // posição 1 esbarra na que ainda está lá. Jogando todas
    // para o negativo primeiro, o intervalo 0..n fica livre — e
    // os negativos continuam únicos entre si, porque vieram de
    // posições que já eram únicas.
    await cliente.query(
      "UPDATE perguntas SET ordem = -ordem - 1 WHERE quiz_id = $1",
      [id]
    );

    for (const [posicao, pergunta] of perguntas.entries()) {
      // Só aceita id que pertence a ESTE quiz. Sem a checagem,
      // mandar o id de uma pergunta alheia faria o UPDATE mexer
      // no quiz de outra pessoa.
      const idValido = Number.isInteger(pergunta.id) && idsNoBanco.has(pergunta.id);

      let perguntaId;

      if (idValido) {
        await cliente.query(
          `UPDATE perguntas
              SET ordem = $1, enunciado = $2, segundos = $3, ativa = $4
            WHERE id = $5`,
          [
            posicao,
            pergunta.enunciado.trim(),
            pergunta.segundos,
            pergunta.ativa !== false,
            pergunta.id
          ]
        );

        perguntaId = pergunta.id;

        // As alternativas, sim, são trocadas: elas não carregam
        // histórico próprio, e casar texto a texto seria pior
        // do que refazer.
        await cliente.query("DELETE FROM alternativas WHERE pergunta_id = $1", [perguntaId]);
      } else {
        const { rows } = await cliente.query(
          `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos, ativa)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [id, posicao, pergunta.enunciado.trim(), pergunta.segundos, pergunta.ativa !== false]
        );

        perguntaId = rows[0].id;
      }

      idsRecebidos.add(perguntaId);

      for (const [ordem, alternativa] of pergunta.alternativas.entries()) {
        await cliente.query(
          `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
           VALUES ($1, $2, $3, $4)`,
          [perguntaId, ordem, alternativa.texto.trim(), alternativa.correta === true]
        );
      }
    }

    // Sumiu da tela? Desativa. Não apaga.
    const sumiram = [...idsNoBanco].filter((idExistente) => !idsRecebidos.has(idExistente));

    if (sumiram.length > 0) {
      await cliente.query(
        "UPDATE perguntas SET ativa = FALSE WHERE id = ANY($1::int[])",
        [sumiram]
      );
    }

    // Perguntas novas ou trocadas precisam ser lidas pela
    // moderação: o quiz sai do catálogo até ser aprovado de novo.
    const situacao = await marcarEditado(cliente, id);

    // Até aqui, nada do que foi feito existe para mais ninguém.
    // É o COMMIT que torna tudo visível, de uma vez.
    await cliente.query("COMMIT");

    res.json({ ok: true, perguntas: perguntas.length, situacao });
  } catch (erro) {
    // Qualquer falha no meio desfaz TUDO — inclusive o DELETE lá
    // de cima. Sem isso, um erro na décima pergunta deixaria o
    // quiz com as nove primeiras e o resto perdido: pior do que
    // ter falhado inteiro.
    await cliente.query("ROLLBACK");
    next(erro);
  } finally {
    // Devolve a conexão ao pool, sempre. Esquecer isto é um
    // vazamento: depois de algumas requisições o pool esvazia e a
    // aplicação trava esperando conexão que nunca volta.
    cliente.release();
  }
});

export default router;
