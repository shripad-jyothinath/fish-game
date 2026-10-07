/**
 * Session persistence: 30-day cookies + sliding renewal.
 * Everything runs offline against a temp SQLite file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SESSION_TTL_MS, sha256 } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/db.ts';
import { buildServer } from '../src/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function tempDb(): string {
  return path.join(os.tmpdir(), `fishio-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('register issues a 30-day session cookie', async () => {
  const dbPath = tempDb();
  const app = buildServer(loadConfig({ FISHIO_DB_PATH: dbPath, NODE_ENV: 'test' }));
  try {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'session1@example.com', username: 'session1', password: 'CheckPass123' },
    });
    assert.equal(reg.statusCode, 201);
    const cookie = reg.cookies.find((c) => c.name === 'fishio_session');
    assert.ok(cookie, 'session cookie set');
    assert.equal(cookie.maxAge, SESSION_TTL_MS / 1000, '30-day max-age');
    assert.equal(cookie.httpOnly, true);
  } finally {
    await app.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('sessions slide forward on use (come back within 30 days = stay signed in)', async () => {
  const dbPath = tempDb();
  const token = 'sliding-session-token';
  const seededAt = Date.now() - DAY_MS; // a day old → eligible for renewal

  const seed = openDatabase(dbPath);
  seed.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: seededAt,
    last_login_at: null,
  });
  seed.createSession(sha256(token), 'u1', seededAt, seededAt + SESSION_TTL_MS);
  seed.close();

  const app = buildServer(loadConfig({ FISHIO_DB_PATH: dbPath, NODE_ENV: 'test' }));
  try {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { fishio_session: token } });
    assert.equal(me.statusCode, 200);
    const cookie = me.cookies.find((c) => c.name === 'fishio_session');
    assert.ok(cookie, 'cookie refreshed on use');
    assert.equal(cookie.maxAge, SESSION_TTL_MS / 1000, 'fresh 30-day cookie');
  } finally {
    await app.close();
  }

  const check = openDatabase(dbPath);
  const session = check.findSession(sha256(token));
  assert.ok(session, 'session still present');
  assert.ok(session.expires_at > Date.now() + SESSION_TTL_MS - 60_000, 'db expiry slid ~30 days forward');
  check.close();
  fs.rmSync(dbPath, { force: true });
});

test('expired sessions are rejected and cleaned up', async () => {
  const dbPath = tempDb();
  const token = 'expired-session-token';

  const seed = openDatabase(dbPath);
  seed.createUser({
    id: 'u2',
    email: 'u2@example.com',
    username: 'u2',
    username_lower: 'u2',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  seed.createSession(sha256(token), 'u2', 1, Date.now() - 1000); // already expired
  seed.close();

  const app = buildServer(loadConfig({ FISHIO_DB_PATH: dbPath, NODE_ENV: 'test' }));
  try {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { fishio_session: token } });
    assert.equal(me.statusCode, 401);
  } finally {
    await app.close();
  }

  const check = openDatabase(dbPath);
  assert.equal(check.findSession(sha256(token)), undefined, 'expired session removed');
  check.close();
  fs.rmSync(dbPath, { force: true });
});
