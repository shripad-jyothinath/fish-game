/**
 * Room behaviour tests (no real sockets): join, input, death/respawn,
 * disconnect grace + reconnect, flood protection, validation.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { signInternalBody, signRoomTicket, verifyInternalBody } from '../../api/src/hedera/tickets.ts';
import type { RoomServerConfig } from '../src/config.ts';
import { Room, type ClientSocket } from '../src/room.ts';
import { verifyRoomTicket } from '../src/tickets.ts';
import type { FullStateMessage, MatchEndMessage, SnapshotMessage } from '../src/protocol.ts';

type WireMessage = Record<string, any>;

class FakeSocket implements ClientSocket {
  sent: WireMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  messages(type: string): WireMessage[] {
    return this.sent.filter((m) => m.t === type);
  }

  last(type: string): WireMessage | undefined {
    const list = this.messages(type);
    return list[list.length - 1];
  }
}

function makeConfig(overrides: Partial<RoomServerConfig> = {}): RoomServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 4,
    tickRate: 60,
    snapshotRate: 20,
    seed: 1234,
    reconnectGraceMs: 20_000,
    maxMessagesPerSecond: 120,
    roomName: 'test-reef',
    apiUrl: '',
    internalHmacSecret: '',
    reportTimeoutMs: 1000,
    ...overrides,
  };
}

function hello(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { t: 'hello', name: 'Tester', skin: 'baby_shark', weapon: 'coral_dagger', hat: 'none', vw: 1280, vh: 720, ...overrides };
}

function joinOk(room: Room, socket: FakeSocket, extra: Record<string, unknown> = {}) {
  const result = room.join(socket, hello(extra));
  assert.ok('player' in result, `join failed: ${JSON.stringify(result)}`);
  return result.player;
}

function tick(room: Room, times = 1): void {
  for (let i = 0; i < times; i++) room.tick();
}

test('join sends a welcome with world, map and your fish', () => {
  const room = new Room(makeConfig());
  const socket = new FakeSocket();
  const player = joinOk(room, socket, { name: 'Alice' });

  const welcome = socket.last('welcome') as FullStateMessage;
  assert.ok(welcome, 'welcome received');
  assert.equal(welcome.id, player.id);
  assert.ok(welcome.you, 'welcome has you state');
  assert.equal(welcome.you!.n, 'Alice');
  assert.ok(welcome.world.w > 0 && welcome.world.h > 0);
  assert.equal(typeof welcome.map, 'string');
  assert.ok(Array.isArray(welcome.food));
  room.stop();
});

test('two players see each other in snapshots', () => {
  const room = new Room(makeConfig());
  const a = new FakeSocket();
  const b = new FakeSocket();
  const pa = joinOk(room, a, { name: 'Alice' });
  const pb = joinOk(room, b, { name: 'Bob' });

  tick(room, 6);

  const snapA = a.last('snap') as SnapshotMessage | undefined;
  assert.ok(snapA, 'Alice got a snapshot');
  assert.ok(snapA!.you && snapA!.you.id === pa.id);
  const ids = snapA!.p.map((f) => f.id);
  assert.deepEqual(new Set(ids), new Set([pa.id, pb.id]));
  const bob = snapA!.p.find((f) => f.id === pb.id)!;
  assert.equal(bob.n, 'Bob');

  const snapB = b.last('snap') as SnapshotMessage | undefined;
  assert.ok(snapB?.you && snapB.you.id === pb.id);
  room.stop();
});

test('input drives the fish server-side (clients cannot set positions)', () => {
  const room = new Room(makeConfig());
  const socket = new FakeSocket();
  const player = joinOk(room, socket);

  // Center the fish so wall clamping cannot mask movement.
  player.fish!.x = 2000;
  player.fish!.y = 2000;
  const startX = player.fish!.x;

  room.onMessage(player, { t: 'input', seq: 1, a: 0, b: false });
  tick(room, 90);
  assert.ok(player.fish!.x > startX + 120, `expected movement, got ${player.fish!.x - startX}`);

  // Malformed / stale input is ignored.
  const angleBefore = player.fish!.targetAngle;
  room.onMessage(player, { t: 'input', seq: 1, a: Number.NaN, b: false });
  room.onMessage(player, { t: 'input', seq: 0, a: 3, b: false });
  assert.equal(player.fish!.targetAngle, angleBefore);
  room.stop();
});

test('death sends match_end, respawn creates a new fish', () => {
  const room = new Room(makeConfig());
  const a = new FakeSocket();
  const b = new FakeSocket();
  const pa = joinOk(room, a, { name: 'Alice' });
  const pb = joinOk(room, b, { name: 'Bob' });

  room.game.killFish(pa.fish!, pb.fish!, room.game.bots);
  tick(room, 4); // snapshot cadence is every 3 ticks at 20 Hz

  const end = b.last('match_end') as MatchEndMessage | undefined;
  assert.ok(end, 'Bob received match_end');
  assert.equal(end!.reason, 'dead');
  assert.equal(pb.alive, false);
  assert.equal(pb.fish, null);

  // Victim is gone from Alice's snapshots and she got a kill event.
  const snap = a.last('snap') as SnapshotMessage | undefined;
  assert.ok(snap);
  assert.ok(!snap!.p.some((f) => f.id === pb.id), 'dead fish no longer in snapshots');
  assert.ok(socketHasKill(a, pb.id), 'kill event mentions Bob');

  // Respawn.
  b.sent.length = 0;
  room.onMessage(pb, { t: 'respawn' });
  const spawn = b.last('spawn') as FullStateMessage | undefined;
  assert.ok(spawn, 'spawn message received');
  assert.ok(spawn!.you, 'spawn has you state');
  assert.equal(pb.alive, true);
  room.stop();
});

test('fresh spawns are protected, and attacking clears the attacker protection', () => {
  const room = new Room(makeConfig());
  const a = new FakeSocket();
  const b = new FakeSocket();
  const pa = joinOk(room, a, { name: 'Alice' });
  const pb = joinOk(room, b, { name: 'Bob' });
  const fa = pa.fish!;
  const fb = pb.fish!;

  assert.ok(fa.invulnerableTimer > 3, 'Alice spawns protected');
  assert.ok(fb.invulnerableTimer > 3, 'Bob spawns protected');

  const parkUnderBlade = (attacker: typeof fa, victim: typeof fa) => {
    (victim as any).x = (attacker as any).bladeBase.x + (attacker as any).bladeLength * 0.5;
    (victim as any).y = (attacker as any).bladeBase.y;
    for (const joint of (victim as any).spine) {
      joint.x = (victim as any).x;
      joint.y = (victim as any).y;
    }
  };

  // Blade vs protected body: victim survives.
  parkUnderBlade(fa, fb);
  room.game.handleCollisions([fa, fb]);
  assert.equal(fb.isDead, false, 'protected victim survives');

  // Blade vs vulnerable body: protected attacker kills, then loses protection.
  fb.invulnerableTimer = 0;
  parkUnderBlade(fa, fb);
  room.game.handleCollisions([fa, fb]);
  assert.equal(fb.isDead, true, 'protected attacker can kill');
  assert.equal(fa.invulnerableTimer, 0, 'attacking cleared Alice protection');
  room.stop();
});

function socketHasKill(socket: FakeSocket, victimId: string): boolean {
  return socket.sent.some((m) => Array.isArray(m.ev) && m.ev.some((e: any) => e.k === 'kill' && e.victimId === victimId));
}

test('disconnected fish is kept during grace and reclaimed by token', () => {
  const room = new Room(makeConfig({ reconnectGraceMs: 20_000 }));
  const first = new FakeSocket();
  const player = joinOk(room, first, { name: 'Alice' });
  const id = player.id;
  const token = player.token;

  room.onClose(player, first);
  assert.equal(player.socket, null);

  // Reconnect within grace → same fish, same id, welcome again.
  const second = new FakeSocket();
  const result = room.join(second, hello({ name: 'Alice', token }));
  assert.ok('player' in result);
  assert.equal(result.player.id, id);
  assert.ok(result.player.alive, 'kept the fish');
  assert.ok(second.last('welcome'), 'welcome on reconnect');
  room.stop();
});

test('reconnect resets the input ack window so fresh inputs are accepted', () => {
  const room = new Room(makeConfig());
  const first = new FakeSocket();
  const player = joinOk(room, first);
  const token = player.token;

  room.onMessage(player, { t: 'input', seq: 5, a: 0, b: false });
  assert.equal(player.input.seq, 5);

  room.onClose(player, first);
  const second = new FakeSocket();
  const result = room.join(second, hello({ token }));
  assert.ok('player' in result);

  // A fresh connection restarts seq at 1 — it must not be rejected as stale.
  room.onMessage(player, { t: 'input', seq: 1, a: 1.5, b: true });
  assert.equal(player.input.seq, 1);
  assert.equal(player.input.angle, 1.5);
  assert.equal(player.input.boost, true);
  room.stop();
});

test('disconnected fish is removed after the grace expires', async () => {
  const room = new Room(makeConfig({ reconnectGraceMs: 10 }));
  const socket = new FakeSocket();
  const player = joinOk(room, socket);

  room.onClose(player, socket);
  await new Promise((r) => setTimeout(r, 25));
  tick(room, 1);

  assert.equal(room.players.size, 0);
  assert.equal(room.game.bots.length, 0);
  room.stop();
});

test('room rejects players beyond maxPlayers', () => {
  const room = new Room(makeConfig({ maxPlayers: 2 }));
  joinOk(room, new FakeSocket());
  joinOk(room, new FakeSocket());
  const result = room.join(new FakeSocket(), hello({ name: 'Third' }));
  assert.deepEqual(result, { error: 'room_full' });
  room.stop();
});

test('message flood closes the connection', () => {
  const room = new Room(makeConfig({ maxMessagesPerSecond: 5 }));
  const socket = new FakeSocket();
  const player = joinOk(room, socket);

  for (let i = 1; i <= 10; i++) room.onMessage(player, { t: 'input', seq: i, a: 0, b: false });
  assert.equal(socket.closed?.code, 4008);
  assert.equal(player.socket, null);
  room.stop();
});

test('nearby food is delta-encoded (add on entry, del on leaving interest)', () => {
  const room = new Room(makeConfig());
  const socket = new FakeSocket();
  const player = joinOk(room, socket);

  // Shrink interest and teleport to the center: the welcome seed is now stale,
  // so the next snapshot must both add new nearby food and remove the old.
  player.interests = 300;
  player.lastPos = { x: 2000, y: 2000 };
  player.fish!.x = 2000;
  player.fish!.y = 2000;
  tick(room, 3);

  const first = socket.last('snap') as SnapshotMessage | undefined;
  assert.ok(first);
  const added = new Set((first!.add.food ?? []).map((f) => f.id));
  assert.ok(added.size > 0, 'nearby food added at the new position');
  assert.ok((first!.del.food ?? []).length > 0, 'food near the spawn removed from view');

  // Teleport far away: the food added above must now be removed.
  player.lastPos = { x: 3600, y: 3600 };
  player.fish!.x = 3600;
  player.fish!.y = 3600;
  tick(room, 3);
  const later = socket.last('snap') as SnapshotMessage | undefined;
  assert.ok(later?.del.food?.length, 'food removed after leaving interest');
  room.stop();
});

test('shutdown broadcasts bye and clears players', () => {
  const room = new Room(makeConfig());
  const socket = new FakeSocket();
  joinOk(room, socket);
  room.shutdown('server_shutdown');
  const bye = socket.last('bye');
  assert.ok(bye);
  assert.equal(bye!.reason, 'server_shutdown');
  assert.equal(room.players.size, 0);
  assert.equal(socket.closed?.code, 1001);
});

test('room tickets verify cross-app and link arena sessions to accounts', () => {
  const secret = 'ticket-secret';

  // Format compatibility: API signs, room verifies.
  const ticket = signRoomTicket(secret, 'user-1', 'alice', 60_000);
  assert.equal(verifyRoomTicket(secret, ticket)?.u, 'user-1', 'cross-app ticket format');

  const room = new Room(makeConfig({ internalHmacSecret: secret }));
  const socket = new FakeSocket();
  const player = joinOk(room, socket, { ticket });
  assert.equal(player.accountId, 'user-1');
  assert.equal(player.username, 'alice');
  assert.equal(room.roster()[0]?.account, 'user-1');

  // Forged/expired tickets fall back to guest play, never to another account.
  const guestSocket = new FakeSocket();
  const guest = joinOk(room, guestSocket, { ticket: 'forged.ticket' });
  assert.equal(guest.accountId, null);
  const expired = signRoomTicket(secret, 'user-2', 'bob', -1000);
  const expiredSocket = new FakeSocket();
  const expiredPlayer = joinOk(room, expiredSocket, { ticket: expired });
  assert.equal(expiredPlayer.accountId, null, 'expired tickets are guests');
  room.stop();
});

test('deaths post signed, server-authored results and relay the receipt', async () => {
  const secret = 'report-secret';
  const received: Array<{ body: string; signature: string }> = [];
  const api = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      received.push({ body: data, signature: String(req.headers['x-fishio-signature'] ?? '') });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          matchId: 'm-1',
          reward: { amount: 7 },
          receipt: { status: 'submitted', hashscanUrl: 'https://hashscan.example/tx' },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
  const port = (api.address() as { port: number }).port;

  const room = new Room(
    makeConfig({ internalHmacSecret: secret, apiUrl: `http://127.0.0.1:${port}`, reportTimeoutMs: 3000 }),
  );
  try {
    const killerSocket = new FakeSocket();
    const victimSocket = new FakeSocket();
    const killer = joinOk(room, killerSocket, { name: 'Killer' });
    const victim = joinOk(room, victimSocket, {
      name: 'Victim',
      ticket: signRoomTicket(secret, 'user-9', 'victim'),
    });

    room.game.killFish(killer.fish!, victim.fish!, room.game.bots);
    tick(room, 2);

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !victimSocket.last('match_receipt')) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const receipt = victimSocket.last('match_receipt');
    assert.ok(receipt, 'receipt relayed to the player');
    assert.equal(receipt!.matchId, 'm-1');
    assert.equal(receipt!.reward.amount, 7);
    assert.equal(receipt!.receipt.status, 'submitted');

    assert.equal(received.length, 1, 'exactly one signed report');
    assert.equal(verifyInternalBody(secret, received[0]!.body, received[0]!.signature), true, 'signature valid');
    const parsed = JSON.parse(received[0]!.body) as { userId: string; stats: { score: number; kills: number } };
    assert.equal(parsed.userId, 'user-9');
    assert.equal(typeof parsed.stats.score, 'number');
  } finally {
    room.stop();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
