/**
 * Claim pending token/NFT airdrops for a wallet we control the key for.
 * Used to repair accounts created before auto-association slots existed, and as
 * an operator tool if a payout ever lands as "pending".
 *
 *   WALLET_KEY=303... npm run hedera:claim -- --account 0.0.x
 *   npm run hedera:claim -- --account 0.0.x --key 303...
 */
import { PendingAirdropId, PrivateKey, TokenClaimAirdropTransaction } from '@hiero-ledger/sdk';
import { createHederaClient } from '../src/hedera/client.ts';
import { hashscanTxUrl, loadHederaSettings } from '../src/hedera/config.ts';
import { loadDotEnv } from '../src/env.ts';

loadDotEnv();

const args = process.argv.slice(2);
function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

interface MirrorAirdrop {
  sender_id: string;
  receiver_id: string;
  token_id: string;
  serial_number?: number;
}

async function main(): Promise<void> {
  const accountId = argValue('--account');
  const keyDer = argValue('--key') || process.env.WALLET_KEY;
  const tokenId = argValue('--token');
  const serialRaw = argValue('--serial');
  if (!accountId || !keyDer) {
    console.error('Usage: hedera:claim -- --account 0.0.x [--key 303... | WALLET_KEY env] --token 0.0.y [--serial N]');
    process.exit(1);
  }

  const settings = loadHederaSettings();
  const hedera = createHederaClient(settings);
  if (!hedera) {
    console.error('No operator credentials.');
    process.exit(1);
  }

  // Prefer explicit args (this mirror node has no pending-airdrop listing endpoint);
  // fall back to the listing when available.
  let airdrops: MirrorAirdrop[] = [];
  if (tokenId) {
    airdrops = [
      {
        sender_id: hedera.operatorId.toString(),
        receiver_id: accountId,
        token_id: tokenId,
        serial_number: serialRaw != null ? Number(serialRaw) : undefined,
      },
    ];
  } else {
    const res = await fetch(`${settings.mirrorBaseUrl}/accounts/${accountId}/airdrops?limit=100`);
    if (!res.ok) {
      console.error('Pending-airdrop listing is not available on this mirror node — pass --token [--serial].');
      process.exit(1);
    }
    const data = (await res.json()) as { airdrops?: MirrorAirdrop[] };
    airdrops = data.airdrops ?? [];
  }

  if (airdrops.length === 0) {
    console.log(`No pending airdrops specified for ${accountId}.`);
    return;
  }

  const tx = new TokenClaimAirdropTransaction();
  for (const airdrop of airdrops) {
    const pending = new PendingAirdropId()
      .setSenderid(airdrop.sender_id)
      .setReceiverId(airdrop.receiver_id);
    if (airdrop.serial_number != null) {
      pending.setNftId(`${airdrop.token_id}/${airdrop.serial_number}`);
    } else {
      pending.setTokenId(airdrop.token_id);
    }
    tx.addPendingAirdropId(pending);
  }

  const signed = await tx.freezeWith(hedera.client).sign(PrivateKey.fromStringDer(keyDer));
  const response = await signed.execute(hedera.client);
  console.log(`Claimed ${airdrops.length} pending airdrop(s) for ${accountId}`);
  console.log(`TX=${response.transactionId.toString()}`);
  console.log(`URL=${hashscanTxUrl(settings, response.transactionId.toString())}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Claim failed:', err);
    process.exit(1);
  });
