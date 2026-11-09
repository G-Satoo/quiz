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
import { MIN_PERGUNTAS, MAX_PERGUNTAS } from "../../src/util/validacao.js";
import { analisarComIA, carregarParaModeracao, LIMITE_DENUNCIAS } from "../../src/servicos/moderacao.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";

let servidor;
let cliente;
let base;

before(async () => {
  await prepararBanco();
  ({ servidor, cliente, base } = await subirServidor());
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
 * Toda criação leva o mínimo de perguntas: o servidor recusa
 * quiz abaixo dele, e quiz vazio nem chega a existir.
 */
/** Só as perguntas ativas — é o que a partida enxerga. */
function ativas(quiz) {
  return quiz.perguntas.filter((p) => p.ativa !== false);
}

/**
 * Completa a lista até `total` com perguntas "Extra N".
 *
 * Todo quiz precisa de MIN_PERGUNTAS ativas. Os testes só se
 * importam com uma ou duas delas; o resto é enchimento, e
 * `principais` o ignora na hora de conferir.
 *
 * Para testar bloqueio, passe total acima do mínimo: num quiz com
 * exatamente o mínimo, bloquear é (corretamente) recusado.
 */
function completar(perguntas, total = MIN_PERGUNTAS) {
  const faltam = Math.max(0, total - perguntas.length);
  return [...perguntas, ...Array.from({ length: faltam }, (_, i) => pergunta(`Extra ${i + 1}`))];
}

/** Enunciados ativos, sem o enchimento. */
function principais(quiz) {
  return ativas(quiz)
    .map((p) => p.enunciado)
    .filter((e) => !e.startsWith("Extra "));
}

/**
 * Pede aprovação e confere que passou.
 *
 * Nos testes a IA é o provedor falso, que aprova tudo que não tem
 * os marcadores [recusar] ou [revisar] no texto.
 */
async function publicar(quiz) {
  const resposta = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
  assert.equal(resposta.dados?.quiz?.situacao, "publicado", JSON.stringify(resposta.dados));
  return resposta;
}

/** Cria uma conta nova e deixa o cliente logado nela. */
async function novaConta(nome) {
  cliente.esquecerCookie();
  await cliente.post("/api/usuarios", {
    nome,
    email: `${nome.toLowerCase()}@exemplo.com`,
    senha: "uma-senha-boa"
  });
  return cliente.cookieAtual;
}

async function criarQuiz(titulo = "Geografia") {
  const { dados } = await cliente.post("/api/quizzes", {
    titulo,
    perguntas: completar([pergunta("Pergunta inicial")])
  });
  return dados.quiz;
}

describe("POST /api/quizzes", () => {
  it("cria o quiz com as perguntas, numa requisição só", async () => {
    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Geografia",
      descricao: "Capitais do mundo",
      perguntas: completar([pergunta("Primeira"), pergunta("Segunda")])
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.quiz.titulo, "Geografia");

    const { dados } = await cliente.get(`/api/quizzes/${resposta.dados.quiz.id}`);
    assert.equal(dados.quiz.perguntas.length, MIN_PERGUNTAS);
  });

  it("recusa criar quiz com menos perguntas que o mínimo", async () => {
    // Partida de três perguntas acaba antes de a sala esquentar,
    // e o ranking soma pontos por pergunta: com um piso comum,
    // partidas de quizzes diferentes ficam comparáveis.
    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Curto demais",
      perguntas: completar([], MIN_PERGUNTAS - 1)
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, new RegExp(`pelo menos ${MIN_PERGUNTAS}`));
    assert.match(resposta.dados.erro, /falta 1/);

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);
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
      perguntas: completar([ruim])
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
      perguntas: completar([pergunta(), pergunta("Qual o maior rio?")], MIN_PERGUNTAS + 2)
    });
    await publicar(quiz);

    const resposta = await cliente.get("/api/quizzes");

    assert.equal(resposta.dados.quizzes.length, 1);
    assert.equal(resposta.dados.quizzes[0].perguntas, MIN_PERGUNTAS + 2);
  });

  it("abre para visitante, sem login", async () => {
    // O catálogo é a primeira tela do site. Se ele exigisse
    // sessão, a porta de entrada seria um formulário de login.
    await publicar(await criarQuiz("Aberto a todos"));

    cliente.esquecerCookie();
    const resposta = await cliente.get("/api/quizzes");

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.quizzes.length, 1);
    assert.equal(resposta.dados.quizzes[0].titulo, "Aberto a todos");
  });

  it("mostra o quiz de outra pessoa, com o nome do autor", async () => {
    await publicar(await criarQuiz("De quem veio antes"));

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      nome: "Outra",
      email: "outra@exemplo.com",
      senha: "uma-senha-boa"
    });
    await publicar(await criarQuiz("Meu"));

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
    await publicar(quiz);

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

    // Uma acima do mínimo, para o bloqueio ser aceito.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Fica"), pergunta("Sai")], MIN_PERGUNTAS + 1)
    });
    await publicar(quiz);

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = antes.quiz.perguntas.find((p) => p.enunciado === "Sai");

    // Bloquear não tira do catálogo: não acrescenta conteúdo, e a
    // pergunta bloqueada já tinha sido lida pela moderação.
    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, {
      ativa: false
    });

    cliente.esquecerCookie();
    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(principais(dados.quiz), ["Fica"]);
    assert.equal(dados.quiz.perguntas.length, MIN_PERGUNTAS);
  });
});

