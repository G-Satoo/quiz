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
const MIN_SEGUNDOS = 5;
const MAX_SEGUNDOS = 300;

/**
 * Valida uma pergunta inteira, com as alternativas.
 *
 * Devolve null se estiver tudo certo, ou a mensagem de erro já
 * dizendo QUAL pergunta está errada — numa lista de 15, "pergunta
 * inválida" não ajuda ninguém.
 */
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

  // O banco garante "no máximo uma correta" (índice único parcial
  // da migração 002). O "exatamente uma" é aqui: uma pergunta sem
  // resposta certa não dá para corrigir na hora da partida.
  const corretas = alternativas.filter((a) => a.correta === true).length;

  if (corretas === 0) return `${onde}: marque qual alternativa é a correta`;
  if (corretas > 1) return `${onde}: marque apenas uma alternativa como correta`;

  return null;
}

/**
 * Valida a lista inteira de perguntas de um quiz.
 */
export function validarPerguntas(perguntas) {
  if (!Array.isArray(perguntas)) return "Formato inválido das perguntas";
  if (perguntas.length === 0) return "O quiz precisa de pelo menos uma pergunta";
  if (perguntas.length > 50) return "São no máximo 50 perguntas por quiz";

  for (const [posicao, pergunta] of perguntas.entries()) {
    const erro = validarPergunta(pergunta, posicao);
    if (erro) return erro;
  }

  return null;
}
