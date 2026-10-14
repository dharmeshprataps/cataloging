/**
 * CLI for the traceability gate.
 *
 *   pnpm spec:status   human-readable coverage report; exit 1 on any violation
 *
 * The same gate runs as a test (`tests/spec-gate.test.ts`), so `pnpm test`
 * covers it too. This CLI exists so the report is readable without test output,
 * and so CI can wire it in independently of the suite.
 */
import { formatReport, runGate } from './verify-spec.js';

const result = runGate();
process.stdout.write(formatReport(result));

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
}

process.exit(result.summary.errors === 0 ? 0 : 1);