describe("PUT /api/quizzes/:id/perguntas", () => {
  it("salva perguntas e alternativas na ordem", async () => {
    const quiz = await criarQuiz();

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Primeira"), pergunta("Segunda"), pergunta("Terceira")])
    });

    assert.equal(resposta.status, 200);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(principais(dados.quiz), ["Primeira", "Segunda", "Terceira"]);
    assert.equal(ativas(dados.quiz)[0].alternativas.length, 3);
    assert.equal(ativas(dados.quiz)[0].alternativas[0].correta, true);
  });

  it("pergunta que sai da lista é DESATIVADA, nunca apagada", async () => {
    // Apagar é irreversível e a pergunta é referenciada por
    // histórico de partida. Quem some da tela sai da partida,
    // mas continua guardada — e dá para reativar.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Antiga 1"), pergunta("Antiga 2")])
    });

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Nova única")])
    });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    // Para a partida, só a nova (mais o enchimento).
    assert.deepEqual(principais(dados.quiz), ["Nova única"]);

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
      perguntas: completar([pergunta("Vai e volta"), pergunta("Fica")], MIN_PERGUNTAS + 1)
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

    // E volta: as ativas de agora mais ela. Reativar TODAS traria de
    // volta também as antigas que repetem as atuais — e pergunta
    // repetida é recusada.
    const alvoDeVolta = { ...meio.quiz.perguntas.find((p) => p.id === alvo.id), ativa: true };
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: [...ativas(meio.quiz), alvoDeVolta]
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

  it("recusa salvar com menos perguntas ativas que o mínimo", async () => {
    const quiz = await criarQuiz();

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([], MIN_PERGUNTAS - 1)
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, new RegExp(`pelo menos ${MIN_PERGUNTAS}`));
  });

  it("desativadas não contam para o mínimo", async () => {
    // Doze na lista, mas três desativadas: sobram nove ativas, e
    // é isso que a partida teria.
    const quiz = await criarQuiz();

    const lista = completar([], MIN_PERGUNTAS + 2).map((p, i) => ({ ...p, ativa: i >= 3 }));

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, { perguntas: lista });
    assert.equal(resposta.status, 400);
  });

  it("recusa salvar com pergunta repetida, dizendo qual", async () => {
    const quiz = await criarQuiz();

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Qual é a capital do Brasil?"), pergunta("qual e a CAPITAL do brasil")])
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /Pergunta 2 repete a pergunta 1/);
  });

  it("não deixa criar quiz com pergunta repetida", async () => {
    const resposta = await cliente.post("/api/quizzes", {
      titulo: "Repetido",
      perguntas: completar([pergunta("A mesma"), pergunta("A mesma.")])
    });

    assert.equal(resposta.status, 400);

    const { dados } = await cliente.get("/api/quizzes?meus=1");
    assert.equal(dados.quizzes.length, 0);
  });

  it("as desativadas não contam para o limite de perguntas", async () => {
    // Pergunta nunca se apaga, então as desativadas se acumulam. Se
    // contassem para o limite, um quiz pararia de salvar depois de
    // algumas trocas — foi o que travou um quiz real, com 220
    // perguntas guardadas e só 20 ativas.
    const quiz = await criarQuiz();

    for (let rodada = 0; rodada < 3; rodada++) {
      const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
        perguntas: completar([], 50)
      });
      assert.equal(resposta.status, 200, `rodada ${rodada + 1}`);
    }

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM perguntas WHERE quiz_id = $1",
      [quiz.id]
    );
    assert.ok(rows[0].total > 50, "as antigas continuam guardadas");

    const demais = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([], MAX_PERGUNTAS + 1)
    });
    assert.equal(demais.status, 400);
    assert.match(demais.dados.erro, new RegExp(`${MAX_PERGUNTAS} perguntas ativas`));
  });

  it("a contagem do catálogo conta só as ativas", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Uma")], MIN_PERGUNTAS + 3)
    });

    // Troca a lista: as treze anteriores viram desativadas.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Só esta")])
    });

    // Pela lista do dono: editar acabou de tirar o quiz do catálogo.
    const { dados } = await cliente.get("/api/quizzes?meus=1");
    assert.equal(dados.quizzes[0].perguntas, MIN_PERGUNTAS);
  });

  it("um PUT recusado não apaga as perguntas que já estavam salvas", async () => {
    // A validação roda ANTES de abrir a transação, de propósito.
    // Se rodasse depois do DELETE, uma pergunta mal preenchida no
    // fim da lista destruiria o trabalho já salvo.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Original A"), pergunta("Original B")])
    });

    const ruim = pergunta("Esta não vale");
    ruim.alternativas = [{ texto: "Única", correta: true }]; // mínimo são 2

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Nova 1"), ruim])
    });

    assert.equal(resposta.status, 400);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(principais(dados.quiz), ["Original A", "Original B"]);
  });

  it("recusa pergunta sem alternativa correta", async () => {
    const quiz = await criarQuiz();

    const semCorreta = pergunta();
    semCorreta.alternativas = semCorreta.alternativas.map((a) => ({ ...a, correta: false }));

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([semCorreta])
    });

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /correta/);
  });

  it("recusa pergunta com duas corretas", async () => {
    const quiz = await criarQuiz();

    const duasCorretas = pergunta();
    duasCorretas.alternativas[1].correta = true;

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([duasCorretas])
    });

    assert.equal(resposta.status, 400);
  });

  it("diz QUAL pergunta está errada", async () => {
    // Numa lista de 15, "pergunta inválida" não ajuda ninguém.
    const quiz = await criarQuiz();

    const ruim = pergunta();
    ruim.segundos = 1;

    const resposta = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta(), pergunta(), ruim])
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
      perguntas: completar([pergunta()])
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
      perguntas: completar([pergunta("Fica"), pergunta("Sai")], MIN_PERGUNTAS + 1)
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz).find((p) => p.enunciado === "Sai");

    const resposta = await cliente.patch(
      `/api/quizzes/${quiz.id}/perguntas/${alvo.id}`,
      { ativa: false }
    );

    assert.equal(resposta.status, 200);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.deepEqual(principais(dados.quiz), ["Fica"]);
  });

  it("desbloqueia de volta", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Uma"), pergunta("Outra")], MIN_PERGUNTAS + 1)
    });

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const alvo = ativas(antes.quiz)[1];

    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, { ativa: false });
    await cliente.patch(`/api/quizzes/${quiz.id}/perguntas/${alvo.id}`, { ativa: true });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(ativas(dados.quiz).length, MIN_PERGUNTAS + 1);
  });

  it("recusa bloquear quando o quiz ficaria abaixo do mínimo", async () => {
    // Num quiz travado (já apresentado) não dá para acrescentar
    // pergunta: deixar bloquear abaixo do mínimo o deixaria sem
    // abrir sala para sempre.
    const quiz = await criarQuiz(); // exatamente o mínimo

    const { dados: antes } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const qualquer = ativas(antes.quiz)[0];

    const resposta = await cliente.patch(
      `/api/quizzes/${quiz.id}/perguntas/${qualquer.id}`,
      { ativa: false }
    );

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, new RegExp(`pelo menos ${MIN_PERGUNTAS}`));

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(ativas(dados.quiz).length, MIN_PERGUNTAS);
  });

  it("não bloqueia pergunta de quiz de outra pessoa", async () => {
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Uma"), pergunta("Outra")], MIN_PERGUNTAS + 1)
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
      perguntas: completar([pergunta("Uma"), pergunta("Duas")])
    });

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.quiz.titulo, "Geografia (cópia)");
    assert.notEqual(resposta.dados.quiz.id, quiz.id);

    const { dados } = await cliente.get(`/api/quizzes/${resposta.dados.quiz.id}`);

    assert.deepEqual(principais(dados.quiz), ["Uma", "Duas"]);
    assert.equal(dados.quiz.perguntas.length, MIN_PERGUNTAS);
    assert.equal(ativas(dados.quiz)[0].alternativas.length, 3);
    assert.equal(ativas(dados.quiz)[0].alternativas[0].correta, true);
  });

  it("a cópia não herda o histórico de acessos", async () => {
    // A audiência é do original. Uma cópia nascer com 300
    // acessos seria mentira sobre algo nunca apresentado.
    const quiz = await criarQuiz();
    await publicar(quiz);

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
      perguntas: completar([pergunta("Original")])
    });

    const { dados: copia } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    await cliente.put(`/api/quizzes/${copia.quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Mexida"), pergunta("Outra mexida")])
    });

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);

    assert.deepEqual(principais(dados.quiz), ["Original"]);
  });

  it("não copia as perguntas desativadas", async () => {
    // Elas foram aposentadas por algum motivo; carregar o lixo
    // de um quiz para dentro do novo não ajudaria ninguém.
    const quiz = await criarQuiz();

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Fica"), pergunta("Sai")])
    });

    // Lista nova inteira: as dez anteriores viram desativadas, e o
    // original passa a ter trinta linhas, das quais dez ativas.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Fica")])
    });

    const { dados: copia } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    const { dados } = await cliente.get(`/api/quizzes/${copia.quiz.id}`);

    assert.equal(dados.quiz.perguntas.length, MIN_PERGUNTAS);
  });

  it("copia o quiz de outra pessoa, e a cópia nasce no nome de quem copiou", async () => {
    // É o que torna o catálogo público utilizável: quem gostou de
    // um quiz alheio leva uma versão própria em vez de pedir
    // permissão para mexer no original.
    const quiz = await criarQuiz("Original de outra pessoa");
    await publicar(quiz);

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
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, { perguntas: completar([pergunta()]) });

    const resposta = await cliente.delete(`/api/quizzes/${quiz.id}`);
    assert.equal(resposta.status, 204);

    // ON DELETE CASCADE em cadeia: quiz -> perguntas -> alternativas.
    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM alternativas");
    assert.equal(rows[0].total, 0);
  });

  it("quiz do catálogo não se apaga: é do site, e o autor fica com o crédito", async () => {
    const rascunho = await criarQuiz("Ainda meu");
    const publicado = await criarQuiz("Já do site");
    await publicar(publicado);

    const { dados: meus } = await cliente.get("/api/quizzes?meus=1");
    const doSite = Object.fromEntries(meus.quizzes.map((q) => [q.titulo, q.do_site]));
    assert.deepEqual(doSite, { "Ainda meu": false, "Já do site": true });

    const recusa = await cliente.delete(`/api/quizzes/${publicado.id}`);
    assert.equal(recusa.status, 409);
    assert.match(recusa.dados.erro, /duplique/);

    const { dados: catalogo } = await cliente.get("/api/quizzes");
    assert.deepEqual(catalogo.quizzes.map((q) => q.titulo), ["Já do site"]);

    // O rascunho continua sendo dele para apagar.
    assert.equal((await cliente.delete(`/api/quizzes/${rascunho.id}`)).status, 204);
  });

  it("apagar a conta leva os rascunhos, mas o quiz do catálogo fica, sem autor", async () => {
    await criarQuiz("Rascunho");
    const publicado = await criarQuiz("No catálogo");
    await publicar(publicado);

    await pool.query("DELETE FROM usuarios WHERE email = 'dono@exemplo.com'");

    const { rows } = await pool.query("SELECT titulo, usuario_id FROM quizzes");
    assert.deepEqual(rows, [{ titulo: "No catálogo", usuario_id: null }]);

    cliente.esquecerCookie();
    const { dados: catalogo } = await cliente.get("/api/quizzes");
    assert.equal(catalogo.quizzes.length, 1);
    assert.equal(catalogo.quizzes[0].autor, null);

    const { status } = await cliente.get(`/api/quizzes/${publicado.id}`);
    assert.equal(status, 200);
  });
});

describe("moderação: só entra no catálogo o que foi aprovado", () => {
  it("quiz novo nasce rascunho: é do dono, mas fica fora do catálogo", async () => {
    const quiz = await criarQuiz("Ainda não");

    assert.equal(quiz.situacao, "rascunho");

    const { dados: catalogo } = await cliente.get("/api/quizzes");
    assert.equal(catalogo.quizzes.length, 0);

    // O dono continua achando em "meus".
    const { dados: meus } = await cliente.get("/api/quizzes?meus=1");
    assert.equal(meus.quizzes[0].situacao, "rascunho");

    // E para os outros ele não existe.
    cliente.esquecerCookie();
    const { status } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(status, 404);
  });

  it("aprovado pela IA entra no catálogo", async () => {
    const quiz = await criarQuiz("Aprovado");
    await publicar(quiz);

    cliente.esquecerCookie();
    const { dados } = await cliente.get("/api/quizzes");
    assert.deepEqual(dados.quizzes.map((q) => q.titulo), ["Aprovado"]);
  });

  it("recusado volta com o motivo e fica fora do catálogo", async () => {
    const quiz = await criarQuiz("Ruim [recusar]");

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.quiz.situacao, "recusado");
    assert.ok(resposta.dados.quiz.moderacao_motivo);

    // O dono lê o motivo para corrigir...
    const { dados: meus } = await cliente.get("/api/quizzes?meus=1");
    assert.equal(meus.quizzes[0].moderacao_motivo, resposta.dados.quiz.moderacao_motivo);

    // ...e ninguém mais vê o quiz.
    cliente.esquecerCookie();
    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);
  });

  it("dúvida da IA não publica: vai para revisão humana", async () => {
    // Na dúvida, a IA não aprova. Errar recusando custa ao dono uma
    // espera; errar aprovando custa a todo mundo que abrir o site.
    const quiz = await criarQuiz("Talvez [revisar]");

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    assert.equal(resposta.dados.quiz.situacao, "revisao");

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);

    // E o dono não pula a fila mandando de novo.
    const outra = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    assert.equal(outra.status, 409);
  });

  it("quiz publicado não se edita: as perguntas ficam como foram aprovadas", async () => {
    // O que está no catálogo é exatamente o que foi aprovado. Para
    // mudar, duplica-se, e a cópia passa pela aprovação de novo.
    const quiz = await criarQuiz("Aprovado e travado");
    await publicar(quiz);

    const edicao = await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Conteúdo novo")])
    });
    assert.equal(edicao.status, 409);
    assert.match(edicao.dados.erro, /Duplicar/);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.ok(!principais(dados.quiz).includes("Conteúdo novo"));
  });

  it("nem o título de um quiz publicado muda", async () => {
    const quiz = await criarQuiz("Título aprovado");
    await publicar(quiz);

    const resposta = await cliente.patch(`/api/quizzes/${quiz.id}`, { titulo: "Outro título" });
    assert.equal(resposta.status, 409);

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes[0].titulo, "Título aprovado");
  });

  it("recusado volta a rascunho quando o dono corrige", async () => {
    const quiz = await criarQuiz("Ruim [recusar]");
    await cliente.post(`/api/quizzes/${quiz.id}/publicar`);

    const resposta = await cliente.patch(`/api/quizzes/${quiz.id}`, { titulo: "Corrigido" });
    assert.equal(resposta.dados.quiz.situacao, "rascunho");
  });

  it("editar durante a análise invalida a aprovação", async () => {
    // A análise leva segundos. Pedir aprovação e trocar o conteúdo
    // nesse meio-tempo não pode publicar um texto que a IA não leu.
    const quiz = await criarQuiz("Inocente");

    // O que a IA vai ler...
    const lido = await carregarParaModeracao(quiz.id);

    // ...e uma edição chegando antes de o veredito ser gravado.
    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Trocado às escondidas")])
    });

    const resultado = await analisarComIA(lido);
    assert.equal(resultado.mudou, true);

    const { dados } = await cliente.get("/api/quizzes?meus=1");
    assert.equal(dados.quizzes[0].situacao, "rascunho");
  });

  it("só o dono pede aprovação", async () => {
    const quiz = await criarQuiz();

    await novaConta("Intrusa");
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);

    assert.equal(resposta.status, 404);
  });

  it("copiar o rascunho de outra pessoa não é permitido", async () => {
    const quiz = await criarQuiz("Rascunho alheio");

    await novaConta("Curiosa");
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/copia`);

    assert.equal(resposta.status, 404);
  });

  it("a cópia nasce rascunho, mesmo de um quiz publicado", async () => {
    const quiz = await criarQuiz();
    await publicar(quiz);

    const { dados } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    assert.equal(dados.quiz.situacao, "rascunho");
  });
});

