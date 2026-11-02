// ============================================================
// Enche o catálogo para ver como a página se comporta cheia
//
// Rode com:  npm run semear:catalogo
//
// O que faz, nesta ordem:
//
//   1. Apaga TODO quiz sem nenhuma pergunta ativa — de qualquer
//      conta. Quiz assim não abre sala; no catálogo ele só
//      ocupa espaço com um botão morto.
//   2. Cria 30 quizzes (3 por categoria) na conta de
//      demonstração, cada um com 4 perguntas.
//   3. Inventa um histórico de aberturas espalhado pelos últimos
//      60 dias, para as fileiras "da semana" e "de hoje" terem o
//      que mostrar.
//   4. Inventa partidas jogadas (com apelidos e pontos) e as
//      notas que esses jogadores deram, para "Jogadores do dia"
//      e a nota do banner terem o que mostrar. Os jogadores
//      ganham contas (jogador1@quiz.dev, jogador2@quiz.dev...),
//      porque o ranking só conta quem joga com conta.
//
// Os passos 3 e 4 são dado FALSO, e estão aqui só para
// demonstração: essas seções existem para medir uso real, e num
// banco novo elas nascem vazias de propósito. Nunca rode isto num
// banco com gente de verdade usando — os rankings passariam a
// mentir.
//
// Pode rodar várias vezes: antes de criar, apaga os quizzes da
// conta demo que tenham os mesmos títulos.
// ============================================================

import "dotenv/config";

import { pool } from "../db/pool.js";
import { gerarHash } from "../src/servicos/senha.js";

const EMAIL = "demo@quiz.dev";
const SENHA = "demo12345";

