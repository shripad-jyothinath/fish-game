# HANDOFF — read this first if you are a new agent/session

You are picking up **Fish.IO** at `C:\Users\USER\Downloads\fish-0`. This file is the complete state
of the project. Read it, then continue from "NEXT ACTIONS". Do not re-do finished work.

Last session summary: fixed + balanced the game, wrote 3 plans, scaffolded the monorepo, built a
headless simulation harness, and started the API skeleton. No git commit yet. Two background tasks
may be in flight (npm install, sim run) — verify before assuming.

---

## 1. What this project is

A browser .io game (HTML5 canvas) being turned into a web3 project on **Hedera**:
server-authoritative **real-time multiplayer (humans only, no bots)**, a Postgres/Redis backend for
many players, and Hedera tokens/NFTs/HCS for rewards and verifiable records.

Plans (read the relevant one before touching an area):
- `docs/HEDERA_PLAN.md` — wallets, `$GOLD` HTS token, NFT cosmetics, HCS match attestation, compliance.
- `docs/DATABASE_PLAN.md` — full schema, integrity rules, Redis map, phases DB-0…DB-5.
- `docs/MULTIPLAYER_PLAN.md` — room servers, protocol, matchmaking, phases M0…M5.
- `docs/adr/0001-headless-game-core.md` — why the vm harness exists.

Decisions already locked (see README "Decisions log"); the user explicitly requires **no bots in
multiplayer rooms** (bots only in offline practice mode in `apps/web`).

---

## 2. Repo layout (current)

```
apps/
  web/                    the game (vanilla JS) — moved here from repo root
    index.html, style.css
    src/{audio,particles,food,shop,entities,ai,game}.js
  api/                    Fastify + TS skeleton
    src/{index.ts,config.ts}
    db/schema.sql         database schema v1 (complete DDL)
    db/seed.mjs           generates db/seeds/001_catalog.sql from game-core catalog
    .env.example, tsconfig.json, package.json
packages/
  game-core/              headless deterministic sim (M0) — THE critical piece
    src/dom-stubs.js      DOM/canvas/storage stubs
    src/harness.js        vm loader, seeded RNG, virtual timers, runMatch/stateHash
    src/index.js          exports
    bin/sim.js            CLI: runs a full match headless
    test/sim.test.js      node:test — catalog, determinism, 5-min match, god mode
archive/index-simple.html old prototype (not maintained)
docs/…                    plans + ADR + this file
root: package.json (npm workspaces: apps/*, packages/*), tsconfig.base.json, docker-compose.yml,
      README.md, .gitignore (git repo initialized, NOTHING COMMITTED YET)
```

## 3. Game state (apps/web) — what was changed and why

The game itself came from https://github.com/shripad-jyothinath/fish-game (public, cloned). It is
"Fish IO: Be The King": 14 weapons, 24 fish species, 12 hats, shop, 15 stage challenges, bosses,
maps, frenzy mode. Two sets of fixes were applied:

1. **Crash fix:** `src/game.js` referenced a nonexistent `#levelModal` (2 places) which made PLAY
   throw. Now it runs `document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'))`.
2. **Balance / tier system** (user complaint: day-1 bots used endgame swords):
   - `src/shop.js`: 5 cost-based tiers auto-built — `WEAPON_TIERS`, `FISH_TIERS`, `GEAR_TIER_NAMES`;
     `window.getWeaponTier(id)`, `window.getFishTier(id)`.
     Tier map (verified): T0 coral/wooden/iron · T1 katana/trident/sabre · T2 laser/saw/ice ·
     T3 magma/excalibur/thunder · T4 chainsaw/dragon_horn.
   - `src/game.js`: `getMatchProgress()` (player level + match time + equipped weapon tier),
     `getMaxBotTier()`, `pickBotTier()`, `pickBotGear()`, `updateBotGear(dt)` (bots upgrade gear every
     3 levels up to the match cap, with gold sparkle), league-up announcements, leaderboard `Lv.N`
     badge, player spawn invulnerability 2.0 → 3.5s.
   - Challenge stages: bot gear scales with stage (`(level-1)/14`); Stage 1 all tier-0; bosses keep
     signature weapons.
   - Verified in browser: stage 1 = 18/18 tier-0; late game (progress 1.0) = tier-4 bots appear;
     no console errors.

