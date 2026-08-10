FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    python3 \
    make \
    g++ \
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
    && chmod +x /app/docker-entrypoint.sh

EXPOSE 4000

CMD ["/app/docker-entrypoint.sh"]
