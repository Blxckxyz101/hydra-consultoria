#!/bin/sh
# Lelouch Britannia — Production Startup
# Starts all three services: API Server, Discord Bot, Telegram Bot

echo "[STARTUP] Building Discord Bot..."
node artifacts/discord-bot/dist/index.mjs &
DISCORD_PID=$!
echo "[STARTUP] Discord Bot started (PID $DISCORD_PID)"

echo "[STARTUP] Starting Telegram Bot..."
node --max-old-space-size=256 artifacts/telegram-bot/dist/index.mjs &
TELEGRAM_PID=$!
echo "[STARTUP] Telegram Bot started (PID $TELEGRAM_PID)"

# Trap SIGTERM/SIGINT to cleanly stop all children
trap 'echo "[SHUTDOWN] Stopping all services..."; kill $DISCORD_PID $TELEGRAM_PID 2>/dev/null; exit 0' TERM INT

echo "[STARTUP] Starting API Server (foreground)..."
exec node --enable-source-maps --max-old-space-size=768 --max-http-header-size=16384 artifacts/api-server/dist/index.mjs
