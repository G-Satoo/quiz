// ============================================================
// Testes da partida
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

let servidor;
let cliente;
let baseWs;
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

async function abrir(opcoes) {
  const conexao = await conectar(baseWs, opcoes);
  abertas.push(conexao);
  return conexao;
}

/**
 * Monta um quiz de duas perguntas e abre a sala.
 *
 * Tempo curto (5 segundos, o mínimo que o banco aceita) para o
 * teste do tempo esgotado não demorar meio minuto.
 */
async function prepararPartida() {
  const { dados: criado } = await cliente.post("/api/quizzes", {
    titulo: "Geografia",
    perguntas: [
      {
        enunciado: "Capital do Brasil?",
        segundos: 5,
        alternativas: [
          { texto: "Brasília", correta: true },
          { texto: "São Paulo", correta: false },
          { texto: "Recife", correta: false }
        ]
      },
      {
        enunciado: "Maior rio do mundo?",
        segundos: 5,
        alternativas: [
          { texto: "Nilo", correta: false },
          { texto: "Amazonas", correta: true }
        ]
      }
    ]
  });

  const { dados } = await cliente.post("/api/salas", { quiz_id: criado.quiz.id });
  const cookie = cliente.cookieAtual;

  const host = await abrir({ cookie });
  host.enviar({ tipo: "apresentar", codigo: dados.sala.codigo });
  await host.esperar("bem-vindo");

  return { codigo: dados.sala.codigo, host, cookie };
}

async function entrarJogador(codigo, apelido) {
  const jogador = await abrir();
  jogador.enviar({ tipo: "entrar", codigo, apelido });
  const bemVindo = await jogador.esperar("bem-vindo");
  return { ...jogador, id: bemVindo.voce.id, esperar: jogador.esperar, enviar: jogador.enviar };
}

describe("começar a partida", () => {
  it("transmite a pergunta para todo mundo", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    host.enviar({ tipo: "comecar" });

    const paraOHost = await host.esperar("pergunta");
    const paraAna = await ana.esperar("pergunta");

    assert.equal(paraOHost.enunciado, "Capital do Brasil?");
    assert.equal(paraAna.enunciado, "Capital do Brasil?");
    assert.equal(paraAna.indice, 0);
    assert.equal(paraAna.total, 2);
  });

  it("NUNCA manda qual alternativa é a correta", async () => {
    // O teste mais importante deste arquivo. Mandar o gabarito e
    // "esconder na tela" entrega o jogo para quem abrir o
    // inspetor do navegador — e é um erro de uma linha só: um
    // `.map` esquecido no servidor.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    for (const alternativa of pergunta.alternativas) {
      assert.deepEqual(
        Object.keys(alternativa).sort(),
        ["id", "texto"],
        "a alternativa não pode carregar mais nada além de id e texto"
      );
    }

    // E por via das dúvidas, a mensagem inteira não pode conter
    // a palavra em lugar nenhum.
    assert.ok(!JSON.stringify(pergunta).includes("correta"));
  });

  it("recusa começar com a sala vazia", async () => {
    const { host } = await prepararPartida();

    host.enviar({ tipo: "comecar" });

    const erro = await host.esperar("erro");
    assert.equal(erro.codigo, "sala-vazia");
  });

  it("só o apresentador começa", async () => {
    const { codigo } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    ana.enviar({ tipo: "comecar" });

    const erro = await ana.esperar("erro");
    assert.equal(erro.codigo, "nao-autorizado");
  });
});

describe("responder", () => {
  it("confirma o recebimento sem dizer se acertou", async () => {
    // Saber na hora permitiria avisar o colega do lado.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

    const confirmacao = await ana.esperar("resposta-recebida");
    assert.ok(!JSON.stringify(confirmacao).includes("acert"));
  });

  it("recusa a segunda resposta do mesmo jogador", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    await entrarJogador(codigo, "Bruno"); // para a pergunta não fechar sozinha

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[1].id });
    await ana.esperar("resposta-recebida");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

    const erro = await ana.esperar("erro");
    assert.equal(erro.codigo, "ja-respondeu");
  });

  it("avisa o apresentador quantos já responderam", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    await entrarJogador(codigo, "Bruno");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

    const aviso = await host.esperar("respondeu");
    assert.equal(aviso.quantos, 1);
    assert.equal(aviso.total, 2);
  });

  it("fecha a pergunta sozinha quando todos responderam", async () => {
    // Esperar o cronômetro com a sala inteira já decidida é tempo
    // morto numa apresentação.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

    const resultado = await host.esperar("resultado");
    assert.equal(resultado.indice, 0);
  });
});

