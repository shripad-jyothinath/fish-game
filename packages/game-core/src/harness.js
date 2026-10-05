/**
 * Headless loader for the real game scripts.
 * Runs apps/web/src/*.js inside a Node vm with DOM stubs and a seeded RNG,
 * so the exact same simulation code that runs in the browser runs on a server.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDomStubs, createStorage } from './dom-stubs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(__dirname, '../../../apps/web/src');

export const GAME_SCRIPTS = [
  'audio.js',
  'particles.js',
  'food.js',
  'shop.js',
  'entities.js',
  'ai.js',
  'game.js',
];

export const FRAME_MS = 1000 / 60;

function seededRandomSource(seed) {
  return `(() => {
    let s = ${seed >>> 0};
    Math.random = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();`;
}

const BOOTSTRAP = `
// Headless: audio is a no-op (no AudioContext in Node, avoids warn + synthesis overhead).
if (typeof SoundEngine !== 'undefined') SoundEngine.prototype.init = function () {};
globalThis.__fishHarness = {
  createGame() { return new GameEngine(); },
  // Server-side helper: create a Fish that is NOT an AI bot (human players).
  createFish(x, y, name, skinId, weaponId, hatId) {
    return new Fish(x, y, name, skinId, weaponId, false, hatId || 'none');
  },
  random() { return Math.random(); },
  catalog() {
    return {
      maps: FISH_MAPS,
      fishSkins: FISH_SKINS,
      weaponSkins: WEAPON_SKINS,
      fishHats: FISH_HATS,
      upgrades: WORKSHOP_UPGRADES,
      levelChallenges: LEVEL_CHALLENGES,
      weaponTiers: WEAPON_TIERS,
      fishTiers: FISH_TIERS,
      tierNames: GEAR_TIER_NAMES,
    };
  },
};`;

/**
 * Load the game in a fresh vm context.
 * @param {{ seed?: number, scripts?: string[] }} [options]
 */
