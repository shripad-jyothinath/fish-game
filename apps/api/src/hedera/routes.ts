/**
 * HTTP surface for the Hedera layer:
 *   GET  /api/v1/hedera/status          integration status (public)
 *   GET  /api/v1/leaderboard            global top scores (public)
 *   POST /api/v1/matches                record a finished match + reward (auth)
 *   GET  /api/v1/matches/:id            public match receipt
 *   GET  /api/v1/hedera/link            current wallet link (auth)
 *   POST /api/v1/hedera/link/challenge  start wallet linking (auth)
 *   POST /api/v1/hedera/link/verify     finish wallet linking (auth)
 *   DEL  /api/v1/hedera/link            unlink wallet (auth)
 *   GET  /api/v1/hedera/gold            in-game $GOLD balance + wallet (auth)
 *   POST /api/v1/hedera/gold/withdraw   in-game $GOLD → wallet (auth)
 *   POST /api/v1/hedera/gold/deposit    wallet → in-game $GOLD (auth)
 *   POST /api/v1/me/reward/daily|wheel|stage   one-claim-per-period rewards (auth)
 *   POST /api/v1/hedera/room-ticket     signed ticket for online arenas (auth)
 *   POST /internal/matches              room-server result intake (HMAC-signed)
 *   GET  /api/v1/hedera/shop            $GOLD shop catalog + prices (public)
 *   POST /api/v1/hedera/shop/purchase   buy a cosmetic with $GOLD (auth)
 *   GET  /api/v1/me/entitlements        server-side owned items (auth)
 *   GET  /api/v1/hedera/nfts            owned NFTs (auth)
 *   POST /api/v1/hedera/nfts/mint       mint an owned cosmetic (auth)
 *   GET  /api/v1/hedera/nft/metadata/:itemId   HIP-412 metadata (public)
 *   GET  /api/v1/hedera/nft/image/:itemId      generated SVG art (public)
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AuthGuard } from '../auth.ts';
import { verifyPassword } from '../auth.ts';
import type { EntitlementRow, NftItemRow, Store } from '../db.ts';
import { hashscanNftUrl, hashscanTxUrl } from './config.ts';
import type { MatchStats } from './rewards.ts';
import type { HederaServices } from './services.ts';
import {
  findGoldShopItem,
  goldShop,
  upgradeDefs,
  upgradePriceFor,
  upgradePrices,
  type GoldShopItem,
} from './shop.ts';
import { signRoomTicket, verifyInternalBody, verifyRoomTicket } from './tickets.ts';
import { WalletLinkError } from './wallet.ts';

const ITEM_TYPES = ['fish', 'weapon', 'hat'] as const;
type ItemType = (typeof ITEM_TYPES)[number];

/** Serializes wallet-moving operations per user (deposits sign on-chain). */
const walletOpsInFlight = new Set<string>();

// ------------------------------------------------------------- reward tables
const DAILY_AMOUNTS = [5, 10, 15, 20, 25, 40, 60];
const WHEEL_TABLE: ReadonlyArray<{ amount: number; weight: number }> = [
  { amount: 5, weight: 30 },
  { amount: 10, weight: 25 },
  { amount: 15, weight: 18 },
  { amount: 20, weight: 12 },
  { amount: 30, weight: 8 },
  { amount: 50, weight: 5 },
  { amount: 100, weight: 2 },
  { amount: 250, weight: 1 },
];
const STAGE_AMOUNTS = [10, 15, 20, 25, 35, 45, 60, 75, 95, 120, 150, 185, 225, 270, 320];

function utcDayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function entitlementFor(userId: string, item: GoldShopItem): EntitlementRow {
  return {
    id: randomUUID(),
    user_id: userId,
    item_type: item.type,
    item_id: item.id,
    source: 'gold_purchase',
    status: 'active',
    price_gold: item.priceGold,
    hedera_tx_id: null,
    created_at: Date.now(),
  };
}

