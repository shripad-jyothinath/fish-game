/**
 * Fish.IO API + website server.
 *
 * One origin serves the static game (apps/web) and the API, so session
 * cookies and save sync work without CORS:
 *
 *   GET  /                        the game website
 *   GET  /healthz                 liveness
 *   GET  /api/v1/status           service info
 *   POST /api/v1/auth/register    create account + session cookie
 *   POST /api/v1/auth/login       sign in + session cookie
 *   POST /api/v1/auth/logout      end session
 *   GET  /api/v1/auth/me          current account
 *   GET  /api/v1/me/save          download account save
 *   PUT  /api/v1/me/save          upload account save
 *   POST /internal/matches        room server results intake (stub, 501)
 *   GET  /api/v1/leaderboard      season leaderboard (stub)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { loadConfig, type ApiConfig } from './config.ts';
import { loadDotEnv } from './env.ts';
import { openDatabase } from './db.ts';
import { makeAuthGuard, registerAuthRoutes } from './auth.ts';
import { registerSaveRoutes } from './save.ts';
import { loadHederaSettings } from './hedera/config.ts';
import { registerHederaRoutes } from './hedera/routes.ts';
import { createHederaServices } from './hedera/services.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '../../web');

// Load apps/api/.env (operator keys, ports, ...) before anything reads env.
loadDotEnv();

export function buildServer(config: ApiConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const store = openDatabase(config.dbPath);

  store.purgeExpiredSessions(Date.now());
  const sessionSweep = setInterval(() => store.purgeExpiredSessions(Date.now()), 60 * 60 * 1000);
  sessionSweep.unref();

  app.register(cookie);

  // Cross-site deployments (e.g. the game on Vercel, API here) need an explicit
  // origin allowlist with credentials; local same-origin play needs nothing.
  if (config.webOrigins.length > 0) {
    const allowed = new Set(config.webOrigins);
    app.register(cors, {
      origin(origin, callback) {
        // Allow requests without an Origin header (curl, health checks) and allowlisted sites.
        callback(null, !origin || allowed.has(origin));
      },
      credentials: true,
    });
  }

  const hedera = createHederaServices(store, loadHederaSettings());

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/v1/status', async () => ({
    service: 'fishio-api',
    version: '0.1.0',
    env: config.nodeEnv,
    time: new Date().toISOString(),
    features: {
      database: 'sqlite',
      accounts: true,
      redis: Boolean(config.redisUrl),
      hedera: hedera.online ? `online:${hedera.settings.network}` : 'disabled',
    },
  }));

  // --- Accounts & sessions --------------------------------------------------
  registerAuthRoutes(app, store, {
    cookieSecure: config.nodeEnv === 'production',
    cookieCrossSite: config.webOrigins.length > 0,
    onAccountCreated: (userId) => {
      // Auto-provision the player's managed wallet in the background; failures retry on next use.
      if (hedera.custody) {
        void hedera.custody.ensureWallet(userId).catch((err) => app.log.warn({ err }, 'auto wallet creation failed'));
      }
    },
  });
  const requireUser = makeAuthGuard(store);
  registerSaveRoutes(app, store, requireUser);

  // --- Matches, $GOLD, NFTs, wallet links, leaderboard ----------------------
  registerHederaRoutes(app, store, hedera, requireUser);

  // --- Match results intake from room servers (Phase M4) ---------------------
  app.post('/internal/matches', async (req, reply) => {
    reply.code(501);
    return { error: 'not_implemented', detail: 'room server posts HMAC-signed results in Phase M4' };
  });

  // --- The website itself (registered last; API routes win over the wildcard)
  app.register(fastifyStatic, { root: WEB_ROOT, prefix: '/' });

  app.addHook('onClose', async () => {
    clearInterval(sessionSweep);
    store.close();
  });

  return app;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
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
