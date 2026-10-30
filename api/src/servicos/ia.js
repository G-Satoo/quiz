// ============================================================
// Geração de perguntas por modelo de linguagem
//
// UMA FUNÇÃO, VÁRIOS FORNECEDORES
//
// O resto do sistema conhece só `gerarPerguntas()`. Quem fala
// com o Google, com o Groq ou com nada fica aqui dentro, e a
// escolha é do .env — não do código.
//
// Isso não é abstração por esporte: preço, nome de modelo e
// limite gratuito mudam a cada poucos meses. Quando mudar, troca
// uma linha de configuração em vez de caçar chamadas espalhadas
// pelo projeto. E os testes rodam sem rede, sem chave e sem cota.
//
// O QUE NÃO SE CONFIA
//
// Nada do que o modelo devolve. Ele inventa fato com a mesma
// convicção com que acerta, e aqui isso é grave: marcar a
// alternativa errada como correta só aparece com a sala inteira
// respondendo. Por isso:
//
//   1. a saída passa pelo validarPerguntas(), as mesmas regras de
//      uma pergunta digitada à mão;
//   2. o resultado vai para o RASCUNHO do editor, nunca direto
//      para o banco — quem publica é a pessoa, depois de ler.
// ============================================================

import "dotenv/config";

import { validarPerguntas } from "../util/validacao.js";

const SEGUNDOS_PADRAO = 20;

export const DIFICULDADES = ["facil", "medio", "dificil"];

/**
 * O pedido, em português, com as regras explícitas.
 *
 * Instruções negativas ("não use 'todas as anteriores'") existem
 * porque são os vícios que aparecem sem elas — modelo treinado em
 * provas escolares adora pegadinha preguiçosa.
 */
function montarPedido({ tema, quantidade, dificuldade }) {
  const niveis = {
    facil: "fácil: alguém com contato casual com o tema acerta",
    medio: "médio: exige conhecer o tema, mas não ser especialista",
    dificil: "difícil: exige conhecimento aprofundado"
  };

  return `Crie ${quantidade} perguntas de múltipla escolha em português do Brasil sobre: ${tema}

Regras:
- nível ${niveis[dificuldade] ?? niveis.medio}
- cada pergunta tem exatamente 4 alternativas
- exatamente uma alternativa correta
- as alternativas erradas devem ser plausíveis, não absurdas
- não use "todas as anteriores", "nenhuma das anteriores" nem "A e B"
- não repita o mesmo assunto entre perguntas
- enunciado curto e direto, no máximo 2 linhas
- se você não tiver certeza de um fato, escolha outro aspecto do tema

Responda apenas com o JSON pedido, sem texto em volta.`;
}

// O formato que queremos de volta. O Gemini aceita um esquema e
// garante a estrutura — o que elimina a classe inteira de erro de
// "o modelo respondeu com um texto explicando o JSON".
const ESQUEMA_GEMINI = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      enunciado: { type: "STRING" },
      alternativas: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            texto: { type: "STRING" },
            correta: { type: "BOOLEAN" }
          },
          required: ["texto", "correta"]
        }
      }
    },
    required: ["enunciado", "alternativas"]
  }
};

// ------------------------------------------------------------
// Implementações
// ------------------------------------------------------------

/**
 * Não chama rede nenhuma. É o que os testes usam, e o que permite
 * mexer na tela sem gastar cota nem depender de internet.
 *
 * Devolve perguntas óbvias e identificáveis: se isso aparecer na
 * tela sem querer, é evidente que o provedor está errado — bem
 * melhor do que um texto plausível que esconde o engano.
 */
async function comFalso({ tema, quantidade }) {
  return Array.from({ length: quantidade }, (_, i) => ({
    enunciado: `[exemplo ${i + 1}] Pergunta sobre ${tema}?`,
    segundos: SEGUNDOS_PADRAO,
    alternativas: [
      { texto: "Resposta certa de exemplo", correta: true },
      { texto: "Resposta errada A", correta: false },
      { texto: "Resposta errada B", correta: false },
      { texto: "Resposta errada C", correta: false }
    ]
  }));
}

/**
 * Erros que valem tentar de novo.
 *
 * 503 ("modelo congestionado") e 500 são do lado do provedor e
 * costumam passar em segundos. 429 NÃO entra aqui: é cota
 * estourada, e insistir só gasta mais tentativa sem chance de
 * sucesso — além de ser exatamente o comportamento que faz um
 * provedor bloquear quem chama.
 */
const VALE_TENTAR_DE_NOVO = new Set([500, 502, 503, 504]);

const TENTATIVAS = 3;

async function comGemini(pedido) {
  let ultimoErro;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      return await chamarGemini(pedido);
    } catch (erro) {
      ultimoErro = erro;

      if (!VALE_TENTAR_DE_NOVO.has(erro.status) || tentativa === TENTATIVAS) throw erro;

      // Espera crescente: 1s, 2s. Se todo mundo tentasse de novo
      // na mesma hora, o congestionamento se realimentaria.
      const espera = 1000 * 2 ** (tentativa - 1);
      console.log(`IA congestionada (HTTP ${erro.status}), tentando de novo em ${espera}ms`);
      await new Promise((resolver) => setTimeout(resolver, espera));
    }
  }

  throw ultimoErro;
}

