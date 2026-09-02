/**
 * One log module (SPEC 12). Rotating file in userData. The API key is redacted
 * and image data and generated content are never written.
 */

import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1_000_000;
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;

type Level = 'debug' | 'info' | 'warn' | 'error';

let filePath: string | null = null;

function target(): string | null {
  if (filePath) return filePath;
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'halo.log');
    return filePath;
  } catch {
    return null; // Logging must never be the thing that breaks the app.
  }
}

export function redact(value: string): string {
  return value.replace(KEY_PATTERN, 'sk-ant-***');
}

function rotate(path: string): void {
  try {
    if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`);
  } catch {
    /* first write, or the file is gone; nothing to rotate */
  }
}

function write(level: Level, scope: string, message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${redact(message)}\n`;
  if (level === 'error') console.error(line.trimEnd());
  else if (process.env.NODE_ENV !== 'production') console.log(line.trimEnd());
  const path = target();
  if (!path) return;
  rotate(path);
  try {
    appendFileSync(path, line);
  } catch {
    /* disk full or locked: dropping a log line is the correct failure */
  }
}

export const log = {
  debug: (scope: string, message: string) => write('debug', scope, message),
  info: (scope: string, message: string) => write('info', scope, message),
  warn: (scope: string, message: string) => write('warn', scope, message),
  error: (scope: string, message: string) => write('error', scope, message),
  path: () => target(),
};