describe("denúncias", () => {
  it("exige conta", async () => {
    const quiz = await criarQuiz();
    await publicar(quiz);

    cliente.esquecerCookie();
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "ofensivo" });

    assert.equal(resposta.status, 401);
  });

  it("não deixa denunciar o próprio quiz", async () => {
    const quiz = await criarQuiz();
    await publicar(quiz);

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "ofensivo" });
    assert.equal(resposta.status, 400);
  });

  it("recusa motivo fora da lista", async () => {
    const quiz = await criarQuiz();
    await publicar(quiz);

    await novaConta("Leitora");
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "não gostei" });

    assert.equal(resposta.status, 400);
  });

  it("uma denúncia aberta por pessoa", async () => {
    // Sem isso, uma pessoa sozinha tiraria qualquer quiz do ar.
    const quiz = await criarQuiz();
    await publicar(quiz);

    await novaConta("Insistente");
    const primeira = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "ofensivo" });
    const segunda = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "ofensivo" });

    assert.equal(primeira.status, 201);
    assert.equal(segunda.status, 409);

    // Continua no ar: uma pessoa não basta.
    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 1);
  });

  it(`${LIMITE_DENUNCIAS} pessoas diferentes tiram o quiz do ar`, async () => {
    const quiz = await criarQuiz();
    await publicar(quiz);

    for (let i = 1; i <= LIMITE_DENUNCIAS; i++) {
      await novaConta(`Pessoa${i}`);
      const resposta = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, {
        motivo: "ofensivo",
        detalhe: "a pergunta 3 tem um xingamento"
      });
      assert.equal(resposta.status, 201);
    }

    const { dados } = await cliente.get("/api/quizzes");
    assert.equal(dados.quizzes.length, 0);
  });

  it("rascunho não pode ser denunciado (para os outros, ele não existe)", async () => {
    const quiz = await criarQuiz();

    await novaConta("Leitor");
    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "ofensivo" });

    assert.equal(resposta.status, 404);
  });
});

