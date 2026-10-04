# Fish.IO — Real-time Multiplayer Plan (Common Map)

> Companion docs: `docs/DATABASE_PLAN.md`, `docs/HEDERA_PLAN.md`.
>
> Goal: players share the same live arena and compete directly — server-authoritative,
> humans-only rooms (no bots in multiplayer), quick join, and full match persistence.

---

## 1. Player experience

- One **Common Arena per room**: 8–40 real players, one map theme. **Humans only — no bots.**
- Join in < 5 seconds from the menu ("Play" → matchmaking → arena). A short queue window (up to 30 s)
  gathers players so arenas don't start nearly empty.
- Same rules as now: slice with your blade, eat sushi, grow, smash chests, last-fish-standing vibes
  with a classic endless mode and a 2-minute frenzy mode.
- Live leaderboard inside the room; global leaderboard from the database.
- Bots exist **only in offline practice mode**, never in multiplayer rooms.
- If you disconnect, 30-second grace to reconnect to the same fish.

Non-goals for v1: spectating, chat, clans/guilds, cross-region play, 100+ player single shard.

---

## 2. Architecture

```
        ┌──────────────┐   login (wallet/guest)   ┌──────────────────┐
        │   Browser    │ ───────────────────────▶ │   API (Fastify)  │
        │   game +     │                          │  auth/matchmaking│
        │   net client │ ◀───── room ticket ───── │  results intake  │
        └──────┬───────┘                          └────────┬─────────┘
               │  WebSocket (binary)                       │
               ▼                                           ▼
        ┌──────────────────────────────┐          ┌──────────────────┐
        │ Room Director                │          │  PostgreSQL      │
        │ (placement, health, scaling) │          │  Redis (queue,   │
        └──────────┬───────────────────┘          │  registry, LB)   │
                   │                              └────────┬─────────┘
      ┌────────────┴────────────┐                           │
      ▼                         ▼                           ▼
┌───────────────┐        ┌───────────────┐          ┌────────────────┐
│ Room Server A │        │ Room Server B │   ...    │ Reward Worker  │
│ 4 rooms × 40  │        │ 4 rooms × 40  │          │ → ledger, HCS, │
│ authoritative │        │ authoritative │          │   payouts      │
│ @30 Hz        │        │ @30 Hz        │          └────────────────┘
└───────────────┘        └───────────────┘
```

Components:

1. **API** — auth, profile, matchmaking request, room ticket issuance, internal results intake.
2. **Room Director** — knows which room servers are alive (Redis heartbeats), places players in
   rooms with free human slots, asks servers to spin up rooms, drains servers on deploy.
3. **Room Server** — Node/TS process hosting N rooms; each room runs the shared game-core at a
   fixed 30 Hz and owns the truth for its match.
4. **Reward Worker** — consumes finished matches → ledger + DB + HCS + payouts (see DB plan §5).
5. **Client net layer** — input sender, snapshot receiver, prediction/reconciliation, interpolation.

---

## 3. Authority & simulation model

- **Server-authoritative.** Clients send only inputs: `{seq, targetAngle (quantized), boosting}`.
  All positions, collisions, kills, pickups, and rewards are computed server-side.
- **Fixed timestep 30 Hz** (`16.6 ms` per tick is the existing game's unit — the current code already
  simulates in frame units where `dt ≈ 1`; the server runs `game-core.update(1)` per tick, exactly like
  the headless stepping already used for testing).
- **Snapshots at 15–20 Hz**, deltas only.
- **Client prediction** for your own fish (same movement code), **interpolation** for everyone else
  (render ~100 ms behind the latest snapshot with a small buffer).
- **Lag compensation:** per-tick blade history (the code already stores `bladeHistory`) — the server checks
  hits against the victim's last ~100 ms of spine positions, so high-ping players aren't free kills.

Determinism requirements for the shared core:

- No `Math.random()` in simulation paths (inject a seeded RNG per room).
- No DOM/canvas references (`entities.js` render() must stay separate from update()).
- Time comes from the tick, not `Date.now()`.

---

