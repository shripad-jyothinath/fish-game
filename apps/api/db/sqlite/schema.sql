-- Fish.IO — local dev auth schema (SQLite).
-- Mirrors the accounts/sessions/saves subset of db/schema.sql (Postgres).
-- Used when Docker/Postgres is unavailable; Postgres remains the production target.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    username       TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_login_at  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS saves (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ============================================================ HEDERA LAYER
-- Mirrors the Postgres tables of the same purpose (wallet_links, auth_nonces,
-- hcs_messages, payout_claims, nft_items) in a dev-sized form.

CREATE TABLE IF NOT EXISTS hedera_resources (
    network     TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- 'hcs_topic' | 'gold_token' | 'nft_collection'
    resource_id TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (network, kind)
);

CREATE TABLE IF NOT EXISTS wallet_links (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hedera_account_id TEXT NOT NULL UNIQUE,
    public_key        TEXT,
    method            TEXT NOT NULL DEFAULT 'transfer',
    network           TEXT NOT NULL,
    linked_at         INTEGER NOT NULL
);

-- Auto-created wallets for every account (operator-funded, keys encrypted at rest).
CREATE TABLE IF NOT EXISTS custodied_wallets (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hedera_account_id TEXT NOT NULL UNIQUE,
    key_cipher        TEXT NOT NULL,
    key_iv            TEXT NOT NULL,
    key_tag           TEXT NOT NULL,
    network           TEXT NOT NULL,
    created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS matches (
    id           TEXT PRIMARY KEY,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    mode         TEXT NOT NULL,
    score        INTEGER NOT NULL,
    kills        INTEGER NOT NULL,
    max_level    INTEGER NOT NULL,
    food_eaten   INTEGER NOT NULL DEFAULT 0,
    chests       INTEGER NOT NULL DEFAULT 0,
    king_time_s  INTEGER NOT NULL DEFAULT 0,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    reward_gold  INTEGER NOT NULL DEFAULT 0,
    hcs_status   TEXT NOT NULL DEFAULT 'disabled',   -- submitted | failed | disabled
    hcs_topic_id TEXT,
    hcs_sequence INTEGER,
    hcs_tx_id    TEXT,
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_score ON matches (score DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user ON matches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_claims (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id     TEXT,
    amount       INTEGER NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'gold_token',
    status       TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | failed
    hedera_tx_id TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payouts_user_status ON payout_claims (user_id, status);

CREATE TABLE IF NOT EXISTS nft_items (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id       TEXT NOT NULL,
    item_type     TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    token_id      TEXT,
    serial_number INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending',   -- minted | failed
    hedera_tx_id  TEXT,
    error         TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    UNIQUE (token_id, serial_number)
);
CREATE INDEX IF NOT EXISTS idx_nft_items_user ON nft_items (user_id);

-- One live mint per user per item; failed mints free the slot for a retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_items_user_item
    ON nft_items (user_id, item_id)
    WHERE status IN ('minting', 'minted');

CREATE TABLE IF NOT EXISTS player_stats (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    matches_played  INTEGER NOT NULL DEFAULT 0,
    total_kills     INTEGER NOT NULL DEFAULT 0,
    total_food      INTEGER NOT NULL DEFAULT 0,
    high_score      INTEGER NOT NULL DEFAULT 0,
    best_level      INTEGER NOT NULL DEFAULT 1,
    total_king_time INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL
);
