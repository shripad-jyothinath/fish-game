/**
 * Room behaviour tests (no real sockets): join, input, death/respawn,
 * disconnect grace + reconnect, flood protection, validation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomServerConfig } from '../src/config.ts';
import { Room, type ClientSocket } from '../src/room.ts';
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
