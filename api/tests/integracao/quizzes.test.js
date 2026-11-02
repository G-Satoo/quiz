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

/**
 * Cria um quiz pelo caminho normal.
 *
 * Toda criação leva pelo menos uma pergunta: o servidor recusa
 * quiz vazio, porque quiz sem pergunta não é um quiz incompleto
 * — é um quiz que não existe.
 */
/** Só as perguntas ativas — é o que a partida enxerga. */
function ativas(quiz) {
  return quiz.perguntas.filter((p) => p.ativa !== false);
}

async function criarQuiz(titulo = "Geografia") {
  const { dados } = await cliente.post("/api/quizzes", {
    titulo,
    perguntas: [pergunta("Pergunta inicial")]
  });
  return dados.quiz;
}

describe("POST /api/quizzes", () => {
  it("cria o quiz com as perguntas, numa requisição só", async () => {
    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Geografia",
      descricao: "Capitais do mundo",
      perguntas: [pergunta("Primeira"), pergunta("Segunda")]
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.quiz.titulo, "Geografia");

    const { dados } = await cliente.get(`/api/quizzes/${resposta.dados.quiz.id}`);
    assert.equal(dados.quiz.perguntas.length, 2);
  });

  it("recusa criar quiz sem pergunta nenhuma", async () => {
    // Antes dava para criar vazio e preencher depois. Quando a
    // segunda requisição falhava, sobrava um quiz órfão no
    // catálogo: não abria sala e ninguém sabia de onde veio.
    for (const perguntas of [undefined, [], null]) {
      const resposta = await cliente.post("/api/quizzes", {
        titulo: "Quiz vazio",
        perguntas
      });

      assert.equal(resposta.status, 400, String(perguntas));
    }
  });

  it("não deixa quiz nenhum para trás quando a criação falha", async () => {
    // A pergunta é inválida (uma alternativa só), então o INSERT
    // do quiz tem que ser desfeito junto.
    const ruim = pergunta("Inválida");
    ruim.alternativas = [{ texto: "Única", correta: true }];

    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Não deveria existir",
      perguntas: [ruim]
    });

    assert.equal(resposta.status, 400);

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);
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

  it("abre para visitante, sem login", async () => {
    // O catálogo é a primeira tela do site. Se ele exigisse
    // sessão, a porta de entrada seria um formulário de login.
    await criarQuiz("Aberto a todos");

    cliente.esquecerCookie();
    const resposta = await cliente.get("/api/quizzes");

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.quizzes.length, 1);
    assert.equal(resposta.dados.quizzes[0].titulo, "Aberto a todos");
  });

  it("mostra o quiz de outra pessoa, com o nome do autor", async () => {
    await criarQuiz("De quem veio antes");

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Outra",
      email: "outra@exemplo.com",
      senha: "uma-senha-boa"
    });
    await criarQuiz("Meu");

    const { dados } = await cliente.get("/api/quizzes");
    const porTitulo = Object.fromEntries(dados.quizzes.map((q) => [q.titulo, q]));

    assert.equal(dados.quizzes.length, 2);
    assert.equal(porTitulo["De quem veio antes"].autor, "Apresentador");
    assert.equal(porTitulo["De quem veio antes"].meu, false);
    assert.equal(porTitulo["Meu"].meu, true);
  });

  it("?meus=1 devolve só os seus", async () => {
    await criarQuiz("Da outra pessoa");

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Outra",
      email: "outra@exemplo.com",
      senha: "uma-senha-boa"
    });
    await criarQuiz("O meu");

    const { dados } = await cliente.get("/api/quizzes?meus=1");

    assert.deepEqual(dados.quizzes.map((q) => q.titulo), ["O meu"]);
  });

  it("?meus=1 sem sessão devolve vazio, e não o catálogo todo", async () => {
    // Devolver tudo a quem pediu "só os meus" seria mentir sobre
    // de quem são aquelas linhas.
    await criarQuiz();

    cliente.esquecerCookie();
    const { dados } = await cliente.get("/api/quizzes?meus=1");

    assert.deepEqual(dados.quizzes, []);
  });
});

