/**
 * Fish IO - Main Engine, Physics, Collision, Maps, Power-ups & Game Loop
 */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r = 0) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

class Camera {
    constructor() {
        this.x = 2000;
        this.y = 2000;
        this.targetX = 2000;
        this.targetY = 2000;
        this.zoom = 1.0;
        this.targetZoom = 1.0;
        this.viewportWidth = window.innerWidth || 1280;
        this.viewportHeight = window.innerHeight || 720;
        this.shake = 0;
    }

    update(targetX, targetY, targetSize = 22, dt = 1) {
        const safeTargetX = isFinite(targetX) ? targetX : 2000;
        const safeTargetY = isFinite(targetY) ? targetY : 2000;
        const safeDt = isFinite(dt) ? Math.max(0.01, Math.min(1.5, dt)) : 1.0;

        this.targetX = safeTargetX;
        this.targetY = safeTargetY;

        this.x = isFinite(this.x) ? this.x : safeTargetX;
        this.y = isFinite(this.y) ? this.y : safeTargetY;

        this.x += (this.targetX - this.x) * 0.12 * safeDt;
        this.y += (this.targetY - this.y) * 0.12 * safeDt;

        const safeSize = (isFinite(targetSize) && targetSize > 5) ? targetSize : 22;
        this.targetZoom = Math.max(0.42, Math.min(1.05, 1.0 / Math.pow(safeSize / 22, 0.42)));
        
        this.zoom = isFinite(this.zoom) ? this.zoom : 1.0;
        this.zoom += (this.targetZoom - this.zoom) * 0.05 * safeDt;
        this.zoom = Math.max(0.35, Math.min(1.2, this.zoom));

        if (this.shake > 0.1) {
            this.shake *= Math.pow(0.85, safeDt);
        } else {
            this.shake = 0;
        }
    }

    addShake(amount = 8) {
        if (isFinite(amount)) {
            this.shake = Math.max(this.shake || 0, amount);
        }
    }

    worldToScreen(wx, wy) {
        const cx = isFinite(this.x) ? this.x : 2000;
        const cy = isFinite(this.y) ? this.y : 2000;
        const z = (isFinite(this.zoom) && this.zoom > 0.1) ? this.zoom : 1.0;
        const safeWx = isFinite(wx) ? wx : 2000;
        const safeWy = isFinite(wy) ? wy : 2000;
        const shakeX = (Math.random() - 0.5) * (this.shake || 0);
        const shakeY = (Math.random() - 0.5) * (this.shake || 0);
        const vw = this.viewportWidth || window.innerWidth || 1280;
        const vh = this.viewportHeight || window.innerHeight || 720;
        return {
            x: (safeWx - cx) * z + vw / 2 + shakeX,
            y: (safeWy - cy) * z + vh / 2 + shakeY
        };
    }

    screenToWorld(sx, sy) {
        const cx = isFinite(this.x) ? this.x : 2000;
        const cy = isFinite(this.y) ? this.y : 2000;
        const z = (isFinite(this.zoom) && this.zoom > 0.1) ? this.zoom : 1.0;
        const vw = this.viewportWidth || window.innerWidth || 1280;
        const vh = this.viewportHeight || window.innerHeight || 720;
        const safeSx = isFinite(sx) ? sx : vw / 2;
        const safeSy = isFinite(sy) ? sy : vh / 2;
        return {
            x: (safeSx - vw / 2) / z + cx,
            y: (safeSy - vh / 2) / z + cy
        };
    }

    isVisible(wx, wy, radius = 50) {
        if (!isFinite(wx) || !isFinite(wy)) return true;
        const screen = this.worldToScreen(wx, wy);
        const z = (isFinite(this.zoom) && this.zoom > 0.1) ? this.zoom : 1.0;
        const r = (isFinite(radius) ? radius : 50) * z;
        const vw = this.viewportWidth || window.innerWidth || 1280;
        const vh = this.viewportHeight || window.innerHeight || 720;
        return (
            screen.x + r >= -100 &&
            screen.x - r <= vw + 100 &&
            screen.y + r >= -100 &&
            screen.y - r <= vh + 100
        );
    }
}

