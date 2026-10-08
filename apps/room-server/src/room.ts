/**
 * One authoritative arena = one game-core simulation + connected humans.
 *
 * M1 rules:
 *  - Humans only. No AI fish ever enter the arena.
 *  - Clients send inputs (angle + boost) only; the server owns the world.
 *  - Continuous endless arena: death shows results and offers respawn.
 *  - Disconnected players keep their fish for a grace period, then are removed.
 */
import crypto from 'node:crypto';
import { FRAME_MS, loadGame, type FishHandle, type GameHandle, type GameHarness } from '@fishio/game-core';
import type { RoomServerConfig } from './config.ts';
import {
  clamp,
  isFiniteNumber,
  normalizeAngle,
  sanitizeName,
  TICK_MS,
  type ChestState,
  type FoodState,
  type FullStateMessage,
  type LeaderRow,
  type MatchEndMessage,
  type PowerupState,
  type ServerEvent,
  type SnapshotMessage,
} from './protocol.ts';
import { signInternalBody, verifyRoomTicket } from './tickets.ts';

const SPAWN_PROTECTION_SECONDS = 3.5;

export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type PlayerRecord = {
  id: string;
  token: string;
  socket: ClientSocket | null;
  name: string;
  skinId: string;
  weaponId: string;
  hatId: string;
  upgrades: Record<string, number>;
  fish: FishHandle | null;
  alive: boolean;
  input: { seq: number; angle: number; boost: boolean };
  lastInputAt: number;
  joinedAt: number;
  disconnectedAt: number | null;
  stats: { score: number; kills: number; level: number };
  lastPos: { x: number; y: number };
  interests: number;
  // Per-connection delta tracking.
  sentFood: Map<string, string>;
  sentChests: Map<string, string>;
  sentPowerups: Map<string, string>;
  // Flood protection window.
  msgWindowStart: number;
  msgCount: number;
  /** API account this session belongs to (from a signed room ticket). */
  accountId: string | null;
  username: string | null;
};

