#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Node Env Guardian — compile and install in Cursor
# Usage: ./install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

EXT_NAME="envguardian"
EXT_VERSION="$(node -p "require('./package.json').version")"
VSIX_FILE="${EXT_NAME}-${EXT_VERSION}.vsix"

echo "==> Node Env Guardian installer"
echo "    version : ${EXT_VERSION}"
echo "    vsix    : ${VSIX_FILE}"
echo ""

# ── 1. Install dependencies ───────────────────────────────────────────────────
echo "==> Installing dependencies…"
npm install --silent

# ── 2. Compile TypeScript ─────────────────────────────────────────────────────
echo "==> Compiling TypeScript…"
npm run compile

# ── 3. Package the extension (.vsix) ─────────────────────────────────────────
echo "==> Packaging extension…"
if ! command -v vsce &>/dev/null; then
  echo "    vsce not found globally — using npx @vscode/vsce"
  npx --yes @vscode/vsce package --no-dependencies --out "${VSIX_FILE}"
else
  vsce package --no-dependencies --out "${VSIX_FILE}"
fi

# ── 4. Install into Cursor ────────────────────────────────────────────────────
echo "==> Installing into Cursor…"

# Try the Cursor CLI first (available when Cursor's bin dir is in PATH)
if command -v cursor &>/dev/null; then
  cursor --install-extension "${VSIX_FILE}"
  echo ""
  echo "✓ Installed via Cursor CLI."
  echo "  Restart or reload Cursor to activate Node Env Guardian."

# Fallback: copy directly into Cursor's extension directory
else
  # Determine the Cursor extensions folder for the current OS
  case "$(uname -s)" in
    Darwin)
      CURSOR_EXT_DIR="${HOME}/.cursor/extensions"
      ;;
    Linux)
      CURSOR_EXT_DIR="${HOME}/.cursor/extensions"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      CURSOR_EXT_DIR="${APPDATA}/Cursor/User/extensions"
      ;;
    *)
      echo "  Unknown OS — cannot locate Cursor extensions folder automatically."
      echo "  Please install ${VSIX_FILE} manually via:"
      echo "    Cursor → Extensions → ⋯ → Install from VSIX…"
      exit 1
      ;;
  esac

  DEST="${CURSOR_EXT_DIR}/${EXT_NAME}-${EXT_VERSION}"

  echo "    Cursor CLI not found in PATH."
  echo "    Copying extension to: ${DEST}"

  mkdir -p "${DEST}"

  # Unpack the .vsix (it's a zip) into the extensions folder
  if command -v unzip &>/dev/null; then
    unzip -q -o "${VSIX_FILE}" "extension/*" -d "${DEST}_tmp"
    cp -r "${DEST}_tmp/extension/." "${DEST}/"
    rm -rf "${DEST}_tmp"
  else
    echo "  'unzip' not found — please install ${VSIX_FILE} manually via:"
    echo "    Cursor → Extensions → ⋯ → Install from VSIX…"
    exit 1
  fi

  echo ""
  echo "✓ Installed to ${DEST}"
  echo "  Restart or reload Cursor to activate Node Env Guardian."
fi

echo ""
echo "  To add 'cursor' to your PATH (if not already):"
echo "    macOS : Cursor → Cmd+Shift+P → 'Shell Command: Install cursor in PATH'"
echo "    Linux : symlink the cursor binary into /usr/local/bin"
