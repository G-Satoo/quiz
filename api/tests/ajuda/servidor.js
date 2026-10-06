// ============================================================
// Servidor efêmero para os testes
//
// Sobe o app numa porta aleatória e devolve um cliente que fala
// com ele. Assim os testes exercitam a pilha inteira — Express,
// middlewares, cookies, Postgres, Redis — em vez de chamar as
// funções por dentro e acreditar que o roteamento funciona.
// ============================================================

import { app } from "../../src/server.js";

/**
 * app.listen(0): o sistema operacional escolhe uma porta livre.
 * Porta fixa brigaria com o `npm run dev` aberto ao lado e com
 * outro arquivo de teste rodando em paralelo.
 */
export async function subirServidor() {
  const servidor = await new Promise((resolver) => {
    const s = app.listen(0, () => resolver(s));
  });

  const { port } = servidor.address();
  const base = `http://127.0.0.1:${port}`;

  return { servidor, base, cliente: criarCliente(base) };
}

/**
 * Cliente HTTP mínimo em cima do fetch, com uma diferença que é o
 * ponto todo: ele guarda o cookie de sessão entre as chamadas,
 * como um navegador faria. Sem isso, todo teste autenticado teria
 * que copiar o cabeçalho Set-Cookie na mão.
 */
export function criarCliente(base) {
  let cookie = null;

  async function pedir(metodo, caminho, corpo) {
    const cabecalhos = {};
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
    if (cookie) cabecalhos["Cookie"] = cookie;

    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),

      // manual: sem isto o fetch segue o 302 do redirecionamento e
      // vai buscar o site de destino de verdade na internet. O que
      // queremos testar é o cabeçalho Location, não o destino.
      redirect: "manual"
    });

    const guardado = resposta.headers.get("set-cookie");
    if (guardado) cookie = guardado.split(";")[0];

    // 204 e 302 não têm corpo; tentar ler JSON aí lança.
    let dados = null;
    const tipo = resposta.headers.get("content-type") ?? "";
    if (tipo.includes("application/json")) dados = await resposta.json();
    else await resposta.arrayBuffer(); // esvazia para a conexão liberar

    return { status: resposta.status, dados, cabecalhos: resposta.headers };
  }

  return {
    get: (caminho) => pedir("GET", caminho),
    post: (caminho, corpo) => pedir("POST", caminho, corpo),
    put: (caminho, corpo) => pedir("PUT", caminho, corpo),
    patch: (caminho, corpo) => pedir("PATCH", caminho, corpo),
    delete: (caminho) => pedir("DELETE", caminho),

    // Para testar o que acontece sem login, com sessão inválida,
    // ou com um cookie guardado antes do logout (simulando um
    // token que vazou).
    esquecerCookie: () => { cookie = null; },
    definirCookie: (valor) => { cookie = valor; },
    get cookieAtual() { return cookie; }
  };
}