describe("fila do administrador", () => {
  async function virarAdmin() {
    await pool.query("UPDATE usuarios SET admin = TRUE WHERE email = 'dono@exemplo.com'");
  }

  it("só administrador vê a fila", async () => {
    const resposta = await cliente.get("/api/moderacao/fila");
    assert.equal(resposta.status, 403);
  });

  it("o que a IA não teve certeza aparece na fila, com o conteúdo inteiro", async () => {
    const quiz = await criarQuiz("Na dúvida [revisar]");
    await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    await virarAdmin();

    const { dados } = await cliente.get("/api/moderacao/fila");

    assert.equal(dados.fila.length, 1);
    assert.equal(dados.fila[0].situacao, "revisao");
    assert.equal(dados.fila[0].perguntas.length, MIN_PERGUNTAS);
    assert.ok(dados.fila[0].perguntas[0].alternativas.some((a) => a.correta));
  });

  it("publicar pela fila põe no catálogo e encerra as denúncias", async () => {
    const quiz = await criarQuiz("Denunciado sem razão");
    await publicar(quiz);
    const donoCookie = cliente.cookieAtual;

    for (let i = 1; i <= LIMITE_DENUNCIAS; i++) {
      await novaConta(`Exagerada${i}`);
      await cliente.post(`/api/quizzes/${quiz.id}/denuncias`, { motivo: "outro" });
    }

    cliente.definirCookie(donoCookie);
    await virarAdmin();

    const { dados: fila } = await cliente.get("/api/moderacao/fila");
    const item = fila.fila.find((q) => q.id === quiz.id);
    assert.equal(item.denuncias.length, LIMITE_DENUNCIAS);

    const decisao = await cliente.post(`/api/moderacao/${quiz.id}`, {
      decisao: "publicar",
      versao: item.versao
    });
    assert.equal(decisao.status, 200);

    const { dados: catalogo } = await cliente.get("/api/quizzes");
    assert.equal(catalogo.quizzes.length, 1);

    const { dados: depois } = await cliente.get("/api/moderacao/fila");
    assert.equal(depois.fila.length, 0);
  });

  it("recusar exige dizer o motivo ao autor", async () => {
    const quiz = await criarQuiz("Na dúvida [revisar]");
    await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    await virarAdmin();

    const { dados } = await cliente.get("/api/moderacao/fila");
    const resposta = await cliente.post(`/api/moderacao/${quiz.id}`, {
      decisao: "recusar",
      versao: dados.fila[0].versao
    });

    assert.equal(resposta.status, 400);
  });

  it("decisão sobre uma versão que o autor já mudou é recusada", async () => {
    // Aprovar o que o administrador leu, não o que entrou depois.
    const quiz = await criarQuiz("Na dúvida [revisar]");
    await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    await virarAdmin();

    const { dados } = await cliente.get("/api/moderacao/fila");
    const versaoLida = dados.fila[0].versao;

    await cliente.put(`/api/quizzes/${quiz.id}/perguntas`, {
      perguntas: completar([pergunta("Mudou depois")])
    });

    const resposta = await cliente.post(`/api/moderacao/${quiz.id}`, {
      decisao: "publicar",
      versao: versaoLida
    });

    assert.equal(resposta.status, 409);
  });
});

