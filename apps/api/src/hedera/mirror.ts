/**
 * Read-only Mirror Node REST client: balances, transactions, topic messages,
 * NFT listings. Used for wallet-link proofs and inventory reads.
 */

export interface MirrorTokenBalance {
  token_id: string;
  balance: number;
}

export interface MirrorTransaction {
  transaction_id: string;
  memo: string; // base64 in mirror responses
  result: string;
  transfers?: Array<{ account: string; amount: number }>;
}

export interface MirrorTopicMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string; // base64
}

export interface MirrorNft {
  token_id: string;
  serial_number: number;
  metadata?: string; // base64
  deleted: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mirror node ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export class MirrorClient {
  constructor(private readonly baseUrl: string) {}

  async tokenBalance(accountId: string, tokenId: string): Promise<number> {
    const data = await getJson<{ tokens?: MirrorTokenBalance[] }>(
      `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/tokens?token.id=${encodeURIComponent(tokenId)}&limit=1`,
    );
    const entry = data.tokens?.find((t) => t.token_id === tokenId);
    return entry?.balance ?? 0;
  }

  async recentTransactions(accountId: string, limit = 25): Promise<MirrorTransaction[]> {
    const data = await getJson<{ transactions?: MirrorTransaction[] }>(
      `${this.baseUrl}/transactions?account.id=${encodeURIComponent(accountId)}&limit=${limit}&order=desc`,
    );
    return data.transactions ?? [];
  }

  async topicMessages(topicId: string, limit = 25): Promise<MirrorTopicMessage[]> {
    const data = await getJson<{ messages?: MirrorTopicMessage[] }>(
      `${this.baseUrl}/topics/${encodeURIComponent(topicId)}/messages?limit=${limit}&order=desc`,
    );
    return data.messages ?? [];
  }

  async nftsForAccount(accountId: string, tokenId?: string): Promise<MirrorNft[]> {
    const tokenQuery = tokenId ? `?token.id=${encodeURIComponent(tokenId)}` : '';
    const data = await getJson<{ nfts?: MirrorNft[] }>(
      `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/nfts${tokenQuery}${tokenQuery ? '&' : '?'}limit=100`,
    );
    return (data.nfts ?? []).filter((n) => !n.deleted);
  }
}

export function decodeMemo(memo: string): string {
  try {
    return Buffer.from(memo, 'base64').toString('utf8');
  } catch {
    return '';
  }
}
