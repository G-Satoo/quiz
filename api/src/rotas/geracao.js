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
import {
  gerarPerguntas,
  conferirPergunta,
  sugerirCapa,
  ErroIA,
  DIFICULDADES
} from "../servicos/ia.js";
import { buscarImagem } from "../servicos/imagem.js";
import { lerInteiro } from "../util/validacao.js";

const router = Router();

router.use(exigirLogin);

// Uma semana. O conteúdo não envelhece rápido, e quem pedir o
// mesmo tema de novo não deve gastar cota por isso.
const VALIDADE_CACHE = 7 * 24 * 60 * 60;

// Quantas pedir DE UMA VEZ. Não é o mínimo de um quiz (esse
// fica em validacao.js): gerar poucas serve para completar um
// quiz que já tem algumas.
const MIN_POR_GERACAO = 1;
const MAX_POR_GERACAO = 20;

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
        // Dez de uma vez completam um quiz novo no mínimo exigido.
        padrao: 10,
        minimo: MIN_POR_GERACAO,
        maximo: MAX_POR_GERACAO
      });

      const pedido = { tema: tema.trim(), quantidade, dificuldade };
      const chave = chaveDoCache(pedido);

      // ----- já geramos isto antes? -----
      try {
        const guardado = await redis.get(chave);

        if (guardado) {
          const antigo = JSON.parse(guardado);

          // O cache antigo guardava só a lista; o novo guarda
          // { perguntas, icone }. Aceitar os dois evita jogar
          // fora o que já foi gerado só porque o formato mudou.
          const perguntas = Array.isArray(antigo) ? antigo : antigo.perguntas;
          const icone = Array.isArray(antigo) ? null : antigo.icone;
          const imagem = Array.isArray(antigo) ? null : (antigo.imagem ?? null);

          return res.json({ perguntas, icone, imagem, doCache: true });
        }
      } catch {
        // Redis fora do ar não impede gerar — só deixa mais caro.
      }

      // Em paralelo: a capa não depende das perguntas, e
      // esperar uma depois da outra dobraria o tempo que a
      // pessoa fica olhando para o botão "Gerando...".
      const [perguntas, capa] = await Promise.all([
        gerarPerguntas(pedido),
        sugerirCapa(pedido.tema)
      ]);

      // Só busca imagem se a IA indicou um termo. Ela deixa
      // vazio quando o tema é obra protegida — e aí a capa fica
      // com o emoji, que é a resposta honesta.
      const imagem = capa.busca ? await buscarImagem(capa.busca) : null;
      const icone = capa.icone;

      try {
        await redis.set(chave, JSON.stringify({ perguntas, icone, imagem }), "EX", VALIDADE_CACHE);
      } catch {
        // idem: não conseguir cachear não invalida o resultado.
      }

      res.json({ perguntas, icone, imagem, doCache: false });
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

/**
 * POST /api/geracao/conferir
 * body: { enunciado, alternativas: [{ texto }], marcada }
 *
 * Confere UMA pergunta: devolve qual alternativa a IA acha que é
 * a correta, sem saber qual está marcada, e se isso bate com o
 * que o editor tem.
 *
 * O `marcada` serve só para a resposta já vir comparada — ele NÃO
 * é enviado ao modelo, senão a conferência deixaria de ser cega.
 */
router.post(
  "/conferir",
  // Teto mais alto que o da geração: conferir é uma pergunta de
  // cada vez, e a pessoa pode querer passar por todas de um quiz.
  limitar({ nome: "conferir-ia", max: 120, janela: 60 * 60, chave: (req) => req.usuarioId }),
  async (req, res, next) => {
    try {
      const { enunciado, alternativas, marcada } = req.body ?? {};

      if (typeof enunciado !== "string" || enunciado.trim().length < 3) {
        return res.status(400).json({ erro: "A pergunta está vazia" });
      }

      if (!Array.isArray(alternativas) || alternativas.length < 2 || alternativas.length > 6) {
        return res.status(400).json({ erro: "A pergunta precisa de 2 a 6 alternativas" });
      }

      const textos = alternativas.map((a) => String(a?.texto ?? "").trim());

      if (textos.some((t) => t === "")) {
        return res.status(400).json({ erro: "Preencha todas as alternativas antes de conferir" });
      }

      const chave = chaveDaConferencia(enunciado, textos);

      // Conferir a mesma pergunta duas vezes deve dar a mesma
      // resposta — e não gastar cota de novo. Sem cache, clicar
      // no botão repetidamente poderia até trazer respostas
      // diferentes, o que confundiria mais do que ajudaria.
      let resultado;

      try {
        const guardado = await redis.get(chave);
        if (guardado) resultado = JSON.parse(guardado);
      } catch {
        // Redis fora não impede conferir.
      }

      if (!resultado) {
        resultado = await conferirPergunta({
          enunciado: enunciado.trim(),
          alternativas: textos.map((texto) => ({ texto }))
        });

        try {
          await redis.set(chave, JSON.stringify(resultado), "EX", VALIDADE_CACHE);
        } catch {
          // idem
        }
      }

      const indiceMarcado = lerInteiro(marcada, {
        padrao: null,
        minimo: 0,
        maximo: textos.length - 1
      });

      res.json({
        ...resultado,
        texto: textos[resultado.indice],
        concorda: indiceMarcado === null ? null : indiceMarcado === resultado.indice
      });
    } catch (erro) {
      if (erro instanceof ErroIA) {
        if (erro.detalhe) console.error("Falha da IA:", erro.codigo, erro.detalhe);
        const status = erro.codigo === "cota" ? 429 : 502;
        return res.status(status).json({ erro: erro.message, codigo: erro.codigo });
      }

      next(erro);
    }
  }
);

/** A chave é a pergunta inteira: enunciado mais as alternativas. */
function chaveDaConferencia(enunciado, textos) {
  const resumo = createHash("sha256")
    .update(`${enunciado.trim().toLowerCase()}|${textos.join("|").toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);

  return `conferencia:${resumo}`;
}

export default router;
