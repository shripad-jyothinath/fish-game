/**
 * "Fish.IO Originals" — HTS NFT collection for cosmetics and achievements.
 * Metadata follows the HIP-412 shape; the URI points at this API so
 * explorers can resolve the JSON (needs PUBLIC_BASE_URL to be reachable).
 */
import { Long, TokenAirdropTransaction, TokenCreateTransaction, TokenMintTransaction, TokenSupplyType, TokenType, TokenUpdateNftsTransaction, TransferTransaction } from '@hiero-ledger/sdk';
import type { Store } from '../db.ts';
import type { HederaClient } from './client.ts';
import type { HederaSettings } from './config.ts';

export interface MintResult {
  tokenId: string;
  serial: number;
  transactionId: string;
  metadataUri: string;
}

export class NftService {
  constructor(
    private readonly hedera: HederaClient,
    private readonly store: Store,
    private readonly settings: HederaSettings,
  ) {}

  private get publicBase(): string {
    return this.settings.publicBaseUrl.replace(/\/+$/, '');
  }

  metadataUri(itemId: string, serial?: number): string {
    const base = `${this.publicBase}/api/v1/hedera/nft/metadata/${encodeURIComponent(itemId)}`;
    return serial == null ? base : `${base}/${serial}`;
  }

  imageUri(itemId: string, serial?: number): string {
    const base = `${this.publicBase}/api/v1/hedera/nft/image/${encodeURIComponent(itemId)}`;
    return serial == null ? base : `${base}?serial=${serial}`;
  }

  async ensureCollection(): Promise<string> {
    const stored =
      this.settings.nftCollectionId ||
      this.store.getHederaResource(this.settings.network, 'nft_collection')?.resource_id ||
      '';
    if (stored) return stored;

    const tx = await new TokenCreateTransaction()
      .setTokenName('Fish.IO Originals')
      .setTokenSymbol('FISHIO')
      .setTokenType(TokenType.NonFungibleUnique)
      .setDecimals(0)
      .setInitialSupply(0)
      .setTreasuryAccountId(this.hedera.operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .setAdminKey(this.hedera.operatorKey.publicKey)
      .setSupplyKey(this.hedera.operatorKey.publicKey)
      .setMetadataKey(this.hedera.operatorKey.publicKey)
      .execute(this.hedera.client);

    const receipt = await tx.getReceipt(this.hedera.client);
    const tokenId = receipt.tokenId?.toString();
    if (!tokenId) throw new Error('NFT collection creation returned no token id');
    this.store.setHederaResource(this.settings.network, 'nft_collection', tokenId, { name: 'Fish.IO Originals' });
    return tokenId;
  }

  /** Mint one serial and deliver it to the owner (airdrop, transfer fallback). */
  async mintItem(params: {
    itemId: string;
    itemType: string;
    toAccountId: string;
  }): Promise<MintResult> {
    const tokenId = await this.ensureCollection();

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(this.metadataUri(params.itemId), 'utf8'))
      .execute(this.hedera.client);
    const receipt = await mintTx.getReceipt(this.hedera.client);
    const serialLong = receipt.serials?.[0];
    if (!serialLong) throw new Error('NFT mint returned no serial');
    const serial = serialLong.toNumber();

    // Best-effort: give this exact serial its own metadata URL so every copy
    // (and its art) can be unique. If the update fails, the shared URI stays.
    let metadataUri = this.metadataUri(params.itemId);
    try {
      await new TokenUpdateNftsTransaction()
        .setTokenId(tokenId)
        .setSerialNumbers([Long.fromNumber(serial)])
        .setMetadata(Buffer.from(this.metadataUri(params.itemId, serial), 'utf8'))
        .execute(this.hedera.client);
      metadataUri = this.metadataUri(params.itemId, serial);
    } catch (err) {
      console.warn('[hedera] per-serial metadata update failed; keeping shared URI:', err);
    }

    try {
      await new TokenAirdropTransaction()
        .addNftTransfer(tokenId, serial, this.hedera.operatorId, params.toAccountId)
        .execute(this.hedera.client);
    } catch {
      await new TransferTransaction()
        .addNftTransfer(tokenId, serial, this.hedera.operatorId, params.toAccountId)
        .execute(this.hedera.client);
    }

    return { tokenId, serial, transactionId: mintTx.transactionId.toString(), metadataUri };
  }
}
