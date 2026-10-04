# Fish.IO — Database & Backend Data Plan

> Companion docs: `docs/HEDERA_PLAN.md` (chain integration), `docs/MULTIPLAYER_PLAN.md` (real-time servers).
>
> Status: DRAFT v1. Assumes: PostgreSQL as source of truth, Redis for hot state,
> Node + TypeScript API, Hedera for tokens/NFTs/logging.

---

## 1. Goals & principles

1. **One source of truth per fact.** Postgres owns identity, inventory, currency, matches, seasons.
   Redis owns ephemeral state (sessions, queues, live rooms, leaderboard caches). Hedera owns token
   balances and NFT ownership; Postgres caches what it needs from the chain.
2. **Never trust the client.** All rewards derive from server-computed match results.
3. **Money is append-only.** Currency movements are a ledger, never an UPDATE of a balance column alone.
4. **Idempotency everywhere.** Every payout, purchase, and claim has an idempotency key.
5. **Boring and queryable.** Normalized Postgres + a few materialized rollups; no exotic tech until scale demands it.
6. **Privacy by default.** The only user data we hold: a Hedera account id (or guest id), a display name, gameplay stats.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Primary DB | PostgreSQL 16 | Supabase (managed) for MVP; self-host later if needed |
| Migrations | Prisma **or** Drizzle + SQL migrations | Keep raw SQL for DDL-heavy work |
| Cache / queues | Redis 7 | sessions, matchmaking queue, rate limits, leaderboard ZSETs, room registry |
| Analytics | Postgres rollups → ClickHouse later | 100k DAU makes raw match_events too hot for Postgres |
| Object storage | S3-compatible | replays, exported logs, NFT art (or IPFS/HFS for art) |
| Chain | Hedera HTS/HCS | token + NFT truth; `hcs_messages` table links our log to chain |

Environments: `dev` (local), `testnet` (Hedera testnet + staging DB), `prod`. One DB per env, separate
Redis namespaces.

---

## 3. Data domains

```
IDENTITY        accounts, auth_nonces, sessions, wallet_links, sanctions
CATALOG         items_catalog, catalog_versions, seasons, tournaments, achievements
GAMEPLAY        matches, match_participants, match_events, room_checkpoints
PROGRESSION     player_stats, player_achievements, player_unlocks
ECONOMY         currency_accounts, ledger_entries, purchases, nft_items,
                payout_batches, payout_claims, hcs_messages
COMPETITIVE     leaderboard_entries, tournament_entries
SOCIAL (v3)     friendships, guilds, guild_members
OPS             server_nodes, audit_log, admin_users, feature_flags, telemetry_daily
```

---

## 4. Core schema (v1)

### 4.1 Identity

```sql
create type account_status as enum ('active','suspended','banned','deleted');

create table accounts (
  id                uuid primary key default gen_random_uuid(),
  guest_id          text unique,                  -- anonymous device-generated id
  hedera_account_id text unique,                  -- '0.0.123456' once linked
  display_name      citext not null,
  country_code      char(2),
  status            account_status not null default 'active',
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  constraint name_len check (char_length(display_name) between 1 and 20)
);

create table wallet_links (
  account_id        uuid not null references accounts(id) on delete cascade,
  hedera_account_id text not null unique,
  public_key        text not null,
  linked_at         timestamptz not null default now(),
  primary key (account_id, hedera_account_id)
);

create table auth_nonces (
  nonce       text primary key,
  account_id  uuid references accounts(id) on delete cascade,
  hedera_account_id text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '5 minutes',
  used_at     timestamptz
);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  token_hash  text not null unique,
  ip_hash     text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create table sanctions (
  account_id  uuid primary key references accounts(id) on delete cascade,
  reason      text not null,
  evidence    jsonb,
  banned_until timestamptz,                        -- null = permanent
  created_by  text not null,
  created_at  timestamptz not null default now()
);
```

### 4.2 Catalog (static game data mirrored for economy integrity)

