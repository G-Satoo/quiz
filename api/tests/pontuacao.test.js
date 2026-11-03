// ============================================================
// Testes da pontuação
//
// Rode com:  npm test
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fatorDoTempo, pontosDoAcerto } from "../src/tempo-real/pontuacao.js";

describe("pontosDoAcerto", () => {
  it("pergunta de 10 s respondida na hora vale 1.000", () => {
    assert.equal(pontosDoAcerto(10, 0), 1000);
  });

  it("acertar no último instante vale metade", () => {
    assert.equal(pontosDoAcerto(10, 10_000), 500);
  });

  it("a mesma resposta vale bem mais numa pergunta curta que numa longa", () => {
    // O ponto da regra: cinco minutos para pensar não podem render o
    // mesmo que dez segundos.
    const curta = pontosDoAcerto(10, 0);
    const longa = pontosDoAcerto(300, 0);

    assert.ok(curta > 5 * longa, `${curta} deveria ser mais de 5x ${longa}`);
    assert.ok(longa > 0, "pergunta longa vale menos, mas não zero");
  });

  it("quanto maior o tempo, menor o fator — sempre", () => {
    let anterior = Infinity;
    for (const segundos of [10, 15, 20, 30, 60, 120, 300]) {
      const fator = fatorDoTempo(segundos);
      assert.ok(fator < anterior || segundos === 10, `fator de ${segundos}s não caiu`);
      anterior = fator;
    }
  });

  it("responder depois do prazo não dá ponto negativo", () => {
    assert.equal(pontosDoAcerto(20, 25_000), pontosDoAcerto(20, 20_000));
  });
});
