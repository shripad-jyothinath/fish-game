/**
 * Wallet linking by proof of ownership. Two methods:
 *  - transfer: user sends 1 tinybar to the operator with `fishio:<nonce>` memo;
 *    the server verifies via Mirror Node. Works with any Hedera wallet
 *    (HashPack/Blade/...) without SDK integration.
 *  - signature: user signs the challenge message (for future WalletConnect use);
 *    verified with the account public key.
 */
import { PublicKey } from '@hiero-ledger/sdk';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Store } from '../db.ts';
import type { HederaSettings } from './config.ts';
import { decodeMemo, type MirrorClient } from './mirror.ts';

const NONCE_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_ID_RE = /^\d+\.\d+\.\d+$/;

export function isValidHederaAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(stripChecksum(value));
}

/** Accepts `0.0.123` and `0.0.123-abcde`; returns the bare id. */
export function stripChecksum(value: string): string {
  const dash = value.indexOf('-');
  return (dash === -1 ? value : value.slice(0, dash)).trim();
}

export function parsePublicKey(value: string): PublicKey | null {
  const trimmed = value.trim();
  const attempts = [
    () => PublicKey.fromString(trimmed),
    () => PublicKey.fromStringED25519(trimmed),
    () => PublicKey.fromStringECDSA(trimmed),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // try next encoding
    }
  }
  return null;
}

export function verifyMessageSignature(publicKeyStr: string, message: string, signatureBase64: string): boolean {
  const key = parsePublicKey(publicKeyStr);
  if (!key) return false;
  try {
    const signature = Buffer.from(signatureBase64, 'base64');
    return key.verify(Buffer.from(message, 'utf8'), signature);
  } catch {
    return false;
  }
}

export interface WalletLink {
  userId: string;
  accountId: string;
  publicKey: string | null;
  method: 'transfer' | 'signature';
  network: string;
  linkedAt: number;
}

export interface WalletChallenge {
  nonce: string;
  message: string;
  instructions: {
    accountId: string;
    amountTinybar: number;
    memo: string;
    note: string;
  };
  expiresAt: number;
}

export class WalletService {
  constructor(
    private readonly store: Store,
    private readonly mirror: MirrorClient,
    private readonly settings: HederaSettings,
  ) {}

  getLink(userId: string): WalletLink | null {
    const row = this.store.getWalletLink(userId);
    if (!row) return null;
    return {
      userId: row.user_id,
      accountId: row.hedera_account_id,
      publicKey: row.public_key,
      method: row.method as WalletLink['method'],
      network: row.network,
      linkedAt: row.linked_at,
    };
  }

  unlink(userId: string): void {
    this.store.deleteWalletLink(userId);
  }

  createChallenge(userId: string, accountId?: string): WalletChallenge {
    const nonce = randomBytes(8).toString('hex');
    const memo = `fishio:${nonce}`;
    const cleanAccount = accountId && isValidHederaAccountId(accountId) ? stripChecksum(accountId) : '';
    const message = [
      'Fish.IO wallet link',
      `network: ${this.settings.network}`,
      `account: ${cleanAccount || '(your account)'}`,
      `nonce: ${nonce}`,
    ].join('\n');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    this.store.createNonce(nonce, userId, message, expiresAt);
    return {
      nonce,
      message,
      instructions: {
        accountId: this.settings.operatorId,
        amountTinybar: 1,
        memo,
        note:
          'Send exactly 0.00000001 HBAR to the operator account with this memo from the wallet you want to link, then verify.',
      },
      expiresAt,
    };
  }

  private consumeNonce(userId: string, nonce: string): void {
    const row = this.store.getNonce(nonce);
    if (!row || row.user_id !== userId) throw new WalletLinkError('unknown_nonce', 'Unknown challenge. Start over.');
    if (row.used_at) throw new WalletLinkError('nonce_used', 'This challenge was already used. Start over.');
    if (row.expires_at <= Date.now()) throw new WalletLinkError('nonce_expired', 'Challenge expired. Start over.');
    this.store.markNonceUsed(nonce, Date.now());
  }

  async verifyTransfer(userId: string, body: { accountId?: unknown; nonce?: unknown }): Promise<WalletLink> {
    const accountId = typeof body.accountId === 'string' ? stripChecksum(body.accountId) : '';
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    if (!isValidHederaAccountId(accountId)) {
      throw new WalletLinkError('invalid_account', 'Enter a valid Hedera account id like 0.0.12345.');
    }
    const challenge = this.store.getNonce(nonce);
    if (!challenge || challenge.user_id !== userId) {
      throw new WalletLinkError('unknown_nonce', 'Unknown challenge. Start over.');
    }
    const memoNeedle = `fishio:${nonce}`;
    const transactions = await this.mirror.recentTransactions(accountId, 25);
    const match = transactions.find((tx) => {
      const memo = decodeMemo(tx.memo);
      if (!memo.includes(memoNeedle)) return false;
      return (tx.transfers ?? []).some((t) => t.account === this.settings.operatorId && t.amount > 0);
    });
    if (!match) {
      throw new WalletLinkError(
        'proof_not_found',
        'No matching transfer found yet. Send 1 tinybar with the memo, wait a few seconds, then try again.',
      );
    }
    this.consumeNonce(userId, nonce);
    return this.link(userId, accountId, null, 'transfer');
  }

  verifySignature(userId: string, body: { accountId?: unknown; publicKey?: unknown; signature?: unknown; nonce?: unknown }): WalletLink {
    const accountId = typeof body.accountId === 'string' ? stripChecksum(body.accountId) : '';
    const publicKey = typeof body.publicKey === 'string' ? body.publicKey : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const nonce = typeof body.nonce === 'string' ? body.nonce : '';
    if (!isValidHederaAccountId(accountId)) {
      throw new WalletLinkError('invalid_account', 'Enter a valid Hedera account id like 0.0.12345.');
    }
    const challenge = this.store.getNonce(nonce);
    if (!challenge || challenge.user_id !== userId) {
      throw new WalletLinkError('unknown_nonce', 'Unknown challenge. Start over.');
    }
    if (!verifyMessageSignature(publicKey, challenge.message, signature)) {
      throw new WalletLinkError('bad_signature', 'Signature does not verify for this public key and challenge.');
    }
    this.consumeNonce(userId, nonce);
    return this.link(userId, accountId, publicKey, 'signature');
  }

  private link(userId: string, accountId: string, publicKey: string | null, method: 'transfer' | 'signature'): WalletLink {
    const existing = this.store.findWalletLinkByAccount(accountId);
    if (existing && existing.user_id !== userId) {
      throw new WalletLinkError('account_taken', 'That Hedera account is already linked to another player.');
    }
    const linkedAt = Date.now();
    this.store.upsertWalletLink(userId, accountId, publicKey, method, this.settings.network, linkedAt);
    return { userId, accountId, publicKey, method, network: this.settings.network, linkedAt };
  }
}

export class WalletLinkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