function getLineIntersection(p0_x, p0_y, p1_x, p1_y, p2_x, p2_y, p3_x, p3_y) {
    const s1_x = p1_x - p0_x;
    const s1_y = p1_y - p0_y;
    const s2_x = p3_x - p2_x;
    const s2_y = p3_y - p2_y;

    const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / (-s2_x * s1_y + s1_x * s2_y);
    const t = ( s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / (-s2_x * s1_y + s1_x * s2_y);

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        return {
            x: p0_x + (t * s1_x),
            y: p0_y + (t * s1_y)
        };
    }
    return null;
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

class GameEngine {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimapCanvas');
        this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

        this.worldWidth = 4000;
        this.worldHeight = 4000;
        this.camera = new Camera();
        this.particles = new ParticleSystem();
        this.foodManager = new FoodManager(this.worldWidth, this.worldHeight, 850);
        this.soundEngine = window.soundEngine;
        this.shop = window.shopManager;

        this.player = null;
        this.bots = [];
        this.botControllers = [];
        this.targetBotCount = 18;

        this.gameState = 'menu';
        this.gameMode = 'classic';
        this.currentMap = FISH_MAPS.coral_reef;
        this.modeTimer = 120;

        // Statistics
        this.streak = 0;
        this.streakTimer = 0;
        this.matchKills = 0;
        this.matchChests = 0;
        this.matchGold = 0;
        this.matchFood = 0;
        this.matchTime = 0;
        this.kingTime = 0;

        // Input state
        this.mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        this.isMouseDown = false;
        this.touchBoosting = false;
        this.touchJoystick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
        this.keys = {
            w: false, a: false, s: false, d: false,
            up: false, left: false, down: false, right: false,
            space: false, shift: false
        };

        this.isPaused = false;

        // Cache DOM elements to prevent querySelector overhead & frame hangs
        this.elXpBar = document.getElementById('xpFill');
        this.elLvl = document.getElementById('hudLevel');
        this.elStaminaBar = document.getElementById('staminaFill');
        this.elScore = document.getElementById('hudScore');
        this.elKills = document.getElementById('hudKills');
        this.elGold = document.getElementById('hudGold');
        this.elTimerContainer = document.getElementById('hudTimerContainer');
        this.elTimer = document.getElementById('hudTimer');
        this.elGoalBanner = document.getElementById('hudChallengeGoal');
        this.elLeaderboard = document.getElementById('leaderboardList');
        this.leaderboardTimer = 0;

        // Map obstacles & decor
        this.kelpForests = [];
        this.icebergs = [];
        this.thermalVents = [];
        this.ruins = [];
        this.initMapDecor();

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupInputs();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    initMapDecor() {
        this.kelpForests = [];
        this.icebergs = [];
        this.thermalVents = [];
        this.abyssJellies = [];
        this.ruins = [];
        this.coralFormations = [];
        this.atlantisRunes = [];

        // 1. Coral Reef Formations
        const coralColors = ['#ff6b81', '#ff9f43', '#a55eea', '#00d2d3', '#fdcb6e'];
        for (let i = 0; i < 38; i++) {
            this.coralFormations.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                radius: 28 + Math.random() * 32,
                color: coralColors[i % coralColors.length],
                branches: 5 + Math.floor(Math.random() * 4),
                swaySpeed: 0.002 + Math.random() * 0.002,
                phase: Math.random() * Math.PI * 2
            });
        }

        // 2. Kelp Forests
        for (let i = 0; i < 42; i++) {
            this.kelpForests.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                height: 140 + Math.random() * 240,
                width: 25 + Math.random() * 35,
                hue: 135 + Math.random() * 35,
                swaySpeed: 0.0015 + Math.random() * 0.002,
                phase: Math.random() * Math.PI * 2
            });
        }

        // 3. Arctic Icebergs & Frost Floes
        for (let i = 0; i < 26; i++) {
            this.icebergs.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                radius: 40 + Math.random() * 55,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.0015
            });
        }

        // 4. Deep Abyss Hydrothermal Chimneys & Jellies
        for (let i = 0; i < 22; i++) {
            this.thermalVents.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                radius: 34,
                pulse: Math.random() * Math.PI * 2
            });
        }
        for (let i = 0; i < 18; i++) {
            this.abyssJellies.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                radius: 16 + Math.random() * 12,
                color: i % 2 === 0 ? '#00f7ff' : '#e056fd',
                swaySpeed: 0.003 + Math.random() * 0.003,
                phase: Math.random() * Math.PI * 2
            });
        }

        // 5. Sunken Atlantis Columns & Glowing Runes
        for (let i = 0; i < 30; i++) {
            this.ruins.push({
                x: 100 + Math.random() * (this.worldWidth - 200),
                y: 100 + Math.random() * (this.worldHeight - 200),
                width: 32 + Math.random() * 22,
                height: 70 + Math.random() * 90,
                angle: (Math.random() - 0.5) * 0.45,
                isBroken: Math.random() < 0.4
            });
        }
        for (let i = 0; i < 16; i++) {
            this.atlantisRunes.push({
                x: 150 + Math.random() * (this.worldWidth - 300),
                y: 150 + Math.random() * (this.worldHeight - 300),
                radius: 38 + Math.random() * 20,
                rotation: Math.random() * Math.PI * 2,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.camera.viewportWidth = window.innerWidth;
        this.camera.viewportHeight = window.innerHeight;
    }

    pauseGame() {
        if (this.gameState !== 'playing' || this.isPaused) return;
        this.isPaused = true;
        this.isMouseDown = false;
        this.touchBoosting = false;
        this.keys.space = false;
        this.keys.shift = false;
        this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
        this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
        if (this.player) this.player.isBoosting = false;

        const pauseModal = document.getElementById('pauseModal');
        if (pauseModal) pauseModal.classList.remove('hidden');
    }

    resumeGame() {
        if (!this.isPaused) return;
        this.isPaused = false;
        this.lastTime = performance.now();

        const pauseModal = document.getElementById('pauseModal');
        if (pauseModal) pauseModal.classList.add('hidden');
    }

    togglePause() {
        if (this.isPaused) {
            this.resumeGame();
        } else {
            this.pauseGame();
        }
    }

    setupInputs() {
        window.addEventListener('mousemove', (e) => {
            this.mousePos.x = e.clientX;
            this.mousePos.y = e.clientY;
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
                this.isMouseDown = true;
                if (this.player && !this.isPaused) this.player.isBoosting = true;
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.isMouseDown = false;
                if (this.player && !this.keys.space && !this.keys.shift && !this.touchBoosting) {
                    this.player.isBoosting = false;
                }
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

            const code = e.code;
            const key = e.key ? e.key.toLowerCase() : '';

            // Pause toggle with Escape or P (offline only — online arenas never pause)
            if ((code === 'Escape' || code === 'KeyP' || key === 'p') && (this.gameState === 'playing' || this.isPaused) && !this.online) {
                e.preventDefault();
                this.togglePause();
                return;
            }

            // Spacebar & Shift for Turbo Boost
            if (code === 'Space' || key === ' ' || e.keyCode === 32) {
                e.preventDefault();
                this.keys.space = true;
                if (this.player && !this.isPaused) this.player.isBoosting = true;
            } else if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'shift') {
                this.keys.shift = true;
                if (this.player && !this.isPaused) this.player.isBoosting = true;
            }

            // WASD & Arrow keys for directional steering
            if (code === 'KeyW' || key === 'w') { this.keys.w = true; }
            if (code === 'KeyA' || key === 'a') { this.keys.a = true; }
            if (code === 'KeyS' || key === 's') { this.keys.s = true; }
            if (code === 'KeyD' || key === 'd') { this.keys.d = true; }
            if (code === 'ArrowUp' || key === 'arrowup') { e.preventDefault(); this.keys.up = true; }
            if (code === 'ArrowLeft' || key === 'arrowleft') { e.preventDefault(); this.keys.left = true; }
            if (code === 'ArrowDown' || key === 'arrowdown') { e.preventDefault(); this.keys.down = true; }
            if (code === 'ArrowRight' || key === 'arrowright') { e.preventDefault(); this.keys.right = true; }
        });

        window.addEventListener('keyup', (e) => {
            const code = e.code;
            const key = e.key ? e.key.toLowerCase() : '';

            if (code === 'Space' || key === ' ' || e.keyCode === 32) {
                e.preventDefault();
                this.keys.space = false;
                if (this.player && !this.isMouseDown && !this.keys.shift && !this.touchBoosting) {
                    this.player.isBoosting = false;
                }
            } else if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'shift') {
                this.keys.shift = false;
                if (this.player && !this.isMouseDown && !this.keys.space && !this.touchBoosting) {
                    this.player.isBoosting = false;
                }
            }

            if (code === 'KeyW' || key === 'w') this.keys.w = false;
            if (code === 'KeyA' || key === 'a') this.keys.a = false;
            if (code === 'KeyS' || key === 's') this.keys.s = false;
            if (code === 'KeyD' || key === 'd') this.keys.d = false;
            if (code === 'ArrowUp' || key === 'arrowup') this.keys.up = false;
            if (code === 'ArrowLeft' || key === 'arrowleft') this.keys.left = false;
            if (code === 'ArrowDown' || key === 'arrowdown') this.keys.down = false;
            if (code === 'ArrowRight' || key === 'arrowright') this.keys.right = false;
        });

        // Tab switch & window blur auto-pause (offline only)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.gameState === 'playing' && !this.isPaused && !this.online) {
                this.pauseGame();
            }
        });

        window.addEventListener('blur', () => {
            if (this.gameState === 'playing' && !this.isPaused && !this.online) {
                this.pauseGame();
            }
        });

        const touchZone = document.getElementById('touchZone');
        if (touchZone) {
            touchZone.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                this.touchJoystick.active = true;
                this.touchJoystick.startX = t.clientX;
                this.touchJoystick.startY = t.clientY;
                this.touchJoystick.currentX = t.clientX;
                this.touchJoystick.currentY = t.clientY;
            }, { passive: false });

            touchZone.addEventListener('touchmove', (e) => {
                if (!this.touchJoystick.active) return;
                const t = e.touches[0];
                this.touchJoystick.currentX = t.clientX;
                this.touchJoystick.currentY = t.clientY;
                const dx = this.touchJoystick.currentX - this.touchJoystick.startX;
                const dy = this.touchJoystick.currentY - this.touchJoystick.startY;
                if (this.player && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                    this.player.targetAngle = Math.atan2(dy, dx);
                }
            }, { passive: false });

            touchZone.addEventListener('touchend', () => {
                this.touchJoystick.active = false;
            });
        }

        const boostBtn = document.getElementById('touchBoostBtn');
        if (boostBtn) {
            boostBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.touchBoosting = true;
                if (this.player) this.player.isBoosting = true;
            });
            boostBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.touchBoosting = false;
                if (this.player && !this.isMouseDown && !this.keys.space && !this.keys.shift) {
                    this.player.isBoosting = false;
                }
            });
        }

        // Touch steering: drag anywhere on the arena to steer (dial anywhere).
        // HUD buttons and touch controls sit above the canvas and keep their
        // own handlers, so they are unaffected.
        this.canvas.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            if (!t) return;
            this.touchJoystick.active = true;
            this.touchJoystick.startX = t.clientX;
            this.touchJoystick.startY = t.clientY;
            this.touchJoystick.currentX = t.clientX;
            this.touchJoystick.currentY = t.clientY;
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            const t = e.touches[0];
            if (!t || !this.touchJoystick.active) return;
            this.touchJoystick.currentX = t.clientX;
            this.touchJoystick.currentY = t.clientY;
            const dx = this.touchJoystick.currentX - this.touchJoystick.startX;
            const dy = this.touchJoystick.currentY - this.touchJoystick.startY;
            if (this.player && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
                this.player.targetAngle = Math.atan2(dy, dx);
            }
            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) this.touchJoystick.active = false;
        });
        this.canvas.addEventListener('touchcancel', () => {
            this.touchJoystick.active = false;
        });
    }

    resetPlayingField() {
        // 1. Clear & repopulate fresh food, sushi, chests, and powerups
        if (this.foodManager) {
            this.foodManager.init();
        }

        // 2. Clear lingering particles, boost trails, floating texts, shockwaves
        if (this.particles) {
            this.particles.clear();
        }

        // 3. Clear existing fish bots and controllers
        this.bots = [];
        this.botControllers = [];
        this.bossFish = null;
        this.bossWave = 1;
        this.gearCheckTimer = 0;
        this.lastAnnouncedTier = 0;

        // 4. Re-initialize themed map decor
        this.initMapDecor();
    }

    startLevelChallenge(levelNum) {
        this.currentChallengeLevel = levelNum;
        this.challengeData = LEVEL_CHALLENGES.find(l => l.level === levelNum) || LEVEL_CHALLENGES[0];
        this.currentMap = FISH_MAPS[this.challengeData.map] || FISH_MAPS.coral_reef;
        this.gameMode = 'challenge';
        this.gameState = 'playing';

        this.resetPlayingField();

        this.modeTimer = this.challengeData.timeLimit || 0;
        this.streak = 0;
        this.streakTimer = 0;
        this.matchKills = 0;
        this.matchChests = 0;
        this.matchGold = 0;
        this.matchFood = 0;
        this.matchTime = 0;
        this.kingTime = 0;

        const startX = 500 + Math.random() * (this.worldWidth - 1000);
        const startY = 500 + Math.random() * (this.worldHeight - 1000);
        this.player = new Fish(
            startX,
            startY,
            this.shop.playerName || 'Player',
            this.shop.selectedFish,
            this.shop.selectedWeapon,
            false,
            this.shop.selectedHat
        );
        this.player.invulnerableTimer = 3.5;
        this.player.spawnProtected = true;

        // Immediate camera alignment
        this.camera.x = startX;
        this.camera.y = startY;
        this.camera.targetX = startX;
        this.camera.targetY = startY;
        this.camera.zoom = 1.0;
        this.camera.targetZoom = 1.0;

        this.player.applyWorkshopUpgrades(this.shop.upgrades);

        // Populate bots
        const skinsList = Object.keys(FISH_SKINS);
        const weaponsList = Object.keys(WEAPON_SKINS);
        const hatsList = Object.keys(FISH_HATS);

        // Spawn Boss if it's a boss challenge stage
        // Challenge difficulty scales with the shop tiers: stage 1 = starter
        // gear, stage 15 = tier-4 enemies. Bosses get the strongest blade their
        // stage allows, so the final fight practically requires endgame gear.
        const stageProgress = Math.min(1, Math.max(0, (this.challengeData.level - 1) / 14));
        const enemyStartLevel = 1 + Math.round(stageProgress * 9);

        if (this.challengeData.isBoss) {
            let bossSkin = 'megalodon';
            let bossWep = 'saw_blade';
            let bossName = '👑 BOSS MEGALODON';
            let bossHat = 'viking_helmet';

            if (this.challengeData.goalType === 'boss_leviathan') {
                bossSkin = 'golden_leviathan';
                bossWep = 'dragon_horn';
                bossName = '👑 GOLDEN LEVIATHAN';
                bossHat = 'mini_crown';
            }

            const bossTier = this.getMaxBotTier();
            if (typeof WEAPON_TIERS !== 'undefined' && window.getWeaponTier && window.getWeaponTier(bossWep) < bossTier) {
                const tierWeapons = WEAPON_TIERS[Math.min(bossTier, WEAPON_TIERS.length - 1)] || [];
                if (tierWeapons.length > 0) bossWep = tierWeapons[tierWeapons.length - 1];
            }

            this.bossFish = new Fish(2000, 2000, bossName, bossSkin, bossWep, true, bossHat);
            this.bossFish.level = enemyStartLevel;
            this.bossFish.isBoss = true;
            // Challenge boss bounty scales with the stage (on top of the stage reward).
            this.bossFish.bossRewardGold = 500 + this.challengeData.level * 300;
            this.bossFish.updateDimensions();
            this.bots.push(this.bossFish);
            this.botControllers.push(new BotController(this.bossFish, Math.min(1, stageProgress + 0.15)));
        } else {
            this.bossFish = null;
        }

        // Spawn supporting arena fish — gear and level both scale with the stage
        const botCount = this.challengeData.isBoss ? 12 : this.targetBotCount;
        for (let i = 0; i < botCount; i++) {
            const bx = 200 + Math.random() * (this.worldWidth - 400);
            const by = 200 + Math.random() * (this.worldHeight - 400);
            const botName = BOT_NAMES[i % BOT_NAMES.length];
            const cGear = this.pickBotGear(this.getMaxBotTier());
            const botSkin = cGear.skinId;
            const botWeapon = cGear.weaponId;
            const botHat = hatsList[Math.floor(Math.random() * hatsList.length)];

            const bot = new Fish(bx, by, botName, botSkin, botWeapon, true, botHat);
            bot.level = enemyStartLevel;
            bot.updateDimensions();
            this.bots.push(bot);
            this.botControllers.push(new BotController(bot, stageProgress));
        }

        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('shopModal').classList.add('hidden');
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
        document.getElementById('gameOverModal').classList.add('hidden');
        document.getElementById('hudOverlay').classList.remove('hidden');

        if (this.soundEngine) {
            this.soundEngine.init();
            this.soundEngine.resume();
        }
    }

    // ===== Gear progression for bots =====
    // 0.0 = match start (starter gear only) ... 1.0 = late game (everything allowed)
    getMatchProgress() {
        if (this.gameMode === 'challenge' && this.challengeData) {
            // Stage number drives difficulty in level challenges
            return Math.min(1, (this.challengeData.level - 1) / 14);
        }
        const timePart = Math.min(1, this.matchTime / 180) * 0.45;
        const lvlPart = Math.min(1, Math.max(0, (this.player ? this.player.level : 1) - 1) / 10) * 0.55;
        let prog = Math.min(1, timePart + lvlPart);
        // Players who bring top-tier gear face tougher bots too
        const myTier = (window.getWeaponTier ? window.getWeaponTier(this.shop.selectedWeapon) : 0);
        prog = Math.max(prog, (myTier / 4) * 0.6);
        return prog;
    }

    getMaxBotTier() {
        const max = (typeof WEAPON_TIERS !== 'undefined') ? WEAPON_TIERS.length - 1 : 4;
        return Math.min(max, Math.round(this.getMatchProgress() * max));
    }

    pickBotTier(maxTier) {
        if (maxTier <= 0) return 0;
        const r = Math.random();
        if (r < 0.10) return Math.max(0, maxTier - 2);
        if (r < 0.35) return maxTier - 1;
        return maxTier;
    }

    pickBotGear(maxTier) {
        const t = this.pickBotTier(maxTier);
        const wt = (typeof WEAPON_TIERS !== 'undefined') ? WEAPON_TIERS : [['coral_dagger']];
        const ft = (typeof FISH_TIERS !== 'undefined') ? FISH_TIERS : [['baby_shark']];
        const wList = wt[Math.min(t, wt.length - 1)] || wt[0];
        const fList = ft[Math.min(t, ft.length - 1)] || ft[0];
        return {
            tier: t,
            weaponId: wList[Math.floor(Math.random() * wList.length)],
            skinId: fList[Math.floor(Math.random() * fList.length)]
        };
    }

    // Bots that level up slowly upgrade into the strongest tier the match allows.
    updateBotGear(dt) {
        this.gearCheckTimer = (this.gearCheckTimer || 0) + dt;
        if (this.gearCheckTimer < 15) return; // ~4 checks/sec at 60fps
        this.gearCheckTimer = 0;

        const capTier = this.getMaxBotTier();

        if (capTier > (this.lastAnnouncedTier || 0) && this.matchTime > 2 && this.gameMode !== 'challenge') {
            this.lastAnnouncedTier = capTier;
            const tierName = (window.GEAR_TIER_NAMES && window.GEAR_TIER_NAMES[capTier]) || `Tier ${capTier + 1}`;
            this.showAnnouncement(`⚔️ LEAGUE UP: ${tierName} blades are entering the reef!`);
        }

        for (const bot of this.bots) {
            if (!bot || bot.isDead || bot.isBoss) continue;
            const curTier = (window.getWeaponTier ? window.getWeaponTier(bot.weaponId) : 0);
            if (bot.level < (bot.gearUpLevel || 3)) continue;
            if (curTier >= capTier) continue; // wait until the match allows stronger gear

            const newTier = Math.min(capTier, curTier + 1);
            const wList = (typeof WEAPON_TIERS !== 'undefined' && WEAPON_TIERS[newTier]) || [];
            if (wList.length) {
                bot.weaponId = wList[Math.floor(Math.random() * wList.length)];
                bot.weapon = WEAPON_SKINS[bot.weaponId] || bot.weapon;
            }
            // Species stays fixed for the whole match — a leveling bot upgrades
            // its blade, it does not morph into another fish.
            bot.gearUpLevel = bot.level + 3;
            bot.updateDimensions();
            bot.invulnerableTimer = Math.max(bot.invulnerableTimer, 0.6);
            if (this.particles) {
                this.particles.addShockwave(bot.x, bot.y, bot.radius * 2.2, '#ffd700');
                this.particles.addFloatingText(bot.x, bot.y - bot.radius - 20, '⚔️ UPGRADED!', '#ffd700', 16);
            }
        }
    }

    startMatch(mode = 'classic') {
        this.gameMode = mode;
        this.gameState = 'playing';
        this.currentMap = FISH_MAPS[this.shop.selectedMap] || FISH_MAPS.coral_reef;

        this.resetPlayingField();

        this.modeTimer = mode === 'frenzy' ? 120 : 0;
        this.bossTimer = 60.0;
        this.streak = 0;
        this.streakTimer = 0;
        this.matchKills = 0;
        this.matchChests = 0;
        this.matchGold = 0;
        this.matchFood = 0;
        this.matchTime = 0;
        this.kingTime = 0;

        const startX = 500 + Math.random() * (this.worldWidth - 1000);
        const startY = 500 + Math.random() * (this.worldHeight - 1000);
        this.player = new Fish(
            startX,
            startY,
            this.shop.playerName || 'Player',
            this.shop.selectedFish,
            this.shop.selectedWeapon,
            false,
            this.shop.selectedHat
        );
        this.player.invulnerableTimer = 3.5;
        this.player.spawnProtected = true;

        // Immediate camera alignment to prevent blank screen
        this.camera.x = startX;
        this.camera.y = startY;
        this.camera.targetX = startX;
        this.camera.targetY = startY;
        this.camera.zoom = 1.0;
        this.camera.targetZoom = 1.0;

        // Apply workshop permanent upgrades
        this.player.applyWorkshopUpgrades(this.shop.upgrades);

        // Populate bots (All starting strictly at Level 1)
        const skinsList = Object.keys(FISH_SKINS);
        const weaponsList = Object.keys(WEAPON_SKINS);
        const hatsList = Object.keys(FISH_HATS);

        for (let i = 0; i < this.targetBotCount; i++) {
            const bx = 200 + Math.random() * (this.worldWidth - 400);
            const by = 200 + Math.random() * (this.worldHeight - 400);
            const botName = BOT_NAMES[i % BOT_NAMES.length] + (Math.random() < 0.3 ? Math.floor(Math.random() * 99) : '');
            const gear = this.pickBotGear(this.getMaxBotTier());
            const botSkin = gear.skinId;
            const botWeapon = gear.weaponId;
            const botHat = hatsList[Math.floor(Math.random() * hatsList.length)];

            const bot = new Fish(bx, by, botName, botSkin, botWeapon, true, botHat);
            this.bots.push(bot);
            this.botControllers.push(new BotController(bot));
        }

        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('shopModal').classList.add('hidden');
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
        document.getElementById('gameOverModal').classList.add('hidden');
        document.getElementById('hudOverlay').classList.remove('hidden');

        if (this.soundEngine) {
            this.soundEngine.init();
            this.soundEngine.resume();
        }
    }

    spawnSingleBot() {
        const skinsList = Object.keys(FISH_SKINS);
        const weaponsList = Object.keys(WEAPON_SKINS);
        const hatsList = Object.keys(FISH_HATS);

        const bx = 200 + Math.random() * (this.worldWidth - 400);
        const by = 200 + Math.random() * (this.worldHeight - 400);
        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (Math.random() < 0.4 ? Math.floor(Math.random() * 99) : '');
        const gear = this.pickBotGear(this.getMaxBotTier());
        const botSkin = gear.skinId;
        const botWeapon = gear.weaponId;
        const botHat = hatsList[Math.floor(Math.random() * hatsList.length)];

        const bot = new Fish(bx, by, botName, botSkin, botWeapon, true, botHat);
        bot.invulnerableTimer = 1.5;
        bot.spawnProtected = true;
        this.bots.push(bot);
        this.botControllers.push(new BotController(bot));
    }

    spawnPeriodicBoss() {
        const bossRoster = [
            { skin: 'megalodon', weapon: 'saw_blade', hat: 'viking_helmet', name: 'TITAN MEGALODON', rewardGold: 500 },
            { skin: 'kraken_squid', weapon: 'thunder_spear', hat: 'mini_crown', name: 'ABYSSAL KRAKEN OVERLORD', rewardGold: 850 },
            { skin: 'cyber_shark', weapon: 'laser_saber', hat: 'devil_horns', name: 'CYBER MECHA LEVIATHAN', rewardGold: 1400 },
            { skin: 'golden_leviathan', weapon: 'dragon_horn', hat: 'mini_crown', name: 'GOLDEN DRAGON GOD', rewardGold: 2200 },
            { skin: 'ghost_shark', weapon: 'excalibur', hat: 'halo', name: 'PHANTOM GHOST TITAN', rewardGold: 3500 }
        ];

        this.bossWave = (this.bossWave || 1);
        const waveIndex = Math.min(this.bossWave - 1, bossRoster.length - 1);
        const choice = bossRoster[waveIndex];
        this.bossWave++;

        const bx = 500 + Math.random() * (this.worldWidth - 1000);
        const by = 500 + Math.random() * (this.worldHeight - 1000);

        const boss = new Fish(bx, by, `💀 ${choice.name}`, choice.skin, choice.weapon, true, choice.hat);
        boss.level = 1;
        boss.isBoss = true;
        boss.bossRewardGold = choice.rewardGold;
        boss.invulnerableTimer = 2.0;
        boss.spawnProtected = true;
        boss.updateDimensions();

        this.bots.push(boss);
        this.botControllers.push(new BotController(boss));

        this.showAnnouncement(`⚠️ DANGER: ${choice.name} (LVL 1) ENTERED THE SEAS! 💀`);
        this.camera.addShake(15);
        if (this.soundEngine) {
            this.soundEngine.playKingSlayer();
        }
    }

    triggerStreak(killer) {
        this.streak++;
        this.streakTimer = 5.0;

        let streakText = '';
        if (this.streak === 2) streakText = 'DOUBLE KILL! 🔥';
        else if (this.streak === 3) streakText = 'TRIPLE KILL! ⚡';
        else if (this.streak === 4) streakText = 'MEGA KILL! 💥';
        else if (this.streak === 5) streakText = 'RAMPAGE! 🌊';
        else if (this.streak >= 6) streakText = 'UNSTOPPABLE! 👑';

        if (streakText && !killer.isBot) {
            this.showAnnouncement(streakText);
            this.soundEngine.playStreak(this.streak);
        }
    }

    showAnnouncement(text) {
        const banner = document.getElementById('killBanner');
        if (banner) {
            banner.textContent = text;
            banner.classList.remove('show');
            void banner.offsetWidth;
            banner.classList.add('show');
        }
    }

    endGame(victory = false) {
        this.gameState = 'gameover';
        if (this.player) {
            this.shop.recordMatch(
                this.player.score,
                this.matchKills,
                this.matchChests,
                this.kingTime,
                this.player.level,
                this.matchFood
            );
            this.shop.addGold(this.matchGold);
            this.notifyMatchBridge({ victory, source: 'match' });
        }

        if (this.soundEngine) {
            this.soundEngine.playGameOver();
        }

        document.getElementById('hudOverlay').classList.add('hidden');
        const modal = document.getElementById('gameOverModal');
        modal.classList.remove('hidden');

        document.getElementById('finalScore').textContent = this.player ? this.player.score : 0;
        document.getElementById('finalKills').textContent = this.matchKills;
        document.getElementById('finalLevel').textContent = this.player ? this.player.level : 1;
        document.getElementById('finalGold').textContent = `+${this.matchGold}`;
        document.getElementById('finalKingTime').textContent = `${Math.floor(this.kingTime)}s`;
        document.getElementById('gameOverTitle').textContent = victory ? 'OCEAN CONQUERED!' : 'YOU WERE SLICED!';
    }

    completeStage() {
        this.gameState = 'stage_clear';
        const stars = 3;
        const reward = this.shop.completeLevelChallenge(this.currentChallengeLevel, stars);

        if (this.soundEngine) {
            this.soundEngine.playJackpot();
        }

        this.notifyMatchBridge({ victory: true, source: 'stage', stageLevel: this.currentChallengeLevel });

        document.getElementById('hudOverlay').classList.add('hidden');
        const modal = document.getElementById('stageClearModal');
        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('stageClearTitle').textContent = `STAGE ${this.currentChallengeLevel} CLEAR!`;
            document.getElementById('stageClearReward').textContent = `+${reward} 💰`;
            document.getElementById('stageClearStars').textContent = '⭐⭐⭐';
        }
    }

    // Bridge to the website layer (accounts / Hedera receipts). Safe no-op when absent.
    notifyMatchBridge(extra = {}) {
        try {
            if (typeof window !== 'undefined' && window.fishMatchBridge && typeof window.fishMatchBridge.onMatchEnd === 'function') {
                window.fishMatchBridge.onMatchEnd({
                    mode: this.gameMode,
                    score: this.player ? this.player.score : 0,
                    kills: this.matchKills,
                    level: this.player ? this.player.level : 1,
                    gold: this.matchGold,
                    food: this.matchFood,
                    chests: this.matchChests,
                    kingTime: Math.floor(this.kingTime),
                    matchTime: this.matchTime,
                    ...extra
                });
            }
        } catch (err) {
            console.warn('Match bridge error:', err);
        }
    }

    update(dt) {
        if (this.gameState !== 'playing') {
            this.particles.update(dt, this.worldWidth, this.worldHeight);
            return;
        }

        // Online (M1): the server owns the world; the online client drives input,
        // prediction, interpolation and the HUD from snapshots.
        if (this.online) {
            this.online.update(dt);
            return;
        }

        this.matchTime += 0.016 * dt;

        if (this.gameMode === 'frenzy') {
            this.modeTimer -= 0.016 * dt;
            if (this.modeTimer <= 0) {
                this.endGame(true);
                return;
            }
        }

        if (this.gameMode === 'challenge' && this.challengeData) {
            if (this.modeTimer > 0) {
                this.modeTimer -= 0.016 * dt;
                if (this.modeTimer <= 0) {
                    this.endGame(false);
                    return;
                }
            }

            // Check stage goal completion
            let completed = false;
            const g = this.challengeData;
            if (g.goalType === 'kills' && this.matchKills >= g.target) completed = true;
            else if (g.goalType === 'kills_timed' && this.matchKills >= g.target) completed = true;
            else if (g.goalType === 'food' && this.matchFood >= g.target) completed = true;
            else if (g.goalType === 'chests' && this.matchChests >= g.target) completed = true;
            else if (g.goalType === 'level' && this.player && this.player.level >= g.target) completed = true;
            else if (g.goalType === 'slay_king' && this.player && this.player.isKing && this.kingTime >= 3) completed = true;
            else if (g.goalType === 'streak' && this.streak >= g.target) completed = true;
            else if ((g.goalType === 'boss_megalodon' || g.goalType === 'boss_leviathan') && this.bossFish && this.bossFish.isDead) completed = true;

            if (completed) {
                this.completeStage();
                return;
            }
        }

        if (this.streakTimer > 0) {
            this.streakTimer -= 0.016 * dt;
            if (this.streakTimer <= 0) {
                this.streak = 0;
            }
        }

        // Periodic Giant Boss Encounter every 60 seconds
        if (this.gameMode === 'classic' || this.gameMode === 'frenzy') {
            this.bossTimer -= 0.016 * dt;
            if (this.bossTimer <= 0) {
                this.bossTimer = 60.0;
                this.spawnPeriodicBoss();
            }
        }

        // 1. Update Player Controls & Movement
        if (this.player && !this.player.isDead) {
            // Check WASD / Arrow Keys
            let kx = 0;
            let ky = 0;
            if (this.keys.w || this.keys.up) ky -= 1;
            if (this.keys.s || this.keys.down) ky += 1;
            if (this.keys.a || this.keys.left) kx -= 1;
            if (this.keys.d || this.keys.right) kx += 1;

            if (kx !== 0 || ky !== 0) {
                this.player.targetAngle = Math.atan2(ky, kx);
            } else if (!this.touchJoystick.active) {
                // If not using keyboard direction keys, steer toward mouse cursor
                const worldMouse = this.camera.screenToWorld(this.mousePos.x, this.mousePos.y);
                const dx = worldMouse.x - this.player.x;
                const dy = worldMouse.y - this.player.y;
                if (Math.hypot(dx, dy) > 20) {
                    this.player.targetAngle = Math.atan2(dy, dx);
                }
            }

            // Sync boosting state across Spacebar, Shift, Left Mouse Button, and Touch Button
            this.player.isBoosting = (this.isMouseDown || this.keys.space || this.keys.shift || this.touchBoosting);

            this.player.update(dt, this.worldWidth, this.worldHeight, this.particles, this.soundEngine);

            if (this.player.isKing) {
                this.kingTime += 0.016 * dt;
            }
        }

        // 2. Update Bots
        const allLivingFish = [];
        if (this.player && !this.player.isDead) allLivingFish.push(this.player);
        for (let i = 0; i < this.bots.length; i++) {
            if (!this.bots[i].isDead) allLivingFish.push(this.bots[i]);
        }

        for (let i = 0; i < this.bots.length; i++) {
            const bot = this.bots[i];
            const controller = this.botControllers[i];
            controller.update(dt, allLivingFish, this.foodManager);
            bot.update(dt, this.worldWidth, this.worldHeight, this.particles, this.soundEngine);
        }

        // 3. Update Camera
        if (this.player && !this.player.isDead) {
            this.camera.update(this.player.x, this.player.y, this.player.radius, dt);
        }

        // 4. Update Food & Particles
        this.foodManager.update(dt);
        this.particles.update(dt, this.worldWidth, this.worldHeight);

        // 5. Collision Checks
        this.handleCollisions(allLivingFish);

        // 6. Manage King of the Sea & Leaderboard (Throttled for Performance)
        this.updateLeaderboard(allLivingFish, dt);

        // 7. Clean dead bots first to avoid array accumulation
        for (let i = this.bots.length - 1; i >= 0; i--) {
            if (this.bots[i].isDead) {
                this.bots.splice(i, 1);
                this.botControllers.splice(i, 1);
            }
        }

        // 8. Respawn Bots in bounded batches to eliminate allocation spikes
        const botsNeeded = Math.min(this.targetBotCount - this.bots.length, 2);
        for (let b = 0; b < botsNeeded; b++) {
            this.spawnSingleBot();
        }

        this.updateBotGear(dt);
        this.updateHUD();
    }

    handleCollisions(allFish) {
        const magnetLevel = this.shop.upgrades.magnet_radius || 0;
        const extraMagnet = 1.0 + magnetLevel * 0.2;

        // A. Food / Sushi Collection (High-Performance Bounding Box Pre-filter)
        for (let fi = 0; fi < allFish.length; fi++) {
            const fish = allFish[fi];
            if (fish.isDead) continue;

            const mouthX = fish.bladeBase.x;
            const mouthY = fish.bladeBase.y;
            const isMagnetActive = fish.powerupTimers.magnet > 0;
            const eatRadius = fish.radius * (isMagnetActive ? 3.5 : 1.35) * extraMagnet;
            const attractRadius = eatRadius * 1.8;
            const attractRadiusSq = attractRadius * attractRadius;
            const eatRadiusSq = eatRadius * eatRadius;

            for (let i = this.foodManager.foods.length - 1; i >= 0; i--) {
                const food = this.foodManager.foods[i];
                const dx = mouthX - food.x;
                if (Math.abs(dx) > attractRadius) continue;
                const dy = mouthY - food.y;
                if (Math.abs(dy) > attractRadius) continue;

                const distSq = dx * dx + dy * dy;

                if (distSq < attractRadiusSq) {
                    food.vx += dx * 0.18;
                    food.vy += dy * 0.18;
                }

                if (distSq < eatRadiusSq) {
                    fish.addXP(food.xp, this.particles, this.soundEngine);

                    // Eating meat drops restores & charges Turbo Stamina!
                    if (food.isMeat) {
                        fish.stamina = Math.min(fish.maxStamina, fish.stamina + 28);
                        if (!fish.isBot) {
                            this.particles.addFloatingText(fish.x, fish.y - fish.radius - 10, '+28 ⚡ STAMINA', '#00f7ff', 16, true);
                        }
                    } else {
                        // Standard sushi/plankton gives a small stamina nibble
                        fish.stamina = Math.min(fish.maxStamina, fish.stamina + 2);
                    }

                    if (!fish.isBot) {
                        this.matchFood++;
                        this.soundEngine.playEat(food.isMeat);
                        if (food.gold > 0) {
                            // Gold drops scale with the collector's level (+8% per level),
                            // so coins/chests keep up with the growing shop prices.
                            const dropBonus = 1 + Math.max(0, fish.level - 1) * 0.08;
                            const goldGain = Math.round(food.gold * dropBonus);
                            this.matchGold += goldGain;
                            this.particles.addFloatingText(
                                food.x,
                                food.y,
                                dropBonus > 1.05 ? `+${goldGain} 💰 ×${dropBonus.toFixed(1)}` : `+${goldGain} 💰`,
                                '#ffd700',
                                14
                            );
                        }
                    }

                    this.foodManager.foods.splice(i, 1);
                }
            }
        }

        // B. Power-up Item Collection
        for (let fi = 0; fi < allFish.length; fi++) {
            const fish = allFish[fi];
            if (fish.isDead) continue;

            for (let i = this.foodManager.powerups.length - 1; i >= 0; i--) {
                const p = this.foodManager.powerups[i];
                const dx = p.x - fish.x;
                const dy = p.y - fish.y;
                const maxCollect = fish.radius + p.radius;
                if (Math.abs(dx) > maxCollect || Math.abs(dy) > maxCollect) continue;

                if (dx * dx + dy * dy < maxCollect * maxCollect) {
                    fish.applyPowerup(p.type, 12, this.particles, this.soundEngine);
                    this.particles.addFloatingText(p.x, p.y, `POWER-UP! ${p.type.replace('_', ' ').toUpperCase()}`, '#ffd700', 20, true);
                    this.foodManager.powerups.splice(i, 1);
                }
            }
        }

        // C. Treasure Chest Blade Smashing
        for (let fi = 0; fi < allFish.length; fi++) {
            const fish = allFish[fi];
            if (fish.isDead) continue;

            for (let i = this.foodManager.chests.length - 1; i >= 0; i--) {
                const c = this.foodManager.chests[i];
                const d = distPointToSegment(
                    c.x, c.y,
                    fish.bladeBase.x, fish.bladeBase.y,
                    fish.bladeTip.x, fish.bladeTip.y
                );

                if (d < c.radius + fish.bladeWidth * 0.5) {
                    c.hp--;
                    c.wobble = 0.4;
                    this.particles.addSparks(c.x, c.y, 8, '#ffd700');

                    if (c.hp <= 0) {
                        // Chest Smashed open!
                        this.particles.addShockwave(c.x, c.y, 90, '#ffd700');
                        this.particles.addFloatingText(c.x, c.y - 20, 'TREASURE UNLOCKED! 💎', '#ffd700', 22, true);
                        this.foodManager.spawnChestLoot(c.x, c.y);
                        this.camera.addShake(8);

                        if (!fish.isBot) {
                            this.matchChests++;
                            this.soundEngine.playChestSmash();
                        }

                        this.foodManager.chests.splice(i, 1);
                    }
                }
            }
        }

        // D. Combat: Blade vs Blade (Parry) & Blade vs Body (Slice Kill!)
        for (let i = 0; i < allFish.length; i++) {
            const f1 = allFish[i];
            if (f1.isDead) continue;

            for (let j = i + 1; j < allFish.length; j++) {
                const f2 = allFish[j];
                if (f2.isDead) continue;

                const maxReach = f1.radius + f2.radius + f1.bladeLength + f2.bladeLength + 20;
                const dx = f1.x - f2.x;
                if (Math.abs(dx) > maxReach) continue;
                const dy = f1.y - f2.y;
                if (Math.abs(dy) > maxReach) continue;

                const distSq = dx * dx + dy * dy;
                if (distSq > maxReach * maxReach) {
                    continue;
                }

                // 1. Blade vs Blade Collision (PARRY)
                const bladeIntersection = getLineIntersection(
                    f1.bladeBase.x, f1.bladeBase.y, f1.bladeTip.x, f1.bladeTip.y,
                    f2.bladeBase.x, f2.bladeBase.y, f2.bladeTip.x, f2.bladeTip.y
                );

                if (bladeIntersection) {
                    const angleF1toF2 = Math.atan2(f2.y - f1.y, f2.x - f1.x);
                    f1.applyParry(angleF1toF2 + Math.PI, 8);
                    f2.applyParry(angleF1toF2, 8);

                    this.particles.addSparks(bladeIntersection.x, bladeIntersection.y, 14, '#ffeb3b');
                    this.particles.addShockwave(bladeIntersection.x, bladeIntersection.y, 35, '#ffeb3b');
                    this.camera.addShake(4);

                    if (!f1.isBot || !f2.isBot) {
                        this.soundEngine.playParry();
                    }
                    continue;
                }

                // 2. F1 Blade vs F2 Body
                if (f2.invulnerableTimer <= 0) {
                    let f2Hit = false;
                    for (let s = 0; s < f2.spine.length; s++) {
                        const joint = f2.spine[s];
                        const jointRadius = f2.radius * (1.0 - (s / f2.spine.length) * 0.45);
                        const d = distPointToSegment(
                            joint.x, joint.y,
                            f1.bladeBase.x, f1.bladeBase.y,
                            f1.bladeTip.x, f1.bladeTip.y
                        );

                        if (d < jointRadius + f1.bladeWidth * 0.5) {
                            f2Hit = true;
                            break;
                        }
                    }

                    if (f2Hit) {
                        // Attacking drops your own *spawn* protection: safe mode is for
                        // surviving contact, not for landing free kills. God-mode (huge
                        // timer) and shield-break grace are not affected.
                        if (f1.spawnProtected) {
                            const spawnTimer = f1.invulnerableTimer <= 3.5 + 0.001;
                            f1.spawnProtected = false;
                            if (spawnTimer) f1.invulnerableTimer = 0;
                        }
                        if (f2.hasShield) {
                            // Pop bubble shield!
                            f2.hasShield = false;
                            f2.invulnerableTimer = 1.0;
                            this.particles.addShockwave(f2.x, f2.y, f2.radius * 3, '#00f7ff');
                            this.soundEngine.playShieldBreak();
                            f1.applyParry(Math.atan2(f1.y - f2.y, f1.x - f2.x), 6);
                        } else {
                            this.killFish(f1, f2, allFish);
                            continue;
                        }
                    }
                }

                // 3. F2 Blade vs F1 Body
                if (f1.invulnerableTimer <= 0) {
                    let f1Hit = false;
                    for (let s = 0; s < f1.spine.length; s++) {
                        const joint = f1.spine[s];
                        const jointRadius = f1.radius * (1.0 - (s / f1.spine.length) * 0.45);
                        const d = distPointToSegment(
                            joint.x, joint.y,
                            f2.bladeBase.x, f2.bladeBase.y,
                            f2.bladeTip.x, f2.bladeTip.y
                        );

                        if (d < jointRadius + f2.bladeWidth * 0.5) {
                            f1Hit = true;
                            break;
                        }
                    }

                    if (f1Hit) {
                        // Attacking drops your own spawn protection (see above).
                        if (f2.spawnProtected) {
                            const spawnTimer = f2.invulnerableTimer <= 3.5 + 0.001;
                            f2.spawnProtected = false;
                            if (spawnTimer) f2.invulnerableTimer = 0;
                        }
                        if (f1.hasShield) {
                            f1.hasShield = false;
                            f1.invulnerableTimer = 1.0;
                            this.particles.addShockwave(f1.x, f1.y, f1.radius * 3, '#00f7ff');
                            this.soundEngine.playShieldBreak();
                            f2.applyParry(Math.atan2(f2.y - f1.y, f2.x - f1.x), 6);
                        } else {
                            this.killFish(f2, f1, allFish);
                        }
                    }
                }
            }
        }
    }

    killFish(killer, victim, allFish = []) {
        if (victim.isDead) return;
        victim.isDead = true;

        this.particles.addFishDeathExplosion(victim.x, victim.y, victim.radius, victim.skin.primaryColor);
        this.foodManager.spawnFishMeatDrops(victim.x, victim.y, victim.radius, victim.level, victim.name);
        this.camera.addShake(10);

        killer.recordKill(victim, this.particles, this.soundEngine, allFish);

        if (!killer.isBot) {
            this.matchKills++;
            // Kill gold scales with the killer's level (+8% per level) so classic
            // runs keep paying more as the player grows.
            const levelBonus = 1 + Math.max(0, killer.level - 1) * 0.08;
            let earnedGold = Math.round((victim.level * 14 + 10) * levelBonus);

            if (victim.isBoss) {
                earnedGold = Math.round((victim.bossRewardGold || 500) * levelBonus);
                this.showAnnouncement(`👑 BOSS SLAIN! +${earnedGold} 💰 & MASSIVE LOOT! 👑`);
                this.camera.addShake(20);
                if (this.soundEngine) this.soundEngine.playJackpot();
                this.foodManager.spawnChestLoot(victim.x, victim.y);
            }

            // Weapon Plunderer Perks
            if (killer.weaponId === 'pirate_sabre') earnedGold = Math.round(earnedGold * 1.5);
            if (killer.weaponId === 'dragon_horn') earnedGold = Math.round(earnedGold * 2.0);
            if (killer.weaponId === 'sonic_lance') earnedGold = Math.round(earnedGold * 1.25);
            if (killer.weaponId === 'leviathan_jaw') earnedGold = Math.round(earnedGold * 2.0);
            if (killer.weaponId === 'meteor_maul') earnedGold = Math.round(earnedGold * 2.5);

            this.matchGold += earnedGold;
            this.particles.addFloatingText(
                victim.x,
                victim.y - victim.radius - 20,
                levelBonus > 1.05 ? `+${earnedGold} 💰 ×${levelBonus.toFixed(1)}` : `+${earnedGold} 💰`,
                '#ffd700',
                24,
                true
            );

            this.triggerStreak(killer);
            this.soundEngine.playSlash();
        }

        if (!victim.isBot) {
            this.camera.addShake(16);
            setTimeout(() => {
                this.endGame(false);
            }, 650);
        }
    }

    updateLeaderboard(allFish, dt = 1) {
        this.leaderboardTimer += 0.016 * dt;
        if (this.leaderboardTimer < 0.2) return; // Update DOM at 5 Hz instead of 60 Hz to prevent frame drops
        this.leaderboardTimer = 0;

        allFish.sort((a, b) => b.score - a.score);

        for (let i = 0; i < allFish.length; i++) {
            allFish[i].isKing = (i === 0 && allFish[0].score > 100);
        }

        if (this.elLeaderboard) {
            let html = '';
            const topCount = Math.min(allFish.length, 10);
            for (let i = 0; i < topCount; i++) {
                const f = allFish[i];
                const isMe = (!f.isBot);
                html += `
                    <div class="lb-row ${isMe ? 'me' : ''} ${f.isKing ? 'king' : ''}">
                        <span class="lb-rank">${i === 0 ? '👑' : `#${i + 1}`}</span>
                        <span class="lb-name">${f.name}<span style="opacity:.65;font-size:.72em;margin-left:4px;">Lv.${f.level}</span></span>
                        <span class="lb-score">${f.score}</span>
                    </div>
                `;
            }
            this.elLeaderboard.innerHTML = html;
        }
    }

    updateHUD() {
        if (!this.player) return;

        const xpRatio = Math.min(1, this.player.xp / this.player.xpForNextLevel);
        if (this.elXpBar) this.elXpBar.style.width = `${xpRatio * 100}%`;
        if (this.elLvl) this.elLvl.textContent = `Lv. ${this.player.level}`;

        const stRatio = Math.min(1, this.player.stamina / this.player.maxStamina);
        if (this.elStaminaBar) this.elStaminaBar.style.width = `${stRatio * 100}%`;

        if (this.elScore) this.elScore.textContent = this.player.score;
        if (this.elKills) this.elKills.textContent = this.matchKills;
        if (this.elGold) this.elGold.textContent = `${this.shop.gold + this.matchGold} 💰`;

        if (this.gameMode === 'frenzy') {
            if (this.elTimerContainer) this.elTimerContainer.classList.remove('hidden');
            if (this.elTimer) this.elTimer.textContent = `${Math.ceil(this.modeTimer)}s`;
            if (this.elGoalBanner) this.elGoalBanner.classList.add('hidden');
        } else if (this.gameMode === 'challenge' && this.challengeData) {
            if (this.elGoalBanner) {
                this.elGoalBanner.classList.remove('hidden');
                let curProg = 0;
                const g = this.challengeData;
                if (g.goalType === 'kills' || g.goalType === 'kills_timed') curProg = this.matchKills;
                else if (g.goalType === 'food') curProg = this.matchFood;
                else if (g.goalType === 'chests') curProg = this.matchChests;
                else if (g.goalType === 'level') curProg = this.player.level;
                else if (g.goalType === 'streak') curProg = this.streak;
                else if (g.isBoss) curProg = (this.bossFish && this.bossFish.isDead) ? 1 : 0;
                else if (g.goalType === 'slay_king') curProg = (this.player.isKing && this.kingTime >= 3) ? 1 : 0;

                this.elGoalBanner.textContent = `🎯 STAGE ${this.currentChallengeLevel}: ${g.desc} (${Math.min(curProg, g.target)}/${g.target})`;
            }
            if (this.modeTimer > 0) {
                if (this.elTimerContainer) this.elTimerContainer.classList.remove('hidden');
                if (this.elTimer) this.elTimer.textContent = `${Math.ceil(this.modeTimer)}s`;
            } else {
                if (this.elTimerContainer) this.elTimerContainer.classList.add('hidden');
            }
        } else {
            if (this.elTimerContainer) this.elTimerContainer.classList.add('hidden');
            if (this.elGoalBanner) this.elGoalBanner.classList.add('hidden');
        }

        this.renderMinimap();
    }

    renderMinimap() {
        if (!this.minimapCtx) return;
        const mctx = this.minimapCtx;
        const mw = this.minimapCanvas.width;
        const mh = this.minimapCanvas.height;

        mctx.clearRect(0, 0, mw, mh);

        mctx.strokeStyle = this.currentMap.barrierColor || '#00f7ff';
        mctx.lineWidth = 1.5;
        mctx.strokeRect(0, 0, mw, mh);

        const scaleX = mw / this.worldWidth;
        const scaleY = mh / this.worldHeight;

        mctx.fillStyle = '#ff4757';
        for (let i = 0; i < this.bots.length; i++) {
            const b = this.bots[i];
            if (b.isDead) continue;
            const mx = b.x * scaleX;
            const my = b.y * scaleY;
            if (b.isKing) {
                mctx.fillStyle = '#ffd700';
                mctx.beginPath();
                mctx.arc(mx, my, 4, 0, Math.PI * 2);
                mctx.fill();
                mctx.fillStyle = '#ff4757';
            } else {
                mctx.beginPath();
                mctx.arc(mx, my, 1.8, 0, Math.PI * 2);
                mctx.fill();
            }
        }

        // Render Chests on minimap
        mctx.fillStyle = '#ffd700';
        for (let i = 0; i < this.foodManager.chests.length; i++) {
            const c = this.foodManager.chests[i];
            mctx.fillRect(c.x * scaleX - 1.5, c.y * scaleY - 1.5, 3, 3);
        }

        if (this.player && !this.player.isDead) {
            const px = this.player.x * scaleX;
            const py = this.player.y * scaleY;
            mctx.fillStyle = '#00f7ff';
            mctx.beginPath();
            mctx.arc(px, py, 3.5, 0, Math.PI * 2);
            mctx.fill();
            mctx.strokeStyle = '#ffffff';
            mctx.lineWidth = 1;
            mctx.stroke();
        }
    }

    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const map = this.currentMap || FISH_MAPS.coral_reef;

        ctx.clearRect(0, 0, w, h);

        // 1. Map Background (Clean & fast)
        ctx.fillStyle = (map && map.bgColor2) || '#071e3d';
        ctx.fillRect(0, 0, w, h);

        try {
            // 2. Arena Grid & Boundaries
            this.renderArenaGrid(ctx);

            // 3. Map Decor (Kelp, Icebergs, Ruins, Vents)
            this.renderMapObstacles(ctx);

            // 4. Food, Drops, Chests, Powerups
            this.foodManager.render(ctx, this.camera);

            // 5. Bots & Player
            for (let i = 0; i < this.bots.length; i++) {
                if (this.bots[i] && !this.bots[i].isDead) {
                    this.bots[i].render(ctx, this.camera);
                }
            }
            if (this.player && !this.player.isDead) {
                this.player.render(ctx, this.camera);
            }

            // 6. Particles
            this.particles.render(ctx, this.camera);

            // 7. Boss Compass / Off-screen Boss Direction Indicator
            if (this.player && !this.player.isDead) {
                this.renderBossIndicator(ctx);
            }

            // 8. Map Lighting / Caustics Overlay
            this.renderCaustics(ctx);
        } catch (e) {
            console.warn('Render pipeline protected:', e);
        }
    }

    renderBossIndicator(ctx) {
        let boss = null;
        for (let i = 0; i < this.bots.length; i++) {
            if (this.bots[i].isBoss && !this.bots[i].isDead) {
                boss = this.bots[i];
                break;
            }
        }
        if (!boss || !this.player) return;

        const screen = this.camera.worldToScreen(boss.x, boss.y);
        const margin = 50;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Only draw indicator if boss is offscreen
        const isOffscreen = screen.x < margin || screen.x > w - margin || screen.y < margin || screen.y > h - margin;
        if (!isOffscreen) return;

        const angle = Math.atan2(boss.y - this.player.y, boss.x - this.player.x);
        const cx = w / 2;
        const cy = h / 2;
        const edgeX = Math.max(margin, Math.min(w - margin, cx + Math.cos(angle) * (w / 2 - margin)));
        const edgeY = Math.max(margin, Math.min(h - margin, cy + Math.sin(angle) * (h / 2 - margin)));

        ctx.save();
        ctx.translate(edgeX, edgeY);
        ctx.rotate(angle);

        // Pulsing red danger beacon arrow
        const pulse = 1 + Math.sin(Date.now() * 0.008) * 0.2;
        ctx.fillStyle = '#ff4757';
        ctx.beginPath();
        ctx.moveTo(18 * pulse, 0);
        ctx.lineTo(-12 * pulse, -12 * pulse);
        ctx.lineTo(-6 * pulse, 0);
        ctx.lineTo(-12 * pulse, 12 * pulse);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();

        // Boss label
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.textAlign = 'center';
        ctx.fillText(`💀 ${boss.name.replace('💀 ', '')}`, edgeX, edgeY - 20);
        ctx.restore();
    }

    renderArenaGrid(ctx) {
        ctx.save();
        const gridSize = 120;
        const z = Math.max(0.2, this.camera.zoom || 1.0);
        const halfVw = (this.camera.viewportWidth / 2) / z;
        const halfVh = (this.camera.viewportHeight / 2) / z;
        const camX = isFinite(this.camera.x) ? this.camera.x : 2000;
        const camY = isFinite(this.camera.y) ? this.camera.y : 2000;

        const startX = Math.max(0, Math.floor((camX - halfVw) / gridSize) * gridSize);
        const endX = Math.min(this.worldWidth, Math.ceil((camX + halfVw) / gridSize) * gridSize);
        const startY = Math.max(0, Math.floor((camY - halfVh) / gridSize) * gridSize);
        const endY = Math.min(this.worldHeight, Math.ceil((camY + halfVh) / gridSize) * gridSize);

        ctx.strokeStyle = this.currentMap.gridColor || 'rgba(0, 247, 255, 0.06)';
        ctx.lineWidth = Math.max(0.5, 1 * z);

        for (let x = startX; x <= endX; x += gridSize) {
            const p1 = this.camera.worldToScreen(x, startY);
            const p2 = this.camera.worldToScreen(x, endY);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        for (let y = startY; y <= endY; y += gridSize) {
            const p1 = this.camera.worldToScreen(startX, y);
            const p2 = this.camera.worldToScreen(endX, y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        const tl = this.camera.worldToScreen(0, 0);
        const br = this.camera.worldToScreen(this.worldWidth, this.worldHeight);
        ctx.strokeStyle = this.currentMap.barrierColor || 'rgba(255, 71, 87, 0.8)';
        ctx.lineWidth = Math.max(2, 4 * this.camera.zoom);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

        ctx.restore();
    }

    renderMapObstacles(ctx) {
        ctx.save();
        const time = Date.now();
        const z = this.camera.zoom;

        // 1. Coral Reef Map: Branching Corals & Kelp
        if (this.currentMap.id === 'coral_reef' || !this.currentMap.id) {
            for (let i = 0; i < this.coralFormations.length; i++) {
                const c = this.coralFormations[i];
                if (!this.camera.isVisible(c.x, c.y, c.radius * 2)) continue;
                const scr = this.camera.worldToScreen(c.x, c.y);
                const cr = c.radius * z;
                const sway = Math.sin(time * c.swaySpeed + c.phase) * (4 * z);

                ctx.save();
                ctx.translate(scr.x, scr.y);
                ctx.fillStyle = c.color;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1 * z;

                for (let b = 0; b < c.branches; b++) {
                    const ba = (b * Math.PI * 2) / c.branches + sway * 0.1;
                    const bx = Math.cos(ba) * cr * 0.7;
                    const by = Math.sin(ba) * cr * 0.7;
                    ctx.beginPath();
                    ctx.arc(bx, by, cr * 0.45, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(0, 0, cr * 0.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }

            for (let i = 0; i < this.kelpForests.length; i++) {
                const k = this.kelpForests[i];
                if (!this.camera.isVisible(k.x, k.y, k.height * 1.5)) continue;
                const screen = this.camera.worldToScreen(k.x, k.y);
                const sway = Math.sin(time * k.swaySpeed + k.phase) * (20 * z);

                ctx.beginPath();
                ctx.moveTo(screen.x - k.width * 0.3 * z, screen.y);
                ctx.quadraticCurveTo(
                    screen.x + sway * 0.5,
                    screen.y - k.height * 0.5 * z,
                    screen.x + sway,
                    screen.y - k.height * z
                );
                ctx.quadraticCurveTo(
                    screen.x + sway * 0.6 + k.width * 0.3 * z,
                    screen.y - k.height * 0.5 * z,
                    screen.x + k.width * 0.3 * z,
                    screen.y
                );
                ctx.closePath();
                ctx.fillStyle = `hsla(${k.hue}, 65%, 32%, 0.28)`;
                ctx.fill();
            }
        }

        // 2. Arctic Ocean: Glacial Icebergs & Floes
        if (this.currentMap.id === 'arctic_ocean') {
            for (let i = 0; i < this.icebergs.length; i++) {
                const b = this.icebergs[i];
                if (!this.camera.isVisible(b.x, b.y, b.radius * 2)) continue;
                const screen = this.camera.worldToScreen(b.x, b.y);
                const r = b.radius * z;

                ctx.save();
                ctx.translate(screen.x, screen.y);
                ctx.rotate(b.rotation);

                // Ice base
                ctx.fillStyle = 'rgba(178, 235, 242, 0.35)';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 * z;
                ctx.beginPath();
                for (let p = 0; p < 7; p++) {
                    const a = (p * Math.PI * 2) / 7;
                    const pr = r * (0.8 + ((p % 2) * 0.25));
                    if (p === 0) ctx.moveTo(Math.cos(a) * pr, Math.sin(a) * pr);
                    else ctx.lineTo(Math.cos(a) * pr, Math.sin(a) * pr);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Snow peak cap
                ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
                ctx.beginPath();
                ctx.arc(0, -r * 0.1, r * 0.45, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // 3. Deep Abyss: Hydrothermal Chimneys & Bioluminescent Jellies
        if (this.currentMap.id === 'deep_abyss') {
            for (let i = 0; i < this.thermalVents.length; i++) {
                const v = this.thermalVents[i];
                if (!this.camera.isVisible(v.x, v.y, 80)) continue;
                const screen = this.camera.worldToScreen(v.x, v.y);
                const r = v.radius * z;

                ctx.save();
                ctx.translate(screen.x, screen.y);
                ctx.fillStyle = '#1e272e';
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#485460';
                ctx.lineWidth = 2 * z;
                ctx.stroke();

                // Glowing Magma Core
                ctx.fillStyle = '#ff4757';
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
                ctx.fill();

                if (Math.random() < 0.25) {
                    this.particles.addBubble(v.x, v.y, (Math.random() - 0.5) * 4, -5, 5 + Math.random() * 5, '#ff4757');
                }
                ctx.restore();
            }

            for (let i = 0; i < this.abyssJellies.length; i++) {
                const j = this.abyssJellies[i];
                if (!this.camera.isVisible(j.x, j.y, 60)) continue;
                const screen = this.camera.worldToScreen(j.x, j.y);
                const r = j.radius * z;
                const sway = Math.sin(time * j.swaySpeed + j.phase) * (6 * z);

                ctx.save();
                ctx.translate(screen.x + sway, screen.y);
                ctx.fillStyle = j.color;
                ctx.globalAlpha = 0.45;
                ctx.beginPath();
                ctx.arc(0, 0, r, Math.PI, 0);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1 * z;
                ctx.stroke();

                // Tentacles
                ctx.strokeStyle = j.color;
                ctx.lineWidth = 1.5 * z;
                for (let t = -2; t <= 2; t++) {
                    ctx.beginPath();
                    ctx.moveTo(t * r * 0.35, 0);
                    ctx.lineTo(t * r * 0.35 + sway * 0.5, r * 1.4);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // 4. Sunken Atlantis: Grecian Fluted Columns & Glowing Runes
        if (this.currentMap.id === 'sunken_atlantis') {
            for (let i = 0; i < this.atlantisRunes.length; i++) {
                const rn = this.atlantisRunes[i];
                if (!this.camera.isVisible(rn.x, rn.y, 90)) continue;
                const screen = this.camera.worldToScreen(rn.x, rn.y);
                const r = rn.radius * z;

                ctx.save();
                ctx.translate(screen.x, screen.y);
                ctx.rotate(rn.rotation);
                ctx.strokeStyle = 'rgba(241, 196, 15, 0.45)';
                ctx.lineWidth = 2 * z;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.stroke();

                // Inner glyph star
                ctx.beginPath();
                for (let p = 0; p < 8; p++) {
                    const a = (p * Math.PI * 2) / 8;
                    const pr = (p % 2 === 0) ? r * 0.8 : r * 0.35;
                    if (p === 0) ctx.moveTo(Math.cos(a) * pr, Math.sin(a) * pr);
                    else ctx.lineTo(Math.cos(a) * pr, Math.sin(a) * pr);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }

            for (let i = 0; i < this.ruins.length; i++) {
                const ru = this.ruins[i];
                if (!this.camera.isVisible(ru.x, ru.y, 90)) continue;
                const screen = this.camera.worldToScreen(ru.x, ru.y);
                const rw = ru.width * z;
                const rh = ru.height * z;

                ctx.save();
                ctx.translate(screen.x, screen.y);
                ctx.rotate(ru.angle);

                // Marble pillar body
                ctx.fillStyle = 'rgba(245, 246, 250, 0.35)';
                ctx.strokeStyle = 'rgba(241, 196, 15, 0.6)';
                ctx.lineWidth = 1.5 * z;
                ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
                ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);

                // Pillar fluting lines
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.lineWidth = 1 * z;
                ctx.beginPath();
                ctx.moveTo(-rw * 0.2, -rh / 2);
                ctx.lineTo(-rw * 0.2, rh / 2);
                ctx.moveTo(rw * 0.2, -rh / 2);
                ctx.lineTo(rw * 0.2, rh / 2);
                ctx.stroke();

                // Golden capital
                ctx.fillStyle = '#f1c40f';
                ctx.fillRect(-rw * 0.65, -rh / 2 - 4 * z, rw * 1.3, 5 * z);
                ctx.fillRect(-rw * 0.65, rh / 2, rw * 1.3, 5 * z);

                ctx.restore();
            }
        }

        ctx.restore();
    }

    renderCaustics(ctx) {
        // Lightweight depth tint without per-frame gradient allocation
        ctx.fillStyle = 'rgba(0, 20, 50, 0.08)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    loop(timestamp) {
        if (this.isPaused) {
            this.lastTime = timestamp;
            requestAnimationFrame((t) => this.loop(t));
            return;
        }

        // The menu screen is opaque and owns the display; skip world simulation
        // and rendering entirely to save CPU/GPU while players browse menus.
        if (this.gameState === 'menu') {
            this.lastTime = timestamp;
            requestAnimationFrame((t) => this.loop(t));
            return;
        }

        const rawDt = (timestamp - this.lastTime) / 16.666;
        const dt = Math.max(0.1, Math.min(1.5, isNaN(rawDt) ? 1.0 : rawDt));
        this.lastTime = timestamp;

        this.update(dt);
        this.render();

        requestAnimationFrame((t) => this.loop(t));
    }
}

window.GameEngine = GameEngine;
