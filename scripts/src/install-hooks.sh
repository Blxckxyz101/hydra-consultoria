#!/usr/bin/env bash
# Configura o git para usar os hooks do diretório .githooks/
# Execute uma vez após clonar o repositório: bash scripts/src/install-hooks.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

git -C "$REPO_ROOT" config core.hooksPath .githooks
chmod +x "$REPO_ROOT/.githooks/pre-commit"

echo "Git hooks instalados. O pre-commit irá bloquear commits com credenciais."
