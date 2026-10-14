import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Entry point. Kept separate from `buildApp` so importing the app in tests never
 * binds a port.
 */
async function main(): Promise<void> {
  const { start } = await import('./server.js');
  ensureRuntimeDirs();
  await start();
}

function ensureRuntimeDirs(): void {
  for (const dir of [process.env.STORAGE_DIR ?? './data/uploads']) {
    fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  }
}

main().catch((err: unknown) => {
  console.error(
    '\nFailed to start:\n',
    err instanceof Error ? err.message : err,
    '\n',
  );
  process.exit(1);
});
