#!/usr/bin/env node
/**
 * Per-frame profiler for the headless sim. Prints counters so we can find
 * unbounded arrays / hot loops before touching the game code.
 *
 *   node bin/profile.js             # 2400 frames
 *   FRAMES=600 node bin/profile.js
 */
import { loadGame } from '../src/index.js';

const N = Number(process.env.FRAMES || 2400);
const h = loadGame({ seed: 42 });
const game = h.createGame();
game.startMatch('classic');
game.player.invulnerableTimer = 1e9;

let sum = 0;
let max = 0;
const t0 = performance.now();

for (let i = 0; i < N; i++) {
  const a = (i / 240) * Math.PI * 2;
  game.mousePos.x = 640 + Math.cos(a) * 300;
  game.mousePos.y = 360 + Math.sin(a) * 300;
  game.player.isBoosting = (i % 300) < 40;

  const s = performance.now();
  game.update(1);
  const dt = performance.now() - s;
  sum += dt;
  if (dt > max) max = dt;

  if (i % 200 === 0 || i === N - 1) {
    console.log(
      `frame ${String(i).padStart(5)}  update=${dt.toFixed(2)}ms  avg=${(sum / (i + 1)).toFixed(2)}ms  ` +
      `particles=${game.particles.particles.length} texts=${game.particles.floatingTexts.length} ` +
      `shock=${game.particles.shockwaves.length} bubbles=${game.particles.ambientBubbles.length} ` +
      `foods=${game.foodManager.foods.length} powerups=${game.foodManager.powerups.length} ` +
      `chests=${game.foodManager.chests.length} bots=${game.bots.length} ` +
      `timers=${h.pendingTimers()} state=${game.gameState}`
    );
  }
}

const wall = performance.now() - t0;
console.log(`\n${N} frames in ${Math.round(wall)}ms — avg ${(sum / N).toFixed(3)} ms/frame, max ${max.toFixed(2)}ms (${(N / (wall / 1000)).toFixed(0)} fps)`);
