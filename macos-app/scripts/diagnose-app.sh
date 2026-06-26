#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_NAME="ApolloProxyControl"
APP_BUNDLE="${1:-${APP_ROOT}/dist/${APP_NAME}.app}"
ARCHIVE_PATH="${2:-${APP_ROOT}/dist/${APP_NAME}-macOS.zip}"
LAUNCHER="${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
NODE="${APP_BUNDLE}/Contents/Resources/runtime/bin/node"

run_step() {
  local title="$1"
  local status
  shift
  printf '\n== %s ==\n' "${title}"
  "$@"
  status=$?
  if [[ "${status}" -eq 0 ]]; then
    return 0
  fi
  printf 'FAILED (%s): %s\n' "${status}" "$*" >&2
  return 0
}

printf 'App: %s\n' "${APP_BUNDLE}"
printf 'Archive: %s\n' "${ARCHIVE_PATH}"

if [[ ! -d "${APP_BUNDLE}" ]]; then
  echo "App bundle does not exist." >&2
  exit 1
fi

run_step "bundle files" sh -c "find '$APP_BUNDLE' -maxdepth 4 -type f | sort | sed -n '1,120p'"
run_step "launcher architecture" file "${LAUNCHER}"
run_step "node architecture" file "${NODE}"
run_step "launcher macOS version" sh -c "otool -l '$LAUNCHER' | rg -A5 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'"
run_step "node macOS version" sh -c "otool -l '$NODE' | rg -A5 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'"
run_step "launcher libraries" otool -L "${LAUNCHER}"
run_step "node libraries" otool -L "${NODE}"
run_step "codesign verify" codesign --verify --deep --strict --verbose=4 "${APP_BUNDLE}"
run_step "codesign details" sh -c "codesign -dv --verbose=4 '$APP_BUNDLE' 2>&1"
run_step "gatekeeper assessment" spctl --assess --type execute --verbose=4 "${APP_BUNDLE}"
run_step "extended attributes" sh -c "xattr -lr '$APP_BUNDLE' | rg -v '/embedded-proxy/node_modules/' | sed -n '1,120p'"

if [[ -f "${ARCHIVE_PATH}" ]]; then
  run_step "archive listing" sh -c "unzip -l '$ARCHIVE_PATH' | sed -n '1,80p'"
else
  printf '\nArchive does not exist: %s\n' "${ARCHIVE_PATH}" >&2
fi
