#!/bin/bash
set -e

if [ -z "$GH_TOKEN" ]; then
  echo "[push-github] GH_TOKEN not set — skipping push"
  exit 0
fi

REMOTE="https://hydra-bot:${GH_TOKEN}@github.com/Blxckxyz101/hydra-consultoria.git"

echo "[push-github] Fetching remote state..."
if ! git fetch "$REMOTE" main:refs/remotes/github-hydra/main 2>/dev/null; then
  echo "[push-github] WARNING: fetch failed — cannot verify remote state, aborting push"
  exit 1
fi

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse refs/remotes/github-hydra/main 2>/dev/null || echo "")

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "[push-github] Already up to date (${LOCAL_SHA:0:8}). Nothing to push."
  exit 0
fi

echo "[push-github] Pushing commit ${LOCAL_SHA:0:8} to GitHub (main)..."
git push "$REMOTE" HEAD:main --force-with-lease=refs/heads/main:"${REMOTE_SHA}"
echo "[push-github] Push complete."
