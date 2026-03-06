#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Node Env Guardian — compile and publish to VS Code Marketplace
# Usage: ./publish.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

EXT_VERSION="$(node -p "require('./package.json').version")"

echo "==> Node Env Guardian publisher"
echo "    version : ${EXT_VERSION}"
echo ""

# ── 1. Install dependencies ───────────────────────────────────────────────────
echo "==> Installing dependencies…"
npm install --silent

# ── 2. Compile TypeScript ─────────────────────────────────────────────────────
echo "==> Compiling TypeScript…"
npm run compile

# ── 3. Publish to VS Code Marketplace ─────────────────────────────────────────
echo "==> Publishing to VS Code Marketplace…"
if command -v vsce &>/dev/null; then
  vsce publish
else
  echo "    vsce not found globally — using npx @vscode/vsce"
  npx --yes @vscode/vsce publish
fi

echo ""
echo "✓ Published v${EXT_VERSION} to the VS Code Marketplace."
echo "  https://marketplace.visualstudio.com/items?itemName=akashagarwal.vscode-node-env-guardian"
