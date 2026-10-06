/**
 * End-to-end wire test: two real WebSocket clients join through the server
 * and play together (welcome → snapshots → input → movement → ping/pong).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket as NodeWebSocket } from 'ws';
import { startServer } from '../src/index.ts';
import type { RoomServerConfig } from '../src/config.ts';

// Node 22+ exposes a global WebSocket; Node 20 needs the `ws` package.
const WS: any = (globalThis as any).WebSocket ?? NodeWebSocket;

function makeConfig(overrides: Partial<RoomServerConfig> = {}): RoomServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    maxPlayers: 4,
    tickRate: 60,
    snapshotRate: 20,
    seed: 99,
    reconnectGraceMs: 5_000,
    maxMessagesPerSecond: 120,
    roomName: 'wire-test',
    ...overrides,
  };
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`failed to connect to ${url}`)));
  });
}

function next(ws: WebSocket, match: (message: any) => boolean, timeoutMs = 4_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for a matching message'));
    }, timeoutMs);
    function onMessage(event: any) {
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (match(message)) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve(message);
      }
    }
    ws.addEventListener('message', onMessage);
  });
}

test('two clients join and play through the wire protocol', async () => {
  const server = await startServer(makeConfig());
  const url = `ws://127.0.0.1:${server.port}`;
  let a: WebSocket | null = null;
  let b: WebSocket | null = null;

  try {
    a = await open(url);
    b = await open(url);

    a.send(JSON.stringify({ t: 'hello', name: 'Alice', skin: 'baby_shark', weapon: 'coral_dagger', hat: 'none', vw: 1280, vh: 720 }));
    const welcomeA = await next(a, (m) => m.t === 'welcome');
    b.send(JSON.stringify({ t: 'hello', name: 'Bob', skin: 'tiger_shark', weapon: 'katana', hat: 'none', vw: 1280, vh: 720 }));
    const welcomeB = await next(b, (m) => m.t === 'welcome');

    assert.ok(welcomeA.id && welcomeB.id && welcomeA.id !== welcomeB.id);
    assert.ok(welcomeA.token && welcomeB.token, 'clients receive reconnect tokens');
    assert.equal(welcomeA.map, 'coral_reef');

    // Both clients get snapshots that contain both players.
    const snapA = await next(a, (m) => m.t === 'snap' && Array.isArray(m.p) && m.p.length >= 2);
    const ids = new Set(snapA.p.map((f: any) => f.id));
    assert.deepEqual(ids, new Set([welcomeA.id, welcomeB.id]));
    await next(b, (m) => m.t === 'snap' && Array.isArray(m.p) && m.p.length >= 2);

    // Input moves the authoritative fish.
    const startX = welcomeA.you.x;
    a.send(JSON.stringify({ t: 'input', seq: 1, a: 0, b: 0 }));
    const moved = await next(a, (m) => m.t === 'snap' && m.you && typeof m.you.x === 'number' && m.you.x > startX + 40, 5_000);
    assert.ok(moved.you.x > startX, `fish moved from ${startX} to ${moved.you.x}`);

    // Ping/pong round trip.
    a.send(JSON.stringify({ t: 'ping', ct: 12_345 }));
    const pong = await next(a, (m) => m.t === 'pong');
    assert.equal(pong.ct, 12_345);
    assert.equal(typeof pong.st, 'number');
  } finally {
    a?.close();
    b?.close();
    await server.close();
  }
});

test('health endpoint reports room status', async () => {
  const server = await startServer(makeConfig());
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.room, 'wire-test');
    assert.equal(body.maxPlayers, 4);
  } finally {
    await server.close();
  }
});
