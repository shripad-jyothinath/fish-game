/**
 * Hedera operator client (treasury). The server holds the operator key and
 * signs all service transactions (topic create, token create, mints, payouts).
 * Player keys never touch the server: wallet linking is proof-of-ownership.
 */
import { AccountId, Client, PrivateKey } from '@hiero-ledger/sdk';
import type { HederaSettings } from './config.ts';

export interface HederaClient {
  client: Client;
  operatorId: AccountId;
  operatorKey: PrivateKey;
}

export function parsePrivateKey(value: string): PrivateKey {
  // Portal keys are DER encoded and start with 303...; accept raw forms too.
  try {
    return PrivateKey.fromStringDer(value);
  } catch {
    // fall through to raw parsing
  }
  try {
    return PrivateKey.fromString(value);
  } catch {
    return value.length === 64 ? PrivateKey.fromStringECDSA(value) : PrivateKey.fromStringED25519(value);
  }
}

export function createHederaClient(settings: HederaSettings): HederaClient | null {
  if (!settings.enabled) return null;
  const client =
    settings.network === 'mainnet'
      ? Client.forMainnet()
      : settings.network === 'previewnet'
        ? Client.forPreviewnet()
        : Client.forTestnet();

  const operatorKey = parsePrivateKey(settings.operatorKey);
  const operatorId = AccountId.fromString(settings.operatorId);
  client.setOperator(operatorId, operatorKey);
  return { client, operatorId, operatorKey };
}

export function wholeToBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}
