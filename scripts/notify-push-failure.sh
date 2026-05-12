#!/bin/bash
# Sends a Telegram notification when the GitHub push fails.
# Usage: bash scripts/notify-push-failure.sh "<error_msg>" "<commit_sha>" "<branch>"

BOT_TOKEN="${INFINITY_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_NOTIFY_CHAT_ID:-@hydraconsultoria}"

if [ -z "$BOT_TOKEN" ]; then
  echo "[notify-push] INFINITY_BOT_TOKEN not set — skipping Telegram notification"
  exit 0
fi

ERROR_MSG="${1:-Erro desconhecido}"
COMMIT_SHA="${2:-desconhecido}"
BRANCH="${3:-main}"
SHORT_SHA="${COMMIT_SHA:0:8}"
TIMESTAMP=$(date -u "+%Y-%m-%d %H:%M:%S UTC")

MESSAGE=$(cat <<EOF
🚨 <b>Push para o GitHub falhou</b>

🔴 <b>Erro:</b> <code>${ERROR_MSG}</code>
🌿 <b>Branch:</b> <code>${BRANCH}</code>
📝 <b>Commit:</b> <code>${SHORT_SHA}</code>
🕐 <b>Horário:</b> ${TIMESTAMP}

Verifique o token <code>GH_TOKEN</code> e o status do repositório.
EOF
)

python3 - <<PYEOF
import urllib.request, json, sys

token = """${BOT_TOKEN}"""
chat_id = """${CHAT_ID}"""
text = """${MESSAGE}"""

payload = json.dumps({
    "chat_id": chat_id,
    "text": text,
    "parse_mode": "HTML",
}).encode("utf-8")

req = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/sendMessage",
    data=payload,
    headers={"Content-Type": "application/json"},
)

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
        if body.get("ok"):
            print("[notify-push] Telegram notification sent successfully.")
        else:
            print(f"[notify-push] Telegram API error: {body}", file=sys.stderr)
except Exception as e:
    print(f"[notify-push] Failed to send notification: {e}", file=sys.stderr)
PYEOF
