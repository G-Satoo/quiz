// ============================================================
// Testes das rotas de quizzes
//
// Rode com:
//   docker compose --profile teste up -d db-teste redis-teste
//   npm run test:integracao
// ============================================================

import "../ajuda/ambiente-teste.js"; // precisa vir primeiro — ver o arquivo

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";

let servidor;
let cliente;

before(async () => {
  await prepararBanco();
  ({ servidor, cliente } = await subirServidor());
});

beforeEach(async () => {
  await limpar();
  await cliente.post("/api/usuarios", {
    nome: "Apresentador",
    email: "dono@exemplo.com",
    senha: "uma-senha-boa"
  });
});

after(async () => {
  servidor.close();
  await encerrarConexoes();
});

/** Uma pergunta válida, para os testes não repetirem o literal. */
function pergunta(enunciado = "Qual a capital do Brasil?", segundos = 20) {
  return {
    enunciado,
    segundos,
    alternativas: [
      { texto: "Brasília", correta: true },
      { texto: "São Paulo", correta: false },
      { texto: "Rio de Janeiro", correta: false }
    ]
  };
}

async function criarQuiz(titulo = "Geografia") {
  const { dados } = await cliente.post("/api/quizzes", { titulo });
  return dados.quiz;
}

describe("POST /api/quizzes", () => {
  it("cria um quiz vazio", async () => {
    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Geografia",
      descricao: "Capitais do mundo"
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.quiz.titulo, "Geografia");
    assert.deepEqual(resposta.dados.quiz.perguntas, []);
  });

  it("recusa título vazio", async () => {
    const resposta = await cliente.post("/api/quizzes", { titulo: "   " });
    assert.equal(resposta.status, 400);
  });

  it("exige login", async () => {
    cliente.esquecerCookie();
    const resposta = await cliente.post("/api/quizzes", { titulo: "Geografia" });
    assert.equal(resposta.status, 401);
  });
});

describe("GET /api/quizzes", () => {
  it("lista com a contagem de perguntas", async () => {
    const quiz = await criarQuiz();
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta(), pergunta("Qual o maior rio?")]
    });

    const resposta = await cliente.get("/api/quizzes");

    assert.equal(resposta.dados.quizzes.length, 1);
    assert.equal(resposta.dados.quizzes[0].perguntas, 2);
  });

  it("não mostra quiz de outra pessoa", async () => {
    await criarQuiz();

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Outra",
      email: "outra@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.get("/api/quizzes");
    assert.equal(resposta.dados.quizzes.length, 0);
  });
});

describe("PUT /api/quizzes/:id/perguntas", () => {
  it("salva perguntas e alternativas na ordem", async () => {
    const quiz = await criarQuiz();

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Primeira"), pergunta("Segunda"), pergunta("Terceira")]
    });

    assert.equal(resposta.status, 200);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const enunciados = dados.quiz.perguntas.map((p) => p.enunciado);

    assert.deepEqual(enunciados, ["Primeira", "Segunda", "Terceira"]);
    assert.equal(dados.quiz.perguntas[0].alternativas.length, 3);
    assert.equal(dados.quiz.perguntas[0].alternativas[0].correta, true);
  });

  it("substitui o conjunto inteiro, não acrescenta", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Antiga 1"), pergunta("Antiga 2")]
    });

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Nova única")]
    });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.equal(dados.quiz.perguntas.length, 1);
    assert.equal(dados.quiz.perguntas[0].enunciado, "Nova única");
  });

  it("um PUT recusado não apaga as perguntas que já estavam salvas", async () => {
    // A validação roda ANTES de abrir a transação, de propósito.
    // Se rodasse depois do DELETE, uma pergunta mal preenchida no
    // fim da lista destruiria o trabalho já salvo.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Original A"), pergunta("Original B")]
    });

    const ruim = pergunta("Esta não vale");
    ruim.alternativas = [{ texto: "Única", correta: true }]; // mínimo são 2

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Nova 1"), ruim]
    });

    assert.equal(resposta.status, 400);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const enunciados = dados.quiz.perguntas.map((p) => p.enunciado);

    assert.deepEqual(enunciados, ["Original A", "Original B"]);
  });

  it("recusa pergunta sem alternativa correta", async () => {
    const quiz = await criarQuiz();

    const semCorreta = pergunta();
    semCorreta.alternativas = semCorreta.alternativas.map((a) => ({ ...a, correta: false }));

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [semCorreta]
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /correta/);
  });

  it("recusa pergunta com duas corretas", async () => {
    const quiz = await criarQuiz();

    const duasCorretas = pergunta();
    duasCorretas.alternativas[1].correta = true;

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [duasCorretas]
    });

    assert.equal(resposta.status, 400);
  });

  it("diz QUAL pergunta está errada", async () => {
    // Numa lista de 15, "pergunta inválida" não ajuda ninguém.
    const quiz = await criarQuiz();

    const ruim = pergunta();
    ruim.segundos = 1;

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta(), pergunta(), ruim]
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /Pergunta 3/);
  });

  it("não deixa editar quiz de outra pessoa", async () => {
    const quiz = await criarQuiz();

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Invasor",
      email: "invasor@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta()]
    });

    assert.equal(resposta.status, 404);
  });
});

describe("DELETE /api/quizzes/:id", () => {
  it("apaga o quiz com perguntas e alternativas", async () => {
    const quiz = await criarQuiz();
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, { perguntas: [pergunta()] });

    const resposta = await cliente.delete(`/api/quizzes/${quiz.id}`);
    assert.equal(resposta.status, 204);

    // ON DELETE CASCADE em cadeia: quiz -> perguntas -> alternativas.
    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM alternativas");
    assert.equal(rows[0].total, 0);
  });
});