export function loadGame(options = {}) {
  const { seed = 1, scripts = GAME_SCRIPTS } = options;

  const clock = { now: 0 };
  const timers = [];
  let nextTimerId = 1;
  const rafCallbacks = [];

  const { document } = createDomStubs();

  const sandbox = {
    console,
    document,
    localStorage: createStorage(),
    performance: { now: () => clock.now },
    navigator: { userAgent: 'fishio-game-core/headless', language: 'en' },
    location: { href: 'http://localhost/', search: '' },
    // Timers are virtual so simulation timing is deterministic.
    setTimeout(fn, ms = 0, ...args) {
      const id = nextTimerId++;
      timers.push({ id, due: clock.now + Number(ms || 0), fn, args, every: null });
      return id;
    },
    setInterval(fn, ms = 0, ...args) {
      const id = nextTimerId++;
      timers.push({ id, due: clock.now + Number(ms || 0), fn, args, every: Math.max(1, Number(ms || 1)) });
      return id;
    },
    clearTimeout(id) { removeTimer(id); },
    clearInterval(id) { removeTimer(id); },
    requestAnimationFrame(cb) { rafCallbacks.push(cb); return rafCallbacks.length; },
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  function removeTimer(id) {
    const i = timers.findIndex((t) => t.id === id);
    if (i !== -1) timers.splice(i, 1);
  }

  const context = vm.createContext(sandbox);
  vm.runInContext(seededRandomSource(seed), context, { filename: 'prelude:rng.js' });

  for (const file of scripts) {
    const full = path.join(WEB_SRC, file);
    const code = fs.readFileSync(full, 'utf8');
    vm.runInContext(code, context, { filename: file });
  }

  vm.runInContext(BOOTSTRAP, context, { filename: 'prelude:harness.js' });

  const bridge = context.__fishHarness;

  function runDueTimers() {
    // Fire timers in due order; cap work to avoid runaway intervals.
    let guard = 1000;
    for (;;) {
      let next = null;
      for (const t of timers) if (t.due <= clock.now && (!next || t.due < next.due)) next = t;
      if (!next || guard-- <= 0) break;
      if (next.every == null) removeTimer(next.id);
      else next.due = clock.now + next.every;
      try {
        next.fn(...next.args);
      } catch (err) {
        console.error('[game-core] timer error:', err);
      }
    }
  }

  return {
    context,
    clock,
    timers,
    get game() { return bridge.__game; },

    createGame() {
      const game = bridge.createGame();
      // No DOM in headless mode: strip UI-only methods (server has no HUD).
      game.updateHUD = () => {};
      game.renderMinimap = () => {};
      game.render = () => {};
      bridge.__game = game;
      return game;
    },

    /** Create a human (non-AI) fish inside the game context. */
    createFish({ x, y, name, skinId, weaponId, hatId = 'none' }) {
      return bridge.createFish(x, y, name, skinId, weaponId, hatId);
    },

    /** Seeded RNG from the game context, so server spawns stay reproducible. */
    random() {
      return bridge.random();
    },

    catalog() {
      return bridge.catalog();
    },

    /** Advance the simulation by N fixed 60 Hz frames. */
    advance(frames, onFrame, game = bridge.__game) {
      for (let i = 0; i < frames; i++) {
        clock.now += FRAME_MS;
        if (onFrame) onFrame(i, game);
        game.update(1);
        runDueTimers();
      }
    },

    runDueTimers,
    pendingTimers: () => timers.length,
  };
}

/** Stable fingerprint of simulation state, used by determinism tests. */
export function stateHash(game) {
  const r = (n) => Math.round(n * 1000) / 1000;
  const parts = [
    game.matchTime.toFixed(3),
    game.gameState,
    r(game.player?.x ?? 0), r(game.player?.y ?? 0),
    game.player?.level ?? 0, game.player?.score ?? 0,
    game.matchKills, game.bots.length,
  ];
  for (const b of game.bots.slice(0, 10)) {
    parts.push(b.name, r(b.x), r(b.y), r(b.radius ?? 0), b.level ?? 0);
  }
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

/**
 * Run one classic match headless.
 * @param {{ seed?: number, frames?: number, mode?: string, godMode?: boolean, steer?: Function }} [opts]
 */
export function runMatch(opts = {}) {
  const { seed = 1, frames = 18000, mode = 'classic', godMode = false, steer } = opts;
  const h = loadGame({ seed });
  const game = h.createGame();
  game.startMatch(mode);
  if (godMode && game.player) game.player.invulnerableTimer = 1e9;

  const cx = 640, cy = 360;
  const t0 = performance.now();
  h.advance(frames, (i, g) => {
    if (!g.player || g.player.isDead) return;
    if (steer) { steer(i, g); return; }
    // Default input: gentle circular steering, like a real player swimming around.
    const a = (i / 240) * Math.PI * 2;
    g.mousePos.x = cx + Math.cos(a) * 300;
    g.mousePos.y = cy + Math.sin(a) * 300;
    g.player.isBoosting = (i % 300) < 40; // boost in short bursts
  }, game);
  const ms = performance.now() - t0;

  return {
    seed, frames, mode,
    ms: Math.round(ms),
    msPerFrame: +(ms / frames).toFixed(4),
    gameState: game.gameState,
    matchTime: +game.matchTime.toFixed(2),
    bots: game.bots.length,
    foods: game.foodManager.foods.length,
    powerups: game.foodManager.powerups.length,
    chests: game.foodManager.chests.length,
    pendingTimers: h.pendingTimers(),
    player: game.player ? {
      x: Math.round(game.player.x), y: Math.round(game.player.y),
      level: game.player.level, score: game.player.score,
      kills: game.player.kills, dead: game.player.isDead,
      weapon: game.player.weaponId, skin: game.player.skinId,
    } : null,
    matchKills: game.matchKills,
    matchGold: game.matchGold,
    hash: stateHash(game),
  };
}
