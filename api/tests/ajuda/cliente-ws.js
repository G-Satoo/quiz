// ============================================================
// Cliente WebSocket para os testes
//
// Testar WebSocket é diferente de testar HTTP. Em HTTP você
// pergunta e recebe a resposta na mesma linha. Aqui as mensagens
// chegam quando chegam — inclusive mensagens que você não pediu,
// como o aviso de que outra pessoa entrou na sala.
//
// Este ajudante resolve isso guardando tudo que chega numa fila e
// oferecendo um `esperar(tipo)` que resolve quando a mensagem
// daquele tipo aparece — seja agora ou daqui a meio segundo.
//
// Sem isso, todo teste viraria `setTimeout(500)` seguido de
// torcida: lento quando passa e intermitente quando falha.
// ============================================================

import { WebSocket } from "ws";

/**
 * Abre a conexão e espera ela estar pronta.
 *
 * O `cookie` é opcional e serve para o apresentador: é o mesmo
 * cookie de sessão do HTTP, que vai no handshake.
 */
export async function conectar(baseWs, { cookie, origem } = {}) {
  const cabecalhos = {};
  if (cookie) cabecalhos.Cookie = cookie;
  if (origem) cabecalhos.Origin = origem;

  const socket = new WebSocket(baseWs, { headers: cabecalhos });

  const recebidas = [];
  const esperando = []; // { tipo, resolver }

  socket.on("message", (dados) => {
    const mensagem = JSON.parse(dados);

    // Alguém já estava esperando por este tipo? Entrega direto, e
    // NÃO guarda na fila.
    //
    // Guardar aqui também foi um bug de verdade neste arquivo: a
    // mensagem entregue continuava na fila, e a próxima espera
    // pelo mesmo tipo encontrava a velha e devolvia ela. O teste
    // da lista de jogadores falhou dizendo que a pessoa não tinha
    // saído — quando ela tinha saído, e o servidor avisado
    // corretamente. Ajudante de teste com bug acusa o inocente.
    const indice = esperando.findIndex((e) => e.tipo === mensagem.tipo);

    if (indice !== -1) {
      esperando.splice(indice, 1)[0].resolver(mensagem);
      return;
    }

    recebidas.push(mensagem);
  });

  await new Promise((resolver, rejeitar) => {
    socket.once("open", resolver);
    socket.once("error", rejeitar);
  });

  return {
    socket,

    enviar(mensagem) {
      socket.send(JSON.stringify(mensagem));
    },

    /**
     * Espera uma mensagem de um tipo.
     *
     * Olha primeiro o que já chegou: a mensagem pode ter sido
     * entregue antes de o teste chamar esta função. Essa corrida
     * acontece de verdade, e é a fonte número um de teste
     * intermitente com WebSocket.
     */
    esperar(tipo, limiteMs = 3000) {
      const jaChegou = recebidas.findIndex((m) => m.tipo === tipo);
      if (jaChegou !== -1) return Promise.resolve(recebidas.splice(jaChegou, 1)[0]);

      return new Promise((resolver, rejeitar) => {
        const pendente = { tipo, resolver };
        esperando.push(pendente);

        setTimeout(() => {
          const indice = esperando.indexOf(pendente);
          if (indice === -1) return; // já foi resolvida

          esperando.splice(indice, 1);
          rejeitar(
            new Error(
              `Esperava a mensagem "${tipo}" em ${limiteMs}ms. ` +
              `Chegaram: ${recebidas.map((m) => m.tipo).join(", ") || "nenhuma"}`
            )
          );
        }, limiteMs);
      });
    },

    /** Espera o servidor fechar a conexão, devolvendo o código. */
    esperarFechar(limiteMs = 3000) {
      return new Promise((resolver, rejeitar) => {
        if (socket.readyState === WebSocket.CLOSED) return resolver(null);

        socket.once("close", (codigo, motivo) => resolver({ codigo, motivo: String(motivo) }));
        setTimeout(() => rejeitar(new Error("A conexão não fechou a tempo")), limiteMs);
      });
    },

    fechar() {
      return new Promise((resolver) => {
        if (socket.readyState === WebSocket.CLOSED) return resolver();
        socket.once("close", resolver);
        socket.close();
      });
    }
  };
}
