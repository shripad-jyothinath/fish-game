# Fish.IO room server (M1)

Authoritative real-time arena. One process = one 4000×4000 map with up to
`ROOM_MAX_PLAYERS` humans. The server runs the **same simulation code as the
browser** (`@fishio/game-core` loads `apps/web/src/*.js` in a headless VM) at a
fixed 60 Hz and owns every position, kill and pickup. Clients only send inputs.

## Run

```powershell
npm install
npm run room:dev            # from repo root → ws://127.0.0.1:8787
curl http://127.0.0.1:8787/healthz
```

Then serve the game (`npm run dev` → http://127.0.0.1:8080) and press
**PLAY ONLINE 🌐**. Point a client at a different arena with
`?room=ws://host:port` or `window.FISHIO_ROOM_URL`.

## Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `ROOM_HOST` / `ROOM_PORT` | `0.0.0.0` / `8787` | listen address |
| `ROOM_MAX_PLAYERS` | `16` | humans per arena (no bots, ever) |
| `ROOM_TICK_RATE` | `60` | simulation frames/second (game-core dt unit) |
| `ROOM_SNAPSHOT_RATE` | `20` | snapshots/second per client |
| `ROOM_SEED` | `0` (random) | deterministic arena seed |
| `ROOM_RECONNECT_GRACE_MS` | `20000` | keep a disconnected player's fish before removing |
| `ROOM_MAX_MSGS_PER_SEC` | `120` | flood limit per connection |
| `ROOM_NAME` | `reef-1` | label in logs/health |

## Protocol (JSON over WebSocket; binary lands in M2)

Client → server: `hello` (name, cosmetics, workshop upgrades, viewport, optional
reconnect token), `input` `{seq, a (angle), b (boost)}` at 30 Hz, `respawn`,
`ping`, `leave`.

Server → client: `welcome`/`spawn` (full state), `snap` at 20 Hz (`you`, all
player states, delta-encoded nearby `add`/`del` food/chests/powerups, `ev`
events, periodic `lb` leaderboard), `match_end`, `pong`, `bye`.

Trust model: the server clamps/validates every message (angle finite, seq
monotonic, name length, cosmetic/upgrade ids against the game catalog, message
rate, max payload 8 KB). Upgrade levels are capped at the workshop maximums.

## Tests

```powershell
npm run room:test           # 12 tests: room behaviour + real 2-client WebSocket game
npm run room:typecheck
```

## M1 scope / known limits

- Continuous endless arena (respawn on death). Round-based matches → M2.
- One room per process; no matchmaking/room director/Redis → M3.
- No account save/Hedera rewards for online matches → M4 (`/internal/matches` is still a stub).
- JSON snapshots; interest management is radius-based, all players are broadcast.
