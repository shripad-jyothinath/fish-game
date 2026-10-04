/**
 * $GOLD — HTS fungible token. Treasury = operator. Rewards are paid out as
 * token transfers (with airdrop fallback so recipients don't need to
 * pre-associate unless the network rejects airdrops).
 */
import { TokenAirdropTransaction, TokenCreateTransaction, TokenSupplyType, TransferTransaction } from '@hiero-ledger/sdk';
import type { Store } from '../db.ts';
import type { HederaClient } from './client.ts';
import { wholeToBaseUnits } from './client.ts';
import type { HederaSettings } from './config.ts';

export interface TokenPayment {
  transactionId: string;
  method: 'airdrop' | 'transfer';
}

export class TokenService {
  constructor(
    private readonly hedera: HederaClient,
    private readonly store: Store,
    private readonly settings: HederaSettings,
  ) {}

  async ensureGoldToken(): Promise<string> {
    const stored =
      this.settings.goldTokenId || this.store.getHederaResource(this.settings.network, 'gold_token')?.resource_id || '';
    if (stored) return stored;

    const initialSupply = Number(wholeToBaseUnits(this.settings.goldInitialSupply, this.settings.goldDecimals));
    const tx = await new TokenCreateTransaction()
      .setTokenName(this.settings.goldName)
      .setTokenSymbol(this.settings.goldSymbol)
      .setDecimals(this.settings.goldDecimals)
      .setInitialSupply(initialSupply)
      .setTreasuryAccountId(this.hedera.operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .setAdminKey(this.hedera.operatorKey.publicKey)
      .setSupplyKey(this.hedera.operatorKey.publicKey)
      .execute(this.hedera.client);

    const receipt = await tx.getReceipt(this.hedera.client);
    const tokenId = receipt.tokenId?.toString();
    if (!tokenId) throw new Error('GOLD token creation returned no token id');
    this.store.setHederaResource(this.settings.network, 'gold_token', tokenId, {
      name: this.settings.goldName,
      symbol: this.settings.goldSymbol,
      decimals: this.settings.goldDecimals,
    });
    return tokenId;
  }

  async payGold(toAccountId: string, amount: number): Promise<TokenPayment> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payout amount must be positive');
    const tokenId = await this.ensureGoldToken();
    const base = Number(wholeToBaseUnits(amount, this.settings.goldDecimals));

    try {
      const tx = await new TokenAirdropTransaction()
        .addTokenTransfer(tokenId, this.hedera.operatorId, -base)
        .addTokenTransfer(tokenId, toAccountId, base)
        .execute(this.hedera.client);
      return { transactionId: tx.transactionId.toString(), method: 'airdrop' };
    } catch {
      // Airdrop rejected (e.g. no auto-association slots): fall back to a
      // plain transfer, which works when the recipient already associated.
      const tx = await new TransferTransaction()
        .addTokenTransfer(tokenId, this.hedera.operatorId, -base)
        .addTokenTransfer(tokenId, toAccountId, base)
        .execute(this.hedera.client);
      return { transactionId: tx.transactionId.toString(), method: 'transfer' };
    }
  }
}
