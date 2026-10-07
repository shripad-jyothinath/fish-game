/**
 * Account save sync: the browser's local progress blob, stored per user.
 * Mounted under /api/v1/me/save behind the session cookie.
 */
import type { FastifyInstance } from 'fastify';
import type { AuthGuard } from './auth.ts';
import type { Store } from './db.ts';
import { refreshPower } from './power.ts';

const MAX_SAVE_BYTES = 512 * 1024;

export function registerSaveRoutes(app: FastifyInstance, store: Store, requireUser: AuthGuard): void {
  app.get('/api/v1/me/save', { preHandler: requireUser }, async (req) => {
    const userId = req.user?.id;
    if (!userId) return { save: null, updatedAt: null };
    const row = store.getSave(userId);
    if (!row) return { save: null, updatedAt: null };
    try {
      return { save: JSON.parse(row.data) as unknown, updatedAt: row.updated_at };
    } catch {
      return { save: null, updatedAt: null };
    }
  });

  app.put('/api/v1/me/save', { preHandler: requireUser }, async (req, reply) => {
    const userId = req.user?.id;
    if (!userId) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in required.' } });
    }
    const body = (req.body ?? null) as { save?: unknown } | null;
    const save = body && typeof body === 'object' ? body.save : undefined;
    if (save === undefined || save === null || typeof save !== 'object' || Array.isArray(save)) {
      return reply.code(400).send({ error: { code: 'invalid_save', message: 'Body must be { save: object }.' } });
    }
    const data = JSON.stringify(save);
    if (data.length > MAX_SAVE_BYTES) {
      return reply.code(413).send({ error: { code: 'save_too_large', message: 'Save data is too large.' } });
    }
    const now = Date.now();
    store.upsertSave(userId, data, now);
    try {
      refreshPower(store, userId); // loadout changes affect combat power
    } catch {
      /* power is best-effort */
    }
    return reply.send({ updatedAt: now });
  });
}
