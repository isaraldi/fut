#!/bin/bash

if [ -d /app/storage ]; then
  mkdir -p /app/storage/data /app/storage/.wwebjs_auth /app/storage/uploads || exit 1
  rm -rf /app/data /app/.wwebjs_auth
  ln -sfn /app/storage/data /app/data
  ln -sfn /app/storage/.wwebjs_auth /app/.wwebjs_auth
  # Migra uploads antigos sem sobrescrever arquivos já persistidos.
  # O caminho público continua o mesmo para preservar as URLs salvas no banco.
  if [ -d /app/panel/public/uploads ] && [ ! -L /app/panel/public/uploads ]; then
    cp -an /app/panel/public/uploads/. /app/storage/uploads/ || exit 1
    rm -rf /app/panel/public/uploads
  fi
  ln -sfn /app/storage/uploads /app/panel/public/uploads || exit 1
  # o volume do Docker é montado como dono root; ajusta pro usuário sem privilégios antes de
  # rodar o bot/painel de fato (evita rodar o Chromium/Node como root dentro do container)
  chown -R node:node /app/storage
fi

gosu node node index.js &
BOT_PID=$!

gosu node node panel/server.js &
PANEL_PID=$!

trap 'kill -TERM $BOT_PID $PANEL_PID 2>/dev/null' TERM INT

wait -n $BOT_PID $PANEL_PID
EXIT_CODE=$?

kill -TERM $BOT_PID $PANEL_PID 2>/dev/null
exit $EXIT_CODE
