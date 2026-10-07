/**
 * $GOLD shop: server-side price book for cosmetics purchased with the on-chain
 * token. Prices come from the real game catalog (game-core) so they can never
 * drift from what the client shows.
 *
 * Pricing: items keep their original progression order (legacy gold cost), and
 * each category gets an exponential curve from `start` to `end` rounded to a
 * friendly ladder. Rewards pay ~10–100 $GOLD per match, so the top fish is a
 * long-term goal, not a weekend purchase.
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
  5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500,
  600, 700, 800, 900, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000,
];

const CATEGORY_CURVE: Record<GoldShopItemType, { start: number; end: number }> = {
  weapon: { start: 10, end: 600 },
  fish: { start: 10, end: 2500 },
  hat: { start: 10, end: 150 },
};

function roundLadder(value: number): number {
  let best = PRICE_LADDER[0]!;
  for (const step of PRICE_LADDER) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  }
  return best;
}

/** Exponential progression between `start` and `end` for rank `index` of `total`. */
export function priceForRank(index: number, total: number, start: number, end: number): number {
  const t = total <= 1 ? 1 : index / (total - 1);
  return roundLadder(start * Math.pow(end / start, t));
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

  const collect = (type: GoldShopItemType, table: Record<string, unknown>) => {
    const entries = Object.entries(table ?? {})
      .map(([id, raw]) => {
        const entry = (raw ?? {}) as { cost?: unknown; name?: unknown };
        return { id, name: String(entry.name ?? id), cost: Number(entry.cost ?? 0) };
      })
      .filter((entry) => Number.isFinite(entry.cost) && entry.cost > 0)
      .sort((a, b) => a.cost - b.cost);

    const curve = CATEGORY_CURVE[type];
    entries.forEach((entry, index) => {
      items.push({
        type,
        id: entry.id,
        name: entry.name,
        costGold: entry.cost,
        priceGold: priceForRank(index, entries.length, curve.start, curve.end),
      });
    });
  };

  collect('fish', catalog.fishSkins);
  collect('weapon', catalog.weaponSkins);
  collect('hat', catalog.fishHats);

  items.sort(
    (a, b) => a.type.localeCompare(b.type) || a.priceGold - b.priceGold || a.id.localeCompare(b.id),
  );
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
const UPGRADE_LADDER = [15, 30, 60, 120, 240];

export function upgradePriceFor(nextLevelIndex: number): number {
  if (nextLevelIndex < UPGRADE_LADDER.length) return UPGRADE_LADDER[nextLevelIndex]!;
  return UPGRADE_LADDER[UPGRADE_LADDER.length - 1]! * 2 ** (nextLevelIndex - UPGRADE_LADDER.length + 1);
}

export function upgradePrices(): number[] {
  return [...UPGRADE_LADDER];
}