const SAVE_LISTS: Record<ItemType, string> = {
  fish: 'unlockedFish',
  weapon: 'unlockedWeapons',
  hat: 'unlockedHats',
};

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function clampInt(value: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function ownsItem(store: Store, userId: string, itemType: ItemType, itemId: string): boolean {
  const entitlement = store.findEntitlement(userId, itemType, itemId);
  if (entitlement?.status === 'active') return true;
  const save = store.getSave(userId);
  if (!save) return false;
  try {
    const data = JSON.parse(save.data) as Record<string, unknown>;
    const list = data[SAVE_LISTS[itemType]];
    return Array.isArray(list) && list.includes(itemId);
  } catch {
    return false;
  }
}

function toPublicNft(row: NftItemRow, settings: HederaServices['settings']) {
  return {
    id: row.id,
    itemId: row.item_id,
    itemType: row.item_type,
    name: row.name,
    status: row.status,
    tokenId: row.token_id,
    serial: row.serial_number,
    createdAt: row.created_at,
    hashscanUrl:
      row.token_id && row.serial_number != null ? hashscanNftUrl(settings, row.token_id, row.serial_number) : null,
  };
}

function renderItemSvg(itemId: string, label: string, category: string, serial: number | null): string {
  const baseHue = [...itemId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  const hue = serial == null ? baseHue : (baseHue + serial * 37) % 360;
  const safeLabel = label.replace(/[<>&"']/g, '').slice(0, 24) || itemId;
  const safeCategory = category.replace(/[<>&"']/g, '').slice(0, 12);
  const editionLine =
    serial == null
      ? ''
      : `<text x="256" y="470" font-family="Segoe UI, sans-serif" font-size="22" font-weight="700" fill="rgba(255,255,255,0.55)" text-anchor="middle">EDITION #${serial}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 70% 42%)"/><stop offset="100%" stop-color="hsl(${(hue + 48) % 360} 80% 24%)"/>
</linearGradient></defs>
<rect width="512" height="512" rx="64" fill="url(#g)"/>
<circle cx="256" cy="220" r="118" fill="rgba(255,255,255,0.12)"/>
<text x="256" y="258" font-family="Segoe UI, sans-serif" font-size="120" font-weight="800" fill="#fff" text-anchor="middle">${safeLabel.charAt(0).toUpperCase()}</text>
<text x="256" y="380" font-family="Segoe UI, sans-serif" font-size="38" font-weight="700" fill="rgba(255,255,255,0.92)" text-anchor="middle">${safeLabel}</text>
<text x="256" y="428" font-family="Segoe UI, sans-serif" font-size="24" font-weight="600" fill="rgba(255,255,255,0.6)" text-anchor="middle">${safeCategory} · Fish.IO</text>
${editionLine}
</svg>`;
}

export function registerHederaRoutes(
  app: FastifyInstance,
  store: Store,
  services: HederaServices,
  requireUser: AuthGuard,
  internal: { hmacSecret: string },
): void {
  const { settings } = services;

  // ---------------------------------------------------------------- status
  app.get('/api/v1/hedera/status', async () => ({
    configured: settings.enabled,
    online: services.online,
    network: settings.network,
    credentialsError: services.credentialsError,
    topicId: settings.topicId || store.getHederaResource(settings.network, 'hcs_topic')?.resource_id || null,
    goldTokenId: settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')?.resource_id || null,
    nftCollectionId:
      settings.nftCollectionId || store.getHederaResource(settings.network, 'nft_collection')?.resource_id || null,
    gold: { name: settings.goldName, symbol: settings.goldSymbol, decimals: settings.goldDecimals },
    rewards: { dailyCap: settings.rewardDailyCap, matchCap: settings.rewardMatchCap },
    autoWallets: Boolean(services.custody),
    walletLink: {
      method: 'transfer',
      operatorAccountId: settings.operatorId || null,
      amountTinybar: 1,
    },
    hashscanBaseUrl: settings.hashscanBaseUrl,
  }));

  // ---------------------------------------------------------------- matches
  app.post('/api/v1/matches', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stats: MatchStats = {
      mode: body.mode === 'frenzy' ? 'frenzy' : body.mode === 'challenge' ? 'challenge' : 'classic',
      score: clampInt(body.score, 0, 10_000_000),
      kills: clampInt(body.kills, 0, 1_000),
      level: clampInt(body.level, 1, 100, 1),
      food: clampInt(body.food, 0, 1_000_000),
      chests: clampInt(body.chests, 0, 10_000),
      kingTime: clampInt(body.kingTime, 0, 86_400),
      durationMs: clampInt(body.durationMs, 0, 4 * 60 * 60 * 1000),
    };
    try {
      const result = await services.rewards.recordMatch(user.id, stats);
      return reply.code(201).send(result);
    } catch (err) {
      if ((err as { code?: string }).code === 'match_cooldown') {
        return reply.code(429).send(errorBody('match_cooldown', (err as Error).message));
      }
      throw err;
    }
  });

  app.get('/api/v1/matches/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = store.getMatch(id);
    if (!row) return reply.code(404).send(errorBody('not_found', 'Unknown match.'));
    const username = row.user_id ? store.findUserById(row.user_id)?.username ?? 'deleted' : 'deleted';
    return {
      id: row.id,
      username,
      mode: row.mode,
      score: row.score,
      kills: row.kills,
      level: row.max_level,
      food: row.food_eaten,
      chests: row.chests,
      kingTime: row.king_time_s,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      reward: row.reward_gold,
      receipt: {
        status: row.hcs_status,
        topicId: row.hcs_topic_id,
        sequenceNumber: row.hcs_sequence,
        transactionId: row.hcs_tx_id,
        hashscanUrl: row.hcs_tx_id ? hashscanTxUrl(settings, row.hcs_tx_id) : null,
      },
    };
  });

  // ---------------------------------------------------------------- leaderboard
  app.get('/api/v1/leaderboard', async () => {
    const entries = store.listLeaderboard(50).map((row, index) => ({
      rank: index + 1,
      username: row.username,
      score: row.best_score,
      kills: row.total_kills,
      matches: row.matches_played,
      mode: row.mode ?? 'classic',
      lastPlayedAt: row.last_played_at,
      receiptUrl: row.hcs_tx_id ? hashscanTxUrl(settings, row.hcs_tx_id) : null,
    }));
    return { season: null, network: settings.network, online: services.online, entries };
  });

  // ---------------------------------------------------------------- wallet link
  app.get('/api/v1/hedera/link', { preHandler: requireUser }, async (req) => {
    const user = req.user;
    const external = user ? services.wallet.getLink(user.id) : null;
    let custodial = user && services.custody ? services.custody.getWallet(user.id) : null;
    // Existing accounts get their managed wallet on first look (new signups get it at registration).
    if (user && services.custody && !external && !custodial) {
      custodial = await services.custody.ensureWallet(user.id);
    }
    return {
      linked: Boolean(external || custodial),
      link: external
        ? { accountId: external.accountId, method: external.method, network: external.network, linkedAt: external.linkedAt }
        : custodial
          ? { accountId: custodial.accountId, method: 'custodial', network: custodial.network, linkedAt: custodial.createdAt, managed: true }
          : null,
      custodial: custodial ? { accountId: custodial.accountId, managed: true, exportable: true } : null,
      autoWallets: Boolean(services.custody),
      network: settings.network,
      operatorAccountId: settings.operatorId || null,
      method: 'transfer',
      amountTinybar: 1,
    };
  });

  app.post('/api/v1/hedera/wallet/export', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    if (!services.custody) {
      return reply.code(503).send(errorBody('hedera_disabled', 'Hedera is not configured on this server yet.'));
    }
    const body = (req.body ?? {}) as { password?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    const row = store.findUserById(user.id);
    if (!row || !password || !verifyPassword(password, row.password_hash)) {
      return reply.code(403).send(errorBody('bad_password', 'Wrong password.'));
    }
    const exported = services.custody.exportKey(user.id);
    if (!exported) return reply.code(404).send(errorBody('no_wallet', 'No managed wallet on this account.'));
    reply.header('cache-control', 'no-store');
    return {
      ...exported,
      warning: 'Testnet wallet — import into HashPack/Blade. Never share the private key.',
    };
  });

  app.post('/api/v1/hedera/link/challenge', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as { accountId?: unknown };
    const challenge = services.wallet.createChallenge(
      user.id,
      typeof body.accountId === 'string' ? body.accountId : undefined,
    );
    return {
      nonce: challenge.nonce,
      message: challenge.message,
      instructions: challenge.instructions,
      expiresAt: challenge.expiresAt,
      network: settings.network,
    };
  });

  app.post('/api/v1/hedera/link/verify', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const method = body.method === 'signature' ? 'signature' : 'transfer';
    if (method === 'transfer' && !settings.operatorId) {
      return reply.code(503).send(errorBody('hedera_disabled', 'Hedera is not configured on this server yet.'));
    }
    try {
      const link =
        method === 'signature'
          ? services.wallet.verifySignature(user.id, body)
          : await services.wallet.verifyTransfer(user.id, body);
      return {
        linked: true,
        link: { accountId: link.accountId, method: link.method, network: link.network, linkedAt: link.linkedAt },
      };
    } catch (err) {
      if (err instanceof WalletLinkError) {
        return reply.code(400).send(errorBody(err.code, err.message));
      }
      app.log.warn({ err }, 'wallet link verify failed');
      return reply.code(502).send(errorBody('mirror_unavailable', 'Could not check the transfer right now. Try again.'));
    }
  });

  app.delete('/api/v1/hedera/link', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    services.wallet.unlink(user.id);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- $GOLD
  app.get('/api/v1/hedera/gold', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const summary = services.rewards.ledgerSummary(user.id);
    const link = services.wallet.getLink(user.id);
    const custodial = services.custody?.getWallet(user.id) ?? null;
    const walletAccountId = link?.accountId ?? custodial?.accountId ?? null;
    const tokenId = settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')?.resource_id || null;
    let walletBalance: number | null = null;
    if (services.online && walletAccountId && tokenId) {
      try {
        const base = await services.mirror.tokenBalance(walletAccountId, tokenId);
        walletBalance = Math.floor((base / 10 ** settings.goldDecimals) * 100) / 100;
      } catch {
        walletBalance = null; // mirror hiccup: the rest of the response is still useful
      }
    }
    return {
      enabled: services.online,
      network: settings.network,
      tokenId,
      symbol: settings.goldSymbol,
      decimals: settings.goldDecimals,
      balance: summary.balance,
      earned: summary.earned,
      withdrawn: summary.withdrawn,
      walletAccountId,
      walletBalance,
      linked: Boolean(link),
      externalAccountId: link?.accountId ?? null,
      recent: store.listGoldMovements(user.id, 10).map((row) => ({
        delta: row.delta,
        reason: row.reason,
        ref: row.ref,
        at: row.created_at,
      })),
    };
  });

  // In-game $GOLD balance → Hedera wallet.
  app.post('/api/v1/hedera/gold/withdraw', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requested =
      body.amount === undefined || body.amount === null || body.amount === 'all' ? 'all' : Number(body.amount);
    try {
      const result = await services.rewards.withdraw(user.id, requested, services.wallet);
      return {
        amount: result.amount,
        method: result.payment.method,
        transactionId: result.payment.transactionId,
        hashscanUrl: hashscanTxUrl(settings, result.payment.transactionId),
        balance: store.goldBalance(user.id),
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (
        code === 'wallet_not_linked' ||
        code === 'insufficient_gold' ||
        code === 'invalid_amount' ||
        code === 'payout_disabled'
      ) {
        return reply.code(409).send(errorBody(code, (err as Error).message));
      }
      app.log.error({ err }, 'gold withdraw failed');
      return reply
        .code(502)
        .send(errorBody('payout_failed', 'On-chain transfer failed — your $GOLD stays in your in-game balance.'));
    }
  });

  // Hedera wallet → in-game $GOLD balance (custodial wallets for now).
  app.post('/api/v1/hedera/gold/deposit', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    if (!services.online || !services.token || !services.custody) {
      return reply.code(503).send(errorBody('hedera_disabled', 'Hedera is not configured on this server yet.'));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Math.floor(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send(errorBody('invalid_amount', 'Enter a positive $GOLD amount.'));
    }
    if (store.getWalletLink(user.id)) {
      return reply
        .code(409)
        .send(errorBody('external_wallet', 'Deposits from an external wallet are not supported yet — use your in-game wallet.'));
    }
    if (walletOpsInFlight.has(user.id)) {
      return reply.code(429).send(errorBody('in_progress', 'A wallet operation is already running.'));
    }
    walletOpsInFlight.add(user.id);
    try {
      const wallet = await services.custody.ensureWallet(user.id);
      const exported = wallet ? services.custody.exportKey(user.id) : null;
      if (!wallet || !exported) {
        return reply.code(503).send(errorBody('wallet_unavailable', 'Your wallet is not ready yet. Try again in a moment.'));
      }
      const payment = await services.token.transferGoldToTreasury(wallet.accountId, exported.privateKeyDer, amount);
      store.creditGold(user.id, amount, 'deposit', payment.transactionId);
      return reply.code(201).send({
        amount,
        balance: store.goldBalance(user.id),
        transactionId: payment.transactionId,
        hashscanUrl: hashscanTxUrl(settings, payment.transactionId),
      });
    } catch (err) {
      app.log.warn({ err }, 'gold deposit failed');
      return reply
        .code(502)
        .send(errorBody('deposit_failed', 'On-chain transfer failed — do you have enough $GOLD in your wallet?'));
    } finally {
      walletOpsInFlight.delete(user.id);
    }
  });

  // ---------------------------------------------------------- daily rewards
  app.post('/api/v1/me/reward/daily', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const claims = store.countRewardClaims(user.id, 'daily');
    const amount = DAILY_AMOUNTS[claims % DAILY_AMOUNTS.length]!;
    if (!store.claimReward(user.id, 'daily', utcDayKey(), amount)) {
      return reply.code(409).send(errorBody('already_claimed', 'Daily gift already claimed today.'));
    }
    return { amount, balance: store.goldBalance(user.id) };
  });

  // ------------------------------------------------------------ lucky wheel
  app.post('/api/v1/me/reward/wheel', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const total = WHEEL_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
    const roll = Math.random() * total;
    let acc = 0;
    let amount = WHEEL_TABLE[0]!.amount;
    for (const entry of WHEEL_TABLE) {
      acc += entry.weight;
      if (roll <= acc) {
        amount = entry.amount;
        break;
      }
    }
    if (!store.claimReward(user.id, 'wheel', utcDayKey(), amount)) {
      return reply.code(409).send(errorBody('already_claimed', 'One spin per day — come back tomorrow!'));
    }
    return { amount, balance: store.goldBalance(user.id) };
  });

  // ------------------------------------------------------------ stage clear
  app.post('/api/v1/me/reward/stage', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const level = clampInt(body.level, 1, STAGE_AMOUNTS.length, 0);
    if (!level) return reply.code(400).send(errorBody('invalid_stage', 'Unknown stage.'));
    const amount = STAGE_AMOUNTS[level - 1]!;
    if (!store.claimReward(user.id, 'stage', String(level), amount)) {
      return reply.code(409).send(errorBody('already_claimed', 'Stage reward already claimed.'));
    }
    return { level, amount, balance: store.goldBalance(user.id) };
  });

  // --------------------------------------------------- online arena tickets
  app.post('/api/v1/hedera/room-ticket', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    if (!internal.hmacSecret) {
      return reply.code(503).send(errorBody('tickets_disabled', 'Room tickets are not configured on this server.'));
    }
    return { ticket: signRoomTicket(internal.hmacSecret, user.id, user.username), expiresInMs: 10 * 60 * 1000 };
  });

  // ---------------------------------------------- room-server result intake
  // The room server posts finished online matches here. A dedicated raw content
  // type means the HMAC signature covers the exact bytes that were sent, with no
  // re-serialization differences.
  app.addContentTypeParser('application/vnd.fishio.intake+json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/internal/matches', async (req, reply) => {
    const secret = internal.hmacSecret;
    if (!secret) return reply.code(503).send(errorBody('intake_disabled', 'Match intake is not configured.'));

    const rawBody = typeof req.body === 'string' ? req.body : '';
    const signature = req.headers['x-fishio-signature'];
    if (!rawBody || !verifyInternalBody(secret, rawBody, signature)) {
      return reply.code(401).send(errorBody('bad_signature', 'Invalid signature.'));
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return reply.code(400).send(errorBody('bad_body', 'Body must be JSON.'));
    }

    const userId = typeof body.userId === 'string' ? body.userId : '';
    const user = userId ? store.findUserById(userId) : undefined;
    if (!user) return reply.code(404).send(errorBody('unknown_user', 'No such account.'));

    const input = (body.stats ?? {}) as Record<string, unknown>;
    const stats: MatchStats = {
      mode: input.mode === 'frenzy' ? 'frenzy' : 'classic',
      score: clampInt(input.score, 0, 10_000_000, 0),
      kills: clampInt(input.kills, 0, 10_000, 0),
      level: clampInt(input.level, 1, 1000, 1),
      food: clampInt(input.food, 0, 1_000_000, 0),
      chests: clampInt(input.chests, 0, 100_000, 0),
      kingTime: clampInt(input.kingTime, 0, 100_000, 0),
      durationMs: clampInt(input.durationMs, 0, 60 * 60 * 1000, 0),
    };

    try {
      const result = await services.rewards.recordMatch(user.id, stats);
      return reply.code(201).send({ user: { id: user.id, username: user.username }, ...result });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'match_cooldown') {
        return reply.code(429).send(errorBody('match_cooldown', (err as Error).message));
      }
      app.log.error({ err, userId: user.id }, 'internal match intake failed');
      return reply.code(500).send(errorBody('record_failed', 'Could not record the match.'));
    }
  });

  // ------------------------------------------------------- $GOLD shop (cosmetics)
  app.get('/api/v1/hedera/shop', async () => {
    const { items } = goldShop();
    return {
      network: settings.network,
      online: services.online,
      symbol: settings.goldSymbol,
      decimals: settings.goldDecimals,
      items: items.map((item) => ({
        type: item.type,
        id: item.id,
        name: item.name,
        costGold: item.costGold,
        priceGold: item.priceGold,
      })),
      upgrades: [...upgradeDefs().values()].map((def) => ({ id: def.id, name: def.name, maxLevel: def.maxLevel })),
      upgradePrices: upgradePrices(),
    };
  });

  app.get('/api/v1/me/entitlements', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    return {
      items: store
        .listEntitlements(user.id)
        .filter((row) => row.status === 'active')
        .map((row) => ({
          type: row.item_type,
          id: row.item_id,
          source: row.source,
          paidGold: row.price_gold,
          txId: row.hedera_tx_id,
          createdAt: row.created_at,
        })),
    };
  });

  // Instant ledger purchase: debit the in-game balance and grant the item in
  // one atomic transaction. No chain latency; withdrawing $GOLD is separate.
  app.post('/api/v1/hedera/shop/purchase', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));

    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = findGoldShopItem(body.type, body.id);
    if (!item) return reply.code(404).send(errorBody('invalid_item', 'That item is not sold for $GOLD.'));

    const result = store.purchaseItemAtomic(user.id, entitlementFor(user.id, item), item.priceGold);
    if (result === 'owned') {
      return reply.code(409).send(errorBody('already_owned', 'You already own this item.'));
    }
    if (result === 'insufficient') {
      return reply.code(402).send({
        error: { code: 'insufficient_gold', message: `Not enough $GOLD — you need ${item.priceGold}.` },
        balance: store.goldBalance(user.id),
        priceGold: item.priceGold,
      });
    }
    return reply.code(201).send({
      item,
      entitlement: {
        type: item.type,
        id: item.id,
        source: 'gold_purchase',
        paidGold: item.priceGold,
        txId: null,
      },
      balance: store.goldBalance(user.id),
    });
  });

  // ------------------------------------------------------------ upgrades
  app.get('/api/v1/me/upgrades', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    return { levels: store.upgradeLevels(user.id) };
  });

  app.post('/api/v1/hedera/shop/upgrade', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const def = upgradeDefs().get(id);
    if (!def) return reply.code(404).send(errorBody('invalid_upgrade', 'Unknown upgrade.'));

    const result = store.purchaseUpgradeAtomic(user.id, id, def.maxLevel, (level) => upgradePriceFor(level));
    if (result.result === 'maxed') {
      return reply.code(409).send(errorBody('max_level', 'This upgrade is already maxed.'));
    }
    if (result.result === 'insufficient') {
      const price = upgradePriceFor(result.level);
      return reply.code(402).send({
        error: { code: 'insufficient_gold', message: `This upgrade costs ${price} $GOLD.` },
        balance: store.goldBalance(user.id),
        priceGold: price,
        level: result.level,
      });
    }
    return {
      id,
      level: result.level,
      price: result.price,
      balance: store.goldBalance(user.id),
    };
  });

  // ---------------------------------------------------------------- NFTs
  app.get('/api/v1/hedera/nfts', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const counts = new Map(store.mintCounts().map((row) => [row.item_id, row.n]));
    const editions: Record<string, { limit: number; minted: number; remaining: number }> = {};
    for (const [editionItemId, editionLimit] of Object.entries(settings.editionLimits)) {
      const mintedCount = counts.get(editionItemId) ?? 0;
      editions[editionItemId] = {
        limit: editionLimit,
        minted: mintedCount,
        remaining: Math.max(0, editionLimit - mintedCount),
      };
    }
    return {
      collectionId:
        settings.nftCollectionId ||
        store.getHederaResource(settings.network, 'nft_collection')?.resource_id ||
        null,
      editions,
      items: store.listNftItems(user.id).map((row) => toPublicNft(row, settings)),
    };
  });

  app.post('/api/v1/hedera/nfts/mint', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    if (!services.online || !services.nft) {
      return reply.code(503).send(errorBody('hedera_disabled', 'Hedera is not configured on this server yet.'));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const itemType = ITEM_TYPES.includes(body.itemType as ItemType) ? (body.itemType as ItemType) : null;
    const itemId = clampText(body.itemId, 60);
    const name = clampText(body.name, 60) || itemId;
    const description = clampText(body.description, 200);
    if (!itemType || !itemId) {
      return reply.code(400).send(errorBody('invalid_item', 'itemId and itemType (fish|weapon|hat) are required.'));
    }
    if (!ownsItem(store, user.id, itemType, itemId)) {
      return reply.code(403).send(errorBody('item_not_owned', 'Unlock this item in the game before minting it.'));
    }
    const link = services.wallet.getPayoutWallet(user.id);
    if (!link) {
      return reply.code(409).send(errorBody('wallet_not_linked', 'Link a Hedera wallet before minting NFTs.'));
    }

    // Reserve the mint slot first (atomic): blocks duplicate mints and enforces
    // edition caps BEFORE any Hedera transaction is spent.
    const limit = settings.editionLimits[itemId] ?? null;
    const reserved: NftItemRow = {
      id: randomUUID(),
      user_id: user.id,
      item_id: itemId,
      item_type: itemType,
      name,
      description,
      token_id: null,
      serial_number: null,
      status: 'minting',
      hedera_tx_id: null,
      error: null,
      metadata_json: '{}',
      created_at: Date.now(),
    };
    const reservation = store.reserveNftMint(reserved, limit);
    if (reservation === 'already_minted') {
      return reply.code(409).send(errorBody('already_minted', 'This item is already minted on-chain.'));
    }
    if (reservation === 'sold_out') {
      return reply.code(409).send(
        errorBody(
          'sold_out',
          `Limited edition: ${limit === 1 ? 'only 1 copy exists' : `only ${limit} copies exist`} and all are minted.`,
        ),
      );
    }

    try {
      const minted = await services.nft.mintItem({ itemId, itemType, toAccountId: link.accountId });
      const metadata: Record<string, unknown> = {
        name,
        description: description || `${itemType} cosmetic from Fish.IO`,
        image: services.nft.imageUri(itemId, minted.serial),
        type: 'image/svg+xml',
        creator: 'Fish.IO',
        attributes: [
          { trait_type: 'category', value: itemType },
          { trait_type: 'game', value: 'fish.io' },
          { trait_type: 'edition', value: limit ? `${minted.serial}/${limit}` : 'open' },
        ],
      };
      store.updateNftItem(reserved.id, {
        status: 'minted',
        token_id: minted.tokenId,
        serial_number: minted.serial,
        hedera_tx_id: minted.transactionId,
        error: null,
        metadata_json: JSON.stringify(metadata),
      });
      const row: NftItemRow = {
        ...reserved,
        token_id: minted.tokenId,
        serial_number: minted.serial,
        status: 'minted',
        hedera_tx_id: minted.transactionId,
        metadata_json: JSON.stringify(metadata),
      };
      return reply.code(201).send({ item: toPublicNft(row, settings) });
    } catch (err) {
      store.updateNftItem(reserved.id, {
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 200) : 'mint failed',
      });
      app.log.error({ err }, 'nft mint failed');
      return reply.code(502).send(errorBody('mint_failed', 'Mint failed on Hedera. Nothing was charged — try again.'));
    }
  });

  // ---------------------------------------------------------------- public metadata
  app.get('/api/v1/hedera/nft/metadata/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const row = store.getNftMetadata(itemId);
    if (!row) return reply.code(404).send(errorBody('not_found', 'No metadata for this item yet.'));
    reply.type('application/json');
    return row.metadata_json;
  });

  app.get('/api/v1/hedera/nft/metadata/:itemId/:serial', async (req, reply) => {
    const { itemId, serial } = req.params as { itemId: string; serial: string };
    const serialNumber = Number(serial);
    const row = Number.isFinite(serialNumber) ? store.findNftItemBySerial(itemId, Math.floor(serialNumber)) : undefined;
    if (!row) return reply.code(404).send(errorBody('not_found', 'No metadata for this serial yet.'));
    reply.type('application/json');
    return row.metadata_json;
  });

  app.get('/api/v1/hedera/nft/image/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const query = req.query as { serial?: string };
    const serialNumber = Number(query.serial);
    const serial = Number.isFinite(serialNumber) && serialNumber > 0 ? Math.floor(serialNumber) : null;
    const safe = itemId.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!safe) return reply.code(400).send(errorBody('invalid_item', 'Bad item id.'));
    const metadata = store.getNftMetadata(safe);
    let label = safe.replace(/_/g, ' ');
    let category = '';
    if (metadata) {
      try {
        const parsed = JSON.parse(metadata.metadata_json) as { name?: string; attributes?: Array<{ trait_type: string; value: string }> };
        if (parsed.name) label = parsed.name;
        category = parsed.attributes?.find((a) => a.trait_type === 'category')?.value ?? '';
      } catch {
        // fall back to the id
      }
    }
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400');
    return renderItemSvg(safe, label, category, serial);
  });
}