Controls: mouse/WASD steer, Space/Shift/left-click boost. Bots stay in this offline game (fine).

**Useful testing trick:** the game is accessible as the bare global `game` inside the page
(NOT `window.game`). `browser.evaluate` awaits promises, so you can drive it with
`for (let i=0;i<900;i++){ game.player.targetAngle=…; game.update(1); }`.
The test browser throttles rAF to 1 fps when its window is occluded — that is NOT a game bug;
step `update(1)` manually to test at full speed.

localStorage save key: `fishio_savedata_v4`.

## 4. game-core harness (packages/game-core) — current status

- Loads the 7 real game scripts in a Node `vm` context, in order, with DOM stubs, virtual
  timers/clock, and a seeded mulberry32 `Math.random`. Host `Math` is untouched.
- `loadGame({seed, scripts})` → harness; `createGame()` strips `updateHUD/renderMinimap/render`.
- `runMatch({seed, frames, mode, godMode, steer})` → summary incl. `hash` (sha1 of world state).
- `catalog()` returns real `weaponSkins/fishSkins/fishHats/upgrades/levelChallenges/weaponTiers/fishTiers`.
- Tests: `test/sim.test.js` (catalog, same-seed identical, diff-seed differs, 5-min match sane+fast,
  god-mode survival, hash stability). **These had not been run to completion yet** — see NEXT ACTIONS.
- If the harness throws: most likely a missing DOM/API stub — extend `src/dom-stubs.js` (checked:
  the game only uses `getElementById`, `querySelectorAll`, `requestAnimationFrame`, `setTimeout`,
  `localStorage`; audio init is wrapped in try/catch so no AudioContext stub is needed).

## 5. API skeleton (apps/api) — current status

- Fastify v5 TS (native Node type-stripping, no build step): `node src/index.ts`.
- Routes: `/healthz`, `/api/v1/status`, and 501 stubs for auth challenge/verify, `/internal/matches`,
  `/api/v1/leaderboard`.
- `db/schema.sql`: complete v1 DDL (identity, catalog, gameplay incl. partitioned `match_events`,
  economy incl. append-only `ledger_entries`, progression, ops). `match_participants` uses a
  surrogate id + partial unique indexes because `account_id` is nullable.
- `db/seed.mjs`: `node apps/api/db/seed.mjs` writes `db/seeds/001_catalog.sql` from game-core catalog
  (needs no DB). Not run yet.
- No DB driver yet (deliberately): Prisma/Drizzle comes with DB-1. Docker is NOT installed on this
  machine — `docker-compose.yml` (postgres:16 + redis:7, schema auto-applied) is provided for later.

## 6. Environment gotchas (this machine)

- **PowerShell blocks `npm.ps1`** → always use `npm.cmd …` (e.g., `npm.cmd install`, `npm.cmd run …`).
- pnpm not installed (using npm workspaces). docker not installed. Node v24.14.0, npm 11.9.0, git 2.53.
- Local web server (if running): `python -m http.server 8137 --bind 127.0.0.1 -d apps/web`
  → http://127.0.0.1:8137 (was restarted to point at `apps/web` after the move; if dead, restart).
- To hit the browser: file:// URLs are NOT allowed; use http://127.0.0.1:8137. Screenshots need the
  desktop browser window visible; eval/console work regardless.
- Do not chain shell commands noisily; prefer running from the repo root with explicit paths.

## 7. Background tasks that may have completed or died (verify, don't assume)

| Shell ID | Command | Meaning |
|---|---|---|
| `sh_105178b08001WURpVLq4rEVZi2` | `node packages/game-core/bin/sim.js` | ✅ DONE — 18000 frames OK; ~10.6 ms/frame first run; `bin/profile.js` shows 7.16 ms/frame avg (vm overhead, tracked) |
| `sh_105198abc001Pw0OHZdawypWJF` | `npm.cmd install --no-audit --no-fund` | ✅ DONE (53 packages, 35s) |
| `sh_105198abc002h1P3zJpjlG76J5` | stop old server + `python -m http.server … -d apps/web` | dev server on :8137 (old server killed, new one started) |

