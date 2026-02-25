#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/.ops/diagnostics-lab/tmp/contractCache.json"

CANDIDATES=()
if [[ -n "${HOME:-}" ]]; then
  CANDIDATES+=("$HOME/.emergent/contractCache.json")
fi
if [[ -n "${USER:-}" ]]; then
  CANDIDATES+=("/mnt/c/Users/$USER/.emergent/contractCache.json")
fi
if [[ -n "${USERNAME:-}" ]]; then
  CANDIDATES+=("/mnt/c/Users/$USERNAME/.emergent/contractCache.json")
fi

SOURCE=""
for CANDIDATE in "${CANDIDATES[@]}"; do
  if [[ -f "$CANDIDATE" ]]; then
    SOURCE="$CANDIDATE"
    break
  fi
done

if [[ -z "$SOURCE" ]]; then
  echo "No contract cache found in expected locations." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -f "$SOURCE" "$DEST"
echo "Copied cache:"
echo "  from: $SOURCE"
echo "  to:   $DEST"
