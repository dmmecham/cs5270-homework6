FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown node:node /app

COPY --chown=node:node index.ts widgetRequest-schema.json ./
COPY --chown=node:node lib ./lib

USER node
ENTRYPOINT ["node", "index.ts"]
