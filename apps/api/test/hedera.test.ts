/**
 * Hedera layer unit tests — everything here runs offline (no network/keys).
 * Covers: wallet signature verification, account id handling, reward math,
 * and disabled-mode settings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PrivateKey } from '@hiero-ledger/sdk';
import { loadGame } from '@fishio/game-core';
import { loadHederaSettings, type HederaSettings } from '../src/hedera/config.ts';
import { decryptSecret, encryptSecret, type CustodyService } from '../src/hedera/custody.ts';
import { openDatabase, type NftItemRow } from '../src/db.ts';
import { loadDotEnv } from '../src/env.ts';
import { decodeMemo, MirrorClient } from '../src/hedera/mirror.ts';
import { calculateGoldReward, RewardService } from '../src/hedera/rewards.ts';
import { refreshPower } from '../src/power.ts';
import { findGoldShopItem, goldShop, upgradePriceFor } from '../src/hedera/shop.ts';
import type { TokenService } from '../src/hedera/token.ts';
import { signInternalBody, signRoomTicket, verifyRoomTicket } from '../src/hedera/tickets.ts';
import { isValidHederaAccountId, stripChecksum, verifyMessageSignature, WalletService } from '../src/hedera/wallet.ts';
import { buildServer } from '../src/index.ts';
import { loadConfig } from '../src/config.ts';

const settings: HederaSettings = {
  enabled: true,
  network: 'testnet',
  operatorId: '0.0.1001',
  operatorKey: 'unused',
  topicId: '',
  goldTokenId: '',
  nftCollectionId: '',
  goldName: 'Fish.IO Gold',
  goldSymbol: 'GOLD',
  goldDecimals: 2,
  goldInitialSupply: 1000,
  matchCooldownMs: 10000,
  editionLimits: { golden_leviathan: 1 },
  autoWallets: true,
  mirrorBaseUrl: 'https://example.invalid',
  hashscanBaseUrl: 'https://example.invalid',
  publicBaseUrl: 'http://127.0.0.1:8080',
};

test('wallet signatures verify and reject tampering', () => {
  const message = 'Fish.IO wallet link\nnetwork: testnet\nnonce: abc123';
  for (const key of [PrivateKey.generateED25519(), PrivateKey.generateECDSA()]) {
    const signature = Buffer.from(key.sign(Buffer.from(message, 'utf8'))).toString('base64');
    assert.equal(verifyMessageSignature(key.publicKey.toStringDer(), message, signature), true, 'der key verifies');
    assert.equal(verifyMessageSignature(key.publicKey.toString(), message, signature), true, 'raw key verifies');
    assert.equal(verifyMessageSignature(key.publicKey.toString(), `${message}!`, signature), false, 'tampered message rejected');
    assert.equal(verifyMessageSignature(key.publicKey.toString(), message, Buffer.from('nope').toString('base64')), false, 'garbage signature rejected');
  }
  assert.equal(verifyMessageSignature('not-a-key', message, 'AAAA'), false, 'garbage key rejected');
});

test('hedera account ids validate and strip checksums', () => {
  assert.equal(isValidHederaAccountId('0.0.12345'), true);
  assert.equal(isValidHederaAccountId('0.0.12345-abcde'), true);
  assert.equal(stripChecksum('0.0.12345-abcde'), '0.0.12345');
  assert.equal(isValidHederaAccountId('123'), false);
  assert.equal(isValidHederaAccountId('0.0.x'), false);
  assert.equal(isValidHederaAccountId(''), false);
});

test('gold rewards scale with score, kills and level (uncapped)', () => {
  const idle = calculateGoldReward({
    mode: 'classic',
    score: 0,
    kills: 0,
    level: 1,
    food: 0,
    chests: 0,
    kingTime: 0,
    durationMs: 0,
  });
  assert.equal(idle, 0);

  const lvl4 = calculateGoldReward({
    mode: 'classic',
    score: 1500,
    kills: 5,
    level: 4,
    food: 0,
    chests: 0,
    kingTime: 0,
    durationMs: 0,
  });
  assert.equal(lvl4, 15 + 5 * 6 + 24, 'score/100 + kills*(5+level/3) + (level-1)*8');

  const lvl20 = calculateGoldReward({
    mode: 'classic',
    score: 15_000,
    kills: 25,
    level: 20,
    food: 0,
    chests: 10,
    kingTime: 0,
    durationMs: 0,
  });
  assert.ok(lvl20 > lvl4 * 8, `higher levels earn much more (${lvl4} -> ${lvl20})`);

  const frenzy = calculateGoldReward({
    mode: 'frenzy',
    score: 1000,
    kills: 10,
    level: 5,
    food: 0,
    chests: 0,
    kingTime: 0,
    durationMs: 0,
  });
  assert.equal(frenzy, Math.floor((10 + 60 + 32) * 1.25), 'frenzy pays 1.25x');

  const huge = calculateGoldReward({
    mode: 'classic',
    score: 10_000_000,
    kills: 1000,
    level: 100,
    food: 0,
    chests: 9999,
    kingTime: 0,
    durationMs: 0,
  });
  assert.ok(huge > 100_000, `no per-match cap (${huge})`);
});

test('env loader reads KEY=VALUE files without overriding existing vars', () => {
  const tmp = path.join(os.tmpdir(), `fishio-env-test-${Date.now()}.env`);
  fs.writeFileSync(tmp, 'FISHIO_TEST_A=1\n# comment\nFISHIO_TEST_B="two"\n');
  process.env.FISHIO_TEST_A = 'keep';
  loadDotEnv(tmp);
  assert.equal(process.env.FISHIO_TEST_A, 'keep', 'existing environment wins');
  assert.equal(process.env.FISHIO_TEST_B, 'two', 'quotes are stripped');
  fs.rmSync(tmp, { force: true });
});

test('settings default to a disabled testnet config without credentials', () => {
  const offline = loadHederaSettings({});
  assert.equal(offline.enabled, false);
  assert.equal(offline.network, 'testnet');
  assert.match(offline.mirrorBaseUrl, /testnet\.mirrornode/);
  assert.match(offline.hashscanBaseUrl, /hashscan\.io\/testnet/);
  assert.equal(offline.editionLimits.golden_leviathan, 1, 'golden leviathan is 1-of-1 by default');

  const mainnet = loadHederaSettings({ HEDERA_NETWORK: 'mainnet' });
  assert.equal(mainnet.network, 'mainnet');
  assert.match(mainnet.hashscanBaseUrl, /hashscan\.io\/mainnet/);

  const custom = loadHederaSettings({ HEDERA_EDITION_LIMITS: '{"coral_dagger":5,"golden_leviathan":1}' });
  assert.equal(custom.editionLimits.coral_dagger, 5);
  assert.equal(custom.editionLimits.golden_leviathan, 1);

  assert.equal(loadHederaSettings({}).autoWallets, true, 'auto wallets on by default');
  assert.equal(loadHederaSettings({ HEDERA_AUTO_WALLETS: 'false' }).autoWallets, false, 'kill switch works');
});

test('mirror memo decoding supports both memo and memo_base64', () => {
  const encoded = Buffer.from('fishio:abc123').toString('base64');
  assert.equal(decodeMemo({ memo_base64: encoded }), 'fishio:abc123');
  assert.equal(decodeMemo({ memo: encoded }), 'fishio:abc123');
  assert.equal(decodeMemo({}), '');
});

test('custodial wallet keys encrypt, decrypt, and reject tampering', () => {
  const secret = '3030020100300706052b8104000a04220420aabbccddeeff00112233445566778899';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted.cipher, secret);
  assert.equal(decryptSecret(encrypted), secret);
  assert.throws(() => decryptSecret({ ...encrypted, tag: Buffer.from('0'.repeat(16)).toString('base64') }));
});

test('custodial wallets pay out, but a linked external wallet takes priority', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  store.insertCustodialWallet({
    user_id: 'u1',
    hedera_account_id: '0.0.77',
    key_cipher: 'c',
    key_iv: 'i',
    key_tag: 't',
    network: 'testnet',
    created_at: 5,
  });
  const custodyStub = {
    getWallet: (userId: string) => {
      const row = store.getCustodialWallet(userId);
      return row
        ? { userId, accountId: row.hedera_account_id, network: row.network, createdAt: row.created_at }
        : null;
    },
  } as unknown as CustodyService;
  const wallet = new WalletService(store, new MirrorClient('https://example.invalid'), settings, custodyStub);
  const custodialPayout = wallet.getPayoutWallet('u1');
  assert.ok(custodialPayout, 'managed wallet resolves');
  assert.equal(custodialPayout.accountId, '0.0.77');
  assert.equal(custodialPayout.method, 'custodial');

  store.upsertWalletLink('u1', '0.0.88', null, 'transfer', 'testnet', 6);
  const externalPayout = wallet.getPayoutWallet('u1');
  assert.ok(externalPayout, 'external wallet resolves');
  assert.equal(externalPayout.accountId, '0.0.88');
  assert.equal(externalPayout.method, 'transfer');

  store.close();
});

test('limited editions reserve atomically and free slots on failure', () => {
  const store = openDatabase(':memory:');
  const now = Date.now();
  for (const id of ['u1', 'u2']) {
    store.createUser({
      id,
      email: `${id}@example.com`,
      username: id,
      username_lower: id,
      password_hash: 'x',
      created_at: now,
      last_login_at: null,
    });
  }
  const mintRow = (id: string, userId: string, itemId = 'golden_leviathan'): NftItemRow => ({
    id,
    user_id: userId,
    item_id: itemId,
    item_type: 'fish',
    name: 'Golden Leviathan',
    description: '',
    token_id: null,
    serial_number: null,
    status: 'minting',
    hedera_tx_id: null,
    error: null,
    metadata_json: '{}',
    created_at: now,
  });

  assert.equal(store.reserveNftMint(mintRow('r1', 'u1'), 1), 'reserved', 'first owner gets the 1-of-1');
  assert.equal(store.reserveNftMint(mintRow('r2', 'u2'), 1), 'sold_out', 'second owner is blocked');
  assert.equal(store.reserveNftMint(mintRow('r3', 'u1'), 1), 'already_minted', 'same owner cannot mint twice');
  assert.equal(store.countItemMints('golden_leviathan'), 1);

  store.updateNftItem('r1', { status: 'failed', error: 'boom' });
  assert.equal(store.reserveNftMint(mintRow('r4', 'u2'), 1), 'reserved', 'failed mints free the slot');
  assert.equal(store.countItemMints('golden_leviathan'), 1);

  assert.equal(store.reserveNftMint(mintRow('r5', 'u1', 'coral_dagger'), null), 'reserved', 'unlimited items have no cap');
  assert.equal(store.reserveNftMint(mintRow('r6', 'u2', 'coral_dagger'), null), 'reserved');
  store.close();
});

test('$GOLD shop prices escalate hard by tier', () => {
  const { items } = goldShop();
  assert.ok(items.length > 50, `catalog has sellable items (${items.length})`);
  const byKey = new Map(items.map((item) => [`${item.type}:${item.id}`, item]));
  const priceOf = (type: string, id: string) => byKey.get(`${type}:${id}`)!.priceGold;

  const cat = loadGame().catalog();
  for (const type of ['weapon', 'fish'] as const) {
    const tiers = type === 'weapon' ? cat.weaponTiers : cat.fishTiers;
    tiers.forEach((ids, tier) => {
      const priced = ids.filter((id) => byKey.has(`${type}:${id}`));
      assert.ok(priced.length > 0, `${type} T${tier} has sellable items`);
      const prices = priced.map((id) => priceOf(type, id));
      if (tier > 0) {
        const prevMax = Math.max(
          ...tiers[tier - 1]!.filter((id) => byKey.has(`${type}:${id}`)).map((id) => priceOf(type, id)),
        );
        const thisMin = Math.min(...prices);
        assert.ok(thisMin > prevMax * 3, `${type} T${tier} starts well above T${tier - 1} (${thisMin} vs ${prevMax})`);
      }
    });
    const t0 = tiers[0]!.filter((id) => byKey.has(`${type}:${id}`)).map((id) => priceOf(type, id));
    assert.equal(Math.min(...t0), 10, `${type} T0 entry price`);
  }

  assert.equal(priceOf('weapon', 'meteor_maul'), 600000, 'apex weapon is a long-term goal');
  assert.equal(priceOf('fish', 'golden_leviathan'), 1000000, 'apex fish is a multi-year goal');

  const hatPrices = items.filter((item) => item.type === 'hat').map((item) => item.priceGold);
  assert.ok(Math.max(...hatPrices) <= 5000, 'cosmetic hats stay achievable');

  assert.equal(findGoldShopItem('fish', 'baby_shark'), null, 'default fish is not for sale');
  assert.equal(findGoldShopItem('weapon', 'definitely_not_real'), null);
});

test('entitlements reserve atomically, activate, and free slots on delete', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });

  const row = {
    id: 'e1',
    user_id: 'u1',
    item_type: 'weapon',
    item_id: 'excalibur',
    source: 'gold_purchase',
    status: 'pending',
    price_gold: 80,
    hedera_tx_id: null,
    created_at: 10,
  };
  store.insertEntitlement(row);
  assert.equal(store.findEntitlement('u1', 'weapon', 'excalibur')?.status, 'pending');
  assert.throws(() => store.insertEntitlement({ ...row, id: 'e2' }), 'unique user+item reservation');

  store.activateEntitlement('e1', '0.0.123@1.2');
  const active = store.findEntitlement('u1', 'weapon', 'excalibur');
  assert.equal(active?.status, 'active');
  assert.equal(active?.hedera_tx_id, '0.0.123@1.2');
  assert.equal(store.listEntitlements('u1').length, 1);

  store.deleteEntitlement('e1');
  assert.equal(store.findEntitlement('u1', 'weapon', 'excalibur'), undefined);
  store.close();
});

test('$GOLD ledger credits, spends, and summarises', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });

  store.creditGold('u1', 100, 'match_reward', 'm1');
  assert.equal(store.goldBalance('u1'), 100);
  assert.equal(store.spendGold('u1', 30, 'purchase', 'weapon:x'), true);
  assert.equal(store.goldBalance('u1'), 70);
  assert.equal(store.spendGold('u1', 1000, 'purchase', null), false, 'cannot overspend');
  assert.equal(store.goldBalance('u1'), 70);
  assert.equal(store.goldTotalsByReason('u1').match_reward, 100);
  assert.equal(store.goldTotalsByReason('u1').purchase, -30);

  const rewards = new RewardService(store, settings, undefined, undefined);
  const summary = rewards.ledgerSummary('u1');
  assert.equal(summary.balance, 70);
  assert.equal(summary.earned, 100);
  assert.equal(summary.withdrawn, 0);
  store.close();
});

test('match rewards credit the ledger without caps', async () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  const rewards = new RewardService(store, { ...settings, matchCooldownMs: 0 }, undefined, undefined);
  const stats = { mode: 'classic', score: 1500, kills: 5, level: 4, food: 0, chests: 0, kingTime: 0, durationMs: 0 } as const;

  const first = await rewards.recordMatch('u1', stats);
  assert.equal(first.reward.amount, 69, 'score/100 + kills*(5+level/3) + (level-1)*8');
  assert.equal(store.goldBalance('u1'), 69, 'credited immediately');

  const second = await rewards.recordMatch('u1', stats);
  assert.equal(second.reward.amount, 69, 'no daily cap');
  assert.equal(store.goldBalance('u1'), 138);
  store.close();
});

test('match cooldown reports how long to wait', async () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  const rewards = new RewardService(store, { ...settings, matchCooldownMs: 5000 }, undefined, undefined);
  const stats = { mode: 'classic', score: 150, kills: 0, level: 1, food: 0, chests: 0, kingTime: 0, durationMs: 0 } as const;

  await rewards.recordMatch('u1', stats);
  try {
    await rewards.recordMatch('u1', stats);
    assert.fail('expected a cooldown error');
  } catch (err) {
    const coded = err as Error & { code?: string; retryAfterMs?: number };
    assert.equal(coded.code, 'match_cooldown');
    assert.ok(coded.retryAfterMs !== undefined && coded.retryAfterMs > 0 && coded.retryAfterMs <= 5000);
  }
  store.close();
});

test('combat power combines loadout tiers, upgrades and best level', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  store.upsertSave(
    'u1',
    JSON.stringify({
      selectedWeapon: 'meteor_maul',
      selectedFish: 'golden_leviathan',
      upgrades: { speed_boost: 5, stamina_cap: 5, stamina_regen: 5, starting_size: 5, magnet_radius: 5 },
    }),
    Date.now(),
  );
  store.bumpPlayerStats('u1', { kills: 10, food: 100, score: 10_000, level: 20, kingTime: 0 }, Date.now());

  const power = refreshPower(store, 'u1');
  assert.equal(power, 6000 + 5000 + 25 * 80 + 20 * 25, 'tier power + upgrades + best level');

  const powerRows = store.listPowerLeaderboard(10);
  assert.equal(powerRows[0]?.username, 'u1');
  assert.equal(powerRows[0]?.power, power);

  const goldRows = store.listGoldLeaderboard(10);
  assert.equal(goldRows[0]?.username, 'u1');
  assert.equal(goldRows[0]?.gold, 0);
  store.close();
});

test('item and upgrade purchases are atomic and priced server-side', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  store.creditGold('u1', 100_000, 'match_reward', null);

  const item = goldShop().items.find((entry) => entry.priceGold <= 50)!;
  const entitlement = {
    id: 'e1',
    user_id: 'u1',
    item_type: item.type,
    item_id: item.id,
    source: 'gold_purchase',
    status: 'active',
    price_gold: item.priceGold,
    hedera_tx_id: null,
    created_at: 1,
  };
  assert.equal(store.purchaseItemAtomic('u1', entitlement, item.priceGold), 'ok');
  assert.equal(store.goldBalance('u1'), 100_000 - item.priceGold);
  assert.ok(store.findEntitlement('u1', item.type, item.id), 'entitlement granted');
  assert.equal(store.purchaseItemAtomic('u1', { ...entitlement, id: 'e2' }, item.priceGold), 'owned');
  assert.equal(
    store.purchaseItemAtomic('u1', { ...entitlement, id: 'e3', item_id: '__nope' }, 100000),
    'insufficient',
    'cannot overspend',
  );

  const up1 = store.purchaseUpgradeAtomic('u1', 'speed_boost', 5, (level) => upgradePriceFor(level));
  assert.equal(up1.result, 'ok');
  assert.equal(up1.level, 1);
  assert.equal(up1.price, 100, 'first level costs the ladder price');
  assert.equal(store.upgradeLevels('u1').speed_boost, 1);
  for (let i = 0; i < 4; i++) store.purchaseUpgradeAtomic('u1', 'speed_boost', 5, (level) => upgradePriceFor(level));
  assert.equal(store.upgradeLevels('u1').speed_boost, 5);
  assert.equal(store.purchaseUpgradeAtomic('u1', 'speed_boost', 5, (level) => upgradePriceFor(level)).result, 'maxed');
  store.close();
});

test('one-claim-per-period rewards credit the ledger exactly once', () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });

  assert.equal(store.claimReward('u1', 'daily', '2026-10-07', 5), true);
  assert.equal(store.claimReward('u1', 'daily', '2026-10-07', 5), false, 'same day rejected');
  assert.equal(store.claimReward('u1', 'daily', '2026-10-08', 5), true, 'next day works');
  assert.equal(store.claimReward('u1', 'wheel', '2026-10-07', 20), true);
  assert.equal(store.claimReward('u1', 'wheel', '2026-10-07', 50), false, 'one spin per day');
  assert.equal(store.goldBalance('u1'), 30);
  store.close();
});

test('withdraw moves ledger $GOLD to the wallet and refunds on failure', async () => {
  const store = openDatabase(':memory:');
  store.createUser({
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    username_lower: 'u1',
    password_hash: 'x',
    created_at: 1,
    last_login_at: null,
  });
  store.creditGold('u1', 50, 'match_reward', null);
  const wallet = {
    getPayoutWallet: () => ({ accountId: '0.0.9', method: 'custodial' as const }),
  } as unknown as WalletService;

  const okToken = {
    payGold: async () => ({ transactionId: '0.0.1@2.3', method: 'transfer' as const }),
  } as unknown as TokenService;
  const rewards = new RewardService(store, settings, undefined, okToken);
  const out = await rewards.withdraw('u1', 20, wallet);
  assert.equal(out.amount, 20);
  assert.equal(store.goldBalance('u1'), 30);

  const failToken = {
    payGold: async () => {
      throw new Error('network down');
    },
  } as unknown as TokenService;
  const failing = new RewardService(store, settings, undefined, failToken);
  await assert.rejects(() => failing.withdraw('u1', 30, wallet), /network down/);
  assert.equal(store.goldBalance('u1'), 30, 'refunded after a failed transfer');
  store.close();
});

test('reward endpoints are once-per-day and purchases debit the ledger', async () => {
  const dbPath = path.join(os.tmpdir(), `fishio-ledger-${Date.now()}.db`);
  const app = buildServer(
    loadConfig({ FISHIO_DB_PATH: dbPath, INTERNAL_HMAC_SECRET: 'reward-secret', NODE_ENV: 'test' }),
  );
  try {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'r1@example.com', username: 'reward1', password: 'CheckPass123' },
    });
    assert.equal(reg.statusCode, 201);
    const cookie = reg.cookies.find((c) => c.name === 'fishio_session');
    assert.ok(cookie, 'session cookie');
    const auth = { cookies: { fishio_session: cookie.value } };

    const daily1 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/daily' });
    assert.equal(daily1.statusCode, 200);
    assert.equal((daily1.json() as { amount: number }).amount, 5);
    const daily2 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/daily' });
    assert.equal(daily2.statusCode, 409, 'daily is once per day');

    const wheel1 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/wheel' });
    assert.equal(wheel1.statusCode, 200);
    const wheel2 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/wheel' });
    assert.equal(wheel2.statusCode, 409, 'one spin per day');

    const stage1 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/stage', payload: { level: 1 } });
    assert.equal(stage1.statusCode, 200);
    assert.equal((stage1.json() as { amount: number }).amount, 10);
    const stage2 = await app.inject({ ...auth, method: 'POST', url: '/api/v1/me/reward/stage', payload: { level: 1 } });
    assert.equal(stage2.statusCode, 409, 'stage rewards are once');

    // Server-authored match intake credits the ledger (twice, cooldown cleared).
    const userId = (reg.json() as { user: { id: string } }).user.id;
    const body = JSON.stringify({
      userId,
      stats: { mode: 'classic', score: 1500, kills: 5, level: 4, durationMs: 1000 },
    });
    const intakeHeaders = (signature: string) => ({
      'content-type': 'application/vnd.fishio.intake+json',
      'x-fishio-signature': signature,
    });
    const intake = await app.inject({
      method: 'POST',
      url: '/internal/matches',
      payload: body,
      headers: intakeHeaders(signInternalBody('reward-secret', body)),
    });
    assert.equal(intake.statusCode, 201);
    await new Promise((resolve) => setTimeout(resolve, 3100)); // clear the match cooldown
    const intake2 = await app.inject({
      method: 'POST',
      url: '/internal/matches',
      payload: body,
      headers: intakeHeaders(signInternalBody('reward-secret', body)),
    });
    assert.equal(intake2.statusCode, 201);

    const gold = await app.inject({ ...auth, method: 'GET', url: '/api/v1/hedera/gold' });
    assert.equal(gold.statusCode, 200);
    const balance = (gold.json() as { balance: number }).balance;
    assert.ok(balance >= 150, `balance from rewards + two matches (${balance})`);
    assert.equal((gold.json() as { earned: number }).earned, balance, 'earned equals credits so far');

    const item = goldShop().items.find((entry) => entry.priceGold <= 25)!;
    const buy = await app.inject({
      ...auth,
      method: 'POST',
      url: '/api/v1/hedera/shop/purchase',
      payload: { type: item.type, id: item.id },
    });
    assert.equal(buy.statusCode, 201);
    assert.equal((buy.json() as { balance: number }).balance, balance - item.priceGold, 'purchase debits the ledger');

    const dup = await app.inject({
      ...auth,
      method: 'POST',
      url: '/api/v1/hedera/shop/purchase',
      payload: { type: item.type, id: item.id },
    });
    assert.equal(dup.statusCode, 409, 'already owned');

    const upg = await app.inject({
      ...auth,
      method: 'POST',
      url: '/api/v1/hedera/shop/upgrade',
      payload: { id: 'speed_boost' },
    });
    assert.equal(upg.statusCode, 200);
    assert.equal((upg.json() as { level: number }).level, 1);
    assert.equal((upg.json() as { price: number }).price, 100, 'first upgrade level costs 100 $GOLD');

    const levels = await app.inject({ ...auth, method: 'GET', url: '/api/v1/me/upgrades' });
    assert.equal(levels.statusCode, 200);
    assert.equal((levels.json() as { levels: Record<string, number> }).levels.speed_boost, 1);

    const goldLb = await app.inject({ method: 'GET', url: '/api/v1/leaderboard?type=gold' });
    assert.equal(goldLb.statusCode, 200);
    const goldEntries = (goldLb.json() as { entries: Array<{ username: string; gold: number }> }).entries;
    const mine = goldEntries.find((entry) => entry.username === 'reward1');
    assert.ok(mine && mine.gold >= 40, `gold leaderboard tracks remaining balance (${mine ? mine.gold : 'missing'})`);

    const powerLb = await app.inject({ method: 'GET', url: '/api/v1/leaderboard?type=power' });
    assert.equal(powerLb.statusCode, 200);
    const powerEntries = (powerLb.json() as { entries: Array<{ username: string; power: number }> }).entries;
    assert.ok(powerEntries.some((entry) => entry.username === 'reward1'), 'power leaderboard includes the player');
  } finally {
    await app.close();
    fs.rmSync(dbPath, { force: true });
  }
});

test('room tickets round-trip and reject tampering/expiry', () => {
  const secret = 'ticket-test-secret';
  const ticket = signRoomTicket(secret, 'u1', 'alice', 60_000, 1000);
  const ok = verifyRoomTicket(secret, ticket, 2000);
  assert.equal(ok?.u, 'u1');
  assert.equal(ok?.n, 'alice');

  assert.equal(verifyRoomTicket(secret, ticket, 1000 + 61_000), null, 'expired tickets rejected');
  assert.equal(verifyRoomTicket('other-secret', ticket, 2000), null, 'wrong secret rejected');
  assert.equal(verifyRoomTicket(secret, 'garbage', 2000), null, 'garbage rejected');
  assert.equal(verifyRoomTicket(secret, '', 2000), null, 'empty rejected');

  const signature = ticket.slice(ticket.lastIndexOf('.') + 1);
  const forgedBody = Buffer.from(JSON.stringify({ u: 'admin', n: 'x', exp: 9e15 })).toString('base64url');
  assert.equal(verifyRoomTicket(secret, `${forgedBody}.${signature}`, 2000), null, 'forged payload rejected');
});

test('internal match intake verifies HMAC signatures and records the match', async () => {
  const tmp = path.join(os.tmpdir(), `fishio-intake-${Date.now()}.db`);
  const app = buildServer(
    loadConfig({ FISHIO_DB_PATH: tmp, INTERNAL_HMAC_SECRET: 'intake-secret', NODE_ENV: 'test' }),
  );
  try {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'intake@example.com', username: 'intake1', password: 'CheckPass123' },
    });
    assert.equal(reg.statusCode, 201);
    const userId = (reg.json() as { user: { id: string } }).user.id;

    const body = JSON.stringify({
      userId,
      stats: { mode: 'classic', score: 1500, kills: 5, level: 4, durationMs: 90_000 },
    });

    const intakeHeaders = (signature: string) => ({
      'content-type': 'application/vnd.fishio.intake+json',
      'x-fishio-signature': signature,
    });

    const bad = await app.inject({
      method: 'POST',
      url: '/internal/matches',
      payload: body,
      headers: intakeHeaders('nope'),
    });
    assert.equal(bad.statusCode, 401, 'unsigned results are rejected');

    const good = await app.inject({
      method: 'POST',
      url: '/internal/matches',
      payload: body,
      headers: intakeHeaders(signInternalBody('intake-secret', body)),
    });
    assert.equal(good.statusCode, 201);
    const data = good.json() as {
      user: { id: string };
      mode: string;
      reward: { amount: number };
      receipt: { status: string };
    };
    assert.equal(data.user.id, userId);
    assert.equal(data.mode, 'classic');
    assert.ok(data.reward.amount > 0, 'reward recorded from server-authored stats');
    assert.equal(typeof data.receipt.status, 'string');

    const lb = await app.inject({ method: 'GET', url: '/api/v1/leaderboard' });
    assert.equal(lb.statusCode, 200);
    const entries = (lb.json() as { entries: Array<{ username: string }> }).entries;
    assert.ok(entries.some((entry) => entry.username === 'intake1'), 'leaderboard reflects the online match');

    const unknown = JSON.stringify({ userId: 'nope', stats: { mode: 'classic' } });
    const missing = await app.inject({
      method: 'POST',
      url: '/internal/matches',
      payload: unknown,
      headers: intakeHeaders(signInternalBody('intake-secret', unknown)),
    });
    assert.equal(missing.statusCode, 404, 'unknown accounts are rejected');
  } finally {
    await app.close();
    fs.rmSync(tmp, { force: true });
  }
});
