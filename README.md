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
| Real-time multiplayer (common map) | [`docs/MULTIPLAYER_PLAN.md`](docs/MULTIPLAYER_PLAN.md) | **M1 playable prototype** — authoritative room server + WebSocket net client (prediction/interpolation) |

**Multiplayer is humans-only.** Bots exist only in offline practice mode (the current game).

## Layout

```
apps/
  web/          the game (vanilla canvas + JS, served statically)
  api/          backend: Fastify + TypeScript, SQL schema, seeds
  room-server/  M1 realtime arena: WebSocket + headless game-core @60 Hz
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

## Play online (M1 prototype)

The room server runs the same simulation as the browser (via `packages/game-core`)
at 60 Hz and owns all positions, kills and pickups. Clients send inputs only.

```powershell
npm install
npm run room:dev          # arena on ws://127.0.0.1:8787 (health: http://127.0.0.1:8787/healthz)
npm run dev               # in a second terminal: website on http://127.0.0.1:8080
```

Open http://127.0.0.1:8080 in **two tabs**, enter a name, and press
**PLAY ONLINE 🌐**. Tabs can also point at another arena with `?room=ws://host:port`
or `window.FISHIO_ROOM_URL`.

M1 behaviour: continuous humans-only arena (up to 16 by default), local prediction +
snapshot reconciliation (~125 ms smoothing), remote fish interpolated 100 ms behind,
delta-encoded food/chests around each player, 20 s reconnect grace, kill feed, live
leaderboard and ping. Death shows results with a respawn button. Bosses and AI fish
never spawn online.

Tests: `npm run room:test` (protocol, prediction inputs, deaths, reconnect, flood
protection, real two-client WebSocket game) · `npm run room:typecheck`.

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

**Currency: `$GOLD` only (testnet).** Signed-in players hold an in-game `$GOLD`
balance on the server (append-only ledger, `GET /api/v1/hedera/gold`): matches, daily
gifts, the lucky wheel (one spin/day) and stage clears credit it instantly; the Armory
and Workshop spend it instantly. **Rewards are uncapped and scale with level**
(`score/100 + kills×(5+level/3) + (level−1)×8 + chests×4`), while prices are
**tier-based** with ~4× jumps, so grinding levels raises income and top gear still
takes months:

| Tier | Weapons | Fish |
|---|---|---|
| T0 | 10–25 | 10–25 |
| T1 | 100–250 | 100–250 |
| T2 | 1k–2.5k | 1k–2.5k |
| T3 | 10k–50k | 10k–60k |
| T4 | 200k–600k | 250k–1M |

Hats stay cosmetic (10–2,500). Workshop upgrades: 100/400/1,500/6,000/25,000 per level.
**Withdraw** moves `$GOLD` on-chain to the player's custodial wallet
(`POST /api/v1/hedera/gold/withdraw`, HashScan link); **Deposit** brings it back
(`POST /api/v1/hedera/gold/deposit`). NFTs mint from owned items as before. Guests keep
a clearly-separate practice 💰 that can never convert.

**Leaderboards & power:** `GET /api/v1/leaderboard?type=score|gold|power` —
Score, **most `$GOLD`**, and **Combat Power** (weapon tier + fish tier + workshop
levels + best match level; shown on the menu and in the account panel). The in-game
modal has the three tabs.

**M4 — online matches count:** signed-in players get a short-lived signed **room ticket**
(`POST /api/v1/hedera/room-ticket`) that travels in the arena `hello`. When they die, the
room server posts the server-authored result to `POST /internal/matches`
(HMAC-signed with `INTERNAL_HMAC_SECRET`) — the same HCS attestation + `$GOLD` credit
pipeline as offline play, and the game-over screen shows the HashScan receipt via a
`match_receipt` follow-up. Guests play normally with no ticket.

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

**Wallets:** every account automatically gets an operator-funded Hedera wallet
(keys encrypted at rest with `WALLET_ENCRYPTION_KEY`, AES-256-GCM) with
auto-association slots, so rewards land as real balances. Players can export the
private key from the account panel (password-confirmed) and import it into
HashPack/Blade; linking their own wallet takes over as the payout target. Turn
auto-wallets off with `HEDERA_AUTO_WALLETS=false`; repair pending airdrops with
`npm run hedera:claim -- --account 0.0.x --token 0.0.y`.

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
