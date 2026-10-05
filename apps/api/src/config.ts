/**
 * Config loader: all env parsing in one place.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(HERE, '../data/fishio.db');

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** SQLite file backing local-dev accounts & save sync (Postgres is the production target). */
  dbPath: string;
  /** HMAC secret room servers use to sign match results (placeholder until M4). */
  internalHmacSecret: string;
  /** Browser origins allowed to call the API cross-site (e.g. the Vercel URL). Empty = same-origin only. */
  webOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = (env.NODE_ENV as ApiConfig['nodeEnv']) ?? 'development';
  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    dbPath: env.FISHIO_DB_PATH || DEFAULT_DB_PATH,
    internalHmacSecret: env.INTERNAL_HMAC_SECRET ?? 'dev-secret-change-me',
    webOrigins: (env.WEB_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  };
}
