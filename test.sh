#!/usr/bin/env bash
# Loads .env (if present) and runs vitest with the bundled Node runtime.
#
# Note: a real .env is intentionally NOT loaded, so a developer's live API key
# can never be spent by the test suite. The gate's tests are hermetic: they run
# against fixture trees created under the system temp directory.
set -euo pipefail

cd "$(dirname "$0")"

exec ./run.sh vitest "$@"
