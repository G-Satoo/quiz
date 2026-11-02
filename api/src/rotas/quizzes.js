// ============================================================
// Rotas de quizzes
// Prefixo: /api/quizzes  (todas exigem login)
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import {
  lerInteiro,
  validarTitulo,
  validarCategoria,
  validarIcone,
  validarPerguntas
} from "../util/validacao.js";

const router = Router();

router.use(exigirLogin);

/** Lê o :id da URL. Devolve null se não for um inteiro válido. */
function lerId(valor) {
  return lerInteiro(valor, { padrao: null, minimo: 1, maximo: 2147483647 });
}

/**
 * GET /api/quizzes
 *
 * Lista os quizzes do usuário com a contagem de perguntas — é o
 * que a tela de lista mostra, e evita o front ter que buscar
 * cada quiz inteiro só para contar.
 */
router.get("/", async (req, res, next) => {
  try {
    const pedida = req.query.categoria;
    const categoriaFiltro = validarCategoria(pedida) === null && pedida ? pedida : null;

    const { rows } = await pool.query(
      // O filtro é opcional: $2 nulo devolve tudo. Assim a mesma
      // consulta serve o catálogo inteiro e cada aba de categoria.
      // Os dois recortes de período saem de subconsultas sobre
      // `aberturas`. COUNT(*) FILTER faz as duas numa varredura
      // só do índice, em vez de uma subconsulta para cada.
      `SELECT q.id, q.titulo, q.descricao, q.categoria, q.criado_em,
              q.partidas, q.icone,
              q.imagem_url, q.imagem_credito, q.imagem_pagina,
              (SELECT COUNT(*) FROM perguntas p
                WHERE p.quiz_id = q.id AND p.ativa)::int AS perguntas,
              (SELECT COUNT(*) FILTER (WHERE a.ocorrido_em >= now() - interval '7 days')
                 FROM aberturas a WHERE a.quiz_id = q.id)::int AS acessos_semana,
              (SELECT COUNT(*) FILTER (WHERE a.ocorrido_em >= date_trunc('day', now()))
                 FROM aberturas a WHERE a.quiz_id = q.id)::int AS acessos_hoje
         FROM quizzes q
        WHERE q.usuario_id = $1
          AND ($2::text IS NULL OR q.categoria = $2)
        ORDER BY q.criado_em DESC`,
      [req.usuarioId, categoriaFiltro]
    );

    res.json({ quizzes: rows });
  } catch (erro) {
    next(erro);
  }
});

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
      `SELECT id, titulo, descricao, categoria, criado_em, partidas, icone,
              imagem_url, imagem_credito, imagem_pagina
         FROM quizzes
        WHERE id = $1 AND usuario_id = $2`,
      [id, req.usuarioId]
    );

    // 404 e não 403: dizer "existe, mas não é seu" já entrega que
    // aquele id existe. Para quem não é dono, o quiz não existe.
    if (quizzes.length === 0) {
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

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
          correta: linha.correta
        });
      }
    }

    res.json({ quiz: { ...quizzes[0], perguntas } });
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
router.post("/", async (req, res, next) => {
  const { titulo, descricao, categoria, icone, imagem, perguntas } = req.body ?? {};

  const erro =
    validarTitulo(titulo) ??
    validarCategoria(categoria) ??
    validarIcone(icone) ??
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
          imagem_url, imagem_credito, imagem_pagina)
       VALUES ($1, $2, $3, COALESCE($4, 'geral'), $5, $6, $7, $8)
       RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone,
                 imagem_url, imagem_credito, imagem_pagina`,
      [
        req.usuarioId,
        titulo.trim(),
        descricao?.trim() || null,
        categoria ?? null,
        icone || null,
        imagem?.url || null,
        imagem?.autor ? `${imagem.autor} · ${imagem.licenca}` : null,
        imagem?.pagina || null
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
router.patch("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { titulo, descricao, categoria, icone, imagem } = req.body ?? {};

    const erro =
      (titulo !== undefined ? validarTitulo(titulo) : null) ??
      validarCategoria(categoria) ??
      validarIcone(icone);

    if (erro) return res.status(400).json({ erro });

    // COALESCE($1, coluna): parâmetro nulo mantém o valor atual.
    // Evita montar um SQL diferente para cada combinação de campos.
    const { rows } = await pool.query(
      `UPDATE quizzes
          SET titulo    = COALESCE($1, titulo),
              descricao = COALESCE($2, descricao),
              categoria = COALESCE($3, categoria),
              icone     = COALESCE($4, icone),
              imagem_url     = COALESCE($5, imagem_url),
              imagem_credito = COALESCE($6, imagem_credito),
              imagem_pagina  = COALESCE($7, imagem_pagina)
        WHERE id = $8 AND usuario_id = $9
        RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone,
                  imagem_url, imagem_credito, imagem_pagina`,
      [
        titulo?.trim() ?? null,
        descricao?.trim() ?? null,
        categoria ?? null,
        icone || null,
        imagem?.url || null,
        imagem?.autor ? `${imagem.autor} · ${imagem.licenca}` : null,
        imagem?.pagina || null,
        id,
        req.usuarioId
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Quiz não encontrado" });
    }

    res.json({ quiz: rows[0] });
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
router.patch("/:id/perguntas/:perguntaId", async (req, res, next) => {
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

    // Bloquear a última ativa deixaria o quiz abrindo uma sala
    // que termina na primeira tela.
    if (!ativa && donas[0].ativas <= 1) {
      return res.status(400).json({
        erro: "Esta é a última pergunta ativa. O quiz precisa de pelo menos uma."
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
router.post("/:id/copia", async (req, res, next) => {
  const id = lerId(req.params.id);
  if (id === null) return res.status(400).json({ erro: "Id inválido" });

  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    // Hoje o catálogo mostra só os seus quizzes, então a cópia
    // exige ser dono. Quando o catálogo virar público — que é
    // para onde isto aponta —, esta checagem é a linha que
    // muda: copiar passa a valer para qualquer quiz visível,
    // enquanto editar continua exigindo ser dono.
    const { rows: originais } = await cliente.query(
      `SELECT titulo, descricao, categoria, icone,
              imagem_url, imagem_credito, imagem_pagina
         FROM quizzes
        WHERE id = $1 AND usuario_id = $2`,
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
          imagem_url, imagem_credito, imagem_pagina)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, titulo, descricao, categoria, criado_em, partidas, icone,
                 imagem_url, imagem_credito, imagem_pagina`,
      [
        req.usuarioId,
        `${original.titulo} (cópia)`.slice(0, 140),
        original.descricao,
        original.categoria,
        original.icone,
        original.imagem_url,
        original.imagem_credito,
        original.imagem_pagina
      ]
    );

    const novoId = criados[0].id;

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
 * DELETE /api/quizzes/:id
 *
 * As perguntas e alternativas vão junto, pelo ON DELETE CASCADE.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = lerId(req.params.id);
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rowCount } = await pool.query(
      "DELETE FROM quizzes WHERE id = $1 AND usuario_id = $2",
      [id, req.usuarioId]
    );

    if (rowCount === 0) return res.status(404).json({ erro: "Quiz não encontrado" });

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
router.put("/:id/perguntas", async (req, res, next) => {
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
      "SELECT id FROM quizzes WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
      [id, req.usuarioId]
    );

    if (donos.length === 0) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ erro: "Quiz não encontrado" });
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

    // Até aqui, nada do que foi feito existe para mais ninguém.
    // É o COMMIT que torna tudo visível, de uma vez.
    await cliente.query("COMMIT");

    res.json({ ok: true, perguntas: perguntas.length });
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
