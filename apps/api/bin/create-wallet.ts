/**
 * Create a fresh Hedera testnet wallet for a player, funded from the operator.
 *
 *   npm run hedera:wallet
 *   npm run hedera:wallet -- --memo "fishio:<nonce>"     (also sends the link proof)
 *
 * Prints the account id and DER private key so they can be imported into
 * HashPack / Blade. Testnet only — never use for real funds.
 */
import { AccountCreateTransaction, Hbar, PrivateKey, TransferTransaction } from '@hiero-ledger/sdk';
import { createHederaClient } from '../src/hedera/client.ts';
import { hashscanTxUrl, loadHederaSettings } from '../src/hedera/config.ts';
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();

const args = process.argv.slice(2);
const memoIndex = args.indexOf('--memo');
const memo = memoIndex >= 0 ? args[memoIndex + 1] : null;
const initialHbar = Number(process.env.WALLET_INITIAL_HBAR || 25);

async function main(): Promise<void> {
  const settings = loadHederaSettings();
  const hedera = createHederaClient(settings);
  if (!hedera) {
    console.error('No operator credentials. Fill HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in apps/api/.env');
    process.exit(1);
  }

  console.log(`Creating a new player wallet on ${settings.network} (funded with ${initialHbar} HBAR)...`);

  const key = PrivateKey.generateECDSA();
  const createTx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .setAccountMemo('Fish.IO player wallet')
    .execute(hedera.client);
  const receipt = await createTx.getReceipt(hedera.client);
  const accountId = receipt.accountId?.toString();
  if (!accountId) throw new Error('account creation failed');

  console.log(`\nWALLET_ACCOUNT_ID=${accountId}`);
  console.log(`WALLET_PRIVATE_KEY=${key.toStringDer()}`);
  console.log(`(funded with ${initialHbar} HBAR — testnet only, import into HashPack/Blade to view it)`);

  if (memo) {
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
}

main().catch((err) => {
  console.error('Wallet creation failed:', err);
  process.exit(1);
});
