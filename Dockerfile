FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    python3 \
    make \
    g++ \
    gosu \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci

COPY . .

ENV NODE_ENV=production

RUN mkdir -p /app/data /app/.wwebjs_auth /app/.wwebjs_cache \
    && chmod +x /app/docker-entrypoint.sh \
    && chown -R node:node /app

EXPOSE 4000

# segue rodando como root (usuário padrão da imagem) porque o entrypoint precisa dele pra
# ajustar a dono do volume persistente do Fly antes de derrubar privilégio pro usuário "node"
# (ver docker-entrypoint.sh) — não roda o bot/painel de fato como root
CMD ["/app/docker-entrypoint.sh"]
