// ============================================================
// Servidor WebSocket
//
// COMO UM WEBSOCKET NASCE
//
// Ele não é um protocolo separado que abre uma porta nova. Ele
// começa como uma requisição HTTP comum, pedindo para trocar de
// protocolo:
//
//     GET /ws HTTP/1.1
//     Upgrade: websocket
//     Connection: Upgrade
//     Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
//
// O servidor responde "101 Switching Protocols" e, a partir
// daí, aquela mesma conexão TCP deixa de falar HTTP e passa a
// trocar mensagens nos dois sentidos, até alguém fechar.
//
// É por isso que ele divide a porta 3003 com a API: do ponto de
// vista do sistema operacional, é a mesma conexão de sempre.
//
// A DIFERENÇA QUE MUDA TUDO
//
// Em HTTP, o servidor só fala quando perguntado. Aqui ele fala
// quando quiser — e é isso que permite "a pergunta 3 começou
// agora" chegar nos 40 celulares ao mesmo tempo, sem ninguém
// ficar perguntando de segundo em segundo.
//
// O PROTOCOLO DESTE PROJETO
//
// Mensagens são JSON com um campo `tipo`. Do cliente:
//
//   { tipo: "apresentar", codigo }            o dono abre a sala
//   { tipo: "entrar", codigo, apelido }       o jogador entra
//
// Do servidor:
//
//   { tipo: "bem-vindo", papel, sala, voce }  entrou com sucesso
//   { tipo: "jogadores", jogadores: [...] }   a lista mudou
//   { tipo: "sala-encerrada" }                o apresentador saiu
//   { tipo: "erro", codigo, mensagem }        deu errado
// ============================================================

import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

import { lerSessao, NOME_COOKIE } from "../servicos/sessao.js";
import { normalizarCodigo } from "../util/codigo.js";
import * as salas from "./salas.js";

// ------------------------------------------------------------
// Quem está conectado AGORA, neste processo
//
// Os objetos de conexão (sockets) são do processo: não dá para
// guardá-los no Redis, porque eles não são dado, são canos
// abertos. O Redis guarda QUEM está na sala; este Map guarda POR
// ONDE falar com cada um.
//
// Na fase 4, quando o sistema rodar em mais de uma instância,
// cada uma terá o seu Map com os seus conectados, e o pub/sub do
// Redis vai costurar os dois.
// ------------------------------------------------------------
const conexoesPorSala = new Map(); // codigo -> Set<WebSocket>

function registrar(codigo, socket) {
  if (!conexoesPorSala.has(codigo)) conexoesPorSala.set(codigo, new Set());
  conexoesPorSala.get(codigo).add(socket);
}

function remover(codigo, socket) {
  const conexoes = conexoesPorSala.get(codigo);
  if (!conexoes) return;

  conexoes.delete(socket);

  // Sala sem ninguém conectado não precisa de entrada no Map.
  // Sem esta limpeza, o Map cresceria para sempre.
  if (conexoes.size === 0) conexoesPorSala.delete(codigo);
}

function enviar(socket, mensagem) {
  // readyState 1 = OPEN. Mandar para um socket que está fechando
  // lança exceção, e isso acontece o tempo todo: a pessoa fecha a
  // aba no exato momento em que o broadcast sai.
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(mensagem));
  }
}

/** Manda a mesma mensagem para todo mundo da sala. */
export function transmitir(codigo, mensagem) {
  const conexoes = conexoesPorSala.get(codigo);
  if (!conexoes) return;

  for (const socket of conexoes) enviar(socket, mensagem);
}

async function transmitirJogadores(codigo) {
  transmitir(codigo, {
    tipo: "jogadores",
    jogadores: await salas.listarJogadores(codigo)
  });
}

function recusar(socket, codigo, mensagem) {
  enviar(socket, { tipo: "erro", codigo, mensagem });

  // 1008 = "policy violation", o código padrão para "sua
  // requisição é válida mas eu não vou atender". Fechar com um
  // código explicando o motivo é a diferença entre o cliente
  // conseguir mostrar uma mensagem útil e só ver "desconectado".
  socket.close(1008, codigo);
}