describe("capa enviada pelo dono", () => {
  /**
   * Um "PNG" mínimo: a assinatura de 8 bytes que identifica o
   * formato, e o que vier depois. O servidor decide o tipo pelos
   * primeiros bytes, então isto basta para ser aceito como PNG.
   */
  function png(conteudo = "") {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
      Buffer.from(conteudo)
    ]);
  }

  // O cliente dos testes fala JSON; a capa vai como bytes.
  async function enviarCapa(quizId, bytes, tipo = "image/png") {
    const resposta = await fetch(`${base}/api/quizzes/${quizId}/capa`, {
      method: "PUT",
      headers: { "Content-Type": tipo, Cookie: cliente.cookieAtual ?? "" },
      body: bytes
    });
    return { status: resposta.status, dados: await resposta.json().catch(() => null) };
  }

  async function baixarCapa(url) {
    const resposta = await fetch(base + url, { headers: { Cookie: cliente.cookieAtual ?? "" } });
    return { status: resposta.status, tipo: resposta.headers.get("content-type"), bytes: Buffer.from(await resposta.arrayBuffer()) };
  }

  it("o dono envia a capa e ela é servida daqui, com os mesmos bytes", async () => {
    const quiz = await criarQuiz();
    const arquivo = png("minha capa");

    const envio = await enviarCapa(quiz.id, arquivo);
    assert.equal(envio.status, 200);

    const { dados } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.match(dados.quiz.imagem_url, new RegExp(`^/api/quizzes/${quiz.id}/capa\\?v=\\d+$`));

    const capa = await baixarCapa(dados.quiz.imagem_url);
    assert.equal(capa.status, 200);
    assert.equal(capa.tipo, "image/png");
    assert.ok(capa.bytes.equals(arquivo));
  });

  it("capa de rascunho é só do dono; publicada é de todo mundo", async () => {
    const quiz = await criarQuiz();
    await enviarCapa(quiz.id, png());
    const url = `/api/quizzes/${quiz.id}/capa`;
    const donoCookie = cliente.cookieAtual;

    cliente.esquecerCookie();
    assert.equal((await baixarCapa(url)).status, 404);

    cliente.definirCookie(donoCookie);
    await publicar(quiz);

    cliente.esquecerCookie();
    assert.equal((await baixarCapa(url)).status, 200);
  });

  it("recusa o que não é imagem, mesmo dizendo que é", async () => {
    // O Content-Type é o que o cliente DIZ que mandou. Quem decide é
    // o começo do arquivo.
    const quiz = await criarQuiz();

    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const resposta = await enviarCapa(quiz.id, html, "image/png");

    assert.equal(resposta.status, 400);
    assert.match(resposta.dados.erro, /não é uma imagem/);
  });

  it("recusa SVG", async () => {
    // SVG é texto que pode carregar script.
    const quiz = await criarQuiz();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const resposta = await enviarCapa(quiz.id, svg, "image/svg+xml");
    assert.equal(resposta.status, 400);
  });

  it("recusa arquivo acima do limite, com 413 e não com erro interno", async () => {
    const quiz = await criarQuiz();
    const grande = png("x".repeat(1024 * 1024 + 10));

    const resposta = await enviarCapa(quiz.id, grande);
    assert.equal(resposta.status, 413);
  });

  it("perguntas certas com capa imprópria: recusado", async () => {
    // A capa vai para a IA junto com o texto. Aprovar as perguntas e
    // deixar passar a imagem seria o pior caso: a capa é a primeira
    // coisa que todo mundo vê.
    const quiz = await criarQuiz("Perguntas impecáveis");
    await enviarCapa(quiz.id, png("[recusar]"));

    const resposta = await cliente.post(`/api/quizzes/${quiz.id}/publicar`);
    assert.equal(resposta.dados.quiz.situacao, "recusado");
    assert.match(resposta.dados.quiz.moderacao_motivo, /[Cc]apa/);
  });

  it("trocar a capa de um quiz publicado não é permitido", async () => {
    // A capa aprovada é a capa servida. Trocar depois seria o mesmo
    // buraco do endereço externo, só que por dentro.
    const quiz = await criarQuiz();
    await enviarCapa(quiz.id, png("aprovada"));
    await publicar(quiz);

    const troca = await enviarCapa(quiz.id, png("trocada às escondidas"));
    assert.equal(troca.status, 409);

    const remocao = await fetch(`${base}/api/quizzes/${quiz.id}/capa`, {
      method: "DELETE",
      headers: { Cookie: cliente.cookieAtual }
    });
    assert.equal(remocao.status, 409);
  });

  it("trocar a capa durante a análise invalida a aprovação", async () => {
    const quiz = await criarQuiz();
    await enviarCapa(quiz.id, png("inocente"));

    const lido = await carregarParaModeracao(quiz.id);
    await enviarCapa(quiz.id, png("trocada"));

    const resultado = await analisarComIA(lido);
    assert.equal(resultado.mudou, true);
  });

  it("a cópia leva a capa junto", async () => {
    const quiz = await criarQuiz();
    const arquivo = png("vai junto");
    await enviarCapa(quiz.id, arquivo);
    await publicar(quiz);

    const { dados } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    const { dados: copia } = await cliente.get(`/api/quizzes/${dados.quiz.id}`);

    const capa = await baixarCapa(copia.quiz.imagem_url);
    assert.ok(capa.bytes.equals(arquivo));
  });

  it("só o dono envia capa", async () => {
    const quiz = await criarQuiz();

    await novaConta("Vizinha");
    const resposta = await enviarCapa(quiz.id, png());

    assert.equal(resposta.status, 404);
  });
});

