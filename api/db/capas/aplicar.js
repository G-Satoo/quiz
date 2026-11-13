// ============================================================
// As capas do catálogo inicial
//
// Os quizzes criados por `npm run semear:catalogo` são conteúdo do
// próprio projeto — e as capas deles também: ilustrações 600x800
// (JPEG, 3:4) guardadas nesta pasta, uma por quiz.
//
// POR QUE NÃO PASSA PELA ROTA DE ENVIAR CAPA
// Quiz no catálogo não troca de capa pela API (o que a moderação
// aprovou é o que todo mundo vê). Aqui é o dono do site pondo a
// arte do site, direto no banco — igual ao catálogo em si, que
// também nasce publicado sem passar pela IA.
//
// Quiz que ainda não tem ilustração fica com o desenho da categoria.
// ============================================================

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PASTA = dirname(fileURLToPath(import.meta.url));

// A conta dona do catálogo inicial (ver scripts/semear-catalogo.js).
const CONTA_DO_CATALOGO = "demo@quiz.dev";

// arquivo -> título do quiz
export const CAPAS_DO_CATALOGO = {
  "segunda-guerra-mundial.jpg": "Segunda Guerra Mundial",
  "formula-1.jpg": "Fórmula 1",
  "como-a-internet-funciona.jpg": "Como a internet funciona",
  "sistema-solar.jpg": "Sistema Solar",
  "rock-nacional.jpg": "Rock nacional",
  "quimica-basica.jpg": "Química básica",
  "brasil-imperio.jpg": "Brasil Império",
  "dragon-ball.jpg": "Dragon Ball",
  "corpo-humano.jpg": "Corpo humano",
  "the-beatles.jpg": "The Beatles",
  "egito-antigo.jpg": "Egito Antigo",
  "culinaria-brasileira.jpg": "Culinária brasileira"
};

/**
 * Põe (ou troca) a capa de cada quiz do catálogo inicial.
 *
 * Só toca em quiz publicado da conta de demonstração, que é a dona
 * do catálogo inicial: um quiz de usuário com o mesmo título fica
 * como está. A versão
 * sobe junto, porque o endereço da capa leva ?v=versao — sem isso
 * o navegador continuaria mostrando a capa antiga do cache.
 *
 * `banco` é o pool ou um cliente de transação. Devolve quantas pôs.
 */
export async function aplicarCapasDoCatalogo(banco) {
  let postas = 0;

  for (const [arquivo, titulo] of Object.entries(CAPAS_DO_CATALOGO)) {
    const bytes = await readFile(join(PASTA, arquivo));

    const { rowCount } = await banco.query(
      `WITH alvo AS (
         UPDATE quizzes SET versao = versao + 1
          WHERE titulo = $1 AND situacao = 'publicado'
            AND usuario_id = (SELECT id FROM usuarios WHERE email = $3)
         RETURNING id
       )
       INSERT INTO capas (quiz_id, tipo, bytes)
       SELECT id, 'image/jpeg', $2 FROM alvo
       ON CONFLICT (quiz_id) DO UPDATE
         SET tipo = EXCLUDED.tipo, bytes = EXCLUDED.bytes, enviada_em = now()`,
      [titulo, bytes, CONTA_DO_CATALOGO]
    );

    postas += rowCount;
  }

  return postas;
}
