/**
 * Email + password accounts with cookie sessions.
 * - Passwords: scrypt, per-user salt, constant-time compare.
 * - Sessions: 256-bit random tokens stored as SHA-256 hashes (a DB leak
 *   cannot be replayed), 30-day expiry, HttpOnly SameSite=Lax cookie.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Store, UserRow } from './db.ts';

export const SESSION_COOKIE = 'fishio_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,14}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  createdAt: number;
  lastLoginAt: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
    sessionTokenHash?: string;
  }
}

export type AuthGuard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!salt || !expectedHex || !Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  try {
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: n, r, p });
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function createSession(store: Store, userId: string, now: number): string {
  const token = randomBytes(32).toString('base64url');
  store.createSession(sha256(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** preHandler that resolves the session cookie into req.user or replies 401. */
export function makeAuthGuard(store: Store): AuthGuard {
  return async function requireUser(req, reply) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in required.' } });
    }
    const tokenHash = sha256(token);
    const session = store.findSession(tokenHash);
    if (!session || session.expires_at <= Date.now()) {
      if (session) store.deleteSession(tokenHash);
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Session expired. Sign in again.' } });
    }
    const user = store.findUserById(session.user_id);
    if (!user) {
      store.deleteSession(tokenHash);
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in required.' } });
    }
    req.user = toPublicUser(user);
    req.sessionTokenHash = tokenHash;
    return undefined;
  };
}

/** Tiny in-memory limiter so auth endpoints cannot be hammered. */
function rateLimiter(maxHits: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async function applyLimit(req: FastifyRequest, reply: FastifyReply) {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(req.ip, { count: 1, resetAt: now + windowMs });
      return undefined;
    }
    entry.count += 1;
    if (entry.count > maxHits) {
      return reply.code(429).send({
        error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
      });
    }
    return undefined;
  };
}

interface AuthBody {
  email?: unknown;
  username?: unknown;
  password?: unknown;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  store: Store,
  options: { cookieSecure: boolean },
): void {
  const authLimit = rateLimiter(20, 10 * 60 * 1000);
  const requireUser = makeAuthGuard(store);

  app.post('/api/v1/auth/register', { onRequest: authLimit }, async (req, reply) => {
    const body = (req.body ?? {}) as AuthBody;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return reply.code(400).send({ error: { code: 'invalid_email', message: 'Enter a valid email address.' } });
    }
    if (!USERNAME_RE.test(username)) {
      return reply.code(400).send({
        error: { code: 'invalid_username', message: 'Username must be 3-14 letters, numbers or underscores.' },
      });
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return reply.code(400).send({
        error: { code: 'invalid_password', message: `Password must be at least ${MIN_PASSWORD} characters.` },
      });
    }
    if (store.findUserByEmail(email)) {
      return reply.code(409).send({ error: { code: 'email_taken', message: 'That email is already registered. Try logging in.' } });
    }
    if (store.findUserByUsername(username.toLowerCase())) {
      return reply.code(409).send({ error: { code: 'username_taken', message: 'That username is taken. Pick another.' } });
    }

    const now = Date.now();
    const user: UserRow = {
      id: randomUUID(),
      email,
      username,
      username_lower: username.toLowerCase(),
      password_hash: hashPassword(password),
      created_at: now,
      last_login_at: now,
    };
    store.createUser(user);
    setSessionCookie(reply, createSession(store, user.id, now), options.cookieSecure);
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post('/api/v1/auth/login', { onRequest: authLimit }, async (req, reply) => {
    const body = (req.body ?? {}) as AuthBody;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const user = email ? store.findUserByEmail(email) : undefined;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect.' } });
    }

    const now = Date.now();
    store.markLogin(user.id, now);
    setSessionCookie(reply, createSession(store, user.id, now), options.cookieSecure);
    return reply.send({ user: toPublicUser({ ...user, last_login_at: now }) });
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) store.deleteSession(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', { preHandler: requireUser }, async (req) => {
    return { user: req.user };
  });
}
