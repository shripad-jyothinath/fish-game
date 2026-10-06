/**
 * Hedera settings, all env-driven. With no operator credentials the whole
 * integration runs in a clean "disabled" mode: matches are still recorded
 * locally, nothing is sent on-chain.
 */
export type HederaNetwork = 'testnet' | 'previewnet' | 'mainnet';

export interface HederaSettings {
  enabled: boolean;
  network: HederaNetwork;
  operatorId: string;
  operatorKey: string;
  topicId: string;
  goldTokenId: string;
  nftCollectionId: string;
  goldName: string;
  goldSymbol: string;
  goldDecimals: number;
  goldInitialSupply: number;
  rewardDailyCap: number;
  rewardMatchCap: number;
  matchCooldownMs: number;
  /** 💰 → $GOLD conversion: in-game gold needed for 1 $GOLD. */
  goldConvertRate: number;
  /** Max in-game gold convertible per UTC day (0 disables conversion). */
  goldConvertDailyGold: number;
  /** Per-item mint caps: itemId → max copies in existence. */
  editionLimits: Record<string, number>;
  /** Create a managed wallet for every account (true unless HEDERA_AUTO_WALLETS=false). */
  autoWallets: boolean;
  mirrorBaseUrl: string;
  hashscanBaseUrl: string;
  /** Absolute base URL used in NFT metadata URIs (must be public for explorers to fetch it). */
  publicBaseUrl: string;
}

const MIRROR_BASE: Record<HederaNetwork, string> = {
  testnet: 'https://testnet.mirrornode.hedera.com/api/v1',
  previewnet: 'https://previewnet.mirrornode.hedera.com/api/v1',
  mainnet: 'https://mainnet.mirrornode.hedera.com/api/v1',
};

const HASHSCAN_BASE: Record<HederaNetwork, string> = {
  testnet: 'https://hashscan.io/testnet',
  previewnet: 'https://hashscan.io/previewnet',
  mainnet: 'https://hashscan.io/mainnet',
};

function pickNetwork(value: string | undefined): HederaNetwork {
  return value === 'mainnet' || value === 'previewnet' ? value : 'testnet';
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Limited-edition items: first owner only (server-enforced), keyed by item id. */
function parseEditionLimits(value: string | undefined): Record<string, number> {
  const defaults: Record<string, number> = { golden_leviathan: 1 };
  if (!value) return defaults;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const out: Record<string, number> = { ...defaults };
    for (const [key, raw] of Object.entries(parsed)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
    }
    return out;
  } catch {
    return defaults;
  }
}

export function loadHederaSettings(env: NodeJS.ProcessEnv = process.env): HederaSettings {
  const network = pickNetwork(env.HEDERA_NETWORK);
  const operatorId = (env.HEDERA_OPERATOR_ID ?? '').trim();
  const operatorKey = (env.HEDERA_OPERATOR_KEY ?? '').trim();
  return {
    enabled: Boolean(operatorId && operatorKey),
    network,
    operatorId,
    operatorKey,
    topicId: (env.HEDERA_TOPIC_ID ?? '').trim(),
    goldTokenId: (env.HEDERA_GOLD_TOKEN_ID ?? '').trim(),
    nftCollectionId: (env.HEDERA_NFT_COLLECTION_ID ?? '').trim(),
    goldName: env.HEDERA_GOLD_NAME ?? 'Fish.IO Gold',
    goldSymbol: env.HEDERA_GOLD_SYMBOL ?? 'GOLD',
    goldDecimals: Math.min(8, num(env.HEDERA_GOLD_DECIMALS, 2)),
    goldInitialSupply: num(env.HEDERA_GOLD_INITIAL_SUPPLY, 1_000_000),
    rewardDailyCap: num(env.HEDERA_REWARD_DAILY_CAP, 500),
    rewardMatchCap: num(env.HEDERA_REWARD_MATCH_CAP, 100),
    matchCooldownMs: num(env.HEDERA_MATCH_COOLDOWN_MS, 10_000),
    goldConvertRate: Math.max(1, Math.floor(num(env.GOLD_CONVERT_RATE, 100))),
    goldConvertDailyGold: Math.floor(num(env.GOLD_CONVERT_DAILY_GOLD, 20_000)),
    editionLimits: parseEditionLimits(env.HEDERA_EDITION_LIMITS),
    autoWallets: env.HEDERA_AUTO_WALLETS !== 'false',
    mirrorBaseUrl: (env.HEDERA_MIRROR_URL ?? '').trim() || MIRROR_BASE[network],
    hashscanBaseUrl: (env.HEDERA_HASHSCAN_URL ?? '').trim() || HASHSCAN_BASE[network],
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').trim() || 'http://127.0.0.1:8080',
  };
}

export function hashscanTxUrl(settings: HederaSettings, transactionId: string): string {
  // Transaction ids are URL-safe (`0.0.x@seconds.nanos`); HashScan wants them raw.
  return `${settings.hashscanBaseUrl}/transaction/${transactionId}`;
}

export function hashscanTopicUrl(settings: HederaSettings, topicId: string): string {
  return `${settings.hashscanBaseUrl}/topic/${topicId}`;
}

export function hashscanNftUrl(settings: HederaSettings, tokenId: string, serial: number): string {
  return `${settings.hashscanBaseUrl}/token/${tokenId}/${serial}`;
}