// ------------------------------------------------------------
// Validação de apelido
// ------------------------------------------------------------
function validarApelido(apelido) {
  if (typeof apelido !== "string") return "Informe um apelido";

  const limpo = apelido.trim();

  if (limpo.length < 2) return "O apelido precisa de pelo menos 2 letras";
  if (limpo.length > 20) return "O apelido é longo demais";

  return null;
}

// ------------------------------------------------------------
// O servidor
// ------------------------------------------------------------

/**
 * Pendura o WebSocket num servidor HTTP já existente.
 *
 * Usamos `noServer: true` e tratamos o "upgrade" na mão porque é
 * aí — antes de aceitar a conexão — que dá para recusar quem não
 * deveria entrar. Depois do upgrade aceito, recusar já custou uma
 * conexão aberta.
 */
export function pendurarWebSocket(servidorHttp) {
  const wss = new WebSocketServer({ noServer: true });

  servidorHttp.on("upgrade", async (requisicao, socket, cabeca) => {
    const url = new URL(requisicao.url, "http://localhost");

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    // O navegador NÃO aplica a política de mesma origem a
    // WebSocket — qualquer site consegue abrir uma conexão com a
    // sua API. Como o cookie de sessão vai junto no handshake,
    // sem esta checagem um site qualquer poderia abrir uma
    // conexão autenticada como você. Conferir a origem é a defesa.
    const origem = requisicao.headers.origin;
    const permitida = process.env.ORIGEM_PAINEL || "http://localhost:5175";

    // Sem cabeçalho Origin = não é navegador (script, teste,
    // app nativo). Esses não carregam cookie de ninguém, então
    // não há sessão para roubar.
    if (origem && origem !== permitida) {
      socket.destroy();
      return;
    }

    // Cookies vêm no handshake como em qualquer requisição HTTP.
    // É assim que o apresentador se identifica sem precisar
    // mandar o token numa mensagem.
    const usuarioId = await lerUsuarioDoCookie(requisicao.headers.cookie);

    wss.handleUpgrade(requisicao, socket, cabeca, (ws) => {
      ws.usuarioId = usuarioId; // null para quem não está logado
      wss.emit("connection", ws, requisicao);
    });
  });

  wss.on("connection", (socket) => {
    socket.estaVivo = true;
    socket.sala = null;
    socket.jogadorId = null;
    socket.papel = null;

    // pong é a resposta automática do navegador ao nosso ping.
    // Não precisamos fazer nada além de anotar que ele respondeu.
    socket.on("pong", () => {
      socket.estaVivo = true;
    });

    socket.on("message", async (dados) => {
      let mensagem;

      try {
        mensagem = JSON.parse(dados);
      } catch {
        // Diferente de HTTP, aqui não existe "400 Bad Request"
        // automático: tudo que chega é um punhado de bytes que
        // nós mesmos precisamos interpretar.
        return recusar(socket, "json-invalido", "Mensagem malformada");
      }

      try {
        await tratar(socket, mensagem);
      } catch (erro) {
        console.error("Erro tratando mensagem:", erro);
        enviar(socket, { tipo: "erro", codigo: "interno", mensagem: "Erro no servidor" });
      }
    });

    socket.on("close", async () => {
      if (!socket.sala) return;

      remover(socket.sala, socket);

      if (socket.papel === "jogador") {
        await salas.sair(socket.sala, socket.jogadorId);
        await transmitirJogadores(socket.sala);
      }

      if (socket.papel === "apresentador") {
        // Por ora, o apresentador sair encerra a sala — sem ele
        // não há quem conduza a partida. Na fase 4 isso vira uma
        // janela de tolerância, para ele poder recarregar a
        // página sem derrubar 40 pessoas.
        transmitir(socket.sala, { tipo: "sala-encerrada" });
        await salas.encerrar(socket.sala);
      }
    });

    socket.on("error", (erro) => {
      console.error("Erro no socket:", erro.message);
    });
  });

  // ------------------------------------------------------------
  // Batimento cardíaco
  //
  // Uma conexão TCP pode morrer sem avisar ninguém: o celular
  // entra no elevador, o wi-fi cai, o notebook dorme. Para o
  // servidor, o socket continua "aberto" — e o jogador fica
  // eternamente na lista de presentes de uma sala que ele já
  // abandonou.
  //
  // A cada 30 segundos mandamos um ping. Quem não respondeu o
  // ping anterior é dado como morto e desconectado.
  // ------------------------------------------------------------
  const batimento = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.estaVivo === false) {
        socket.terminate(); // terminate, não close: não há ninguém do outro lado para negociar
        continue;
      }

      socket.estaVivo = false;
      socket.ping();
    }
  }, 30_000);

  // Sem isto, o intervalo segura o processo vivo para sempre e os
  // testes travam depois de passar.
  wss.on("close", () => clearInterval(batimento));

  return wss;
}

