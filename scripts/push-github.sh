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
# Capture output AND exit code correctly.
# Note: var=$(cmd) — $? after assignment reflects cmd's exit code in bash.
# Using `if !` avoids the PIPESTATUS-after-subshell trap.
PUSH_OUT=$(git push "$REMOTE" HEAD:main --force 2>&1) || {
  PUSH_ERR=$(echo "$PUSH_OUT" | grep -v "hydra-bot")
  notify_failure "git push falhou para o commit ${LOCAL_SHA:0:8}. Detalhe: ${PUSH_ERR}"
  exit 1
}

echo "[push-github] Push complete."
