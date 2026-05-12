#!/bin/bash

NOTIFY_SCRIPT="$(dirname "$0")/notify-push-failure.sh"
BRANCH="main"
LOCAL_SHA=""

notify_failure() {
  local msg="$1"
  echo "[push-github] ERROR: $msg"
  bash "$NOTIFY_SCRIPT" "$msg" "${LOCAL_SHA:-desconhecido}" "$BRANCH" || true
}

if [ -z "${GH_TOKEN:-}" ]; then
  echo "[push-github] GH_TOKEN not set — skipping push"
  exit 0
fi

REMOTE="https://hydra-bot:${GH_TOKEN}@github.com/Blxckxyz101/hydra-consultoria.git"

LOCAL_SHA=$(git rev-parse HEAD)

echo "[push-github] Pushing commit ${LOCAL_SHA:0:8} to GitHub (main)..."
PUSH_ERR=$(git push "$REMOTE" HEAD:main --force 2>&1 | grep -v "hydra-bot" || true)
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  notify_failure "git push falhou para o commit ${LOCAL_SHA:0:8}. Detalhe: ${PUSH_ERR}"
  exit 1
fi

echo "[push-github] Push complete."
