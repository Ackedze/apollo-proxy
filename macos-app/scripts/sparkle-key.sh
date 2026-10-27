#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="${SCRIPT_DIR}/../.build/artifacts/sparkle/Sparkle/bin/generate_keys"
ACCOUNT="${APOLLO_SPARKLE_KEY_ACCOUNT:-apollo-proxy}"
[[ -x "${TOOL}" ]] || { echo "Build the macOS app once to download the pinned Sparkle tools." >&2; exit 1; }
case "${1:-init}" in
  init) exec "${TOOL}" --account "${ACCOUNT}" ;;
  public) exec "${TOOL}" --account "${ACCOUNT}" -p ;;
  *) echo "Usage: sparkle-key.sh [init|public]" >&2; exit 1 ;;
esac
