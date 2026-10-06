// ============================================================
// Hash de senha
//
// Usa scrypt, que vem no próprio Node (node:crypto) — sem
// dependência externa e sem compilar nada no Windows.
//
// Por que não guardar a senha, nem um SHA256 dela: SHA256 é
// rápido de propósito, e é isso que o atacante quer. Com uma
// lista de senhas vazadas ele testa bilhões por segundo. scrypt
// é lento e come memória de propósito — cada tentativa custa
// caro. O parâmetro N=16384 abaixo é o que define esse custo.
//
// O salt é um valor aleatório por usuário, guardado junto do
// hash. Ele existe para que duas pessoas com a mesma senha
// tenham hashes diferentes — sem isso, quebrar uma senha
// quebraria todas as contas que a repetem.
// ============================================================

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const TAMANHO_SALT = 16;
const TAMANHO_HASH = 64;
const PARAMETROS = { N: 16384, r: 8, p: 1 };

/**
 * Devolve "scrypt$<salt hex>$<hash hex>" — tudo que é preciso
 * para conferir depois cabe nessa string, então a tabela precisa
 * de uma coluna só.
 */
export async function gerarHash(senha) {
  const salt = randomBytes(TAMANHO_SALT);
  const hash = await scryptAsync(senha, salt, TAMANHO_HASH, PARAMETROS);

  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Confere uma senha contra o hash guardado.
 *
 * A comparação é com timingSafeEqual, não com ===. O === para de
 * comparar no primeiro byte diferente, então o tempo de resposta
 * conta quantos bytes o atacante já acertou. timingSafeEqual leva
 * sempre o mesmo tempo.
 */
export async function conferirSenha(senha, hashGuardado) {
  if (typeof hashGuardado !== "string") return false;

  const [algoritmo, saltHex, hashHex] = hashGuardado.split("$");
  if (algoritmo !== "scrypt" || !saltHex || !hashHex) return false;

  const esperado = Buffer.from(hashHex, "hex");
  const calculado = await scryptAsync(
    senha,
    Buffer.from(saltHex, "hex"),
    esperado.length,
    PARAMETROS
  );

  // timingSafeEqual exige tamanhos iguais, senão lança.
  if (esperado.length !== calculado.length) return false;

  return timingSafeEqual(esperado, calculado);
}
