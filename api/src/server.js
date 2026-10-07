// ============================================================
// Servidor da API
//
// Rode com:  npm run dev
// Abre em:   http://localhost:3003
//
// Na fase 2 este mesmo servidor passa a aceitar WebSocket. Ele
// continuará sendo um servidor HTTP: a conexão WebSocket começa
// como uma requisição HTTP comum que pede "upgrade" para outro
// protocolo. Por isso os dois convivem na mesma porta.
//
// `app` é exportado separado do `.listen()` — os testes de
// integração sobem um servidor efêmero numa porta aleatória
// contra o banco de teste, sem disputar a porta 3003.
// ============================================================

import { createServer } from "node:http";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { pool } from "../db/pool.js";
import { redis } from "./redis.js";

import rotasUsuarios from "./rotas/usuarios.js";
import rotasSessoes from "./rotas/sessoes.js";
import rotasQuizzes from "./rotas/quizzes.js";
import rotasSalas from "./rotas/salas.js";
import { pendurarWebSocket } from "./tempo-real/servidor-ws.js";

export const app = express();

// ----- Middlewares -----

// O painel roda em outra porta e manda o cookie de sessão junto.
// credentials: true é o que permite isso — e obriga a listar a
// origem exata, porque o navegador recusa "*" com credenciais.
app.use(
  cors({
    origin: process.env.ORIGEM_PAINEL || "http://localhost:5175",
    credentials: true
  })
);

app.use(express.json({ limit: "256kb" })); // um quiz de 50 perguntas cabe folgado
app.use(cookieParser());

// Atrás de proxy (Render, Fly, nginx), req.ip vira o IP do proxy
// e o rate limit contaria o mundo inteiro como uma pessoa só.
if (process.env.CONFIAR_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ----- Rotas -----

app.get("/health", async (req, res) => {
  const saude = { status: "ok", banco: "conectado", redis: "conectado" };

  try {
    await pool.query("SELECT 1");
  } catch {
    saude.status = "erro";
    saude.banco = "indisponível";
  }

  try {
    await redis.ping();
  } catch {
    // Sem Redis não há login nem partida ao vivo — aqui ele é
    // essencial, diferente do Atalho, onde era só cache.
    saude.status = "erro";
    saude.redis = "indisponível";
  }

  res.status(saude.status === "ok" ? 200 : 503).json(saude);
});

app.use("/api/usuarios", rotasUsuarios);
app.use("/api/sessoes", rotasSessoes);
app.use("/api/quizzes", rotasQuizzes);
app.use("/api/salas", rotasSalas);

// As telas são servidas pela própria API, e não por um servidor
// separado. Isso faz a conexão WebSocket ser de MESMA ORIGEM, o
// que vale tanto em localhost quanto no IP da rede local — que é
// como o celular de quem joga vai chegar aqui.
//
// Na fase 5, o painel React roda no Vite durante o
// desenvolvimento (outra porta, por causa do recarregamento
// automático) e é compilado para esta mesma pasta na hora do
// deploy. Por isso o CORS continua configurado.
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "../../web")));

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

// ----- Tratamento de erro -----
// Middleware de erro tem 4 parâmetros. É assim que o Express o
// reconhece. Qualquer erro lançado nas rotas cai aqui.
app.use((erro, req, res, next) => {
  console.error("Erro não tratado:", erro);

  if (res.headersSent) return;

  res.status(500).json({ erro: "Erro interno do servidor" });
});

/**
 * Cria o servidor HTTP com o WebSocket pendurado nele.
 *
 * Antes era `app.listen()`, que cria o servidor HTTP por baixo
 * dos panos e não devolve ele. Agora precisamos do objeto na mão:
 * é nele que o WebSocket escuta o evento "upgrade". Os dois
 * dividem a mesma porta porque, no fundo, são a mesma conexão.
 *
 * Os testes de integração chamam esta função para subir um
 * servidor efêmero numa porta aleatória, COM WebSocket — testar o
 * HTTP num servidor e o WebSocket noutro provaria menos.
 */
export function criarServidor() {
  const servidorHttp = createServer(app);
  const wss = pendurarWebSocket(servidorHttp);

  // Fechar o servidor HTTP não fecha os WebSockets abertos — eles
  // já deixaram de ser HTTP. Sem isto, o processo não termina.
  servidorHttp.on("close", () => wss.close());

  return servidorHttp;
}

const executadoDiretamente = process.argv[1] === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  const PORTA = process.env.PORT || 3003;

  criarServidor().listen(PORTA, () => {
    console.log(`\nAPI rodando em http://localhost:${PORTA}`);
    console.log(`WebSocket em  ws://localhost:${PORTA}/ws`);
    console.log(`Saúde: http://localhost:${PORTA}/health\n`);
  });
}
