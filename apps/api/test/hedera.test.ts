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
import { openDatabase, type NftItemRow } from '../src/db.ts';
import { loadDotEnv } from '../src/env.ts';
import { calculateGoldReward } from '../src/hedera/rewards.ts';
import { isValidHederaAccountId, stripChecksum, verifyMessageSignature } from '../src/hedera/wallet.ts';

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
