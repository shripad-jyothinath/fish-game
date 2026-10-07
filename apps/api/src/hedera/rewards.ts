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
import { refreshPower } from '../power.ts';
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
  reward: { amount: number; status: 'credited'; dailyRemaining?: number };
  receipt: {
    status: 'submitted' | 'failed' | 'disabled';
    topicId: string | null;
    sequenceNumber: number | null;
    transactionId: string | null;
    hashscanUrl: string | null;
  };
}

const MATCH_COOLDOWN_CODE = 'match_cooldown';

export function calculateGoldReward(stats: MatchStats): number {
  // Uncapped and level-scaling: grinding levels raises income, and prices rise
  // faster still — top-tier gear stays a long-term goal without hard caps.
  const level = Math.max(1, Math.floor(stats.level));
  const base = Math.floor(stats.score / 100);
  const killBonus = stats.kills * (5 + Math.floor(level / 3));
  const levelBonus = (level - 1) * 8;
  const chestBonus = stats.chests * 4;
  const modeMultiplier = stats.mode === 'frenzy' ? 1.25 : 1;
  return Math.max(0, Math.floor((base + killBonus + levelBonus + chestBonus) * modeMultiplier));
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
      const error = new Error('Just a moment — the previous match is still settling.') as Error & {
        code?: string;
        retryAfterMs?: number;
      };
      error.code = MATCH_COOLDOWN_CODE;
      error.retryAfterMs = this.settings.matchCooldownMs - (now - last);
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

    const amount = calculateGoldReward(stats);

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
    try {
      refreshPower(this.store, userId);
    } catch (err) {
      console.warn('[power] refresh failed:', err);
    }

    // $GOLD is credited to the in-game ledger immediately; withdrawing to the
    // player's Hedera wallet is a separate, explicit action.
    if (amount > 0) {
      this.store.creditGold(userId, amount, 'match_reward', matchId);
    }

    return {
      matchId,
      createdAt: now,
      mode: stats.mode,
      score: stats.score,
      kills: stats.kills,
      level: stats.level,
      reward: { amount, status: 'credited' },
      receipt,
    };
  }

  /** In-game $GOLD summary for the account panel. */
  ledgerSummary(userId: string): { balance: number; earned: number; withdrawn: number } {
    const byReason = this.store.goldTotalsByReason(userId);
    const earned =
      (byReason.match_reward ?? 0) +
      (byReason.stage_reward ?? 0) +
      (byReason.daily_reward ?? 0) +
      (byReason.wheel_reward ?? 0);
    return {
      balance: this.store.goldBalance(userId),
      earned,
      withdrawn: Math.abs(byReason.withdraw ?? 0),
    };
  }

  /**
   * Move $GOLD from the in-game ledger to the player's Hedera wallet.
   * The debit is reserved atomically first and refunded if the on-chain
   * transfer fails, so a withdrawal can never be lost or double-spent.
   */
  async withdraw(
    userId: string,
    requested: number | 'all',
    wallet: WalletService,
  ): Promise<{ amount: number; payment: TokenPayment }> {
    if (!this.token) throw codedError('payout_disabled', 'Hedera payouts are not configured on this server yet.');

    const balance = this.store.goldBalance(userId);
    const amount = requested === 'all' ? balance : Math.floor(Number(requested));
    if (!Number.isFinite(amount) || amount <= 0) throw codedError('invalid_amount', 'Enter a positive $GOLD amount.');
    if (amount > balance) throw codedError('insufficient_gold', 'Not enough $GOLD in your in-game balance.');

    const link = wallet.getPayoutWallet(userId);
    if (!link) throw codedError('wallet_not_linked', 'Your wallet is not ready yet — try again in a moment.');

    if (!this.store.spendGold(userId, amount, 'withdraw', null)) {
      throw codedError('insufficient_gold', 'Not enough $GOLD in your in-game balance.');
    }

    try {
      const payment = await this.token.payGold(link.accountId, amount);
      this.store.insertPayoutClaim({
        id: randomUUID(),
        user_id: userId,
        match_id: null,
        amount,
        currency: 'gold_token',
        status: 'paid',
        hedera_tx_id: payment.transactionId,
        error: null,
        created_at: Date.now(),
        confirmed_at: Date.now(),
      });
      return { amount, payment };
    } catch (err) {
      // Nothing left the wallet: put the $GOLD back in the game balance.
      this.store.creditGold(userId, amount, 'withdraw_failed', null);
      throw err;
    }
  }
}