describe("GET /api/quizzes/:id", () => {
  it("o dono recebe o gabarito", async () => {
    const quiz = await criarQuiz();

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alternativas = dados.quiz.perguntas[0].alternativas;

    assert.equal(dados.quiz.meu, true);
    assert.ok(alternativas.some((a) => a.correta === true), "falta a correta");
  });

  it("visitante NÃO recebe o gabarito", async () => {
    // Catálogo aberto não pode virar lista de respostas: bastaria
    // abrir o DevTools antes de entrar na sala para jogar sabendo
    // tudo.
    const quiz = await criarQuiz();

    cliente.esquecerCookie();
    const { status, dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.equal(status, 200);
    assert.equal(dados.quiz.titulo, "Geografia");

    for (const p of dados.quiz.perguntas) {
      for (const a of p.alternativas) {
        // Ausente, não `false`: mandá-la falsa em todas seria uma
        // afirmação errada.
        assert.ok(!("correta" in a), "vazou o gabarito: " + JSON.stringify(a));
      }
    }
  });

  it("visitante não vê pergunta bloqueada", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Fica"), pergunta("Sai")]
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = antes.quiz.perguntas.find((p) => p.enunciado === "Sai");

    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, {
      ativa: false
    });

    cliente.esquecerCookie();
    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(dados.quiz.perguntas.map((p) => p.enunciado), ["Fica"]);
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
    const enunciados = ativas(dados.quiz).map((p) => p.enunciado);

    assert.deepEqual(enunciados, ["Primeira", "Segunda", "Terceira"]);
    assert.equal(ativas(dados.quiz)[0].alternativas.length, 3);
    assert.equal(ativas(dados.quiz)[0].alternativas[0].correta, true);
  });

  it("pergunta que sai da lista é DESATIVADA, nunca apagada", async () => {
    // Apagar é irreversível e a pergunta é referenciada por
    // histórico de partida. Quem some da tela sai da partida,
    // mas continua guardada — e dá para reativar.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Antiga 1"), pergunta("Antiga 2")]
    });

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Nova única")]
    });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    // Para a partida, só a nova.
    assert.deepEqual(ativas(dados.quiz).map((p) => p.enunciado), ["Nova única"]);

    // Mas as antigas continuam no banco, desativadas.
    const desativadas = dados.quiz.perguntas
      .filter((p) => p.ativa === false)
      .map((p) => p.enunciado);

    assert.ok(desativadas.includes("Antiga 1"));
    assert.ok(desativadas.includes("Antiga 2"));
  });

  it("reativa uma pergunta mandando ela de volta com o id", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Vai e volta"), pergunta("Fica")]
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz).find((p) => p.enunciado === "Vai e volta");

    // Desativa explicitamente, sem tirar da lista.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: ativas(antes.quiz).map((p) => ({
        ...p,
        ativa: p.id !== alvo.id
      }))
    });

    const { dados: meio } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(meio.quiz.perguntas.find((p) => p.id === alvo.id).ativa, false);

    // E volta.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: meio.quiz.perguntas.map((p) => ({ ...p, ativa: true }))
    });

    const { dados: depois } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(depois.quiz.perguntas.find((p) => p.id === alvo.id).ativa, true);
  });

  it("recusa deixar o quiz sem nenhuma pergunta ativa", async () => {
    // Um quiz só com desativadas abriria uma sala que termina
    // na primeira tela.
    const quiz = await criarQuiz();

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: dados.quiz.perguntas.map((p) => ({ ...p, ativa: false }))
    });

    assert.equal(resposta.status, 400);
  });

  it("a contagem do catálogo conta só as ativas", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Uma"), pergunta("Duas"), pergunta("Três")]
    });

    // Some com duas: elas viram desativadas.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Só esta")]
    });

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes[0].perguntas, 1);
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
    const enunciados = ativas(dados.quiz).map((p) => p.enunciado);

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

