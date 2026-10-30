// ============================================================
// A partida
//
// Esta é a parte do projeto em que o tempo real deixa de ser
// enfeite. Três regras mandam em tudo que está aqui:
//
//   1. QUEM É DONO DO TEMPO É O SERVIDOR.
//      O navegador mostra um cronômetro, mas ele é só desenho. A
//      hora em que a pergunta abriu fica no Redis, e é contra ela
//      que cada resposta é medida. Se o cronômetro do cliente
//      mandasse, bastaria adiantar o relógio para ganhar.
//
//   2. A RESPOSTA CERTA NÃO SAI DO SERVIDOR ANTES DA HORA.
//      A pergunta é transmitida sem dizer qual alternativa é a
//      correta. Mandar e "esconder na tela" seria entregar o
//      gabarito para quem abrir o inspetor do navegador.
//
//   3. PRIMEIRA RESPOSTA É A QUE VALE.
//      Garantido por HSETNX no Redis, não por um "if" no
//      JavaScript — duas mensagens que chegam juntas atravessam
//      um "if".
//
// LIMITAÇÃO CONHECIDA (fase 4): o fechamento automático da
// pergunta é um setTimeout deste processo. Se o servidor
// reiniciar com uma pergunta no ar, ninguém a fecha — o
// apresentador precisa avançar na mão. O estado para resolver
// isso já está no Redis (inicio_ms); falta quem o leia ao subir.
// ============================================================

import { pool } from "../../db/pool.js";
import * as salas from "./salas.js";

// Quanto cada pergunta vale, e quanto disso é prêmio por
// velocidade. Metade fixa, metade pelo tempo: só velocidade faria
// a partida ser sobre reflexo; só acerto faria empate geral.
const PONTOS_ACERTO = 500;
const PONTOS_VELOCIDADE = 500;

// Folga para a viagem da resposta pela rede. Sem ela, quem
// responde no último segundo é punido pela latência, não pelo
// atraso.
const TOLERANCIA_MS = 400;

// Os cronômetros em andamento, um por sala. Vivem no processo
// porque são setTimeout — ver a limitação no topo do arquivo.
const cronometros = new Map();

function cancelarCronometro(codigo) {
  const cronometro = cronometros.get(codigo);
  if (cronometro) {
    clearTimeout(cronometro);
    cronometros.delete(codigo);
  }
}

/**
 * Carrega as perguntas do quiz, já no formato que a partida usa.
 *
 * Acontece uma vez, no começo. Depois disso o Postgres sai do
 * caminho: nenhuma pergunta ou resposta durante o jogo encosta
 * no banco.
 */
