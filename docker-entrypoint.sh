#!/bin/bash

if [ -d /app/storage ]; then
  mkdir -p /app/storage/data /app/storage/.wwebjs_auth
  rm -rf /app/data /app/.wwebjs_auth
  ln -sfn /app/storage/data /app/data
  ln -sfn /app/storage/.wwebjs_auth /app/.wwebjs_auth
fi

node index.js &
BOT_PID=$!

node panel/server.js &
PANEL_PID=$!

trap 'kill -TERM $BOT_PID $PANEL_PID 2>/dev/null' TERM INT

wait -n $BOT_PID $PANEL_PID
EXIT_CODE=$?

kill -TERM $BOT_PID $PANEL_PID 2>/dev/null
exit $EXIT_CODE
