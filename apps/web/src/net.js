/**
 * Fish.IO — M1 online client (server-authoritative arena).
 *
 * Responsibilities:
 *  - connect to the room server, send hello/input/ping/respawn
 *  - predict the local fish (reused game simulation) + reconcile to snapshots
 *  - interpolate remote fish 100 ms in the past
 *  - mirror snapshot entities into the existing GameEngine arrays so the
 *    normal renderer (fish, hats, blades, food, chests, particles) just works
 *
 * The offline game is untouched: `game.online` is only set while connected.
 */
(function () {
  'use strict';

  const INTERP_MS = 100;        // render remote entities this far behind the newest snapshot
  const INPUT_INTERVAL_MS = 1000 / 30;
  const PING_INTERVAL_MS = 2000;
  const CORRECTION_RATE = 8;    // exponential reconciliation (~125 ms)
  const SNAP_THRESHOLD = 260;   // teleport when prediction is this far off
  const MAX_SAMPLES = 24;
  const RECONNECT_DELAYS = [500, 1500, 3000];
  const TOKEN_KEY = 'fishio_room_token';

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const r2 = (n) => Math.round(n * 100) / 100;

  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function resolveRoomUrl() {
    if (window.FISHIO_ROOM_URL) return window.FISHIO_ROOM_URL;
    try {
      const param = new URLSearchParams(window.location.search).get('room');
      if (param) return param;
    } catch {
      /* ignore */
    }
    const host = window.location.hostname || '127.0.0.1';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = window.FISHIO_ROOM_PORT || 8787;
    return `${proto}//${host}:${port}`;
  }

  function makeFood(state) {
    return {
      id: state.id,
      x: state.x,
      y: state.y,
      vx: 0,
      vy: 0,
      radius: state.r,
      baseRadius: state.r,
      type: state.ty,
      xp: state.xp,
      gold: state.g,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.02,
      swayPhase: Math.random() * Math.PI * 2,
      isMeat: Boolean(state.m),
    };
  }

  function makeChest(state) {
    return {
      id: state.id,
      x: state.x,
      y: state.y,
      radius: state.r,
      hp: state.hp,
      maxHp: state.mx,
      wobble: 0,
      rotation: (Math.random() - 0.5) * 0.2,
    };
  }

  function makePowerup(state) {
    return {
      id: state.id,
      x: state.x,
      y: state.y,
      type: state.ty,
      radius: state.r,
      rotation: 0,
      swayPhase: Math.random() * Math.PI * 2,
    };
  }

  /** Rebuild spine/blade visuals from x/y/angle for fish that skip update(). */
  function syncFishVisual(fish, dt) {
    const spine = fish.spine;
    spine[0].x = fish.x;
    spine[0].y = fish.y;
    spine[0].angle = fish.angle;

    const segmentDist = (fish.radius * 1.5) / fish.numSegments;
    for (let i = 1; i < fish.numSegments; i++) {
      const prev = spine[i - 1];
      const curr = spine[i];
      const wiggleAmp = Math.sin(fish.swimPhase - i * 0.6) * (i * 1.2 * (fish.radius / 20));
      const targetX = prev.x - Math.cos(prev.angle) * segmentDist - Math.sin(prev.angle) * wiggleAmp;
      const targetY = prev.y - Math.sin(prev.angle) * segmentDist + Math.cos(prev.angle) * wiggleAmp;
      curr.x += (targetX - curr.x) * 0.55 * dt;
      curr.y += (targetY - curr.y) * 0.55 * dt;
      curr.angle = Math.atan2(prev.y - curr.y, prev.x - curr.x);
    }

    const snoutOffset = fish.radius * 0.95;
    fish.bladeBase.x = fish.x + Math.cos(fish.angle) * snoutOffset;
    fish.bladeBase.y = fish.y + Math.sin(fish.angle) * snoutOffset;
    fish.bladeTip.x = fish.bladeBase.x + Math.cos(fish.angle) * fish.bladeLength;
    fish.bladeTip.y = fish.bladeBase.y + Math.sin(fish.angle) * fish.bladeLength;

    if (fish.bladeHistory.length < 8) {
      fish.bladeHistory.unshift({ x: fish.bladeTip.x, y: fish.bladeTip.y });
    } else {
      const recycled = fish.bladeHistory.pop();
      recycled.x = fish.bladeTip.x;
      recycled.y = fish.bladeTip.y;
      fish.bladeHistory.unshift(recycled);
    }

    fish.swimPhase += (fish.speed * 0.08 + 0.04) * dt;
    fish.finPhase += (fish.speed * 0.1 + 0.05) * dt;
  }

  class OnlineClient {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.state = 'idle'; // idle | connecting | playing | dead | closed
      this.socket = null;
      this.loadout = null;
      this.playerId = null;
      this.token = null;
      this.world = { w: 4000, h: 4000 };
      this.lastMap = 'coral_reef';
      this.localFish = null;
      this.remote = new Map(); // id -> { fish, samples: [], dead }
      this.foodById = new Map();
      this.chestsById = new Map();
      this.powerupsById = new Map();
      this.correction = { x: 0, y: 0 };
      this.correctionReady = false;
      this.inputSeq = 0;
      this.inputAcc = 0;
      this.pingAcc = 0;
      this.ping = null;
      this.lastLb = [];
      this.lastLbAt = 0;
      this.lastSnapAt = 0;
      this.deathShown = false;
      this.deathTimer = null;
      this.intentionalClose = false;
      this.reconnectAttempt = 0;
      this.connectResolve = null;
      this.connectReject = null;
      this.myStats = { score: 0, kills: 0, level: 1 };
    }

    // ------------------------------------------------------------------ connect

    connect(loadout) {
      this.loadout = loadout;
      this.intentionalClose = false;
      this.reconnectAttempt = 0;
      return this.openSocket(true);
    }

    openSocket(isFirst) {
      this.state = 'connecting';
      this.setMenuStatus(isFirst ? 'Connecting to the arena…' : 'Reconnecting…');

      return new Promise((resolve, reject) => {
        let settled = false;
        const url = resolveRoomUrl();
        let socket;
        try {
          socket = new WebSocket(url);
        } catch (err) {
          reject(err);
          return;
        }
        this.socket = socket;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { socket.close(); } catch { /* ignore */ }
          reject(new Error('Connection timed out — is the room server running?'));
        }, 8000);

        socket.onopen = () => {
          const shop = window.shopManager || {};
          socket.send(JSON.stringify({
            t: 'hello',
            name: loadoutName(this.loadout),
            skin: this.loadout.skinId,
            weapon: this.loadout.weaponId,
            hat: this.loadout.hatId,
            upgrades: (shop.upgrades && typeof shop.upgrades === 'object') ? shop.upgrades : {},
            vw: window.innerWidth,
            vh: window.innerHeight,
            token: this.token || undefined,
          }));
        };

        socket.onmessage = (event) => {
          let msg;
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }
          this.handleMessage(msg);
          if (!settled && (msg.t === 'welcome' || msg.t === 'error')) {
            settled = true;
            clearTimeout(timer);
            if (msg.t === 'welcome') resolve(this);
            else reject(new Error(String(msg.code || 'join_failed')));
          }
        };

        socket.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('Could not reach the room server'));
        };

        socket.onclose = () => {
          clearTimeout(timer);
          if (this.active) {
            this.handleSocketClose();
            return;
          }
          if (!settled) {
            settled = true;
            reject(new Error('Connection closed before joining'));
          }
        };
      });
    }

    handleMessage(msg) {
      switch (msg.t) {
        case 'welcome': this.onFullState(msg, true); break;
        case 'spawn': this.onFullState(msg, false); break;
        case 'snap': this.onSnapshot(msg); break;
        case 'match_end': this.onMatchEnd(msg); break;
        case 'pong': this.ping = Math.max(1, Math.round(Date.now() - Number(msg.ct))); break;
        case 'error': this.setMenuStatus(`Join failed: ${msg.code}`); break;
        case 'bye': this.onBye(msg); break;
        default: break;
      }
    }

    handleSocketClose() {
      if (this.intentionalClose || !this.active) return;
      this.active = false;
      this.state = 'closed';
      this.scheduleReconnect();
    }

    scheduleReconnect() {
      if (this.intentionalClose) return;
      if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
        this.reconnectFailed();
        return;
      }
      const delay = RECONNECT_DELAYS[this.reconnectAttempt];
      this.reconnectAttempt++;
      this.setMenuStatus(`Connection lost — reconnecting (${this.reconnectAttempt}/${RECONNECT_DELAYS.length})…`);
      setTimeout(() => {
        if (this.intentionalClose) return;
        this.openSocket(false).catch(() => this.scheduleReconnect());
      }, delay);
    }

    reconnectFailed() {
      this.exitToMenu('Connection lost. The arena server may be offline.');
    }

    // ---------------------------------------------------------------- full state

    onFullState(msg, isWelcome) {
      const g = this.game;
      this.active = true;
      this.state = 'playing';
      this.deathShown = false;
      this.playerId = msg.id;
      if (msg.token) {
        this.token = msg.token;
        try { window.sessionStorage.setItem(TOKEN_KEY, msg.token); } catch { /* ignore */ }
      }
      this.world = msg.world || this.world;
      this.lastMap = msg.map || this.lastMap;
      this.reconnectAttempt = 0;

      g.online = this;
      g.gameMode = 'multiplayer';
      g.gameState = 'playing';
      g.isPaused = false;
      g.currentMap = window.FISH_MAPS[this.lastMap] || window.FISH_MAPS.coral_reef;
      g.worldWidth = this.world.w;
      g.worldHeight = this.world.h;

      // Reset mirrored world state.
      this.remote.clear();
      this.foodById.clear();
      this.chestsById.clear();
      this.powerupsById.clear();
      this.correction = { x: 0, y: 0 };
      this.correctionReady = false;
      // Note: inputSeq is intentionally NOT reset here. The server resets its
      // ack window whenever a connection is (re)bound, and keeping our counter
      // monotonic guarantees inputs are never dropped as stale.
      this.inputAcc = 0;
      this.pingAcc = 0;
      this.lastLb = [];
      g.bots = [];
      g.foodManager.foods = [];
      g.foodManager.chests = [];
      g.foodManager.powerups = [];

      // Local player.
      if (msg.you) {
        this.myStats = { score: msg.you.sc, kills: msg.you.k, level: msg.you.lv };
        const fish = new window.Fish(msg.you.x, msg.you.y, msg.you.n, msg.you.sk, msg.you.w, false, msg.you.h);
        fish.netId = msg.you.id;
        this.localFish = fish;
        g.player = fish;
        this.applyAuthoritative(fish, msg.you);
        g.camera.x = fish.x;
        g.camera.y = fish.y;
        g.camera.targetX = fish.x;
        g.camera.targetY = fish.y;
        g.camera.zoom = 1;
        g.camera.targetZoom = 1;
      }

      for (const state of msg.p || []) {
        if (state.id === this.playerId) continue;
        this.ensureRemote(state).samples.push(this.makeSample(state));
      }
      for (const f of msg.food || []) this.foodById.set(f.id, makeFood(f));
      for (const c of msg.chests || []) this.chestsById.set(c.id, makeChest(c));
      for (const p of msg.powerups || []) this.powerupsById.set(p.id, makePowerup(p));
      if (msg.lb) {
        this.lastLb = msg.lb;
        this.lastLbAt = performance.now();
      }
      this.rebuildWorldArrays();

      // UI: enter the game.
      hide('mainMenu');
      hide('shopModal');
      hide('gameOverModal');
      hide('pauseModal');
      document.querySelectorAll('.modal-backdrop').forEach((el) => el.classList.add('hidden'));
      show('hudOverlay');
      this.setMenuStatus('');
      const badge = document.getElementById('onlineBadge');
      if (badge) badge.classList.remove('hidden');
      if (window.soundEngine) {
        try { window.soundEngine.init(); window.soundEngine.resume(); } catch { /* ignore */ }
      }
      if (g.particles && g.particles.clear) g.particles.clear();
    }

    applyAuthoritative(fish, state) {
      fish.level = state.lv;
      fish.score = state.sc;
      fish.kills = state.k;
      fish.isKing = !!state.kg;
      fish.hasShield = !!state.sh;
      fish.stamina = state.st === undefined ? fish.stamina : state.st;
      fish.updateDimensions();
      fish.radius = state.r;
    }

    ensureRemote(state) {
      let rec = this.remote.get(state.id);
      if (!rec) {
        const fish = new window.Fish(state.x, state.y, state.n, state.sk, state.w, true, state.h);
        fish.netId = state.id;
        fish.isDead = false;
        rec = { fish, samples: [], dead: false };
        this.remote.set(state.id, rec);
      }
      return rec;
    }

    makeSample(state) {
      return {
        at: performance.now(),
        x: state.x,
        y: state.y,
        a: state.a,
        r: state.r,
        lv: state.lv,
        sc: state.sc,
        b: state.b,
        sh: state.sh,
        kg: state.kg,
        iv: state.iv,
      };
    }

    rebuildWorldArrays() {
      const g = this.game;
      g.bots = [];
      for (const rec of this.remote.values()) {
        if (!rec.dead) g.bots.push(rec.fish);
      }
      g.foodManager.foods = [...this.foodById.values()];
      g.foodManager.chests = [...this.chestsById.values()];
      g.foodManager.powerups = [...this.powerupsById.values()];
    }

    // ------------------------------------------------------------------ snapshot

    onSnapshot(msg) {
      if (!this.active) return;
      const g = this.game;
      const now = performance.now();
      this.lastSnapAt = now;

      if (Array.isArray(msg.ev)) this.handleEvents(msg.ev);
      if (msg.lb) {
        this.lastLb = msg.lb;
        this.lastLbAt = now;
      }

      if (msg.you) {
        this.myStats = { score: msg.you.sc, kills: msg.you.k, level: msg.you.lv };
        if (this.localFish) this.reconcile(msg.you, msg.ack);
      }

      const seen = new Set();
      for (const state of msg.p || []) {
        seen.add(state.id);
        if (state.id === this.playerId) continue;
        const rec = this.ensureRemote(state);
        if (rec.dead) {
          rec.dead = false;
          rec.fish.isDead = false;
          rec.samples.length = 0; // respawned: don't interpolate from the death spot
          rec.fish.x = state.x;
          rec.fish.y = state.y;
          rec.fish.angle = state.a;
        }
        rec.samples.push(this.makeSample(state));
        if (rec.samples.length > MAX_SAMPLES) rec.samples.splice(0, rec.samples.length - MAX_SAMPLES);
      }
      for (const rec of this.remote.values()) {
        const fish = rec.fish;
        if (!seen.has(fish.netId)) {
          if (!rec.dead) {
            rec.dead = true;
            fish.isDead = true;
            if (g.particles && g.particles.addFishDeathExplosion) {
              g.particles.addFishDeathExplosion(fish.x, fish.y, fish.radius, fish.skin.primaryColor);
            }
          }
        }
      }

      const add = msg.add || {};
      const del = msg.del || {};
      if (add.food) for (const f of add.food) this.foodById.set(f.id, makeFood(f));
      if (add.chests) for (const c of add.chests) this.chestsById.set(c.id, makeChest(c));
      if (add.powerups) for (const p of add.powerups) this.powerupsById.set(p.id, makePowerup(p));
      if (del.food) for (const id of del.food) this.foodById.delete(id);
      if (del.chests) for (const id of del.chests) this.chestsById.delete(id);
      if (del.powerups) for (const id of del.powerups) this.powerupsById.delete(id);

      this.rebuildWorldArrays();
    }

    handleEvents(events) {
      const g = this.game;
      for (const ev of events) {
        if (ev.k === 'kill') {
          if (ev.victimId === this.playerId) continue; // local death has its own flow
          if (ev.byId === this.playerId) {
            g.showAnnouncement(`🎯 You sliced ${ev.victim}!`);
            g.camera.addShake(8);
          } else if (ev.byId && ev.victimId) {
            g.showAnnouncement(`🗡️ ${ev.by} sliced ${ev.victim}!`);
          }
          const rec = this.remote.get(ev.victimId);
          if (rec && g.particles && g.particles.addFishDeathExplosion) {
            g.particles.addFishDeathExplosion(rec.fish.x, rec.fish.y, rec.fish.radius, rec.fish.skin.primaryColor);
          }
        } else if (ev.k === 'join' || ev.k === 'leave') {
          if (ev.text) g.showAnnouncement(ev.text);
        }
      }
    }

    reconcile(state, ack) {
      const fish = this.localFish;
      if (!fish || fish.isDead) return;

      const dx = state.x - fish.x;
      const dy = state.y - fish.y;
      const err = Math.hypot(dx, dy);
      if (err > SNAP_THRESHOLD || !this.correctionReady) {
        fish.x = state.x;
        fish.y = state.y;
        this.correction.x = 0;
        this.correction.y = 0;
        this.correctionReady = true;
      } else {
        this.correction.x = dx;
        this.correction.y = dy;
      }

      // Authoritative progression.
      fish.level = state.lv;
      fish.score = state.sc;
      fish.kills = state.k;
      fish.isKing = !!state.kg;
      fish.hasShield = !!state.sh;
      if (state.st !== undefined) {
        // Blend stamina so the boost bar doesn't jitter against local prediction.
        fish.stamina = fish.stamina + (state.st - fish.stamina) * 0.35;
      }
      fish.updateDimensions();
      fish.radius = state.r;
      if (typeof ack === 'number') this.ackedInput = ack;
    }

    onMatchEnd(msg) {
      if (!this.active) return;
      this.state = 'dead';
      this.myStats = {
        score: Number(msg.stats?.score ?? this.myStats.score),
        kills: Number(msg.stats?.kills ?? this.myStats.kills),
        level: Number(msg.stats?.level ?? this.myStats.level),
      };

      const g = this.game;
      const fish = this.localFish;
      if (fish && !fish.isDead) {
        fish.isDead = true;
        if (g.particles && g.particles.addFishDeathExplosion) {
          g.particles.addFishDeathExplosion(fish.x, fish.y, fish.radius, fish.skin.primaryColor);
        }
      }
      if (g.camera) g.camera.addShake(16);

      const shutdown = msg.reason === 'server_shutdown';
      this.deathTimer = setTimeout(() => this.showDeathModal(shutdown), 900);
    }

    showDeathModal(shutdown) {
      if (this.state !== 'dead') return;
      this.deathShown = true;
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };
      set('gameOverTitle', shutdown ? 'ARENA CLOSED' : 'YOU WERE SLICED!');
      set('finalScore', this.myStats.score);
      set('finalKills', this.myStats.kills);
      set('finalLevel', this.myStats.level);
      set('finalGold', '+0');
      set('finalKingTime', '0s');
      show('gameOverModal');
      hide('hudOverlay');
    }

    respawn() {
      if (!this.active || this.state !== 'dead' || !this.socket) return;
      this.state = 'playing';
      this.deathShown = false;
      hide('gameOverModal');
      show('hudOverlay');
      this.send({ t: 'respawn' });
    }

    onBye(msg) {
      this.intentionalClose = true;
      this.exitToMenu(msg.reason === 'server_shutdown' ? 'The arena server shut down.' : 'Disconnected.');
    }

    // -------------------------------------------------------------------- frame

    update(dt) {
      if (!this.active) return;
      const now = performance.now();

      this.applyLocalInput(dt);
      this.sendInput(dt);
      this.updateRemote(dt, now);
      this.animateWorld(dt);
      this.updateCamera(dt);
      this.game.updateHUD();
      this.updateLeaderboard(now);
      this.pingLoop(dt);
    }

    applyLocalInput(dt) {
      const g = this.game;
      const p = this.localFish;
      if (!p || p.isDead) return;

      let kx = 0;
      let ky = 0;
      if (g.keys.w || g.keys.up) ky -= 1;
      if (g.keys.s || g.keys.down) ky += 1;
      if (g.keys.a || g.keys.left) kx -= 1;
      if (g.keys.d || g.keys.right) kx += 1;

      if (kx !== 0 || ky !== 0) {
        p.targetAngle = Math.atan2(ky, kx);
      } else if (!g.touchJoystick.active) {
        const worldMouse = g.camera.screenToWorld(g.mousePos.x, g.mousePos.y);
        const dx = worldMouse.x - p.x;
        const dy = worldMouse.y - p.y;
        if (Math.hypot(dx, dy) > 20) p.targetAngle = Math.atan2(dy, dx);
      }
      p.isBoosting = Boolean(g.isMouseDown || g.keys.space || g.keys.shift || g.touchBoosting);

      p.update(dt, g.worldWidth, g.worldHeight, g.particles, g.soundEngine);

      // Exponential reconciliation: fold the server correction in over ~125 ms.
      const k = 1 - Math.exp(-dt * CORRECTION_RATE);
      p.x += this.correction.x * k;
      p.y += this.correction.y * k;
      this.correction.x *= 1 - k;
      this.correction.y *= 1 - k;

      const margin = p.radius + 15;
      p.x = clamp(p.x, margin, g.worldWidth - margin);
      p.y = clamp(p.y, margin, g.worldHeight - margin);
    }

    sendInput(dt) {
      this.inputAcc += dt * (1000 / 60);
      if (this.inputAcc < INPUT_INTERVAL_MS) return;
      this.inputAcc = Math.min(this.inputAcc - INPUT_INTERVAL_MS, INPUT_INTERVAL_MS);
      const p = this.localFish;
      if (!p || p.isDead) return;
      this.inputSeq++;
      this.send({
        t: 'input',
        seq: this.inputSeq,
        a: Math.round(p.targetAngle * 1000) / 1000,
        b: p.isBoosting ? 1 : 0,
      });
    }

    updateRemote(dt, now) {
      const renderTime = now - INTERP_MS;
      for (const rec of this.remote.values()) {
        const fish = rec.fish;
        if (rec.dead) continue;
        const samples = rec.samples;
        if (!samples.length) continue;

        let x = samples[0].x;
        let y = samples[0].y;
        let a = samples[0].a;
        let latest = samples[samples.length - 1];
        const prevX = fish.x;
        const prevY = fish.y;

        if (samples.length === 1 || renderTime <= samples[0].at) {
          x = samples[0].x;
          y = samples[0].y;
          a = samples[0].a;
        } else {
          let upper = -1;
          for (let i = samples.length - 1; i >= 1; i--) {
            if (samples[i - 1].at <= renderTime && renderTime <= samples[i].at) {
              upper = i;
              break;
            }
          }
          if (upper === -1) {
            // Ahead of the newest sample: extrapolate up to 150 ms.
            const last = samples[samples.length - 1];
            const prev = samples[samples.length - 2] || last;
            const ahead = Math.min(150, Math.max(0, renderTime - last.at));
            const span = Math.max(1, last.at - prev.at);
            const vx = (last.x - prev.x) / span;
            const vy = (last.y - prev.y) / span;
            x = last.x + vx * ahead;
            y = last.y + vy * ahead;
            a = last.a;
          } else {
            const s0 = samples[upper - 1];
            const s1 = samples[upper];
            const t = (renderTime - s0.at) / Math.max(1, s1.at - s0.at);
            x = s0.x + (s1.x - s0.x) * t;
            y = s0.y + (s1.y - s0.y) * t;
            a = lerpAngle(s0.a, s1.a, t);
          }
        }

        fish.x = x;
        fish.y = y;
        fish.angle = a;
        fish.speed = Math.hypot(x - prevX, y - prevY) / Math.max(1 / 120, 1 / 60);
        if (fish.level !== latest.lv) {
          fish.level = latest.lv;
          fish.updateDimensions();
        }
        fish.radius = latest.r;
        fish.score = latest.sc;
        fish.isBoosting = !!latest.b;
        fish.hasShield = !!latest.sh;
        fish.isKing = !!latest.kg;
        fish.invulnerableTimer = latest.iv ? 0.2 : 0;
        syncFishVisual(fish, dt);
      }
    }

    animateWorld(dt) {
      for (const f of this.foodById.values()) {
        f.swayPhase += 0.03 * dt;
        f.rotation += f.rotSpeed * dt;
      }
      for (const c of this.chestsById.values()) {
        if (c.wobble > 0.05) c.wobble *= Math.pow(0.85, dt);
        else c.wobble = 0;
      }
      for (const p of this.powerupsById.values()) {
        p.swayPhase += 0.04 * dt;
        p.rotation += 0.02 * dt;
      }
      if (this.game.particles) this.game.particles.update(dt, this.world.w, this.world.h);
    }

    updateCamera(dt) {
      const g = this.game;
      const p = this.localFish;
      if (p && !p.isDead) g.camera.update(p.x, p.y, p.radius, dt);
    }

    updateLeaderboard(now) {
      if (!this.lastLb.length || now - this.lastLbAt > 1500) return;
      if (now - (this.lbRenderAt || 0) < 250) return;
      this.lbRenderAt = now;
      const list = document.getElementById('leaderboardList');
      if (!list) return;
      let html = '';
      for (let i = 0; i < this.lastLb.length; i++) {
        const row = this.lastLb[i];
        const me = row.id === this.playerId;
        html += `
          <div class="lb-row ${me ? 'me' : ''} ${i === 0 ? 'king' : ''}">
            <span class="lb-rank">${i === 0 ? '👑' : `#${i + 1}`}</span>
            <span class="lb-name">${escapeHtml(row.n)}<span style="opacity:.65;font-size:.72em;margin-left:4px;">Lv.${row.lv}</span></span>
            <span class="lb-score">${row.sc}</span>
          </div>`;
      }
      list.innerHTML = html;
    }

    pingLoop(dt) {
      this.pingAcc += dt * (1000 / 60);
      const pingEl = document.getElementById('onlinePing');
      if (pingEl) pingEl.textContent = this.ping == null ? '--' : String(this.ping);
      if (this.pingAcc < PING_INTERVAL_MS) return;
      this.pingAcc = 0;
      this.send({ t: 'ping', ct: Date.now() });
    }

    send(message) {
      if (!this.socket) return;
      try {
        if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
      } catch {
        /* ignore */
      }
    }

    // ------------------------------------------------------------------ exit/UI

    /** Send leave, tear down the session and go back to the main menu. */
    leaveAndExit() {
      this.intentionalClose = true;
      if (this.socket) {
        this.send({ t: 'leave' });
        try { this.socket.close(1000, 'left'); } catch { /* ignore */ }
      }
      this.exitToMenu();
    }

    exitToMenu(statusText) {
      this.active = false;
      this.state = 'idle';
      this.intentionalClose = true;
      if (this.socket) {
        try { this.socket.onclose = null; this.socket.close(); } catch { /* ignore */ }
      }
      this.socket = null;
      this.localFish = null;
      this.remote.clear();
      this.foodById.clear();
      this.chestsById.clear();
      this.powerupsById.clear();
      this.lastLb = [];
      if (this.deathTimer) clearTimeout(this.deathTimer);

      const g = this.game;
      g.online = null;
      g.player = null;
      g.bots = [];
      g.gameMode = 'classic';
      g.gameState = 'menu';
      const badge = document.getElementById('onlineBadge');
      if (badge) badge.classList.add('hidden');
      hide('hudOverlay');
      hide('gameOverModal');
      hide('pauseModal');

      if (typeof window.returnToMenu === 'function') {
        window.returnToMenu();
      } else {
        show('mainMenu');
      }
      this.setMenuStatus(statusText || '');
    }

    setMenuStatus(text) {
      const el = document.getElementById('onlineStatus');
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('hidden', !text);
    }
  }

  function loadoutName(loadout) {
    return (loadout && loadout.name) || (window.shopManager && window.shopManager.playerName) || 'Player';
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  }

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  window.FishNet = {
    resolveRoomUrl,

    /**
     * Connect and enter the online arena.
     * @param {object} game GameEngine instance (from index.html scope)
     * @param {{name:string, skinId:string, weaponId:string, hatId:string}} loadout
     */
    async connect(game, loadout) {
      if (game.online && game.online.active) return game.online;
      if (game.online) {
        // Replace a dead client (failed reconnect) instead of blocking forever.
        const stale = game.online;
        game.online = null;
        stale.intentionalClose = true;
        try { if (stale.socket) stale.socket.close(); } catch { /* ignore */ }
      }
      let token = null;
      try { token = window.sessionStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
      const client = new OnlineClient(game);
      client.token = token;
      await client.connect(loadout);
      return client;
    },
  };
})();
