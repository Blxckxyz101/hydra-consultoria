#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  Lelouch Britannia — Setup automático para VM (Ubuntu 22.04 / Debian 12)
#  Uso: bash setup.sh
#  Faz: Node.js 20, pnpm, PM2, build de todos os serviços, autostart
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"
ENV_FILE="$REPO_DIR/.env"
ENV_EXAMPLE="$REPO_DIR/deploy/.env.example"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
err()  { echo -e "${RED}✖ $*${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}▶ $*${NC}"; }

# ── 1. Verificar root ─────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  err "Execute como root: sudo bash deploy/setup.sh"
fi

# ── 2. Dependências do sistema ────────────────────────────────────────────────
step "Instalando dependências do sistema..."
apt-get update -qq
apt-get install -y -qq curl wget git build-essential nginx
ok "Dependências instaladas"

# ── 3. Node.js 20 via NodeSource ──────────────────────────────────────────────
step "Instalando Node.js 20..."
if command -v node &>/dev/null && [[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 20 ]]; then
  ok "Node.js já instalado: $(node --version)"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  ok "Node.js instalado: $(node --version)"
fi

# ── 4. pnpm ───────────────────────────────────────────────────────────────────
step "Instalando pnpm..."
npm install -g pnpm@latest --silent
ok "pnpm: $(pnpm --version)"

# ── 5. PM2 ────────────────────────────────────────────────────────────────────
step "Instalando PM2..."
npm install -g pm2@latest serve --silent
ok "PM2: $(pm2 --version)"

# ── 6. Diretórios ─────────────────────────────────────────────────────────────
step "Criando diretórios necessários..."
mkdir -p "$LOG_DIR"
mkdir -p "$REPO_DIR/artifacts/api-server/data"
ok "Diretórios prontos"

# ── 7. Variáveis de ambiente ──────────────────────────────────────────────────
step "Verificando .env..."
if [[ ! -f "$ENV_FILE" ]]; then
  warn ".env não encontrado — copiando exemplo"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  warn "ATENÇÃO: Edite $ENV_FILE com seus tokens antes de continuar!"
  echo ""
  echo "  nano $ENV_FILE"
  echo ""
  read -rp "Pressione ENTER após editar o .env, ou Ctrl+C para cancelar..."
fi
ok ".env presente"

# Exportar variáveis para o build
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── 8. Instalar dependências do monorepo ──────────────────────────────────────
step "Instalando dependências (pnpm install)..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile 2>&1 | tail -5
ok "Dependências instaladas"

# ── 9. Build de todos os pacotes ─────────────────────────────────────────────
step "Compilando API Server..."
pnpm --filter @workspace/api-server run build
ok "API Server compilado"

step "Compilando Telegram Bot..."
pnpm --filter @workspace/telegram-bot run build
ok "Telegram Bot compilado"

step "Compilando Discord Bot..."
pnpm --filter @workspace/discord-bot run build
ok "Discord Bot compilado"

step "Compilando painel (Vite build)..."
pnpm --filter @workspace/mikubeam-panel run build
ok "Painel compilado"

# ── 10. Iniciar com PM2 ───────────────────────────────────────────────────────
step "Iniciando todos os serviços com PM2..."
pm2 delete all 2>/dev/null || true
pm2 start "$REPO_DIR/pm2.config.cjs"
ok "Serviços iniciados"

# ── 12. PM2 save + startup (autostart no reboot) ─────────────────────────────
step "Configurando autostart no boot..."
pm2 save

STARTUP_CMD=$(pm2 startup systemd -u root --hp /root | grep "sudo " | tail -1)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
  ok "Autostart configurado (systemd)"
else
  warn "Não foi possível configurar autostart automaticamente. Execute manualmente: pm2 startup"
fi

# ── 13. Nginx ─────────────────────────────────────────────────────────────────
step "Configurando Nginx..."
cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/lelouch
ln -sf /etc/nginx/sites-available/lelouch /etc/nginx/sites-enabled/lelouch
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
ok "Nginx configurado e recarregado"

# ── 14. Firewall básico ───────────────────────────────────────────────────────
step "Configurando firewall (ufw)..."
if command -v ufw &>/dev/null; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "Firewall configurado (ssh + 80 + 443)"
else
  warn "ufw não encontrado — configure o firewall manualmente"
fi

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Setup concluído!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
pm2 list
echo ""
echo -e "  Painel:    ${YELLOW}http://$(hostname -I | awk '{print $1}')/${NC}"
echo -e "  API:       ${YELLOW}http://$(hostname -I | awk '{print $1}')/api/health${NC}"
echo ""
echo -e "  Comandos úteis:"
echo -e "    pm2 list              — status de todos os serviços"
echo -e "    pm2 logs api-server   — logs do API em tempo real"
echo -e "    pm2 logs telegram-bot — logs do bot Telegram"
echo -e "    pm2 restart all       — reiniciar tudo"
echo -e "    pm2 monit             — monitor em tempo real"
echo ""
echo -e "  Para atualizar depois:"
echo -e "    cd $REPO_DIR && git pull && bash deploy/setup.sh"
echo ""
