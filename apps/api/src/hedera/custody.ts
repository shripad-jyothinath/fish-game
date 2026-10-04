/**
 * Custodial wallets: every account gets a Hedera wallet, created and funded by
 * the operator, with the private key encrypted at rest (AES-256-GCM).
 *
 * - Master key: WALLET_ENCRYPTION_KEY env (scrypt-derived); a loud dev fallback
 *   is used when unset — set it before mainnet.
 * - Creation is idempotent and skipped when the player has linked their own
 *   wallet (external links always win as the payout target).
 * - Export is password-gated (see the wallet/export route) so players can move
 *   to HashPack/Blade any time — "not your keys" only lasts until they ask.
 */
import crypto from 'node:crypto';
import { AccountCreateTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk';
import type { Store } from '../db.ts';
import type { HederaClient } from './client.ts';
import type { HederaSettings } from './config.ts';

const DEFAULT_DEV_SECRET = 'fishio-dev-wallet-encryption-key-change-me';
let warnedAboutFallback = false;

function masterKey(): Buffer {
  const secret = process.env.WALLET_ENCRYPTION_KEY || DEFAULT_DEV_SECRET;
  if (!process.env.WALLET_ENCRYPTION_KEY && !warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[hedera] WALLET_ENCRYPTION_KEY is not set — using the built-in dev key for custodial wallets. Set a strong key before mainnet.',
    );
  }
  return crypto.scryptSync(secret, 'fishio-wallet-keys-v1', 32);
}

export interface EncryptedSecret {
  cipher: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipher: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(secret.cipher, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface CustodialWalletInfo {
  userId: string;
  accountId: string;
  network: string;
  createdAt: number;
}

export class CustodyService {
  private readonly inflight = new Map<string, Promise<CustodialWalletInfo | null>>();

  constructor(
    private readonly hedera: HederaClient,
    private readonly store: Store,
    private readonly settings: HederaSettings,
  ) {}

  private toInfo(row: { user_id: string; hedera_account_id: string; network: string; created_at: number }): CustodialWalletInfo {
    return {
      userId: row.user_id,
      accountId: row.hedera_account_id,
      network: row.network,
      createdAt: row.created_at,
    };
  }

  getWallet(userId: string): CustodialWalletInfo | null {
    const row = this.store.getCustodialWallet(userId);
    return row ? this.toInfo(row) : null;
  }

  /** Create the wallet if the player has none and hasn't linked their own. */
  ensureWallet(userId: string): Promise<CustodialWalletInfo | null> {
    const existing = this.getWallet(userId);
    if (existing) return Promise.resolve(existing);
    if (this.store.getWalletLink(userId)) return Promise.resolve(null);

    const pending = this.inflight.get(userId);
    if (pending) return pending;

    const creation = this.createWallet(userId).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, creation);
    return creation;
  }

  private async createWallet(userId: string): Promise<CustodialWalletInfo | null> {
    try {
      const initialHbar = Number(process.env.HEDERA_WALLET_INITIAL_HBAR || 25);
      const key = PrivateKey.generateECDSA();
      const tx = await new AccountCreateTransaction()
        .setKeyWithoutAlias(key.publicKey)
        .setInitialBalance(new Hbar(Number.isFinite(initialHbar) && initialHbar > 0 ? initialHbar : 25))
        // Slots so token/NFT airdrops (rewards, mints) land as real balances instead
        // of sitting as pending airdrops the player would have to accept manually.
        .setMaxAutomaticTokenAssociations(10)
        .setAccountMemo('Fish.IO auto wallet')
        .execute(this.hedera.client);
      const receipt = await tx.getReceipt(this.hedera.client);
      const accountId = receipt.accountId?.toString();
      if (!accountId) throw new Error('account creation returned no id');

      const encrypted = encryptSecret(key.toStringDer());
      const row = {
        user_id: userId,
        hedera_account_id: accountId,
        key_cipher: encrypted.cipher,
        key_iv: encrypted.iv,
        key_tag: encrypted.tag,
        network: this.settings.network,
        created_at: Date.now(),
      };
      try {
        this.store.insertCustodialWallet(row);
      } catch (err) {
        // Unique conflict (concurrent creation or existing link): prefer what's stored.
        const stored = this.store.getCustodialWallet(userId);
        if (stored) return this.toInfo(stored);
        throw err;
      }
      console.log(`[hedera] auto wallet ${accountId} created for user ${userId}`);
      return this.toInfo(row);
    } catch (err) {
      console.error('[hedera] auto wallet creation failed:', err);
      return null;
    }
  }

  /** Decrypt and return the private key (callers must re-check the password). */
  exportKey(userId: string): { accountId: string; privateKeyDer: string; network: string } | null {
    const row = this.store.getCustodialWallet(userId);
    if (!row) return null;
    return {
      accountId: row.hedera_account_id,
      privateKeyDer: decryptSecret({ cipher: row.key_cipher, iv: row.key_iv, tag: row.key_tag }),
      network: row.network,
    };
  }
}
