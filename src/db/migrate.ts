import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { logger } from '../logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The schema lives next to this file as .sql. When compiled, `dist/db/` has no
 * .sql file, so fall back to the source tree (present in the repo and in the
 * Docker builder). Keeps a single source of truth for the schema.
 */
function loadSchemaSql(): string {
  const candidates = [
    path.join(here, 'schema.sql'),
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(here, '../../src/db/schema.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    `Could not locate schema.sql. Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
  );
}

let db: DatabaseSync | undefined;

/**
 * Opens (once) and ensures the schema exists. `node:sqlite` is built into Node
 * 24+, so there is no native module to compile — the service stays trivially
 * containerizable.
 */
export function getDb(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.storage.databasePath), { recursive: true });
  db = new DatabaseSync(config.storage.databasePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(database: DatabaseSync = getDb()): void {
  database.exec(loadSchemaSql());
  logger.debug('database schema ensured');
}

/** For tests: a private in-memory database, no file side effects. */
export function createTestDb(): DatabaseSync {
  const testDb = new DatabaseSync(':memory:');
  testDb.exec('PRAGMA foreign_keys = ON;');
  testDb.exec(loadSchemaSql());
  return testDb;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
