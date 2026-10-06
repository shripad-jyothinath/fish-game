/**
 * $GOLD shop: server-side price book for cosmetics purchased with the on-chain
 * token. Prices come from the real game catalog (game-core) so they can never
 * drift from what the client shows: raw gold costs are compressed into $GOLD
 * bands, because end-game items cost millions of 💰 but rewards pay ~10–100
 * $GOLD per match.
 */
import { loadGame, type GameCatalog } from '@fishio/game-core';

export type GoldShopItemType = 'fish' | 'weapon' | 'hat';

export interface GoldShopItem {
  type: GoldShopItemType;
  id: string;
  name: string;
  /** In-game 💰 price (for reference in the UI). */
  costGold: number;
  /** $GOLD price, whole token units. */
  priceGold: number;
}

/**
 * Cost bands → $GOLD price. Deliberately super-linear: late-game items are a
 * flex, not a shortcut. Tune here (and in the UI copy) as the economy evolves.
 */
const PRICE_BANDS: ReadonlyArray<readonly [minCost: number, priceGold: number]> = [
  [1_000_000, 200],
  [100_000, 80],
  [20_000, 30],
  [5_000, 12],
  [1_000, 5],
  [1, 2],
];

/** $GOLD price for an item that costs `costGold` in-game; null = not for sale. */
export function goldPriceFor(costGold: number): number | null {
  if (!Number.isFinite(costGold) || costGold <= 0) return null;
  for (const [minCost, priceGold] of PRICE_BANDS) {
    if (costGold >= minCost) return priceGold;
  }
  return null;
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
    for (const [id, raw] of Object.entries(table ?? {})) {
      const entry = (raw ?? {}) as { cost?: unknown; name?: unknown };
      const cost = Number(entry.cost ?? 0);
      const priceGold = goldPriceFor(cost);
      if (priceGold == null) continue; // free/default items are not for sale
      items.push({ type, id, name: String(entry.name ?? id), costGold: cost, priceGold });
    }
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
