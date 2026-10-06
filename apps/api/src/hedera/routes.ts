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
 *   GET  /api/v1/hedera/gold            $GOLD totals + wallet balance (auth)
 *   POST /api/v1/hedera/gold/claim      pay out pending $GOLD (auth)
 *   POST /api/v1/hedera/gold/convert    💰 → pending $GOLD (auth, capped)
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
import { wholeToBaseUnits } from './client.ts';
import { hashscanNftUrl, hashscanTxUrl } from './config.ts';
import type { MatchStats } from './rewards.ts';
import type { HederaServices } from './services.ts';
import { findGoldShopItem, goldShop } from './shop.ts';
import { signRoomTicket, verifyInternalBody, verifyRoomTicket } from './tickets.ts';
import { WalletLinkError } from './wallet.ts';

const ITEM_TYPES = ['fish', 'weapon', 'hat'] as const;
type ItemType = (typeof ITEM_TYPES)[number];

/** Serializes $GOLD purchases per user (balance checks race otherwise). */
const purchasesInFlight = new Set<string>();

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
    const totals = services.rewards.totals(user.id);
    const link = services.wallet.getLink(user.id);
    const custodial = services.custody?.getWallet(user.id) ?? null;
    const walletAccountId = link?.accountId ?? custodial?.accountId ?? null;
    const tokenId = settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')?.resource_id || null;
    const day = new Date();
    const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const convertedToday = store.sumGoldConvertedSince(user.id, dayStart);
    let balance: number | null = null;
    if (services.online && walletAccountId && tokenId) {
      try {
        const base = await services.mirror.tokenBalance(walletAccountId, tokenId);
        balance = Math.floor((base / 10 ** settings.goldDecimals) * 100) / 100;
      } catch {
        balance = null; // mirror hiccup: the rest of the response is still useful
      }
    }
    return {
      enabled: services.online,
      network: settings.network,
      tokenId,
      symbol: settings.goldSymbol,
      decimals: settings.goldDecimals,
      pending: totals.pending,
      paid: totals.paid,
      totalEarned: totals.totalEarned,
      linked: Boolean(link),
      accountId: link?.accountId ?? null,
      walletAccountId,
      balance,
      convertRate: settings.goldConvertRate,
      convertRemaining: Math.max(0, settings.goldConvertDailyGold - convertedToday),
    };
  });

  app.post('/api/v1/hedera/gold/claim', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    try {
      const result = await services.rewards.claim(user.id, services.wallet);
      return {
        amount: result.amount,
        method: result.payment.method,
        transactionId: result.payment.transactionId,
        hashscanUrl: hashscanTxUrl(settings, result.payment.transactionId),
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'wallet_not_linked' || code === 'nothing_to_claim' || code === 'payout_disabled') {
        return reply.code(409).send(errorBody(code, (err as Error).message));
      }
      app.log.error({ err }, 'gold claim failed');
      return reply.code(502).send(errorBody('payout_failed', 'On-chain payout failed. Your $GOLD stays pending; try again.'));
    }
  });

  // ------------------------------------------------------- $GOLD conversion
  app.post('/api/v1/hedera/gold/convert', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = services.rewards.convertGold(user.id, Number(body.gold));
      return { ...result, symbol: settings.goldSymbol };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'below_minimum' || code === 'invalid_amount' || code === 'conversion_disabled') {
        return reply.code(400).send(errorBody(code, (err as Error).message));
      }
      throw err;
    }
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

  app.post('/api/v1/hedera/shop/purchase', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send(errorBody('unauthorized', 'Sign in required.'));
    if (!services.online || !services.token || !services.custody) {
      return reply.code(503).send(errorBody('hedera_disabled', 'Hedera is not configured on this server yet.'));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const item = findGoldShopItem(body.type, body.id);
    if (!item) return reply.code(404).send(errorBody('invalid_item', 'That item is not sold for $GOLD.'));

    if (store.findEntitlement(user.id, item.type, item.id)) {
      return reply.code(409).send(errorBody('already_owned', 'You already own this item.'));
    }
    if (store.getWalletLink(user.id)) {
      return reply
        .code(409)
        .send(
          errorBody(
            'external_wallet',
            'Purchases with $GOLD currently use your in-game wallet. Unlink your external wallet to use it.',
          ),
        );
    }
    if (purchasesInFlight.has(user.id)) {
      return reply.code(429).send(errorBody('purchase_in_progress', 'A purchase is already being processed.'));
    }
    purchasesInFlight.add(user.id);

    try {
      const wallet = await services.custody.ensureWallet(user.id);
      if (!wallet) {
        return reply.code(503).send(errorBody('wallet_unavailable', 'Your wallet is not ready yet. Try again in a moment.'));
      }
      const exported = services.custody.exportKey(user.id);
      const tokenId =
        settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')?.resource_id || null;
      if (!exported || !tokenId) {
        return reply.code(503).send(errorBody('hedera_disabled', 'The $GOLD token is not ready on this server yet.'));
      }

      const factor = 10 ** settings.goldDecimals;
      const balanceBase = await services.mirror.tokenBalance(wallet.accountId, tokenId);
      if (balanceBase < item.priceGold * factor) {
        const totals = services.rewards.totals(user.id);
        return reply.code(402).send({
          error: {
            code: 'insufficient_gold',
            message: 'Not enough $GOLD in your wallet. Claim pending rewards first.',
          },
          balance: Math.floor(balanceBase / factor),
          priceGold: item.priceGold,
          pending: Math.round(totals.pending),
          walletAccountId: wallet.accountId,
        });
      }

      // Reserve first (unique per user+item) so concurrent taps and double
      // spends can only ever charge once.
      const reservation: EntitlementRow = {
        id: randomUUID(),
        user_id: user.id,
        item_type: item.type,
        item_id: item.id,
        source: 'gold_purchase',
        status: 'pending',
        price_gold: item.priceGold,
        hedera_tx_id: null,
        created_at: Date.now(),
      };
      try {
        store.insertEntitlement(reservation);
      } catch {
        return reply.code(409).send(errorBody('already_owned', 'You already own this item.'));
      }

      let payment;
      try {
        payment = await services.token.transferGoldToTreasury(wallet.accountId, exported.privateKeyDer, item.priceGold);
      } catch (err) {
        store.deleteEntitlement(reservation.id); // nothing charged
        app.log.error({ err }, 'gold shop transfer failed');
        return reply
          .code(502)
          .send(errorBody('transfer_failed', 'On-chain transfer failed. Nothing was charged — try again.'));
      }

      try {
        store.activateEntitlement(reservation.id, payment.transactionId);
      } catch (err) {
        // Transfer already landed; keep the pending row for support/retry.
        app.log.error({ err, entitlementId: reservation.id }, 'paid but failed to activate entitlement');
      }
      return reply.code(201).send({
        item,
        entitlement: {
          type: item.type,
          id: item.id,
          source: 'gold_purchase',
          paidGold: item.priceGold,
          txId: payment.transactionId,
        },
        receipt: {
          transactionId: payment.transactionId,
          hashscanUrl: hashscanTxUrl(settings, payment.transactionId),
        },
      });
    } catch (err) {
      app.log.warn({ err }, 'gold shop purchase failed');
      return reply.code(502).send(errorBody('mirror_unavailable', 'Could not check your $GOLD balance. Try again.'));
    } finally {
      purchasesInFlight.delete(user.id);
    }
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
