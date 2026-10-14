import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Blob storage boundary. The local filesystem implementation is the default;
 * swapping in S3/R2 for a multi-instance deployment means implementing this
 * interface, with no changes above it.
 */
export type BlobStore = {
  /** Persists bytes and returns the storage-relative key. */
  put(key: string, data: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  /** Absolute path on disk, when the store is filesystem-backed. */
  localPath(key: string): string;
  exists(key: string): Promise<boolean>;
};

function safeJoin(root: string, key: string): string {
  const resolved = path.resolve(root, key);
  // Prevent path traversal via crafted keys.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to access path outside storage root: ${key}`);
  }
  return resolved;
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string = config.storage.dir) {}

  async put(key: string, data: Uint8Array): Promise<string> {
    const target = safeJoin(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so readers never observe a partial file.
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
    return key;
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(safeJoin(this.root, key)));
  }

  localPath(key: string): string {
    return safeJoin(this.root, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(safeJoin(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }
}

export const blobStore: BlobStore = new LocalBlobStore();

/** Content-addressed-ish key that keeps the extension for content-type hints. */
export function buildAssetKey(ext: string, prefix = ''): string {
  const date = new Date().toISOString().slice(0, 10);
  const name = `${randomUUID()}${ext}`;
  return prefix ? `${prefix}/${date}/${name}` : `${date}/${name}`;
}
