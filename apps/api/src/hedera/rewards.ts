/**
 * Match recording + $GOLD reward engine.
 *
 * Every finished match is stored, optionally attested on HCS, and earns a
 * pending $GOLD reward (rewards accrue even without a linked wallet; claiming
 * pays them out on-chain). Daily caps and a per-match cooldown blunt farming.
 *
 * Trust note: the game is client-side today, so stats are self-reported. This
 * is acceptable for testnet play; multiplayer room servers make it exact.
 */
import { randomUUID } from 'node:crypto';
import type { Store } from '../db.ts';
import type { HederaSettings } from './config.ts';
import { hashscanTxUrl } from './config.ts';
import type { HcsReceipt, HcsService } from './hcs.ts';
import type { TokenPayment, TokenService } from './token.ts';
import type { WalletService } from './wallet.ts';

export interface MatchStats {
  mode: 'classic' | 'frenzy' | 'challenge';
  score: number;
  kills: number;
  level: number;
  food: number;
  chests: number;
  kingTime: number;
  durationMs: number;
}

export interface MatchRecordResult {
  matchId: string;
  createdAt: number;
  mode: string;
  score: number;
  kills: number;
  level: number;
  reward: { amount: number; status: 'pending'; dailyRemaining: number };
  receipt: {
    status: 'submitted' | 'failed' | 'disabled';
    topicId: string | null;
    sequenceNumber: number | null;
    transactionId: string | null;
    hashscanUrl: string | null;
  };
}

const MATCH_COOLDOWN_CODE = 'match_cooldown';

export function calculateGoldReward(stats: MatchStats, settings: HederaSettings): number {
  const base = Math.floor(stats.score / 150);
  const killBonus = stats.kills * 3;
  const levelBonus = Math.max(0, stats.level - 1);
  const chestBonus = stats.chests * 2;
  const modeMultiplier = stats.mode === 'frenzy' ? 1.25 : 1;
  const total = Math.floor((base + killBonus + levelBonus + chestBonus) * modeMultiplier);
  return Math.max(0, Math.min(settings.rewardMatchCap, total));
}

function startOfUtcDay(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function codedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: string }).code = code;
  return error;
}

export class RewardService {
  constructor(
    private readonly store: Store,
    private readonly settings: HederaSettings,
    private readonly hcs: HcsService | undefined,
    private readonly token: TokenService | undefined,
  ) {}

  async recordMatch(userId: string, stats: MatchStats): Promise<MatchRecordResult> {
    const now = Date.now();
    const last = this.store.latestMatchAt(userId);
    if (last && now - last < this.settings.matchCooldownMs) {
      const error = new Error('Too many match submissions. Wait a few seconds and try again.');
      (error as Error & { code?: string }).code = MATCH_COOLDOWN_CODE;
      throw error;
    }

    const matchId = randomUUID();
    let receipt: MatchRecordResult['receipt'] = {
      status: 'disabled',
      topicId: null,
      sequenceNumber: null,
      transactionId: null,
      hashscanUrl: null,
    };

    if (this.hcs) {
      try {
        const submitted: HcsReceipt = await this.hcs.submit('match', {
          matchId,
          player: userId,
          mode: stats.mode,
          score: stats.score,
          kills: stats.kills,
          level: stats.level,
          chests: stats.chests,
          kingTime: stats.kingTime,
          durationMs: stats.durationMs,
          at: now,
        });
        receipt = {
          status: 'submitted',
          topicId: submitted.topicId,
          sequenceNumber: submitted.sequenceNumber,
          transactionId: submitted.transactionId,
          hashscanUrl: hashscanTxUrl(this.settings, submitted.transactionId),
        };
      } catch (err) {
        console.error('[hedera] HCS submit failed:', err);
        receipt = { status: 'failed', topicId: null, sequenceNumber: null, transactionId: null, hashscanUrl: null };
      }
    }

    const earned = calculateGoldReward(stats, this.settings);
    const spentToday = this.store.sumRewardsSince(userId, startOfUtcDay(now));
    const remaining = Math.max(0, this.settings.rewardDailyCap - spentToday);
    const amount = Math.min(earned, remaining);

    this.store.insertMatch({
      id: matchId,
      user_id: userId,
      mode: stats.mode,
      score: stats.score,
      kills: stats.kills,
      max_level: stats.level,
      food_eaten: stats.food,
      chests: stats.chests,
      king_time_s: stats.kingTime,
      duration_ms: stats.durationMs,
      reward_gold: amount,
      hcs_status: receipt.status,
      hcs_topic_id: receipt.topicId,
      hcs_sequence: receipt.sequenceNumber,
      hcs_tx_id: receipt.transactionId,
      created_at: now,
    });
    this.store.bumpPlayerStats(userId, stats, now);

    if (amount > 0) {
      this.store.insertPayoutClaim({
        id: randomUUID(),
        user_id: userId,
        match_id: matchId,
        amount,
        currency: 'gold_token',
        status: 'pending',
        hedera_tx_id: null,
        error: null,
        created_at: now,
        confirmed_at: null,
      });
    }

    return {
      matchId,
      createdAt: now,
      mode: stats.mode,
      score: stats.score,
      kills: stats.kills,
      level: stats.level,
      reward: { amount, status: 'pending', dailyRemaining: Math.max(0, remaining - amount) },
      receipt,
    };
  }

