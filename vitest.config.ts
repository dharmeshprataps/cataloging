import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the gate is a server-side tool, no DOM.
    environment: 'node',
    // This must stay in step with `testGlobs` in `scripts/verify-spec.ts`: a
    // test the runner executes but the gate cannot see is a silent pass.
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
  },
});
