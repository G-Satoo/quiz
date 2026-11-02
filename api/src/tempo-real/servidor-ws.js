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
//   { tipo: "entrar", codigo, apelido, jogadorId? }   o jogador entra
//   { tipo: "comecar" }                       o dono inicia a partida
//   { tipo: "responder", alternativaId }      o jogador responde
//   { tipo: "proxima" }                       o dono avança
//
// Do servidor:
//
//   { tipo: "bem-vindo", papel, sala, voce }  entrou com sucesso
//   { tipo: "jogadores", jogadores: [...] }   a lista mudou
//   { tipo: "pergunta", enunciado, ... }      uma pergunta abriu
//   { tipo: "respondeu", quantos }            alguém respondeu (só o dono)
//   { tipo: "resultado", distribuicao, ... }  a pergunta fechou
//   { tipo: "fim", placar }                   acabou a partida
//   { tipo: "sala-encerrada" }                o apresentador desistiu
//   { tipo: "erro", codigo, mensagem }        deu errado
// ============================================================

import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

import { lerSessao, NOME_COOKIE } from "../servicos/sessao.js";
import { normalizarCodigo } from "../util/codigo.js";
import * as salas from "./salas.js";
import * as partida from "./partida.js";
import * as transmissao from "./transmissao.js";

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

/**
 * Manda a mesma mensagem para todo mundo da sala.
 *
 * Não entrega direto: publica no Redis. Todas as instâncias
 * recebem e cada uma entrega aos sockets que ela atende — é o
 * que faz a sala funcionar com mais de um servidor no ar.
 * Quem publica também recebe de volta, então existe um caminho
 * só, igual para todos.
 */
export function transmitir(codigo, mensagem) {
  transmissao.publicar(codigo, mensagem);
}

/** Manda só para um jogador, esteja ele em qual instância estiver. */
function enviarParaJogador(codigo, jogadorId, mensagem) {
  transmissao.publicar(codigo, mensagem, jogadorId);
}

/**
 * Entrega aos sockets DESTE processo. Chamada pela assinatura do
 * Redis, em todas as instâncias, para cada mensagem publicada.
 */
