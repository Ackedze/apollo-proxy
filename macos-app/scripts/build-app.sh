#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROXY_ROOT="$(cd "${APP_ROOT}/.." && pwd)"
REPOSITORY_ROOT="$(cd "${PROXY_ROOT}/../.." && pwd)"
DS_AI_HUB_SOURCE="${DS_AI_HUB_ROOT:-${REPOSITORY_ROOT}/ds-ai-hub}"
DESIGN_SYSTEM_SOURCE="${DESIGN_SYSTEM_AB_ROOT:-${REPOSITORY_ROOT}/shared/design-system_ab}"

APP_NAME="ApolloProxyControl"
BUNDLE_ID="com.redpol.apollo-proxy-control"
DIST_DIR="${APP_ROOT}/dist"
APP_BUNDLE="${DIST_DIR}/${APP_NAME}.app"
ARCHIVE_PATH="${DIST_DIR}/${APP_NAME}-macOS.zip"
ARM64_BUILD_DIR="${APP_ROOT}/.build/arm64-apple-macosx/release"
X86_64_BUILD_DIR="${APP_ROOT}/.build/x86_64-apple-macosx/release"
ARM64_EXECUTABLE="${ARM64_BUILD_DIR}/${APP_NAME}"
X86_64_EXECUTABLE="${X86_64_BUILD_DIR}/${APP_NAME}"
UNIVERSAL_EXECUTABLE="${DIST_DIR}/${APP_NAME}-universal"
NODE_EXECUTABLE="$(command -v node || true)"
PROXY_VERSION="$(node -p "require('${PROXY_ROOT}/package.json').version")"
BUILD_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-}"
REQUIRE_NOTARIZATION="${REQUIRE_NOTARIZATION:-0}"
EMBED_PROXY_ENV="${EMBED_PROXY_ENV:-0}"
SOURCE_APP_BUNDLE="${APP_ROOT}/Sources/ApolloProxyControl/${APP_NAME}.app"

if [[ -d "${SOURCE_APP_BUNDLE}" ]]; then
  echo "Refusing to build while stale source bundle exists: ${SOURCE_APP_BUNDLE}" >&2
  echo "Remove it from Sources; production bundles must be created only in ${DIST_DIR}." >&2
  exit 1
fi

if [[ "${REQUIRE_NOTARIZATION}" == "1" && -z "${NOTARY_KEYCHAIN_PROFILE}" ]]; then
  echo "REQUIRE_NOTARIZATION=1 needs NOTARY_KEYCHAIN_PROFILE to be set." >&2
  exit 1
fi

if [[ -n "${NOTARY_KEYCHAIN_PROFILE}" && "${SIGN_IDENTITY}" == "-" ]]; then
  echo "NOTARY_KEYCHAIN_PROFILE needs CODESIGN_IDENTITY to be a Developer ID Application identity." >&2
  exit 1
fi

sign_target() {
  local target="$1"
  if [[ "${SIGN_IDENTITY}" == "-" ]]; then
    codesign --force --sign "${SIGN_IDENTITY}" --timestamp=none "${target}"
  else
    codesign --force --sign "${SIGN_IDENTITY}" --options runtime --timestamp "${target}"
  fi
}

create_archive() {
  rm -f "${ARCHIVE_PATH}"
  ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${ARCHIVE_PATH}"
}

assess_gatekeeper() {
  if spctl --assess --type execute --verbose=4 "${APP_BUNDLE}"; then
    echo "Gatekeeper assessment: accepted"
    return 0
  fi

  echo "Gatekeeper assessment: rejected or unavailable" >&2
  return 1
}

echo "[1/7] Building Swift binary (arm64)..."
swift build --package-path "${APP_ROOT}" -c release --product "${APP_NAME}" --arch arm64

echo "[2/7] Building Swift binary (x86_64)..."
swift build --package-path "${APP_ROOT}" -c release --product "${APP_NAME}" --arch x86_64

echo "[3/7] Creating universal launcher..."
mkdir -p "${DIST_DIR}"
rm -f "${UNIVERSAL_EXECUTABLE}"
lipo -create -output "${UNIVERSAL_EXECUTABLE}" "${ARM64_EXECUTABLE}" "${X86_64_EXECUTABLE}"
chmod +x "${UNIVERSAL_EXECUTABLE}"

echo "[4/7] Creating .app bundle..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS" "${APP_BUNDLE}/Contents/Resources"

cp "${UNIVERSAL_EXECUTABLE}" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"

cat > "${APP_BUNDLE}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${PROXY_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF

echo "[5/7] Embedding proxy runtime..."
if [[ ! -d "${PROXY_ROOT}/node_modules" ]]; then
  echo "Proxy dependencies are missing, running npm install..."
  npm install --prefix "${PROXY_ROOT}"
fi

npm run skill:sync --prefix "${PROXY_ROOT}"

mkdir -p "${APP_BUNDLE}/Contents/Resources/embedded-proxy"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude ".git" \
  --exclude ".gitignore" \
  --exclude ".env" \
  --exclude "build" \
  --exclude "coverage" \
  --exclude "codex-workspace/debug-runs" \
  --exclude "macos-app" \
  --exclude "dist" \
  --exclude "runtime" \
  "${PROXY_ROOT}/" \
  "${APP_BUNDLE}/Contents/Resources/embedded-proxy/"

