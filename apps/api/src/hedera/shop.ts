/**
 * $GOLD shop: server-side price book for cosmetics purchased with the on-chain
 * token. Prices come from the real game catalog (game-core) so they can never
 * drift from what the client shows.
 *
 * Pricing is TIER-BASED (the game's own T0–T4 gearing): each tier starts at
 * least ~4× above the previous tier's most expensive item, and within a tier
 * prices interpolate exponentially from `start` to `end`. Income is capped
 * (~100 $GOLD/match, 500/day), so this makes:
 *   T0 minutes · T1 hours · T2 days · T3 weeks · T4 months-to-years.
 * Tune the two tables below if the economy should move.
 */
import { loadGame, type GameCatalog } from '@fishio/game-core';

export type GoldShopItemType = 'fish' | 'weapon' | 'hat';

export interface GoldShopItem {
  type: GoldShopItemType;
  id: string;
  name: string;
  /** Legacy in-game 💰 price (kept for reference/tests only). */
  costGold: number;
  /** $GOLD price, whole token units. */
  priceGold: number;
}

const PRICE_LADDER = [
  10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 750, 1000, 1250,
  1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 60000,
  75000, 100000, 125000, 150000, 200000, 250000, 300000, 400000, 500000, 600000, 750000, 1000000,
];

/** Per-tier [start, end] $GOLD ranges (T0 → T4). */
const TIER_RANGES: Record<'weapon' | 'fish', ReadonlyArray<readonly [number, number]>> = {
  weapon: [
    [10, 25],
    [100, 250],
    [1000, 2500],
    [10000, 50000],
    [200000, 600000],
  ],
  fish: [
    [10, 25],
    [100, 250],
    [1000, 2500],
    [10000, 60000],
    [250000, 1000000],
  ],
};

/** Hats are cosmetic; keep them achievable. */
const HAT_RANGE: readonly [number, number] = [10, 2500];

function roundLadder(value: number): number {
  let best = PRICE_LADDER[0]!;
  let bestDist = Math.abs(value - best);
  for (const step of PRICE_LADDER) {
    const dist = Math.abs(step - value);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

/** Exponential interpolation between `start` and `end` for `index` of `count`. */
function priceBetween(start: number, end: number, index: number, count: number): number {
  const t = count <= 1 ? 1 : index / (count - 1);
  return roundLadder(start * Math.pow(end / start, t));
}

interface ShopEntry {
  id: string;
  name: string;
  cost: number;
}

function collectEntries(table: Record<string, unknown>): ShopEntry[] {
  return Object.entries(table ?? {})
    .map(([id, raw]) => {
      const entry = (raw ?? {}) as { cost?: unknown; name?: unknown };
      return { id, name: String(entry.name ?? id), cost: Number(entry.cost ?? 0) };
    })
    .filter((entry) => Number.isFinite(entry.cost) && entry.cost > 0);
}

interface GoldShopCatalog {
  items: GoldShopItem[];
  byKey: Map<string, GoldShopItem>;
}

let cached: GoldShopCatalog | null = null;

/** Build (once) the sellable item list from the game's own catalog. */
export function goldShop(): GoldShopCatalog {
  if (cached) return cached;

  const catalog: GameCatalog = loadGame().catalog();
  const items: GoldShopItem[] = [];

  const collectTiered = (type: 'weapon' | 'fish', table: Record<string, unknown>, tiers: string[][]) => {
    const tierOf = new Map<string, number>();
    tiers.forEach((list, tier) => {
      for (const id of list) tierOf.set(id, tier);
    });

    const groups = new Map<number, ShopEntry[]>();
    for (const entry of collectEntries(table)) {
      const tier = Math.min(tierOf.get(entry.id) ?? 0, TIER_RANGES[type].length - 1);
      const list = groups.get(tier) ?? [];
      list.push(entry);
      groups.set(tier, list);
    }

    for (const [tier, list] of groups) {
      list.sort((a, b) => a.cost - b.cost);
      const [start, end] = TIER_RANGES[type][tier]!;
      list.forEach((entry, index) => {
        items.push({
          type,
          id: entry.id,
          name: entry.name,
          costGold: entry.cost,
          priceGold: priceBetween(start, end, index, list.length),
        });
      });
    }
  };

  collectTiered('weapon', catalog.weaponSkins, catalog.weaponTiers ?? []);
  collectTiered('fish', catalog.fishSkins, catalog.fishTiers ?? []);

  const hats = collectEntries(catalog.fishHats).sort((a, b) => a.cost - b.cost);
  hats.forEach((entry, index) => {
    items.push({
      type: 'hat',
      id: entry.id,
      name: entry.name,
      costGold: entry.cost,
      priceGold: priceBetween(HAT_RANGE[0], HAT_RANGE[1], index, hats.length),
    });
  });

  items.sort((a, b) => a.type.localeCompare(b.type) || a.priceGold - b.priceGold || a.id.localeCompare(b.id));
  const byKey = new Map(items.map((item) => [`${item.type}:${item.id}`, item]));
  cached = { items, byKey };
  return cached;
}

export function findGoldShopItem(type: unknown, id: unknown): GoldShopItem | null {
  if (typeof type !== 'string' || typeof id !== 'string') return null;
  return goldShop().byKey.get(`${type}:${id}`) ?? null;
}

// ------------------------------------------------------------ workshop upgrades

export interface UpgradeDef {
  id: string;
  name: string;
  maxLevel: number;
}

let cachedUpgrades: Map<string, UpgradeDef> | null = null;

/** Server-side workshop upgrade definitions (from the game catalog). */
export function upgradeDefs(): Map<string, UpgradeDef> {
  if (cachedUpgrades) return cachedUpgrades;
  const catalog = loadGame().catalog();
  const map = new Map<string, UpgradeDef>();
  for (const [id, raw] of Object.entries(catalog.upgrades ?? {})) {
    const entry = (raw ?? {}) as { name?: unknown; maxLevel?: unknown };
    map.set(id, {
      id,
      name: String(entry.name ?? id),
      maxLevel: Math.max(1, Math.floor(Number(entry.maxLevel ?? 5))),
    });
  }
  cachedUpgrades = map;
  return map;
}

/** Cost to go from `nextLevelIndex` (0-based) to the next upgrade level. */
const UPGRADE_LADDER = [100, 400, 1500, 6000, 25000];

export function upgradePriceFor(nextLevelIndex: number): number {
  if (nextLevelIndex < UPGRADE_LADDER.length) return UPGRADE_LADDER[nextLevelIndex]!;
  return UPGRADE_LADDER[UPGRADE_LADDER.length - 1]! * 2 ** (nextLevelIndex - UPGRADE_LADDER.length + 1);
}

export function upgradePrices(): number[] {
  return [...UPGRADE_LADDER];
}
