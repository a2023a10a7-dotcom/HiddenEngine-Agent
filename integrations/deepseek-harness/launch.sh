#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN="$ROOT/integrations/deepseek-harness/hiddenengine-tools.ts"
PATCH_FILE="$(mktemp "${TMPDIR:-/tmp}/hiddenengine-dsh.XXXXXX.yml")"
trap 'rm -f "$PATCH_FILE"' EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi

cat > "$PATCH_FILE" <<YAML
- insert:
    - id: hiddenengine-production-tools
      name: '$PLUGIN'
YAML

if [[ -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}" ]]; then
  echo "Note: read-only project tools work without a token. Rendering requires GITHUB_TOKEN or GH_TOKEN with Actions write and Contents read permissions."
fi

cd "$ROOT"
npx --yes @deepseek-ai/dsh web --patch "$PATCH_FILE"