export type JoinResult = { player: PlayerRecord } | { error: 'room_full' | 'bad_loadout' | 'shutdown' };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export class Room {
  readonly config: RoomServerConfig;
  readonly harness: GameHarness;
  readonly game: GameHandle;
  readonly mapId: string;
  readonly players = new Map<string, PlayerRecord>();

  private events: ServerEvent[] = [];
  private tickCount = 0;
  private snapshotEvery: number;
  private accumulator = 0;
  private lastReal = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private readonly upgradeCaps = new Map<string, number>();
  private readonly skins = new Set<string>();
  private readonly weapons = new Set<string>();
  private readonly hats = new Set<string>();

  constructor(config: RoomServerConfig) {
    this.config = config;
    this.snapshotEvery = Math.max(1, Math.round(config.tickRate / config.snapshotRate));

    const seed = config.seed > 0 ? config.seed : Math.floor(Math.random() * 2 ** 31);
    this.harness = loadGame({ seed });
    this.game = this.harness.createGame();
    (this.game as unknown as { targetBotCount: number }).targetBotCount = 0;

    this.game.startMatch('classic');
    this.game.player = null;
    this.game.bots = [];
    this.game.botControllers = [];
    this.game.targetBotCount = 0;
    this.game.bossTimer = Number.POSITIVE_INFINITY;

    // Headless server: no HUD, no AI gear progression, no match-bridge, no end screens.
    this.game.updateHUD = () => {};
    this.game.updateLeaderboard = () => {};
    this.game.updateBotGear = () => {};
    this.game.endGame = () => {};
    this.game.showAnnouncement = () => {};
    this.game.notifyMatchBridge = () => {};
    this.wrapKillEvents();

    const catalog = this.harness.catalog();
    for (const [id, entry] of Object.entries(catalog.upgrades ?? {})) {
      this.upgradeCaps.set(id, Math.max(0, Math.trunc(Number(entry?.maxLevel ?? 0))));
    }
    for (const id of Object.keys(catalog.fishSkins ?? {})) this.skins.add(id);
    for (const id of Object.keys(catalog.weaponSkins ?? {})) this.weapons.add(id);
    for (const id of Object.keys(catalog.fishHats ?? {})) this.hats.add(id);

    const shop = (this.game as unknown as { shop?: { selectedMap?: string } }).shop;
    this.mapId = shop?.selectedMap || Object.keys(catalog.maps ?? {})[0] || 'coral_reef';
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (this.timer) return;
    this.lastReal = performance.now();
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    const now = performance.now();
    let behind = now - this.lastReal;
    if (!Number.isFinite(behind) || behind < 0) behind = 0;
    if (behind > 250) behind = 250; // don't spiral after a stall/suspend
    this.lastReal = now;
    this.accumulator += behind;
    const maxTicks = Math.ceil(250 / TICK_MS);
    let ran = 0;
    while (this.accumulator >= TICK_MS && ran < maxTicks) {
      this.accumulator -= TICK_MS;
      ran++;
      this.tick();
    }
  }

  /** One fixed simulation step. Public so tests can drive the room deterministically. */
  tick(): void {
    this.tickCount++;
    const now = Date.now();
    this.sweepDisconnected(now);

    if (this.game.bots.length > 0) {
      try {
        this.game.update(1);
      } catch (err) {
        console.error('[room] simulation error:', err);
      }
    }

    // Detect deaths after the step (the sim removes dead fish from its arrays).
    for (const player of this.players.values()) {
      if (player.fish && player.fish.isDead) this.onDeath(player);
    }

    if (this.tickCount % 60 === 0) this.updateKing();
    if (this.tickCount % this.snapshotEvery === 0) this.sendSnapshots();
  }

  shutdown(reason = 'server_shutdown'): void {
    this.shuttingDown = true;
    this.stop();
    for (const player of this.players.values()) {
      if (!player.socket) continue;
      try {
        player.socket.send(JSON.stringify({ t: 'bye', reason }));
      } catch {
        /* ignore */
      }
      try {
        player.socket.close(1001, reason);
      } catch {
        /* ignore */
      }
      player.socket = null;
    }
    this.players.clear();
  }

  stats() {
    const alive = this.game.bots.filter((f) => !f.isDead).length;
    return {
      room: this.config.roomName,
      tick: this.tickCount,
      players: this.players.size,
      alive,
      online: [...this.players.values()].filter((p) => p.socket).length,
      maxPlayers: this.config.maxPlayers,
      uptimeTicks: this.tickCount,
    };
  }

  /** Per-player debug view for /healthz (helps verify input flow live). */
  roster() {
    const now = Date.now();
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      online: Boolean(p.socket),
      alive: p.alive,
      seq: p.input.seq,
      inputAngle: Math.round(p.input.angle * 100) / 100,
      lastInputAgoMs: now - p.lastInputAt,
      msgsThisWindow: p.msgCount,
      account: p.accountId,
      fish: p.fish
        ? {
            x: Math.round(p.fish.x),
            y: Math.round(p.fish.y),
            angle: Math.round(p.fish.angle * 1000) / 1000,
            targetAngle: Math.round(p.fish.targetAngle * 1000) / 1000,
            boosting: p.fish.isBoosting,
            stamina: Math.round(p.fish.stamina),
            level: p.fish.level,
            score: Math.round(p.fish.score),
          }
        : null,
    }));
  }

  // ---------------------------------------------------------------------- joins

  join(socket: ClientSocket, hello: Record<string, unknown>): JoinResult {
    if (this.shuttingDown) return { error: 'shutdown' };

    const skinId = typeof hello.skin === 'string' && this.skins.has(hello.skin) ? hello.skin : 'baby_shark';
    const weaponId =
      typeof hello.weapon === 'string' && this.weapons.has(hello.weapon) ? hello.weapon : 'coral_dagger';
    const hatId = typeof hello.hat === 'string' && this.hats.has(hello.hat) ? hello.hat : 'none';
    const name = sanitizeName(hello.name);
    const upgrades = this.sanitizeUpgrades(hello.upgrades);
    const vw = isFiniteNumber(hello.vw) ? clamp(hello.vw, 320, 4096) : 1280;
    const vh = isFiniteNumber(hello.vh) ? clamp(hello.vh, 320, 4096) : 720;

    // Optional signed room ticket → links this session to an API account so
    // finished matches can be recorded on-chain (M4 result intake).
    let accountId: string | null = null;
    let ticketName: string | null = null;
    if (this.config.internalHmacSecret && typeof hello.ticket === 'string' && hello.ticket) {
      const payload = verifyRoomTicket(this.config.internalHmacSecret, hello.ticket);
      if (payload) {
        accountId = payload.u;
        ticketName = payload.n || null;
      } else {
        console.warn('[room] ignoring invalid/expired room ticket');
      }
    }

    // Reconnect with a previous session token.
    if (typeof hello.token === 'string' && hello.token.length >= 8) {
      const existing = [...this.players.values()].find((p) => p.token === hello.token);
      if (existing) {
        if (existing.socket && existing.socket !== socket) {
          try {
            existing.socket.close(4004, 'replaced by new connection');
          } catch {
            /* ignore */
          }
        }
        // Rebind a fresh connection: the client restarts its sequence counter,
        // so the server must restart its ack window too.
        existing.input = { seq: 0, angle: existing.input.angle, boost: false };
        existing.lastInputAt = Date.now();
        existing.socket = socket;
        existing.disconnectedAt = null;
        if (accountId) {
          existing.accountId = accountId;
          existing.username = ticketName ?? existing.username;
        }
        existing.name = name;
        existing.skinId = skinId;
        existing.weaponId = weaponId;
        existing.hatId = hatId;
        existing.upgrades = upgrades;
        existing.interests = this.interestFor(vw, vh);
        existing.msgWindowStart = Date.now();
        existing.msgCount = 0;
        if (existing.alive && existing.fish) {
          this.send(existing, this.fullState(existing, 'welcome', true));
        } else {
          this.sendMatchEnd(existing, 'dead');
          // Also send a full state so the arena renders behind the respawn modal.
          this.send(existing, this.fullState(existing, 'spawn', false));
        }
        return { player: existing };
      }
    }

    if (this.players.size >= this.config.maxPlayers) return { error: 'room_full' };

    const player: PlayerRecord = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('base64url'),
      socket,
      name,
      skinId,
      weaponId,
      hatId,
      upgrades,
      fish: null,
      alive: false,
      input: { seq: 0, angle: 0, boost: false },
      lastInputAt: Date.now(),
      joinedAt: Date.now(),
      disconnectedAt: null,
      stats: { score: 0, kills: 0, level: 1 },
      lastPos: { x: 2000, y: 2000 },
      interests: this.interestFor(vw, vh),
      sentFood: new Map(),
      sentChests: new Map(),
      sentPowerups: new Map(),
      msgWindowStart: Date.now(),
      msgCount: 0,
      accountId,
      username: accountId ? ticketName : null,
    };
    this.players.set(player.id, player);
    this.spawnFish(player);
    this.events.push({ k: 'join', text: `${player.name} joined the arena` });

    this.send(player, this.fullState(player, 'welcome', true));
    return { player };
  }

  onMessage(player: PlayerRecord, msg: Record<string, unknown>): void {
    if (!this.players.has(player.id)) return;

    // Flood protection: simple 1-second sliding window.
    const now = Date.now();
    if (now - player.msgWindowStart > 1000) {
      player.msgWindowStart = now;
      player.msgCount = 1;
    } else {
      player.msgCount++;
      if (player.msgCount > this.config.maxMessagesPerSecond) {
        this.closeSocket(player, 4008, 'too many messages');
        return;
      }
    }

    switch (msg.t) {
      case 'input': {
        const seq = Number(msg.seq);
        if (!Number.isFinite(seq) || seq <= player.input.seq) return;
        const angle = Number(msg.a);
        if (!Number.isFinite(angle)) return;
        player.input = {
          seq: Math.trunc(seq),
          angle: normalizeAngle(angle),
          boost: msg.b === true || msg.b === 1,
        };
        player.lastInputAt = now;
        return;
      }
      case 'respawn': {
        if (player.alive) return;
        this.spawnFish(player);
        this.send(player, this.fullState(player, 'spawn', false));
        return;
      }
      case 'ping': {
        const ct = isFiniteNumber(msg.ct) ? msg.ct : 0;
        this.send(player, { t: 'pong', ct, st: Math.round(this.tickCount * TICK_MS) });
        return;
      }
      case 'leave': {
        this.removePlayer(player.id, 'left the arena');
        return;
      }
      default:
        return;
    }
  }

  onClose(player: PlayerRecord, socket: ClientSocket): void {
    if (!this.players.has(player.id)) return;
    if (player.socket !== socket) return; // stale socket replaced by a reconnect
    player.socket = null;
    player.disconnectedAt = Date.now();
  }

  // ------------------------------------------------------------------- internals

  private sanitizeUpgrades(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, cap] of this.upgradeCaps) {
      const value = (raw as Record<string, unknown>)[id];
      if (!isFiniteNumber(value)) continue;
      out[id] = clamp(Math.trunc(value), 0, cap);
    }
    return out;
  }

  private interestFor(vw: number, vh: number): number {
    return Math.min(2200, Math.hypot(vw, vh) * 0.75 + 150);
  }

  private wrapKillEvents(): void {
    const original = this.game.killFish.bind(this.game);
    this.game.killFish = (killer: FishHandle, victim: FishHandle, allFish?: FishHandle[]) => {
      const alreadyDead = Boolean(victim?.isDead);
      original(killer, victim, allFish ?? this.game.bots);
      if (!alreadyDead && victim?.isDead) {
        this.events.push({
          k: 'kill',
          by: killer?.name ?? '?',
          byId: killer?.netId,
          victim: victim.name ?? '?',
          victimId: victim.netId,
        });
      }
    };
  }

  private makeController(player: PlayerRecord) {
    return {
      update: () => {
        const fish = player.fish;
        if (!fish || fish.isDead) return;
        const idle = Date.now() - player.lastInputAt > 3000;
        if (idle) {
          fish.isBoosting = false;
          return;
        }
        fish.targetAngle = player.input.angle;
        fish.isBoosting = player.input.boost;
      },
    };
  }

  private pickSpawn(): { x: number; y: number } {
    const w = this.game.worldWidth;
    const h = this.game.worldHeight;
    let best = { x: w / 2, y: h / 2 };
    let bestDist = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = 300 + this.harness.random() * (w - 600);
      const y = 300 + this.harness.random() * (h - 600);
      let nearest = Number.POSITIVE_INFINITY;
      for (const fish of this.game.bots) {
        if (fish.isDead) continue;
        nearest = Math.min(nearest, Math.hypot(fish.x - x, fish.y - y));
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = { x, y };
      }
      if (bestDist > 1200) break;
    }
    return best;
  }

  private spawnFish(player: PlayerRecord): void {
    const pos = this.pickSpawn();
    const fish = this.harness.createFish({
      x: pos.x,
      y: pos.y,
      name: player.name,
      skinId: player.skinId,
      weaponId: player.weaponId,
      hatId: player.hatId,
    });
    fish.netId = player.id;
    fish.applyWorkshopUpgrades(player.upgrades);
    // Spawn protection, same as offline practice. Landing a hit clears it
    // (handled in the shared collision code), so it can't be abused to farm.
    fish.invulnerableTimer = SPAWN_PROTECTION_SECONDS;

    this.game.bots.push(fish);
    this.game.botControllers.push(this.makeController(player));
    player.fish = fish;
    player.alive = true;
    player.lastPos = { x: pos.x, y: pos.y };
    player.input = { seq: player.input.seq, angle: fish.angle, boost: false };
    player.stats = { score: 0, kills: 0, level: fish.level };
    player.sentFood.clear();
    player.sentChests.clear();
    player.sentPowerups.clear();
  }

  private removeFishFromWorld(fish: FishHandle | null): void {
    if (!fish) return;
    const index = this.game.bots.indexOf(fish);
    if (index !== -1) {
      this.game.bots.splice(index, 1);
      // game.botControllers must stay index-aligned with game.bots.
      if (index < this.game.botControllers.length) this.game.botControllers.splice(index, 1);
    }
  }

  private onDeath(player: PlayerRecord): void {
    const fish = player.fish;
    if (fish) {
      player.stats = {
        score: Math.round(fish.score),
        kills: fish.kills,
        level: fish.level,
      };
    }
    player.fish = null;
    player.alive = false;
    this.sendMatchEnd(player, 'dead');
    // Server-authored result intake (only for sessions with a signed ticket).
    void this.reportMatch(player);
  }

  /**
   * Post a finished online match to the API (`/internal/matches`, HMAC-signed).
   * Stats come from the authoritative simulation. Runs after match_end was
   * already sent so the death UX never blocks; the API's reply arrives as a
   * follow-up `match_receipt` message.
   */
  private async reportMatch(player: PlayerRecord): Promise<void> {
    const { apiUrl, internalHmacSecret, reportTimeoutMs } = this.config;
    if (!player.accountId || !apiUrl || !internalHmacSecret) return;

    const body = JSON.stringify({
      userId: player.accountId,
      stats: {
        mode: 'classic',
        score: Math.max(0, Math.round(player.stats.score)),
        kills: Math.max(0, Math.round(player.stats.kills)),
        level: Math.max(1, Math.round(player.stats.level)),
        food: 0,
        chests: 0,
        kingTime: 0,
        durationMs: Math.max(0, Math.round(this.game.matchTime * 1000)),
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), reportTimeoutMs);
    try {
      const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/internal/matches`, {
        method: 'POST',
        headers: {
          'content-type': 'application/vnd.fishio.intake+json',
          'x-fishio-signature': signInternalBody(internalHmacSecret, body),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[room] match report rejected (${res.status}) for ${player.username ?? player.name}`);
        return;
      }
      const payload = (await res.json()) as {
        matchId?: string;
        reward?: { amount: number; dailyRemaining?: number };
        receipt?: Record<string, unknown>;
      };
      this.send(player, {
        t: 'match_receipt',
        matchId: payload.matchId ?? null,
        reward: payload.reward ?? null,
        receipt: payload.receipt ?? null,
      });
    } catch (err) {
      console.warn('[room] match report failed:', (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  private sendMatchEnd(player: PlayerRecord, reason: MatchEndMessage['reason']): void {
    const message: MatchEndMessage = {
      t: 'match_end',
      reason,
      stats: { ...player.stats, time: Math.round(this.game.matchTime) },
    };
    this.send(player, message);
  }

  private removePlayer(id: string, reason: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.removeFishFromWorld(player.fish);
    this.players.delete(id);
    this.events.push({ k: 'leave', text: `${player.name} ${reason}` });
    if (player.socket) this.closeSocket(player, 1000, 'left');
  }

  private sweepDisconnected(now: number): void {
    for (const player of this.players.values()) {
      if (player.socket || !player.disconnectedAt) continue;
      if (now - player.disconnectedAt > this.config.reconnectGraceMs) {
        this.removePlayer(player.id, 'was removed (disconnected)');
      }
    }
  }

  private closeSocket(player: PlayerRecord, code: number, reason: string): void {
    const socket = player.socket;
    player.socket = null;
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {
      /* ignore */
    }
  }

  private send(player: PlayerRecord, message: unknown): void {
    if (!player.socket) return;
    try {
      player.socket.send(JSON.stringify(message));
    } catch {
      /* socket died; onClose will clean up */
    }
  }

  // --------------------------------------------------------------------- states

  private stateFor(fish: FishHandle, withStamina: boolean) {
    const state = {
      id: fish.netId ?? fish.id,
      n: fish.name,
      sk: fish.skinId,
      w: fish.weaponId,
      h: fish.hatId,
      x: r2(fish.x),
      y: r2(fish.y),
      a: Math.round(fish.angle * 1000) / 1000,
      r: r1(fish.radius),
      lv: fish.level,
      sc: Math.round(fish.score),
      k: fish.kills,
      b: (fish.isBoosting ? 1 : 0) as 0 | 1,
      sh: (fish.hasShield ? 1 : 0) as 0 | 1,
      kg: (fish.isKing ? 1 : 0) as 0 | 1,
      iv: (fish.invulnerableTimer > 0 ? 1 : 0) as 0 | 1,
    };
    return withStamina ? { ...state, st: Math.round(fish.stamina) } : state;
  }

  private foodState(f: { id: string; x: number; y: number; radius: number; type: string; xp: number; gold: number; isMeat: boolean }): FoodState {
    return { id: f.id, x: r1(f.x), y: r1(f.y), r: r1(f.radius), ty: f.type, xp: f.xp, g: f.gold, m: f.isMeat ? 1 : 0 };
  }

  private chestState(c: { id: string; x: number; y: number; radius: number; hp: number; maxHp: number }): ChestState {
    return { id: c.id, x: r1(c.x), y: r1(c.y), r: r1(c.radius), hp: c.hp, mx: c.maxHp };
  }

  private powerupState(p: { id: string; x: number; y: number; radius: number; type: string }): PowerupState {
    return { id: p.id, x: r1(p.x), y: r1(p.y), r: r1(p.radius), ty: p.type };
  }

  private leaderboard(): LeaderRow[] {
    return [...this.game.bots]
      .filter((f) => !f.isDead)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((f) => ({ id: f.netId ?? f.id, n: f.name, sc: Math.round(f.score), lv: f.level }));
  }

  private updateKing(): void {
    const alive = [...this.game.bots].filter((f) => !f.isDead).sort((a, b) => b.score - a.score);
    for (let i = 0; i < alive.length; i++) {
      const fish = alive[i];
      if (!fish) continue;
      fish.isKing = i === 0 && fish.score > 100;
    }
  }

  /** Delta-encoded nearby entities for one player. */
  private collectNearby(player: PlayerRecord): SnapshotMessage['add'] & { del: SnapshotMessage['del'] } {
    const px = player.lastPos.x;
    const py = player.lastPos.y;
    const radiusSq = player.interests * player.interests;

    const add: SnapshotMessage['add'] = {};
    const del: SnapshotMessage['del'] = {};

    const seenFood = new Set<string>();
    const foodOut: FoodState[] = [];
    for (const f of this.game.foodManager.foods) {
      const dx = f.x - px;
      if (dx * dx > radiusSq) continue;
      const dy = f.y - py;
      if (dy * dy > radiusSq) continue;
      if (dx * dx + dy * dy > radiusSq) continue;
      seenFood.add(f.id);
      const sig = `${Math.round(f.x)},${Math.round(f.y)}`;
      if (player.sentFood.get(f.id) !== sig) {
        player.sentFood.set(f.id, sig);
        foodOut.push(this.foodState(f));
      }
    }
    if (foodOut.length) add.food = foodOut;
    const delFood: string[] = [];
    for (const id of player.sentFood.keys()) {
      if (!seenFood.has(id)) {
        player.sentFood.delete(id);
        delFood.push(id);
      }
    }
    if (delFood.length) del.food = delFood;

    const seenChests = new Set<string>();
    const chestOut: ChestState[] = [];
    for (const c of this.game.foodManager.chests) {
      const dx = c.x - px;
      if (dx * dx > radiusSq) continue;
      const dy = c.y - py;
      if (dx * dx + dy * dy > radiusSq) continue;
      seenChests.add(c.id);
      const sig = `${c.hp}`;
      if (player.sentChests.get(c.id) !== sig) {
        player.sentChests.set(c.id, sig);
        chestOut.push(this.chestState(c));
      }
    }
    if (chestOut.length) add.chests = chestOut;
    const delChests: string[] = [];
    for (const id of player.sentChests.keys()) {
      if (!seenChests.has(id)) {
        player.sentChests.delete(id);
        delChests.push(id);
      }
    }
    if (delChests.length) del.chests = delChests;

    const seenPowerups = new Set<string>();
    const powerupOut: PowerupState[] = [];
    for (const p of this.game.foodManager.powerups) {
      const dx = p.x - px;
      if (dx * dx > radiusSq) continue;
      const dy = p.y - py;
      if (dx * dx + dy * dy > radiusSq) continue;
      seenPowerups.add(p.id);
      if (!player.sentPowerups.has(p.id)) {
        player.sentPowerups.set(p.id, '1');
        powerupOut.push(this.powerupState(p));
      }
    }
    if (powerupOut.length) add.powerups = powerupOut;
    const delPowerups: string[] = [];
    for (const id of player.sentPowerups.keys()) {
      if (!seenPowerups.has(id)) {
        player.sentPowerups.delete(id);
        delPowerups.push(id);
      }
    }
    if (delPowerups.length) del.powerups = delPowerups;

    return { ...add, del };
  }

  private sendSnapshots(): void {
    const tick = this.tickCount;
    const time = Math.round(tick * TICK_MS);
    const events = this.events.splice(0, this.events.length);
    const alive = this.game.bots.filter((f) => !f.isDead);
    const states = alive.map((f) => this.stateFor(f, false));
    const lbDue = tick % (this.snapshotEvery * 4) === 0;
    const lb = lbDue ? this.leaderboard() : null;

    for (const player of this.players.values()) {
      if (!player.socket) continue;
      if (player.fish && !player.fish.isDead) {
        player.lastPos = { x: player.fish.x, y: player.fish.y };
      }
      const you = player.fish && !player.fish.isDead ? this.stateFor(player.fish, true) : null;
      const nearby = this.collectNearby(player);
      const message: SnapshotMessage = {
        t: 'snap',
        tick,
        time,
        ack: player.input.seq,
        you,
        p: states,
        add: {
          ...(nearby.food ? { food: nearby.food } : {}),
          ...(nearby.chests ? { chests: nearby.chests } : {}),
          ...(nearby.powerups ? { powerups: nearby.powerups } : {}),
        },
        del: nearby.del,
      };
      if (events.length) message.ev = events;
      if (lb) message.lb = lb;
      this.send(player, message);
    }
  }

  private fullState(player: PlayerRecord, type: 'welcome' | 'spawn', includeToken: boolean): FullStateMessage {
    const alive = this.game.bots.filter((f) => !f.isDead);
    const state: FullStateMessage = {
      t: type,
      v: 1,
      id: player.id,
      tick: this.tickCount,
      time: Math.round(this.tickCount * TICK_MS),
      map: this.mapId,
      world: { w: this.game.worldWidth, h: this.game.worldHeight },
      config: { tickMs: FRAME_MS, snapshotEvery: this.snapshotEvery, maxPlayers: this.config.maxPlayers },
      you: player.fish && !player.fish.isDead ? this.stateFor(player.fish, true) : null,
      p: alive.map((f) => this.stateFor(f, false)),
      food: [],
      chests: [],
      powerups: [],
      lb: this.leaderboard(),
    };
    if (includeToken) state.token = player.token;

    // Fill the nearby lists and seed the delta trackers.
    player.sentFood.clear();
    player.sentChests.clear();
    player.sentPowerups.clear();
    const px = player.lastPos.x;
    const py = player.lastPos.y;
    const radiusSq = player.interests * player.interests;
    for (const f of this.game.foodManager.foods) {
      if ((f.x - px) ** 2 + (f.y - py) ** 2 > radiusSq) continue;
      state.food.push(this.foodState(f));
      player.sentFood.set(f.id, `${Math.round(f.x)},${Math.round(f.y)}`);
    }
    for (const c of this.game.foodManager.chests) {
      if ((c.x - px) ** 2 + (c.y - py) ** 2 > radiusSq) continue;
      state.chests.push(this.chestState(c));
      player.sentChests.set(c.id, `${c.hp}`);
    }
    for (const p of this.game.foodManager.powerups) {
      if ((p.x - px) ** 2 + (p.y - py) ** 2 > radiusSq) continue;
      state.powerups.push(this.powerupState(p));
      player.sentPowerups.set(p.id, '1');
    }
    return state;
  }
}
