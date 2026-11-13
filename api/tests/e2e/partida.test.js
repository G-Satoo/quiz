// ============================================================
// Teste de ponta a ponta: uma partida inteira, pelas TELAS
//
// Rode com:
//   docker compose --profile teste up -d db-teste redis-teste
//   npx playwright install chromium     (só na primeira vez)
//   npm run test:e2e
//
// POR QUE EXISTE
//
// Os testes de integração falam com o servidor direto, por HTTP e
// WebSocket — e passavam todos enquanto a tela do jogador tinha um
// defeito que só deixava responder a PRIMEIRA pergunta de cada
// partida (a lista de alternativas travava e nunca destravava).
// O servidor estava certo; quem errava era o JavaScript da página,
// que nenhum teste abria.
//
// Aqui um navegador de verdade faz o que duas pessoas fariam: uma
// apresenta no telão, a outra entra pelo link do QR e responde.
// ============================================================

import "../ajuda/ambiente-teste.js"; // precisa vir primeiro — ver o arquivo

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { chromium } from "playwright";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { MIN_PERGUNTAS } from "../../src/util/validacao.js";

let servidor;
let cliente;
let base;
let navegador;

before(async () => {
  await prepararBanco();
  await limpar();
  ({ servidor, cliente, base } = await subirServidor());
  navegador = await chromium.launch();
});

after(async () => {
  await navegador?.close();
  servidor.close();
  await encerrarConexoes();
});

/** Em toda pergunta a certa é "Certa" — o teste sabe o que clicar. */
function perguntas() {
  return Array.from({ length: MIN_PERGUNTAS }, (_, i) => ({
    enunciado: `Pergunta ${i + 1}`,
    segundos: 10,
    alternativas: [
      { texto: "Certa", correta: true },
      { texto: "Errada", correta: false },
      { texto: "Outra errada", correta: false }
    ]
  }));
}

describe("uma partida pelas telas", () => {
  it("o jogador entra pelo link, responde TODAS as perguntas e vê o pódio", async () => {
    // ----- O apresentador e o quiz, pela API (não é o que está em teste) -----
    await cliente.post("/api/usuarios", { nome: "Apresentador", email: "dono@exemplo.com", senha: "uma-senha-boa" });
    const { dados } = await cliente.post("/api/quizzes", { titulo: "Quiz de teste", perguntas: perguntas() });
    await cliente.post(`/api/quizzes/${dados.quiz.id}/publicar`);

    // ----- Duas pessoas, dois navegadores separados -----
    const contextoTelao = await navegador.newContext();
    const [nome, valor] = cliente.cookieAtual.split("=");
    await contextoTelao.addCookies([{ name: nome, value: valor, url: base }]);
    const telao = await contextoTelao.newPage();

    const contextoCelular = await navegador.newContext({ viewport: { width: 390, height: 800 } });
    const celular = await contextoCelular.newPage();

    // Erro de JavaScript em qualquer das telas derruba o teste.
    const erros = [];
    telao.on("pageerror", (erro) => erros.push(`telão: ${erro.message}`));
    celular.on("pageerror", (erro) => erros.push(`celular: ${erro.message}`));

    // ----- A sala abre, com código e QR -----
    // Pela página do quiz, que é por onde o catálogo leva: o botão
    // "Abrir sala" de lá apresenta com todas as perguntas.
    await telao.goto(`${base}/quiz.html?id=${dados.quiz.id}`);
    assert.equal(await telao.locator("#titulo").textContent(), "Quiz de teste");
    await telao.locator("#botao-jogar").click();
    await telao.locator("#tela-espera").waitFor();
    const codigo = (await telao.locator("#codigo").textContent()).trim();
    assert.match(codigo, /^[A-Z0-9]{6}$/);
    await telao.locator("#qr-sala svg").waitFor();

    // ----- O jogador chega pelo link do QR: o código já vem preenchido -----
    await celular.goto(`${base}/jogar.html?codigo=${codigo}`);
    assert.equal(await celular.locator("#codigo").inputValue(), codigo);
    await celular.locator("#apelido").fill("Ana");
    await celular.locator("#botao").click();
    await celular.locator("#tela-espera").waitFor();

    await telao.locator("#lista li", { hasText: "Ana" }).waitFor();
    await telao.locator("#botao-comecar").click();

    // ----- Todas as perguntas: é AQUI que o defeito aparecia, na segunda -----
    for (let i = 0; i < MIN_PERGUNTAS; i++) {
      await celular.locator("#posicao", { hasText: `Pergunta ${i + 1} de ${MIN_PERGUNTAS}` }).waitFor();

      // Uma pelo clique, a seguinte pelo teclado: os dois caminhos.
      const certa = celular.locator("#alternativas li", { hasText: /^[A-F]Certa$/ });
      if (i % 2 === 0) {
        await certa.click();
      } else {
        await certa.focus();
        await celular.keyboard.press("Enter");
      }

      // Com um jogador só, responder fecha a pergunta.
      await celular.locator("#tela-resultado").waitFor();
      assert.equal(await celular.locator("#veredito").textContent(), "Acertou!", `pergunta ${i + 1}`);

      // Do segundo acerto seguido em diante, o bônus aparece.
      if (i >= 1) {
        await celular.locator("#sequencia", { hasText: `${i + 1} seguidas` }).waitFor();
      }

      await telao.locator("#tela-resultado").waitFor();
      await telao.locator("#botao-proxima").click();
    }

    // ----- Fim: pódio nas duas telas -----
    await telao.locator("#tela-fim").waitFor();
    await telao.locator("#podio .degrau-1 .nome-podio", { hasText: "Ana" }).waitFor();

    await celular.locator("#tela-fim").waitFor();
    assert.equal(await celular.locator("#colocacao").textContent(), "1º lugar");
    await celular.locator("#podio .degrau-1.eu").waitFor();

    assert.deepEqual(erros, []);

    await contextoTelao.close();
    await contextoCelular.close();
  });
});