describe("perfil público do autor", () => {
  it("mostra nome e números, e nunca o e-mail", async () => {
    const quiz = await criarQuiz("Do autor");
    await publicar(quiz);

    const { dados: lido } = await cliente.get(`/api/quizzes/${quiz.id}`);
    const autorId = lido.quiz.autor_id;

    cliente.esquecerCookie();
    const { status, dados } = await cliente.get(`/api/usuarios/${autorId}`);

    assert.equal(status, 200);
    assert.equal(dados.usuario.nome, "Apresentador");
    assert.equal(dados.usuario.quizzes, 1);
    assert.ok(!("email" in dados.usuario), "o e-mail vazou no perfil público");
  });

  it("só o que está no catálogo: rascunho não conta nem aparece", async () => {
    const publicado = await criarQuiz("Publicado");
    await publicar(publicado);
    await criarQuiz("Rascunho escondido");

    const { dados: lido } = await cliente.get(`/api/quizzes/${publicado.id}`);
    const autorId = lido.quiz.autor_id;

    cliente.esquecerCookie();
    const { dados: perfil } = await cliente.get(`/api/usuarios/${autorId}`);
    const { dados: lista } = await cliente.get(`/api/quizzes?autor=${autorId}`);

    assert.equal(perfil.usuario.quizzes, 1);
    assert.deepEqual(lista.quizzes.map((q) => q.titulo), ["Publicado"]);
  });

  it("?autor= de uma pessoa não traz o quiz de outra", async () => {
    await publicar(await criarQuiz("Da primeira"));

    await novaConta("Segunda");
    const meu = await criarQuiz("Da segunda");
    await publicar(meu);

    const { dados: lido } = await cliente.get(`/api/quizzes/${meu.id}`);
    const { dados } = await cliente.get(`/api/quizzes?autor=${lido.quiz.autor_id}`);

    assert.deepEqual(dados.quizzes.map((q) => q.titulo), ["Da segunda"]);
  });

  it("pessoa que não existe dá 404", async () => {
    const { status } = await cliente.get("/api/usuarios/999999");
    assert.equal(status, 404);
  });
});