  totals(userId: string): { pending: number; paid: number; totalEarned: number } {
    return this.store.rewardTotals(userId);
  }

  /**
   * Convert in-game 💰 into pending $GOLD at the configured rate. Converted
   * gold flows through the same pending/claim pipeline as match rewards.
   *
   * Trust note: the client deducts its local gold before calling this; the
   * server enforces the rate and a daily gold cap so abuse stays bounded.
   * M4 room results (server-authored) can later feed this server-side too.
   */
  convertGold(
    userId: string,
    rawGold: number,
  ): { gold: number; amount: number; rate: number; dailyRemaining: number; pending: number } {
    const now = Date.now();
    const rate = this.settings.goldConvertRate;
    const dailyCap = this.settings.goldConvertDailyGold;
    if (dailyCap <= 0) throw codedError('conversion_disabled', 'Gold conversion is disabled on this server.');
    if (!Number.isFinite(rawGold)) throw codedError('invalid_amount', 'Enter a gold amount.');

    const gold = Math.floor(rawGold);
    if (gold <= 0) throw codedError('invalid_amount', 'Enter a positive gold amount.');

    const spentToday = this.store.sumGoldConvertedSince(userId, startOfUtcDay(now));
    const remaining = Math.max(0, dailyCap - spentToday);
    const amount = Math.floor(Math.min(gold, remaining) / rate);
    if (amount <= 0) {
      throw codedError('below_minimum', `You need at least ${rate} 💰 to convert (daily cap left: ${remaining} 💰).`);
    }
    const spent = amount * rate;

    this.store.insertGoldConversion({
      id: randomUUID(),
      user_id: userId,
      gold_spent: spent,
      gold_amount: amount,
      created_at: now,
    });
    this.store.insertPayoutClaim({
      id: randomUUID(),
      user_id: userId,
      match_id: null, // converted gold, not a match reward
      amount,
      currency: 'gold_token',
      status: 'pending',
      hedera_tx_id: null,
      error: null,
      created_at: now,
      confirmed_at: null,
    });

    return {
      gold: spent,
      amount,
      rate,
      dailyRemaining: Math.max(0, remaining - spent),
      pending: this.totals(userId).pending,
    };
  }

  async claim(userId: string, wallet: WalletService): Promise<{ amount: number; payment: TokenPayment }> {
    const link = wallet.getPayoutWallet(userId);
    if (!link) {
      const error = new Error('Link a Hedera account before claiming $GOLD.');
      (error as Error & { code?: string }).code = 'wallet_not_linked';
      throw error;
    }
    if (!this.token) {
      const error = new Error('Hedera payouts are not configured on this server yet.');
      (error as Error & { code?: string }).code = 'payout_disabled';
      throw error;
    }
    const pending = this.store.listPendingPayouts(userId);
    const amount = pending.reduce((sum, row) => sum + row.amount, 0);
    if (amount <= 0 || pending.length === 0) {
      const error = new Error('Nothing to claim right now.');
      (error as Error & { code?: string }).code = 'nothing_to_claim';
      throw error;
    }

    const payment = await this.token.payGold(link.accountId, amount);
    this.store.markPayoutsPaid(
      pending.map((row) => row.id),
      payment.transactionId,
      Date.now(),
    );
    return { amount, payment };
  }
}