describe("PATCH /api/quizzes/:id/perguntas/:perguntaId", () => {
  it("bloqueia uma pergunta na hora, sem salvar o quiz", async () => {
    // Num quiz já apresentado não há botão de salvar: bloquear
    // é a única mudança permitida, e tem que valer no clique.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Fica"), pergunta("Sai")]
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz).find((p) => p.enunciado === "Sai");

    const resposta = await cliente.patch(
      `/api/quizzes/${quiz.id}/perguntas/${alvo.id}`,
      { ativa: false }
    );

    assert.equal(resposta.status, 200);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.deepEqual(ativas(dados.quiz).map((p) => p.enunciado), ["Fica"]);
  });

  it("desbloqueia de volta", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Uma"), pergunta("Outra")]
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz)[1];

    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, { ativa: false });
    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, { ativa: true });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(ativas(dados.quiz).length, 2);
  });

  it("recusa bloquear a última pergunta ativa", async () => {
    // Um quiz sem pergunta abriria uma sala que termina na
    // primeira tela.
    const quiz = await criarQuiz();

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const unica = ativas(antes.quiz)[0];

    const resposta = await cliente.patch(
      `/api/quizzes/${quiz.id}/perguntas/${unica.id}`,
      { ativa: false }
    );

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /última pergunta ativa/);
  });

  it("não bloqueia pergunta de quiz de outra pessoa", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Uma"), pergunta("Outra")]
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz)[0];

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Invasor",
      email: "invasor@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.patch(
      `/api/quizzes/${quiz.id}/perguntas/${alvo.id}`,
      { ativa: false }
    );

    assert.equal(resposta.status, 404);
  });
});

describe("POST /api/quizzes/:id/copia", () => {
  it("cria uma cópia independente, com as perguntas", async () => {
    // Existe para não precisar proibir a edição de um quiz que
    // já funciona: quem quer mudar leva uma versão própria.
    const quiz = await criarQuiz("Geografia");

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Uma"), pergunta("Duas")]
    });

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.quiz.titulo, "Geografia (cópia)");
    assert.notEqual(resposta.dados.quiz.id, quiz.id);

    const { dados } = await cliente.get(`/api/quizzes/${resposta.dados.quiz.id}`);
    const enunciados = ativas(dados.quiz).map((p) => p.enunciado);

    assert.deepEqual(enunciados, ["Uma", "Duas"]);
    assert.equal(ativas(dados.quiz)[0].alternativas.length, 3);
    assert.equal(ativas(dados.quiz)[0].alternativas[0].correta, true);
  });

  it("a cópia não herda o histórico de acessos", async () => {
    // A audiência é do original. Uma cópia nascer com 300
    // acessos seria mentira sobre algo nunca apresentado.
    const quiz = await criarQuiz();

    await cliente.post("/api/salas", { quiz_id: quiz.id });
    await cliente.post("/api/salas", { quiz_id: quiz.id });

    const { dados: copia } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    assert.equal(copia.quiz.partidas, 0);

    const { dados } = await cliente.get("/api/quizzes");
    const original = dados.quizzes.find((q) => q.id === quiz.id);

    assert.equal(original.partidas, 2);
  });

  it("mexer na cópia não mexe no original", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Original")]
    });

    const { dados: copia } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    await cliente.put(`/api/quizzes/${copia.quiz.id}/perguntas`, {
      perguntas: [pergunta("Mexida"), pergunta("Outra mexida")]
    });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(ativas(dados.quiz).map((p) => p.enunciado), ["Original"]);
  });

  it("não copia as perguntas desativadas", async () => {
    // Elas foram aposentadas por algum motivo; carregar o lixo
    // de um quiz para dentro do novo não ajudaria ninguém.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Fica"), pergunta("Sai")]
    });

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [pergunta("Fica")]
    });

    const { dados: copia } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    const { dados } = await cliente.get(`/api/quizzes/${copia.quiz.id}`);

    assert.equal(dados.quiz.perguntas.length, 1);
  });

  it("copia o quiz de outra pessoa, e a cópia nasce no nome de quem copiou", async () => {
    // É o que torna o catálogo público utilizável: quem gostou de
    // um quiz alheio leva uma versão própria em vez de pedir
    // permissão para mexer no original.
    const quiz = await criarQuiz("Original de outra pessoa");

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Copiadora",
      email: "copiadora@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    assert.equal(resposta.status, 201);

    // Nasceu no nome de quem copiou — então editar a cópia é
    // editar o que é seu.
    const { dados } = await cliente.get(`/api/quizzes/${resposta.dados.quiz.id}`);
    assert.equal(dados.quiz.autor, "Copiadora");
    assert.equal(dados.quiz.meu, true);

    // E o original segue de pé, intocado.
    const { dados: lista } = await cliente.get("/api/quizzes");
    assert.ok(lista.quizzes.some((q) => q.titulo === "Original de outra pessoa"));
  });

  it("exige login para copiar", async () => {
    const quiz = await criarQuiz();

    cliente.esquecerCookie();
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    assert.equal(resposta.status, 401);
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