describe("foto de perfil", () => {
  const png = (conteudo = "") => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
    Buffer.from(conteudo)
  ]);

  async function enviarFoto(bytes, tipo = "image/png") {
    const resposta = await fetch(`${base}/api/usuarios/eu/foto`, {
      method: "PUT",
      headers: { "Content-Type": tipo, Cookie: cliente.cookieAtual ?? "" },
      body: bytes
    });
    return { status: resposta.status, dados: await resposta.json().catch(() => null) };
  }

  it("aprovada, aparece no /eu, no catálogo e é servida para qualquer um", async () => {
    const arquivo = png("minha foto");
    const envio = await enviarFoto(arquivo);
    assert.equal(envio.status, 200);

    const { dados: eu } = await cliente.get("/api/usuarios/eu");
    assert.equal(eu.usuario.foto, envio.dados.foto);

    await publicar(await criarQuiz("Com autor de foto"));
    const { dados: catalogo } = await cliente.get("/api/quizzes");
    assert.equal(catalogo.quizzes[0].autor_foto, envio.dados.foto);

    cliente.esquecerCookie();
    const resposta = await fetch(base + envio.dados.foto);
    assert.equal(resposta.status, 200);
    assert.ok(Buffer.from(await resposta.arrayBuffer()).equals(arquivo));
  });

  it("recusada não é gravada, e a foto anterior continua", async () => {
    const boa = await enviarFoto(png("a boa"));
    const ruim = await enviarFoto(png("[recusar]"));

    assert.equal(ruim.status, 422);
    assert.match(ruim.dados.erro, /não foi aceita/);

    const { dados } = await cliente.get("/api/usuarios/eu");
    assert.equal(dados.usuario.foto, boa.dados.foto);
  });

  it("recusa o que não é imagem e exige conta", async () => {
    const html = await enviarFoto(Buffer.from("<html><script>alert(1)</script></html>"));
    assert.equal(html.status, 400);

    cliente.esquecerCookie();
    const anonimo = await enviarFoto(png());
    assert.equal(anonimo.status, 401);
  });

  it("tirar a foto volta para a inicial", async () => {
    await enviarFoto(png());
    const resposta = await fetch(`${base}/api/usuarios/eu/foto`, {
      method: "DELETE",
      headers: { Cookie: cliente.cookieAtual }
    });
    assert.equal(resposta.status, 204);

    const { dados } = await cliente.get("/api/usuarios/eu");
    assert.equal(dados.usuario.foto, null);
  });

  it("o perfil público traz foto, pontos, vitórias, o quiz mais acessado e a categoria", async () => {
    await enviarFoto(png());
    const quiz = await criarQuiz("O mais acessado");
    await publicar(quiz);
    await cliente.post("/api/salas", { quiz_id: quiz.id });

    const { dados: lido } = await cliente.get(`/api/quizzes/${quiz.id}`);

    cliente.esquecerCookie();
    const { dados } = await cliente.get(`/api/usuarios/${lido.quiz.autor_id}`);

    assert.ok(dados.usuario.foto);
    assert.equal(dados.usuario.pontos, 0);
    assert.equal(dados.usuario.vitorias, 0);
    assert.deepEqual(dados.usuario.quiz_destaque, { id: quiz.id, titulo: "O mais acessado", acessos: 1 });
    assert.equal(dados.usuario.categoria_favorita, "geral");
  });
});

