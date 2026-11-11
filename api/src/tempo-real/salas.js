// ============================================================
// Estado das salas, no Redis
//
// Aqui mora o que a partida sabe sobre si: qual quiz, quem é o
// apresentador, em que fase está e quem entrou.
//
// Por que no Redis e não em memória do processo:
//
//   - Reiniciar a API no meio de uma partida não pode zerar o
//     placar de 40 pessoas. Com `--watch` ligado, isso aconteceria
//     toda vez que você salvasse um arquivo.
//   - Quando o sistema rodar em mais de uma instância, os
//     jogadores da mesma sala podem cair em servidores
//     diferentes. Memória de processo não é compartilhada.
//
// Por que no Redis e não no Postgres: esse estado muda a cada
// segundo e some quando o jogo acaba. O que merece disco é o
// resultado final, e isso é a fase 5.
//
// Todas as chaves têm prazo de validade. Sala abandonada — e vai
// haver muita, porque ninguém "fecha" uma sala, as pessoas só
// fecham a aba — desaparece sozinha.
// ============================================================

import { redis } from "../redis.js";

// 6 horas. Generoso de propósito: é melhor uma sala esquecida
// ocupar memória por uma tarde do que uma apresentação longa
// morrer no meio porque o prazo era curto.
export const VALIDADE_SEGUNDOS = 6 * 60 * 60;

const chaveSala = (codigo) => `sala:${codigo}`;
const chaveJogadores = (codigo) => `sala:${codigo}:jogadores`;

// Quem está com a conexão viva AGORA. Separado da lista de
// jogadores de propósito: cair não é sair.
//
// Se a queda apagasse a pessoa da sala, ela perderia a pontuação
// ao reconectar — e, pior, reconectar seria recusado por
// "apelido em uso" pelo próprio fantasma dela.
const chaveOnline = (codigo) => `sala:${codigo}:online`;

// Quantas pessoas cabem numa sala. Limite existe para o broadcast
// não virar um problema: cada resposta recebida gera uma mensagem
// para todo mundo, então o custo cresce com o quadrado do número
// de jogadores.
export const MAX_JOGADORES = 200;

/**
 * Cria a sala. O código já vem pronto de quem chamou, porque é
 * ele que trata a colisão (ver rotas/salas.js).
 *
 * Devolve false se o código já estiver em uso.
 */
export async function criar(codigo, { quizId, apresentadorId, titulo, quantidade = null, segundos = null }) {
  // HSETNX grava só se a chave ainda não tiver aquele campo, numa
  // operação atômica. É o mesmo raciocínio do UNIQUE do banco:
  // duas requisições simultâneas com o mesmo código sorteado não
  // podem criar duas salas — uma das duas precisa perder.
  const criou = await redis.hsetnx(chaveSala(codigo), "quiz_id", String(quizId));

  if (criou === 0) return false;

  await redis
    .multi()
    .hset(chaveSala(codigo), {
      apresentador_id: String(apresentadorId),
      titulo,
      fase: "aguardando",
      criada_em: new Date().toISOString(),
      // Como o apresentador quis a partida: quantas perguntas e
      // quantos segundos cada. Vazio é "todas, cada uma com o seu
      // tempo" — o jeito de antes.
      quantidade: quantidade === null ? "" : String(quantidade),
      segundos: segundos === null ? "" : String(segundos)
    })
    .expire(chaveSala(codigo), VALIDADE_SEGUNDOS)
    .exec();

  return true;
}

/** Devolve os dados da sala, ou null se ela não existe (ou expirou). */
export async function ler(codigo) {
  const dados = await redis.hgetall(chaveSala(codigo));

  // hgetall de chave inexistente devolve um objeto VAZIO, não
  // null. Confundir os dois é um erro clássico com Redis.
  if (!dados || Object.keys(dados).length === 0) return null;

  return {
    codigo,
    quizId: Number(dados.quiz_id),
    apresentadorId: Number(dados.apresentador_id),
    titulo: dados.titulo,
    fase: dados.fase,
    criadaEm: dados.criada_em,
    quantidade: dados.quantidade ? Number(dados.quantidade) : null,
    segundos: dados.segundos ? Number(dados.segundos) : null,
    apresentadorAusenteDesde: dados.apresentador_ausente_desde ?? null
  };
}

export async function existe(codigo) {
  return (await redis.exists(chaveSala(codigo))) === 1;
}

/**
 * Entra na sala.
 *
 * Devolve { ok: true } ou { ok: false, motivo }.
 *
 * O apelido é a identidade do jogador na partida, então precisa
 * ser único dentro dela — duas "Ana" no placar não dizem a
 * ninguém quem ganhou.
 */