describe("resultado e pontuação", () => {
  it("conta quem escolheu cada alternativa e revela a certa", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    const bruno = await entrarJogador(codigo, "Bruno");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");
    await bruno.esperar("pergunta");

    const correta = pergunta.alternativas[0]; // "Brasília"
    const errada = pergunta.alternativas[1];

    ana.enviar({ tipo: "responder", alternativaId: correta.id });
    bruno.enviar({ tipo: "responder", alternativaId: errada.id });

    const resultado = await host.esperar("resultado");

    assert.equal(resultado.alternativaCorretaId, correta.id);

    const porTexto = Object.fromEntries(
      resultado.distribuicao.map((d) => [d.texto, d.escolhas])
    );

    assert.equal(porTexto["Brasília"], 1);
    assert.equal(porTexto["São Paulo"], 1);
    assert.equal(porTexto["Recife"], 0);
  });

  it("dá pontos a quem acertou e zero a quem errou", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    const bruno = await entrarJogador(codigo, "Bruno");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");
    await bruno.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });
    bruno.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[1].id });

    const resultado = await host.esperar("resultado");
    const placar = Object.fromEntries(resultado.placar.map((p) => [p.apelido, p.pontos]));

    assert.ok(placar.Ana > 0, "quem acertou deveria pontuar");
    assert.equal(placar.Bruno, 0);
  });

  it("cada jogador recebe só o resultado dele", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    const bruno = await entrarJogador(codigo, "Bruno");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");
    await bruno.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });
    bruno.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[1].id });

    const daAna = await ana.esperar("sua-resposta");
    const doBruno = await bruno.esperar("sua-resposta");

    assert.equal(daAna.acertou, true);
    assert.ok(daAna.ganhos > 0);

    assert.equal(doBruno.acertou, false);
    assert.equal(doBruno.ganhos, 0);
  });

  it("manda o resultado pessoal ANTES do resultado da sala", async () => {
    // A ordem importa para a tela: ela desenha o veredito
    // ("acertou!") ao receber o resultado da sala, e precisa já
    // saber o que aconteceu com aquele jogador. Na ordem
    // inversa, quem tinha acabado de pontuar via "você não
    // respondeu" — aconteceu de verdade no primeiro teste no
    // navegador.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    const ordem = [];
    ana.socket.on("message", (dados) => {
      const tipo = JSON.parse(dados).tipo;
      if (tipo === "sua-resposta" || tipo === "resultado") ordem.push(tipo);
    });

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });
    await host.esperar("resultado");
    await new Promise((r) => setTimeout(r, 200));

    assert.deepEqual(ordem, ["sua-resposta", "resultado"]);
  });

  it("quem acerta mais rápido ganha mais", async () => {
    // É a metade da pontuação que depende do tempo. Sem ela, o
    // placar empataria sempre que todos acertassem.
    const { codigo, host } = await prepararPartida();
    const rapida = await entrarJogador(codigo, "Ana");
    const lento = await entrarJogador(codigo, "Bruno");

    host.enviar({ tipo: "comecar" });
    const pergunta = await rapida.esperar("pergunta");
    await lento.esperar("pergunta");

    const correta = pergunta.alternativas[0];

    rapida.enviar({ tipo: "responder", alternativaId: correta.id });
    await rapida.esperar("resposta-recebida");

    await new Promise((r) => setTimeout(r, 1500));

    lento.enviar({ tipo: "responder", alternativaId: correta.id });

    const resultado = await host.esperar("resultado");
    const placar = Object.fromEntries(resultado.placar.map((p) => [p.apelido, p.pontos]));

    assert.ok(
      placar.Ana > placar.Bruno,
      `Ana (${placar.Ana}) deveria ter mais que Bruno (${placar.Bruno})`
    );
  });
});

describe("avançar e terminar", () => {
  it("vai para a pergunta seguinte", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    host.enviar({ tipo: "comecar" });
    const primeira = await ana.esperar("pergunta");

    ana.enviar({ tipo: "responder", alternativaId: primeira.alternativas[0].id });
    await host.esperar("resultado");

    host.enviar({ tipo: "proxima" });

    const segunda = await ana.esperar("pergunta");
    assert.equal(segunda.enunciado, "Maior rio do mundo?");
    assert.equal(segunda.indice, 1);
  });

  it("termina com o placar final depois da última", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    for (let i = 0; i < 2; i++) {
      host.enviar(i === 0 ? { tipo: "comecar" } : { tipo: "proxima" });

      const pergunta = await ana.esperar("pergunta");
      ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

      const resultado = await host.esperar("resultado");
      assert.equal(resultado.ultima, i === 1);
    }

    host.enviar({ tipo: "proxima" });

    const fim = await host.esperar("fim");
    assert.equal(fim.placar[0].apelido, "Ana");
  });
});

/** Joga as duas perguntas com todos respondendo a primeira alternativa. */
async function jogarAteOFim(host, jogadores) {
  for (let i = 0; i < 2; i++) {
    host.enviar(i === 0 ? { tipo: "comecar" } : { tipo: "proxima" });

    for (const jogador of jogadores) {
      const pergunta = await jogador.esperar("pergunta");
      jogador.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });
    }

    await host.esperar("resultado");
  }

  host.enviar({ tipo: "proxima" });
  for (const jogador of jogadores) await jogador.esperar("fim");
  return host.esperar("fim");
}

