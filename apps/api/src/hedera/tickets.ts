/**
 * Signed room tickets + internal result signatures.
 *
 * The browser asks the API for a short-lived HMAC ticket and hands it to the
 * room server in its `hello`. The room server (same secret) verifies it and
 * later posts match results to `/internal/matches`, signed the same way — so no
 * session cookie ever has to leave the web origin.
 *
 * The room server re-implements the verify side in
 * `apps/room-server/src/tickets.ts`; a cross-app test keeps both in sync.
 */
import crypto from 'node:crypto';

export interface RoomTicketPayload {
  u: string; // user id
  n: string; // username
  exp: number; // expiry, ms since epoch
}

export const ROOM_TICKET_TTL_MS = 10 * 60 * 1000;

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function signRoomTicket(
  secret: string,
  userId: string,
  username: string,
  ttlMs = ROOM_TICKET_TTL_MS,
  now = Date.now(),
): string {
  const payload: RoomTicketPayload = { u: userId, n: username, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyRoomTicket(secret: string, ticket: unknown, now = Date.now()): RoomTicketPayload | null {
  if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 4096) return null;
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0 || dot === ticket.length - 1) return null;

  const body = ticket.slice(0, dot);
  const signature = ticket.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<RoomTicketPayload>;
    if (!parsed || typeof parsed.u !== 'string' || parsed.u.length === 0) return null;
    if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp) || parsed.exp < now) return null;
    return { u: parsed.u, n: typeof parsed.n === 'string' ? parsed.n.slice(0, 32) : '', exp: parsed.exp };
  } catch {
    return null;
  }
}

/** Signature for a raw JSON body (room server → POST /internal/matches). */
export function signInternalBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('base64url');
}

export function verifyInternalBody(secret: string, rawBody: string, signature: unknown): boolean {
  if (typeof signature !== 'string') return false;
  return timingSafeEqual(signature, signInternalBody(secret, rawBody));
}
