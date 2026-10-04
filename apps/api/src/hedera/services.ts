/**
 * Service container: one place that decides whether Hedera is live and wires
 * the individual services together. Credentials problems degrade to offline
 * mode instead of taking the website down.
 */
import type { Store } from '../db.ts';
import { createHederaClient, type HederaClient } from './client.ts';
import type { HederaSettings } from './config.ts';
import { HcsService } from './hcs.ts';
import { MirrorClient } from './mirror.ts';
import { NftService } from './nft.ts';
import { RewardService } from './rewards.ts';
import { TokenService } from './token.ts';
import { WalletService } from './wallet.ts';

export interface HederaServices {
  settings: HederaSettings;
  /** True when the operator client is usable (credentials parsed, network set). */
  online: boolean;
  credentialsError: string | null;
  hedera: HederaClient | null;
  mirror: MirrorClient;
  hcs: HcsService | null;
  token: TokenService | null;
  nft: NftService | null;
  wallet: WalletService;
  rewards: RewardService;
}

export function createHederaServices(store: Store, settings: HederaSettings): HederaServices {
  let hedera: HederaClient | null = null;
  let credentialsError: string | null = null;
  if (settings.enabled) {
    try {
      hedera = createHederaClient(settings);
    } catch (err) {
      credentialsError = err instanceof Error ? err.message : String(err);
      console.error('[hedera] operator credentials rejected — running offline:', credentialsError);
    }
  }

  const mirror = new MirrorClient(settings.mirrorBaseUrl);
  const hcs = hedera ? new HcsService(hedera, store, settings) : null;
  const token = hedera ? new TokenService(hedera, store, settings) : null;
  const nft = hedera ? new NftService(hedera, store, settings) : null;
  const wallet = new WalletService(store, mirror, settings);
  const rewards = new RewardService(store, settings, hcs ?? undefined, token ?? undefined);

  return { settings, online: Boolean(hedera), credentialsError, hedera, mirror, hcs, token, nft, wallet, rewards };
}
