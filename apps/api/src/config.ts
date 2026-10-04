/**
 * Config loader: all env parsing in one place.
 */
export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** HMAC secret room servers use to sign match results (placeholder until auth lands). */
  internalHmacSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = (env.NODE_ENV as ApiConfig['nodeEnv']) ?? 'development';
  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    internalHmacSecret: env.INTERNAL_HMAC_SECRET ?? 'dev-secret-change-me',
  };
}
