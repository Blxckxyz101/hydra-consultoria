#!/bin/sh
# Lelouch Britannia — Production Startup
# O API Server detecta REPLIT_DEPLOYMENT=1 e lança Discord Bot + Telegram Bot
# automaticamente com auto-restart. Não iniciamos aqui para evitar duplicatas.
echo "[STARTUP] Iniciando API Server (gerencia Discord + Telegram internamente)..."
exec node \
  --enable-source-maps \
  --max-old-space-size=768 \
  --max-http-header-size=16384 \
  artifacts/api-server/dist/index.mjs