async function chamarGemini(pedido) {
  const chave = process.env.IA_CHAVE;
  const modelo = process.env.IA_MODELO || "gemini-3.6-flash";

  if (!chave) throw new ErroIA("sem-chave", "A chave da IA não está configurada no .env");

  const resposta = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: {
        // No cabeçalho, não na query string: em query string a
        // chave apareceria em log de proxy e em histórico.
        "x-goog-api-key": chave,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: montarPedido(pedido) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ESQUEMA_GEMINI
        }
      })
    }
  );

  if (!resposta.ok) {
    const corpo = await resposta.text();

    // 429 é cota da camada gratuita, não defeito — merece
    // mensagem própria, porque a ação de quem vê é esperar, não
    // reportar bug.
    if (resposta.status === 429) {
      throw new ErroIA("cota", "O limite gratuito da IA foi atingido. Tente de novo mais tarde.");
    }

    const falha = new ErroIA(
      "provedor",
      resposta.status >= 500
        ? "O serviço de IA está congestionado. Tente de novo em instantes."
        : `O provedor de IA recusou (HTTP ${resposta.status})`,
      corpo
    );

    falha.status = resposta.status;
    throw falha;
  }

  const dados = await resposta.json();
  const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!texto) {
    // Acontece quando o filtro de segurança do provedor barra o
    // tema. O JSON de resposta traz o motivo em finishReason.
    const motivo = dados?.candidates?.[0]?.finishReason ?? "desconhecido";
    throw new ErroIA("sem-resposta", `A IA não devolveu perguntas (motivo: ${motivo})`);
  }

  return JSON.parse(texto);
}

/**
 * Groq, OpenRouter, Ollama e qualquer outro que fale o formato
 * de chat da OpenAI — que virou o padrão de fato do mercado.
 * Muda só IA_URL_BASE e IA_MODELO.
 */
async function comOpenAiCompativel(pedido) {
  const base = process.env.IA_URL_BASE;
  const modelo = process.env.IA_MODELO;

  if (!base) throw new ErroIA("sem-chave", "IA_URL_BASE não está configurada no .env");

  const cabecalhos = { "Content-Type": "application/json" };
  // Ollama local não pede chave; os serviços na nuvem pedem.
  if (process.env.IA_CHAVE) cabecalhos.Authorization = `Bearer ${process.env.IA_CHAVE}`;

  const resposta = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: cabecalhos,
    body: JSON.stringify({
      model: modelo,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Você responde apenas com JSON no formato ' +
            '{"perguntas":[{"enunciado":"...","alternativas":[{"texto":"...","correta":true}]}]}'
        },
        { role: "user", content: montarPedido(pedido) }
      ]
    })
  });

  if (!resposta.ok) {
    if (resposta.status === 429) {
      throw new ErroIA("cota", "O limite gratuito da IA foi atingido. Tente de novo mais tarde.");
    }
    throw new ErroIA("provedor", `O provedor de IA recusou (HTTP ${resposta.status})`);
  }

  const dados = await resposta.json();
  const texto = dados?.choices?.[0]?.message?.content;

  if (!texto) throw new ErroIA("sem-resposta", "A IA não devolveu perguntas");

  const objeto = JSON.parse(texto);

  // Este formato não garante esquema como o do Gemini, então o
  // modelo pode embrulhar a lista num objeto de nome qualquer.
  return Array.isArray(objeto) ? objeto : objeto.perguntas ?? objeto.questions ?? [];
}

const IMPLEMENTACOES = {
  falso: comFalso,
  gemini: comGemini,
  "openai-compativel": comOpenAiCompativel
};

/** Erro com código, para a rota decidir qual status HTTP usar. */
export class ErroIA extends Error {
  constructor(codigo, mensagem, detalhe) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/**
 * Gera perguntas e devolve já no formato do editor.
 *
 * Nunca lança JSON cru para quem chamou: o que sai daqui ou é uma
 * lista válida pelas regras do projeto, ou é um ErroIA.
 */
export async function gerarPerguntas({ tema, quantidade = 5, dificuldade = "medio" }) {
  const provedor = process.env.IA_PROVEDOR || "falso";
  const implementacao = IMPLEMENTACOES[provedor];

  if (!implementacao) {
    throw new ErroIA("config", `Provedor de IA desconhecido: "${provedor}"`);
  }

  let brutas;

  try {
    brutas = await implementacao({ tema, quantidade, dificuldade });
  } catch (erro) {
    if (erro instanceof ErroIA) throw erro;

    // JSON.parse quebrado, rede fora, timeout. Para quem está na
    // tela é tudo a mesma coisa: não deu, tente de novo.
    throw new ErroIA("falha", "Não consegui gerar as perguntas agora. Tente de novo.", erro.message);
  }

  // O modelo ignora instrução de vez em quando: pede-se 5 e vêm 7.
  const perguntas = (Array.isArray(brutas) ? brutas : [])
    .slice(0, quantidade)
    .map((p) => ({
      enunciado: String(p?.enunciado ?? "").trim(),
      segundos: SEGUNDOS_PADRAO,
      alternativas: (Array.isArray(p?.alternativas) ? p.alternativas : []).map((a) => ({
        texto: String(a?.texto ?? "").trim(),
        correta: a?.correta === true
      }))
    }));

  // A mesma validação de uma pergunta digitada à mão. Se a saída
  // do modelo não passar, ela não vale mais do que lixo digitado.
  const erro = validarPerguntas(perguntas);

  if (erro) {
    throw new ErroIA("invalida", `A IA devolveu perguntas fora do padrão (${erro}). Tente de novo.`);
  }

  return perguntas;
}
