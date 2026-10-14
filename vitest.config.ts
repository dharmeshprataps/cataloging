import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: this is a server-side service, no DOM.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup-env.ts'],
    // Integration tests touch SQLite and the filesystem; keep them serial so
    // shared temp state cannot interleave.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
  },
});
