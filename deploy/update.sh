#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Lelouch Britannia — Atualização rápida (após git pull)
#  Uso: bash deploy/update.sh
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
step() { echo -e "\n${YELLOW}▶ $*${NC}"; }

cd "$REPO_DIR"

step "Instalando dependências..."
pnpm install --frozen-lockfile 2>&1 | tail -3
ok "Dependências OK"

step "Compilando API Server..."
pnpm --filter @workspace/api-server run build
ok "API Server compilado"

step "Compilando Telegram Bot..."
pnpm --filter @workspace/telegram-bot run build
ok "Telegram Bot compilado"

step "Compilando Discord Bot..."
pnpm --filter @workspace/discord-bot run build
ok "Discord Bot compilado"

step "Compilando painel..."
pnpm --filter @workspace/mikubeam-panel run build
ok "Painel compilado"

step "Reiniciando serviços..."
pm2 restart all
ok "Serviços reiniciados"

echo ""
pm2 list
echo -e "\n${GREEN}✅ Atualização concluída!${NC}"
