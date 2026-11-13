// ============================================================
// Uma pergunta de sim ou não, na janela do site
//
//   if (await confirmar({ titulo, texto, sim: "Duplicar" })) { ... }
//
// Para ações que CRIAM ou MUDAM algo com um clique só — duplicar
// um quiz, por exemplo, grava uma cópia na conta da pessoa. Um
// clique sem querer não deveria deixar rascunho para trás.
//
// É um <dialog> de verdade: Esc e o botão Cancelar respondem "não",
// e o foco volta para onde estava quando ele fecha.
// ============================================================

export function confirmar({ titulo, texto = "", sim = "Confirmar", nao = "Cancelar" }) {
  return new Promise((resolver) => {
    const janela = document.createElement("dialog");
    janela.className = "janela janela-confirmar";

    const h2 = document.createElement("h2");
    h2.textContent = titulo; // texto, nunca innerHTML: o título pode citar um quiz

    const p = document.createElement("p");
    p.className = "subtitulo";
    p.textContent = texto;

    const botoes = document.createElement("div");
    botoes.className = "botoes-confirmar";

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "discreto";
    cancelar.textContent = nao;
    cancelar.addEventListener("click", () => janela.close("nao"));

    const aceitar = document.createElement("button");
    aceitar.type = "button";
    aceitar.textContent = sim;
    aceitar.addEventListener("click", () => janela.close("sim"));

    botoes.append(cancelar, aceitar);
    janela.append(h2, p, botoes);

    // Esc fecha sem valor: conta como "não".
    janela.addEventListener("close", () => {
      janela.remove();
      resolver(janela.returnValue === "sim");
    });

    document.body.append(janela);
    janela.showModal();
    aceitar.focus();
  });
}

/** A pergunta de duplicar, igual nas três telas que têm o botão. */
export function confirmarCopia(tituloDoQuiz) {
  return confirmar({
    titulo: "Duplicar este quiz?",
    texto: `Uma cópia de “${tituloDoQuiz}” será salva nos seus quizzes, como rascunho, para você editar.`,
    sim: "Duplicar"
  });
}