// Cada pergunta: [enunciado, [CORRETA, errada, errada, errada]].
// A correta vem sempre primeiro aqui, porque é mais fácil de
// revisar assim; o script embaralha a posição na hora de gravar.
const CATALOGO = [
  // ---------------- geral ----------------
  {
    titulo: "Capitais do mundo", categoria: "geral",
    descricao: "Da Oceania às Américas: você sabe onde fica o governo?",
    perguntas: [
      ["Qual é a capital da Austrália?", ["Camberra", "Sydney", "Melbourne", "Perth"]],
      ["Qual é a capital do Canadá?", ["Ottawa", "Toronto", "Vancouver", "Montreal"]],
      ["Qual é a capital da Turquia?", ["Ancara", "Istambul", "Izmir", "Antália"]],
      ["Qual é a capital do Japão?", ["Tóquio", "Osaka", "Quioto", "Hiroshima"]]
    ]
  },
  {
    titulo: "Culinária brasileira", categoria: "geral",
    descricao: "Pratos típicos de norte a sul do país.",
    perguntas: [
      ["Qual prato leva feijão-preto e carnes de porco?", ["Feijoada", "Moqueca", "Baião de dois", "Vatapá"]],
      ["O acarajé é típico de qual estado?", ["Bahia", "Pará", "Pernambuco", "Maranhão"]],
      ["O pão de queijo é típico de qual estado?", ["Minas Gerais", "Goiás", "São Paulo", "Paraná"]],
      ["De que é feita a tapioca?", ["Goma de mandioca", "Farinha de trigo", "Fubá de milho", "Farinha de arroz"]]
    ]
  },
  {
    titulo: "Reino animal", categoria: "geral",
    descricao: "Recordes e curiosidades da natureza.",
    perguntas: [
      ["Qual é o maior mamífero do planeta?", ["Baleia-azul", "Elefante-africano", "Cachalote", "Girafa"]],
      ["Qual é o animal terrestre mais rápido?", ["Guepardo", "Leão", "Antílope", "Cavalo"]],
      ["Quantas patas tem uma aranha?", ["8", "6", "10", "12"]],
      ["Qual destes mamíferos consegue voar?", ["Morcego", "Esquilo-voador", "Pinguim", "Avestruz"]]
    ]
  },

  // ---------------- anime ----------------
  {
    titulo: "Naruto", categoria: "anime",
    descricao: "O ninja cabeça-dura da Vila da Folha.",
    perguntas: [
      ["Qual é o sobrenome de Naruto?", ["Uzumaki", "Uchiha", "Hatake", "Hyuga"]],
      ["Que criatura está selada dentro de Naruto?", ["A Raposa de Nove Caudas", "O Tanuki de Uma Cauda", "O Polvo de Oito Caudas", "O Gato de Duas Caudas"]],
      ["Quem é o líder do Time 7?", ["Kakashi Hatake", "Jiraiya", "Iruka Umino", "Might Guy"]],
      ["Em que vila Naruto nasceu?", ["Vila Oculta da Folha", "Vila Oculta da Areia", "Vila Oculta da Névoa", "Vila Oculta da Nuvem"]]
    ]
  },
  {
    titulo: "One Piece", categoria: "anime",
    descricao: "A tripulação do Chapéu de Palha atrás do grande tesouro.",
    perguntas: [
      ["Qual é o sonho de Luffy?", ["Tornar-se o Rei dos Piratas", "Ser almirante da Marinha", "Achar o All Blue", "Desenhar o mapa do mundo"]],
      ["Qual Akuma no Mi Luffy comeu?", ["Gomu Gomu no Mi", "Mera Mera no Mi", "Bara Bara no Mi", "Hito Hito no Mi"]],
      ["Quem é o espadachim do bando?", ["Roronoa Zoro", "Sanji", "Usopp", "Brook"]],
      ["Qual foi o primeiro navio do bando?", ["Going Merry", "Thousand Sunny", "Red Force", "Moby Dick"]]
    ]
  },
  {
    titulo: "Dragon Ball", categoria: "anime",
    descricao: "Saiyajins, esferas do dragão e muito ki.",
    perguntas: [
      ["De que planeta Goku é originário?", ["Vegeta", "Namekusei", "Terra", "Yardrat"]],
      ["Quantas esferas é preciso reunir para chamar o dragão?", ["7", "5", "9", "12"]],
      ["Como se chama o dragão das esferas da Terra?", ["Shenlong", "Porunga", "Kaioh", "Bills"]],
      ["Contra quem Goku vira Super Saiyajin pela primeira vez?", ["Freeza", "Cell", "Majin Boo", "Vegeta"]]
    ]
  },

  // ---------------- games ----------------
  {
    titulo: "Pokémon", categoria: "games",
    descricao: "Temos que pegar! Mas quanto você sabe?",
    perguntas: [
      ["Qual é o primeiro Pokémon de Ash no anime?", ["Pikachu", "Charmander", "Bulbasaur", "Squirtle"]],
      ["Qual é o número 1 da Pokédex?", ["Bulbasaur", "Pikachu", "Mew", "Arceus"]],
      ["De que tipo é o Charmander?", ["Fogo", "Dragão", "Pedra", "Lutador"]],
      ["Que professor entrega o primeiro Pokémon em Kanto?", ["Professor Carvalho", "Professor Elm", "Professor Birch", "Professor Rowan"]]
    ]
  },
  {
    titulo: "Minecraft", categoria: "games",
    descricao: "Blocos, creepers e o End.",
    perguntas: [
      ["De que bloco é feito o portal do Nether?", ["Obsidiana", "Pedra", "Diamante", "Ferro"]],
      ["Qual criatura verde explode perto do jogador?", ["Creeper", "Zumbi", "Enderman", "Esqueleto"]],
      ["Qual chefe vive no End?", ["Dragão do Ender", "Wither", "Guardião Ancião", "Warden"]],
      ["Que empresa comprou o Minecraft em 2014?", ["Microsoft", "Sony", "Nintendo", "Electronic Arts"]]
    ]
  },
  {
    titulo: "Super Mario", categoria: "games",
    descricao: "O encanador mais famoso dos videogames.",
    perguntas: [
      ["Qual é a profissão do Mario?", ["Encanador", "Carpinteiro", "Eletricista", "Pedreiro"]],
      ["Como se chama o irmão do Mario?", ["Luigi", "Wario", "Toad", "Yoshi"]],
      ["Quem é o principal vilão da série?", ["Bowser", "Wario", "Donkey Kong", "Waluigi"]],
      ["Em que jogo o Mario apareceu pela primeira vez, em 1981?", ["Donkey Kong", "Super Mario Bros.", "Mario Kart", "Mario Bros."]]
    ]
  },

  // ---------------- filmes ----------------
  {
    titulo: "Harry Potter", categoria: "filmes",
    descricao: "Hogwarts, feitiços e o menino que sobreviveu.",
    perguntas: [
      ["Em que casa de Hogwarts Harry fica?", ["Grifinória", "Sonserina", "Corvinal", "Lufa-Lufa"]],
      ["Como se chama a coruja de Harry?", ["Edwiges", "Errol", "Píchi", "Bicuço"]],
      ["Qual é o esporte jogado em vassouras?", ["Quadribol", "Críquete", "Bludgerbol", "Vassobol"]],
      ["Quem escreveu os livros da série?", ["J.K. Rowling", "Stephen King", "J.R.R. Tolkien", "Rick Riordan"]]
    ]
  },
  {
    titulo: "Star Wars", categoria: "filmes",
    descricao: "Há muito tempo, numa galáxia muito, muito distante...",
    perguntas: [
      ["Quem é o pai de Luke Skywalker?", ["Darth Vader", "Obi-Wan Kenobi", "Han Solo", "Imperador Palpatine"]],
      ["Qual é a arma típica de um Jedi?", ["Sabre de luz", "Blaster", "Arco energético", "Lança de plasma"]],
      ["Quem é o dono da Millennium Falcon no filme de 1977?", ["Han Solo", "Luke Skywalker", "Leia Organa", "Obi-Wan Kenobi"]],
      ["Em que ano estreou o primeiro filme da saga?", ["1977", "1980", "1983", "1999"]]
    ]
  },
  {
    titulo: "Universo Marvel", categoria: "filmes",
    descricao: "Vingadores, joias do infinito e muito mais.",
    perguntas: [
      ["Qual é a identidade do Homem de Ferro?", ["Tony Stark", "Steve Rogers", "Bruce Banner", "Peter Parker"]],
      ["Como se chama o martelo de Thor?", ["Mjölnir", "Gungnir", "Excalibur", "Rompe-Tormentas"]],
      ["Qual filme abriu o Universo Cinematográfico Marvel, em 2008?", ["Homem de Ferro", "O Incrível Hulk", "Capitão América", "Thor"]],
      ["De que país o Pantera Negra é rei?", ["Wakanda", "Latvéria", "Sokovia", "Genosha"]]
    ]
  },

  // ---------------- musica ----------------
  {
    titulo: "The Beatles", categoria: "musica",
    descricao: "Os quatro garotos de Liverpool.",
    perguntas: [
      ["De que cidade são os Beatles?", ["Liverpool", "Londres", "Manchester", "Dublin"]],
      ["Quem destes NÃO fez parte dos Beatles?", ["Mick Jagger", "Ringo Starr", "George Harrison", "Paul McCartney"]],
      ["Que álbum tem a banda atravessando a faixa de pedestres na capa?", ["Abbey Road", "Revolver", "Let It Be", "Help!"]],
      ["Quem era o baterista da banda?", ["Ringo Starr", "John Lennon", "George Harrison", "Paul McCartney"]]
    ]
  },
  {
    titulo: "MPB", categoria: "musica",
    descricao: "Bossa nova, Tropicália e os grandes da música brasileira.",
    perguntas: [
      ["Quem compôs \"Garota de Ipanema\"?", ["Tom Jobim e Vinicius de Moraes", "Caetano Veloso e Gilberto Gil", "Chico Buarque e Toquinho", "João Gilberto e Carlos Lyra"]],
      ["Que movimento Caetano e Gil lideraram no fim dos anos 1960?", ["Tropicália", "Bossa Nova", "Jovem Guarda", "Clube da Esquina"]],
      ["Que cantora ganhou o apelido de \"Pimentinha\"?", ["Elis Regina", "Gal Costa", "Maria Bethânia", "Nara Leão"]],
      ["Quem gravou o álbum \"Construção\", de 1971?", ["Chico Buarque", "Milton Nascimento", "Caetano Veloso", "Jorge Ben"]]
    ]
  },
  {
    titulo: "Rock nacional", categoria: "musica",
    descricao: "As bandas que marcaram os anos 80.",
    perguntas: [
      ["Quem era o vocalista da Legião Urbana?", ["Renato Russo", "Cazuza", "Herbert Vianna", "Dinho Ouro Preto"]],
      ["De que banda Cazuza foi vocalista?", ["Barão Vermelho", "Titãs", "Paralamas do Sucesso", "Capital Inicial"]],
      ["Quem é o vocalista dos Paralamas do Sucesso?", ["Herbert Vianna", "Nando Reis", "Frejat", "Lobão"]],
      ["Que festival teve a primeira edição no Rio, em 1985?", ["Rock in Rio", "Lollapalooza", "Hollywood Rock", "Monsters of Rock"]]
    ]
  },

  // ---------------- esportes ----------------
  {
    titulo: "Copa do Mundo", categoria: "esportes",
    descricao: "A história do maior torneio do futebol.",
    perguntas: [
      ["Quantas Copas do Mundo o Brasil já ganhou?", ["5", "4", "6", "3"]],
      ["Quem venceu a Copa de 2022, no Catar?", ["Argentina", "França", "Croácia", "Brasil"]],
      ["Quem é o maior artilheiro da história das Copas?", ["Miroslav Klose", "Ronaldo", "Pelé", "Lionel Messi"]],
      ["Que país sediou a Copa de 2014?", ["Brasil", "Alemanha", "África do Sul", "Rússia"]]
    ]
  },
  {
    titulo: "Fórmula 1", categoria: "esportes",
    descricao: "Velocidade, pit stops e lendas das pistas.",
    perguntas: [
      ["Que brasileiro foi campeão mundial em 1988, 1990 e 1991?", ["Ayrton Senna", "Nelson Piquet", "Emerson Fittipaldi", "Rubens Barrichello"]],
      ["Em que autódromo de São Paulo é disputado o GP do Brasil?", ["Interlagos", "Monza", "Silverstone", "Suzuka"]],
      ["Que bandeira indica o fim da corrida?", ["Quadriculada", "Vermelha", "Amarela", "Azul"]],
      ["Quantos títulos mundiais Michael Schumacher conquistou?", ["7", "5", "6", "4"]]
    ]
  },
  {
    titulo: "NBA", categoria: "esportes",
    descricao: "O basquete da liga americana.",
    perguntas: [
      ["Em que time Michael Jordan conquistou seus seis títulos?", ["Chicago Bulls", "Los Angeles Lakers", "Boston Celtics", "Washington Wizards"]],
      ["Quantos pontos vale uma cesta feita de fora do arco?", ["3", "2", "4", "1"]],
      ["Kobe Bryant jogou a carreira inteira em qual time?", ["Los Angeles Lakers", "Chicago Bulls", "Miami Heat", "New York Knicks"]],
      ["Quantos jogadores de cada time ficam em quadra?", ["5", "6", "7", "4"]]
    ]
  },

  // ---------------- historia ----------------
  {
    titulo: "Brasil Império", categoria: "historia",
    descricao: "Da Independência à República.",
    perguntas: [
      ["Em que ano o Brasil declarou a independência?", ["1822", "1808", "1889", "1831"]],
      ["Quem foi o primeiro imperador do Brasil?", ["Dom Pedro I", "Dom Pedro II", "Dom João VI", "Deodoro da Fonseca"]],
      ["Que lei aboliu a escravidão no Brasil?", ["Lei Áurea", "Lei do Ventre Livre", "Lei dos Sexagenários", "Lei Eusébio de Queirós"]],
      ["Em que ano foi proclamada a República?", ["1889", "1888", "1891", "1822"]]
    ]
  },
  {
    titulo: "Segunda Guerra Mundial", categoria: "historia",
    descricao: "O conflito que mudou o século XX.",
    perguntas: [
      ["Em que ano começou a Segunda Guerra?", ["1939", "1914", "1941", "1945"]],
      ["Que ataque levou os Estados Unidos a entrar na guerra?", ["Pearl Harbor", "Dunquerque", "Stalingrado", "Midway"]],
      ["Como ficou conhecido o desembarque aliado na Normandia, em 6 de junho de 1944?", ["Dia D", "Blitzkrieg", "Operação Barbarossa", "Dia V"]],
      ["Que tropa o Brasil enviou para lutar na Itália?", ["Força Expedicionária Brasileira", "Legião Brasileira", "Guarda Nacional", "Brigada Tiradentes"]]
    ]
  },
  {
    titulo: "Egito Antigo", categoria: "historia",
    descricao: "Faraós, pirâmides e hieróglifos.",
    perguntas: [
      ["Que rio sustentou a civilização egípcia?", ["Nilo", "Tigre", "Eufrates", "Jordão"]],
      ["Como se chama a escrita do Egito Antigo?", ["Hieróglifos", "Cuneiforme", "Runas", "Ideogramas"]],
      ["Qual é a maior pirâmide de Gizé?", ["Quéops", "Quéfren", "Miquerinos", "Djoser"]],
      ["Que pedra permitiu decifrar os hieróglifos?", ["Pedra de Roseta", "Pedra Filosofal", "Pedra de Gizé", "Pedra de Tebas"]]
    ]
  },

  // ---------------- ciencia ----------------
  {
    titulo: "Sistema Solar", categoria: "ciencia",
    descricao: "Planetas, órbitas e o nosso cantinho do universo.",
    perguntas: [
      ["Qual é o maior planeta do Sistema Solar?", ["Júpiter", "Saturno", "Netuno", "Terra"]],
      ["Qual planeta é conhecido como planeta vermelho?", ["Marte", "Vênus", "Mercúrio", "Júpiter"]],
      ["Qual planeta fica mais perto do Sol?", ["Mercúrio", "Vênus", "Marte", "Terra"]],
      ["Quantos planetas tem o Sistema Solar?", ["8", "9", "7", "10"]]
    ]
  },
  {
    titulo: "Corpo humano", categoria: "ciencia",
    descricao: "Ossos, órgãos e células.",
    perguntas: [
      ["Qual é o maior órgão do corpo humano?", ["Pele", "Fígado", "Pulmão", "Intestino"]],
      ["Quantos ossos tem o corpo de um adulto?", ["206", "180", "250", "300"]],
      ["Que célula do sangue transporta oxigênio?", ["Hemácia", "Leucócito", "Plaqueta", "Neurônio"]],
      ["Qual é o osso mais longo do corpo?", ["Fêmur", "Tíbia", "Úmero", "Rádio"]]
    ]
  },
  {
    titulo: "Química básica", categoria: "ciencia",
    descricao: "Elementos, símbolos e a tabela periódica.",
    perguntas: [
      ["Qual é o símbolo químico do ouro?", ["Au", "Ag", "Or", "Go"]],
      ["Que gás forma a maior parte do ar?", ["Nitrogênio", "Oxigênio", "Gás carbônico", "Argônio"]],
      ["Qual é o número atômico do hidrogênio?", ["1", "2", "0", "8"]],
      ["Quem organizou a primeira tabela periódica?", ["Dmitri Mendeleev", "Marie Curie", "Antoine Lavoisier", "Isaac Newton"]]
    ]
  },

  // ---------------- tecnologia ----------------
  {
    titulo: "JavaScript", categoria: "tecnologia",
    descricao: "As pegadinhas da linguagem da web.",
    perguntas: [
      ["Quanto vale typeof null?", ["\"object\"", "\"null\"", "\"undefined\"", "\"number\""]],
      ["Que palavra declara uma variável que não pode ser reatribuída?", ["const", "let", "var", "static"]],
      ["Quanto dá 0.1 + 0.2 === 0.3?", ["false", "true", "undefined", "NaN"]],
      ["Que método adiciona um item ao fim de um array?", ["push", "pop", "shift", "unshift"]]
    ]
  },
  {
    titulo: "Como a internet funciona", categoria: "tecnologia",
    descricao: "HTTP, DNS e o que acontece quando você digita um endereço.",
    perguntas: [
      ["O que significa a sigla HTTP?", ["HyperText Transfer Protocol", "High Transfer Text Protocol", "HyperText Transmission Program", "Host Text Transfer Protocol"]],
      ["Que código HTTP significa \"não encontrado\"?", ["404", "500", "301", "200"]],
      ["Quem criou a World Wide Web?", ["Tim Berners-Lee", "Bill Gates", "Steve Jobs", "Linus Torvalds"]],
      ["Para que serve o DNS?", ["Traduzir nomes de domínio em endereços IP", "Criptografar a conexão", "Guardar cookies", "Comprimir páginas"]]
    ]
  },
  {
    titulo: "Git", categoria: "tecnologia",
    descricao: "Commits, branches e push.",
    perguntas: [
      ["Que comando grava as mudanças preparadas no histórico?", ["git commit", "git save", "git add", "git store"]],
      ["Que comando envia os commits para o repositório remoto?", ["git push", "git pull", "git send", "git upload"]],
      ["Quem criou o Git?", ["Linus Torvalds", "Guido van Rossum", "Brendan Eich", "Dennis Ritchie"]],
      ["Que comando mostra o que mudou e ainda não foi gravado?", ["git status", "git log", "git show", "git branch"]]
    ]
  },

  // ---------------- educacao ----------------
  {
    titulo: "Gramática portuguesa", categoria: "educacao",
    descricao: "Plural, crase e ortografia.",
    perguntas: [
      ["Qual é o plural de \"cidadão\"?", ["Cidadãos", "Cidadões", "Cidadães", "Cidadãoes"]],
      ["Em qual frase a crase está correta?", ["Vou à escola", "Vou à pé", "Comecei à estudar", "Falei à ele"]],
      ["A que classe pertence a palavra \"rapidamente\"?", ["Advérbio", "Adjetivo", "Substantivo", "Verbo"]],
      ["Qual é a grafia correta?", ["Exceção", "Excessão", "Esceção", "Execeção"]]
    ]
  },
  {
    titulo: "Matemática básica", categoria: "educacao",
    descricao: "Contas rápidas para aquecer o cérebro.",
    perguntas: [
      ["Quanto é 7 × 8?", ["56", "54", "63", "48"]],
      ["Qual é a raiz quadrada de 144?", ["12", "14", "11", "16"]],
      ["Quanto somam os ângulos internos de um triângulo?", ["180°", "360°", "90°", "270°"]],
      ["Quanto é 25% de 200?", ["50", "25", "40", "75"]]
    ]
  },
  {
    titulo: "Geografia do Brasil", categoria: "educacao",
    descricao: "Estados, capitais e biomas.",
    perguntas: [
      ["Qual é o maior estado do Brasil em área?", ["Amazonas", "Pará", "Mato Grosso", "Minas Gerais"]],
      ["Quantos estados tem o Brasil, sem contar o Distrito Federal?", ["26", "27", "25", "24"]],
      ["Qual é a capital da Bahia?", ["Salvador", "Feira de Santana", "Ilhéus", "Porto Seguro"]],
      ["Qual é o maior bioma brasileiro?", ["Amazônia", "Cerrado", "Mata Atlântica", "Caatinga"]]
    ]
  }
];

