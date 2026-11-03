// ============================================================
// Testes do que vai para a IA na moderação
//
// Rode com:  npm test
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { quizParaModeracao } from "../src/servicos/ia.js";

const pergunta = (enunciado, ativa = true, certa = "Sim") => ({
  enunciado,
  ativa,
  alternativas: [{ texto: certa, correta: true }, { texto: "Não", correta: false }]
});

const quiz = (perguntas) => ({ titulo: "T", descricao: "", categoria: "geral", perguntas });

describe("quizParaModeracao", () => {
  it("marca o que está fora da partida, para a IA não contar repetição com isso", () => {
    const { perguntas } = quizParaModeracao(quiz([pergunta("Na partida"), pergunta("Bloqueada", false)]));

    assert.deepEqual(perguntas.map((p) => [p.enunciado, p.na_partida]), [
      ["Na partida", true],
      ["Bloqueada", false]
    ]);
  });

  it("não manda de novo uma bloqueada que é cópia idêntica de outra", () => {
    // Um quiz real chegou a ter 200 cópias assim.
    const copias = Array.from({ length: 20 }, () => pergunta("qual é o NOME?", false));
    const { perguntas } = quizParaModeracao(quiz([...copias, pergunta("Qual é o nome?")]));

    assert.equal(perguntas.length, 1);
    assert.equal(perguntas[0].na_partida, true);
  });

  it("manda a bloqueada de mesmo enunciado se as alternativas forem outras", () => {
    // O conteúdo diferente pode estar justamente nas alternativas, e
    // ela pode voltar à partida sem nova análise.
    const { perguntas } = quizParaModeracao(
      quiz([pergunta("Qual é o nome?"), pergunta("Qual é o nome?", false, "Outra coisa")])
    );

    assert.equal(perguntas.length, 2);
  });
});
