#!/usr/bin/env bash
set -eo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG_FILE="$REPO_ROOT/.ralph/config.env"

if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

find_kit_home() {
  local candidates=()

  if [ -n "${RALPH_KIT_HOME:-}" ]; then
    candidates+=("$RALPH_KIT_HOME")
  fi

  candidates+=(
    "$REPO_ROOT/../ralph-kit"
    "$REPO_ROOT/../../ralph-kit"
    "$REPO_ROOT/../../Resources/ralph-kit"
    "$REPO_ROOT/../../../Resources/ralph-kit"
    "/Users/victortran/Coding/Resources/ralph-kit"
    "$HOME/.ralph-kit"
  )

  local path
  for path in "${candidates[@]}"; do
    if [ -x "$path/bin/ralph-loop.sh" ]; then
      printf '%s\n' "$path"
      return 0
    fi
  done

  return 1
}

KIT_HOME="$(find_kit_home || true)"

if [ -z "$KIT_HOME" ]; then
  echo "Could not find ralph-kit."
  echo "Set RALPH_KIT_HOME in $CONFIG_FILE or export RALPH_KIT_HOME."
  exit 1
fi

exec "$KIT_HOME/bin/ralph-loop.sh" "$@"
