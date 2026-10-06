// ============================================================
// Código de entrada da sala
//
// É o que aparece no telão e que as pessoas digitam no celular
// para entrar. Tudo nele é consequência disso.
// ============================================================

import { randomInt } from "node:crypto";

// Maiúsculas e números, sem 0/O, 1/I/L. São os pares que as
// pessoas erram ao copiar de um telão a cinco metros de
// distância — e aqui o erro não é um 404 silencioso, é alguém
// levantando a mão no meio da apresentação.
//
// Só maiúsculas porque é o que o teclado do celular oferece
// primeiro, e porque "a" e "A" seriam a mesma sala para quem
// digita: aceitar as duas e distinguir no banco seria pedir
// confusão.
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const TAMANHO = 6;

/**
 * Sorteia um código de sala.
 *
 * 31^6 ≈ 887 milhões de combinações. Parece exagero para um
 * sistema que terá poucas salas simultâneas — e é de propósito:
 * se o espaço fosse pequeno, qualquer um entraria em salas
 * alheias chutando códigos. As salas são públicas para quem
 * souber o código, então o código precisa ser difícil de chutar.
 *
 * randomInt do node:crypto, não Math.random(): esta é previsível
 * a partir de saídas anteriores, e alguém que criasse algumas
 * salas conseguiria adivinhar os códigos das próximas.
 */
export function gerarCodigo() {
  let codigo = "";

  for (let i = 0; i < TAMANHO; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }

  return codigo;
}

/**
 * Normaliza o que a pessoa digitou antes de procurar a sala.
 *
 * Gente digita com espaço, em minúscula, e o teclado do celular
 * às vezes capitaliza sozinho. Recusar por isso seria mesquinho:
 * o dado está certo, só está vestido diferente.
 */
export function normalizarCodigo(codigo) {
  if (typeof codigo !== "string") return null;

  const limpo = codigo.trim().toUpperCase().replace(/\s+/g, "");

  if (limpo.length !== TAMANHO) return null;

  // Depois de limpar, ainda precisa ser do nosso alfabeto — senão
  // é lixo ou tentativa de injeção em alguma camada adiante.
  for (const letra of limpo) {
    if (!ALFABETO.includes(letra)) return null;
  }

  return limpo;
}
