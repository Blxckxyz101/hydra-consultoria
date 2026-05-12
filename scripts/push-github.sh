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

# Escape the token so it is safe to use as a sed literal pattern.
# This handles any character that is special in sed BRE or that conflicts
# with our chosen "|" delimiter (e.g. backslash, pipe, brackets, dot, etc.).
SAFE_TOKEN=$(printf '%s' "$GH_TOKEN" | sed 's/[]\[\\^$.*|]/\\&/g')

# Redact any accidental credential leakage in a captured git output string.
# Usage: redact_token "$raw_output"
redact_token() { printf '%s' "$1" | sed "s|${SAFE_TOKEN}|***|g"; }

# Use a credential-only URL (no token embedded) so git never echoes the
# secret in error messages or reflog output.
REMOTE="https://hydra-bot@github.com/Blxckxyz101/hydra-consultoria.git"

# Provide the token via GIT_ASKPASS — a helper script that git spawns
# privately to read the password. The token never appears in the remote URL.
ASKPASS_FILE=$(mktemp /tmp/gh-askpass-XXXXXX)
chmod 700 "$ASKPASS_FILE"
# The helper receives the prompt string as $1 and must print the credential.
printf '#!/bin/sh\nprintf "%%s" "%s"\n' "$GH_TOKEN" > "$ASKPASS_FILE"
# Always remove the helper on exit, even on error.
trap 'rm -f "$ASKPASS_FILE"' EXIT

# Fetch remote state before attempting the push (required for --force-with-lease).
echo "[push-github] Fetching remote state..."
FETCH_OUT=$(GIT_ASKPASS="$ASKPASS_FILE" git fetch "$REMOTE" "refs/heads/main:refs/remotes/github/main" 2>&1) || {
  FETCH_ERR=$(redact_token "$FETCH_OUT")
  notify_failure "git fetch falhou. Detalhe: ${FETCH_ERR}"
  exit 1
}

LOCAL_SHA=$(git rev-parse HEAD)

echo "[push-github] Pushing commit ${LOCAL_SHA:0:8} to GitHub (main)..."
PUSH_OUT=$(GIT_ASKPASS="$ASKPASS_FILE" \
  git push "$REMOTE" HEAD:main --force-with-lease="refs/heads/main:refs/remotes/github/main" 2>&1) || {
  # Redact any residual token that might appear in unexpected git output.
  PUSH_ERR=$(redact_token "$PUSH_OUT")
  notify_failure "git push falhou para o commit ${LOCAL_SHA:0:8}. Detalhe: ${PUSH_ERR}"
  exit 1
}

echo "[push-github] Push complete."
