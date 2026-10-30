// ============================================================
// Testes da sala ao vivo (HTTP + WebSocket)
//
// Rode com:
//   docker compose --profile teste up -d db-teste redis-teste
//   npm run test:integracao
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { conectar } from "../ajuda/cliente-ws.js";
import { redis } from "../../src/redis.js";

let servidor;
let cliente;
let baseWs;

/** Conexões abertas em cada teste, para fechar todas no fim. */
let abertas = [];

before(async () => {
  await prepararBanco();
  ({ servidor, cliente, baseWs } = await subirServidor());
});

beforeEach(async () => {
  await limpar();

  await cliente.post("/api/usuarios", {
    nome: "Apresentador",
    email: "dono@exemplo.com",
    senha: "uma-senha-boa"
  });
});

// Fechar as conexões entre os testes não é higiene opcional: uma
// conexão viva de um teste anterior continua recebendo broadcast e
// faria o teste seguinte contar gente a mais.
afterEach(async () => {
  for (const conexao of abertas) await conexao.fechar().catch(() => {});
  abertas = [];
});

after(async () => {
  servidor.close();

  // Fechar o servidor derruba os WebSockets, e cada queda dispara
  // um handler que ainda escreve no Redis (marcar offline,
  // avisar a sala). Se a conexão com o Redis fechar antes desses
  // handlers terminarem, eles falham com "Connection is closed"
  // — e a suíte inteira é reprovada por um erro que aconteceu
  // DEPOIS dos testes passarem.
  await new Promise((resolver) => setTimeout(resolver, 300));

  await encerrarConexoes();
});

/** Abre uma conexão e registra para fechar no fim. */
async function abrir(opcoes) {
  const conexao = await conectar(baseWs, opcoes);
  abertas.push(conexao);
  return conexao;
}

/** Cria quiz com uma pergunta e abre uma sala para ele. */
async function criarSala() {
  const { dados: criado } = await cliente.post("/api/quizzes", { titulo: "Geografia" });

  await cliente.put(`/api/quizzes/${criado.quiz.id}/perguntas`, {
    perguntas: [
      {
        enunciado: "Capital do Brasil?",
        segundos: 20,
        alternativas: [
          { texto: "Brasília", correta: true },
          { texto: "São Paulo", correta: false }
        ]
      }
    ]
  });

  const { dados } = await cliente.post("/api/salas", { quiz_id: criado.quiz.id });
  return { ...dados.sala, quizId: criado.quiz.id, cookie: cliente.cookieAtual };
}

describe("POST /api/salas", () => {
  it("abre uma sala e devolve o código", async () => {
    const sala = await criarSala();

    assert.match(sala.codigo, /^[2-9A-HJ-NP-Z]{6}$/);
    assert.equal(sala.fase, "aguardando");
    assert.equal(sala.titulo, "Geografia");
  });

  it("recusa abrir sala de quiz sem perguntas", async () => {
    // 20 pessoas entrarem numa sala que termina na primeira tela é
    // pior do que recusar aqui.
    const { dados } = await cliente.post("/api/quizzes", { titulo: "Vazio" });

    const resposta = await cliente.post("/api/salas", { quiz_id: dados.quiz.id });

    assert.equal(resposta.status, 400);
  });

  it("recusa abrir sala de quiz de outra pessoa", async () => {
    const sala = await criarSala();

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Outro",
      email: "outro@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.post("/api/salas", { quiz_id: sala.quizId });
    assert.equal(resposta.status, 404);
  });

  it("guarda a sala no Redis com prazo de validade", async () => {
    // Ninguém "fecha" uma sala — as pessoas fecham a aba. Sem
    // prazo, o Redis acumularia salas mortas para sempre.
    const sala = await criarSala();

    const prazo = await redis.ttl(`sala:${sala.codigo}`);
    assert.ok(prazo > 0, `a sala deveria ter prazo, veio ${prazo}`);
  });
});

