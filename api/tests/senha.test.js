// ============================================================
// Testes do hash de senha
//
// Rode com:  npm test
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { gerarHash, conferirSenha } from "../src/servicos/senha.js";

describe("gerarHash", () => {
  it("nunca devolve a senha em texto", async () => {
    const hash = await gerarHash("minha-senha-secreta");

    assert.ok(!hash.includes("minha-senha-secreta"));
  });

  it("gera hashes diferentes para a mesma senha", async () => {
    // É o salt fazendo o trabalho dele. Se estes dois fossem
    // iguais, quebrar uma conta quebraria todas que repetem a senha.
    const primeiro = await gerarHash("senha-repetida");
    const segundo = await gerarHash("senha-repetida");

    assert.notEqual(primeiro, segundo);
  });

  it("guarda o algoritmo junto, para poder trocar depois", async () => {
    // Sem essa marca, migrar de scrypt para outro algoritmo exigiria
    // que todo mundo trocasse a senha no mesmo dia.
    const hash = await gerarHash("qualquer-senha");

    assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  });
});

describe("conferirSenha", () => {
  it("aceita a senha certa", async () => {
    const hash = await gerarHash("senha-correta-123");

    assert.equal(await conferirSenha("senha-correta-123", hash), true);
  });

  it("recusa a senha errada", async () => {
    const hash = await gerarHash("senha-correta-123");

    assert.equal(await conferirSenha("senha-errada-123", hash), false);
  });

  it("recusa sem quebrar quando o hash guardado está corrompido", async () => {
    // Pode acontecer com dado migrado de outro sistema. O importante
    // é responder "não confere" em vez de lançar erro — uma exceção
    // aqui viraria 500 no login e esconderia o problema real.
    for (const invalido of ["", "lixo", "scrypt$", "bcrypt$aa$bb", null, undefined]) {
      assert.equal(await conferirSenha("qualquer", invalido), false);
    }
  });
});
