#!/usr/bin/env bash
# Runs the app and test tooling against the best available Node runtime.
#
# Why this exists: DSH ships a bundled Node, but its code signature rejects
# every native .node addon (rollup/rolldown/esbuild prebuilds fail with
# "different Team IDs"). The test runner and parts of the toolchain need those.
# So we prefer a capable system Node and only fall back to the bundled one.
#
# This script contains **no absolute path to any machine's directories**. It
# used to derive both `node` and `pnpm` from one hardcoded developer path, so
# `./test.sh` and `./run.sh tsx scripts/spec-status.ts` failed on any checkout
# without it — including the clean checkout `spec.md` §9 says this file exists to
# serve. The selection logic now lives in `scripts/lib/tooling.ts`, where a test
# can execute it, and this script only finds a Node able to run that file:
#
#   1. `$NODE_BIN`, when set.
#   2. the first `node` on `$PATH`; then `/opt/homebrew/bin`, `/usr/local/bin`,
#      `/usr/bin`. No version filter here — `tooling.ts` applies the >= 24
#      preference and reports an old runtime rather than refusing to start.
#   3. `$DSH_RUNTIME_ROOT/node/bin/node`, when set.
#
# Overrides: `NODE_BIN`, `PNPM_BIN`, `DSH_RUNTIME_ROOT`.
set -euo pipefail

cd "$(dirname "$0")"

BOOTSTRAP_NODE=""
if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
  BOOTSTRAP_NODE="$NODE_BIN"
else
  for candidate in "$(command -v node 2>/dev/null || true)" \
                   /opt/homebrew/bin/node \
                   /usr/local/bin/node \
                   /usr/bin/node \
                   "${DSH_RUNTIME_ROOT:-}/node/bin/node"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    BOOTSTRAP_NODE="$candidate"
    break
  done
fi

if [[ -z "$BOOTSTRAP_NODE" ]]; then
  echo "No Node runtime found. Install Node >= 24, or set NODE_BIN=/path/to/node" >&2
  echo "(or DSH_RUNTIME_ROOT=/path/to/bundled/runtime)." >&2
  exit 1
fi

# The launcher is TypeScript-free but reaches the resolver in `lib/tooling.ts`,
# which needs a runtime that can strip types. Node >= 22.18 does so by default
# (that path is checked in `tooling.ts`); older runtimes need the flag. A
# bootstrap Node too old to strip types is still usable this way, and the
# launcher re-executes under the runtime the resolver picks.
NODE_MAJOR_MINOR=$("$BOOTSTRAP_NODE" -p 'process.versions.node.split(".").slice(0,2).join(".")' 2>/dev/null || echo "0.0")
NODE_ARGS=()
if [[ "$(printf '%s\n22.18\n' "$NODE_MAJOR_MINOR" | sort -V | head -1)" != "22.18" ]]; then
  NODE_ARGS=(--experimental-strip-types)
fi

exec "$BOOTSTRAP_NODE" "${NODE_ARGS[@]+"${NODE_ARGS[@]}"}" "$PWD/scripts/run-tool.mjs" "$@"
