import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch, loadGame, stateHash } from '../src/index.js';

test('catalog export exposes the real weapon/fish tier data', () => {
  const h = loadGame({ seed: 1, scripts: ['shop.js'] });
  const cat = h.catalog();
  assert.ok(Object.keys(cat.weaponSkins).length >= 14, 'weapon skins');
  assert.ok(Object.keys(cat.fishSkins).length >= 16, 'fish skins');
  assert.equal(cat.weaponTiers.length, 5, 'five weapon tiers');
  assert.equal(cat.fishTiers.length, 5, 'five fish tiers');
  assert.ok(cat.weaponTiers[0].includes('coral_dagger'), 'starter blade in tier 0');
  assert.ok(cat.weaponTiers[4].includes('dragon_horn'), 'dragon horn in tier 4');
});

test('same seed produces an identical simulation', () => {
  const a = runMatch({ seed: 7, frames: 600 });
  const b = runMatch({ seed: 7, frames: 600 });
  assert.equal(a.hash, b.hash, 'state hash must match for same seed');
  assert.deepEqual(a.player, b.player, 'player snapshot must match');
});

test('different seeds diverge', () => {
  const a = runMatch({ seed: 1, frames: 600 });
  const b = runMatch({ seed: 2, frames: 600 });
  assert.notEqual(a.hash, b.hash, 'different seeds must produce different worlds');
});

test('a long match runs headless with sane state and speed', () => {
  // NOTE: vm-context overhead keeps this at ~7 ms/frame today; the M1/M2 extraction into
  // real ES modules is expected to bring it below 1 ms/frame. Threshold kept honest.
  const r = runMatch({ seed: 99, frames: 3600, godMode: true });
  assert.equal(r.gameState, 'playing');
  assert.ok(r.player, 'player exists');
  assert.ok(r.player.x >= 0 && r.player.x <= 4000, 'player x in world');
  assert.ok(r.player.y >= 0 && r.player.y <= 4000, 'player y in world');
  assert.ok(Number.isFinite(r.player.score), 'score finite');
  assert.ok(r.bots >= 0 && r.bots <= 40, 'bot count sane');
  assert.ok(r.msPerFrame < 15, `sim too slow: ${r.msPerFrame} ms/frame`);
});

test('god mode player survives the full match', () => {
  const r = runMatch({ seed: 5, frames: 1800, godMode: true });
  assert.equal(r.player.dead, false, 'invincible player must not die');
  assert.ok(r.matchKills >= 0);
  assert.ok(typeof r.hash === 'string' && r.hash.length === 40, 'hash is a sha1 hex digest');
});

test('bot gear is gated by match progression (tier system)', () => {
  const h = loadGame({ seed: 11 });
  const g = h.createGame();
  const cat = h.catalog();
  const tierOf = (id) => {
    const i = cat.weaponTiers.findIndex((t) => t.includes(id));
    return i < 0 ? 0 : i;
  };

  g.startMatch('classic');
  const earlyTiers = g.bots.map((b) => tierOf(b.weaponId));
  assert.ok(earlyTiers.every((t) => t === 0), 'all bots must start with tier-0 gear');

  g.player.invulnerableTimer = 1e9;
  g.player.addXP(500000, g.particles, g.soundEngine); // jump to a high level
  g.matchTime = 200;                                   // late in the match
  h.advance(600, undefined, g);

  assert.ok(g.getMaxBotTier() >= 3, `late-game tier cap should be >= 3, got ${g.getMaxBotTier()}`);
  assert.ok(g.bots.some((b) => tierOf(b.weaponId) > 1), 'some bots must upgrade to higher tiers');
});

test('stateHash is stable for a loaded context', () => {
  const h = loadGame({ seed: 3 });
  const g = h.createGame();
  g.startMatch('classic');
  h.advance(300, undefined, g);
  const first = stateHash(g);
  const second = stateHash(g);
  assert.equal(first, second);
});
