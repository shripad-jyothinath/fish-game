/**
 * M1 wire protocol — JSON over WebSocket.
 *
 * Clients only ever send: hello, input, respawn, ping, leave.
 * The server is authoritative for all positions, kills and pickups.
 * (Binary packing lands in M2; JSON keeps the prototype inspectable.)
 */

export const PROTOCOL_VERSION = 1;

/** Milliseconds per simulation frame (game-core's dt unit). */
export const TICK_MS = 1000 / 60;

/** Show a join/leave/system line in the client's kill banner. */
export interface ServerEvent {
  k: 'kill' | 'join' | 'leave';
  by?: string;
  byId?: string;
  victim?: string;
  victimId?: string;
  text?: string;
}

export interface HelloMessage {
  t: 'hello';
  name?: unknown;
  skin?: unknown;
  weapon?: unknown;
  hat?: unknown;
  upgrades?: unknown;
  vw?: unknown;
  vh?: unknown;
  token?: unknown;
}

export interface InputMessage {
  t: 'input';
  seq?: unknown;
  /** target angle, radians */
  a?: unknown;
  /** boosting request */
  b?: unknown;
}

export type ClientMessage =
  | HelloMessage
  | InputMessage
  | { t: 'respawn' }
  | { t: 'ping'; ct?: unknown }
  | { t: 'leave' }
  | { t: string; [key: string]: unknown };

/** Fish state as rendered by clients. Keep field names short (this is hot data). */
export interface FishState {
  id: string;
  n: string;
  sk: string;
  w: string;
  h: string;
  x: number;
  y: number;
  a: number;
  r: number;
  lv: number;
  sc: number;
  k: number;
  b: 0 | 1;
  sh: 0 | 1;
  kg: 0 | 1;
  iv: 0 | 1;
  st?: number;
}

export interface FoodState {
  id: string;
  x: number;
  y: number;
  r: number;
  ty: string;
  xp: number;
  g: number;
  m: 0 | 1;
}

export interface ChestState {
  id: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  mx: number;
}

export interface PowerupState {
  id: string;
  x: number;
  y: number;
  r: number;
  ty: string;
}

export interface LeaderRow {
  id: string;
  n: string;
  sc: number;
  lv: number;
}

export interface WorldSize {
  w: number;
  h: number;
}

export interface SnapshotMessage {
  t: 'snap';
  tick: number;
  time: number;
  ack: number;
  you: FishState | null;
  p: FishState[];
  add: { food?: FoodState[]; chests?: ChestState[]; powerups?: PowerupState[] };
  del: { food?: string[]; chests?: string[]; powerups?: string[] };
  ev?: ServerEvent[];
  lb?: LeaderRow[];
}

export interface FullStateMessage {
  t: 'welcome' | 'spawn';
  v: number;
  id: string;
  token?: string;
  tick: number;
  time: number;
  map: string;
  world: WorldSize;
  config: { tickMs: number; snapshotEvery: number; maxPlayers: number };
  you: FishState | null;
  p: FishState[];
  food: FoodState[];
  chests: ChestState[];
  powerups: PowerupState[];
  lb: LeaderRow[];
}

export interface MatchEndMessage {
  t: 'match_end';
  reason: 'dead' | 'server_shutdown' | 'removed';
  stats: { score: number; kills: number; level: number; time: number };
}

export interface PongMessage {
  t: 'pong';
  ct: number;
  st: number;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function sanitizeName(raw: unknown, fallback = 'Player'): string {
  if (typeof raw !== 'string') return fallback;
  // Strip control characters, collapse whitespace, cap length.
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return Array.from(clean).slice(0, 16).join('');
}

/** Normalize an angle to (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
