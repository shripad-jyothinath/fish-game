/**
 * Type surface for the headless game-core harness.
 *
 * The simulation itself is dynamic (plain JS running in a vm context), so the
 * game/fish handles are intentionally loose. Servers must treat them as
 * opaque except for the fields documented here.
 */

export declare const GAME_SCRIPTS: string[];
export declare const FRAME_MS: number;

export interface FishHandle {
  // Identity / meta
  id: string;
  netId?: string;
  name: string;
  skinId: string;
  weaponId: string;
  hatId: string;
  isBot: boolean;

  // Kinematics
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  radius: number;
  level: number;
  score: number;
  kills: number;
  xp: number;
  xpForNextLevel: number;
  stamina: number;
  maxStamina: number;
  isBoosting: boolean;
  isKing: boolean;
  isDead: boolean;
  isBoss?: boolean;
  invulnerableTimer: number;
  hasShield: boolean;
  powerupTimers: Record<string, number>;

  updateDimensions(): void;
  applyWorkshopUpgrades(upgrades: Record<string, number> | null | undefined): void;
  addXP(amount: number, particleSystem?: unknown, soundEngine?: unknown): void;
  update(
    dt: number,
    worldWidth: number,
    worldHeight: number,
    particleSystem?: unknown,
    soundEngine?: unknown,
  ): void;
  render(ctx: unknown, camera: unknown): void;
}

export interface FoodHandle {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: string;
  xp: number;
  gold: number;
  isMeat: boolean;
  rotation: number;
}

export interface ChestHandle {
  id: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
}

export interface PowerupHandle {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: string;
}

export interface FoodManagerHandle {
  foods: FoodHandle[];
  chests: ChestHandle[];
  powerups: PowerupHandle[];
  maxFood: number;
  maxChests: number;
  maxPowerups: number;
  update(dt?: number): void;
}

export interface GameHandle {
  player: FishHandle | null;
  bots: FishHandle[];
  botControllers: Array<{ update(dt: number, allFish: FishHandle[], foodManager: FoodManagerHandle): void }>;
  targetBotCount: number;
  gameState: string;
  gameMode: string;
  matchTime: number;
  bossTimer: number;
  worldWidth: number;
  worldHeight: number;
  currentMap: { id?: string } & Record<string, unknown>;
  foodManager: FoodManagerHandle;
  botsKilled?: number;
  update(dt: number): void;
  startMatch(mode?: string): void;
  handleCollisions(allFish: FishHandle[]): void;
  killFish(killer: FishHandle, victim: FishHandle, allFish?: FishHandle[]): void;
  // UI methods that headless mode stubs out; servers may override them.
  updateHUD(): void;
  updateLeaderboard(allFish: FishHandle[], dt?: number): void;
  updateBotGear(dt: number): void;
  endGame(victory?: boolean): void;
  showAnnouncement(text: string): void;
  notifyMatchBridge(extra?: Record<string, unknown>): void;
}

export interface GameCatalog {
  maps: Record<string, { id?: string } & Record<string, unknown>>;
  fishSkins: Record<string, unknown>;
  weaponSkins: Record<string, unknown>;
  fishHats: Record<string, unknown>;
  upgrades: Record<string, { maxLevel?: number } & Record<string, unknown>>;
  levelChallenges: unknown[];
  weaponTiers: string[][];
  fishTiers: string[][];
  tierNames: string[];
}

export interface GameHarness {
  context: Record<string, unknown>;
  clock: { now: number };
  game: GameHandle | undefined;
  createGame(): GameHandle;
  createFish(options: {
    x: number;
    y: number;
    name: string;
    skinId: string;
    weaponId: string;
    hatId?: string;
  }): FishHandle;
  random(): number;
  catalog(): GameCatalog;
  advance(frames: number, onFrame?: ((i: number, game: GameHandle) => void) | null, game?: GameHandle): void;
  runDueTimers(): void;
  pendingTimers(): number;
}

export interface MatchSummary {
  seed: number;
  frames: number;
  mode: string;
  ms: number;
  msPerFrame: number;
  gameState: string;
  matchTime: number;
  bots: number;
  foods: number;
  powerups: number;
  chests: number;
  pendingTimers: number;
  player: {
    x: number;
    y: number;
    level: number;
    score: number;
    kills: number;
    dead: boolean;
    weapon: string;
    skin: string;
  } | null;
  matchKills: number;
  matchGold: number;
  hash: string;
}

export declare function loadGame(options?: { seed?: number; scripts?: string[] }): GameHarness;
export declare function runMatch(opts?: {
  seed?: number;
  frames?: number;
  mode?: string;
  godMode?: boolean;
  steer?: (i: number, game: GameHandle) => void;
}): MatchSummary;
export declare function stateHash(game: GameHandle): string;

export interface DomStubs {
  document: Record<string, unknown>;
}

export declare function createDomStubs(): DomStubs;
export declare function createStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};
export declare function makeElement(tag?: string): unknown;