function entregarLocal(codigo, mensagem, alvo) {
  const conexoes = conexoesPorSala.get(codigo);
  if (!conexoes) return;

  for (const socket of conexoes) {
    // Mensagem endereçada: só quem tem aquele socket entrega.
    if (alvo && socket.jogadorId !== alvo) continue;
    enviar(socket, mensagem);
  }
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

  // Liga a assinatura do Redis. A partir daqui, tudo que qualquer
  // instância publicar chega aqui e é entregue aos sockets locais.
  transmissao.iniciar(entregarLocal).catch((erro) => {
    console.error("Não foi possível assinar a transmissão:", erro.message);
  });

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
    //
    // Sem cabeçalho Origin = não é navegador (script, teste, app
    // nativo). Esses não carregam cookie de ninguém, então não há
    // sessão para roubar.
    if (requisicao.headers.origin && !origemPermitida(requisicao)) {
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
        // Cair não é sair: durante a partida a pessoa continua na
        // sala, só marcada como desconectada. É o que permite ela
        // voltar com a pontuação intacta.
        await salas.marcarOffline(socket.sala, socket.jogadorId);
        await transmitirJogadores(socket.sala);
      }

      if (socket.papel === "apresentador") {
        // O apresentador cair NÃO encerra a sala na hora.
        //
        // Antes encerrava, e isso tornava o sistema frágil de um
        // jeito difícil de diagnosticar: qualquer piscada de rede,
        // um restart do servidor em desenvolvimento ou o celular
        // trocando de aba derrubava 40 pessoas — ou, pior, deixava
        // a tela dele congelada sem aviso enquanto a sala seguia.
        //
        // Agora ele tem uma janela para voltar. Quem reaparece
        // dentro dela reassume a sala e nada se perde.
        await salas.marcarApresentadorAusente(socket.sala);
        agendarEncerramento(socket.sala);
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
  wss.on("close", () => {
    clearInterval(batimento);
    transmissao.fechar().catch(() => {});
  });

  return wss;
}

/**
 * A conexão veio de um lugar que podemos confiar?
 *
 * Duas origens valem:
 *
 *   1. A MESMA do servidor. As telas são servidas pela própria
 *      API, então o navegador abre o WebSocket para a casa dele
 *      mesmo — e isso vale tanto em localhost:3003 quanto em
 *      192.168.0.10:3003, que é como o celular vai acessar na
 *      rede local. Comparar com um endereço fixo quebraria esse
 *      caso.
 *
 *   2. A do painel React (ORIGEM_PAINEL), que na fase 5 roda numa
 *      porta separada durante o desenvolvimento.
 */
function origemPermitida(requisicao) {
  const origem = requisicao.headers.origin;

  // O cabeçalho Host diz por qual endereço ESTE servidor foi
  // alcançado. Se a origem bate com ele, é a própria página.
  const host = requisicao.headers.host;
  if (host && (origem === `http://${host}` || origem === `https://${host}`)) {
    return true;
  }

  return origem === (process.env.ORIGEM_PAINEL || "http://localhost:5175");
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
    case "comecar":
      return comecar(socket);
    case "responder":
      return responder(socket, mensagem);
    case "proxima":
      return proxima(socket);
    case "avaliar":
      return avaliar(socket, mensagem);
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

  // Ele voltou (ou chegou pela primeira vez): cancela o
  // encerramento que estava agendado e limpa a marca de ausência.
  cancelarEncerramento(codigo);
  await salas.marcarApresentadorPresente(codigo);

  enviar(socket, {
    tipo: "bem-vindo",
    papel: "apresentador",
    sala: { codigo, titulo: sala.titulo, fase: sala.fase },
    jogadores: await salas.listarJogadores(codigo),
    placar: await salas.lerPlacar(codigo)
  });
}

/**
 * Um jogador entra com código e apelido. Sem conta.
 *
 * O `jogadorId` opcional é a retomada: quando a conexão cai e o
 * navegador reconecta sozinho, ele manda de volta o id que
 * recebeu antes. Sem isso, a reconexão seria recusada por
 * "apelido em uso" — pelo próprio jogador que acabou de cair.
 */
async function entrar(socket, { codigo: bruto, apelido, jogadorId: anterior }) {
  if (socket.sala) return recusar(socket, "ja-entrou", "Esta conexão já está numa sala");

  const codigo = normalizarCodigo(bruto);
  if (!codigo) return recusar(socket, "codigo-invalido", "Código inválido");

  const erroApelido = validarApelido(apelido);
  if (erroApelido) return recusar(socket, "apelido-invalido", erroApelido);

  // Reaproveita o id anterior só se ele for mesmo daquele apelido
  // naquela sala — aceitar qualquer id que o cliente mandasse
  // deixaria alguém assumir a pontuação de outro jogador.
  const jaEstava = anterior
    ? (await salas.listarJogadores(codigo)).find(
        (j) => j.id === anterior && j.apelido.toLowerCase() === apelido.trim().toLowerCase()
      )
    : null;

  const jogadorId = jaEstava ? anterior : randomUUID();
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

  // Entrou logado? Os pontos desta partida passam a contar no
  // ranking do dia. A identidade vem do cookie lido no handshake,
  // nunca de algo que o cliente mande na mensagem — senão bastaria
  // dizer "sou o usuário 7" para pontuar no nome dele.
  if (socket.usuarioId) await salas.vincularConta(codigo, jogadorId, socket.usuarioId);

  const sala = await salas.ler(codigo);

  enviar(socket, {
    tipo: "bem-vindo",
    papel: "jogador",
    sala: { codigo, titulo: sala.titulo, fase: sala.fase },
    voce: { id: jogadorId, apelido: limpo, retomou: Boolean(jaEstava) }
  });

  // Todo mundo (inclusive quem acabou de entrar) recebe a lista
  // nova. Mandar a lista inteira, e não "fulano entrou", é o que
  // garante que a tela de todos converge para o mesmo estado —
  // quem perdeu uma mensagem no meio se corrige sozinho.
  await transmitirJogadores(codigo);
}

// ============================================================
// Tolerância para o apresentador voltar
//
// Quem conduz a partida pode recarregar a página, trocar de rede
// ou sofrer um restart do servidor em desenvolvimento. Nada disso
// deveria derrubar a sala inteira.
// ============================================================

const TOLERANCIA_APRESENTADOR_MS = 90_000;

const encerramentosAgendados = new Map(); // codigo -> timeout

function agendarEncerramento(codigo) {
  cancelarEncerramento(codigo);

  // unref(): este temporizador não deve segurar o processo vivo.
  // Sem ele, a suíte de testes passa e depois fica 90 segundos
  // pendurada esperando um encerramento que não interessa a
  // ninguém — e no CI isso vira um job travado.
  const agendado = setTimeout(async () => {
      encerramentosAgendados.delete(codigo);

      // Confere se ele realmente não voltou. Entre o agendamento e
      // agora, uma reconexão pode ter acontecido — e encerrar a
      // sala por causa de um temporizador velho seria o bug que
      // estamos justamente consertando.
      const sala = await salas.ler(codigo);
      if (!sala || !sala.apresentadorAusenteDesde) return;

      transmitir(codigo, { tipo: "sala-encerrada" });
      partida.esquecerCronometro(codigo);
      await salas.encerrar(codigo);
  }, TOLERANCIA_APRESENTADOR_MS);

  agendado.unref();
  encerramentosAgendados.set(codigo, agendado);
}

function cancelarEncerramento(codigo) {
  const agendado = encerramentosAgendados.get(codigo);
  if (agendado) {
    clearTimeout(agendado);
    encerramentosAgendados.delete(codigo);
  }
}

// ============================================================
// A partida
// ============================================================

/** Só o apresentador conduz. */
function exigirApresentador(socket) {
  if (socket.papel !== "apresentador" || !socket.sala) {
    recusar(socket, "nao-autorizado", "Só o apresentador pode fazer isso");
    return false;
  }
  return true;
}

/**
 * Fecha a pergunta que está no ar e conta o resultado.
 *
 * Cada um recebe o que lhe diz respeito: a sala inteira vê a
 * alternativa certa, como os votos se dividiram e o placar; cada
 * jogador recebe, só para si, se acertou e quanto ganhou.
 */
async function encerrarPergunta(codigo) {
  const resultado = await partida.fecharPergunta(codigo);
  if (!resultado) return;

  // O resultado PESSOAL vai primeiro, e a ordem importa: a tela
  // do jogador desenha o veredito ("acertou!") quando recebe o
  // resultado da sala, e precisa já saber o que aconteceu com
  // ELE. Na ordem inversa, a tela mostrava "você não respondeu"
  // para quem tinha acabado de pontuar.
  //
  // A tela também se corrige se a mensagem chegar depois — ordem
  // de rede não é promessa —, mas mandar na ordem certa evita o
  // pisca-pisca.
  for (const [jogadorId, meu] of resultado.porJogador) {
    enviarParaJogador(codigo, jogadorId, { tipo: "sua-resposta", ...meu });
  }

  transmitir(codigo, {
    tipo: "resultado",
    indice: resultado.indice,
    ultima: resultado.ultima,
    alternativaCorretaId: resultado.alternativaCorretaId,
    distribuicao: resultado.distribuicao,
    placar: resultado.placar
  });
}

/** O apresentador inicia a partida. */
async function comecar(socket) {
  if (!exigirApresentador(socket)) return;

  const codigo = socket.sala;
  const sala = await salas.ler(codigo);

  if (!sala) return recusar(socket, "sala-inexistente", "Sala não encontrada");

  if (sala.fase !== "aguardando") {
    return enviar(socket, {
      tipo: "erro",
      codigo: "ja-comecou",
      mensagem: "A partida já começou"
    });
  }

  const jogadores = await salas.listarJogadores(codigo);
  if (jogadores.length === 0) {
    return enviar(socket, {
      tipo: "erro",
      codigo: "sala-vazia",
      mensagem: "Espere alguém entrar antes de começar"
    });
  }

  // As perguntas são copiadas para o Redis AGORA, uma vez. Daqui
  // para a frente o Postgres sai do caminho do jogo — e editar o
  // quiz no meio da partida deixa de afetar quem está jogando.
  const perguntas = await partida.carregarPerguntas(sala.quizId);
  await salas.guardarPerguntas(codigo, perguntas);

  await abrirPerguntaDaSala(codigo, 0);
}

async function abrirPerguntaDaSala(codigo, indice) {
  const aberta = await partida.abrirPergunta(codigo, indice, {
    transmitir: (mensagem) => transmitir(codigo, mensagem),
    aoFechar: () => encerrarPergunta(codigo).catch((erro) => console.error(erro))
  });

  if (!aberta) {
    // Não há pergunta neste índice: a partida acabou.
    await salas.mudarFase(codigo, "encerrada");
    const placar = await salas.lerPlacar(codigo);

    // Grava ANTES de anunciar o fim: a tela final oferece as
    // estrelas de avaliação, e a avaliação exige o resultado
    // gravado. Na ordem inversa, quem clicasse rápido receberia
    // "a partida não terminou" de uma partida que terminou.
    //
    // Se o banco falhar, a partida termina mesmo assim. Perder o
    // ranking de uma partida é ruim; travar 30 pessoas numa tela
    // sem fim é pior.
    try {
      const sala = await salas.ler(codigo);
      const contas = await salas.lerContas(codigo);
      await partida.gravarResultados(codigo, sala.quizId, placar, contas);
    } catch (erro) {
      console.error("Não consegui gravar o resultado da partida", codigo, erro);
    }

    transmitir(codigo, { tipo: "fim", placar });
  }
}

/** Um jogador responde. */
async function responder(socket, { alternativaId }) {
  if (socket.papel !== "jogador" || !socket.sala) {
    return recusar(socket, "nao-autorizado", "Entre na sala primeiro");
  }

  const resultado = await partida.responder(socket.sala, socket.jogadorId, alternativaId);

  if (!resultado.aceita) {
    const mensagens = {
      "nao-ha-pergunta-aberta": "Não há pergunta aberta agora",
      "alternativa-invalida": "Alternativa inválida",
      "tempo-esgotado": "O tempo acabou",
      "ja-respondeu": "Você já respondeu esta pergunta"
    };

    // Erro de regra do jogo não derruba a conexão: a pessoa segue
    // na partida, só não valeu aquela tentativa.
    return enviar(socket, {
      tipo: "erro",
      codigo: resultado.motivo,
      mensagem: mensagens[resultado.motivo] ?? "Resposta recusada"
    });
  }

  // Confirmação de recebimento — e NÃO se acertou. Saber na hora
  // permitiria avisar o colega do lado.
  enviar(socket, { tipo: "resposta-recebida" });

  const quantos = await partida.contarRespostas(socket.sala);
  const total = (await salas.listarJogadores(socket.sala)).length;

  // Só o apresentador usa o contador, mas a mensagem vai para a
  // sala inteira: ela precisa atravessar as instâncias, e filtrar
  // por papel exigiria um endereçamento que não vale a pena para
  // uma informação que não é segredo. As telas dos jogadores
  // simplesmente ignoram este tipo.
  transmitir(socket.sala, { tipo: "respondeu", quantos, total });

  // Todo mundo já respondeu: não faz sentido esperar o cronômetro.
  if (quantos >= total) await encerrarPergunta(socket.sala);
}

/** O apresentador avança para a próxima pergunta. */
async function proxima(socket) {
  if (!exigirApresentador(socket)) return;

  const codigo = socket.sala;
  const { fase, indice } = await salas.lerPerguntaAberta(codigo);

  // Avançar com a pergunta ainda aberta encerra ela antes —
  // acontece quando o apresentador vê que todo mundo já respondeu
  // e não quer esperar o tempo acabar.
  if (fase === "pergunta") {
    await encerrarPergunta(codigo);
    return;
  }

  await abrirPerguntaDaSala(codigo, indice + 1);
}

/** Um jogador dá nota ao quiz, depois do fim da partida. */
async function avaliar(socket, { nota }) {
  if (socket.papel !== "jogador" || !socket.sala) {
    return recusar(socket, "nao-autorizado", "Entre na sala primeiro");
  }

  const resultado = await partida.avaliar(socket.sala, socket.jogadorId, nota);

  if (!resultado.aceita) {
    const mensagens = {
      "nota-invalida": "A nota vai de 1 a 5",
      "partida-nao-terminou": "Dá para avaliar quando a partida terminar"
    };

    // Como as recusas de resposta: não derruba a conexão.
    return enviar(socket, {
      tipo: "erro",
      codigo: resultado.motivo,
      mensagem: mensagens[resultado.motivo] ?? "Avaliação recusada"
    });
  }

  enviar(socket, { tipo: "avaliacao-recebida", nota: resultado.nota });
}
