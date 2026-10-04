# Fish.IO — web3 .io game on Hedera

Browser .io game (HTML5 canvas): slice rivals with your blade, eat sushi, grow, smash chests, beat
bosses. This repo turns it into a full project: **server-authoritative multiplayer**, a
**multi-player database**, and **Hedera** for tokens, NFTs, and verifiable match records.

## Status

> **New session / new agent? Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first — it is the full project state and next actions.**

| Track | Doc | State |
|---|---|---|
| Hedera integration (tokens, NFTs, HCS) | [`docs/HEDERA_PLAN.md`](docs/HEDERA_PLAN.md) | **Live on testnet** — HCS match receipts, `$GOLD`, NFT collection created; IDs in `apps/api/.env` |
| Database for many players | [`docs/DATABASE_PLAN.md`](docs/DATABASE_PLAN.md) | Schema v1 + local SQLite accounts (sign-up/login/save sync) |
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

## Run the website (with accounts)

```powershell
npm install
npm run dev               # website + API on http://127.0.0.1:8080
```

`npm run dev` serves `apps/web` and the API from one origin, so session cookies and
progress sync just work — open http://127.0.0.1:8080.

- Guests can play without an account (progress kept in the browser).
- **Sign up / log in** from the top-right of the menu: gold, unlocks, and stage
  progress follow the account and restore on any device.
- Accounts live in a local SQLite file (`apps/api/data/fishio.db`); Postgres
  remains the production target. Delete that file to wipe local accounts.
- Static-only serving still works via `npm run web:serve` on :8137, but account
  features need the API.

Controls: mouse/WASD steer · Space/Shift/left-click boost · blade slices fish.

**Presentation:** the menu showcase and shop thumbnails are real 3D previews —
procedurally modeled weapons (25), fish (24) and hats (12) rendered with Three.js
(BSD/MIT, vendored in `apps/web/vendor/`, no external assets). If WebGL is
unavailable the UI falls back to the original 2D/emoji icons automatically.

## Hedera (testnet)

The website is fully wired for Hedera; with no credentials it runs in a clean
offline mode (matches are still recorded locally). To go live:

1. Create a free testnet account at https://portal.hedera.com (comes funded with HBAR).
2. Put the account id + DER private key in `apps/api/.env`:
   ```env
   HEDERA_NETWORK=testnet
   HEDERA_OPERATOR_ID=0.0.xxxxx
   HEDERA_OPERATOR_KEY=303...
   ```
3. Run the one-command setup (creates the HCS topic, `$GOLD` token and NFT collection):
   ```powershell
   npm run hedera:setup -- --write-env
   ```
4. Restart `npm run dev`. Every finished match is attested on HCS with a HashScan
   link in the game-over screen, awards pending `$GOLD`, and the account panel can
   link a wallet (`0.0.x` proof-of-ownership transfer) to claim `$GOLD` and mint
   owned cosmetics as NFTs.

`npm run hedera:setup -- --demo-account` also creates a funded throwaway account
and sends it `$GOLD` + an NFT as an end-to-end proof. Everything is reversible:
delete the ID lines from `.env` to return to offline mode.

| On-chain feature | Hedera service |
|---|---|
| Match receipts (public leaderboard links) | HCS topic, auto-created |
| `$GOLD` rewards (accrue per match, claim to wallet) | HTS fungible token, auto-created |
| Cosmetic NFTs (mint owned items, HIP-412 metadata, per-serial art) | HTS NFT collection, auto-created |
| Wallet linking | Proof-of-ownership transfer (signature method ready for WalletConnect) |

**Limited editions:** the **Golden Leviathan is 1-of-1** by default — the first
player to mint it gets the only copy, enforced by an atomic reservation before
the Hedera mint. Add more caps with a JSON env var:
`HEDERA_EDITION_LIMITS={"golden_leviathan":1,"megalodon":5}`. Each copy gets its
own metadata URL and art variation (colored + "EDITION #N") by serial.

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
8. Local-dev accounts: SQLite (`better-sqlite3`) on the same Fastify server that hosts the
   website; email + password (scrypt) with cookie sessions. Postgres remains the production target.