describe("depois do fim: ranking e avaliação", () => {
  it("jogador sem conta joga, mas não entra no ranking do dia", async () => {
    // Sem conta, "Ana" é só um apelido: somar todos os "Ana" do
    // dia juntaria pessoas diferentes.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    await jogarAteOFim(host, [ana]);

    cliente.esquecerCookie();
    const { status, dados } = await cliente.get("/api/ranking/hoje");

    assert.equal(status, 200);
    assert.deepEqual(dados.jogadores, []);
  });

  it("jogador com conta entra no ranking, com os pontos do dia somados", async () => {
    const hostCookie = cliente.cookieAtual;

    // A conta do jogador. Cadastrar já loga — guardamos o cookie
    // dele e devolvemos o do apresentador ao cliente HTTP.
    await cliente.post("/api/usuarios", {
      nome: "Beatriz",
      email: "bia@exemplo.com",
      senha: "uma-senha-boa"
    });
    const biaCookie = cliente.cookieAtual;
    cliente.definirCookie(hostCookie);

    let total = 0;

    for (let partida = 0; partida < 2; partida++) {
      const { codigo, host } = await prepararPartida();

      const conexao = await abrir({ cookie: biaCookie });
      conexao.enviar({ tipo: "entrar", codigo, apelido: partida === 0 ? "Bia" : "biazinha" });
      await conexao.esperar("bem-vindo");

      const fim = await jogarAteOFim(host, [conexao]);
      total += fim.placar[0].pontos;
    }

    cliente.esquecerCookie();
    const { dados } = await cliente.get("/api/ranking/hoje");

    assert.equal(dados.jogadores.length, 1);
    // O nome é o da conta, não o apelido de nenhuma das partidas.
    assert.equal(dados.jogadores[0].nome, "Beatriz");
    assert.equal(dados.jogadores[0].partidas, 2);
    assert.equal(dados.jogadores[0].pontos, total);

    // E o perfil dela enxerga as mesmas partidas.
    cliente.definirCookie(biaCookie);
    const { dados: perfil } = await cliente.get("/api/usuarios/eu/perfil");
    assert.equal(perfil.perfil.partidas, 2);
    assert.equal(perfil.perfil.pontos, total);
  });

  it("o jogador avalia depois do fim, e a nota entra na média do quiz", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    const bia = await entrarJogador(codigo, "Bia");

    await jogarAteOFim(host, [ana, bia]);

    ana.enviar({ tipo: "avaliar", nota: 5 });
    await ana.esperar("avaliacao-recebida");
    bia.enviar({ tipo: "avaliar", nota: 4 });
    await bia.esperar("avaliacao-recebida");

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes[0].nota, 4.5);
    assert.equal(dados.quizzes[0].avaliacoes, 2);
  });

  it("votar de novo troca a nota, não soma outra", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    await jogarAteOFim(host, [ana]);

    ana.enviar({ tipo: "avaliar", nota: 2 });
    await ana.esperar("avaliacao-recebida");
    ana.enviar({ tipo: "avaliar", nota: 5 });
    await ana.esperar("avaliacao-recebida");

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes[0].nota, 5);
    assert.equal(dados.quizzes[0].avaliacoes, 1);
  });

  it("recusa avaliar antes de a partida terminar", async () => {
    // Nota de quem não jogou até o fim seria o jeito mais barato
    // de inflar ou afundar um quiz.
    const { codigo } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    ana.enviar({ tipo: "avaliar", nota: 1 });
    const erro = await ana.esperar("erro");

    assert.equal(erro.codigo, "partida-nao-terminou");
  });

  it("recusa nota fora de 1 a 5", async () => {
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");

    await jogarAteOFim(host, [ana]);

    ana.enviar({ tipo: "avaliar", nota: 10 });
    const erro = await ana.esperar("erro");

    assert.equal(erro.codigo, "nota-invalida");
  });
});

describe("fechamento da pergunta", () => {
  it("duas respostas simultâneas não fecham a pergunta duas vezes", async () => {
    // Era um bug: as duas últimas respostas viam "todo mundo
    // respondeu" e fechavam a pergunta cada uma — a sala recebia
    // dois resultados e quem acertou ganhava os pontos em dobro.
    const { codigo, host } = await prepararPartida();
    const ana = await entrarJogador(codigo, "Ana");
    const bia = await entrarJogador(codigo, "Bia");

    host.enviar({ tipo: "comecar" });
    const pergunta = await ana.esperar("pergunta");
    await bia.esperar("pergunta");

    // As duas no mesmo tique.
    ana.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });
    bia.enviar({ tipo: "responder", alternativaId: pergunta.alternativas[0].id });

    const resultado = await host.esperar("resultado");

    // Nenhum segundo resultado deve chegar.
    await assert.rejects(host.esperar("resultado", 800));

    // E os pontos são de UM acerto: no máximo 1000.
    for (const linha of resultado.placar) {
      assert.ok(linha.pontos <= 1000, `${linha.apelido} ficou com ${linha.pontos}`);
    }
  });
});
