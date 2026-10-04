#!/usr/bin/env node
/**
 * Runs a full match headless and prints a summary.
 * Usage:
 *   node bin/sim.js                       # 5-minute classic match, seed 42
 *   FRAMES=3600 SEED=7 MODE=frenzy node bin/sim.js
 *   GOD=0 node bin/sim.js                 # player vulnerable (dies like a mortal)
 */
import { runMatch } from '../src/index.js';

const frames = Number(process.env.FRAMES || 18000);
const seed = Number(process.env.SEED || 42);
const mode = process.env.MODE || 'classic';
const godMode = process.env.GOD !== '0';

console.log(`[sim] mode=${mode} frames=${frames} (~${(frames / 3600).toFixed(1)} min) seed=${seed} god=${godMode}`);
const t0 = performance.now();
const out = runMatch({ seed, frames, mode, godMode });
const wall = performance.now() - t0;

console.log(JSON.stringify(out, null, 2));
console.log(`[sim] wall time: ${Math.round(wall)} ms (${(frames / (wall / 1000)).toFixed(0)} sim frames/sec)`);
