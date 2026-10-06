/**
 * Room server configuration (env-driven, sane defaults for local play).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read apps/room-server/.env when present (process env wins). */
function loadDotEnv(): Record<string, string> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  const out: Record<string, string> = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    /* no .env file is fine */
  }
  return out;
}

export interface RoomServerConfig {
  host: string;
  port: number;
  /** Maximum humans in one arena (bots never fill multiplayer rooms). */
  maxPlayers: number;
  /** Simulation rate (game-core runs one fixed frame per tick). */
  tickRate: number;
  /** Snapshots per second sent to each client. */
  snapshotRate: number;
  /** Seed for the room's deterministic RNG. 0 = random each boot. */
  seed: number;
  /** How long a disconnected player keeps their fish before being removed. */
  reconnectGraceMs: number;
  /** Reject input bursts above this many messages per second. */
  maxMessagesPerSecond: number;
  /** Optional room label shown in logs/status. */
  roomName: string;
  /** API base URL for match reporting (empty disables result intake). */
  apiUrl: string;
  /** Shared secret for room tickets + signed results (empty disables both). */
  internalHmacSecret: string;
  /** How long to wait for the API to accept a match result. */
  reportTimeoutMs: number;
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function loadConfig(env: NodeJS.ProcessEnv = { ...loadDotEnv(), ...process.env }): RoomServerConfig {
  const tickRate = readInt(env.ROOM_TICK_RATE, 60, 10, 120);
  return {
    host: env.ROOM_HOST?.trim() || '0.0.0.0',
    port: readInt(env.ROOM_PORT ?? env.PORT, 8787, 0, 65535),
    maxPlayers: readInt(env.ROOM_MAX_PLAYERS, 16, 2, 64),
    tickRate,
    snapshotRate: readInt(env.ROOM_SNAPSHOT_RATE, 20, 1, tickRate),
    seed: readInt(env.ROOM_SEED, 0, 0, 2 ** 31 - 1),
    reconnectGraceMs: readInt(env.ROOM_RECONNECT_GRACE_MS, 20_000, 0, 120_000),
    maxMessagesPerSecond: readInt(env.ROOM_MAX_MSGS_PER_SEC, 120, 20, 1000),
    roomName: env.ROOM_NAME?.trim() || 'reef-1',
    apiUrl: (env.ROOM_API_URL ?? '').trim(),
    internalHmacSecret: (env.INTERNAL_HMAC_SECRET ?? '').trim(),
    reportTimeoutMs: readInt(env.ROOM_REPORT_TIMEOUT_MS, 2500, 250, 15_000),
  };
}