describe("GET /api/salas/:codigo", () => {
  it("encontra a sala e aceita código em minúsculas", async () => {
    // Gente digita como quer; recusar por causa disso é mesquinho.
    const sala = await criarSala();

    const resposta = await cliente.get(`/api/salas/${sala.codigo.toLowerCase()}`);

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.sala.codigo, sala.codigo);
  });

  it("responde 404 para sala que não existe", async () => {
    const resposta = await cliente.get("/api/salas/ZZZZZZ");
    assert.equal(resposta.status, 404);
  });

  it("responde 400 para código malformado", async () => {
    const resposta = await cliente.get("/api/salas/abc");
    assert.equal(resposta.status, 400);
  });
});

describe("WebSocket: entrar na sala", () => {
  it("o apresentador assume a sala com o cookie de sessão", async () => {
    const sala = await criarSala();

    const host = await abrir({ cookie: sala.cookie });
    host.enviar({ tipo: "apresentar", codigo: sala.codigo });

    const bemVindo = await host.esperar("bem-vindo");

    assert.equal(bemVindo.papel, "apresentador");
    assert.equal(bemVindo.sala.codigo, sala.codigo);
    assert.deepEqual(bemVindo.jogadores, []);
  });

  it("recusa quem tenta apresentar sem ser o dono", async () => {
    const sala = await criarSala();

    // Sem cookie nenhum: é um desconhecido.
    const intruso = await abrir();
    intruso.enviar({ tipo: "apresentar", codigo: sala.codigo });

    const erro = await intruso.esperar("erro");
    assert.equal(erro.codigo, "nao-autorizado");
  });

  it("o jogador entra só com código e apelido, sem conta", async () => {
    const sala = await criarSala();

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });

    const bemVindo = await jogador.esperar("bem-vindo");

    assert.equal(bemVindo.papel, "jogador");
    assert.equal(bemVindo.voce.apelido, "Ana");
    assert.ok(bemVindo.voce.id, "o jogador precisa receber um id");
  });

  it("recusa entrar em sala que não existe", async () => {
    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: "ZZZZZZ", apelido: "Ana" });

    const erro = await jogador.esperar("erro");
    assert.equal(erro.codigo, "sala-inexistente");
  });

  it("recusa apelido repetido na mesma sala", async () => {
    // Duas "Ana" no placar não dizem a ninguém quem ganhou.
    const sala = await criarSala();

    const primeira = await abrir();
    primeira.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });
    await primeira.esperar("bem-vindo");

    const segunda = await abrir();
    segunda.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "ana" });

    const erro = await segunda.esperar("erro");
    assert.equal(erro.codigo, "apelido-em-uso");
  });

  it("recusa apelido curto demais", async () => {
    const sala = await criarSala();

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "A" });

    const erro = await jogador.esperar("erro");
    assert.equal(erro.codigo, "apelido-invalido");
  });

  it("fecha a conexão com código 1008 quando recusa", async () => {
    // Fechar explicando o motivo é a diferença entre o cliente
    // mostrar "sala não encontrada" e só mostrar "desconectado".
    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: "ZZZZZZ", apelido: "Ana" });

    const fechamento = await jogador.esperarFechar();
    assert.equal(fechamento.codigo, 1008);
  });

  it("recusa mensagem que não é JSON", async () => {
    const jogador = await abrir();
    jogador.socket.send("isso não é json");

    const erro = await jogador.esperar("erro");
    assert.equal(erro.codigo, "json-invalido");
  });
});

