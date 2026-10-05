/**
 * Hedera wallet utilities (testnet).
 *
 * Create a fresh funded wallet for a player:
 *   npm run hedera:wallet
 *
 * Also send the wallet-link proof from an existing key (support / re-link):
 *   npm run hedera:wallet -- --from-key 303... --from-account 0.0.x --memo "fishio:<nonce>"
 *
 * Prints account id / proof tx so they can be imported into HashPack / Blade.
 * Testnet only — never use for real funds.
 */
import { AccountCreateTransaction, Hbar, PrivateKey, TransferTransaction } from '@hiero-ledger/sdk';
import { createHederaClient } from '../src/hedera/client.ts';
import { hashscanTxUrl, loadHederaSettings } from '../src/hedera/config.ts';
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();

const args = process.argv.slice(2);
function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

const memo = argValue('--memo');
const fromKeyDer = argValue('--from-key');
const fromAccount = argValue('--from-account');
const initialHbar = Number(process.env.HEDERA_WALLET_INITIAL_HBAR || 25);

async function sendProof(
  hedera: NonNullable<ReturnType<typeof createHederaClient>>,
  settings: ReturnType<typeof loadHederaSettings>,
  accountId: string,
  key: PrivateKey,
): Promise<void> {
  if (!memo) {
    console.error('Sending a proof requires --memo "fishio:<nonce>"');
    process.exit(1);
  }
  console.log(`\nSending the 1-tinybar link proof with memo "${memo}"...`);
  const transfer = await new TransferTransaction()
    .addHbarTransfer(accountId, new Hbar(-0.00000001))
    .addHbarTransfer(hedera.operatorId, new Hbar(0.00000001))
    .setTransactionMemo(memo)
    .freezeWith(hedera.client)
    .sign(key);
  const transferTx = await transfer.execute(hedera.client);
  console.log(`PROOF_TX=${transferTx.transactionId.toString()}`);
  console.log(`PROOF_URL=${hashscanTxUrl(settings, transferTx.transactionId.toString())}`);
}

async function main(): Promise<void> {
  const settings = loadHederaSettings();
  const hedera = createHederaClient(settings);
  if (!hedera) {
    console.error('No operator credentials. Fill HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in apps/api/.env');
    process.exit(1);
  }

  // Existing-key mode: only send the link proof.
  if (fromKeyDer) {
    if (!fromAccount) {
      console.error('--from-key requires --from-account 0.0.x');
      process.exit(1);
    }
    await sendProof(hedera, settings, fromAccount, PrivateKey.fromStringDer(fromKeyDer));
    return;
  }

  console.log(`Creating a new player wallet on ${settings.network} (funded with ${initialHbar} HBAR)...`);
  const key = PrivateKey.generateECDSA();
  const createTx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(Number.isFinite(initialHbar) && initialHbar > 0 ? initialHbar : 25))
    .setAccountMemo('Fish.IO player wallet')
    .execute(hedera.client);
  const receipt = await createTx.getReceipt(hedera.client);
  const accountId = receipt.accountId?.toString();
  if (!accountId) throw new Error('account creation failed');

  console.log(`\nWALLET_ACCOUNT_ID=${accountId}`);
  console.log(`WALLET_PRIVATE_KEY=${key.toStringDer()}`);
  console.log(`(funded with ${initialHbar} HBAR — testnet only, import into HashPack/Blade to view it)`);

  if (memo) await sendProof(hedera, settings, accountId, key);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Wallet operation failed:', err);
    process.exit(1);
  });
