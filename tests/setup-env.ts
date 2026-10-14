import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Runs before any test module is imported, so configuration is resolved against
 * an isolated temp directory. Without this, tests would write into ./data and
 * could interfere with a running dev server.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'wa-catalog-test-'));

process.env.NODE_ENV = 'test';
process.env.STORAGE_DIR = path.join(dir, 'uploads');
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.MESSAGING_CHANNEL = 'simulator';
process.env.LOG_LEVEL = 'silent';
process.env.MESSAGE_DEBOUNCE_MS = '10';
process.env.GEMINI_API_KEY = '';
process.env.PUBLIC_BASE_URL = 'http://localhost:0';
