#!/usr/bin/env bash
# Installs every package required by `npm run verify:ai`, pinned to the
# versions declared in package.json. Safe to re-run.
#
# Usage:
#   ./scripts/install-required.sh            # install all required packages
#   ./scripts/install-required.sh --dry-run  # print the command only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if ! command -v node >/dev/null 2>&1; then
  echo "install-required: node is required but was not found on PATH" >&2
  exit 1
fi

# Build the list of "name@version" specifiers from the shared required list.
SPECS="$(node -e '
import("./scripts/required-packages.mjs").then(async (m) => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
  const out = m.REQUIRED.map((n) => {
    const v = pkg.dependencies?.[n] ?? pkg.devDependencies?.[n];
    return v ? `${n}@${v.replace(/^[\^~]/, "")}` : n;
  });
  process.stdout.write(out.join(" "));
});
')"

if [[ -z "$SPECS" ]]; then
  echo "install-required: could not resolve the required package list" >&2
  exit 1
fi

if [[ -f bun.lockb || -f bun.lock ]]; then
  CMD="bun add --exact $SPECS"
elif [[ -f pnpm-lock.yaml ]]; then
  CMD="pnpm add $SPECS"
elif [[ -f yarn.lock ]]; then
  CMD="yarn add $SPECS"
else
  CMD="npm install --save-exact $SPECS"
fi

echo "install-required: $CMD"
if [[ "$DRY_RUN" == "1" ]]; then
  exit 0
fi

eval "$CMD"
echo "install-required: done — re-running verification"
node "$ROOT/scripts/preflight.mjs"
