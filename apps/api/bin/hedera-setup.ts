/**
 * One-command Hedera setup for Fish.IO.
 *
 *   npm run hedera:setup -- --write-env
 *   npm run hedera:setup -- --demo-account
 *
 * Requires HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in apps/api/.env
 * (or the environment). Creates, if missing:
 *   1. the HCS topic for match attestations
 *   2. the $GOLD HTS fungible token
 *   3. the "Fish.IO Originals" NFT collection
 *
 * --write-env      store the created IDs in apps/api/.env
 * --demo-account   also create a fresh Hedera account, fund it, send GOLD
 *                  and mint one NFT to it (end-to-end proof)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountCreateTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk';
import { loadHederaSettings, hashscanNftUrl, hashscanTopicUrl, hashscanTxUrl } from '../src/hedera/config.ts';
import { createHederaServices } from '../src/hedera/services.ts';
import { openDatabase } from '../src/db.ts';
import { loadDotEnv } from '../src/env.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(HERE, '../.env');

function writeEnv(updates: Record<string, string>): void {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const key = match?.[1];
    if (key && updates[key] !== undefined) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, next.join('\n').replace(/\n+$/, '') + '\n', 'utf8');
  console.log(`\nWrote ${Object.keys(updates).join(', ')} to ${ENV_PATH}`);
}

async function hbarBalance(settings: { mirrorBaseUrl: string; operatorId: string }): Promise<string> {
  try {
    const res = await fetch(`${settings.mirrorBaseUrl}/accounts/${settings.operatorId}`);
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { balance?: { balance?: number } };
    const tinybar = data.balance?.balance ?? 0;
    return `${(tinybar / 1e8).toFixed(2)} ℏ`;
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  loadDotEnv(ENV_PATH);
  const write = process.argv.includes('--write-env');
  const demo = process.argv.includes('--demo-account');

  const settings = loadHederaSettings();
  if (!settings.enabled) {
    console.error('Missing HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY.');
    console.error('Create a free testnet account at https://portal.hedera.com and put them in apps/api/.env');
    process.exit(1);
  }

  const dbPath = process.env.FISHIO_DB_PATH || path.resolve(HERE, '../data/fishio.db');
  const store = openDatabase(dbPath);
  const services = createHederaServices(store, settings);
  if (!services.online || !services.hcs || !services.token || !services.nft || !services.hedera) {
    console.error('Operator client could not be created:', services.credentialsError ?? 'unknown error');
    process.exit(1);
  }

  console.log(`\nFish.IO × Hedera setup — ${settings.network}`);
  console.log(`Operator: ${settings.operatorId} (balance: ${await hbarBalance({ mirrorBaseUrl: settings.mirrorBaseUrl, operatorId: settings.operatorId })})\n`);

  const updates: Record<string, string> = { HEDERA_NETWORK: settings.network };

  if (settings.topicId || store.getHederaResource(settings.network, 'hcs_topic')) {
    const topicId = settings.topicId || store.getHederaResource(settings.network, 'hcs_topic')!.resource_id;
    updates.HEDERA_TOPIC_ID = topicId;
    console.log(`• HCS topic:        ${topicId} (existing)`);
  } else {
    const topicId = await services.hcs.ensureTopic();
    updates.HEDERA_TOPIC_ID = topicId;
    console.log(`• HCS topic:        ${topicId} ${hashscanTopicUrl(settings, topicId)}`);
  }

  if (settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')) {
    const tokenId = settings.goldTokenId || store.getHederaResource(settings.network, 'gold_token')!.resource_id;
    updates.HEDERA_GOLD_TOKEN_ID = tokenId;
    console.log(`• $GOLD token:      ${tokenId} (existing)`);
  } else {
    const tokenId = await services.token.ensureGoldToken();
    updates.HEDERA_GOLD_TOKEN_ID = tokenId;
    console.log(`• $GOLD token:      ${tokenId}`);
  }

  if (settings.nftCollectionId || store.getHederaResource(settings.network, 'nft_collection')) {
    const collectionId =
      settings.nftCollectionId || store.getHederaResource(settings.network, 'nft_collection')!.resource_id;
    updates.HEDERA_NFT_COLLECTION_ID = collectionId;
    console.log(`• NFT collection:   ${collectionId} (existing)`);
  } else {
    const collectionId = await services.nft.ensureCollection();
    updates.HEDERA_NFT_COLLECTION_ID = collectionId;
    console.log(`• NFT collection:   ${collectionId}`);
  }

  if (demo) {
    console.log('\nCreating a demo account (50 ℏ) to prove payouts and mints...');
    const demoKey = PrivateKey.generateECDSA();
    const createTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(demoKey.publicKey)
      .setInitialBalance(new Hbar(50))
      .setAccountMemo('Fish.IO demo account')
      .execute(services.hedera.client);
    const receipt = await createTx.getReceipt(services.hedera.client);
    const demoAccountId = receipt.accountId?.toString();
    if (!demoAccountId) throw new Error('demo account creation failed');
    console.log(`• Demo account:     ${demoAccountId} (key: ${demoKey.toStringDer()})`);

    const payment = await services.token.payGold(demoAccountId, 10);
    console.log(`• Sent 10 $GOLD via ${payment.method}: ${hashscanTxUrl(settings, payment.transactionId)}`);

    const minted = await services.nft.mintItem({ itemId: 'demo_badge', itemType: 'achievement', toAccountId: demoAccountId });
    console.log(`• Minted NFT #${minted.serial}: ${hashscanNftUrl(settings, minted.tokenId, minted.serial)}`);
  }

  if (write) writeEnv(updates);
  else console.log('\nTip: rerun with --write-env to store these IDs in apps/api/.env');

  store.close();
  console.log('\nDone.');
}

main()
  // The Hedera SDK keeps a gRPC channel open; exit explicitly so CLI runs terminate.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSetup failed:', err);
    process.exit(1);
  });