```sql
create type item_type as enum ('fish','weapon','hat','upgrade','bundle');

create table catalog_versions (
  id          serial primary key,
  game_version text not null unique,               -- e.g. '2026.10.1'
  created_at  timestamptz not null default now()
);

create table items_catalog (
  id            text not null,                     -- 'dragon_horn' (matches game ids)
  type          item_type not null,
  name          text not null,
  tier          smallint not null,                 -- 0..4, from shop.js tier builder
  soft_cost     integer not null default 0,        -- in-game gold
  token_cost    numeric(20,8),                     -- $GOLD, nullable
  tradeable     boolean not null default true,
  max_supply    integer,                           -- null = unlimited mint
  metadata_uri  text,                              -- HIP-412 JSON for NFT type
  primary key (id, type)
);

create table seasons (
  id          serial primary key,
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  is_active   boolean not null default false,
  rules       jsonb not null default '{}'
);

create table tournaments (
  id          uuid primary key default gen_random_uuid(),
  season_id   int not null references seasons(id),
  name        text not null,
  mode        text not null,                       -- 'frenzy' | 'classic'
  map_id      text not null,
  entry_fee   numeric(20,8) not null default 0,
  prize_pool  numeric(20,8) not null default 0,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'scheduled'    -- scheduled|live|finished|cancelled
);

create table achievements (
  id          text primary key,                    -- 'boss_megalodon_slayer'
  name        text not null,
  description text not null,
  nft_item_id text,                                -- badge to mint on unlock
  rules       jsonb not null
);
```

### 4.3 Gameplay

```sql
create type match_mode as enum ('classic','frenzy','tournament');
create type match_status as enum ('running','finished','aborted');

create table matches (
  id            uuid primary key default gen_random_uuid(),
  mode          match_mode not null,
  map_id        text not null,
  season_id     int references seasons(id),
  tournament_id uuid references tournaments(id),
  server_node   text not null,                     -- 'room-eu-3'
  game_version  text not null,
  status        match_status not null default 'running',
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_s    integer,
  human_count   smallint not null default 0,
  bot_count     smallint not null default 0
);

create table match_participants (
  match_id      uuid not null references matches(id) on delete cascade,
  account_id    uuid references accounts(id),      -- null for bots
  is_bot        boolean not null,                  -- true only for offline practice logs; multiplayer rooms are humans-only
  name          text not null,                     -- snapshot of display name
  score         integer not null default 0,
  kills         smallint not null default 0,
  deaths        smallint not null default 0,       -- 0/1 in this genre
  food_eaten    integer not null default 0,
  chests        smallint not null default 0,
  max_level     smallint not null default 1,
  king_time_s   integer not null default 0,
  finish_rank   smallint,
  reward_soft   integer not null default 0,
  reward_token  numeric(20,8) not null default 0,
  payout_id     uuid,                              -- links to payout_claims when paid
  primary key (match_id, account_id, is_bot, name)
);
create index on match_participants (account_id, match_id);
create index on match_participants (match_id, finish_rank);

-- Firehose of gameplay events; partition monthly, retain 60–90 days.
create table match_events (
  match_id    uuid not null,
  seq         integer not null,
  at_ms       integer not null,                    -- ms since match start
  event_type  text not null,                       -- kill|eaten|powerup|chest|boss_spawn|level_up
  actor_id    uuid,
  target_id   uuid,
  payload     jsonb,
  primary key (match_id, seq)
) partition by range (match_id);                   -- practical: partition by month via created_at instead

-- Crash-safety checkpoints written by room servers every 30s.
create table room_checkpoints (
  match_id    uuid not null references matches(id) on delete cascade,
  checkpoint  smallint not null,
  at_ms       integer not null,
  state       jsonb not null,                      -- compact player states only
  created_at  timestamptz not null default now(),
  primary key (match_id, checkpoint)
);
```

### 4.4 Economy

```sql
create type currency as enum ('soft_gold','gold_token');
create type ledger_reason as enum (
  'match_reward','stage_reward','tournament_prize','purchase',
  'upgrade','tournament_entry','marketplace_fee','admin_adjust','refund'
);

create table currency_accounts (
  account_id   uuid not null references accounts(id) on delete cascade,
  currency     currency not null,
  balance      numeric(20,8) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (account_id, currency),
  constraint non_negative check (balance >= 0)
);

-- Append-only. balance_after allows fast reconstruction checks.
create table ledger_entries (
  id              bigserial primary key,
  account_id      uuid not null references accounts(id),
  currency        currency not null,
  delta           numeric(20,8) not null,
  balance_after   numeric(20,8) not null,
  reason          ledger_reason not null,
  ref_type        text,                            -- 'match' | 'purchase' | 'payout' ...
  ref_id          text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
create index on ledger_entries (account_id, created_at desc);

create table purchases (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  item_id       text not null,
  item_type     item_type not null,
  price_soft    integer not null default 0,
  price_token   numeric(20,8) not null default 0,
  ledger_entry_id bigint references ledger_entries(id),
  created_at    timestamptz not null default now()
);

-- Off-chain mirror of owned items; NFT items also carry their serial.
create table nft_items (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  item_id       text not null,
  item_type     item_type not null,
  serial_number bigint,                            -- Hedera NFT serial once minted
  token_id      text,                              -- Hedera token id
  source        text not null,                     -- 'purchase'|'reward'|'airdrop'|'trade'
  equipped      boolean not null default false,
  acquired_at   timestamptz not null default now(),
  transferred_out_at timestamptz,                 -- set when sold/transferred
  unique (token_id, serial_number)
);
create index on nft_items (account_id) where transferred_out_at is null;

create table payout_batches (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                      -- 'match'|'tournament'|'manual'
  status       text not null default 'pending',    -- pending|processing|done|failed
  total_amount numeric(20,8) not null,
  tx_count     integer not null,
  created_at   timestamptz not null default now()
);

create table payout_claims (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid references payout_batches(id),
  account_id      uuid not null references accounts(id),
  amount          numeric(20,8) not null,
  currency        currency not null,
  status          text not null default 'pending', -- pending|sent|confirmed|failed
  hedera_tx_id    text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);

create table hcs_messages (
  id                  bigserial primary key,
  topic_id            text not null,
  sequence_number     bigint,
  consensus_timestamp timestamptz,
  message_type        text not null,               -- 'match_result'|'tournament_draw'|'season_root'
  payload             jsonb not null,
  payload_hash        text not null,
  match_id            uuid,
  created_at          timestamptz not null default now()
);
```

