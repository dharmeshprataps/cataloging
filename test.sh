#!/usr/bin/env bash
# Loads .env (if present) and runs vitest with the bundled Node runtime.
#
# Note: the real .env is intentionally NOT loaded, so a developer's live API key
# can never be spent by the test suite. Values come from tests/setup-env.ts.
set -euo pipefail

cd "$(dirname "$0")"

exec ./run.sh vitest "$@"
