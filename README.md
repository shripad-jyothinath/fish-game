# Fish.IO — web3 .io game on Hedera

Browser .io game (HTML5 canvas): slice rivals with your blade, eat sushi, grow, smash chests, beat
bosses. This repo turns it into a full project: **server-authoritative multiplayer**, a
**multi-player database**, and **Hedera** for tokens, NFTs, and verifiable match records.

## Status

> **New session / new agent? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first — it is the full project state and next actions.**

| Track | Doc | State |
|---|---|---|
| Hedera integration (tokens, NFTs, HCS) | [`docs/HEDERA_PLAN.md`](docs/HEDERA_PLAN.md) | Planned |
| Database for many players | [`docs/DATABASE_PLAN.md`](docs/DATABASE_PLAN.md) | Schema v1 written (`apps/api/db/schema.sql`) |
| Real-time multiplayer (common map) | [`docs/MULTIPLAYER_PLAN.md`](docs/MULTIPLAYER_PLAN.md) | M0 in progress (headless game-core) |

**Multiplayer is humans-only.** Bots exist only in offline practice mode (the current game).

## Layout

```
apps/
  web/          the game (vanilla canvas + JS, served statically)
  api/          backend: Fastify + TypeScript, SQL schema, seeds
packages/
  game-core/    headless simulation harness + catalog export (server-ready sim)
  shared/       shared types/constants (added as needed)
archive/        old prototype (not maintained)
docs/           plans & architecture decision records
```

## Run the game (current build)

```powershell
npm run web:serve         # serves apps/web on http://127.0.0.1:8137
# or any static file server pointed at apps/web, or open apps/web/index.html directly
```

Controls: mouse/WASD steer · Space/Shift/left-click boost · blade slices fish.

## Run the headless simulation (game-core)

```powershell
npm run game-core:sim                          # 5-minute bot match, prints a summary
npm run game-core:test                         # determinism + invariants tests
```

The harness loads the real game scripts in a Node `vm` with DOM stubs and a seeded RNG, so a full
match runs deterministically without a browser. This is the foundation for the room server.

## Database (dev)

Schema v1: [`apps/api/db/schema.sql`](apps/api/db/schema.sql) · catalog seed:
`node apps/api/db/seed.mjs` requires Docker to start Postgres/Redis:

```powershell
docker compose up -d        # postgres:16 + redis:7 (ports 5432 / 6379)
```

## Decisions log

Defaults adopted for the build (change any time):

1. Audience: mainstream, guest-first; wallet optional.
2. Postgres managed later; local dev via Docker; raw SQL migrations first.
3. Currency: soft gold in DB first, `$GOLD` token later.
4. Multiplayer classic rounds: 10 minutes (frenzy: 2 minutes).
5. Rooms: target 32 players, cap 40, **humans only**, `minPlayers = 4` to start.
6. Offline practice mode with bots stays in `apps/web`.
7. Chat: emotes only (later). First region: configurable, single region at launch.
