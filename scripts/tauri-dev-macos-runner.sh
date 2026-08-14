#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "tauri-dev-macos-runner: missing executable" >&2
  exit 2
fi

SOURCE_EXECUTABLE="$1"
shift

if [[ -z "${DRIFTY_ISOLATED_APP_BUNDLE:-}" || -z "${DRIFTY_ISOLATED_IDENTIFIER:-}" || -z "${DRIFTY_ISOLATED_PRODUCT_NAME:-}" ]]; then
  exec "$SOURCE_EXECUTABLE" "$@"
fi

APP_BUNDLE="$DRIFTY_ISOLATED_APP_BUNDLE"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
WRAPPED_EXECUTABLE="$MACOS_DIR/drifty"
PLIST_PATH="$APP_BUNDLE/Contents/Info.plist"

mkdir -p "$MACOS_DIR"
cp -c -f "$SOURCE_EXECUTABLE" "$WRAPPED_EXECUTABLE"
chmod 700 "$WRAPPED_EXECUTABLE"

plutil -create xml1 "$PLIST_PATH"
plutil -insert CFBundleDevelopmentRegion -string en "$PLIST_PATH"
plutil -insert CFBundleDisplayName -string "$DRIFTY_ISOLATED_PRODUCT_NAME" "$PLIST_PATH"
plutil -insert CFBundleExecutable -string drifty "$PLIST_PATH"
plutil -insert CFBundleIdentifier -string "$DRIFTY_ISOLATED_IDENTIFIER" "$PLIST_PATH"
plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$PLIST_PATH"
plutil -insert CFBundleName -string "$DRIFTY_ISOLATED_PRODUCT_NAME" "$PLIST_PATH"
plutil -insert CFBundlePackageType -string APPL "$PLIST_PATH"
plutil -insert CFBundleShortVersionString -string "${DRIFTY_ISOLATED_VERSION:-0.0.0}" "$PLIST_PATH"
plutil -insert CFBundleVersion -string 1 "$PLIST_PATH"
plutil -insert LSUIElement -bool true "$PLIST_PATH"
plutil -insert NSHighResolutionCapable -bool true "$PLIST_PATH"

exec "$WRAPPED_EXECUTABLE" "$@"
