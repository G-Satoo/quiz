// ============================================================
// Validação de entrada
//
// Tudo que chega em req.body é texto que um desconhecido
// escreveu. Cada função aqui devolve null quando está tudo bem
// ou a mensagem de erro — o mesmo formato em todas para as rotas
// poderem encadear sem pensar.
// ============================================================

// Não existe regex que valide e-mail de verdade (a gramática do
// RFC 5322 é maior do que parece, e mesmo um endereço válido pode
// não existir). Esta só barra o que é claramente lixo; quem
// confirma o endereço de fato é um e-mail de verificação.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarEmail(email) {
  if (typeof email !== "string" || email.trim() === "") {
    return "Informe o e-mail";
  }

  if (!FORMATO_EMAIL.test(email.trim())) {
    return "E-mail inválido";
  }

  return null;
}

export function validarSenha(senha) {
  if (typeof senha !== "string" || senha === "") {
    return "Informe a senha";
  }

  if (senha.length < 8) {
    return "A senha precisa de pelo menos 8 caracteres";
  }

  // scrypt processa a senha inteira; sem teto, uma senha de 10 MB
  // vira um jeito barato de ocupar CPU do servidor.
  if (senha.length > 200) {
    return "A senha é longa demais";
  }

  return null;
}

/**
 * Lê um inteiro de query string com limites. Query string sempre
 * chega como texto — ou como array, se o parâmetro vier repetido
 * na URL, e aí Number() de um array daria NaN silencioso.
 */
export function lerInteiro(valor, { padrao, minimo, maximo }) {
  if (valor === undefined || valor === null || valor === "") return padrao;

  // Dois formatos chegam aqui, e confundir os dois custou um bug
  // real nesta base:
  //
  //   query string  ->  sempre texto:     "30"
  //   corpo JSON    ->  o tipo de verdade:  30
  //
  // Esta função nasceu no projeto atalho, onde só havia query
  // string. Na primeira vez que a usamos num corpo JSON, ela
  // recusou o número e a rota respondeu "informe o quiz" — com o
  // quiz devidamente informado.
  if (typeof valor === "number") {
    if (!Number.isInteger(valor)) return padrao;
    return Math.min(Math.max(valor, minimo), maximo);
  }

  if (typeof valor !== "string") return padrao;

  // A regex antes do Number() não é redundante: Number("1e5") é
  // 100000 e Number("0x10") é 16 — ambos passariam por
  // Number.isInteger. Quem digita isso numa query string não está
  // pedindo uma página, está testando o parser.
  if (!/^-?\d+$/.test(valor.trim())) return padrao;

  const numero = Number(valor);

  if (!Number.isInteger(numero)) return padrao;
  if (numero < minimo) return minimo;
  if (numero > maximo) return maximo;

  return numero;
}

// ============================================================
// Regras do domínio do quiz
// ============================================================

export function validarNome(nome) {
  if (typeof nome !== "string" || nome.trim() === "") return "Informe o nome";
  if (nome.trim().length > 80) return "O nome é longo demais";
  return null;
}

// As mesmas do CHECK da migração 003. Repetidas aqui de
// propósito: o banco é a garantia final, mas quem erra merece
// uma mensagem em português em vez de um erro de constraint.
export const CATEGORIAS = [
  "geral", "anime", "games", "filmes", "musica",
  "esportes", "historia", "ciencia", "tecnologia", "educacao"
];

export function validarCategoria(categoria) {
  if (categoria === undefined || categoria === null) return null; // o banco põe 'geral'
  if (!CATEGORIAS.includes(categoria)) return "Categoria inválida";
  return null;
}

/**
 * O símbolo da capa.
 *
 * Não tentamos validar "é mesmo um emoji": a lista do Unicode
 * cresce a cada ano, e uma regex de hoje recusaria o emoji de
 * amanhã. Basta ser curto — o pior caso é uma capa com uma letra
 * estranha, não um dado perigoso (a tela usa textContent).
 */
export function validarIcone(icone) {
  if (icone === undefined || icone === null || icone === "") return null;
  if (typeof icone !== "string") return "Símbolo inválido";
  if ([...icone].length > 8) return "Use um símbolo só";
  return null;
}

