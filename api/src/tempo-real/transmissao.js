// ============================================================
// Transmissão entre instâncias (pub/sub do Redis)
//
// O PROBLEMA, QUE APARECEU DE VERDADE
//
// Os sockets abertos vivem na MEMÓRIA do processo — eles não são
// dado, são canos. Com mais de uma instância da API no ar, os
// jogadores de uma mesma sala se espalham entre elas:
//
//     apresentador ─── instância A
//        jogador   ─── instância B
//
// A sala está no Redis, então as duas a enxergam e o jogador
// entra normalmente. Mas quando B avisa "a lista mudou", o aviso
// só alcança os sockets de B. O apresentador, em A, vê zero
// jogadores para sempre — e nada no log indica erro.
//
// Isso aconteceu neste projeto com dois `npm run dev` abertos ao
// mesmo tempo, em portas diferentes. Em produção acontece sempre
// que houver mais de uma réplica, que é o caso normal.
//
// A SOLUÇÃO
//
// Ninguém entrega mensagem direto. Quem quer falar com uma sala
// PUBLICA no Redis; todas as instâncias estão inscritas e cada
// uma entrega aos sockets que ela própria atende.
//
//     A ──publica──> Redis ──┬──> A entrega aos seus
//                            └──> B entrega aos seus
//
// Repare que quem publica também recebe de volta. Isso é
// proposital: um caminho só, igual para todo mundo, em vez de
// "entrega local + publica para os outros" — que seria duas
// implementações do mesmo comportamento, prontas para divergir.
//
// Por que pub/sub e não a fila do Redis: aqui a mensagem não
// pode esperar. Quem não estava conectado neste instante não
// tem o que fazer com "a pergunta 3 abriu" dez segundos depois.
// Pub/sub entrega a quem está ouvindo agora e esquece — que é
// exatamente a semântica de uma transmissão ao vivo.
// ============================================================

import { criarConexaoRedis } from "../redis.js";

const CANAL = "transmissao";

let publicador = null;
let assinante = null;

/**
 * Liga a transmissão.
 *
 * `entregarLocal(codigo, mensagem, alvo)` é chamada em TODAS as
 * instâncias para cada mensagem publicada; cabe a ela decidir se
 * conhece alguém daquela sala.
 */
export async function iniciar(entregarLocal) {
  // Duas conexões, e não uma: uma conexão em modo de assinatura
  // não aceita mais nenhum outro comando. Tentar publicar por ela
  // dá erro, e é uma das pegadinhas mais comuns do Redis.
  //
  // enableOfflineQueue: true aqui, ao contrário do resto do
  // projeto. O padrão é falhar na hora quando o Redis está fora —
  // certo para uma consulta, que o chamador pode refazer. Para a
  // assinatura, não: ela é emitida uma vez, na subida, e se for
  // descartada por a conexão ainda não estar pronta, esta
  // instância fica muda para sempre, sem erro visível depois.
  publicador = criarConexaoRedis({ enableOfflineQueue: true });
  assinante = criarConexaoRedis({ enableOfflineQueue: true });

  assinante.on("message", (_canal, bruto) => {
    try {
      const { codigo, mensagem, alvo } = JSON.parse(bruto);
      entregarLocal(codigo, mensagem, alvo);
    } catch (erro) {
      console.error("Mensagem de transmissão malformada:", erro.message);
    }
  });

  await assinante.subscribe(CANAL);
}

/**
 * Manda para a sala inteira.
 *
 * `alvo` opcional: o id de um jogador, quando a mensagem é só
 * para ele (o resultado pessoal, por exemplo). Ela trafega por
 * todas as instâncias, mas só a que tiver aquele socket entrega.
 * É mais simples — e mais confiável — do que manter um mapa de
 * "quem está em qual instância", que ficaria desatualizado a cada
 * reconexão.
 */
export function publicar(codigo, mensagem, alvo = null) {
  if (!publicador) return;

  publicador
    .publish(CANAL, JSON.stringify({ codigo, mensagem, alvo }))
    .catch((erro) => console.error("Falha ao publicar:", erro.message));
}

export async function fechar() {
  await assinante?.quit();
  await publicador?.quit();
  assinante = null;
  publicador = null;
}
