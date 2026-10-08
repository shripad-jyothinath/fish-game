import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch, loadGame, stateHash } from '../src/index.js';

test('catalog export exposes the real weapon/fish tier data', () => {
  const h = loadGame({ seed: 1, scripts: ['shop.js'] });
  const cat = h.catalog();
  assert.ok(Object.keys(cat.weaponSkins).length >= 25, 'weapon skins');
  assert.ok(Object.keys(cat.fishSkins).length >= 16, 'fish skins');
  assert.equal(cat.weaponTiers.length, 5, 'five weapon tiers');
  assert.equal(cat.fishTiers.length, 5, 'five fish tiers');
  assert.ok(cat.weaponTiers[0].includes('coral_dagger'), 'starter blade in tier 0');
  assert.deepEqual(
    [...cat.weaponTiers[0]].sort(),
    ['coral_dagger', 'iron_cutlass', 'wooden_spear'],
    'tier 0 stays starter-only (explicit tiers survive shop growth)',
  );
  assert.ok(cat.weaponTiers[4].includes('dragon_horn'), 'dragon horn in tier 4');
  assert.ok(cat.weaponTiers[4].includes('meteor_maul'), 'new apex weapon lands in tier 4');
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
  // Perf guard, not a benchmark: the absolute number depends heavily on the machine
  // (historical: ~7 ms/frame on Node 24; this box runs even the M0 baseline at
  // ~21 ms/frame because of Node vm-context overhead — see the ADR follow-up plan
  // to extract entities/ai into real ES modules). Override with SIM_PERF_MS_LIMIT.
  const r = runMatch({ seed: 99, frames: 3600, godMode: true });
  assert.equal(r.gameState, 'playing');
  assert.ok(r.player, 'player exists');
  assert.ok(r.player.x >= 0 && r.player.x <= 4000, 'player x in world');
  assert.ok(r.player.y >= 0 && r.player.y <= 4000, 'player y in world');
  assert.ok(Number.isFinite(r.player.score), 'score finite');
  assert.ok(r.bots >= 0 && r.bots <= 40, 'bot count sane');
  assert.ok(r.matchKills < 1000, 'kill count sane (no runaway combat loop)');
  const msLimit = Number(process.env.SIM_PERF_MS_LIMIT || 30);
  assert.ok(r.msPerFrame < msLimit, `sim too slow: ${r.msPerFrame} ms/frame (limit ${msLimit})`);
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

test('challenge difficulty scales enemy gear, level and aggression with the shop', () => {
  const tierOf = (h, id) => {
    const i = h.catalog().weaponTiers.findIndex((t) => t.includes(id));
    return i < 0 ? 0 : i;
  };

  const h1 = loadGame({ seed: 21 });
  const g1 = h1.createGame();
  g1.startLevelChallenge(1);
  const earlyBots = g1.bots.filter((b) => !b.isBoss);
  assert.ok(earlyBots.length > 0, 'stage 1 spawns bots');
  assert.ok(earlyBots.every((b) => tierOf(h1, b.weaponId) === 0), 'stage 1 bots use starter gear');
  assert.ok(earlyBots.every((b) => b.level === 1), 'stage 1 bots start at level 1');
  assert.ok(g1.botControllers.every((c) => c.difficulty === 0), 'stage 1 bots keep classic behavior');

  const h2 = loadGame({ seed: 22 });
  const g2 = h2.createGame();
  g2.startLevelChallenge(15);
  const lateBots = g2.bots.filter((b) => !b.isBoss);
  assert.equal(Math.max(...lateBots.map((b) => tierOf(h2, b.weaponId))), 4, 'stage 15 bots reach tier 4');
  assert.ok(lateBots.every((b) => b.level >= 8), 'stage 15 bots start near max level');
  assert.ok(g2.bossFish && g2.bossFish.level >= 8, 'final boss level scales');
  assert.equal(tierOf(h2, g2.bossFish.weaponId), 4, 'final boss uses a tier-4 blade');
  assert.ok(g2.botControllers.every((c) => c.difficulty >= 0.9), 'late-stage bots are aggressive');

  const h3 = loadGame({ seed: 23 });
  const g3 = h3.createGame();
  g3.startLevelChallenge(10);
  assert.equal(tierOf(h3, g3.bossFish.weaponId), 3, 'stage-10 boss upgrades to its stage tier');
  assert.equal(g3.bossFish.bossRewardGold, 3500, 'stage-10 boss bounty scales');
});

test('challenge rewards scale strictly with stage', () => {
  const h = loadGame({ seed: 1, scripts: ['shop.js'] });
  const stages = h.catalog().levelChallenges;
  assert.equal(stages.length, 15, 'fifteen stages');
  for (let i = 1; i < stages.length; i++) {
    assert.ok(stages[i].reward > stages[i - 1].reward, `reward must grow at stage ${stages[i].level}`);
  }
  assert.ok(stages[14].reward >= 9000, 'final stage pays endgame money');
  const total = stages.reduce((sum, s) => sum + s.reward, 0);
  assert.ok(total > 40000, `total stage rewards should fund shop progression, got ${total}`);
});

test('gold drops scale with the collector level', () => {
  const h = loadGame({ seed: 41 });
  const g = h.createGame();
  g.startMatch('classic');
  g.foodManager.foods.length = 0;
  g.foodManager.chests.length = 0;
  g.foodManager.powerups.length = 0;

  const coinAtMouth = () => ({
    id: Math.random().toString(36).slice(2),
    x: g.player.bladeBase.x,
    y: g.player.bladeBase.y,
    vx: 0, vy: 0,
    radius: 7.5, baseRadius: 7.5,
    type: 'gold_coin',
    xp: 3,
    gold: 10,
    rotation: 0, rotSpeed: 0, swayPhase: 0,
    isMeat: false,
  });

  g.foodManager.foods.push(coinAtMouth());
  const before1 = g.matchGold;
  g.handleCollisions([g.player]);
  const gain1 = g.matchGold - before1;

  g.player.addXP(500000, g.particles, g.soundEngine); // jump to a high level
  g.foodManager.foods.push(coinAtMouth());
  const before2 = g.matchGold;
  g.handleCollisions([g.player]);
  const gain2 = g.matchGold - before2;

  assert.equal(gain1, 10, 'level 1 collects the base value');
  assert.ok(gain2 > gain1, `higher level collects more per drop (${gain1} → ${gain2})`);
});

test('kill rewards scale with the killer level', () => {
  const h = loadGame({ seed: 43 });
  const g = h.createGame();
  g.startMatch('classic');
  g.player.invulnerableTimer = 1e9;

  const killOne = () => {
    const victim = g.bots.find((b) => !b.isDead);
    victim.level = 1;
    const before = g.matchGold;
    g.killFish(g.player, victim, g.bots);
    return g.matchGold - before;
  };

  const gain1 = killOne();
  g.player.addXP(500000, g.particles, g.soundEngine); // jump to a high level
  const gain2 = killOne();

  // Note: a kill's XP is applied before its gold, so the first kill already
  // pays the level-2 rate (24 × 1.08 ≈ 26). Assert the trend, not the exact number.
  assert.equal(gain1 >= 24, true, `level-1 kill pays at least the base bounty (${gain1})`);
  assert.ok(gain2 > gain1 * 2, `high-level kills pay substantially more (${gain1} → ${gain2})`);
});

test('spawn protection prevents death but not kills, and attacking clears it', () => {
  const h = loadGame({ seed: 51 });
  const g = h.createGame();
  g.startMatch('classic');
  const player = g.player;
  const bot = g.bots[0];

  const parkUnderBlade = (attacker, victim) => {
    victim.x = attacker.bladeBase.x + attacker.bladeLength * 0.5;
    victim.y = attacker.bladeBase.y;
    victim.spine.forEach((joint) => { joint.x = victim.x; joint.y = victim.y; });
  };

  // Protected victim survives.
  player.invulnerableTimer = 0;
  bot.invulnerableTimer = 3.5;
  parkUnderBlade(player, bot);
  g.handleCollisions([player, bot]);
  assert.equal(bot.isDead, false, 'protected victim survives a blade hit');

  // Protected attacker can kill, but loses protection by attacking.
  bot.invulnerableTimer = 0;
  player.invulnerableTimer = 3.5;
  parkUnderBlade(player, bot);
  g.handleCollisions([player, bot]);
  assert.equal(bot.isDead, true, 'protected attacker lands the kill');
  assert.equal(player.invulnerableTimer, 0, 'attacking clears the attacker protection');
});

test('bots keep their species while upgrading weapons mid-match', () => {
  const h = loadGame({ seed: 21 });
  const g = h.createGame();
  g.startMatch('classic');
  const cat = h.catalog();
  const tierOf = (id) => {
    for (let i = 0; i < cat.weaponTiers.length; i++) {
      if (cat.weaponTiers[i].includes(id)) return i;
    }
    return 0;
  };

  const bot = g.bots[0];
  const speciesBefore = bot.skinId;
  const weaponBefore = bot.weaponId;

  // Force the league-up path: high tier cap + a leveled bot due for gear.
  g.player.level = 11;
  g.matchTime = 200;
  bot.level = 6;
  bot.gearUpLevel = 3;
  g.updateBotGear(100);

  assert.equal(bot.skinId, speciesBefore, 'species must not change mid-match');
  assert.ok(
    tierOf(bot.weaponId) >= 1,
    `weapon upgrades instead (${weaponBefore} -> ${bot.weaponId})`,
  );
});