export function validarTitulo(titulo) {
  if (typeof titulo !== "string" || titulo.trim() === "") {
    return "Informe o título do quiz";
  }
  if (titulo.trim().length > 140) return "O título é longo demais";
  return null;
}

// Menos de 2 alternativas não é pergunta, é afirmação. Mais de 6
// não cabe na tela de um celular, que é por onde as pessoas jogam.
const MIN_ALTERNATIVAS = 2;
const MAX_ALTERNATIVAS = 6;

// Os mesmos limites do CHECK da migração 002. Repetidos aqui de
// propósito: o banco é a garantia final, mas quem erra merece uma
// mensagem em português em vez de um erro de constraint.
// 10, e não 5: é o tempo de referência da pontuação (vale o fator
// 1). Abaixo disso a pergunta vira teste de reflexo de leitura.
export const MIN_SEGUNDOS = 10;
export const MAX_SEGUNDOS = 300;

/**
 * Valida uma pergunta inteira, com as alternativas.
 *
 * Devolve null se estiver tudo certo, ou a mensagem de erro já
 * dizendo QUAL pergunta está errada — numa lista de 15, "pergunta
 * inválida" não ajuda ninguém.
 */
/**
 * O texto na forma em que duas versões "iguais" ficam idênticas:
 * sem maiúsculas, sem acento, sem pontuação, com um espaço só entre
 * as palavras. "Qual é a capital do Brasil?" e "qual e a capital
 * do brasil" viram a mesma coisa.
 *
 * Não pega a mesma pergunta escrita com outras palavras — isso é
 * sentido, não texto, e fica com a análise da IA na aprovação.
 */
