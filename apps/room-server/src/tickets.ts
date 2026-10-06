/**
 * Signed room tickets — verification side.
 *
 * Must stay byte-compatible with `apps/api/src/hedera/tickets.ts`
 * (a cross-app test guards against drift).
 */
import crypto from 'node:crypto';

export interface RoomTicketPayload {
  u: string; // user id
  n: string; // username
  exp: number; // expiry, ms since epoch
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
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

/** Signature for a raw JSON body (room → POST /internal/matches). */
export function signInternalBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('base64url');
}
