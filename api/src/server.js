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

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { fileURLToPath } from "node:url";

import { pool } from "../db/pool.js";
import { redis } from "./redis.js";

import rotasUsuarios from "./rotas/usuarios.js";
import rotasSessoes from "./rotas/sessoes.js";
import rotasQuizzes from "./rotas/quizzes.js";

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

const executadoDiretamente = process.argv[1] === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  const PORTA = process.env.PORT || 3003;

  app.listen(PORTA, () => {
    console.log(`\nAPI rodando em http://localhost:${PORTA}`);
    console.log(`Saúde: http://localhost:${PORTA}/health\n`);
  });
}
