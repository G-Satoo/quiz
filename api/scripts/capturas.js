// ============================================================
// Tira as capturas de tela do README (docs/capturas/).
//
//   npm run dev              (num terminal, com o catálogo semeado)
//   npm run capturas         (noutro)
//
// Joga uma partida curta de verdade no site local, com a conta de
// demonstração apresentando e um jogador anônimo, e fotografa cada
// momento. Rode de novo quando as telas mudarem.
// ============================================================

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const BASE = process.env.BASE_CAPTURAS || "http://localhost:3003";
const PASTA = join(dirname(fileURLToPath(import.meta.url)), "../../docs/capturas");

// A conta criada pelo `npm run semear` (ver scripts/semear.js).
const DEMO = { email: "demo@quiz.dev", senha: "demo12345" };

await mkdir(PASTA, { recursive: true });

const navegador = await chromium.launch();
const foto = (pagina, nome) => pagina.screenshot({ path: join(PASTA, nome) });

try {
  // ----- Catálogo, como visitante -----
  const visitante = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const catalogo = await visitante.newPage();
  await catalogo.goto(BASE);
  await catalogo.locator("#catalogo .card-quiz").first().waitFor();
  await catalogo.waitForTimeout(800); // capas e fontes
  await foto(catalogo, "catalogo.png");

  // ----- Apresentador -----
  const contextoTelao = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const login = await contextoTelao.request.post(`${BASE}/api/sessoes`, { data: DEMO });
  if (!login.ok()) throw new Error("Não consegui entrar com a conta demo. Rodou `npm run semear`?");

  const { quizzes } = await (await contextoTelao.request.get(`${BASE}/api/quizzes`)).json();
  const quiz = quizzes.find((q) => q.perguntas >= 10 && q.imagem_url) ?? quizzes.find((q) => q.perguntas >= 10);

  const telao = await contextoTelao.newPage();

  await telao.goto(`${BASE}/perfil.html`);
  await telao.locator("#meus .card-quiz").first().waitFor();
  await telao.waitForTimeout(600);
  await foto(telao, "perfil.png");

  await telao.goto(`${BASE}/editor.html?id=${quiz.id}`);
  await telao.locator("#botao-apresentar").waitFor();
  await telao.waitForTimeout(600);
  await foto(telao, "preparar-partida.png");

  await telao.goto(`${BASE}/index.html?apresentar=${quiz.id}&quantidade=10&segundos=20`);
  await telao.locator("#qr-sala svg").waitFor();
  const codigo = (await telao.locator("#codigo").textContent()).trim();

  // ----- Três jogadores, para o pódio ter três degraus -----
  const jogadores = [];
  for (const apelido of ["Ana", "Bruno", "Carla"]) {
    const contexto = await navegador.newContext({ viewport: { width: 390, height: 780 } });
    const pagina = await contexto.newPage();
    await pagina.goto(`${BASE}/jogar.html?codigo=${codigo}`);
    await pagina.locator("#apelido").fill(apelido);
    await pagina.locator("#botao").click();
    await pagina.locator("#tela-espera").waitFor();
    jogadores.push(pagina);
  }

  await telao.locator("#lista li").nth(2).waitFor();
  await foto(telao, "sala-de-espera.png");

  await telao.locator("#botao-comecar").click();

  for (let i = 0; i < 10; i++) {
    await jogadores[0].locator("#posicao", { hasText: `Pergunta ${i + 1} de` }).waitFor();

    if (i === 0) {
      await foto(jogadores[0], "celular-pergunta.png");
      await foto(telao, "telao-pergunta.png");
    }

    // Cada um responde uma alternativa diferente, em tempos
    // diferentes: o placar fica com cara de partida de verdade.
    for (const [n, pagina] of jogadores.entries()) {
      await pagina.waitForTimeout(250 * n);
      await pagina.locator("#alternativas li").nth((i + n) % 2 === 0 ? 0 : n % 3).click();
    }

    await telao.locator("#tela-resultado").waitFor();
    if (i === 0) await foto(telao, "telao-resultado.png");
    if (i === 1) await foto(jogadores[0], "celular-resultado.png");

    await telao.locator("#botao-proxima").click();
  }

  await telao.locator("#tela-fim").waitFor();
  await telao.waitForTimeout(2600); // o pódio sobe um degrau de cada vez
  await foto(telao, "podio.png");

  console.log(`Capturas em ${PASTA}`);
} finally {
  await navegador.close();
}
