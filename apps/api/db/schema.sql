# Fish.IO — database schema v1
# Apply with: psql "$DATABASE_URL" -f apps/api/db/schema.sql
# Local dev:  docker compose up -d   (auto-applied via docker-entrypoint-initdb.d)

create extension if not exists citext;

-- ============================================================ IDENTITY
create type account_status as enum ('active','suspended','banned','deleted');

create table accounts (
  id                uuid primary key default gen_random_uuid(),
  guest_id          text unique,
  hedera_account_id text unique,
  display_name      citext not null,
  country_code      char(2),
  status            account_status not null default 'active',
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  constraint accounts_name_len check (char_length(display_name) between 1 and 20)
);

create table wallet_links (
  account_id        uuid not null references accounts(id) on delete cascade,
  hedera_account_id text not null unique,
  public_key        text not null,
  linked_at         timestamptz not null default now(),
  primary key (account_id, hedera_account_id)
);

create table auth_nonces (
  nonce             text primary key,
  account_id        uuid references accounts(id) on delete cascade,
  hedera_account_id text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '5 minutes',
  used_at           timestamptz
);

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null unique,
  ip_hash    text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_account_idx on sessions (account_id);

create table sanctions (
  account_id   uuid primary key references accounts(id) on delete cascade,
  reason       text not null,
  evidence     jsonb,
  banned_until timestamptz,
  created_by   text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================ CATALOG
create type item_type as enum ('fish','weapon','hat','upgrade','bundle');

create table catalog_versions (
  id           serial primary key,
  game_version text not null unique,
  created_at   timestamptz not null default now()
);

create table items_catalog (
  id           text not null,
  type         item_type not null,
  name         text not null,
  tier         smallint not null default 0,
  soft_cost    integer not null default 0,
  token_cost   numeric(20,8),
  tradeable    boolean not null default true,
  max_supply   integer,
  metadata_uri text,
  primary key (id, type)
);
create index items_catalog_type_tier_idx on items_catalog (type, tier);

create table seasons (
  id        serial primary key,
  name      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  is_active boolean not null default false,
  rules     jsonb not null default '{}'
);

create table tournaments (
  id         uuid primary key default gen_random_uuid(),
  season_id  int not null references seasons(id),
  name       text not null,
  mode       text not null,
  map_id     text not null,
  entry_fee  numeric(20,8) not null default 0,
  prize_pool numeric(20,8) not null default 0,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null default 'scheduled'
);

create table achievements (
  id          text primary key,
  name        text not null,
  description text not null,
  nft_item_id text,
  rules       jsonb not null
);

-- ============================================================ GAMEPLAY
create type match_mode as enum ('classic','frenzy','tournament');
create type match_status as enum ('running','finished','aborted');

create table matches (
  id            uuid primary key default gen_random_uuid(),
  mode          match_mode not null,
  map_id        text not null,
  season_id     int references seasons(id),
  tournament_id uuid references tournaments(id),
  server_node   text not null,
  game_version  text not null,
  status        match_status not null default 'running',
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_s    integer,
  human_count   smallint not null default 0,
  bot_count     smallint not null default 0
);
create index matches_started_idx on matches (started_at desc);
create index matches_tournament_idx on matches (tournament_id) where tournament_id is not null;

create table match_participants (
  id           bigint generated always as identity primary key,
  match_id     uuid not null references matches(id) on delete cascade,
  account_id   uuid references accounts(id),
  is_bot       boolean not null default false,
  name         text not null,
  score        integer not null default 0,
  kills        smallint not null default 0,
  deaths       smallint not null default 0,
  food_eaten   integer not null default 0,
  chests       smallint not null default 0,
  max_level    smallint not null default 1,
  king_time_s  integer not null default 0,
  finish_rank  smallint,
  reward_soft  integer not null default 0,
  reward_token numeric(20,8) not null default 0,
  payout_id    uuid
);
create unique index mp_player_uniq on match_participants (match_id, account_id) where account_id is not null;
create unique index mp_bot_uniq on match_participants (match_id, name) where account_id is null;
create index mp_account_idx on match_participants (account_id, match_id);
create index mp_rank_idx on match_participants (match_id, finish_rank);

-- Event firehose: partitioned by month on created_at (create partitions via job/pg_partman).
create table match_events (
  match_id   uuid not null,
  seq        integer not null,
  at_ms      integer not null,
  event_type text not null,
  actor_id   uuid,
  target_id  uuid,
  payload    jsonb,
  created_at timestamptz not null default now(),
  primary key (created_at, match_id, seq)
) partition by range (created_at);
create table match_events_default partition of match_events default;

create table room_checkpoints (
  match_id   uuid not null references matches(id) on delete cascade,
  checkpoint smallint not null,
  at_ms      integer not null,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, checkpoint)
);

