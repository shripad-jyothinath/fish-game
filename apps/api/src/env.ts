/**
 * Minimal .env loader (no dependency). Reads apps/api/.env into process.env
 * without overriding variables that are already set. Shared by the API server
 * and the Hedera setup script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENV_PATH = path.resolve(HERE, '../.env');

export function loadDotEnv(file: string = ENV_PATH): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2] ?? '';
    if (key && process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}
