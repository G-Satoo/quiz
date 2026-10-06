# Quiz

Quiz multiplayer ao vivo. O apresentador abre uma sala, as pessoas
entram pelo celular com um código, e as perguntas aparecem para
todo mundo ao mesmo tempo — com cronômetro e placar atualizando em
tempo real.

`Node 22` · `React 18` · `PostgreSQL 16` · `Redis 7` · `WebSocket` · `Docker Compose`

> **Em construção.** A fase 1 (contas, quizzes e perguntas) está
> pronta e testada. As partidas ao vivo são a fase 2 — veja o
> roteiro no fim deste arquivo.

## O que é

Um projeto de estudo sobre **tempo real**: conexão que fica aberta
e empurra dados para a tela sem o navegador pedir.

O quiz foi escolhido porque, nele, o tempo real não é enfeite. Num
quadro de tarefas dá para atualizar a tela de 5 em 5 segundos e
quase ninguém nota. Numa partida, não: se o cronômetro de um
jogador estiver 2 segundos adiantado, o jogo está quebrado. Isso
obriga a resolver as perguntas difíceis de verdade —
quem é dono do tempo, o que acontece com quem cai e volta, e como
mandar a mesma coisa para 50 pessoas ao mesmo tempo.

## Como rodar

Precisa de Node 22+ e Docker.

```bash
docker compose up -d          # Postgres, Redis e Adminer
cd api
cp .env.example .env
npm install
npm run migrar                # cria as tabelas
npm run semear                # um quiz de exemplo (opcional)
npm run dev                   # API em :3003
```

Se rodou o `semear`, a conta de demonstração é **demo@quiz.dev** /
**demo12345**.

As portas fogem do padrão de propósito, para este projeto e o
[atalho](https://github.com/G-Satoo/atalho) rodarem ao mesmo tempo:
Postgres em 5437, Redis em 6382, API em 3003, Adminer em 8082.

## Decisões

**Jogador não tem conta.** Conta é só de quem cria e apresenta.
Quem joga entra com um código e um apelido. Exigir cadastro para
jogar mataria o produto — ninguém cria conta no meio de uma
apresentação.

**Perguntas em tabelas, não em JSONB.** Daria para guardar as
perguntas como JSON dentro do quiz, com menos tabelas e menos
JOIN. Mas aí o banco deixaria de conseguir responder "qual
alternativa foi mais escolhida nas partidas?" e de impedir uma
pergunta sem resposta certa. JSONB serve bem para o que você só lê
inteiro; aqui vamos consultar por dentro o tempo todo.

**Uma alternativa correta por pergunta, garantido pelo banco.** Um
índice único *parcial* — `UNIQUE (pergunta_id) WHERE correta` —
vale só para as linhas marcadas como certas. A aplicação também
valida, com mensagem em português, mas a garantia final é do banco:
validação na aplicação não protege contra um bug futuro nem contra
quem insere dado na mão.

**Salvar as perguntas é uma transação.** O editor manda o conjunto
inteiro de uma vez (`PUT /api/quizzes/:id/perguntas`), e a rota
apaga tudo e reinsere dentro de `BEGIN`/`COMMIT`. Sem isso, um erro
na décima pergunta deixaria o quiz com as nove primeiras e o resto
perdido — pior do que ter falhado inteiro.

**Estado da partida no Redis, resultado no Postgres.** Durante o
jogo o estado muda a cada segundo e some quando acaba; gravar isso
em disco seria desperdício. O que merece o Postgres é o resultado
final.

## Testes

```bash
cd api
npm test                 # unidade, não precisa de banco

docker compose --profile teste up -d db-teste redis-teste
npm run test:integracao  # contra Postgres e Redis de verdade
```

Os de integração sobem o Express numa porta aleatória e falam com
ele por HTTP, passando por middleware, cookie e SQL. O banco de
teste nasce vazio a cada restart e são os próprios testes que
aplicam as migrações — o que prova, toda execução, que elas rodam
do zero.

Há um arquivo dedicado (`tests/integracao/banco.test.js`) para as
garantias que o **banco** dá sozinho, falando SQL direto, sem
passar pela API: são as regras que continuam valendo mesmo que um
bug escape da validação.

## API

Tudo abaixo de `/api/quizzes` exige o cookie de sessão.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/usuarios` | Cria a conta e já deixa logado |
| `GET` | `/api/usuarios/eu` | Quem está logado |
| `POST` | `/api/sessoes` | Login |
| `DELETE` | `/api/sessoes` | Logout |
| `GET` | `/api/quizzes` | Lista os quizzes com a contagem de perguntas |
| `POST` | `/api/quizzes` | Cria um quiz vazio |
| `GET` | `/api/quizzes/:id` | O quiz inteiro, com perguntas e alternativas |
| `PATCH` | `/api/quizzes/:id` | Muda título e descrição |
| `DELETE` | `/api/quizzes/:id` | Apaga o quiz e tudo dele |
| `PUT` | `/api/quizzes/:id/perguntas` | Substitui todas as perguntas, numa transação |
| `GET` | `/health` | Estado da API, do banco e do Redis |

## Roteiro

| fase | o que entra | situação |
|---|---|---|
| 1 | contas, quizzes, perguntas, testes, CI | **pronta** |
| 2 | sala ao vivo, código de entrada, WebSocket, lista de quem entrou | a seguir |
| 3 | a partida: pergunta, cronômetro autoritativo, respostas, placar | |
| 4 | queda e reconexão, host que recarrega a página, pub/sub entre instâncias | |
| 5 | histórico, relatório pós-partida, painel completo e deploy | |

## Estrutura

```
api/
  db/
    migracoes/      001-usuarios.sql, 002-quizzes.sql
    migrar.js       runner com transação e lock
    pool.js
  src/
    rotas/          usuarios, sessoes, quizzes
    servicos/       senha, sessao
    middlewares/    autenticacao, limite (rate limit)
    util/           validacao
    server.js
  tests/            unidade + integracao
```
