#!/bin/bash
set -e

if [ -z "$GH_TOKEN" ]; then
  echo "[push-github] GH_TOKEN not set — skipping push"
  exit 0
fi

REMOTE="https://hydra-bot:${GH_TOKEN}@github.com/Blxckxyz101/hydra-consultoria.git"
LOCAL_SHA=$(git rev-parse HEAD)

echo "[push-github] Pushing commit ${LOCAL_SHA:0:8} to GitHub (main)..."
git push "$REMOTE" HEAD:main --force 2>&1 | grep -v "hydra-bot" || true
echo "[push-github] Push complete."
