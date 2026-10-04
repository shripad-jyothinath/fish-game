/**
 * HCS (Hedera Consensus Service) — match attestation receipts.
 * One topic per network, auto-created on first use and persisted.
 */
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk';
import type { Store } from '../db.ts';
import type { HederaClient } from './client.ts';
import type { HederaSettings } from './config.ts';

export interface HcsReceipt {
  topicId: string;
  sequenceNumber: number;
  transactionId: string;
  status: string;
}

export class HcsService {
  constructor(
    private readonly hedera: HederaClient,
    private readonly store: Store,
    private readonly settings: HederaSettings,
  ) {}

  async ensureTopic(): Promise<string> {
    const stored =
      this.settings.topicId || this.store.getHederaResource(this.settings.network, 'hcs_topic')?.resource_id || '';
    if (stored) return stored;

    const tx = await new TopicCreateTransaction()
      .setTopicMemo('Fish.IO match attestations')
      .execute(this.hedera.client);
    const receipt = await tx.getReceipt(this.hedera.client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) throw new Error('HCS topic creation returned no topic id');
    this.store.setHederaResource(this.settings.network, 'hcs_topic', topicId, {});
    return topicId;
  }

  /** Append one compact JSON message; returns the consensus receipt. */
  async submit(type: string, payload: Record<string, unknown>): Promise<HcsReceipt> {
    const topicId = await this.ensureTopic();
    const message = JSON.stringify({ v: 1, app: 'fish.io', type, ...payload });
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(this.hedera.client);
    const receipt = await tx.getReceipt(this.hedera.client);
    const sequence = receipt.topicSequenceNumber?.toString();
    return {
      topicId,
      sequenceNumber: sequence ? Number(sequence) : 0,
      transactionId: tx.transactionId.toString(),
      status: receipt.status.toString(),
    };
  }
}