-- ============================================================ ECONOMY
create type currency as enum ('soft_gold','gold_token');
create type ledger_reason as enum (
  'match_reward','stage_reward','tournament_prize','purchase',
  'upgrade','tournament_entry','marketplace_fee','admin_adjust','refund'
);

create table currency_accounts (
  account_id uuid not null references accounts(id) on delete cascade,
  currency   currency not null,
  balance    numeric(20,8) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, currency),
  constraint currency_balance_non_negative check (balance >= 0)
);

create table ledger_entries (
  id              bigint generated always as identity primary key,
  account_id      uuid not null references accounts(id),
  currency        currency not null,
  delta           numeric(20,8) not null,
  balance_after   numeric(20,8) not null,
  reason          ledger_reason not null,
  ref_type        text,
  ref_id          text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
create index ledger_account_time_idx on ledger_entries (account_id, created_at desc);

create table purchases (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  item_id         text not null,
  item_type       item_type not null,
  price_soft      integer not null default 0,
  price_token     numeric(20,8) not null default 0,
  ledger_entry_id bigint references ledger_entries(id),
  created_at      timestamptz not null default now()
);

create table nft_items (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id),
  item_id            text not null,
  item_type          item_type not null,
  serial_number      bigint,
  token_id           text,
  source             text not null,
  equipped           boolean not null default false,
  acquired_at        timestamptz not null default now(),
  transferred_out_at timestamptz,
  unique (token_id, serial_number)
);
create index nft_items_owner_idx on nft_items (account_id) where transferred_out_at is null;

create table payout_batches (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  status       text not null default 'pending',
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
  status          text not null default 'pending',
  hedera_tx_id    text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);
create index payout_status_idx on payout_claims (status) where status in ('pending','processing');

create table hcs_messages (
  id                  bigint generated always as identity primary key,
  topic_id            text not null,
  sequence_number     bigint,
  consensus_timestamp timestamptz,
  message_type        text not null,
  payload             jsonb not null,
  payload_hash        text not null,
  match_id            uuid,
  created_at          timestamptz not null default now()
);
create index hcs_match_idx on hcs_messages (match_id) where match_id is not null;

-- ============================================================ PROGRESSION & COMPETITIVE
create table player_stats (
  account_id      uuid primary key references accounts(id) on delete cascade,
  matches_played  integer not null default 0,
  total_kills     integer not null default 0,
  total_food      bigint not null default 0,
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
create index leaderboard_score_idx on leaderboard_entries (season_id, best_score desc);

create table tournament_entries (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  account_id    uuid not null references accounts(id),
  match_id      uuid references matches(id),
  score         integer,
  finish_rank   smallint,
  prize         numeric(20,8) not null default 0,
  primary key (tournament_id, account_id)
);

-- ============================================================ OPS
create table server_nodes (
  id             text primary key,
  region         text not null,
  kind           text not null,
  capacity       smallint not null,
  last_heartbeat timestamptz,
  meta           jsonb
);

create table audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  action     text not null,
  target     text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create table feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  rollout    jsonb,
  updated_at timestamptz not null default now()
);

create table telemetry_daily (
  day        date not null,
  metric     text not null,
  dimensions jsonb not null default '{}',
  value      numeric not null,
  primary key (day, metric, dimensions)
);
