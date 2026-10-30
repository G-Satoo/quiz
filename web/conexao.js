// ============================================================
// Conexão que se reconecta sozinha
//
// Um WebSocket cai. Sempre. O wi-fi pisca, o celular troca de
// torre, o servidor reinicia num deploy. A pergunta não é "se",
// é "o que a tela faz quando acontecer".
//
// Sem isto, a página ficava parada para sempre, parecendo que
// simplesmente não havia novidade — que foi exatamente o que
// aconteceu na primeira vez que este projeto foi usado de
// verdade: o apresentador não via ninguém entrar e achou que o
// sistema estava quebrado.
//
// A espera entre tentativas cresce (1s, 2s, 4s… até 10s). Tentar
// de novo imediatamente, para sempre, é o que transforma uma
// instabilidade de rede em um ataque ao seu próprio servidor:
// quando ele voltar, leva mil reconexões na cara ao mesmo tempo.
// ============================================================

const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 10000;

/**
 * @param {object} opcoes
 * @param {function} opcoes.aoAbrir      chamada a cada conexão (inclusive nas reconexões)
 * @param {function} opcoes.aoReceber    uma mensagem chegou
 * @param {function} opcoes.aoMudarEstado "conectado" | "reconectando" | "desistiu"
 */
export function criarConexao({ aoAbrir, aoReceber, aoMudarEstado }) {
  let socket = null;
  let espera = ESPERA_INICIAL_MS;
  let desistiu = false;

  function conectar() {
    // ws:// quando a página veio por http, wss:// quando veio por
    // https. E location.host em vez de endereço fixo: assim isto
    // funciona igual em localhost, no IP da rede local e, um dia,
    // no domínio de verdade.
    const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocolo}//${location.host}/ws`);

    socket.addEventListener("open", () => {
      espera = ESPERA_INICIAL_MS; // deu certo: zera a escada
      aoMudarEstado("conectado");
      aoAbrir();
    });

    socket.addEventListener("message", (evento) => {
      aoReceber(JSON.parse(evento.data));
    });

    socket.addEventListener("close", (evento) => {
      // 1008 é a recusa explícita do servidor ("sala não existe",
      // "apelido em uso"). Insistir nesses casos só repetiria o
      // mesmo erro para sempre — quem foi recusado precisa mudar
      // alguma coisa antes de tentar de novo.
      if (evento.code === 1008 || desistiu) {
        aoMudarEstado("desistiu");
        return;
      }

      aoMudarEstado("reconectando");

      setTimeout(conectar, espera);
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
    });

    // O evento "error" sempre vem acompanhado de um "close" logo
    // depois. Tratar os dois agendaria duas reconexões.
    socket.addEventListener("error", () => {});
  }

  conectar();

  return {
    enviar(mensagem) {
      // readyState 1 = OPEN. Mandar numa conexão que está
      // reconectando lança exceção — e acontece o tempo todo,
      // porque a pessoa continua clicando enquanto a rede volta.
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify(mensagem));
        return true;
      }
      return false;
    },

    encerrar() {
      desistiu = true;
      socket?.close();
    }
  };
}

/**
 * Pinta o indicador de conexão.
 *
 * Num sistema de tempo real, "estou conectado?" é informação de
 * primeira classe. Sem ela, uma tela congelada é indistinguível
 * de uma tela sem novidades.
 */
export function pintarEstado(elemento, estado) {
  const textos = {
    conectado: "conectado",
    reconectando: "reconectando…",
    desistiu: "desconectado"
  };

  elemento.innerHTML = "";

  const bolinha = document.createElement("span");
  bolinha.className =
    "bolinha " + (estado === "conectado" ? "ligado" : estado === "desistiu" ? "caiu" : "");

  const texto = document.createElement("span");
  texto.textContent = textos[estado] ?? estado;

  elemento.append(bolinha, texto);
}
