#!/bin/bash
set -e
pnpm install --frozen-lockfile
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
pnpm --filter db push
bash scripts/push-github.sh
