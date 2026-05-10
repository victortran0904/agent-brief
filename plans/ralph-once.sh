#!/usr/bin/env bash
set -eo pipefail

# Usage: ./plans/ralph-once.sh [claude|codex]
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/ralph.sh" 1 "${1:-}"
