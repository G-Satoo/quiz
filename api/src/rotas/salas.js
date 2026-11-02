// ============================================================
// Rotas de sala
// Prefixo: /api/salas
//
// Criar a sala é HTTP comum: acontece uma vez, o apresentador
// espera a resposta, e o resultado é um código. Só depois disso
// ele abre o WebSocket para conduzir a partida.
//
// A regra que separa as duas coisas: **HTTP para o que acontece
// uma vez e tem resposta; WebSocket para o que acontece o tempo
// todo e não foi pedido.**
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { limitar } from "../middlewares/limite.js";
import { gerarCodigo, normalizarCodigo } from "../util/codigo.js";
import { lerInteiro } from "../util/validacao.js";
import * as salas from "../tempo-real/salas.js";

const router = Router();

/**
 * GET /api/salas/:codigo
 *
 * Pública: é o que a tela de entrada do jogador chama para dizer
 * "sala encontrada, digite seu apelido" antes de abrir o
 * WebSocket. Devolve o mínimo — o título, para a pessoa confirmar
 * que entrou no lugar certo.
 */
router.get(
  "/:codigo",
  // Sem limite, isto vira um jeito confortável de varrer códigos
  // até achar salas abertas.
  limitar({ nome: "consulta-sala", max: 30, janela: 60 }),
  async (req, res, next) => {
    try {
      const codigo = normalizarCodigo(req.params.codigo);
      if (!codigo) return res.status(400).json({ erro: "Código inválido" });

      const sala = await salas.ler(codigo);
      if (!sala) return res.status(404).json({ erro: "Sala não encontrada" });

      res.json({
        sala: {
          codigo: sala.codigo,
          titulo: sala.titulo,
          fase: sala.fase,
          jogadores: (await salas.listarJogadores(codigo)).length
        }
      });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * POST /api/salas
 * body: { quiz_id }
 *
 * Abre uma sala para um quiz do catálogo.
 *
 * Pede login — a sala tem um apresentador, que precisa ser
 * alguém — mas não pede ser dono do quiz. Com o catálogo
 * público, exigir posse aqui deixaria a maior parte da vitrine
 * com um botão que só dá erro.
 *
 * Apresentar não muda o quiz: lê as perguntas e conta uma
 * abertura. O que muda conteúdo continua trancado no dono.
 */
router.post(
  "/",
  exigirLogin,
  limitar({ nome: "criar-sala", max: 30, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const quizId = lerInteiro(req.body?.quiz_id, {
        padrao: null,
        minimo: 1,
        maximo: 2147483647
      });

      if (quizId === null) return res.status(400).json({ erro: "Informe o quiz" });

      const { rows } = await pool.query(
        `SELECT q.id, q.titulo,
                (SELECT COUNT(*) FROM perguntas p
                  WHERE p.quiz_id = q.id AND p.ativa)::int AS perguntas
           FROM quizzes q
          WHERE q.id = $1`,
        [quizId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ erro: "Quiz não encontrado" });
      }

      // Abrir sala de um quiz vazio só geraria uma partida que
      // termina na primeira tela. Barrar aqui é mais gentil do
      // que deixar 20 pessoas entrarem para nada.
      if (rows[0].perguntas === 0) {
        return res.status(400).json({ erro: "Este quiz ainda não tem perguntas" });
      }

      // Abrir uma sala é o evento que mede popularidade aqui.
      // Não conta quantos jogaram — isso exige histórico, que é
      // a fase 5 —, conta quantas vezes alguém decidiu
      // apresentar este quiz. É o dado honesto disponível hoje.
      //
      // UPDATE direto, sem ler antes: incrementar lendo e
      // escrevendo perderia contagem quando duas salas do mesmo
      // quiz fossem abertas ao mesmo tempo.
      // Duas escritas, cada uma com o seu papel: a linha em
      // `aberturas` guarda QUANDO (e é o que permite cortar por
      // semana ou por dia); o contador em `quizzes` guarda o
      // total, que aparece em toda listagem e seria caro de
      // somar a cada carregamento.
      await pool.query(
        `WITH registro AS (
           INSERT INTO aberturas (quiz_id) VALUES ($1)
         )
         UPDATE quizzes SET partidas = partidas + 1 WHERE id = $1`,
        [quizId]
      );

      const codigo = await sortearCodigoLivre({
        quizId,
        apresentadorId: req.usuarioId,
        titulo: rows[0].titulo
      });

      res.status(201).json({
        sala: { codigo, titulo: rows[0].titulo, perguntas: rows[0].perguntas, fase: "aguardando" }
      });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * Sorteia um código e tenta criar; se já existir, sorteia outro.
 *
 * É o mesmo padrão do código curto do atalho, e pelo mesmo
 * motivo: não existe "checar antes se está livre", porque entre a
 * checagem e a criação cabe outra requisição. Quem decide é a
 * operação atômica do Redis (HSETNX), e nós tratamos a derrota.
 */
async function sortearCodigoLivre(dados, tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    const codigo = gerarCodigo();
    if (await salas.criar(codigo, dados)) return codigo;
  }

  throw new Error(`Não foi possível gerar um código de sala livre em ${tentativas} tentativas`);
}

export default router;