KNOWLEDGE_ROOT="${APP_BUNDLE}/Contents/Resources/embedded-proxy/knowledge"
mkdir -p \
  "${KNOWLEDGE_ROOT}/ds-ai-hub" \
  "${KNOWLEDGE_ROOT}/design-system_ab/JSONS" \
  "${KNOWLEDGE_ROOT}/design-system_ab/JSONS/tokens" \
  "${KNOWLEDGE_ROOT}/design-system_ab/redpolrules"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude ".git" \
  --exclude "node_modules" \
  "${DS_AI_HUB_SOURCE}/" \
  "${KNOWLEDGE_ROOT}/ds-ai-hub/"
rsync -a --delete \
  --exclude ".DS_Store" \
  "${DESIGN_SYSTEM_SOURCE}/patterns/" \
  "${KNOWLEDGE_ROOT}/design-system_ab/patterns/"
rsync -a --delete \
  --exclude ".DS_Store" \
  "${DESIGN_SYSTEM_SOURCE}/redpolrules/" \
  "${KNOWLEDGE_ROOT}/design-system_ab/redpolrules/"
rsync -a --delete \
  --exclude ".DS_Store" \
  "${DESIGN_SYSTEM_SOURCE}/apollo/" \
  "${KNOWLEDGE_ROOT}/design-system_ab/apollo/"
rsync -a --delete \
  --exclude ".DS_Store" \
  "${DESIGN_SYSTEM_SOURCE}/JSONS/apollo/" \
  "${KNOWLEDGE_ROOT}/design-system_ab/JSONS/apollo/"
node "${PROXY_ROOT}/scripts/sync-contract-knowledge.js" \
  --source "${DESIGN_SYSTEM_SOURCE}/JSONS" \
  --target "${KNOWLEDGE_ROOT}/design-system_ab/JSONS"
rsync -a --delete \
  --exclude ".DS_Store" \
  "${REPOSITORY_ROOT}/shared/design-system_ab/JSONS/tokens/" \
  "${KNOWLEDGE_ROOT}/design-system_ab/JSONS/tokens/"
if [[ ! -f "${KNOWLEDGE_ROOT}/design-system_ab/redpolrules/dictionary.json" ]]; then
  echo "Redpolicy knowledge was not embedded into ApolloProxyControl." >&2
  exit 1
fi
for knowledge_file in README.md AGENTIC_FILES.md COMPONENT_AUTHORING.md; do
  if [[ -f "${DESIGN_SYSTEM_SOURCE}/${knowledge_file}" ]]; then
    cp \
      "${DESIGN_SYSTEM_SOURCE}/${knowledge_file}" \
      "${KNOWLEDGE_ROOT}/design-system_ab/${knowledge_file}"
  fi
done

if [[ -z "${NODE_EXECUTABLE}" ]]; then
  echo "Node.js is required on the build machine to create a shareable app bundle." >&2
  exit 1
fi

mkdir -p "${APP_BUNDLE}/Contents/Resources/runtime/bin"
cp "${NODE_EXECUTABLE}" "${APP_BUNDLE}/Contents/Resources/runtime/bin/node"
chmod +x "${APP_BUNDLE}/Contents/Resources/runtime/bin/node"

if [[ "${EMBED_PROXY_ENV}" == "1" && -f "${PROXY_ROOT}/.env" ]]; then
  cp "${PROXY_ROOT}/.env" "${APP_BUNDLE}/Contents/Resources/embedded-proxy/.env"
  echo "Embedded shared proxy config from ${PROXY_ROOT}/.env (EMBED_PROXY_ENV=1)"
else
  echo "Shared .env was not embedded. ApolloProxyControl will create a per-user config from .env.example."
fi

printf '%s\n' "${BUILD_STAMP}" > "${APP_BUNDLE}/Contents/Resources/embedded-proxy/.bundle-build-id"

echo "[6/7] Signing bundle..."
xattr -cr "${APP_BUNDLE}"
sign_target "${APP_BUNDLE}/Contents/Resources/runtime/bin/node"
sign_target "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
if [[ "${SIGN_IDENTITY}" == "-" ]]; then
  codesign --force --deep --sign "${SIGN_IDENTITY}" --timestamp=none "${APP_BUNDLE}"
else
  codesign --force --deep --sign "${SIGN_IDENTITY}" --options runtime --timestamp "${APP_BUNDLE}"
fi
codesign --verify --deep --strict --verbose=2 "${APP_BUNDLE}"

echo "[7/7] Packing transfer archive..."
create_archive

if [[ -n "${NOTARY_KEYCHAIN_PROFILE}" ]]; then
  echo "[notarization] Submitting archive to Apple..."
  xcrun notarytool submit "${ARCHIVE_PATH}" --keychain-profile "${NOTARY_KEYCHAIN_PROFILE}" --wait
  echo "[notarization] Stapling ticket to app bundle..."
  xcrun stapler staple "${APP_BUNDLE}"
  xcrun stapler validate "${APP_BUNDLE}"
  echo "[notarization] Repacking stapled app bundle..."
  create_archive
fi

if [[ "${SIGN_IDENTITY}" == "-" ]]; then
  echo "Warning: app is ad-hoc signed. It is useful for local testing, but not for frictionless distribution." >&2
  if [[ "${REQUIRE_NOTARIZATION}" == "1" ]]; then
    echo "REQUIRE_NOTARIZATION=1 failed because CODESIGN_IDENTITY is ad-hoc." >&2
    exit 1
  fi
fi

if ! assess_gatekeeper; then
  if [[ "${REQUIRE_NOTARIZATION}" == "1" ]]; then
    echo "REQUIRE_NOTARIZATION=1 failed because Gatekeeper did not accept the app." >&2
    exit 1
  fi
  echo "Warning: this archive may show launch warnings or fail on other Macs until Developer ID notarization is used." >&2
fi

echo "Done."
echo "App bundle: ${APP_BUNDLE}"
echo "Archive: ${ARCHIVE_PATH}"