## 4. Shared game core (biggest refactor)

Extract from the current client (`src/entities.js`, `src/ai.js`, movement/food/combat parts of `src/game.js`)
into `packages/game-core`:

```
packages/game-core/
├─ sim/            # Fish, BotController, food, powerups, collisions  (pure)
├─ rules/          # XP curves, tiers, reward rules (shared with API)
├─ net/            # entity state encode/decode, delta helpers
└─ test/           # headless match tests (run a 5-min match in <1s)
```

Client keeps: rendering, particles, audio, input capture, HUD. It imports `game-core` for prediction.
Server imports `game-core` for the real simulation. One codebase, two hosts.

---

## 5. Networking protocol

Transport: **WebSocket** (TCP) with a **binary** protocol (msgpack or a hand-rolled packed buffer).
WebTransport (HTTP/3) is a later option if head-of-line blocking becomes a problem.

### Message types

| Dir | Message | Rate | Payload |
|---|---|---|---|
| C→S | `hello` | once | room ticket, protocol version, client time |
| S→C | `welcome` | once | player entity id, tick, map, config, full snapshot |
| C→S | `input` | 30 Hz | seq, quantized target angle (u16), boost bit |
| S→C | `snapshot` | 15–20 Hz | tick, ack input seq, entities[] (entered/changed/left) |
| S→C | `event` | on change | kill, eaten, powerup, chest, announcement, leaderboard delta |
| C→S `S→C` | `ping/pong` | 1 Hz | RTT measurement, clock sync offset |
| S→C | `match_end` | once | results, rewards preview |
| C→S | `leave` | once | graceful exit |

### Snapshot format (packed, per entity ~14–20 bytes)

```
snapshot:  u32 tick | u16 ackSeq | u8 count | u8 leftCount
           entities:  u16 id | i16 x,y (relative to last ack, or abs i32 on first sight)
                      u8 angle (256 steps) | u8 radius | u8 flags(boost/shield/dead)
                      u8 level | u8 nameRef (string table) | ...
removals:  u16 id[]
```

- Strings (names) sent once via a string table per connection.
- Entities are sent only when **inside interest range** (see §6) and only if changed.
- Baseline window: server keeps last acked snapshot per client; delta = current − baseline (like Quake 3).

**Bandwidth estimate:** ~30 entities in interest × 20 B × 20 Hz ≈ **12 KB/s down** per client,
~0.5 KB/s up. 40 players share one room: server egress ≈ 0.5 MB/s per full room.

---

## 6. Interest management (large map, many fish)

- Spatial hash grid: cell size ≈ 600 px (blade reach max is ~260 px + body).
- Each tick, for each player collect entities within interest radius = `1.3 × viewport diag`.
- Entering view → full state; leaving → removal message; inside view → delta only.
- Food/pickups are cheap: send only nearby ones; world decoration stays client-side from a seed.
- With 40 fish on a 4600×3400 map, entity counts per client stay ~20–40.

---

## 7. Matchmaking & rooms

- Queues per region + mode: `mmq:classic:eu`, `mmq:frenzy:eu` (Redis ZSET).
- Matchmaker pulls 24–40 players, asks the Room Director for a room with capacity, creates one if needed.
- **Humans only:** no bots are ever added to multiplayer rooms. Lobbies wait for `minPlayers`
  (default 4) via the matchmaking queue; if a player doesn't want to wait, the menu offers
  offline practice mode instead.
- **Join-in-progress:** allowed in classic while the room has free slots; frenzy rejoins the next round.
- Room sizes: target 32, cap 40 players.
- **Leave handling:** a match keeps running while ≥ 2 players remain. A leaving player's fish is
  removed and drops its loot; when only 1 player remains, the match ends (no bot replacement, no overtime).
- Reconnect: room ticket valid 120 s; on reconnect within 30 s, player resumes their fish (if alive) or
  spectates until next round.
- AFK detection: no input for 20 s → idle fish; 60 s → removed exactly like a leave.

---

## 8. Match lifecycle & persistence

