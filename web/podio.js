// ============================================================
// Pódio do fim da partida
//
// Os três primeiros, em degraus: o 2º à esquerda, o 1º no meio e
// mais alto, o 3º à direita — a ordem de um pódio de verdade. Eles
// sobem um de cada vez, do 3º ao 1º, que é o suspense que um fim
// de partida merece (a animação está no estilo.css, e respeita
// quem pediu menos movimento ao sistema).
//
// Usado pelo telão (index.html) e pelo celular de quem joga
// (jogar.html): por isso mora num módulo só.
// ============================================================

const MEDALHAS = ["🥇", "🥈", "🥉"];

// Ordem na tela (2º, 1º, 3º) e a vez de cada um aparecer.
const DEGRAUS = [
  { posicao: 2, vez: 1 },
  { posicao: 1, vez: 2 },
  { posicao: 3, vez: 0 }
];

/**
 * Preenche `caixa` com o pódio de `placar` (já ordenado, do maior
 * para o menor). `meuId` destaca o degrau de quem está olhando.
 * Com placar vazio a caixa fica escondida.
 */
export function montarPodio(caixa, placar, meuId = null) {
  caixa.replaceChildren();
  caixa.classList.toggle("escondido", placar.length === 0);

  for (const { posicao, vez } of DEGRAUS) {
    const jogador = placar[posicao - 1];
    if (!jogador) continue;

    const degrau = document.createElement("div");
    degrau.className = `degrau degrau-${posicao}` + (jogador.id === meuId ? " eu" : "");
    degrau.style.setProperty("--vez", vez);

    const medalha = document.createElement("div");
    medalha.className = "medalha-podio";
    medalha.textContent = MEDALHAS[posicao - 1];

    const nome = document.createElement("div");
    nome.className = "nome-podio";
    nome.textContent = jogador.apelido; // texto, nunca innerHTML
    nome.title = jogador.apelido;

    const pontos = document.createElement("div");
    pontos.className = "pontos-podio";
    pontos.textContent = jogador.pontos.toLocaleString("pt-BR");

    const base = document.createElement("div");
    base.className = "base-podio";
    base.textContent = `${posicao}º`;

    degrau.append(medalha, nome, pontos, base);
    caixa.append(degrau);
  }
}