### 4.5 Progression & competitive

```sql
create table player_stats (
  account_id      uuid primary key references accounts(id) on delete cascade,
  matches_played  integer not null default 0,
  total_kills     integer not null default 0,
  total_food      bigint  not null default 0,
  high_score      integer not null default 0,
  best_level      smallint not null default 1,
  total_king_time integer not null default 0,
  updated_at      timestamptz not null default now()
);

create table player_achievements (
  account_id     uuid not null references accounts(id) on delete cascade,
  achievement_id text not null references achievements(id),
  unlocked_at    timestamptz not null default now(),
  nft_serial     bigint,
  primary key (account_id, achievement_id)
);

create table leaderboard_entries (
  season_id   int not null references seasons(id),
  account_id  uuid not null references accounts(id),
  best_score  integer not null,
  total_kills integer not null default 0,
  matches     integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (season_id, account_id)
);
create index on leaderboard_entries (season_id, best_score desc);

create table tournament_entries (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  account_id    uuid not null references accounts(id),
  match_id      uuid references matches(id),
  score         integer,
  finish_rank   smallint,
  prize         numeric(20,8) not null default 0,
  primary key (tournament_id, account_id)
);
```

### 4.6 Ops

```sql
create table server_nodes (
  id            text primary key,                  -- 'room-eu-3'
  region        text not null,
  kind          text not null,                     -- 'room' | 'api'
  capacity      smallint not null,
  last_heartbeat timestamptz,
  meta          jsonb
);

create table audit_log (
  id          bigserial primary key,
  actor       text not null,                       -- 'admin:uuid' | 'system'
  action      text not null,
  target      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

create table feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  rollout    jsonb,
  updated_at timestamptz not null default now()
);

-- Daily rollups (written by jobs; keeps dashboards cheap).
create table telemetry_daily (
  day          date not null,
  metric       text not null,
  dimensions   jsonb not null default '{}',
  value        numeric not null,
  primary key (day, metric, dimensions)
);
```

---

## 5. Integrity rules & flows

### Purchase flow (transactional)
```sql
begin;
select balance from currency_accounts
  where account_id = $1 and currency = $2 for update;   -- row lock
-- validate funds, then:
insert into ledger_entries (...) values (...) returning id;   -- idempotency_key = 'purchase:'||uuid
update currency_accounts set balance = balance + $delta, updated_at = now() ...;
insert into purchases ...;
commit;
```

### Match reward flow (server → job)
1. Room server posts a signed result to `POST /internal/matches` (HMAC, server token).
2. API writes `matches` + `match_participants` in one transaction.
3. Reward job computes payouts (rules engine, caps) → one `ledger_entries` row per player with
   idempotency `match:{match_id}:{account_id}`.
4. Token rewards enqueue `payout_claims`; worker batches into `payout_batches` and sends HTS transfers.
5. HCS writer appends a compact result digest to the season topic → `hcs_messages`.

### Consistency rules
- Soft and token balances are **never** updated without a matching ledger row (DB trigger or app-level invariant test).
- All timestamps UTC; all ids UUID v7 (time-sortable).
- `idempotency_key` unique constraints are the last line of defense against double payouts.
- Ledger is append-only; corrections are compensating entries with reason `admin_adjust`/`refund`.

---

