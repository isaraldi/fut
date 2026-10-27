#!/bin/sh
set -eu

raiz=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
porta=${PORT_LOCAL:-4001}

if [ ! -f "$raiz/.env" ]; then
    echo 'Crie o .env com ADMIN_USER, ADMIN_PASSWORD e SESSION_SECRET antes de iniciar.' >&2
    exit 1
fi

# Usa as dependências da imagem existente e o código atual do repositório.
# O volume é exclusivo do painel local; não inicia o bot nem monta fut_data.
docker run --rm -d \
    --name fut-painel-local \
    --publish "127.0.0.1:$porta:4000" \
    --env-file "$raiz/.env" \
    --env NODE_ENV=development \
    --env PORT=4000 \
    --mount "type=bind,src=$raiz,dst=/source,readonly" \
    --mount type=volume,src=fut_dev_data,dst=/app/data \
    --entrypoint /bin/sh \
    fut-bot:latest -c '
        cp /source/db.js /source/mensagens-prontas.js /app/
        cp -R /source/panel/. /app/panel/
        chown -R node:node /app/data
        exec gosu node node panel/server.js
    '

echo "Painel local: http://localhost:$porta/login"
echo 'Para encerrar: docker stop fut-painel-local'
