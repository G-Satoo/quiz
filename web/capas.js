// ============================================================
// Arte de capa por categoria
//
// Cada categoria tem um desenho próprio, em SVG, feito de formas
// geométricas simples.
//
// POR QUE DESENHAR EM VEZ DE BUSCAR
//
// Foto de acervo resolve o caso específico (bandeira do Brasil,
// planetas do sistema solar) e falha no geral: "anime" devolve
// foto de cosplayer numa convenção, "filmes" devolve a fachada
// de um cinema qualquer. Pior, toda foto tem autor, licença e
// crédito a carregar — e nenhuma garantia de continuar no ar.
//
// O desenho resolve o contrário: vale para QUALQUER quiz
// daquela categoria, carrega instantâneo porque vem junto com a
// página, não depende de rede nem de acervo nenhum, e é original
// — nenhuma questão de direito de imagem.
//
// COMO AS TRÊS CAMADAS SE COMBINAM
//
//   1. imagem própria do quiz, se a pessoa pôs uma
//   2. senão, o desenho da categoria
//   3. e por cima dele, o emoji do tema, quando houver
//
// Assim "História do Brasil" fica com a arte de história ao
// fundo e 🇧🇷 na frente: a categoria dá a identidade visual, o
// emoji dá a especificidade.
// ============================================================

// Dois tons por categoria: o fundo e o traço do desenho.
const PALETA = {
  geral:      ["#1d4ed8", "#60a5fa"],
  anime:      ["#9d174d", "#f472b6"],
  games:      ["#4c1d95", "#a78bfa"],
  filmes:     ["#164e63", "#22d3ee"],
  musica:     ["#7c2d12", "#fb923c"],
  esportes:   ["#14532d", "#4ade80"],
  historia:   ["#78350f", "#fbbf24"],
  ciencia:    ["#0f766e", "#2dd4bf"],
  tecnologia: ["#1e3a5f", "#38bdf8"],
  educacao:   ["#581c87", "#c084fc"],
  geografia:  ["#134e4a", "#5eead4"],
  natureza:   ["#365314", "#a3e635"],
  culinaria:  ["#7f1d1d", "#fca5a5"]
};

/**
 * Os desenhos.
 *
 * Todos num quadro 100x133 (a mesma proporção 3:4 da capa) e
 * usando só círculo, retângulo e linha. Simplicidade aqui não é
 * preguiça: a capa aparece com 140 pixels de largura numa
 * fileira, e detalhe fino vira sujeira nesse tamanho.
 *
 * `traco` é a cor passada pela paleta — o desenho não escolhe
 * cor, só forma.
 */
