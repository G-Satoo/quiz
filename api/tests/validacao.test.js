// ============================================================
// Testes de validação de entrada
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validarEmail,
  validarSenha,
  lerInteiro,
  normalizarTexto,
  validarPerguntas
} from "../src/util/validacao.js";

describe("validarEmail", () => {
  it("aceita endereços normais", () => {
    for (const email of ["a@b.co", "gustavo.alves@exemplo.com.br", "x+tag@dominio.io"]) {
      assert.equal(validarEmail(email), null, email);
    }
  });

  it("recusa o que claramente não é e-mail", () => {
    for (const invalido of ["", "   ", "sem-arroba.com", "a@b", "a b@c.com", null, 42]) {
      assert.ok(validarEmail(invalido));
    }
  });
});

describe("validarSenha", () => {
  it("exige pelo menos 8 caracteres", () => {
    assert.ok(validarSenha("curta12"));
    assert.equal(validarSenha("oito1234"), null);
  });

  it("tem teto de tamanho", () => {
    // Sem teto, uma senha enorme vira um jeito barato de ocupar a
    // CPU do servidor: o scrypt processa tudo que chega.
    assert.ok(validarSenha("a".repeat(201)));
  });
});

describe("lerInteiro", () => {
  it("usa o padrão quando o valor não veio", () => {
    assert.equal(lerInteiro(undefined, { padrao: 30, minimo: 1, maximo: 365 }), 30);
    assert.equal(lerInteiro("", { padrao: 30, minimo: 1, maximo: 365 }), 30);
  });

  it("prende o valor nos limites em vez de recusar", () => {
    assert.equal(lerInteiro("9999", { padrao: 30, minimo: 1, maximo: 365 }), 365);
    assert.equal(lerInteiro("-5", { padrao: 30, minimo: 1, maximo: 365 }), 1);
  });

  it("ignora o que não é inteiro", () => {
    for (const lixo of ["abc", "3.5", "1e5", "0x10", " "]) {
      assert.equal(lerInteiro(lixo, { padrao: 30, minimo: 1, maximo: 365 }), 30, lixo);
    }
  });

  it("aceita número de verdade, vindo de um corpo JSON", () => {
    // Query string é sempre texto, mas corpo JSON traz o tipo de
    // verdade. Recusar o número aqui quebrou a criação de sala
    // antes deste teste existir.
    assert.equal(lerInteiro(7, { padrao: null, minimo: 1, maximo: 100 }), 7);
    assert.equal(lerInteiro(999, { padrao: null, minimo: 1, maximo: 100 }), 100);
    assert.equal(lerInteiro(3.5, { padrao: null, minimo: 1, maximo: 100 }), null);
  });

  it("ignora parâmetro repetido na query string", () => {
    // ?dias=10&dias=20 chega como array no Express. Number([]) daria
    // NaN e, sem esta guarda, NaN passaria adiante silenciosamente.
    assert.equal(lerInteiro(["10", "20"], { padrao: 30, minimo: 1, maximo: 365 }), 30);
  });
});

describe("normalizarTexto", () => {
  it("iguala maiúsculas, acentos, pontuação e espaços", () => {
    assert.equal(normalizarTexto("  Qual é a CAPITAL do Brasil?? "), "qual e a capital do brasil");
    assert.equal(normalizarTexto("Pokémon: o nº 1"), "pokemon o n 1");
  });

  it("não iguala o que muda de sentido", () => {
    assert.notEqual(normalizarTexto("Quantos planetas?"), normalizarTexto("Quantos satélites?"));
  });
});

describe("validarPerguntas: repetição", () => {
  const p = (enunciado, alternativas = ["Certa", "Errada"]) => ({
    enunciado,
    segundos: 20,
    alternativas: alternativas.map((texto, i) => ({ texto, correta: i === 0 }))
  });
  const dez = Array.from({ length: 10 }, (_, i) => p(`Pergunta distinta ${i + 1}`));

  it("recusa pergunta repetida e diz qual repete qual", () => {
    assert.equal(
      validarPerguntas([...dez, p("pergunta DISTINTA 2!")]),
      "Pergunta 11 repete a pergunta 2"
    );
  });

  it("aceita repetir o texto de uma pergunta desativada", () => {
    // Reescrever uma pergunta aposentada e reativá-la depois é normal.
    assert.equal(validarPerguntas([...dez, { ...p("Pergunta distinta 2"), ativa: false }]), null);
  });

  it("recusa alternativas repetidas na mesma pergunta", () => {
    assert.equal(
      validarPerguntas([p("Capital?", ["Brasília", "brasilia", "Recife"]), ...dez]),
      "Pergunta 1: as alternativas 1 e 2 são iguais"
    );
  });

  it("aceita a mesma alternativa em perguntas diferentes", () => {
    // "Verdadeiro/Falso" em várias perguntas é legítimo.
    assert.equal(validarPerguntas(dez), null);
  });
});