export async function entrar(codigo, { jogadorId, apelido }) {
  if (!(await existe(codigo))) return { ok: false, motivo: "sala-inexistente" };

  const jogadores = await redis.hgetall(chaveJogadores(codigo));

  if (Object.keys(jogadores).length >= MAX_JOGADORES) {
    return { ok: false, motivo: "sala-cheia" };
  }

  const repetido = Object.entries(jogadores).some(
    ([id, nome]) => id !== jogadorId && nome.toLowerCase() === apelido.toLowerCase()
  );

  if (repetido) return { ok: false, motivo: "apelido-em-uso" };

  await redis
    .multi()
    .hset(chaveJogadores(codigo), jogadorId, apelido)
    .expire(chaveJogadores(codigo), VALIDADE_SEGUNDOS)
    .hset(chaveOnline(codigo), jogadorId, "1")
    .expire(chaveOnline(codigo), VALIDADE_SEGUNDOS)
    .exec();

  return { ok: true };
}

/**
 * A conexão caiu, mas a pessoa continua na partida.
 *
 * Na sala de espera, quem fecha a aba some da lista — ninguém
 * quer um saguão cheio de gente que desistiu. Durante o jogo,
 * fica: a pontuação é dela, e o wi-fi pode voltar.
 */
export async function marcarOffline(codigo, jogadorId) {
  await redis.hdel(chaveOnline(codigo), jogadorId);

  const fase = await redis.hget(chaveSala(codigo), "fase");
  if (fase === "aguardando") await redis.hdel(chaveJogadores(codigo), jogadorId);
}

export async function sair(codigo, jogadorId) {
  await redis.hdel(chaveJogadores(codigo), jogadorId);
  await redis.hdel(chaveOnline(codigo), jogadorId);
}

/** Lista de jogadores, em ordem alfabética para a tela não dançar. */
export async function listarJogadores(codigo) {
  const [jogadores, online] = await Promise.all([
    redis.hgetall(chaveJogadores(codigo)),
    redis.hgetall(chaveOnline(codigo))
  ]);

  return Object.entries(jogadores)
    .map(([id, apelido]) => ({ id, apelido, online: online[id] === "1" }))
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
}

export async function mudarFase(codigo, fase) {
  await redis.hset(chaveSala(codigo), "fase", fase);
}

/** Apaga a sala e tudo dela. Usado quando o apresentador encerra. */
export async function encerrar(codigo) {
  await redis.del(
    chaveSala(codigo),
    chaveJogadores(codigo),
    chaveOnline(codigo),
    chaveContas(codigo)
  );
}

// ============================================================
// Estado da partida em andamento
//
// Tudo aqui vive no Redis pelo mesmo motivo do resto: a partida
// precisa sobreviver a um restart do servidor. O que NÃO
// sobrevive é o cronômetro (um setTimeout no processo) — essa
// limitação está anotada em partida.js.
// ============================================================

const chavePerguntas = (codigo) => `sala:${codigo}:perguntas`;
const chaveRespostas = (codigo, indice) => `sala:${codigo}:respostas:${indice}`;
const chavePontos = (codigo) => `sala:${codigo}:pontos`;
const chaveContas = (codigo) => `sala:${codigo}:contas`;
const chaveSequencias = (codigo) => `sala:${codigo}:sequencias`;

/**
 * Anota que este jogador da sala é esta conta.
 *
 * Fica separado da lista de jogadores de propósito: a lista vai
 * para o telão e para todo mundo na sala, e o id da conta de
 * alguém não é da conta dos outros. Este hash só é lido no fim,
 * para gravar o resultado.
 */
export async function vincularConta(codigo, jogadorId, usuarioId) {
  await redis.hset(chaveContas(codigo), jogadorId, String(usuarioId));
  await redis.expire(chaveContas(codigo), VALIDADE_SEGUNDOS);
}

/** jogadorId -> usuarioId, só de quem entrou logado. */
export async function lerContas(codigo) {
  const bruto = await redis.hgetall(chaveContas(codigo));
  return Object.fromEntries(Object.entries(bruto).map(([j, u]) => [j, Number(u)]));
}

/**
 * Guarda as perguntas do quiz na sala.
 *
 * Elas são copiadas do Postgres uma vez, no começo da partida, e
 * não lidas de novo a cada pergunta. Dois motivos: o banco sai do
 * caminho crítico do jogo, e editar o quiz no meio de uma partida
 * deixa de bagunçar quem já está jogando.
 */
export async function guardarPerguntas(codigo, perguntas) {
  await redis
    .multi()
    .set(chavePerguntas(codigo), JSON.stringify(perguntas))
    .expire(chavePerguntas(codigo), VALIDADE_SEGUNDOS)
    .exec();
}

export async function lerPerguntas(codigo) {
  const bruto = await redis.get(chavePerguntas(codigo));
  return bruto ? JSON.parse(bruto) : null;
}

/** Marca qual pergunta está no ar e quando ela começou. */
export async function abrirPergunta(codigo, indice, inicioMs) {
  await redis.hset(chaveSala(codigo), {
    fase: "pergunta",
    indice: String(indice),
    inicio_ms: String(inicioMs)
  });
}