export function normalizarTexto(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Devolve [i, j] do primeiro par repetido (j < i), ou null. */
function primeiraRepeticao(textos) {
  const vistos = new Map();

  for (const [i, texto] of textos.entries()) {
    const chave = normalizarTexto(texto);
    if (!chave) continue;
    if (vistos.has(chave)) return [i, vistos.get(chave)];
    vistos.set(chave, i);
  }

  return null;
}

export function validarPergunta(pergunta, posicao) {
  const onde = `Pergunta ${posicao + 1}`;

  if (!pergunta || typeof pergunta !== "object") {
    return `${onde}: formato inválido`;
  }

  const { enunciado, segundos, alternativas } = pergunta;

  if (typeof enunciado !== "string" || enunciado.trim() === "") {
    return `${onde}: escreva o enunciado`;
  }

  if (enunciado.trim().length > 500) {
    return `${onde}: o enunciado é longo demais`;
  }

  if (!Number.isInteger(segundos) || segundos < MIN_SEGUNDOS || segundos > MAX_SEGUNDOS) {
    return `${onde}: o tempo deve ser um número inteiro entre ${MIN_SEGUNDOS} e ${MAX_SEGUNDOS} segundos`;
  }

  if (!Array.isArray(alternativas)) {
    return `${onde}: formato inválido das alternativas`;
  }

  if (alternativas.length < MIN_ALTERNATIVAS || alternativas.length > MAX_ALTERNATIVAS) {
    return `${onde}: são de ${MIN_ALTERNATIVAS} a ${MAX_ALTERNATIVAS} alternativas`;
  }

  for (const [indice, alternativa] of alternativas.entries()) {
    if (!alternativa || typeof alternativa.texto !== "string" || alternativa.texto.trim() === "") {
      return `${onde}: a alternativa ${indice + 1} está vazia`;
    }
    if (alternativa.texto.trim().length > 200) {
      return `${onde}: a alternativa ${indice + 1} é longa demais`;
    }
  }

  // Duas alternativas iguais: o jogador não teria como saber qual
  // das duas é "a certa", e a pergunta vira sorteio.
  const repetida = primeiraRepeticao(alternativas.map((a) => a.texto));
  if (repetida) {
    return `${onde}: as alternativas ${repetida[1] + 1} e ${repetida[0] + 1} são iguais`;
  }

  // O banco garante "no máximo uma correta" (índice único parcial
  // da migração 002). O "exatamente uma" é aqui: uma pergunta sem
  // resposta certa não dá para corrigir na hora da partida.
  const corretas = alternativas.filter((a) => a.correta === true).length;

  if (corretas === 0) return `${onde}: marque qual alternativa é a correta`;
  if (corretas > 1) return `${onde}: marque apenas uma alternativa como correta`;

  return null;
}

/**
 * Quantas perguntas ATIVAS um quiz precisa ter.
 *
 * Dez, por dois motivos. Uma partida de três perguntas acaba antes
 * de a sala esquentar. E o ranking soma pontos, que crescem com o
 * número de perguntas: com um piso comum, as partidas de quizzes
 * diferentes ficam mais comparáveis.
 *
 * Exportada porque três lugares aplicam a mesma regra — salvar,
 * bloquear e abrir sala —, e um número repetido em três arquivos
 * é um número que um dia vai divergir.
 */
export const MIN_PERGUNTAS = 10;

/**
 * Quantas perguntas ATIVAS um quiz pode ter.
 *
 * Era 50, o que dava uns 25 minutos de partida. Subiu para caber
 * uma partida de 2 horas (a ~30 s por pergunta, contando a tela de
 * resultado, são 240). Quem decide o tamanho é o dono; na hora de
 * apresentar, escolhe-se quantas delas entram.
 */
export const MAX_PERGUNTAS = 300;

/**
 * Valida a lista inteira de perguntas de um quiz.
 */
export function validarPerguntas(perguntas) {
  if (!Array.isArray(perguntas)) return "Formato inválido das perguntas";
  if (perguntas.length === 0) return "O quiz precisa de pelo menos uma pergunta";
  // Limite do tamanho da LISTA, só para conter o pedido: pergunta
  // nunca se apaga, e as desativadas se acumulam com o tempo.
  if (perguntas.length > 1000) return "Lista de perguntas grande demais";

  for (const [posicao, pergunta] of perguntas.entries()) {
    const erro = validarPergunta(pergunta, posicao);
    if (erro) return erro;
  }

  // Desativadas continuam guardadas, mas não valem para a
  // partida. Um quiz só com perguntas desativadas abriria uma
  // sala que termina na primeira tela.
  // Pergunta repetida entre as ATIVAS. As desativadas ficam de fora:
  // é normal reescrever uma pergunta aposentada e reativá-la depois.
  // A posição na mensagem é a da lista enviada, que é a que a tela
  // mostra — "repete a pergunta 3" aponta direto para o cartão.
  const posicoesAtivas = [];
  perguntas.forEach((p, i) => { if (p.ativa !== false) posicoesAtivas.push(i); });

  const repetida = primeiraRepeticao(posicoesAtivas.map((i) => perguntas[i].enunciado));
  if (repetida) {
    const [depois, antes] = repetida.map((i) => posicoesAtivas[i] + 1);
    return `Pergunta ${depois} repete a pergunta ${antes}`;
  }

  const ativas = perguntas.filter((p) => p.ativa !== false).length;

  // O limite vale para as ATIVAS, que são o que a partida tem. Contar as desativadas faria um quiz com 45 perguntas e
  // algumas aposentadas parar de salvar sem que ninguém entendesse
  // por quê.
  if (ativas > MAX_PERGUNTAS) return `São no máximo ${MAX_PERGUNTAS} perguntas ativas por quiz`;

  if (ativas < MIN_PERGUNTAS) {
    const faltam = MIN_PERGUNTAS - ativas;
    return `O quiz precisa de pelo menos ${MIN_PERGUNTAS} perguntas ativas — falta${faltam === 1 ? "" : "m"} ${faltam}`;
  }

  return null;
}

// As mesmas do CHECK da migração 012.
export const MOTIVOS_DENUNCIA = [
  "ofensivo", "sexual", "odio", "golpe", "dados-pessoais", "imagem", "sem-sentido", "outro"
];

export function validarDenuncia({ motivo, detalhe }) {
  if (!MOTIVOS_DENUNCIA.includes(motivo)) return "Escolha o motivo da denúncia";
  if (detalhe !== undefined && detalhe !== null && typeof detalhe !== "string") {
    return "Detalhe inválido";
  }
  if (typeof detalhe === "string" && detalhe.trim().length > 300) {
    return "O detalhe pode ter no máximo 300 caracteres";
  }
  return null;
}
