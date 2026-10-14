#!/usr/bin/env bash
# Runs the app and test tooling against the best available Node runtime.
#
# Why this exists: DSH ships a bundled Node, but its code signature rejects
# every native .node addon (rollup/rolldown/esbuild prebuilds fail with
# "different Team IDs"). The test runner and parts of the toolchain need those.
# So we prefer a capable system Node and only fall back to the bundled one.
#
# Override with NODE_BIN=/path/to/node if you need a specific runtime.
set -euo pipefail

ROOT="/Users/dharmesh/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies"
BUNDLED="$ROOT/node/bin/node"
PNPM="$ROOT/pnpm/bin/pnpm.mjs"
MIN_MAJOR=24

version_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# NODE_BIN wins; otherwise the first system Node >= 24; otherwise the bundled one.
NODE=""
if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
  NODE="$NODE_BIN"
else
  for candidate in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if (( $(version_major "$candidate") >= MIN_MAJOR )); then
      NODE="$candidate"
      break
    fi
  done
fi

if [[ -z "$NODE" ]]; then
  if [[ -x "$BUNDLED" ]]; then
    echo "warning: falling back to the bundled Node ($BUNDLED)." >&2
    echo "warning: native modules may fail to load; set NODE_BIN to a system Node >= $MIN_MAJOR." >&2
    NODE="$BUNDLED"
  else
    echo "No usable Node runtime found. Install Node >= $MIN_MAJOR or set NODE_BIN." >&2
    exit 1
  fi
fi

case "${1:-}" in
  pnpm)   shift; exec "$NODE" "$PNPM" "$@" ;;
  node)   shift; exec "$NODE" "$@" ;;
  tsx)    shift; exec "$NODE" "$PWD/node_modules/tsx/dist/cli.mjs" "$@" ;;
  vitest) shift; exec "$NODE" "$PWD/node_modules/vitest/vitest.mjs" "$@" ;;
  tsc)    shift; exec "$NODE" "$PWD/node_modules/typescript/bin/tsc" "$@" ;;
  which)
    echo "$NODE"
    exit 0
    ;;
  *)
    echo "usage: $0 {pnpm|node|tsx|vitest|tsc|which} [args...]" >&2
    exit 2
    ;;
esac
