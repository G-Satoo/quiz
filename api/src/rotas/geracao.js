// ============================================================
// Rota de geração de perguntas
// Prefixo: /api/geracao  (exige login)
//
// A chamada à IA acontece AQUI, no servidor, nunca no navegador.
// Se a tela chamasse o Google direto, a chave precisaria estar no
// JavaScript da página — e qualquer pessoa a leria no inspetor e
// gastaria a cota (ou a conta) de quem publicou o site.
// ============================================================

import { createHash } from "node:crypto";

import { Router } from "express";

import { redis } from "../redis.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { limitar } from "../middlewares/limite.js";
import { gerarPerguntas, ErroIA, DIFICULDADES } from "../servicos/ia.js";
import { lerInteiro } from "../util/validacao.js";

const router = Router();

router.use(exigirLogin);

// Uma semana. O conteúdo não envelhece rápido, e quem pedir o
// mesmo tema de novo não deve gastar cota por isso.
const VALIDADE_CACHE = 7 * 24 * 60 * 60;

const MIN_PERGUNTAS = 1;
const MAX_PERGUNTAS = 20;

/**
 * A chave do cache é o pedido inteiro, resumido em hash.
 *
 * Hash e não o texto cru porque o tema é digitado livremente:
 * viraria chave gigante, com acento, espaço e dois-pontos — que
 * é justamente o separador de chave do Redis.
 */
function chaveDoCache({ tema, quantidade, dificuldade }) {
  const resumo = createHash("sha256")
    .update(`${tema.toLowerCase().trim()}|${quantidade}|${dificuldade}`)
    .digest("hex")
    .slice(0, 32);

  return `geracao:${resumo}`;
}

/**
 * POST /api/geracao/perguntas
 * body: { tema, quantidade?, dificuldade? }
 *
 * Devolve perguntas para o RASCUNHO do editor. Nada é salvo no
 * banco aqui — quem publica é a pessoa, depois de revisar.
 */
router.post(
  "/perguntas",
  // Gerar custa cota (e, num provedor pago, dinheiro). Sem limite,
  // um laço de repetição esvazia a conta de madrugada.
  limitar({ nome: "gerar-ia", max: 20, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const { tema, dificuldade = "medio" } = req.body ?? {};

      if (typeof tema !== "string" || tema.trim().length < 2) {
        return res.status(400).json({ erro: "Escreva o tema do quiz" });
      }

      if (tema.trim().length > 200) {
        return res.status(400).json({ erro: "O tema é longo demais" });
      }

      if (!DIFICULDADES.includes(dificuldade)) {
        return res.status(400).json({ erro: "Dificuldade inválida" });
      }

      const quantidade = lerInteiro(req.body?.quantidade, {
        padrao: 5,
        minimo: MIN_PERGUNTAS,
        maximo: MAX_PERGUNTAS
      });

      const pedido = { tema: tema.trim(), quantidade, dificuldade };
      const chave = chaveDoCache(pedido);

      // ----- já geramos isto antes? -----
      try {
        const guardado = await redis.get(chave);

        if (guardado) {
          return res.json({ perguntas: JSON.parse(guardado), doCache: true });
        }
      } catch {
        // Redis fora do ar não impede gerar — só deixa mais caro.
      }

      const perguntas = await gerarPerguntas(pedido);

      try {
        await redis.set(chave, JSON.stringify(perguntas), "EX", VALIDADE_CACHE);
      } catch {
        // idem: não conseguir cachear não invalida o resultado.
      }

      res.json({ perguntas, doCache: false });
    } catch (erro) {
      if (erro instanceof ErroIA) {
        // O detalhe técnico fica no log do servidor; para a tela
        // vai só o que ajuda quem está olhando a decidir o que
        // fazer. Resposta de erro de provedor pode conter trecho
        // do pedido, e isso não precisa voltar para o navegador.
        if (erro.detalhe) console.error("Falha da IA:", erro.codigo, erro.detalhe);

        const status = erro.codigo === "cota" ? 429 : 502;
        return res.status(status).json({ erro: erro.message, codigo: erro.codigo });
      }

      next(erro);
    }
  }
);

export default router;
