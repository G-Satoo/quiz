// ============================================================
// Semeia o banco com um quiz de demonstração
//
// Rode com:  npm run semear
//
// ATENÇÃO: apaga a conta de demonstração inteira antes de
// recriar — e com ela vão os quizzes dela, pelo ON DELETE
// CASCADE. É assim de propósito, para poder rodar várias vezes
// sem empilhar dado nem falhar por e-mail repetido. Se você criar
// quizzes de verdade, use uma conta sua: esta é descartável.
// ============================================================

import "dotenv/config";

import { pool } from "../db/pool.js";
import { gerarHash } from "../src/servicos/senha.js";

const EMAIL = "demo@quiz.dev";
const SENHA = "demo12345";

const QUIZ = {
  titulo: "Conhecimentos gerais",
  descricao: "Um quiz de exemplo, para testar a partida ao vivo",
  perguntas: [
    {
      enunciado: "Qual é a capital do Brasil?",
      segundos: 15,
      alternativas: ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"],
      correta: 0
    },
    {
      enunciado: "Quem escreveu 'Grande Sertão: Veredas'?",
      segundos: 20,
      alternativas: ["Machado de Assis", "Guimarães Rosa", "Clarice Lispector", "Jorge Amado"],
      correta: 1
    },
    {
      enunciado: "Qual destes NÃO é um banco de dados relacional?",
      segundos: 20,
      alternativas: ["PostgreSQL", "MySQL", "MongoDB", "SQLite"],
      correta: 2
    },
    {
      enunciado: "Em que ano a seleção brasileira ganhou a primeira Copa?",
      segundos: 15,
      alternativas: ["1950", "1958", "1962", "1970"],
      correta: 1
    },
    {
      enunciado: "O que o cabeçalho HTTP 'Referer' informa?",
      segundos: 25,
      alternativas: [
        "O endereço de IP de quem acessou",
        "A página de onde a pessoa veio",
        "O navegador usado",
        "A data da requisição"
      ],
      correta: 1
    }
  ]
};

async function semear() {
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    await cliente.query("DELETE FROM usuarios WHERE email = $1", [EMAIL]);

    const { rows: usuarios } = await cliente.query(
      `INSERT INTO usuarios (nome, email, senha_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ["Apresentador Demo", EMAIL, await gerarHash(SENHA)]
    );

    const { rows: quizzes } = await cliente.query(
      `INSERT INTO quizzes (usuario_id, titulo, descricao, tema)
       VALUES ($1, $2, $3, $2) RETURNING id`,
      [usuarios[0].id, QUIZ.titulo, QUIZ.descricao]
    );

    for (const [ordem, pergunta] of QUIZ.perguntas.entries()) {
      const { rows: criadas } = await cliente.query(
        `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [quizzes[0].id, ordem, pergunta.enunciado, pergunta.segundos]
      );

      for (const [posicao, texto] of pergunta.alternativas.entries()) {
        await cliente.query(
          `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
           VALUES ($1, $2, $3, $4)`,
          [criadas[0].id, posicao, texto, posicao === pergunta.correta]
        );
      }
    }

    await cliente.query("COMMIT");

    console.log(`Quiz "${QUIZ.titulo}" criado com ${QUIZ.perguntas.length} perguntas.`);
    console.log(`\nEntre no painel com:\n  e-mail: ${EMAIL}\n  senha:  ${SENHA}\n`);
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}

try {
  await semear();
} catch (erro) {
  const detalhe = erro.errors?.map((e) => e.message).join(" / ") || erro.message;
  console.error(`\nFalha ao semear: ${detalhe}`);
  console.error("O banco está de pé e migrado? Rode: npm run migrar\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
