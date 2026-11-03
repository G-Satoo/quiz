// ============================================================
// Moderação de quizzes
//
// As regras de quem entra no catálogo, num lugar só. As rotas do
// dono (pedir aprovação, denunciar) e as do administrador (decidir)
// chamam daqui, para nenhuma das duas reinventar a outra.
//
// O caminho de um quiz:
//
//   rascunho ──(dono pede)──> IA ──> publicado | recusado | revisao
//   publicado ──(3 denúncias)──> revisao
//   revisao ──(administrador)──> publicado | recusado
//   recusado ──(dono edita)──> rascunho
//
// PUBLICADO NÃO SE EDITA. O dono só bloqueia e desbloqueia
// perguntas; para mudar conteúdo, duplica, e a cópia nasce
// rascunho. Assim o que está no catálogo é sempre exatamente o
// que foi aprovado.
// ============================================================

import { pool } from "../../db/pool.js";
import { moderarQuiz } from "./ia.js";

/**
 * Quantas pessoas diferentes precisam denunciar para o quiz sair
 * do ar sozinho, antes de um administrador olhar.
 *
 * Uma só deixaria qualquer um derrubar qualquer quiz. Muitas
 * deixariam um quiz ruim no ar tempo demais. Três é o meio-termo
 * comum: exige que mais de uma pessoa tenha visto o problema.
 */
export const LIMITE_DENUNCIAS = 3;

const SITUACAO_POR_DECISAO = {
  aprovar: "publicado",
  recusar: "recusado",
  revisar: "revisao"
};

/**
 * O quiz inteiro, como a IA e o administrador precisam ler.
 *
 * TODAS as perguntas, inclusive as bloqueadas: uma bloqueada pode
 * ser desbloqueada depois, e desbloquear não passa pela moderação.
 * Se ela não fosse lida agora, seria o jeito de entrar com
 * conteúdo que ninguém viu.
 */
export async function carregarParaModeracao(id) {
  const { rows } = await pool.query(
    `SELECT q.id, q.titulo, q.descricao, q.categoria, q.usuario_id,
            q.situacao, q.versao,
            c.tipo AS capa_tipo, c.bytes AS capa_bytes,
            (SELECT COUNT(*) FROM perguntas p
              WHERE p.quiz_id = q.id AND p.ativa)::int AS ativas,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'enunciado', p.enunciado,
                       'ativa', p.ativa,
                       'alternativas', (
                         SELECT json_agg(json_build_object('texto', a.texto, 'correta', a.correta)
                                         ORDER BY a.ordem)
                           FROM alternativas a WHERE a.pergunta_id = p.id)
                     ) ORDER BY p.ativa DESC, p.ordem, p.id)
                FROM perguntas p WHERE p.quiz_id = q.id
            ), '[]') AS perguntas
       FROM quizzes q
       LEFT JOIN capas c ON c.quiz_id = q.id
      WHERE q.id = $1`,
    [id]
  );

  return rows[0] ?? null;
}

/**
 * Passa o quiz pela IA e grava o veredito.
 *
 * A capa, se houver, vai junto: são os bytes que o dono enviou e
 * que estão guardados aqui — exatamente o que o catálogo vai
 * mostrar. Perguntas certas com uma capa imprópria são recusadas
 * do mesmo jeito.
 *
 * Devolve { situacao, motivo } — ou { mudou: true } quando o quiz
 * foi editado durante a análise (inclusive trocando a capa). Nesse
 * caso NADA é gravado: o que a IA aprovou já não é o que está no
 * banco.
 *
 * Se a IA falhar (cota, rede), o ErroIA sobe e a situação fica como
 * estava. Falha não aprova.
 */
export async function analisarComIA(quiz) {
  const capa = quiz.capa_bytes ? { tipo: quiz.capa_tipo, bytes: quiz.capa_bytes } : null;

  const veredito = await moderarQuiz(quiz, capa);
  const situacao = SITUACAO_POR_DECISAO[veredito.decisao];

  const { rowCount } = await pool.query(
    `UPDATE quizzes
        SET situacao = $1,
            moderacao_motivo = $2,
            moderacao_por = 'ia',
            moderacao_em = now()
      WHERE id = $3 AND versao = $4`,
    [situacao, veredito.motivo, quiz.id, quiz.versao]
  );

  if (rowCount === 0) return { mudou: true };
  return { situacao, motivo: veredito.motivo, categoria: veredito.categoria };
}

/**
 * Registra uma edição de conteúdo.
 *
 * A versão sobe sempre — é ela que invalida uma análise que estava
 * em andamento. Recusado volta a rascunho, para o dono corrigir e
 * mandar de novo.
 *
 * Quiz em revisão continua em revisão: quem decide é o
 * administrador, e ele vai ler a versão nova.
 *
 * Publicado nunca chega aqui: as rotas de edição recusam antes.
 *
 * Recebe o `cliente` de quem chamou, para entrar na mesma
 * transação da edição.
 */
export async function marcarEditado(cliente, id) {
  const { rows } = await cliente.query(
    `UPDATE quizzes
        SET versao = versao + 1,
            situacao = CASE WHEN situacao = 'revisao' THEN 'revisao' ELSE 'rascunho' END,
            moderacao_motivo = CASE WHEN situacao = 'revisao' THEN moderacao_motivo END,
            moderacao_por = CASE WHEN situacao = 'revisao' THEN moderacao_por END,
            moderacao_em = CASE WHEN situacao = 'revisao' THEN moderacao_em END
      WHERE id = $1
      RETURNING situacao`,
    [id]
  );

  return rows[0]?.situacao ?? null;
}

/**
 * Registra a denúncia e, se for a terceira pessoa diferente, tira
 * o quiz do ar até um administrador olhar.
 *
 * Devolve { registrada: false } se esta pessoa já tinha uma
 * denúncia aberta neste quiz.
 */
export async function registrarDenuncia({ quizId, usuarioId, motivo, detalhe }) {
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    const { rowCount } = await cliente.query(
      `INSERT INTO denuncias (quiz_id, usuario_id, motivo, detalhe)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (quiz_id, usuario_id) WHERE resolvida_em IS NULL DO NOTHING`,
      [quizId, usuarioId, motivo, detalhe]
    );

    if (rowCount === 0) {
      await cliente.query("ROLLBACK");
      return { registrada: false };
    }

    const { rows } = await cliente.query(
      `SELECT COUNT(DISTINCT usuario_id)::int AS pessoas
         FROM denuncias WHERE quiz_id = $1 AND resolvida_em IS NULL`,
      [quizId]
    );

    const pessoas = rows[0].pessoas;

    if (pessoas >= LIMITE_DENUNCIAS) {
      await cliente.query(
        `UPDATE quizzes
            SET situacao = 'revisao',
                moderacao_motivo = $2,
                moderacao_por = 'denuncias',
                moderacao_em = now()
          WHERE id = $1 AND situacao = 'publicado'`,
        [quizId, `Denunciado por ${pessoas} pessoas. Fora do catálogo até um administrador revisar.`]
      );
    }

    await cliente.query("COMMIT");
    return { registrada: true };
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}
