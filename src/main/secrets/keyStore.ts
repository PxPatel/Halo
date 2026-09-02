/**
 * The API key is read in main only, never sent over IPC, never logged
 * (SPEC 11). Renderers learn only whether a key is present.
 */

import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log';

const FILE = 'halo-key.bin';

function keyPath(): string {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, FILE);
}

export class KeyStore {
  private cached: string | null = null;

  has(): boolean {
    return this.read() !== null;
  }

  read(): string | null {
    if (this.cached) return this.cached;
    try {
      const path = keyPath();
      if (!existsSync(path)) return null;
      const blob = readFileSync(path);
      const key = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(blob)
        : blob.toString('utf8');
      this.cached = key.trim() || null;
      return this.cached;
    } catch (error) {
      log.error('secrets', `could not read key: ${String(error)}`);
      return null;
    }
  }

  write(key: string): boolean {
    const trimmed = key.trim();
    if (!trimmed) return this.clear();
    try {
      const blob = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(trimmed)
        : Buffer.from(trimmed, 'utf8');
      writeFileSync(keyPath(), blob, { mode: 0o600 });
      this.cached = trimmed;
      if (!safeStorage.isEncryptionAvailable()) {
        log.warn('secrets', 'OS encryption unavailable; key stored unencrypted');
      }
      return true;
    } catch (error) {
      log.error('secrets', `could not store key: ${String(error)}`);
      return false;
    }
  }

  clear(): boolean {
    this.cached = null;
    try {
      rmSync(keyPath(), { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