// ---------- Sorteio reprodutível ----------
//
// Math.random daria um catálogo diferente a cada execução. Com
// semente fixa, rodar de novo produz exatamente os mesmos
// números — o que facilita comparar a tela antes e depois de
// uma mudança de layout.
function sorteador(semente) {
  let estado = semente >>> 0;
  return () => {
    // mulberry32: curto, rápido e bom o bastante para dado de
    // demonstração. Não serve para nada que envolva segurança.
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sortear = sorteador(2026);

const APELIDOS = [
  "Luiza", "Pedrão", "Gabi_quiz", "Rafa", "Tiago", "Mari", "Duda", "Kauã",
  "Bia", "Léo", "Nina", "Caio", "Júlia", "Theo", "Lara", "Enzo", "Manu",
  "Davi", "Isa", "Bruno", "Sofia", "Heitor", "Alice", "Vini", "Clara",
  "Otto", "Helena", "Ravi", "Cecília", "Benício"
];
const entre = (min, max) => min + Math.floor(sortear() * (max - min + 1));

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(sortear() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

async function semear() {
  const cliente = await pool.connect();

  try {
    await cliente.query("BEGIN");

    // 1. Fora o que não abre sala.
    const { rowCount: removidos } = await cliente.query(
      `DELETE FROM quizzes q
        WHERE NOT EXISTS (
          SELECT 1 FROM perguntas p WHERE p.quiz_id = q.id AND p.ativa
        )`
    );

    // A conta demo: reaproveita se existir. O semear.js original
    // apaga e recria a conta, o que levaria junto quizzes que
    // você tenha feito nela — aqui não há motivo para isso.
    let { rows: usuarios } = await cliente.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [EMAIL]
    );

    if (usuarios.length === 0) {
      ({ rows: usuarios } = await cliente.query(
        `INSERT INTO usuarios (nome, email, senha_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        ["Apresentador Demo", EMAIL, await gerarHash(SENHA)]
      ));
    }

    const usuarioId = usuarios[0].id;

    // Contas dos jogadores de demonstração. ON CONFLICT reaproveita
    // quem já existe, para o script poder rodar de novo. O hash é
    // calculado uma vez só: scrypt é lento de propósito, e trinta
    // hashes seriam trinta vezes essa lentidão à toa.
    const hashJogador = await gerarHash(SENHA);
    const contas = [];

    for (const [i, apelido] of APELIDOS.entries()) {
      const { rows } = await cliente.query(
        `INSERT INTO usuarios (nome, email, senha_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome
         RETURNING id`,
        [apelido, `jogador${i + 1}@quiz.dev`, hashJogador]
      );
      contas.push(rows[0].id);
    }

    // Rodar de novo não duplica: some a versão anterior de cada
    // quiz deste catálogo antes de criar a nova.
    await cliente.query(
      "DELETE FROM quizzes WHERE usuario_id = $1 AND titulo = ANY($2)",
      [usuarioId, CATALOGO.map((q) => q.titulo)]
    );

    // 2. Os quizzes. A ordem de criação também é embaralhada:
    // senão "Todos os quizzes", que ordena pelo mais novo,
    // apareceria agrupado por categoria.
    for (const quiz of embaralhar(CATALOGO)) {
      const { rows: criados } = await cliente.query(
        `INSERT INTO quizzes (usuario_id, titulo, descricao, categoria)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [usuarioId, quiz.titulo, quiz.descricao, quiz.categoria]
      );
      const quizId = criados[0].id;

      for (const [ordem, [enunciado, alternativas]] of quiz.perguntas.entries()) {
        const { rows: perguntas } = await cliente.query(
          `INSERT INTO perguntas (quiz_id, ordem, enunciado, segundos)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [quizId, ordem, enunciado, 20]
        );

        // A correta vem primeiro na lista acima; aqui ela vai
        // para uma posição sorteada. Sem isso, a resposta seria
        // sempre a alternativa A.
        const correta = alternativas[0];
        for (const [posicao, texto] of embaralhar(alternativas).entries()) {
          await cliente.query(
            `INSERT INTO alternativas (pergunta_id, ordem, texto, correta)
             VALUES ($1, $2, $3, $4)`,
            [perguntas[0].id, posicao, texto, texto === correta]
          );
        }
      }

      // 3. Histórico inventado. Poucos quizzes muito acessados e
      // uma cauda longa de pouco acessados, que é o formato que
      // popularidade costuma ter — com todos parecidos, as
      // fileiras ficariam iguais entre si.
      const total = Math.round(3 + 140 * sortear() ** 3);
      const horas = [];

      // Cada quiz tem o seu MOMENTO: alguns estão em alta agora
      // (quase todo acesso é recente), outros são clássicos
      // antigos (quase nada esta semana). Se todos tivessem o
      // mesmo perfil no tempo, "da semana" e "de hoje" sairiam
      // na mesma ordem que "de todos os tempos" — três fileiras
      // dizendo a mesma coisa.
      const emAlta = sortear() ** 2;
      const hoje = emAlta * 0.25;

      for (let i = 0; i < total; i++) {
        const faixa = sortear();
        const atras = faixa < hoje ? sortear() * 12
                    : faixa < emAlta ? 24 + sortear() * 24 * 6
                    : 24 * 7 + sortear() * 24 * 53;
        horas.push(atras);
      }

      if (horas.length > 0) {
        await cliente.query(
          `INSERT INTO aberturas (quiz_id, ocorrido_em)
           SELECT $1, now() - make_interval(secs => h * 3600)
             FROM unnest($2::float8[]) AS h`,
          [quizId, horas]
        );
      }

      await cliente.query("UPDATE quizzes SET partidas = $2 WHERE id = $1", [quizId, total]);

      // 4. Partidas jogadas e notas. Cada quiz tem uma QUALIDADE
      // sorteada que puxa as notas dele para cima ou para baixo
      // — com todas as notas sorteadas igual, todo quiz teria
      // média perto de 3 e a nota não diria nada.
      const qualidade = 2.5 + sortear() * 2.5;
      const jogos = entre(2, 18);
      const resultados = [];
      const notas = [];

      for (let i = 0; i < jogos; i++) {
        const jogadorId = `demo-${quizId}-${i}`;
        const sala = `DEMO${quizId}`;

        // Parte de hoje (alimenta "Jogadores do dia"), o resto
        // espalhado pelos últimos 60 dias. "Hoje" é uma fração
        // do tempo desde a meia-noite, para nunca cair ontem.
        const hoje = sortear() < 0.3;

        const quem = entre(0, APELIDOS.length - 1);

        resultados.push({
          sala,
          jogador_id: jogadorId,
          apelido: APELIDOS[quem],
          // Dois em cada dez jogam sem conta: jogam, mas ficam
          // fora do ranking — como acontece de verdade.
          usuario_id: sortear() < 0.8 ? contas[quem] : null,
          // 4 perguntas valem no máximo 4.000; ninguém acerta
          // tudo no primeiro segundo, então o teto fica abaixo.
          pontos: entre(0, 7) * 500 + entre(0, 350),
          posicao: 1,
          hoje,
          fracao: sortear()
        });

        // Sete em cada dez avaliam.
        if (sortear() < 0.7) {
          const nota = Math.min(5, Math.max(1, Math.round(qualidade + (sortear() - 0.5) * 2)));
          notas.push({ sala, jogador_id: jogadorId, nota });
        }
      }

      await cliente.query(
        `INSERT INTO resultados (quiz_id, sala, jogador_id, apelido, pontos, posicao, usuario_id, terminado_em)
         SELECT $1, x.sala, x.jogador_id, x.apelido, x.pontos, x.posicao, x.usuario_id,
                CASE WHEN x.hoje
                     THEN date_trunc('day', now()) + (now() - date_trunc('day', now())) * x.fracao
                     ELSE now() - make_interval(days => 1 + floor(x.fracao * 59)::int)
                END
           FROM jsonb_to_recordset($2::jsonb)
             AS x(sala text, jogador_id text, apelido text, pontos int,
                  posicao int, usuario_id int, hoje bool, fracao float8)`,
        [quizId, JSON.stringify(resultados)]
      );

      if (notas.length > 0) {
        await cliente.query(
          `INSERT INTO avaliacoes (quiz_id, sala, jogador_id, nota)
           SELECT $1, x.sala, x.jogador_id, x.nota
             FROM jsonb_to_recordset($2::jsonb) AS x(sala text, jogador_id text, nota int)`,
          [quizId, JSON.stringify(notas)]
        );
      }
    }

    await cliente.query("COMMIT");

    console.log(`Removidos ${removidos} quiz(zes) sem pergunta.`);
    console.log(`Criados ${CATALOGO.length} quizzes na conta ${EMAIL} (senha: ${SENHA}).`);
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}

semear()
  .catch((erro) => {
    console.error("Falhou:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