export async function lerPerguntaAberta(codigo) {
  const dados = await redis.hmget(chaveSala(codigo), "fase", "indice", "inicio_ms");

  return {
    fase: dados[0],
    indice: dados[1] === null ? null : Number(dados[1]),
    inicioMs: dados[2] === null ? null : Number(dados[2])
  };
}

/**
 * Registra a resposta de um jogador.
 *
 * HSETNX: grava só se aquele jogador ainda não tiver respondido
 * esta pergunta. É o que impede alguém mandar dez respostas e
 * ficar com a melhor — a primeira é a que vale, e a decisão é
 * atômica no Redis, não um "if" no JavaScript que duas mensagens
 * simultâneas atravessariam.
 */
export async function registrarResposta(codigo, indice, jogadorId, resposta) {
  const gravou = await redis.hsetnx(
    chaveRespostas(codigo, indice),
    jogadorId,
    JSON.stringify(resposta)
  );

  await redis.expire(chaveRespostas(codigo, indice), VALIDADE_SEGUNDOS);

  return gravou === 1;
}

/**
 * Reserva o direito de fechar a pergunta. Só o primeiro ganha.
 *
 * Fechar uma pergunta soma os pontos, e ela pode ser fechada por
 * três caminhos ao mesmo tempo: o cronômetro, o apresentador
 * clicando em "próxima" e a última resposta chegando. Com duas
 * pessoas respondendo no mesmo instante, as DUAS viam "todo mundo
 * respondeu" e as duas fechavam — e quem acertou ganhava os
 * pontos em dobro.
 *
 * SET NX é o mesmo raciocínio do HSETNX das respostas: a decisão
 * de quem chegou primeiro é atômica no Redis. Um "if fase ===
 * 'pergunta'" no JavaScript seria atravessado pelas duas
 * mensagens, que leriam a fase antes de qualquer uma mudá-la.
 */
export async function reservarFechamento(codigo, indice) {
  const reservou = await redis.set(
    `sala:${codigo}:fechou:${indice}`,
    "1",
    "EX",
    VALIDADE_SEGUNDOS,
    "NX"
  );
  return reservou === "OK";
}

export async function lerRespostas(codigo, indice) {
  const bruto = await redis.hgetall(chaveRespostas(codigo, indice));

  return Object.entries(bruto).map(([jogadorId, valor]) => ({
    jogadorId,
    ...JSON.parse(valor)
  }));
}

/** Quantos acertos seguidos cada jogador tem: { jogadorId: n }. */
export async function lerSequencias(codigo) {
  const bruto = await redis.hgetall(chaveSequencias(codigo));
  return Object.fromEntries(Object.entries(bruto).map(([id, n]) => [id, Number(n)]));
}

/**
 * Troca as sequências pelas novas. Quem não está no objeto zerou
 * (errou ou não respondeu) — por isso apaga e regrava, em vez de
 * incrementar um por um.
 */
export async function gravarSequencias(codigo, sequencias) {
  const lote = redis.multi().del(chaveSequencias(codigo));
  if (Object.keys(sequencias).length > 0) {
    lote.hset(chaveSequencias(codigo), sequencias).expire(chaveSequencias(codigo), VALIDADE_SEGUNDOS);
  }
  await lote.exec();
}

/** Soma pontos ao jogador e devolve o total novo. */
export async function somarPontos(codigo, jogadorId, pontos) {
  const total = await redis.hincrby(chavePontos(codigo), jogadorId, pontos);
  await redis.expire(chavePontos(codigo), VALIDADE_SEGUNDOS);
  return total;
}

/**
 * O placar, do maior para o menor.
 *
 * Junta os pontos com os apelidos: quem só tem ponto é um id, e
 * id não serve para ninguém ler no telão.
 */
export async function lerPlacar(codigo) {
  const [pontos, jogadores] = await Promise.all([
    redis.hgetall(chavePontos(codigo)),
    redis.hgetall(chaveJogadores(codigo))
  ]);

  return Object.entries(jogadores)
    .map(([id, apelido]) => ({ id, apelido, pontos: Number(pontos[id] ?? 0) }))
    .sort((a, b) => b.pontos - a.pontos || a.apelido.localeCompare(b.apelido, "pt-BR"));
}

/**
 * Marca a sala como aguardando a volta do apresentador.
 *
 * Sem isso, qualquer queda da conexão dele — um restart do
 * servidor em desenvolvimento, o wi-fi piscando, trocar de aba no
 * celular — encerrava a sala e derrubava todo mundo junto.
 */
export async function marcarApresentadorAusente(codigo) {
  await redis.hset(chaveSala(codigo), "apresentador_ausente_desde", String(Date.now()));
}

export async function marcarApresentadorPresente(codigo) {
  await redis.hdel(chaveSala(codigo), "apresentador_ausente_desde");
}