```
create room ─▶ lobby window (10 s) ─▶ live match ─▶ end conditions ─▶ results intake
                                        │  every 30 s: checkpoint (room_checkpoints)
                                        │  every kill/eat: event buffer (match_events, sampled)
                                        ▼
                            API /internal/matches  (HMAC-signed by room server)
                                        ▼
                    matches + match_participants (DB) ─▶ Reward Worker ─▶ ledger, HCS, payouts
```

End conditions: frenzy timer (120 s), classic time cap (e.g., 10 min), room population collapse
(fewer than 2 players remaining → finish), server shutdown.

Crash handling: server sends results on SIGTERM; on hard crash, the Director waits 15 s, then replays
the last checkpoint as an **aborted** match — rewards granted from checkpoint data only if the match
had run > 60 s (configurable), flags set for audit.

---

## 9. Anti-cheat & fairness

| Cheat | Defense |
|---|---|
| Speed/teleport | Server-owned positions; input can only set target angle + boost |
| Reach/blade hacks | Hit detection only server-side; client blade is cosmetic |
| Infinite boost | Stamina server-side; input bit is just a request |
| Reward farming | Per-account daily caps, match count limits, IP/device clustering heuristics |
| Bot collusion | Statistical review of top-score matches; full event log retained 90 days |
| Packet floods | Rate limits per connection (e.g., ≤ 60 msgs/s), size limits, schema validation |

Top-200 matches per season get full event logs retained for replay-based review.

---

## 10. Latency, regions, feel

- Launch in **one region** (pick the biggest audience); add `eu`, `na`, `asia` in phase M4.
- Interpolation buffer 100 ms; snapshot rate 20 Hz gives ~50 ms jitter absorption.
- Prediction error correction: exponential smoothing over 150 ms — never snap.
- Status HUD: ping indicator; “reconnecting…” toast on dropped socket.
- Target: playable up to 150 ms RTT, fully smooth under 80 ms.

---

## 11. Scaling & ops

| Metric | Estimate |
|---|---|
| CPU per room (40 entities, 30 Hz) | ~3–6 % of one modern vCPU |
| Rooms per 2-vCPU node (Node.js) | 6–10 |
| Concurrent players per 4-vCPU node | ~300–400 |
| Server egress per room | ~0.5 MB/s |
| Node.js event-loop budget | tick must finish < 8 ms; measure p99 |

- Room servers: Docker on regional VPS (Hetzner/OVH/Fly.io). Start with 2 nodes (1 hot, 1 spare).
- Room Director keeps placement in Redis; servers heartbeat every 5 s; dead servers drain immediately.
- Deploys: rolling — new rooms on new code, old rooms finish naturally, then process drains.
- Observability: tick p50/p99, snapshot size, drop rate, rooms live, players per room, reward lag.
- Load test tooling: headless bot clients (game-core + fake sockets) to simulate 200 players per node.
- DDoS: put WS behind a proxy (Cloudflare doesn’t proxy raw WS well — use provider L3/L4 protection +
  per-IP connection caps at the server).

---

## 12. Client changes checklist

- [ ] `net/connection.ts`: WS client, reconnect with backoff, ping, clock offset.
- [ ] `net/prediction.ts`: local fish simulated from inputs; reconciliation vs snapshot.
- [ ] `net/interpolation.ts`: entity buffer, spawn/despawn, render at `now − 100 ms`.
- [ ] Replace direct `this.player` writes with input → prediction pipeline.
- [ ] Room HUD: live leaderboard from snapshot/events, ping, reconnecting UI.
- [ ] Menu flow: Play → matchmaking spinner → arena; keep guest flow.
- [ ] Local bot match stays as a practice/offline fallback (reuses `game-core`).

---

## 13. Hedera touchpoints

- Match results are now **trustworthy** (server-authored), which makes HCS attestation meaningful:
  one compact digest per finished match → season topic.
- Rewards mint/transfer on match end via the Reward Worker (DB plan §5, Hedera plan Phases B/C).
- Tournament draws (bracket/seed randomness) use commit–reveal over HCS, or VRF if available **[verify]**.
- NFT inventory is read from Postgres mirror; ownership changes (trades) are reconciled from Mirror Node.

