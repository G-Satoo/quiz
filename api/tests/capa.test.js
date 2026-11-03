// ============================================================
// Testes do reconhecimento de imagem pelos bytes
//
// Rode com:  npm test
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tipoPelosBytes } from "../src/servicos/capa.js";

const comeco = (...bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

describe("tipoPelosBytes", () => {
  it("reconhece PNG, JPEG e WEBP pelo começo do arquivo", () => {
    assert.equal(tipoPelosBytes(comeco(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
    assert.equal(tipoPelosBytes(comeco(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");

    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
    assert.equal(tipoPelosBytes(webp), "image/webp");
  });

  it("recusa SVG, HTML e GIF", () => {
    assert.equal(tipoPelosBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(tipoPelosBytes(Buffer.from("<!doctype html><html></html>")), null);
    assert.equal(tipoPelosBytes(Buffer.from("GIF89a" + "x".repeat(20))), null);
  });

  it("recusa arquivo curto demais para ter cabeçalho", () => {
    assert.equal(tipoPelosBytes(Buffer.from([0x89, 0x50])), null);
    assert.equal(tipoPelosBytes(Buffer.alloc(0)), null);
    assert.equal(tipoPelosBytes(null), null);
  });
});
