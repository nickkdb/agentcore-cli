#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/dashboard" && npm ci --silent && npx tsx src/generate.tsx
cp -f site/dashboard/* "$SCRIPT_DIR/" && rm -rf site
echo "Done. Review: git diff"