describe("perfil editável", () => {
  const png = (conteudo = "") => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
    Buffer.from(conteudo)
  ]);

  async function enviarBanner(bytes) {
    const resposta = await fetch(`${base}/api/usuarios/eu/banner`, {
      method: "PUT",
      headers: { "Content-Type": "image/png", Cookie: cliente.cookieAtual ?? "" },
      body: bytes
    });
    return { status: resposta.status, dados: await resposta.json().catch(() => null) };
  }

  it("muda nome, bio e cor, e o perfil público mostra", async () => {
    const resposta = await cliente.patch("/api/usuarios/eu", {
      nome: "Novo Nome",
      bio: "Gosto de quiz de história.",
      cor: "roxo"
    });
    assert.equal(resposta.status, 200);

    const { dados: eu } = await cliente.get("/api/usuarios/eu");
    cliente.esquecerCookie();
    const { dados } = await cliente.get(`/api/usuarios/${eu.usuario.id}`);

    assert.equal(dados.usuario.nome, "Novo Nome");
    assert.equal(dados.usuario.bio, "Gosto de quiz de história.");
    assert.equal(dados.usuario.cor, "roxo");
  });

  it("nome ou bio impróprios não são gravados", async () => {
    const resposta = await cliente.patch("/api/usuarios/eu", { bio: "olá [recusar]" });
    assert.equal(resposta.status, 422);

    const { dados } = await cliente.get("/api/usuarios/eu");
    assert.equal(dados.usuario.bio, null);
  });

  it("recusa cor fora da lista e bio longa demais", async () => {
    assert.equal((await cliente.patch("/api/usuarios/eu", { cor: "#ff00ff" })).status, 400);
    assert.equal((await cliente.patch("/api/usuarios/eu", { bio: "x".repeat(201) })).status, 400);
  });

  it("o banner aprovado é servido; o recusado não troca o anterior", async () => {
    const bom = await enviarBanner(png("fundo"));
    assert.equal(bom.status, 200);

    const ruim = await enviarBanner(png("[recusar]"));
    assert.equal(ruim.status, 422);

    const { dados } = await cliente.get("/api/usuarios/eu");
    assert.equal(dados.usuario.banner, bom.dados.banner);

    cliente.esquecerCookie();
    const servido = await fetch(base + bom.dados.banner);
    assert.equal(servido.status, 200);
  });
});

describe("tema do quiz", () => {
  async function criarComTema(tema) {
    const { dados } = await cliente.post("/api/quizzes", {
      titulo: "Ninjas",
      tema,
      perguntas: completar([pergunta("Pergunta inicial")])
    });
    return dados.quiz;
  }

  it("é salvo na criação e não muda mais", async () => {
    const quiz = await criarComTema("Naruto");
    assert.equal(quiz.tema, "Naruto");

    const { dados } = await cliente.patch(`/api/quizzes/${quiz.id}`, { tema: "Futebol" });
    assert.equal(dados.quiz.tema, "Naruto");

    const { dados: lido } = await cliente.get(`/api/quizzes/${quiz.id}`);
    assert.equal(lido.quiz.tema, "Naruto");
  });

  it("quiz sem tema recebe o da primeira geração", async () => {
    const quiz = await criarQuiz();
    assert.equal(quiz.tema, null);

    const { dados } = await cliente.patch(`/api/quizzes/${quiz.id}`, { tema: "Capitais" });
    assert.equal(dados.quiz.tema, "Capitais");
  });

  it("gerar para o quiz usa o tema dele, não o do pedido", async () => {
    const quiz = await criarComTema("Naruto");

    const { dados } = await cliente.post("/api/geracao/perguntas", {
      tema: "Futebol",
      quantidade: 2,
      quizId: quiz.id
    });

    // O provedor falso escreve o tema no enunciado.
    assert.ok(dados.perguntas.every((p) => p.enunciado.includes("Naruto")), JSON.stringify(dados.perguntas));
  });

  it("a cópia herda o tema", async () => {
    const quiz = await criarComTema("Naruto");
    const { dados } = await cliente.post(`/api/quizzes/${quiz.id}/copia`);
    assert.equal(dados.quiz.tema, "Naruto");
  });
});
