#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DSH_REF="4b399c39a6d1479cd84ca591b4d7c88e24d38a96"
DSH_DIR="${DEEPSEEK_HARNESS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/deepseek-harness-source}"
PLUGIN_DIR="$DSH_DIR/scratch-plugin/src"
PATCH_FILE="$(mktemp "${TMPDIR:-/tmp}/hiddenengine-dsh.XXXXXX.yml")"
trap 'rm -f "$PATCH_FILE"' EXIT

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to install DeepSeek Harness from its official source repository." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24.22.3+ (24.x) or 26.13.1+ is required." >&2
  exit 1
fi

node --input-type=module <<'NODE'
const [major, minor, patch] = process.versions.node.split('.').map(Number)
const supported = (major === 24 && (minor > 22 || (minor === 22 && patch >= 3))) ||
  (major >= 26 && (major > 26 || minor > 13 || (minor === 13 && patch >= 1)))
if (!supported) {
  console.error(`DeepSeek Harness requires Node.js 24.22.3+ (24.x) or 26.13.1+. Current: ${process.versions.node}`)
  process.exit(1)
}
NODE

if [[ ! -d "$DSH_DIR/.git" ]]; then
  mkdir -p "$(dirname "$DSH_DIR")"
  git clone --no-checkout https://github.com/deepseek-ai/deepseek-harness.git "$DSH_DIR"
fi

git -C "$DSH_DIR" fetch --depth=1 origin "$DSH_REF"
git -C "$DSH_DIR" checkout --detach "$DSH_REF"

if command -v corepack >/dev/null 2>&1; then
  corepack pnpm install --frozen-lockfile
  corepack pnpm run build
else
  npm install --global pnpm@11.28.5
  pnpm install --frozen-lockfile
  pnpm run build
fi

mkdir -p "$PLUGIN_DIR"
cp "$ROOT/integrations/deepseek-harness/hiddenengine-tools.ts" "$PLUGIN_DIR/hiddenengine-tools.ts"

cat > "$PATCH_FILE" <<YAML
- insert:
    - id: hiddenengine-production-tools
      name: '$PLUGIN_DIR/hiddenengine-tools.ts'
YAML

if [[ -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}" ]]; then
  echo "Note: read-only project tools work without a token. Rendering requires GITHUB_TOKEN or GH_TOKEN with Actions write and Contents read permissions."
fi

cd "$DSH_DIR"
if command -v corepack >/dev/null 2>&1; then
  corepack pnpm dsh web --patch "$PATCH_FILE"
else
  pnpm dsh web --patch "$PATCH_FILE"
fi
