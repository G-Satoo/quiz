# ============================================================
# Imagem de produção: a API e as telas, num serviço só.
#
# As telas (web/) são servidas pela própria API, então um contêiner
# basta — e o WebSocket fica na mesma origem das páginas.
#
#   docker build -t quiz .
#   docker run -p 3003:3003 --env-file api/.env quiz
# ============================================================

FROM node:22-alpine

WORKDIR /app/api

# Primeiro só os manifestos: enquanto as dependências não mudarem,
# esta camada sai do cache e o build não reinstala nada.
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

COPY api/db ./db
COPY api/src ./src
COPY api/scripts ./scripts
COPY web /app/web

# Processo sem privilégios: o usuário "node" já vem na imagem.
USER node

ENV NODE_ENV=production PORT=3003
EXPOSE 3003

# Migra e sobe. As migrações são idempotentes (só aplicam o que
# falta), então rodar a cada início é seguro e dispensa um passo
# manual no deploy.
CMD ["sh", "-c", "node db/migrar.js && node src/server.js"]