describe("WebSocket: a lista de jogadores ao vivo", () => {
  it("avisa o apresentador quando alguém entra", async () => {
    // É a prova de que o tempo real funciona: o apresentador não
    // pediu nada, e a informação chegou nele.
    const sala = await criarSala();

    const host = await abrir({ cookie: sala.cookie });
    host.enviar({ tipo: "apresentar", codigo: sala.codigo });
    await host.esperar("bem-vindo");

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });

    const lista = await host.esperar("jogadores");

    assert.equal(lista.jogadores.length, 1);
    assert.equal(lista.jogadores[0].apelido, "Ana");
  });

  it("todos recebem a lista completa, em ordem", async () => {
    // Mandamos a lista inteira, não "fulano entrou": assim quem
    // perdeu uma mensagem no meio se corrige sozinho.
    const sala = await criarSala();

    for (const apelido of ["Carlos", "Ana", "Beatriz"]) {
      const jogador = await abrir();
      jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido });
      await jogador.esperar("bem-vindo");
    }

    const ultimo = abertas[abertas.length - 1];
    const lista = await ultimo.esperar("jogadores");

    assert.deepEqual(
      lista.jogadores.map((j) => j.apelido),
      ["Ana", "Beatriz", "Carlos"]
    );
  });

  it("tira o jogador da lista quando ele fecha a aba", async () => {
    const sala = await criarSala();

    const host = await abrir({ cookie: sala.cookie });
    host.enviar({ tipo: "apresentar", codigo: sala.codigo });
    await host.esperar("bem-vindo");

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });
    await host.esperar("jogadores");

    await jogador.fechar();

    const lista = await host.esperar("jogadores");
    assert.deepEqual(lista.jogadores, []);
  });

  it("não derruba a sala quando o apresentador cai", async () => {
    // Antes, qualquer queda da conexão dele encerrava a sala na
    // hora — e isso tornava o sistema frágil de um jeito difícil
    // de diagnosticar: um restart do servidor em desenvolvimento
    // derrubava todo mundo, ou pior, congelava a tela dele sem
    // aviso enquanto a sala seguia viva.
    const sala = await criarSala();

    const host = await abrir({ cookie: sala.cookie });
    host.enviar({ tipo: "apresentar", codigo: sala.codigo });
    await host.esperar("bem-vindo");

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });
    await jogador.esperar("bem-vindo");

    await host.fechar();

    // A sala continua de pé, esperando ele voltar.
    assert.equal(await redis.exists(`sala:${sala.codigo}`), 1);

    const resposta = await cliente.get(`/api/salas/${sala.codigo}`);
    assert.equal(resposta.status, 200);
  });

  it("o apresentador reassume a sala ao reconectar", async () => {
    const sala = await criarSala();

    const host = await abrir({ cookie: sala.cookie });
    host.enviar({ tipo: "apresentar", codigo: sala.codigo });
    await host.esperar("bem-vindo");

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });
    await jogador.esperar("bem-vindo");

    await host.fechar();

    // Volta — como faria o navegador reconectando sozinho.
    const voltou = await abrir({ cookie: sala.cookie });
    voltou.enviar({ tipo: "apresentar", codigo: sala.codigo });

    const bemVindo = await voltou.esperar("bem-vindo");

    // E recebe o estado atual: quem ainda está na sala.
    assert.deepEqual(bemVindo.jogadores.map((j) => j.apelido), ["Ana"]);
  });

  it("o jogador retoma o lugar com o id anterior", async () => {
    // Sem isto, reconectar seria recusado por "apelido em uso" —
    // pelo próprio jogador que acabou de cair.
    const sala = await criarSala();

    const jogador = await abrir();
    jogador.enviar({ tipo: "entrar", codigo: sala.codigo, apelido: "Ana" });
    const primeiro = await jogador.esperar("bem-vindo");

    await jogador.fechar();

    const voltou = await abrir();
    voltou.enviar({
      tipo: "entrar",
      codigo: sala.codigo,
      apelido: "Ana",
      jogadorId: primeiro.voce.id
    });

    const segundo = await voltou.esperar("bem-vindo");

    assert.equal(segundo.voce.id, primeiro.voce.id);
    assert.equal(segundo.voce.retomou, true);
  });
});

describe("WebSocket: segurança do handshake", () => {
  it("recusa conexão vinda de outra origem", async () => {
    // O navegador NÃO aplica a política de mesma origem a
    // WebSocket. Sem esta checagem, qualquer site conseguiria
    // abrir uma conexão autenticada com o cookie da pessoa.
    await assert.rejects(
      conectar(baseWs, { origem: "http://site-malicioso.com" }),
      /socket hang up|ECONNRESET|Unexpected server response/
    );
  });
});