/** Lê o cookie de sessão do handshake. Devolve o id ou null. */
async function lerUsuarioDoCookie(cabecalhoCookie) {
  if (!cabecalhoCookie) return null;

  // O cabeçalho vem como "a=1; b=2; quiz_sessao=xyz". Aqui não
  // temos o cookie-parser do Express, então separamos na mão.
  for (const parte of cabecalhoCookie.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === NOME_COOKIE) {
      return await lerSessao(resto.join("="));
    }
  }

  return null;
}

// ------------------------------------------------------------
// As mensagens
// ------------------------------------------------------------
async function tratar(socket, mensagem) {
  switch (mensagem?.tipo) {
    case "apresentar":
      return apresentar(socket, mensagem);
    case "entrar":
      return entrar(socket, mensagem);
    default:
      return recusar(socket, "tipo-desconhecido", "Não entendi essa mensagem");
  }
}

/** O dono do quiz assume a sala. */
async function apresentar(socket, { codigo: bruto }) {
  if (socket.sala) return recusar(socket, "ja-entrou", "Esta conexão já está numa sala");

  const codigo = normalizarCodigo(bruto);
  if (!codigo) return recusar(socket, "codigo-invalido", "Código inválido");

  const sala = await salas.ler(codigo);
  if (!sala) return recusar(socket, "sala-inexistente", "Sala não encontrada");

  // A sessão veio do cookie no handshake. Sem login, ou sendo
  // outro usuário, não assume a sala de ninguém.
  if (!socket.usuarioId || socket.usuarioId !== sala.apresentadorId) {
    return recusar(socket, "nao-autorizado", "Esta sala não é sua");
  }

  socket.sala = codigo;
  socket.papel = "apresentador";
  registrar(codigo, socket);

  enviar(socket, {
    tipo: "bem-vindo",
    papel: "apresentador",
    sala: { codigo, titulo: sala.titulo, fase: sala.fase },
    jogadores: await salas.listarJogadores(codigo)
  });
}

/** Um jogador entra com código e apelido. Sem conta. */
async function entrar(socket, { codigo: bruto, apelido }) {
  if (socket.sala) return recusar(socket, "ja-entrou", "Esta conexão já está numa sala");

  const codigo = normalizarCodigo(bruto);
  if (!codigo) return recusar(socket, "codigo-invalido", "Código inválido");

  const erroApelido = validarApelido(apelido);
  if (erroApelido) return recusar(socket, "apelido-invalido", erroApelido);

  const jogadorId = randomUUID();
  const limpo = apelido.trim();

  const resultado = await salas.entrar(codigo, { jogadorId, apelido: limpo });

  if (!resultado.ok) {
    const mensagens = {
      "sala-inexistente": "Sala não encontrada",
      "sala-cheia": "Esta sala está cheia",
      "apelido-em-uso": "Já tem alguém com esse apelido na sala"
    };
    return recusar(socket, resultado.motivo, mensagens[resultado.motivo]);
  }

  socket.sala = codigo;
  socket.papel = "jogador";
  socket.jogadorId = jogadorId;
  registrar(codigo, socket);

  const sala = await salas.ler(codigo);

  enviar(socket, {
    tipo: "bem-vindo",
    papel: "jogador",
    sala: { codigo, titulo: sala.titulo, fase: sala.fase },
    voce: { id: jogadorId, apelido: limpo }
  });

  // Todo mundo (inclusive quem acabou de entrar) recebe a lista
  // nova. Mandar a lista inteira, e não "fulano entrou", é o que
  // garante que a tela de todos converge para o mesmo estado —
  // quem perdeu uma mensagem no meio se corrige sozinho.
  await transmitirJogadores(codigo);
}
