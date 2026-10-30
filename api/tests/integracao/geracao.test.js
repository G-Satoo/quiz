// ============================================================
// Testes da geração de perguntas
//
// Rodam com IA_PROVEDOR=falso, fixado em ajuda/ambiente-teste.js:
// sem chave, sem cota, sem internet, sem resposta diferente a
// cada execução. Um teste que depende de um modelo de linguagem
// não testa o seu código — testa o humor do modelo naquele dia.
//
// O que é testado aqui é tudo que fica EM VOLTA do modelo, que é
// onde moram os bugs que nos pertencem: permissão, validação,
// limites, cache e tradução de erro.
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { redis } from "../../src/redis.js";

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
  await new Promise((resolver) => setTimeout(resolver, 300));
  await encerrarConexoes();
});

describe("POST /api/geracao/perguntas", () => {
  it("devolve perguntas no formato do editor", async () => {
    const resposta = await cliente.post("/api/geracao/perguntas", {
      tema: "Naruto",
      quantidade: 3
    });

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.perguntas.length, 3);

    const [primeira] = resposta.dados.perguntas;

    assert.ok(primeira.enunciado);
    assert.ok(primeira.segundos >= 5);
    assert.equal(primeira.alternativas.filter((a) => a.correta).length, 1);
  });

  it("o que sai daqui passa pelas mesmas regras do editor", async () => {
    // A saída do modelo não vale mais do que texto digitado à
    // mão: se não passar no validarPerguntas, não sai da rota.
    const { dados } = await cliente.post("/api/geracao/perguntas", { tema: "Qualquer coisa" });

    for (const pergunta of dados.perguntas) {
      assert.ok(pergunta.alternativas.length >= 2 && pergunta.alternativas.length <= 6);
      assert.equal(pergunta.alternativas.filter((a) => a.correta).length, 1);
      assert.ok(pergunta.enunciado.trim().length > 0);
    }
  });

  it("não salva nada no banco", async () => {
    // A geração preenche o RASCUNHO. Quem publica é a pessoa,
    // depois de ler — porque o modelo erra com convicção.
    await cliente.post("/api/geracao/perguntas", { tema: "Naruto" });

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);
  });

  it("exige login", async () => {
    cliente.esquecerCookie();

    const resposta = await cliente.post("/api/geracao/perguntas", { tema: "Naruto" });
    assert.equal(resposta.status, 401);
  });

  it("recusa tema vazio ou curto demais", async () => {
    for (const tema of ["", "   ", "a", null, 42]) {
      const resposta = await cliente.post("/api/geracao/perguntas", { tema });
      assert.equal(resposta.status, 400, String(tema));
    }
  });

  it("recusa dificuldade inventada", async () => {
    const resposta = await cliente.post("/api/geracao/perguntas", {
      tema: "Naruto",
      dificuldade: "impossivel"
    });

    assert.equal(resposta.status, 400);
  });

  it("prende a quantidade nos limites em vez de recusar", async () => {
    // Pedir 500 perguntas é engano de digitação, não ataque.
    // Prender no teto é mais gentil que um erro — e protege a
    // cota do mesmo jeito.
    const resposta = await cliente.post("/api/geracao/perguntas", {
      tema: "Naruto",
      quantidade: 500
    });

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.perguntas.length, 20);
  });
});

describe("cache da geração", () => {
  it("o segundo pedido igual não gera de novo", async () => {
    // Gerar custa cota. O mesmo tema, mesma quantidade e mesmo
    // nível devolvem o resultado guardado.
    const pedido = { tema: "Naruto", quantidade: 3, dificuldade: "medio" };

    const primeira = await cliente.post("/api/geracao/perguntas", pedido);
    assert.equal(primeira.dados.doCache, false);

    const segunda = await cliente.post("/api/geracao/perguntas", pedido);
    assert.equal(segunda.dados.doCache, true);

    assert.deepEqual(segunda.dados.perguntas, primeira.dados.perguntas);
  });

  it("ignora maiúsculas e espaços no tema", async () => {
    // "Naruto", "naruto" e " Naruto " são o mesmo pedido para uma
    // pessoa; precisam ser o mesmo pedido para o cache também.
    await cliente.post("/api/geracao/perguntas", { tema: "Naruto", quantidade: 2 });

    const repetido = await cliente.post("/api/geracao/perguntas", {
      tema: "  naruto  ",
      quantidade: 2
    });

    assert.equal(repetido.dados.doCache, true);
  });

  it("tema diferente gera de novo", async () => {
    await cliente.post("/api/geracao/perguntas", { tema: "Naruto", quantidade: 2 });

    const outro = await cliente.post("/api/geracao/perguntas", {
      tema: "One Piece",
      quantidade: 2
    });

    assert.equal(outro.dados.doCache, false);
  });

  it("guarda o resultado com prazo de validade", async () => {
    // Sem prazo, cada tema já pedido ocuparia memória para sempre.
    await cliente.post("/api/geracao/perguntas", { tema: "Naruto", quantidade: 2 });

    const chaves = await redis.keys("geracao:*");
    assert.equal(chaves.length, 1);

    const prazo = await redis.ttl(chaves[0]);
    assert.ok(prazo > 0, `deveria ter prazo, veio ${prazo}`);
  });
});

describe("limite de gerações", () => {
  it("barra quem passa do teto por hora", async () => {
    // Sem limite, um laço de repetição esvazia a cota (ou a
    // conta, num provedor pago) de madrugada.
    //
    // Temas diferentes de propósito: com o mesmo tema, o cache
    // responderia e o limite nem seria exercitado.
    let ultimo;

    for (let i = 0; i < 25; i++) {
      ultimo = await cliente.post("/api/geracao/perguntas", {
        tema: `tema numero ${i}`,
        quantidade: 1
      });

      if (ultimo.status === 429) break;
    }

    assert.equal(ultimo.status, 429);
  });
});