export async function carregarPerguntas(quizId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.ordem, p.enunciado, p.segundos,
            a.id AS alternativa_id, a.ordem AS alternativa_ordem,
            a.texto, a.correta
       FROM perguntas p
       JOIN alternativas a ON a.pergunta_id = p.id
      WHERE p.quiz_id = $1
      ORDER BY p.ordem, a.ordem`,
    [quizId]
  );

  const perguntas = [];
  let atual = null;

  for (const linha of rows) {
    if (!atual || atual.id !== linha.id) {
      atual = {
        id: linha.id,
        enunciado: linha.enunciado,
        segundos: linha.segundos,
        alternativas: []
      };
      perguntas.push(atual);
    }

    atual.alternativas.push({
      id: linha.alternativa_id,
      texto: linha.texto,
      correta: linha.correta
    });
  }

  return perguntas;
}

/**
 * O que é transmitido quando uma pergunta abre.
 *
 * Repare no `.map`: ele monta alternativas só com id e texto. O
 * campo `correta` fica para trás de propósito — é a regra 2 lá
 * de cima, e é uma linha de código que, esquecida, entrega o
 * gabarito para a sala inteira.
 */
function paraOsJogadores(pergunta, indice, total) {
  return {
    tipo: "pergunta",
    indice,
    total,
    enunciado: pergunta.enunciado,
    segundos: pergunta.segundos,
    alternativas: pergunta.alternativas.map((a) => ({ id: a.id, texto: a.texto }))
  };
}

/**
 * Abre a pergunta de um índice e agenda o fechamento dela.
 *
 * `transmitir` e `aoFechar` vêm de fora porque este módulo não
 * conhece WebSocket — ele cuida das regras do jogo. Quem sabe
 * falar com as telas é o servidor-ws.
 */
export async function abrirPergunta(codigo, indice, { transmitir, aoFechar }) {
  const perguntas = await salas.lerPerguntas(codigo);
  if (!perguntas || indice >= perguntas.length) return null;

  const pergunta = perguntas[indice];
  const agora = Date.now();

  await salas.abrirPergunta(codigo, indice, agora);

  transmitir(paraOsJogadores(pergunta, indice, perguntas.length));

  cancelarCronometro(codigo);

  const cronometro = setTimeout(() => {
    cronometros.delete(codigo);
    aoFechar();
  }, pergunta.segundos * 1000 + TOLERANCIA_MS);

  // unref(): o servidor já fica vivo pelas conexões abertas, e um
  // cronômetro pendurado não deve impedir um processo de terminar
  // — nos testes, isso é a diferença entre a suíte encerrar e
  // ficar presa esperando uma pergunta de 20 segundos.
  cronometro.unref();
  cronometros.set(codigo, cronometro);

  return pergunta;
}

/**
 * Recebe a resposta de um jogador.
 *
 * Devolve { aceita, motivo } — e nunca diz se acertou. O jogador
 * descobre junto com todo mundo, quando a pergunta fecha. Dizer
 * na hora permitiria a quem respondeu avisar os colegas.
 */
export async function responder(codigo, jogadorId, alternativaId) {
  const { fase, indice, inicioMs } = await salas.lerPerguntaAberta(codigo);

  if (fase !== "pergunta") return { aceita: false, motivo: "nao-ha-pergunta-aberta" };

  const perguntas = await salas.lerPerguntas(codigo);
  const pergunta = perguntas?.[indice];
  if (!pergunta) return { aceita: false, motivo: "nao-ha-pergunta-aberta" };

  const alternativa = pergunta.alternativas.find((a) => a.id === alternativaId);
  if (!alternativa) return { aceita: false, motivo: "alternativa-invalida" };

  // Aqui mora a regra 1. O cliente pode jurar que respondeu a
  // tempo; quem mede é este cálculo, contra a hora que ESTE
  // servidor carimbou quando abriu a pergunta.
  const decorridoMs = Date.now() - inicioMs;
  const limiteMs = pergunta.segundos * 1000 + TOLERANCIA_MS;

  if (decorridoMs > limiteMs) return { aceita: false, motivo: "tempo-esgotado" };

  const primeira = await salas.registrarResposta(codigo, indice, jogadorId, {
    alternativaId,
    decorridoMs
  });

  if (!primeira) return { aceita: false, motivo: "ja-respondeu" };

  return { aceita: true };
}

/**
 * Fecha a pergunta, calcula os pontos e devolve o que transmitir.
 *
 * A pontuação: quem acerta leva 500 fixos mais até 500 pela
 * velocidade, proporcional ao tempo que sobrou. Responder no
 * primeiro segundo de uma pergunta de 20s vale quase 1000;
 * responder no último vale pouco mais de 500. Errar vale zero —
 * mas responder errado rápido não é punido além disso, para a
 * partida não virar um jogo de não arriscar.
 */
export async function fecharPergunta(codigo) {
  cancelarCronometro(codigo);

  const { indice } = await salas.lerPerguntaAberta(codigo);
  const perguntas = await salas.lerPerguntas(codigo);
  const pergunta = perguntas?.[indice];

  if (!pergunta) return null;

  const correta = pergunta.alternativas.find((a) => a.correta);
  const respostas = await salas.lerRespostas(codigo, indice);

  const porJogador = new Map();

  for (const resposta of respostas) {
    const acertou = resposta.alternativaId === correta.id;
    let ganhos = 0;

    if (acertou) {
      const limiteMs = pergunta.segundos * 1000;
      const sobrou = Math.max(0, limiteMs - resposta.decorridoMs) / limiteMs;

      ganhos = PONTOS_ACERTO + Math.round(PONTOS_VELOCIDADE * sobrou);
      await salas.somarPontos(codigo, resposta.jogadorId, ganhos);
    }

    porJogador.set(resposta.jogadorId, {
      acertou,
      ganhos,
      alternativaId: resposta.alternativaId
    });
  }

  await salas.mudarFase(codigo, "resultado");

  const placar = await salas.lerPlacar(codigo);

  // Quantos escolheram cada alternativa — é o gráfico que o
  // apresentador mostra e a parte mais divertida de um quiz ao
  // vivo: ver que metade da sala caiu na mesma pegadinha.
  const distribuicao = pergunta.alternativas.map((a) => ({
    id: a.id,
    texto: a.texto,
    correta: a.correta,
    escolhas: respostas.filter((r) => r.alternativaId === a.id).length
  }));

  return {
    indice,
    ultima: indice === perguntas.length - 1,
    alternativaCorretaId: correta.id,
    distribuicao,
    placar,
    porJogador
  };
}

/** Quantas pessoas já responderam a pergunta que está no ar. */
export async function contarRespostas(codigo) {
  const { indice } = await salas.lerPerguntaAberta(codigo);
  if (indice === null) return 0;

  return (await salas.lerRespostas(codigo, indice)).length;
}

export function esquecerCronometro(codigo) {
  cancelarCronometro(codigo);
}
