// ============================================================
// Avatar sem foto
//
// Ninguém sobe foto aqui, então o avatar é a inicial do nome
// numa bola colorida. A cor sai do próprio nome: a mesma pessoa
// tem sempre a mesma cor, em qualquer tela — no topo, no ranking,
// no perfil —, e nomes vizinhos raramente repetem. Dá para
// reconhecer alguém de relance sem imagem nenhuma.
// ============================================================

// Poucos pares e bem distintos: com trinta variações tudo vira
// ruído e nenhuma cor fica reconhecível.
const CORES = [
  ["#4ea3ff", "#1d4ed8"], ["#48c78e", "#0f766e"],
  ["#f2a33c", "#b45309"], ["#ef5e64", "#9f1239"],
  ["#a78bfa", "#6d28d9"], ["#22d3ee", "#0e7490"],
  ["#f472b6", "#9d174d"], ["#facc15", "#a16207"]
];

/** Número estável a partir do texto: a cor não pode mudar a cada carregamento. */
function semente(texto) {
  let valor = 0;
  for (const letra of texto) valor = (valor * 31 + letra.codePointAt(0)) % 100000;
  return valor;
}

/**
 * Devolve o <span> do avatar: a foto, se a pessoa tiver uma
 * aprovada; senão a inicial na cor do nome.
 *
 * [...nome][0] e não nome[0]: um nome que começa com emoji tem a
 * primeira "letra" ocupando dois caracteres em JavaScript, e
 * nome[0] cortaria o emoji ao meio.
 */
export function montarAvatar(nome, classe = "avatar", foto = null) {
  const avatar = document.createElement("span");
  avatar.className = classe;

  const [clara, escura] = CORES[semente(nome) % CORES.length];
  avatar.style.background = `linear-gradient(135deg, ${clara}, ${escura})`;
  avatar.textContent = [...nome.trim()][0]?.toUpperCase() ?? "?";
  avatar.setAttribute("aria-hidden", "true");

  // Com foto (já aprovada pela moderação), ela cobre a inicial. Se
  // não carregar, some e a inicial volta — nunca um ícone quebrado.
  if (foto) {
    const img = document.createElement("img");
    img.src = foto;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    avatar.append(img);
  }

  return avatar;
}
