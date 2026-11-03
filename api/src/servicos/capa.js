// ============================================================
// Capa enviada pelo dono do quiz
//
// O editor já recorta e reduz a imagem no navegador (3:4, 600x800,
// sem os metadados da foto). Mas o servidor não confia em quem
// chama a API: qualquer um pode mandar bytes direto, sem passar
// pelo editor. Por isso o tipo é decidido aqui, pelos primeiros
// bytes do arquivo — e não pelo Content-Type, que é só o que o
// cliente DIZ que mandou.
// ============================================================

/** Teto do arquivo. O mesmo do CHECK da migração 013. */
export const LIMITE_CAPA_BYTES = 1024 * 1024;

/**
 * O tipo de verdade, pelo "número mágico" do começo do arquivo.
 * Devolve null se não for PNG, JPEG ou WEBP.
 *
 * SVG nunca passa: ele é texto (XML), não começa com nenhum destes
 * números, e pode carregar script.
 */
export function tipoPelosBytes(bytes) {
  if (!bytes || bytes.length < 12) return null;

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";

  return null;
}