const DESENHOS = {
  // Lâmpada: a ideia, o "saber geral".
  geral: (c) => `
    <circle cx="50" cy="54" r="21" fill="none" stroke="${c}" stroke-width="3.5" opacity=".9"/>
    <path d="M42 76 h16 M44 83 h12" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M50 33 v-9 M26 54 h-9 M83 54 h-9 M33 37 l-6-6 M67 37 l6-6"
          stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".55"/>`,

  // Linhas de velocidade e um brilho — a linguagem visual do
  // gênero, sem desenhar personagem nenhum.
  anime: (c) => `
    <path d="M12 44 h30 M12 56 h22 M12 68 h34 M12 80 h18"
          stroke="${c}" stroke-width="3.5" stroke-linecap="round" opacity=".55"/>
    <path d="M66 38 l5 16 16 5 -16 5 -5 16 -5 -16 -16 -5 16 -5 Z"
          fill="${c}" opacity=".95"/>
    <circle cx="80" cy="92" r="4" fill="${c}" opacity=".6"/>`,

  // Controle: dois botões e um direcional, bem esquemático.
  games: (c) => `
    <rect x="18" y="48" width="64" height="38" rx="15"
          fill="none" stroke="${c}" stroke-width="3.5"/>
    <path d="M33 61 v12 M27 67 h12" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="66" cy="62" r="4.5" fill="${c}"/>
    <circle cx="74" cy="72" r="4.5" fill="${c}"/>`,

  // Claquete.
  filmes: (c) => `
    <rect x="20" y="52" width="60" height="38" rx="4"
          fill="none" stroke="${c}" stroke-width="3.5"/>
    <path d="M20 66 h60" stroke="${c}" stroke-width="3.5"/>
    <path d="M30 52 l8 14 M46 52 l8 14 M62 52 l8 14"
          stroke="${c}" stroke-width="3" opacity=".7"/>
    <circle cx="35" cy="79" r="3" fill="${c}" opacity=".5"/>`,

  // Nota musical sobre barras de equalizador.
  musica: (c) => `
    <path d="M44 78 V40 l26 -7 v38" fill="none" stroke="${c}" stroke-width="3.5"
          stroke-linejoin="round"/>
    <circle cx="38" cy="79" r="7" fill="${c}"/>
    <circle cx="64" cy="72" r="7" fill="${c}"/>
    <path d="M18 96 v-10 M26 96 v-18 M82 96 v-14 M90 96 v-7"
          stroke="${c}" stroke-width="3.5" stroke-linecap="round" opacity=".5"/>`,

  // Bola com linhas de movimento.
  esportes: (c) => `
    <circle cx="54" cy="64" r="22" fill="none" stroke="${c}" stroke-width="3.5"/>
    <path d="M54 42 v44 M32 64 h44" stroke="${c}" stroke-width="2.5" opacity=".6"/>
    <path d="M18 52 h12 M14 64 h10 M18 76 h12"
          stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".45"/>`,

  // Coluna clássica.
  historia: (c) => `
    <path d="M24 46 h52" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <path d="M20 92 h60" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
    <path d="M34 52 v34 M50 52 v34 M66 52 v34"
          stroke="${c}" stroke-width="3.5" opacity=".85"/>
    <path d="M30 40 h40" stroke="${c}" stroke-width="3" opacity=".5"/>`,

  // Átomo.
  ciencia: (c) => `
    <circle cx="50" cy="66" r="6" fill="${c}"/>
    <ellipse cx="50" cy="66" rx="30" ry="13" fill="none" stroke="${c}" stroke-width="3"/>
    <ellipse cx="50" cy="66" rx="30" ry="13" fill="none" stroke="${c}" stroke-width="3"
             transform="rotate(60 50 66)" opacity=".75"/>
    <ellipse cx="50" cy="66" rx="30" ry="13" fill="none" stroke="${c}" stroke-width="3"
             transform="rotate(120 50 66)" opacity=".5"/>`,

  // Trilhas de circuito.
  tecnologia: (c) => `
    <rect x="34" y="50" width="32" height="32" rx="4"
          fill="none" stroke="${c}" stroke-width="3.5"/>
    <path d="M34 58 h-16 M34 74 h-16 M66 58 h16 M66 74 h16
             M42 50 v-14 M58 50 v-14 M42 82 v14 M58 82 v14"
          stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".65"/>
    <circle cx="50" cy="66" r="5" fill="${c}"/>`,

  // Livro aberto.
  educacao: (c) => `
    <path d="M50 52 C42 46 30 46 20 50 v34 c10 -4 22 -4 30 2 Z"
          fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 52 C58 46 70 46 80 50 v34 c-10 -4 -22 -4 -30 2 Z"
          fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 52 v36" stroke="${c}" stroke-width="3" opacity=".6"/>`,

  // Globo: meridianos e paralelos.
  geografia: (c) => `
    <circle cx="50" cy="66" r="25" fill="none" stroke="${c}" stroke-width="3.5"/>
    <ellipse cx="50" cy="66" rx="11" ry="25" fill="none" stroke="${c}" stroke-width="3" opacity=".7"/>
    <path d="M25 66 h50 M29 53 h42 M29 79 h42"
          stroke="${c}" stroke-width="3" opacity=".55"/>`,

  // Folha com a nervura.
  natureza: (c) => `
    <path d="M28 88 C24 56 44 38 76 38 C76 70 58 90 28 88 Z"
          fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M28 88 L62 52 M42 74 h14 M50 65 v-12"
          stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".6"/>`,

  // Prato entre garfo e faca.
  culinaria: (c) => `
    <circle cx="50" cy="66" r="19" fill="none" stroke="${c}" stroke-width="3.5"/>
    <circle cx="50" cy="66" r="10" fill="none" stroke="${c}" stroke-width="2.5" opacity=".55"/>
    <path d="M18 44 v14 M13 44 v9 a5 5 0 0 0 10 0 v-9 M18 58 v30"
          fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".8"/>
    <path d="M83 88 V44 c-7 6 -7 20 0 26"
          fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`
};

/**
 * Devolve o SVG da categoria, pronto para ir no innerHTML.
 *
 * É SVG montado por nós, com valores de uma tabela fixa — não há
 * texto de usuário em lugar nenhum dele. Se um dia alguém quiser
 * interpolar um título aqui dentro, aí passa a ser necessário
 * escapar, e o lugar certo continua sendo textContent.
 */
export function artePorCategoria(categoria) {
  const [fundo, traco] = PALETA[categoria] ?? PALETA.geral;
  const desenho = (DESENHOS[categoria] ?? DESENHOS.geral)(traco);

  return `
    <svg viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice" class="arte-capa">
      <defs>
        <linearGradient id="g-${categoria}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${traco}" stop-opacity=".30"/>
          <stop offset="1" stop-color="${fundo}" stop-opacity=".95"/>
        </linearGradient>
      </defs>
      <rect width="100" height="133" fill="${fundo}"/>
      <rect width="100" height="133" fill="url(#g-${categoria})"/>
      ${desenho}
    </svg>`;
}

export function coresDaCategoria(categoria) {
  return PALETA[categoria] ?? PALETA.geral;
}
