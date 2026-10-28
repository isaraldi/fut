#!/bin/bash

if [ -d /app/storage ]; then
  mkdir -p /app/storage/data /app/storage/.wwebjs_auth /app/storage/uploads /app/public || exit 1
  rm -rf /app/data /app/.wwebjs_auth
  ln -sfn /app/storage/data /app/data
  ln -sfn /app/storage/.wwebjs_auth /app/.wwebjs_auth
  # Aceita uploads da estrutura anterior e da atual sem sobrescrever os persistidos.
  # A URL /uploads continua igual para preservar as referências salvas no banco.
  for uploads_dir in /app/panel/public/uploads /app/public/uploads; do
    if [ -d "$uploads_dir" ] && [ ! -L "$uploads_dir" ]; then
      cp -an "$uploads_dir"/. /app/storage/uploads/ || exit 1
      rm -rf "$uploads_dir"
    fi
  done
  ln -sfn /app/storage/uploads /app/public/uploads || exit 1
  # o volume do Docker é montado como dono root; ajusta pro usuário sem privilégios antes de
  # rodar o bot/painel de fato (evita rodar o Chromium/Node como root dentro do container)
  chown -R node:node /app/storage
fi

gosu node node src/bot.js &
BOT_PID=$!

gosu node node src/server.js &
PANEL_PID=$!

trap 'kill -TERM $BOT_PID $PANEL_PID 2>/dev/null' TERM INT

wait -n $BOT_PID $PANEL_PID
EXIT_CODE=$?

kill -TERM $BOT_PID $PANEL_PID 2>/dev/null
exit $EXIT_CODE