---

## 14. Phases & timeline (1–2 devs)

| Phase | Deliverable | Acceptance |
|---|---|---|
| M0 · Extract core | `packages/game-core` runs headless matches in tests | 5-min bot match simulated in < 1 s, deterministic with seed |
| M1 · 1v1 prototype | Room server + 2 real clients on one map, prediction + interpolation | 2 players see each other with < 150 ms feel; kills validate server-side |
| M2 · Bots & rooms | Rooms with 24–40 entities, bot fill, room lifecycle, crash checkpoints | 8 humans + 24 bots stable for 10 min; server tick p99 < 8 ms |
| M3 · Matchmaking | Redis queues, room director, room tickets, reconnect grace | 100 concurrent players across 3 rooms from a cold start |
| M4 · Persistence & rewards | Results intake → DB → ledger (soft) + HCS digest | Every finished match appears in `matches`; rewards reconcile |
| M5 · Beta hardening | Load test 300 CCU, anti-cheat limits, metrics dashboards, regional node #2 | 1-hour soak at 300 CCU with no errors; rollback drill passes |

Rough calendar: M0–M1 in 2–3 weeks part-time; M2–M3 in 3–4 weeks; M4 in 2 weeks; M5 in 2–3 weeks.

---

## 15. Costs (MVP)

| Item | Cost |
|---|---|
| 2× room server VPS (4 vCPU, 8 GB) | ~$40–80/mo |
| API + Director (small VPS or PaaS) | ~$10–25/mo |
| Postgres (Supabase) + Redis | ~$35–60/mo |
| Bandwidth (0.5 MB/s × rooms) | included on most VPS, ~$10–30/mo at scale |
| Hedera (HCS + payouts) | ~$10–20/mo at 10k matches/day |
| **Total MVP** | **~$100–200/mo** for a few hundred CCU |

---

## 16. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Game feel degrades vs local play | Prediction + interpolation from day one; tune constants early; playtest at simulated 150 ms |
| Refactor of `entities.js` breaks single-player | Keep client-only practice mode running off the same `game-core`; snapshot tests of current behavior first |
| Server tick overrun as entity count grows | Spatial hash + change-only deltas; load tests from M2 onward |
| Reward abuse via multiplayer farming | Server results + daily caps + sampling/auditing top matches |
| Room server crash loses a match | 30 s checkpoints; aborted-match policy; room drains instead of dropping |
| Empty arenas at low population | Queue window + `minPlayers`; scheduled "happy hour" events; practice mode offline; merge/close rooms when idle |
| Scope creep (chat, guilds, spectate) | Explicit non-goals for v1; revisit after M4 |

---

## 17. Decisions needed

1. **First region** (likely US or EU based on audience)?
2. **Room size:** 32 (recommended) vs 24 (cheaper) vs 40 (busier)?
3. **Minimum players to start a match:** 2 / 4 (recommended) / 6? And max queue wait (30 s default)?
4. **Classic match length:** endless-until-death (current) vs 10-minute rounds? Rounds simplify
   results/rewards; endless matches block finishing results. → Recommend 10-min rounds for multiplayer.
5. **Offline practice mode:** keep local bot matches as fallback? → Recommended yes (bots only here).
6. **Chat/emotes in v1?** → Recommend emotes only (no free text; moderation cost).
7. **Infra provider:** Fly.io (fast regions, easy deploys) vs plain VPS (cheapest)? → Recommend VPS for cost, Fly for speed.

---

## 18. Immediate next steps

1. Freeze the current game as v1.0 and tag it; write snapshot tests for movement/combat numbers.
2. Extract `packages/game-core` (sim only) and make the browser game consume it — no behavior change.
3. Build the headless harness: run seeded bot matches in CI; assert determinism.
4. Stand up `apps/room-server` with a WebSocket echo + 2-client movement sync on one map.
5. Then follow phases M2 → M5 in order. Database work (DB-0…DB-2) can proceed in parallel.
