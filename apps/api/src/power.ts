/**
 * Combat power: one number for leaderboards (and later matchmaking), derived
 * from the player's loadout (weapon + fish tier), workshop levels and their
 * best match level. Recomputed whenever the save or progression changes.
 */
import { loadGame } from '@fishio/game-core';
import type { Store } from './db.ts';

const WEAPON_TIER_POWER = [0, 300, 900, 2400, 6000];
const FISH_TIER_POWER = [0, 250, 750, 2000, 5000];
const UPGRADE_LEVEL_POWER = 80;
const BEST_LEVEL_POWER = 25;

let tierMaps: { weapon: Map<string, number>; fish: Map<string, number> } | null = null;

function tiers(): { weapon: Map<string, number>; fish: Map<string, number> } {
  if (!tierMaps) {
    const catalog = loadGame().catalog();
    const weapon = new Map<string, number>();
    const fish = new Map<string, number>();
    for (const [tier, list] of (catalog.weaponTiers ?? []).entries()) {
      for (const id of list) weapon.set(id, tier);
    }
    for (const [tier, list] of (catalog.fishTiers ?? []).entries()) {
      for (const id of list) fish.set(id, tier);
    }
    tierMaps = { weapon, fish };
  }
  return tierMaps;
}

export interface PowerBreakdown {
  power: number;
  weaponTier: number;
  fishTier: number;
  upgradeLevels: number;
  bestLevel: number;
}

export function computePower(store: Store, userId: string): PowerBreakdown {
  let weaponId = 'coral_dagger';
  let fishId = 'baby_shark';
  const upgrades: Record<string, number> = { ...store.upgradeLevels(userId) };

  const save = store.getSave(userId);
  if (save) {
    try {
      const data = JSON.parse(save.data) as Record<string, unknown>;
      if (typeof data.selectedWeapon === 'string') weaponId = data.selectedWeapon;
      if (typeof data.selectedFish === 'string') fishId = data.selectedFish;
      if (data.upgrades && typeof data.upgrades === 'object') {
        for (const [id, raw] of Object.entries(data.upgrades as Record<string, unknown>)) {
          const level = Math.max(0, Math.floor(Number(raw) || 0));
          upgrades[id] = Math.max(upgrades[id] ?? 0, level);
        }
      }
    } catch {
      /* ignore malformed saves */
    }
  }

  const weaponTier = Math.min(tiers().weapon.get(weaponId) ?? 0, WEAPON_TIER_POWER.length - 1);
  const fishTier = Math.min(tiers().fish.get(fishId) ?? 0, FISH_TIER_POWER.length - 1);
  const upgradeLevels = Object.values(upgrades).reduce((sum, level) => sum + (Number.isFinite(level) ? level : 0), 0);
  const bestLevel = Math.max(1, store.playerStats(userId)?.best_level ?? 1);

  const power = Math.round(
    WEAPON_TIER_POWER[weaponTier]! +
      FISH_TIER_POWER[fishTier]! +
      upgradeLevels * UPGRADE_LEVEL_POWER +
      bestLevel * BEST_LEVEL_POWER,
  );
  return { power, weaponTier, fishTier, upgradeLevels, bestLevel };
}

/** Compute and persist the player's power; returns the value. */
export function refreshPower(store: Store, userId: string): number {
  const { power } = computePower(store, userId);
  store.setPlayerPower(userId, power);
  return power;
}