## 6. Indexes, partitioning, retention

| Table | Strategy |
|---|---|
| `match_events` | Partition by month; drop partitions > 90 days |
| `matches`, `match_participants` | Keep 12 months; aggregate into `player_stats` + object-storage archives |
| `ledger_entries` | Keep forever (small rows); index `(account_id, created_at desc)` |
| `hcs_messages` | Keep forever; it's the on-chain receipt index |
| `sessions` | TTL sweep hourly |
| `auth_nonces` | TTL sweep every 5 min |

Query targets: leaderboard top-100 < 20 ms (Redis ZSET mirror), profile load < 30 ms, match submit < 100 ms.

---

## 7. Redis map

| Key pattern | Type | TTL | Purpose |
|---|---|---|---|
| `sess:{tokenHash}` | hash | 30 d | session lookup |
| `mmq:{mode}:{region}` | ZSET | — | matchmaking queue (score = MMR/join time) |
| `room:{id}` | hash | 60 s | live room registry (heartbeat) |
| `lb:{season}:global` | ZSET | season | live leaderboard mirror |
| `lb:{season}:{map}` | ZSET | season | per-map boards |
| `rt:{ip}` / `rt:{account}` | counter | 60 s | rate limiting |
| `inv:{accountId}` | hash | 5 min | inventory cache (invalidated on write) |
| `nonce:{nonce}` | string | 5 min | auth challenge |

---

## 8. Seed & versioning

- `scripts/seed-catalog.ts` imports the game's static data (`WEAPON_SKINS`, `FISH_SKINS`, `FISH_HATS`,
  `WORKSHOP_UPGRADES`, `FISH_MAPS`, tier tables) into `items_catalog` + `catalog_versions`.
- `matches.game_version` tags every match with the client/game-core version for reproducibility.
- Economy constants (tier costs, reward rules) live in `packages/shared` + DB, never only in the client.

---

## 9. Privacy, security, compliance

- PII minimization: display name + hashed IP; no email required in v1.
- Account deletion: anonymize (`display_name = 'deleted-user'`, null wallet link) and retain ledger rows
  without PII for accounting integrity.
- Row-level access only via API; DB never exposed publicly. Connection pooling (PgBouncer/Supavisor).
- Encrypt sensitive fields at rest where practical; never store private keys (claims are signed server-side
  via KMS).
- Backups: PITR with 7-day window (MVP), nightly logical backup to object storage, restore drill every quarter.

---

## 10. Scale estimates & cost

| Scale | Matches/day | Participant rows/day | Storage/day | Postgres size (2 mo) |
|---|---|---|---|---|
| 1k DAU | 5k | ~100k | ~40 MB | ~3 GB |
| 20k DAU | 100k | ~2M | ~800 MB | ~50 GB |
| 100k DAU | 500k | ~10M | ~4 GB | *(move events to ClickHouse)* ~250 GB |

MVP cost: Supabase Pro ~$25/mo, Redis managed ~$10–30/mo, object storage pennies.
At 100k DAU: dedicated Postgres + ClickHouse + Redis ≈ $500–1,500/mo.

---

## 11. Phases

| Phase | Scope | Done when |
|---|---|---|
| DB-0 | Schema v1 migration + seed catalog + local dev (docker-compose) | `prisma migrate` + seed run clean; game reads nothing yet |
| DB-1 | Accounts, guest→wallet link, sessions; match submit (single-player first) | Every finished match lands in `matches` |
| DB-2 | Ledger + soft currency + purchases + inventory; server-side reward rules | Earn/spend is auditable; no balance drift in tests |
| DB-3 | Seasons, leaderboards, tournament tables; Redis ZSET boards | Top-100 query verified on 1M rows |
| DB-4 | Multiplayer room persistence (see `MULTIPLAYER_PLAN.md`) + checkpoints | Match results from live rooms reconcile with checkpoints |
| DB-5 | Token payouts, NFT mirror, HCS receipts (see `HEDERA_PLAN.md`) | One full earn→pay→verify loop on testnet |

---

## 12. Decisions needed

1. **Managed Postgres (Supabase) vs self-hosted** from day one? → Recommend managed until ~50k DAU.
2. **Ledger scope:** soft currency only, or `$GOLD` from the start? → Recommend soft-only in DB-2, token in DB-5.
3. **Guest identity:** device id only, or optional email/Google for recovery? → Recommend device id + wallet link.
4. **Raw event retention:** 30 or 90 days? → Recommend 90 for cheat forensics, then aggregate.
5. **Analytics warehouse timing:** Postgres-only until 20k DAU? → Recommend yes.
