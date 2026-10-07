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
import { loadHederaSettings, type HederaSettings } from '../src/hedera/config.ts';
import { decryptSecret, encryptSecret, type CustodyService } from '../src/hedera/custody.ts';
import { openDatabase, type NftItemRow } from '../src/db.ts';
import { loadDotEnv } from '../src/env.ts';
import { decodeMemo, MirrorClient } from '../src/hedera/mirror.ts';
import { calculateGoldReward, RewardService } from '../src/hedera/rewards.ts';
import { findGoldShopItem, goldShop, priceForRank } from '../src/hedera/shop.ts';
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
  rewardDailyCap: 500,
  rewardMatchCap: 100,
  matchCooldownMs: 10000,
  goldConvertRate: 100,
  goldConvertDailyGold: 20_000,
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

test('gold rewards scale with play and hit the per-match cap', () => {
  const idle = calculateGoldReward(
    { mode: 'classic', score: 0, kills: 0, level: 1, food: 0, chests: 0, kingTime: 0, durationMs: 0 },
    settings,
  );
  assert.equal(idle, 0);

  const mid = calculateGoldReward(
    { mode: 'classic', score: 300, kills: 2, level: 3, food: 0, chests: 0, kingTime: 0, durationMs: 0 },
    settings,
  );
  assert.equal(mid, 2 + 6 + 2); // score/150 + kills*3 + (level-1)

  const frenzy = calculateGoldReward(
    { mode: 'frenzy', score: 300, kills: 2, level: 3, food: 0, chests: 0, kingTime: 0, durationMs: 0 },
    settings,
  );
  assert.equal(frenzy, Math.floor((2 + 6 + 2) * 1.25));

  const capped = calculateGoldReward(
    { mode: 'classic', score: 10_000_000, kills: 1000, level: 100, food: 0, chests: 9999, kingTime: 0, durationMs: 0 },
    settings,
  );
  assert.equal(capped, settings.rewardMatchCap);
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

test('$GOLD shop prices follow the progression curve', () => {
  assert.equal(priceForRank(0, 24, 10, 600), 10);
  assert.equal(priceForRank(23, 24, 10, 600), 600);
  assert.equal(priceForRank(0, 23, 10, 2500), 10);
  assert.equal(priceForRank(22, 23, 10, 2500), 2500);

  const { items } = goldShop();
  assert.ok(items.length > 50, `catalog has sellable items (${items.length})`);
  for (const item of items) {
    assert.ok(item.priceGold >= 5 && item.priceGold <= 5000, `${item.type}:${item.id} in price range`);
    assert.ok(item.costGold > 0, `${item.type}:${item.id} has a real legacy cost`);
  }

  for (const type of ['fish', 'weapon', 'hat']) {
    const prices = items.filter((item) => item.type === type).map((item) => item.priceGold);
    assert.equal(prices[0], 10, `${type} entry price`);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i]! >= prices[i - 1]!, `${type} prices are monotonic`);
    }
  }

  const topFish = items.filter((item) => item.type === 'fish').at(-1);
  assert.equal(topFish?.priceGold, 2500, 'top fish is a long-term goal');

  const weapon = items.find((item) => item.type === 'weapon');
  assert.ok(weapon, 'weapons are sellable');
  assert.deepEqual(findGoldShopItem(weapon.type, weapon.id), weapon, 'lookup by type+id');
  assert.equal(findGoldShopItem('weapon', 'definitely_not_real'), null);
  assert.equal(findGoldShopItem('fish', 'baby_shark'), null, 'default fish is not for sale');
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

test('gold → $GOLD conversion respects rate and daily cap', () => {
  const convertSettings: HederaSettings = { ...settings, goldConvertRate: 100, goldConvertDailyGold: 250 };
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
  const rewards = new RewardService(store, convertSettings, undefined, undefined);

  const first = rewards.convertGold('u1', 1000); // capped to 250 → 2 $GOLD
  assert.equal(first.gold, 200, 'only whole multiples of the rate are spent');
  assert.equal(first.amount, 2);
  assert.equal(first.rate, 100);
  assert.equal(first.dailyRemaining, 50);
  assert.equal(first.pending, 2, 'credited as pending reward');
  assert.equal(rewards.totals('u1').pending, 2);

  assert.throws(() => rewards.convertGold('u1', 500), /at least 100/, 'daily cap blocks further conversion');
  assert.throws(() => rewards.convertGold('u1', -5), /positive/);

  const disabled = new RewardService(store, { ...convertSettings, goldConvertDailyGold: 0 }, undefined, undefined);
  assert.throws(() => disabled.convertGold('u1', 100), /disabled/);
  store.close();
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
