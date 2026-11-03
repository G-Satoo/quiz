// ============================================================
// Busca de imagem de capa no Wikimedia Commons
//
// POR QUE AQUI E NÃO NUMA BUSCA DE IMAGENS QUALQUER
//
// O resultado de uma busca comum é foto de alguém, com dono.
// Usar como capa — ou carregar direto do servidor alheio — é
// usar obra sem licença. Gerar por IA um personagem conhecido
// dá no mesmo, só com outro nome.
//
// O Commons é um acervo de mídia com licença livre: domínio
// público ou Creative Commons. A condição, quase sempre, é dar
// crédito ao autor e dizer a licença — e é isso que guardamos
// junto com a URL, para a tela poder mostrar.
//
// O QUE ELE TEM E O QUE NÃO TEM
//
// Tem muito do que um quiz pede: bandeiras, mapas, animais,
// planetas, instrumentos, monumentos, retratos históricos.
//
// NÃO tem personagem de anime, cena de filme nem arte de game —
// essas imagens têm dono e não existem em acervo livre. Nesses
// casos a função devolve null e a capa cai no emoji, que é o
// comportamento certo: melhor um símbolo honesto do que uma
// imagem que não podemos usar.
// ============================================================

const BUSCA = "https://commons.wikimedia.org/w/api.php";

// O Commons pede que quem consome a API se identifique. Um
// cliente anônimo pode ser bloqueado, e com razão: sem isso eles
// não têm como falar com quem está causando problema.
const IDENTIFICACAO = "QuizAoVivo/1.0 (projeto de estudo; contato pelo GitHub)";

// Licenças que aceitamos. A lista é explícita de propósito: o
// Commons também hospeda arquivos sob regras especiais (uso
// justo, logotipos, marcas) que NÃO são livres, e pegar "o
// primeiro resultado" varreria esses junto.
const LICENCAS_OK = /^(cc0|cc[- ]by|cc[- ]by[- ]sa|public domain|pd|domínio público)/i;

const LARGURA = 600;

/**
 * Procura uma imagem livre para o tema.
 *
 * Devolve { url, pagina, autor, licenca } ou null.
 *
 * Nunca lança: capa é enfeite. Se a busca falhar, o quiz
 * continua perfeitamente utilizável com o símbolo.
 */
export async function buscarImagem(tema) {
  try {
    const parametros = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",

      // generator=search procura e já devolve os dados dos
      // arquivos achados, numa requisição só em vez de duas.
      generator: "search",
      gsrsearch: tema,
      gsrnamespace: "6", // 6 = arquivos; sem isso vêm páginas de texto
      gsrlimit: "8",

      prop: "imageinfo",
      iiprop: "url|extmetadata",

      // Pede uma miniatura em vez do original: arquivos do
      // Commons chegam a dezenas de megabytes, e uma capa de
      // 170 pixels não precisa disso.
      iiurlwidth: String(LARGURA)
    });

    const resposta = await fetch(`${BUSCA}?${parametros}`, {
      // Busca de capa é enfeite: se o Wikimedia demorar, segue sem.
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": IDENTIFICACAO }
    });

    if (!resposta.ok) return null;

    const dados = await resposta.json();
    const paginas = Object.values(dados?.query?.pages ?? {});

    for (const pagina of paginas) {
      const info = pagina?.imageinfo?.[0];
      if (!info) continue;

      // Só imagem de verdade: o Commons também tem som, vídeo e
      // PDF, e todos apareceriam na mesma busca.
      if (!/\.(jpe?g|png|gif|webp)$/i.test(pagina.title ?? "")) continue;

      const meta = info.extmetadata ?? {};
      const licenca = textoLimpo(meta.LicenseShortName?.value);

      if (!licenca || !LICENCAS_OK.test(licenca)) continue;

      return {
        url: info.thumburl ?? info.url,
        pagina: info.descriptionurl ?? null,
        autor: textoLimpo(meta.Artist?.value) || "autor não informado",
        licenca
      };
    }

    return null;
  } catch {
    return null; // enfeite nunca derruba o essencial
  }
}

/**
 * O campo de autor do Commons vem como HTML (com link para o
 * perfil de quem enviou). Guardar HTML de fora e jogar na tela
 * seria abrir a porta para script alheio — então extraímos só o
 * texto, aqui no servidor.
 */
function textoLimpo(valor) {
  if (typeof valor !== "string") return "";

  return valor
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
