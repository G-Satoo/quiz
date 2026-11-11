// ============================================================
// Quanto vale um acerto
//
// Cálculo puro, sem banco nem Redis: dá para testar a regra sozinha,
// e a partida (partida.js) só chama.
//
// A REGRA
//
// Quem acerta leva metade fixa e metade pela velocidade — só
// velocidade faria a partida ser sobre reflexo; só acerto faria
// empate geral. Errar vale zero, mas não é punido além disso, para
// a partida não virar um jogo de não arriscar.
//
// E O TEMPO DA PERGUNTA PESA
//
// Antes, toda pergunta valia até 1.000, tivesse ela 10 ou 300
// segundos. Responder com cinco minutos para pensar rendia o mesmo
// que responder no susto — e uma partida longa e lenta acumulava
// pontos no ranking sem esforço nenhum.
//
// Agora o total é multiplicado por um fator que cai com o tempo da
// pergunta: a raiz de (10 / segundos).
//
//    10 s → 1,00 (até 1.000)      60 s → 0,41 (até 408)
//    20 s → 0,71 (até 707)       120 s → 0,29 (até 289)
//    30 s → 0,58 (até 577)       300 s → 0,18 (até 183)
//
// A raiz é o meio-termo: 10 s rende 5,5 vezes mais que 300 s, sem
// zerar as perguntas longas. Sem a raiz (10 / segundos), 300 s
// valeria 33 pontos — nada. Para deixar mais ou menos agressivo,
// muda-se o EXPOENTE.
// ============================================================

export const PONTOS_ACERTO = 500;
export const PONTOS_VELOCIDADE = 500;

/** O tempo que vale o fator 1 — o mínimo que uma pergunta pode ter. */
export const SEGUNDOS_REFERENCIA = 10;

/** 0,5 = raiz quadrada. 1 seria inversamente proporcional; 0, sem efeito. */
const EXPOENTE = 0.5;

/** O multiplicador de uma pergunta com este tempo. */
export function fatorDoTempo(segundos) {
  return Math.min(1, (SEGUNDOS_REFERENCIA / segundos) ** EXPOENTE);
}

/**
 * Pontos de um acerto.
 *
 * `decorridoMs` é quanto o jogador levou, medido pelo SERVIDOR desde
 * que a pergunta abriu — nunca pelo relógio do navegador.
 */
export function pontosDoAcerto(segundos, decorridoMs) {
  const limiteMs = segundos * 1000;
  const sobrou = Math.max(0, limiteMs - decorridoMs) / limiteMs;

  return Math.round((PONTOS_ACERTO + PONTOS_VELOCIDADE * sobrou) * fatorDoTempo(segundos));
}

// ------------------------------------------------------------
// Sequência de acertos
//
// Acertar seguido rende um bônus sobre os pontos da pergunta: +10%
// a partir do segundo acerto consecutivo, +20% no terceiro, até
// +50%. Errar (ou não responder) zera a sequência.
//
// É percentual, e não um valor fixo, para respeitar o peso do tempo:
// um bônus fixo de 100 pontos numa pergunta de 300 segundos valeria
// mais que a própria pergunta.
// ------------------------------------------------------------

export const BONUS_POR_ACERTO_SEGUIDO = 0.1;
export const SEQUENCIA_MAXIMA_NO_BONUS = 6; // 6 seguidos = +50%, e para aí

/** `sequencia` já conta o acerto atual: 1 é o primeiro, sem bônus. */
export function bonusDaSequencia(pontos, sequencia) {
  const degraus = Math.min(sequencia, SEQUENCIA_MAXIMA_NO_BONUS) - 1;
  if (degraus <= 0) return 0;
  return Math.round(pontos * BONUS_POR_ACERTO_SEGUIDO * degraus);
}