Check: `node_modules/` exists, `package-lock.json` exists, port 8137 listening.

## 8. NEXT ACTIONS

### Done and verified (last session)
- ✅ `npm.cmd install` (53 packages); `npx tsc --noEmit -p apps/api` → clean.
- ✅ game-core tests pass (`npm.cmd run game-core:test`): catalog export, same-seed determinism,
  seed divergence, long match sanity, god-mode survival, stateHash stability, **bot tier gating**.
  Note: suite takes ~2 min because heavy tests run under `vm` — that is expected for now.
- ✅ Sim runs end-to-end: `npm.cmd run game-core:sim` → 18000 frames, sane world state, stable hash.
- ✅ Perf profiled: `node packages/game-core/bin/profile.js` → ~7.2 ms/frame avg (max ~27 ms), no
  runaway arrays. Root cause is Node `vm` context overhead + per-frame scans; fix path is the ADR
  follow-up (extract `entities.js`/`ai.js` into real ES modules). Server math: a 30 Hz room costs
  ≈ 7 ms/tick ≈ 21% of one core → expect 1–2 rooms/process until that optimization lands.
- ✅ Catalog seed works: `node apps/api/db/seed.mjs` → `apps/api/db/seeds/001_catalog.sql` (50 items).
- ✅ Audio warning solved headlessly: `SoundEngine.prototype.init` is a no-op in the harness.

### Next
1. **First git commit** (repo has none yet):
   `git add -A; git commit -m "M0: headless game-core, monorepo scaffold, API skeleton + DB schema v1"`.
   `db/seeds/001_catalog.sql` is generated — recommended to commit it for now (revisit later).
2. **M1 room server** (`apps/room-server`): Node WebSocket server + 2 real clients on one map.
   Server tick calls `game.update(1)` at 30 Hz; clients send inputs only; snapshots at 20 Hz.
   JSON protocol first, binary later. Follow `docs/MULTIPLAYER_PLAN.md` §5–§8. **Humans only.**
3. **Perf task (tracked):** extract `entities.js` + `ai.js` into `packages/game-core/sim/` ES modules
   (browser consumes via a small build step). Target < 1 ms/frame. Keep determinism tests green.
4. **CI:** GitHub Actions — `npm ci`, `npm run game-core:test`, `npm run api:typecheck`.
5. **DB-1** once a database exists (Docker or Supabase): accounts/sessions + match submit against
   `apps/api/db/schema.sql`.
6. Optional: silence the slow per-frame `innerHTML` in `updateLeaderboard` headlessly (strip it like
   `updateHUD`), may shave a little time in tests.

## 9. Things future-you must not forget

- **No bots in multiplayer rooms** (user requirement). Bots only in offline practice in `apps/web`.
- Keep the browser game working after every change to `apps/web/src/*` — the harness loads those
  exact files, so a change there affects tests too.
- Tier system is validated; don't "simplify" it without re-running the sim tests.
- All three plan docs have `[verify]` tags for Hedera facts (wallet package name, VRF, endpoints,
  fees) — confirm against current docs before implementing those parts.
- The lucky wheel must never be purchasable with money/tokens (gambling-law risk) — see HEDERA_PLAN §8.
- The economy docs assume a **double-entry, append-only ledger**; never UPDATE balances without a
  ledger row.
- Decisions from the user so far: "let's do this" (proceed with recommended defaults) and
  "no bots in multiplayer". Everything else in the Decision lists is still soft — confirm when it
  becomes relevant, don't block.

## 10. Suggested opening message for the next session

> Read `docs/HANDOFF.md` in C:\Users\USER\Downloads\fish-0 and continue from NEXT ACTIONS.
> This conversation is a continuation of the Fish.IO × Hedera project.
