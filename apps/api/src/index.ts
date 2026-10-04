/**
 * Fish.IO API — skeleton for DB-0 / M3.
 *
 * Current scope (no DB connection yet):
 *   GET  /healthz                 liveness
 *   GET  /api/v1/status          service info
 *   POST /api/v1/auth/challenge  wallet/guest login challenge        (stub, 501)
 *   POST /api/v1/auth/verify     verify signature -> session JWT     (stub, 501)
 *   POST /internal/matches       room server results intake, HMAC    (stub, 501)
 *   GET  /api/v1/leaderboard     season leaderboard                  (stub, [])
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type ApiConfig } from './config.ts';

export function buildServer(config: ApiConfig): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/v1/status', async () => ({
    service: 'fishio-api',
    version: '0.1.0',
    env: config.nodeEnv,
    time: new Date().toISOString(),
    features: {
      database: Boolean(config.databaseUrl),
      redis: Boolean(config.redisUrl),
    },
  }));

  // --- Auth (Phase 1) -------------------------------------------------------
  app.post('/api/v1/auth/challenge', async (req, reply) => {
    reply.code(501);
    return { error: 'not_implemented', detail: 'guest id / Hedera account challenge comes in Phase 1' };
  });

  app.post('/api/v1/auth/verify', async (req, reply) => {
    reply.code(501);
    return { error: 'not_implemented', detail: 'signature verification + session token come in Phase 1' };
  });

  // --- Match results intake (Phase M4) --------------------------------------
  app.post('/internal/matches', async (req, reply) => {
    reply.code(501);
    return { error: 'not_implemented', detail: 'room server posts HMAC-signed results in Phase M4' };
  });

  // --- Leaderboards (Phase DB-3) --------------------------------------------
  app.get('/api/v1/leaderboard', async () => ({
    season: null,
    entries: [],
    note: 'populated from Postgres + Redis once DB-3 lands',
  }));

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMain) {
  const config = loadConfig();
  const app = buildServer(config);
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info(`${signal} received, shutting down`);
      await app.close();
      process.exit(0);
    });
  }
}
