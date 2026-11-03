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
//      demonstração, cada um com 10 perguntas (o mínimo exigido).
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
      ["Qual é a capital do Japão?", ["Tóquio", "Osaka", "Quioto", "Hiroshima"]],
      ["Qual é a capital da Argentina?", ["Buenos Aires", "Córdoba", "Rosário", "Mendoza"]],
      ["Qual é a capital do Egito?", ["Cairo", "Alexandria", "Luxor", "Gizé"]],
      ["Qual é a capital da Coreia do Sul?", ["Seul", "Busan", "Incheon", "Pyongyang"]],
      ["Qual é a capital da Nova Zelândia?", ["Wellington", "Auckland", "Christchurch", "Queenstown"]],
      ["Qual é a capital da Suíça?", ["Berna", "Zurique", "Genebra", "Basileia"]],
      ["Qual é a capital do Marrocos?", ["Rabat", "Casablanca", "Marrakech", "Fez"]]
    ]
  },
  {
    titulo: "Culinária brasileira", categoria: "geral",
    descricao: "Pratos típicos de norte a sul do país.",
    perguntas: [
      ["Qual prato leva feijão-preto e carnes de porco?", ["Feijoada", "Moqueca", "Baião de dois", "Vatapá"]],
      ["O acarajé é típico de qual estado?", ["Bahia", "Pará", "Pernambuco", "Maranhão"]],
      ["O pão de queijo é típico de qual estado?", ["Minas Gerais", "Goiás", "São Paulo", "Paraná"]],
      ["De que é feita a tapioca?", ["Goma de mandioca", "Farinha de trigo", "Fubá de milho", "Farinha de arroz"]],
      ["O tacacá é típico de qual região?", ["Norte", "Sul", "Sudeste", "Centro-Oeste"]],
      ["O churrasco gaúcho é tradição de qual estado?", ["Rio Grande do Sul", "Santa Catarina", "Paraná", "Mato Grosso do Sul"]],
      ["O açaí vem de que tipo de planta?", ["Palmeira", "Cacto", "Arbusto rasteiro", "Trepadeira"]],
      ["Que bebida é destilada a partir da cana-de-açúcar?", ["Cachaça", "Tiquira", "Licor de jenipapo", "Quentão"]],
      ["Além do chocolate, qual é o ingrediente principal do brigadeiro?", ["Leite condensado", "Creme de leite", "Leite em pó", "Doce de leite"]],
      ["Que prato baiano leva peixe, dendê e leite de coco?", ["Moqueca baiana", "Feijão tropeiro", "Arroz carreteiro", "Barreado"]]
    ]
  },
  {
    titulo: "Reino animal", categoria: "geral",
    descricao: "Recordes e curiosidades da natureza.",
    perguntas: [
      ["Qual é o maior mamífero do planeta?", ["Baleia-azul", "Elefante-africano", "Cachalote", "Girafa"]],
      ["Qual é o animal terrestre mais rápido?", ["Guepardo", "Leão", "Antílope", "Cavalo"]],
      ["Quantas patas tem uma aranha?", ["8", "6", "10", "12"]],
      ["Qual destes mamíferos consegue voar?", ["Morcego", "Esquilo-voador", "Pinguim", "Avestruz"]],
      ["Qual é a maior ave do mundo?", ["Avestruz", "Condor", "Ema", "Albatroz"]],
      ["Quantos corações tem um polvo?", ["3", "1", "2", "8"]],
      ["Qual destes animais é um marsupial?", ["Canguru", "Preguiça", "Tatu", "Capivara"]],
      ["Qual é o maior roedor do mundo?", ["Capivara", "Castor", "Paca", "Porco-espinho"]],
      ["Como se chama o filhote do cavalo?", ["Potro", "Bezerro", "Leitão", "Cordeiro"]],
      ["Qual destes é um anfíbio?", ["Sapo", "Jacaré", "Tartaruga", "Lagarto"]]
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
      ["Em que vila Naruto nasceu?", ["Vila Oculta da Folha", "Vila Oculta da Areia", "Vila Oculta da Névoa", "Vila Oculta da Nuvem"]],
      ["Qual é o grande sonho de Naruto?", ["Tornar-se Hokage", "Vingar o próprio clã", "Ser o ninja mais rico", "Sair da vila"]],
      ["Que técnica de Naruto é uma esfera de chakra na palma da mão?", ["Rasengan", "Chidori", "Amaterasu", "Kamui"]],
      ["A que clã pertence Sasuke?", ["Uchiha", "Hyuga", "Nara", "Akimichi"]],
      ["Quem é a ninja médica do Time 7?", ["Sakura Haruno", "Hinata Hyuga", "Ino Yamanaka", "Tenten"]],
      ["Quem ensina o Rasengan a Naruto?", ["Jiraiya", "Kakashi Hatake", "Iruka Umino", "Hiruzen Sarutobi"]],
      ["Como se chama a organização de capas com nuvens vermelhas?", ["Akatsuki", "Anbu", "Raiz", "Otogakure"]]
    ]
  },
  {
    titulo: "One Piece", categoria: "anime",
    descricao: "A tripulação do Chapéu de Palha atrás do grande tesouro.",
    perguntas: [
      ["Qual é o sonho de Luffy?", ["Tornar-se o Rei dos Piratas", "Ser almirante da Marinha", "Achar o All Blue", "Desenhar o mapa do mundo"]],
      ["Qual Akuma no Mi Luffy comeu?", ["Gomu Gomu no Mi", "Mera Mera no Mi", "Bara Bara no Mi", "Hito Hito no Mi"]],
      ["Quem é o espadachim do bando?", ["Roronoa Zoro", "Sanji", "Usopp", "Brook"]],
      ["Qual foi o primeiro navio do bando?", ["Going Merry", "Thousand Sunny", "Red Force", "Moby Dick"]],
      ["Quem é o cozinheiro do bando?", ["Sanji", "Zoro", "Usopp", "Franky"]],
      ["Quem é a navegadora do bando?", ["Nami", "Nico Robin", "Vivi", "Boa Hancock"]],
      ["Qual é o segundo navio do bando?", ["Thousand Sunny", "Going Merry", "Oro Jackson", "Red Force"]],
      ["Quem é o médico do bando, uma rena?", ["Tony Tony Chopper", "Brook", "Franky", "Jinbe"]],
      ["Que pirata deu o chapéu de palha a Luffy?", ["Shanks", "Barba Branca", "Gol D. Roger", "Portgas D. Ace"]],
      ["Qual é o nome completo de Luffy?", ["Monkey D. Luffy", "Portgas D. Luffy", "Gol D. Luffy", "Roronoa Luffy"]]
    ]
  },
  {
    titulo: "Dragon Ball", categoria: "anime",
    descricao: "Saiyajins, esferas do dragão e muito ki.",
    perguntas: [
      ["De que planeta Goku é originário?", ["Vegeta", "Namekusei", "Terra", "Yardrat"]],
      ["Quantas esferas é preciso reunir para chamar o dragão?", ["7", "5", "9", "12"]],
      ["Como se chama o dragão das esferas da Terra?", ["Shenlong", "Porunga", "Kaioh", "Bills"]],
      ["Contra quem Goku vira Super Saiyajin pela primeira vez?", ["Freeza", "Cell", "Majin Boo", "Vegeta"]],
      ["Qual é o nome saiyajin de Goku?", ["Kakarotto", "Raditz", "Bardock", "Broly"]],
      ["Quem é o melhor amigo de infância de Goku?", ["Kuririn", "Yamcha", "Tenshinhan", "Chaozu"]],
      ["Quem é o primeiro grande mestre de artes marciais de Goku?", ["Mestre Kame", "Senhor Kaioh", "Bills", "Piccolo"]],
      ["Como se chama o primeiro filho de Goku?", ["Gohan", "Goten", "Trunks", "Pan"]],
      ["Que golpe Goku lança com as mãos juntas?", ["Kamehameha", "Final Flash", "Makankosappo", "Kienzan"]],
      ["Em que Goku voa quando criança?", ["Na Nuvem Voadora", "Num dragão", "Numa cápsula-avião", "Teletransporte"]]
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
      ["Que professor entrega o primeiro Pokémon em Kanto?", ["Professor Carvalho", "Professor Elm", "Professor Birch", "Professor Rowan"]],
      ["Como se chama a equipe de vilões que persegue Ash?", ["Equipe Rocket", "Equipe Magma", "Equipe Galáctica", "Equipe Aqua"]],
      ["Em que Pikachu evolui com a Pedra do Trovão?", ["Raichu", "Pichu", "Jolteon", "Electabuzz"]],
      ["Qual Pokémon foi criado em laboratório a partir do DNA de Mew?", ["Mewtwo", "Lugia", "Ditto", "Celebi"]],
      ["De que tipo é o Squirtle?", ["Água", "Gelo", "Planta", "Normal"]],
      ["Quantas insígnias são precisas para a Liga de Kanto?", ["8", "6", "10", "12"]],
      ["Qual é a evolução final do Charmander?", ["Charizard", "Charmeleon", "Dragonite", "Arcanine"]]
    ]
  },
  {
    titulo: "Minecraft", categoria: "games",
    descricao: "Blocos, creepers e o End.",
    perguntas: [
      ["De que bloco é feito o portal do Nether?", ["Obsidiana", "Pedra", "Diamante", "Ferro"]],
      ["Qual criatura verde explode perto do jogador?", ["Creeper", "Zumbi", "Enderman", "Esqueleto"]],
      ["Qual chefe vive no End?", ["Dragão do Ender", "Wither", "Guardião Ancião", "Warden"]],
      ["Que empresa comprou o Minecraft em 2014?", ["Microsoft", "Sony", "Nintendo", "Electronic Arts"]],
      ["Qual é a picareta mais fraca que consegue minerar diamante?", ["Ferro", "Pedra", "Madeira", "Ouro"]],
      ["O que machuca o Enderman?", ["Água", "Luz do sol", "Neve", "Areia"]],
      ["Que item se usa para domar um lobo?", ["Osso", "Peixe cru", "Trigo", "Cenoura"]],
      ["Quantos blocos de obsidiana, no mínimo, formam um portal do Nether?", ["10", "14", "8", "12"]],
      ["Qual é o nome do personagem padrão masculino?", ["Steve", "Alex", "Herobrine", "Notch"]],
      ["Quem criou o Minecraft?", ["Markus \"Notch\" Persson", "Gabe Newell", "Hideo Kojima", "Shigeru Miyamoto"]]
    ]
  },
  {
    titulo: "Super Mario", categoria: "games",
    descricao: "O encanador mais famoso dos videogames.",
    perguntas: [
      ["Qual é a profissão do Mario?", ["Encanador", "Carpinteiro", "Eletricista", "Pedreiro"]],
      ["Como se chama o irmão do Mario?", ["Luigi", "Wario", "Toad", "Yoshi"]],
      ["Quem é o principal vilão da série?", ["Bowser", "Wario", "Donkey Kong", "Waluigi"]],
      ["Em que jogo o Mario apareceu pela primeira vez, em 1981?", ["Donkey Kong", "Super Mario Bros.", "Mario Kart", "Mario Bros."]],
      ["Que princesa Mario costuma salvar?", ["Peach", "Daisy", "Zelda", "Rosalina"]],
      ["Qual dinossauro verde é companheiro de Mario?", ["Yoshi", "Birdo", "Rex", "Koopa"]],
      ["Que item faz Mario crescer?", ["Super Cogumelo", "Flor de Fogo", "Super Estrela", "Pena"]],
      ["Em que reino se passam as aventuras de Mario?", ["Reino dos Cogumelos", "Hyrule", "Dream Land", "Mobius"]],
      ["Quem criou o Mario?", ["Shigeru Miyamoto", "Hideo Kojima", "Satoshi Tajiri", "Masahiro Sakurai"]],
      ["Qual rival de Mario usa roupa amarela?", ["Wario", "Waluigi", "Bowser Jr.", "Toad"]]
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
      ["Quem escreveu os livros da série?", ["J.K. Rowling", "Stephen King", "J.R.R. Tolkien", "Rick Riordan"]],
      ["Quem é o diretor de Hogwarts nos primeiros livros?", ["Alvo Dumbledore", "Severo Snape", "Minerva McGonagall", "Horácio Slughorn"]],
      ["Como se chama o grande vilão da série?", ["Lord Voldemort", "Draco Malfoy", "Lúcio Malfoy", "Belatriz Lestrange"]],
      ["Quem são os melhores amigos de Harry?", ["Rony e Hermione", "Draco e Neville", "Fred e Jorge", "Luna e Gina"]],
      ["De que plataforma parte o trem para Hogwarts?", ["9¾", "7½", "10¾", "9½"]],
      ["Que feitiço desarma o oponente?", ["Expelliarmus", "Lumos", "Alohomora", "Wingardium Leviosa"]],
      ["Que formato tem a cicatriz na testa de Harry?", ["Raio", "Estrela", "Lua crescente", "Cruz"]]
    ]
  },
  {
    titulo: "Star Wars", categoria: "filmes",
    descricao: "Há muito tempo, numa galáxia muito, muito distante...",
    perguntas: [
      ["Quem é o pai de Luke Skywalker?", ["Darth Vader", "Obi-Wan Kenobi", "Han Solo", "Imperador Palpatine"]],
      ["Qual é a arma típica de um Jedi?", ["Sabre de luz", "Blaster", "Arco energético", "Lança de plasma"]],
      ["Quem é o dono da Millennium Falcon no filme de 1977?", ["Han Solo", "Luke Skywalker", "Leia Organa", "Obi-Wan Kenobi"]],
      ["Em que ano estreou o primeiro filme da saga?", ["1977", "1980", "1983", "1999"]],
      ["Qual mestre Jedi é pequeno e verde?", ["Yoda", "Mace Windu", "Qui-Gon Jinn", "Plo Koon"]],
      ["Como se chama o droide dourado?", ["C-3PO", "R2-D2", "BB-8", "K-2SO"]],
      ["De que planeta é Luke Skywalker?", ["Tatooine", "Naboo", "Hoth", "Endor"]],
      ["Como se chama a estação do Império capaz de destruir planetas?", ["Estrela da Morte", "Base Starkiller", "Destróier Estelar", "Executor"]],
      ["Quem criou Star Wars?", ["George Lucas", "Steven Spielberg", "James Cameron", "J.J. Abrams"]],
      ["Quem é a irmã gêmea de Luke?", ["Leia", "Padmé", "Rey", "Mon Mothma"]]
    ]
  },
  {
    titulo: "Universo Marvel", categoria: "filmes",
    descricao: "Vingadores, joias do infinito e muito mais.",
    perguntas: [
      ["Qual é a identidade do Homem de Ferro?", ["Tony Stark", "Steve Rogers", "Bruce Banner", "Peter Parker"]],
      ["Como se chama o martelo de Thor?", ["Mjölnir", "Gungnir", "Excalibur", "Rompe-Tormentas"]],
      ["Qual filme abriu o Universo Cinematográfico Marvel, em 2008?", ["Homem de Ferro", "O Incrível Hulk", "Capitão América", "Thor"]],
      ["De que país o Pantera Negra é rei?", ["Wakanda", "Latvéria", "Sokovia", "Genosha"]],
      ["Qual é a identidade do Capitão América?", ["Steve Rogers", "Bucky Barnes", "Sam Wilson", "Clint Barton"]],
      ["Que vilão estala os dedos com a Manopla do Infinito?", ["Thanos", "Loki", "Ultron", "Hela"]],
      ["Quantas Joias do Infinito existem?", ["6", "5", "7", "4"]],
      ["Quem é o irmão adotivo de Thor?", ["Loki", "Heimdall", "Odin", "Balder"]],
      ["Que herói se transforma quando fica com raiva?", ["Hulk", "Visão", "Homem-Formiga", "Doutor Estranho"]],
      ["De que metal é o escudo do Capitão América?", ["Vibranium", "Adamantium", "Uru", "Aço"]]
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
      ["Quem era o baterista da banda?", ["Ringo Starr", "John Lennon", "George Harrison", "Paul McCartney"]],
      ["Qual dupla assinava a maior parte das músicas?", ["Lennon e McCartney", "Harrison e Starr", "Lennon e Harrison", "McCartney e Starr"]],
      ["Em que ano a banda acabou?", ["1970", "1965", "1975", "1980"]],
      ["De que cor é o submarino da música famosa da banda?", ["Amarelo", "Azul", "Vermelho", "Verde"]],
      ["Em que programa de TV americano a banda se apresentou em 1964?", ["The Ed Sullivan Show", "The Tonight Show", "Saturday Night Live", "American Bandstand"]],
      ["Que Beatle foi assassinado em 1980?", ["John Lennon", "George Harrison", "Paul McCartney", "Ringo Starr"]],
      ["Qual destes é um álbum dos Beatles?", ["Sgt. Pepper's Lonely Hearts Club Band", "Thriller", "The Dark Side of the Moon", "Led Zeppelin IV"]]
    ]
  },
  {
    titulo: "MPB", categoria: "musica",
    descricao: "Bossa nova, Tropicália e os grandes da música brasileira.",
    perguntas: [
      ["Quem compôs \"Garota de Ipanema\"?", ["Tom Jobim e Vinicius de Moraes", "Caetano Veloso e Gilberto Gil", "Chico Buarque e Toquinho", "João Gilberto e Carlos Lyra"]],
      ["Que movimento Caetano e Gil lideraram no fim dos anos 1960?", ["Tropicália", "Bossa Nova", "Jovem Guarda", "Clube da Esquina"]],
      ["Que cantora ganhou o apelido de \"Pimentinha\"?", ["Elis Regina", "Gal Costa", "Maria Bethânia", "Nara Leão"]],
      ["Quem gravou o álbum \"Construção\", de 1971?", ["Chico Buarque", "Milton Nascimento", "Caetano Veloso", "Jorge Ben"]],
      ["Quem ficou conhecido como o Rei da Jovem Guarda?", ["Roberto Carlos", "Erasmo Carlos", "Ronnie Von", "Wanderley Cardoso"]],
      ["Que cantor fez a gravação de \"Chega de Saudade\" considerada o marco da bossa nova?", ["João Gilberto", "Tom Jobim", "Vinicius de Moraes", "Caetano Veloso"]],
      ["Milton Nascimento é ligado a qual movimento mineiro?", ["Clube da Esquina", "Tropicália", "Jovem Guarda", "Manguebeat"]],
      ["Quem compôs \"Aquarela do Brasil\"?", ["Ary Barroso", "Noel Rosa", "Pixinguinha", "Cartola"]],
      ["Gilberto Gil foi ministro de qual pasta?", ["Cultura", "Educação", "Turismo", "Meio Ambiente"]],
      ["Quem compôs \"Carinhoso\"?", ["Pixinguinha", "Cartola", "Noel Rosa", "Ary Barroso"]]
    ]
  },
  {
    titulo: "Rock nacional", categoria: "musica",
    descricao: "As bandas que marcaram os anos 80.",
    perguntas: [
      ["Quem era o vocalista da Legião Urbana?", ["Renato Russo", "Cazuza", "Herbert Vianna", "Dinho Ouro Preto"]],
      ["De que banda Cazuza foi vocalista?", ["Barão Vermelho", "Titãs", "Paralamas do Sucesso", "Capital Inicial"]],
      ["Quem é o vocalista dos Paralamas do Sucesso?", ["Herbert Vianna", "Nando Reis", "Frejat", "Lobão"]],
      ["Que festival teve a primeira edição no Rio, em 1985?", ["Rock in Rio", "Lollapalooza", "Hollywood Rock", "Monsters of Rock"]],
      ["De que cidade é a Legião Urbana?", ["Brasília", "Rio de Janeiro", "São Paulo", "Porto Alegre"]],
      ["Que banda gravou \"Sonífera Ilha\", em 1984?", ["Titãs", "Ultraje a Rigor", "Ira!", "Kid Abelha"]],
      ["De que banda Rogério Flausino é vocalista?", ["Jota Quest", "Skank", "Capital Inicial", "Charlie Brown Jr."]],
      ["Rita Lee começou a carreira em qual banda?", ["Os Mutantes", "Secos & Molhados", "Novos Baianos", "Blitz"]],
      ["De que banda Dinho Ouro Preto é vocalista?", ["Capital Inicial", "Legião Urbana", "Barão Vermelho", "Titãs"]],
      ["Que banda de Belo Horizonte tem Samuel Rosa na voz?", ["Skank", "Jota Quest", "Pato Fu", "Sepultura"]]
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
      ["Que país sediou a Copa de 2014?", ["Brasil", "Alemanha", "África do Sul", "Rússia"]],
      ["Em que ano o Brasil ganhou a primeira Copa?", ["1958", "1950", "1962", "1970"]],
      ["Que país sediou a primeira Copa, em 1930?", ["Uruguai", "Brasil", "Itália", "Argentina"]],
      ["Quem venceu a Copa de 2018?", ["França", "Croácia", "Bélgica", "Alemanha"]],
      ["Quem marcou os dois gols do Brasil na final de 2002?", ["Ronaldo", "Rivaldo", "Ronaldinho", "Roberto Carlos"]],
      ["Que país sediou a Copa de 2010?", ["África do Sul", "Alemanha", "Japão", "Brasil"]],
      ["Qual foi o placar de Alemanha x Brasil na semifinal de 2014?", ["7 a 1", "3 a 0", "5 a 2", "4 a 1"]]
    ]
  },
  {
    titulo: "Fórmula 1", categoria: "esportes",
    descricao: "Velocidade, pit stops e lendas das pistas.",
    perguntas: [
      ["Que brasileiro foi campeão mundial em 1988, 1990 e 1991?", ["Ayrton Senna", "Nelson Piquet", "Emerson Fittipaldi", "Rubens Barrichello"]],
      ["Em que autódromo de São Paulo é disputado o GP do Brasil?", ["Interlagos", "Monza", "Silverstone", "Suzuka"]],
      ["Que bandeira indica o fim da corrida?", ["Quadriculada", "Vermelha", "Amarela", "Azul"]],
      ["Quantos títulos mundiais Michael Schumacher conquistou?", ["7", "5", "6", "4"]],
      ["Que equipe tem o cavalo empinado como símbolo?", ["Ferrari", "McLaren", "Williams", "Mercedes"]],
      ["Qual piloto divide com Schumacher o recorde de 7 títulos?", ["Lewis Hamilton", "Sebastian Vettel", "Ayrton Senna", "Alain Prost"]],
      ["Quem foi o primeiro brasileiro campeão da Fórmula 1?", ["Emerson Fittipaldi", "Nelson Piquet", "Ayrton Senna", "Felipe Massa"]],
      ["Que GP é disputado nas ruas de Monte Carlo?", ["GP de Mônaco", "GP da França", "GP da Itália", "GP da Espanha"]],
      ["O que indica a bandeira amarela?", ["Perigo: proibido ultrapassar", "Fim da corrida", "Pista liberada", "Volta mais rápida"]],
      ["Quantos títulos mundiais Nelson Piquet conquistou?", ["3", "2", "4", "1"]]
    ]
  },
  {
    titulo: "NBA", categoria: "esportes",
    descricao: "O basquete da liga americana.",
    perguntas: [
      ["Em que time Michael Jordan conquistou seus seis títulos?", ["Chicago Bulls", "Los Angeles Lakers", "Boston Celtics", "Washington Wizards"]],
      ["Quantos pontos vale uma cesta feita de fora do arco?", ["3", "2", "4", "1"]],
      ["Kobe Bryant jogou a carreira inteira em qual time?", ["Los Angeles Lakers", "Chicago Bulls", "Miami Heat", "New York Knicks"]],
      ["Quantos jogadores de cada time ficam em quadra?", ["5", "6", "7", "4"]],
      ["Que jogador é chamado de \"King James\"?", ["LeBron James", "James Harden", "Michael Jordan", "Kevin Durant"]],
      ["Qual é a altura oficial do aro?", ["3,05 m", "2,85 m", "3,25 m", "3,50 m"]],
      ["Em quantos quartos se divide uma partida da NBA?", ["4", "2", "3", "5"]],
      ["Que brasileiro foi campeão da NBA pelo San Antonio Spurs em 2014?", ["Tiago Splitter", "Nenê", "Leandrinho", "Anderson Varejão"]],
      ["Stephen Curry é ídolo de qual time?", ["Golden State Warriors", "Los Angeles Lakers", "Boston Celtics", "Miami Heat"]],
      ["Quantos segundos o ataque tem para arremessar?", ["24", "30", "20", "35"]]
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
      ["Em que ano foi proclamada a República?", ["1889", "1888", "1891", "1822"]],
      ["Quem foi o último imperador do Brasil?", ["Dom Pedro II", "Dom Pedro I", "Dom João VI", "Dom Miguel"]],
      ["Em que ano a família real portuguesa chegou ao Brasil?", ["1808", "1822", "1789", "1815"]],
      ["Que princesa assinou a Lei Áurea?", ["Isabel", "Leopoldina", "Carlota Joaquina", "Maria I"]],
      ["Quem proclamou a República?", ["Deodoro da Fonseca", "Floriano Peixoto", "Benjamin Constant", "Rui Barbosa"]],
      ["Contra que país o Brasil lutou de 1864 a 1870, ao lado de Argentina e Uruguai?", ["Paraguai", "Bolívia", "Chile", "Peru"]],
      ["Às margens de que riacho Dom Pedro proclamou a independência?", ["Ipiranga", "Tietê", "Anhangabaú", "Pinheiros"]]
    ]
  },
  {
    titulo: "Segunda Guerra Mundial", categoria: "historia",
    descricao: "O conflito que mudou o século XX.",
    perguntas: [
      ["Em que ano começou a Segunda Guerra?", ["1939", "1914", "1941", "1945"]],
      ["Que ataque levou os Estados Unidos a entrar na guerra?", ["Pearl Harbor", "Dunquerque", "Stalingrado", "Midway"]],
      ["Como ficou conhecido o desembarque aliado na Normandia, em 6 de junho de 1944?", ["Dia D", "Blitzkrieg", "Operação Barbarossa", "Dia V"]],
      ["Que tropa o Brasil enviou para lutar na Itália?", ["Força Expedicionária Brasileira", "Legião Brasileira", "Guarda Nacional", "Brigada Tiradentes"]],
      ["Em que ano a Segunda Guerra terminou?", ["1945", "1944", "1946", "1939"]],
      ["Que país a Alemanha invadiu em 1º de setembro de 1939?", ["Polônia", "França", "Bélgica", "Áustria"]],
      ["Que cidades japonesas foram atingidas por bombas atômicas?", ["Hiroshima e Nagasaki", "Tóquio e Osaka", "Kyoto e Kobe", "Nagoya e Sapporo"]],
      ["Quem foi o primeiro-ministro britânico durante a maior parte da guerra?", ["Winston Churchill", "Neville Chamberlain", "Clement Attlee", "Anthony Eden"]],
      ["Como se chamava a aliança de Alemanha, Itália e Japão?", ["Eixo", "Aliados", "Tríplice Entente", "Pacto de Varsóvia"]],
      ["Em que batalha a União Soviética derrotou o exército alemão em 1943?", ["Stalingrado", "Normandia", "Midway", "Ardenas"]]
    ]
  },
  {
    titulo: "Egito Antigo", categoria: "historia",
    descricao: "Faraós, pirâmides e hieróglifos.",
    perguntas: [
      ["Que rio sustentou a civilização egípcia?", ["Nilo", "Tigre", "Eufrates", "Jordão"]],
      ["Como se chama a escrita do Egito Antigo?", ["Hieróglifos", "Cuneiforme", "Runas", "Ideogramas"]],
      ["Qual é a maior pirâmide de Gizé?", ["Quéops", "Quéfren", "Miquerinos", "Djoser"]],
      ["Que pedra permitiu decifrar os hieróglifos?", ["Pedra de Roseta", "Pedra Filosofal", "Pedra de Gizé", "Pedra de Tebas"]],
      ["Como eram chamados os reis do Egito Antigo?", ["Faraós", "Césares", "Czares", "Sultões"]],
      ["Que faraó teve a tumba encontrada quase intacta em 1922?", ["Tutancâmon", "Ramsés II", "Quéops", "Akhenaton"]],
      ["Que estátua com corpo de leão e cabeça humana fica em Gizé?", ["Esfinge", "Colosso", "Obelisco", "Quimera"]],
      ["Que rainha egípcia se relacionou com Júlio César e Marco Antônio?", ["Cleópatra", "Nefertiti", "Hatshepsut", "Nefertari"]],
      ["Como se chama o processo de preservar os corpos?", ["Mumificação", "Cremação", "Fossilização", "Embalsamamento a frio"]],
      ["Em que continente fica o Egito?", ["África", "Ásia", "Europa", "Oceania"]]
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
      ["Quantos planetas tem o Sistema Solar?", ["8", "9", "7", "10"]],
      ["Qual planeta tem os anéis mais visíveis?", ["Saturno", "Júpiter", "Urano", "Netuno"]],
      ["Qual é o planeta mais quente?", ["Vênus", "Mercúrio", "Marte", "Júpiter"]],
      ["Quanto tempo, aproximadamente, a luz do Sol leva para chegar à Terra?", ["8 minutos", "8 segundos", "1 hora", "1 dia"]],
      ["Como Plutão é classificado hoje?", ["Planeta anão", "Planeta", "Cometa", "Satélite"]],
      ["Qual planeta gira com o eixo quase deitado?", ["Urano", "Netuno", "Saturno", "Marte"]],
      ["Qual é o planeta mais distante do Sol?", ["Netuno", "Urano", "Saturno", "Plutão"]]
    ]
  },
  {
    titulo: "Corpo humano", categoria: "ciencia",
    descricao: "Ossos, órgãos e células.",
    perguntas: [
      ["Qual é o maior órgão do corpo humano?", ["Pele", "Fígado", "Pulmão", "Intestino"]],
      ["Quantos ossos tem o corpo de um adulto?", ["206", "180", "250", "300"]],
      ["Que célula do sangue transporta oxigênio?", ["Hemácia", "Leucócito", "Plaqueta", "Neurônio"]],
      ["Qual é o osso mais longo do corpo?", ["Fêmur", "Tíbia", "Úmero", "Rádio"]],
      ["Quantos dentes tem um adulto, contando os sisos?", ["32", "28", "30", "36"]],
      ["Que órgão produz a insulina?", ["Pâncreas", "Fígado", "Estômago", "Baço"]],
      ["Onde fica o menor osso do corpo?", ["Ouvido", "Mão", "Pé", "Nariz"]],
      ["Que tipo sanguíneo é o doador universal?", ["O−", "AB+", "A+", "B−"]],
      ["Quantas cavidades tem o coração humano?", ["4", "2", "3", "6"]],
      ["Que órgão filtra o sangue e produz a urina?", ["Rim", "Fígado", "Bexiga", "Pâncreas"]]
    ]
  },
  {
    titulo: "Química básica", categoria: "ciencia",
    descricao: "Elementos, símbolos e a tabela periódica.",
    perguntas: [
      ["Qual é o símbolo químico do ouro?", ["Au", "Ag", "Or", "Go"]],
      ["Que gás forma a maior parte do ar?", ["Nitrogênio", "Oxigênio", "Gás carbônico", "Argônio"]],
      ["Qual é o número atômico do hidrogênio?", ["1", "2", "0", "8"]],
      ["Quem organizou a primeira tabela periódica?", ["Dmitri Mendeleev", "Marie Curie", "Antoine Lavoisier", "Isaac Newton"]],
      ["Qual é a fórmula da água?", ["H₂O", "CO₂", "O₂", "H₂O₂"]],
      ["Qual é o símbolo químico do sódio?", ["Na", "So", "Sd", "S"]],
      ["Uma solução com pH 7 é:", ["Neutra", "Ácida", "Básica", "Salina"]],
      ["Qual é o elemento mais abundante do universo?", ["Hidrogênio", "Oxigênio", "Carbono", "Hélio"]],
      ["Qual é o símbolo químico do ferro?", ["Fe", "Fr", "F", "Ir"]],
      ["Que gás as plantas absorvem na fotossíntese?", ["Gás carbônico", "Oxigênio", "Nitrogênio", "Hidrogênio"]]
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
      ["Que método adiciona um item ao fim de um array?", ["push", "pop", "shift", "unshift"]],
      ["Quanto dá \"2\" + 2?", ["\"22\"", "4", "NaN", "Erro"]],
      ["Que operador compara sem converter os tipos?", ["===", "==", "=", "!="]],
      ["Que função transforma um texto JSON em objeto?", ["JSON.parse", "JSON.stringify", "JSON.toObject", "Object.fromJSON"]],
      ["Quanto vale typeof NaN?", ["\"number\"", "\"NaN\"", "\"undefined\"", "\"object\""]],
      ["Que palavra espera uma Promise dentro de uma função async?", ["await", "yield", "then", "defer"]],
      ["Que método cria um array novo transformando cada item?", ["map", "forEach", "filter", "reduce"]]
    ]
  },
  {
    titulo: "Como a internet funciona", categoria: "tecnologia",
    descricao: "HTTP, DNS e o que acontece quando você digita um endereço.",
    perguntas: [
      ["O que significa a sigla HTTP?", ["HyperText Transfer Protocol", "High Transfer Text Protocol", "HyperText Transmission Program", "Host Text Transfer Protocol"]],
      ["Que código HTTP significa \"não encontrado\"?", ["404", "500", "301", "200"]],
      ["Quem criou a World Wide Web?", ["Tim Berners-Lee", "Bill Gates", "Steve Jobs", "Linus Torvalds"]],
      ["Para que serve o DNS?", ["Traduzir nomes de domínio em endereços IP", "Criptografar a conexão", "Guardar cookies", "Comprimir páginas"]],
      ["Qual é a porta padrão do HTTPS?", ["443", "80", "21", "8080"]],
      ["O que o \"S\" de HTTPS indica?", ["Que a conexão é criptografada", "Que o site é rápido", "Que o site é do governo", "Que o servidor é simples"]],
      ["Que código HTTP indica erro interno do servidor?", ["500", "404", "403", "301"]],
      ["O que é um endereço IP?", ["O número que identifica um aparelho na rede", "A senha do wi-fi", "O nome de um site", "Um tipo de cabo"]],
      ["Que linguagem estrutura o conteúdo de uma página?", ["HTML", "CSS", "SQL", "Python"]],
      ["O que é um cookie?", ["Um pequeno dado que o site guarda no navegador", "Um vírus", "Um tipo de anúncio", "Uma cópia da página"]]
    ]
  },
  {
    titulo: "Git", categoria: "tecnologia",
    descricao: "Commits, branches e push.",
    perguntas: [
      ["Que comando grava as mudanças preparadas no histórico?", ["git commit", "git save", "git add", "git store"]],
      ["Que comando envia os commits para o repositório remoto?", ["git push", "git pull", "git send", "git upload"]],
      ["Quem criou o Git?", ["Linus Torvalds", "Guido van Rossum", "Brendan Eich", "Dennis Ritchie"]],
      ["Que comando mostra o que mudou e ainda não foi gravado?", ["git status", "git log", "git show", "git branch"]],
      ["Que comando cria uma cópia local de um repositório remoto?", ["git clone", "git copy", "git fork", "git init"]],
      ["Que comando traz as mudanças do remoto e as integra?", ["git pull", "git push", "git fetch --all", "git sync"]],
      ["Que comando prepara arquivos para o próximo commit?", ["git add", "git commit", "git stage-all", "git prepare"]],
      ["Que comando cria um branch novo e já muda para ele?", ["git switch -c", "git branch -m", "git merge", "git stash"]],
      ["Que comando mostra o histórico de commits?", ["git log", "git status", "git diff", "git history"]],
      ["Que comando guarda mudanças temporariamente sem fazer commit?", ["git stash", "git save", "git hold", "git reset"]]
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
      ["Qual é a grafia correta?", ["Exceção", "Excessão", "Esceção", "Execeção"]],
      ["Qual é o plural de \"pão\"?", ["Pães", "Pãos", "Pões", "Pãoes"]],
      ["Qual é o antônimo de \"generoso\"?", ["Avarento", "Bondoso", "Gentil", "Caridoso"]],
      ["Em \"Os alunos estudaram muito\", qual é o sujeito?", ["Os alunos", "Estudaram", "Muito", "Não há sujeito"]],
      ["Qual palavra está acentuada corretamente?", ["Café", "Juíz", "Ítem", "Rúim"]],
      ["Qual é o coletivo de lobos?", ["Alcateia", "Cardume", "Manada", "Enxame"]],
      ["Complete: \"Quero ___ café.\"", ["mais", "mas", "más", "maz"]]
    ]
  },
  {
    titulo: "Matemática básica", categoria: "educacao",
    descricao: "Contas rápidas para aquecer o cérebro.",
    perguntas: [
      ["Quanto é 7 × 8?", ["56", "54", "63", "48"]],
      ["Qual é a raiz quadrada de 144?", ["12", "14", "11", "16"]],
      ["Quanto somam os ângulos internos de um triângulo?", ["180°", "360°", "90°", "270°"]],
      ["Quanto é 25% de 200?", ["50", "25", "40", "75"]],
      ["Quanto é 15 × 4?", ["60", "45", "64", "54"]],
      ["Quanto é 2³?", ["8", "6", "9", "16"]],
      ["Qual é o primeiro número primo depois de 7?", ["11", "9", "13", "10"]],
      ["Quanto é 1/2 + 1/4?", ["3/4", "2/6", "1/6", "2/4"]],
      ["Quantos lados tem um hexágono?", ["6", "5", "7", "8"]],
      ["Quanto é 100 ÷ 8?", ["12,5", "12", "13,5", "11,5"]]
    ]
  },
  {
    titulo: "Geografia do Brasil", categoria: "educacao",
    descricao: "Estados, capitais e biomas.",
    perguntas: [
      ["Qual é o maior estado do Brasil em área?", ["Amazonas", "Pará", "Mato Grosso", "Minas Gerais"]],
      ["Quantos estados tem o Brasil, sem contar o Distrito Federal?", ["26", "27", "25", "24"]],
      ["Qual é a capital da Bahia?", ["Salvador", "Feira de Santana", "Ilhéus", "Porto Seguro"]],
      ["Qual é o maior bioma brasileiro?", ["Amazônia", "Cerrado", "Mata Atlântica", "Caatinga"]],
      ["Qual é a capital do Amazonas?", ["Manaus", "Belém", "Porto Velho", "Boa Vista"]],
      ["Qual é o maior rio totalmente brasileiro?", ["São Francisco", "Amazonas", "Paraná", "Tocantins"]],
      ["Qual é o ponto mais alto do Brasil?", ["Pico da Neblina", "Pico da Bandeira", "Monte Roraima", "Pedra da Mina"]],
      ["Quantas regiões oficiais o Brasil tem?", ["5", "4", "6", "7"]],
      ["Qual estado tem a maior população?", ["São Paulo", "Minas Gerais", "Rio de Janeiro", "Bahia"]],
      ["Qual é a capital de Santa Catarina?", ["Florianópolis", "Joinville", "Blumenau", "Chapecó"]]
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
        const acertos = entre(2, 10);

        resultados.push({
          sala,
          jogador_id: jogadorId,
          apelido: APELIDOS[quem],
          // Dois em cada dez jogam sem conta: jogam, mas ficam
          // fora do ranking — como acontece de verdade.
          usuario_id: sortear() < 0.8 ? contas[quem] : null,
          // 10 perguntas valem no máximo 10.000: 500 por acerto
          // mais até 500 de velocidade. Ninguém acerta tudo no
          // primeiro segundo, então o bônus sorteado fica abaixo.
          pontos: acertos * 500 + entre(0, acertos * 380),
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
