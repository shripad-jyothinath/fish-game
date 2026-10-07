/**
 * SQLite store for local development: accounts, sessions, save data.
 * The Postgres schema in db/schema.sql stays the production target; this
 * mirrors only the subset needed until DB-1 lands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, '../db/sqlite/schema.sql');

export interface UserRow {
  id: string;
  email: string;
  username: string;
  username_lower: string;
  password_hash: string;
  created_at: number;
  last_login_at: number | null;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface SaveRow {
  user_id: string;
  data: string;
  updated_at: number;
}

export interface HederaResourceRow {
  network: string;
  kind: string;
  resource_id: string;
  meta: string;
  updated_at: number;
}

export interface WalletLinkRow {
  user_id: string;
  hedera_account_id: string;
  public_key: string | null;
  method: string;
  network: string;
  linked_at: number;
}

export interface CustodialWalletRow {
  user_id: string;
  hedera_account_id: string;
  key_cipher: string;
  key_iv: string;
  key_tag: string;
  network: string;
  created_at: number;
}

export interface NonceRow {
  nonce: string;
  user_id: string;
  message: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface MatchRow {
  id: string;
  user_id: string | null;
  mode: string;
  score: number;
  kills: number;
  max_level: number;
  food_eaten: number;
  chests: number;
  king_time_s: number;
  duration_ms: number;
  reward_gold: number;
  hcs_status: string;
  hcs_topic_id: string | null;
  hcs_sequence: number | null;
  hcs_tx_id: string | null;
  created_at: number;
}

export interface MatchInsert extends Omit<MatchRow, 'user_id'> {
  user_id: string;
}

export interface LeaderboardRow {
  user_id: string;
  username: string;
  best_score: number;
  total_kills: number;
  matches_played: number;
  last_played_at: number;
  mode: string | null;
  hcs_tx_id: string | null;
}

export interface PayoutClaimRow {
  id: string;
  user_id: string;
  match_id: string | null;
  amount: number;
  currency: string;
  status: string;
  hedera_tx_id: string | null;
  error: string | null;
  created_at: number;
  confirmed_at: number | null;
}

export interface NftItemRow {
  id: string;
  user_id: string;
  item_id: string;
  item_type: string;
  name: string;
  description: string;
  token_id: string | null;
  serial_number: number | null;
  status: string;
  hedera_tx_id: string | null;
  error: string | null;
  metadata_json: string;
  created_at: number;
}

export interface PlayerStatsDelta {
  kills: number;
  food: number;
  score: number;
  level: number;
  kingTime: number;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  source: string;
  status: string; // pending (purchase in flight) | active
  price_gold: number;
  hedera_tx_id: string | null;
  created_at: number;
}

export interface GoldMovementRow {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref: string | null;
  created_at: number;
}

export type Store = ReturnType<typeof openDatabase>;

export function openDatabase(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const stmts = {
    insertUser: db.prepare(
      `INSERT INTO users (id, email, username, username_lower, password_hash, created_at, last_login_at)
       VALUES (@id, @email, @username, @username_lower, @password_hash, @created_at, @last_login_at)`,
    ),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userByUsername: db.prepare('SELECT * FROM users WHERE username_lower = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    insertSession: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    extendSessionStmt: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    saveByUser: db.prepare('SELECT * FROM saves WHERE user_id = ?'),
    upsertSave: db.prepare(
      `INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ),

    hederaResource: db.prepare('SELECT * FROM hedera_resources WHERE network = ? AND kind = ?'),
    upsertHederaResource: db.prepare(
      `INSERT INTO hedera_resources (network, kind, resource_id, meta, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(network, kind) DO UPDATE SET resource_id = excluded.resource_id, meta = excluded.meta, updated_at = excluded.updated_at`,
    ),
    walletLinkByUser: db.prepare('SELECT * FROM wallet_links WHERE user_id = ?'),
    walletLinkByAccount: db.prepare('SELECT * FROM wallet_links WHERE hedera_account_id = ?'),
    upsertWalletLink: db.prepare(
      `INSERT INTO wallet_links (user_id, hedera_account_id, public_key, method, network, linked_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET hedera_account_id = excluded.hedera_account_id, public_key = excluded.public_key,
         method = excluded.method, network = excluded.network, linked_at = excluded.linked_at`,
    ),
    deleteWalletLink: db.prepare('DELETE FROM wallet_links WHERE user_id = ?'),
    custodialByUser: db.prepare('SELECT * FROM custodied_wallets WHERE user_id = ?'),
    insertCustodial: db.prepare(
      `INSERT INTO custodied_wallets (user_id, hedera_account_id, key_cipher, key_iv, key_tag, network, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertNonce: db.prepare('INSERT INTO auth_nonces (nonce, user_id, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    nonceByValue: db.prepare('SELECT * FROM auth_nonces WHERE nonce = ?'),
    markNonceUsedStmt: db.prepare('UPDATE auth_nonces SET used_at = ? WHERE nonce = ?'),

    insertMatch: db.prepare(
      `INSERT INTO matches (id, user_id, mode, score, kills, max_level, food_eaten, chests, king_time_s, duration_ms,
         reward_gold, hcs_status, hcs_topic_id, hcs_sequence, hcs_tx_id, created_at)
       VALUES (@id, @user_id, @mode, @score, @kills, @max_level, @food_eaten, @chests, @king_time_s, @duration_ms,
         @reward_gold, @hcs_status, @hcs_topic_id, @hcs_sequence, @hcs_tx_id, @created_at)`,
    ),
    matchById: db.prepare('SELECT * FROM matches WHERE id = ?'),
    latestMatchAtStmt: db.prepare('SELECT created_at FROM matches WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'),
    upsertPlayerStats: db.prepare(
      `INSERT INTO player_stats (user_id, matches_played, total_kills, total_food, high_score, best_level, total_king_time, updated_at)
       VALUES (@user_id, 1, @kills, @food, @score, @level, @kingTime, @updated_at)
       ON CONFLICT(user_id) DO UPDATE SET
         matches_played = matches_played + 1,
         total_kills = total_kills + excluded.total_kills,
         total_food = total_food + excluded.total_food,
         high_score = MAX(high_score, excluded.high_score),
         best_level = MAX(best_level, excluded.best_level),
         total_king_time = total_king_time + excluded.total_king_time,
         updated_at = excluded.updated_at`,
    ),
    leaderboard: db.prepare(
      `SELECT s.user_id, u.username, s.high_score AS best_score, s.total_kills, s.matches_played,
              s.updated_at AS last_played_at,
              (SELECT m.mode FROM matches m WHERE m.user_id = s.user_id ORDER BY m.score DESC, m.created_at DESC LIMIT 1) AS mode,
              (SELECT m.hcs_tx_id FROM matches m WHERE m.user_id = s.user_id AND m.hcs_tx_id IS NOT NULL
                 ORDER BY m.score DESC LIMIT 1) AS hcs_tx_id
       FROM player_stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.high_score DESC, s.updated_at ASC
       LIMIT ?`,
    ),

    insertPayout: db.prepare(
      `INSERT INTO payout_claims (id, user_id, match_id, amount, currency, status, hedera_tx_id, error, created_at, confirmed_at)
       VALUES (@id, @user_id, @match_id, @amount, @currency, @status, @hedera_tx_id, @error, @created_at, @confirmed_at)`,
    ),

    insertNftItem: db.prepare(
      `INSERT INTO nft_items (id, user_id, item_id, item_type, name, description, token_id, serial_number, status,
         hedera_tx_id, error, metadata_json, created_at)
       VALUES (@id, @user_id, @item_id, @item_type, @name, @description, @token_id, @serial_number, @status,
         @hedera_tx_id, @error, @metadata_json, @created_at)`,
    ),
    nftItemsByUser: db.prepare('SELECT * FROM nft_items WHERE user_id = ? ORDER BY created_at DESC'),
    nftItemByItem: db.prepare(
      `SELECT * FROM nft_items WHERE user_id = ? AND item_id = ? AND status IN ('minting', 'minted') LIMIT 1`,
    ),
    nftMetadataByItem: db.prepare('SELECT * FROM nft_items WHERE item_id = ? ORDER BY created_at DESC LIMIT 1'),
    nftItemBySerial: db.prepare(
      `SELECT * FROM nft_items WHERE item_id = ? AND serial_number = ? AND status = 'minted' LIMIT 1`,
    ),
    countItemMints: db.prepare(
      `SELECT COUNT(*) AS n FROM nft_items WHERE item_id = ? AND status IN ('minting', 'minted')`,
    ),
    mintCounts: db.prepare(
      `SELECT item_id, COUNT(*) AS n FROM nft_items WHERE status IN ('minting', 'minted') GROUP BY item_id`,
    ),
    updateNftItem: db.prepare(
      `UPDATE nft_items SET
         status = COALESCE(@status, status),
         token_id = COALESCE(@token_id, token_id),
         serial_number = COALESCE(@serial_number, serial_number),
         hedera_tx_id = COALESCE(@hedera_tx_id, hedera_tx_id),
         error = @error,
         metadata_json = COALESCE(@metadata_json, metadata_json)
       WHERE id = @id`,
    ),

    insertEntitlement: db.prepare(
      `INSERT INTO entitlements (id, user_id, item_type, item_id, source, status, price_gold, hedera_tx_id, created_at)
       VALUES (@id, @user_id, @item_type, @item_id, @source, @status, @price_gold, @hedera_tx_id, @created_at)`,
    ),
    entitlementByUserItem: db.prepare(
      `SELECT * FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?`,
    ),
    entitlementsByUser: db.prepare(`SELECT * FROM entitlements WHERE user_id = ? ORDER BY created_at ASC`),
    activateEntitlementStmt: db.prepare(
      `UPDATE entitlements SET status = 'active', hedera_tx_id = COALESCE(?, hedera_tx_id) WHERE id = ?`,
    ),
    deleteEntitlementStmt: db.prepare(`DELETE FROM entitlements WHERE id = ?`),

    insertGoldMovement: db.prepare(
      `INSERT INTO gold_ledger (id, user_id, delta, reason, ref, created_at)
       VALUES (@id, @user_id, @delta, @reason, @ref, @created_at)`,
    ),
    goldBalanceStmt: db.prepare(`SELECT COALESCE(SUM(delta), 0) AS balance FROM gold_ledger WHERE user_id = ?`),
    goldSumByReasonStmt: db.prepare(
      `SELECT COALESCE(SUM(delta), 0) AS total FROM gold_ledger WHERE user_id = ? AND reason = ? AND created_at >= ?`,
    ),
    goldTotalsByReasonStmt: db.prepare(
      `SELECT reason, COALESCE(SUM(delta), 0) AS total FROM gold_ledger WHERE user_id = ? GROUP BY reason`,
    ),
    goldMovementsByUser: db.prepare(`SELECT * FROM gold_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`),
    upgradesByUser: db.prepare(`SELECT upgrade_id, level FROM player_upgrades WHERE user_id = ?`),
    upgradeByUser: db.prepare(`SELECT level FROM player_upgrades WHERE user_id = ? AND upgrade_id = ?`),
    upsertUpgrade: db.prepare(
      `INSERT INTO player_upgrades (user_id, upgrade_id, level, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, upgrade_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
    ),
    insertRewardClaim: db.prepare(
      `INSERT INTO reward_claims (id, user_id, kind, ref, amount, created_at)
       VALUES (@id, @user_id, @kind, @ref, @amount, @created_at)`,
    ),
    countRewardClaimsStmt: db.prepare(`SELECT COUNT(*) AS n FROM reward_claims WHERE user_id = ? AND kind = ?`),
  };

  return {
    raw: db,

    createUser(user: UserRow): void {
      stmts.insertUser.run(user);
    },
    findUserByEmail(email: string): UserRow | undefined {
      return stmts.userByEmail.get(email) as UserRow | undefined;
    },
    findUserByUsername(usernameLower: string): UserRow | undefined {
      return stmts.userByUsername.get(usernameLower) as UserRow | undefined;
    },
    findUserById(id: string): UserRow | undefined {
      return stmts.userById.get(id) as UserRow | undefined;
    },
    markLogin(id: string, at: number): void {
      stmts.touchLogin.run(at, id);
    },

    createSession(tokenHash: string, userId: string, now: number, expiresAt: number): void {
      stmts.insertSession.run(tokenHash, userId, now, expiresAt);
    },
    findSession(tokenHash: string): SessionRow | undefined {
      return stmts.sessionByHash.get(tokenHash) as SessionRow | undefined;
    },
    deleteSession(tokenHash: string): void {
      stmts.deleteSession.run(tokenHash);
    },
    extendSession(tokenHash: string, expiresAt: number): void {
      stmts.extendSessionStmt.run(expiresAt, tokenHash);
    },
    purgeExpiredSessions(now: number): void {
      stmts.deleteExpiredSessions.run(now);
    },

    getSave(userId: string): SaveRow | undefined {
      return stmts.saveByUser.get(userId) as SaveRow | undefined;
    },
    upsertSave(userId: string, data: string, updatedAt: number): void {
      stmts.upsertSave.run(userId, data, updatedAt);
    },

    // ---------------------------------------------------------- Hedera layer
    getHederaResource(network: string, kind: string): HederaResourceRow | undefined {
      return stmts.hederaResource.get(network, kind) as HederaResourceRow | undefined;
    },
    setHederaResource(network: string, kind: string, resourceId: string, meta: Record<string, unknown>): void {
      stmts.upsertHederaResource.run(network, kind, resourceId, JSON.stringify(meta), Date.now());
    },

    getWalletLink(userId: string): WalletLinkRow | undefined {
      return stmts.walletLinkByUser.get(userId) as WalletLinkRow | undefined;
    },
    findWalletLinkByAccount(accountId: string): WalletLinkRow | undefined {
      return stmts.walletLinkByAccount.get(accountId) as WalletLinkRow | undefined;
    },
    upsertWalletLink(
      userId: string,
      accountId: string,
      publicKey: string | null,
      method: string,
      network: string,
      linkedAt: number,
    ): void {
      stmts.upsertWalletLink.run(userId, accountId, publicKey, method, network, linkedAt);
    },
    deleteWalletLink(userId: string): void {
      stmts.deleteWalletLink.run(userId);
    },
    getCustodialWallet(userId: string): CustodialWalletRow | undefined {
      return stmts.custodialByUser.get(userId) as CustodialWalletRow | undefined;
    },
    insertCustodialWallet(row: CustodialWalletRow): void {
      stmts.insertCustodial.run(
        row.user_id,
        row.hedera_account_id,
        row.key_cipher,
        row.key_iv,
        row.key_tag,
        row.network,
        row.created_at,
      );
    },

    createNonce(nonce: string, userId: string, message: string, expiresAt: number): void {
      stmts.insertNonce.run(nonce, userId, message, Date.now(), expiresAt);
    },
    getNonce(nonce: string): NonceRow | undefined {
      return stmts.nonceByValue.get(nonce) as NonceRow | undefined;
    },
    markNonceUsed(nonce: string, at: number): void {
      stmts.markNonceUsedStmt.run(at, nonce);
    },

    insertMatch(match: MatchInsert): void {
      stmts.insertMatch.run(match);
    },
    getMatch(id: string): MatchRow | undefined {
      return stmts.matchById.get(id) as MatchRow | undefined;
    },
    latestMatchAt(userId: string): number | null {
      const row = stmts.latestMatchAtStmt.get(userId) as { created_at: number } | undefined;
      return row?.created_at ?? null;
    },
    bumpPlayerStats(userId: string, delta: PlayerStatsDelta, now: number): void {
      stmts.upsertPlayerStats.run({
        user_id: userId,
        kills: delta.kills,
        food: delta.food,
        score: delta.score,
        level: delta.level,
        kingTime: delta.kingTime,
        updated_at: now,
      });
    },
    listLeaderboard(limit: number): LeaderboardRow[] {
      return stmts.leaderboard.all(limit) as LeaderboardRow[];
    },

    insertPayoutClaim(row: PayoutClaimRow): void {
      stmts.insertPayout.run(row);
    },

    insertNftItem(row: NftItemRow): void {
      stmts.insertNftItem.run(row);
    },
    listNftItems(userId: string): NftItemRow[] {
      return stmts.nftItemsByUser.all(userId) as NftItemRow[];
    },
    findNftItem(userId: string, itemId: string): NftItemRow | undefined {
      return stmts.nftItemByItem.get(userId, itemId) as NftItemRow | undefined;
    },
    getNftMetadata(itemId: string): NftItemRow | undefined {
      return stmts.nftMetadataByItem.get(itemId) as NftItemRow | undefined;
    },
    findNftItemBySerial(itemId: string, serial: number): NftItemRow | undefined {
      return stmts.nftItemBySerial.get(itemId, serial) as NftItemRow | undefined;
    },

    /** Atomically reserve a mint slot (checks per-user duplicate + edition limit). */
    reserveNftMint(row: NftItemRow, limit: number | null): 'reserved' | 'sold_out' | 'already_minted' {
      const run = db.transaction(() => {
        const existing = stmts.nftItemByItem.get(row.user_id, row.item_id) as NftItemRow | undefined;
        if (existing) return 'already_minted' as const;
        if (limit != null) {
          const count = stmts.countItemMints.get(row.item_id) as { n: number };
          if (count.n >= limit) return 'sold_out' as const;
        }
        stmts.insertNftItem.run(row);
        return 'reserved' as const;
      });
      return run();
    },
    updateNftItem(
      id: string,
      fields: Partial<Pick<NftItemRow, 'status' | 'token_id' | 'serial_number' | 'hedera_tx_id' | 'error' | 'metadata_json'>>,
    ): void {
      stmts.updateNftItem.run({
        id,
        status: fields.status ?? null,
        token_id: fields.token_id ?? null,
        serial_number: fields.serial_number ?? null,
        hedera_tx_id: fields.hedera_tx_id ?? null,
        error: fields.error ?? null,
        metadata_json: fields.metadata_json ?? null,
      });
    },
    countItemMints(itemId: string): number {
      const row = stmts.countItemMints.get(itemId) as { n: number };
      return row.n;
    },
    mintCounts(): Array<{ item_id: string; n: number }> {
      return stmts.mintCounts.all() as Array<{ item_id: string; n: number }>;
    },

    // ------------------------------------------------------------ entitlements
    insertEntitlement(row: EntitlementRow): void {
      stmts.insertEntitlement.run(row);
    },
    findEntitlement(userId: string, itemType: string, itemId: string): EntitlementRow | undefined {
      return stmts.entitlementByUserItem.get(userId, itemType, itemId) as EntitlementRow | undefined;
    },
    listEntitlements(userId: string): EntitlementRow[] {
      return stmts.entitlementsByUser.all(userId) as EntitlementRow[];
    },
    activateEntitlement(id: string, txId: string | null): void {
      stmts.activateEntitlementStmt.run(txId, id);
    },
    deleteEntitlement(id: string): void {
      stmts.deleteEntitlementStmt.run(id);
    },

    // -------------------------------------------------------- gold conversions
    // (removed: 💰 is practice-only now; all value flows through gold_ledger)

    // ------------------------------------------------------------ $GOLD ledger
    /** Spendable in-game balance (whole $GOLD). */
    goldBalance(userId: string): number {
      const row = stmts.goldBalanceStmt.get(userId) as { balance: number } | undefined;
      return row?.balance ?? 0;
    },
    sumGoldByReasonSince(userId: string, reason: string, since: number): number {
      const row = stmts.goldSumByReasonStmt.get(userId, reason, since) as { total: number } | undefined;
      return row?.total ?? 0;
    },
    /** All-time totals grouped by movement reason (for the account summary). */
    goldTotalsByReason(userId: string): Record<string, number> {
      const out: Record<string, number> = {};
      for (const row of stmts.goldTotalsByReasonStmt.all(userId) as Array<{ reason: string; total: number }>) {
        out[row.reason] = row.total;
      }
      return out;
    },
    listGoldMovements(userId: string, limit = 25): GoldMovementRow[] {
      return stmts.goldMovementsByUser.all(userId, limit) as GoldMovementRow[];
    },
    /** Credit $GOLD (single append-only movement). */
    creditGold(userId: string, amount: number, reason: string, ref: string | null = null): void {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('creditGold: amount must be positive');
      stmts.insertGoldMovement.run({
        id: randomUUID(),
        user_id: userId,
        delta: Math.floor(amount),
        reason,
        ref,
        created_at: Date.now(),
      });
    },
    /** Debit only if affordable; false when the balance is insufficient. */
    spendGold(userId: string, amount: number, reason: string, ref: string | null = null): boolean {
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const run = db.transaction(() => {
        const balance = (stmts.goldBalanceStmt.get(userId) as { balance: number }).balance;
        if (balance < amount) return false;
        stmts.insertGoldMovement.run({
          id: randomUUID(),
          user_id: userId,
          delta: -Math.floor(amount),
          reason,
          ref,
          created_at: Date.now(),
        });
        return true;
      });
      return run();
    },
    /** Buy a shop item: debit + entitlement in one transaction. */
    purchaseItemAtomic(
      userId: string,
      entitlement: EntitlementRow,
      price: number,
    ): 'ok' | 'insufficient' | 'owned' {
      const run = db.transaction(() => {
        const existing = stmts.entitlementByUserItem.get(
          userId,
          entitlement.item_type,
          entitlement.item_id,
        ) as EntitlementRow | undefined;
        if (existing) return 'owned' as const;
        const balance = (stmts.goldBalanceStmt.get(userId) as { balance: number }).balance;
        if (balance < price) return 'insufficient' as const;
        stmts.insertGoldMovement.run({
          id: randomUUID(),
          user_id: userId,
          delta: -price,
          reason: 'purchase',
          ref: `${entitlement.item_type}:${entitlement.item_id}`,
          created_at: Date.now(),
        });
        stmts.insertEntitlement.run(entitlement);
        return 'ok' as const;
      });
      return run();
    },
    /** Server-owned workshop upgrade levels. */
    upgradeLevels(userId: string): Record<string, number> {
      const out: Record<string, number> = {};
      for (const row of stmts.upgradesByUser.all(userId) as Array<{ upgrade_id: string; level: number }>) {
        out[row.upgrade_id] = row.level;
      }
      return out;
    },
    /** Buy the next upgrade level; pricing is based on the server-owned level. */
    purchaseUpgradeAtomic(
      userId: string,
      upgradeId: string,
      maxLevel: number,
      priceForLevel: (level: number) => number,
    ): { result: 'ok' | 'insufficient' | 'maxed'; level: number; price?: number } {
      const run = db.transaction(() => {
        const row = stmts.upgradeByUser.get(userId, upgradeId) as { level: number } | undefined;
        const level = row?.level ?? 0;
        if (level >= maxLevel) return { result: 'maxed' as const, level };
        const price = priceForLevel(level);
        const balance = (stmts.goldBalanceStmt.get(userId) as { balance: number }).balance;
        if (balance < price) return { result: 'insufficient' as const, level };
        stmts.insertGoldMovement.run({
          id: randomUUID(),
          user_id: userId,
          delta: -price,
          reason: 'upgrade',
          ref: `${upgradeId}:${level + 1}`,
          created_at: Date.now(),
        });
        stmts.upsertUpgrade.run(userId, upgradeId, level + 1, Date.now());
        return { result: 'ok' as const, level: level + 1, price };
      });
      return run();
    },
    /** One claim per kind+ref (daily/wheel/stage); credits the ledger atomically. */
    claimReward(userId: string, kind: string, ref: string, amount: number): boolean {
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const run = db.transaction(() => {
        try {
          stmts.insertRewardClaim.run({
            id: randomUUID(),
            user_id: userId,
            kind,
            ref,
            amount: Math.floor(amount),
            created_at: Date.now(),
          });
        } catch {
          return false; // already claimed for this period
        }
        stmts.insertGoldMovement.run({
          id: randomUUID(),
          user_id: userId,
          delta: Math.floor(amount),
          reason: `${kind}_reward`,
          ref,
          created_at: Date.now(),
        });
        return true;
      });
      return run();
    },
    countRewardClaims(userId: string, kind: string): number {
      const row = stmts.countRewardClaimsStmt.get(userId, kind) as { n: number } | undefined;
      return row?.n ?? 0;
    },

    close(): void {
      db.close();
    },
  };
}
