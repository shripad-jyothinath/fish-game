/**
 * Fish.IO room server entry point.
 *
 * One process = one arena (M1). Serves:
 *   GET /healthz   JSON room status
 *   WS  /          the game protocol
 *
 * Run:  npm run room:dev        (from repo root)
 * Env:  see apps/room-server/src/config.ts
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, type RoomServerConfig } from './config.ts';
import { Room, type ClientSocket, type PlayerRecord } from './room.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

const HELLO_TIMEOUT_MS = 8_000;

export interface RoomServerHandle {
  room: Room;
  httpServer: http.Server;
  wss: WebSocketServer;
  /** Actual listening port (useful when config.port is 0 in tests). */
  port: number;
  close(): Promise<void>;
}

function socketAdapter(ws: WebSocket): ClientSocket {
  return {
    send(data: string) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close(code?: number, reason?: string) {
      try {
        ws.close(code ?? 1000, reason ?? '');
      } catch {
        /* ignore */
      }
    },
  };
}

export async function startServer(config: RoomServerConfig = loadConfig()): Promise<RoomServerHandle> {
  const room = new Room(config);

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url?.startsWith('/healthz?')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, v: PROTOCOL_VERSION, ...room.stats(), roster: room.roster() }));
      return;
    }
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `Fish.IO room server (M1)\nroom: ${config.roomName}\nwebocket clients: ${room.stats().online}/${config.maxPlayers}\n`,
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 8 * 1024 });

  wss.on('connection', (ws) => {
    const socket = socketAdapter(ws);
    let player: PlayerRecord | null = null;

    const helloTimer = setTimeout(() => {
      if (!player) socket.close(4001, 'hello timeout');
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    ws.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch {
        return; // ignore malformed frames
      }
      if (!msg || typeof msg !== 'object') return;
      const typed = msg as Record<string, unknown>;

      if (!player) {
        if (typed.t !== 'hello') return; // first message must be hello
        clearTimeout(helloTimer);
        const result = room.join(socket, typed);
        if ('error' in result) {
          socket.send(JSON.stringify({ t: 'error', code: result.error }));
          socket.close(4003, result.error);
          return;
        }
        player = result.player;
        return;
      }

      room.onMessage(player, typed);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (player) room.onClose(player, socket);
    });

    ws.on('error', () => {
      /* close event follows */
    });
  });

  room.start();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    room,
    httpServer,
    wss,
    port,
    async close() {
      room.shutdown('server_shutdown');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const config = loadConfig();
  const server = await startServer(config);
  console.log(
    `[room] "${config.roomName}" listening on http://${config.host}:${server.port} ` +
      `(ws://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${server.port}) — max ${config.maxPlayers} players`,
  );

  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      console.log(`[room] ${signal} received, shutting down`);
      void server.close().then(() => process.exit(0));
    });
  }
}
