/**
 * Fish IO - Entities (Fish, Sharks, 14 Weapons, 16 Species, 12 Hats, Power-ups & Kinematics)
 */
class Fish {
    constructor(x, y, name = 'Fish', skinId = 'baby_shark', weaponId = 'coral_dagger', isBot = false, hatId = 'none') {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.y = y;
        this.name = name;
        this.skinId = skinId;
        this.weaponId = weaponId;
        this.hatId = hatId;
        this.isBot = isBot;

        this.skin = FISH_SKINS[skinId] || FISH_SKINS.baby_shark;
        this.weapon = WEAPON_SKINS[weaponId] || WEAPON_SKINS.coral_dagger;
        this.hat = FISH_HATS[hatId] || FISH_HATS.none;

        // Kinematics & orientation
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.vx = 0;
        this.vy = 0;
        this.speed = 0;
        this.baseSpeed = 4.4 * (this.skin.stats?.speed || 1.0);
        this.turnSpeed = 0.14 * (this.skin.stats?.turn || 1.0);

        // Progression & Stats
        this.level = 1;
        this.xp = 0;
        this.xpForNextLevel = 35;
        this.kills = 0;
        this.score = 0;
        this.baseRadius = 22;
        this.radius = this.baseRadius;
        this.isKing = false;
        this.isDead = false;

        // Boost stamina
        this.maxStamina = 100 * (this.skin.stats?.boost || 1.0);
        this.stamina = this.maxStamina;
        this.isBoosting = false;
        this.boostSpeedMultiplier = 1.95;
        this.boostCostRate = 34;
        this.boostRechargeRate = 24;

        // Active Power-ups
        this.hasShield = false;
        this.powerupTimers = {
            speed_star: 0,
            magnet: 0,
            mega_potion: 0,
            double_xp: 0
        };

        // Multi-segment spine chain for procedural swimming animation
        this.numSegments = 6;
        this.spine = [];
        for (let i = 0; i < this.numSegments; i++) {
            this.spine.push({
                x: this.x - Math.cos(this.angle) * (i * 12),
                y: this.y - Math.sin(this.angle) * (i * 12),
                angle: this.angle
            });
        }

        // Blade weapon bounds
        this.bladeBase = { x: this.x, y: this.y };
        this.bladeTip = { x: this.x, y: this.y };
        this.bladeLength = 35;
        this.bladeWidth = 10;
        this.bladeHistory = [];

        // Animation timers
        this.swimPhase = Math.random() * Math.PI * 2;
        this.finPhase = 0;
        this.recoil = 0;
        this.recoilAngle = 0;
        this.invulnerableTimer = 0;
        // Spawn protection is a *kind* of invulnerability: attacking clears it,
        // while god-mode / shield-break grace stay untouched.
        this.spawnProtected = false;

        // Apply initial upgrades if player
        if (!isBot && window.shopManager) {
            const up = window.shopManager.upgrades;
            this.baseSpeed += (up.base_speed || 0) * 0.25;
            this.turnSpeed += (up.turn_speed || 0) * 0.015;
            this.boostSpeedMultiplier += (up.boost_power || 0) * 0.15;
            this.maxStamina += (up.max_stamina || 0) * 20;
            this.stamina = this.maxStamina;
        }
        this.updateDimensions();
    }

    applyWorkshopUpgrades(upgrades) {
        if (!upgrades) return;
        if (upgrades.base_speed) {
            this.baseSpeed += upgrades.base_speed * 0.25;
        }
        if (upgrades.turn_speed) {
            this.turnSpeed += upgrades.turn_speed * 0.015;
        }
        if (upgrades.boost_power) {
            this.boostSpeedMultiplier += upgrades.boost_power * 0.15;
        }
        if (upgrades.max_stamina) {
            this.maxStamina += upgrades.max_stamina * 20;
            this.stamina = this.maxStamina;
        }
        if (upgrades.stamina_regen) {
            this.boostRechargeRate *= (1 + upgrades.stamina_regen * 0.12);
        }
        if (upgrades.starting_size) {
            for (let l = 0; l < upgrades.starting_size; l++) {
                this.addXP(this.xpForNextLevel);
            }
        }
        this.updateDimensions();
    }

    updateDimensions() {
        const megaMult = this.powerupTimers.mega_potion > 0 ? 1.4 : 1.0;
        const speciesGrowth = this.skin.stats?.growth || 1.0;
        // Smooth diminishing returns scaling curve (prevents runaway giant sizes)
        const levelOffset = Math.max(0, this.level - 1);
        const scale = (1 + Math.pow(levelOffset, 0.72) * 0.062 * speciesGrowth) * megaMult;
        this.radius = Math.min(85, this.baseRadius * scale);

        const reachMult = (this.skin.stats?.reach || 1.0) * (this.weapon.lengthMult || 1.0) * megaMult;
        const rawBladeLength = (36 + Math.pow(levelOffset, 0.75) * 4.8 * speciesGrowth) * reachMult;
        this.bladeLength = Math.min(260, rawBladeLength);

        const rawBladeWidth = (9 + Math.pow(levelOffset, 0.68) * 1.1 * speciesGrowth) * (this.weapon.widthMult || 1.0) * megaMult;
        this.bladeWidth = Math.min(48, rawBladeWidth);

        // Weapon passive agility & speed perks
        let weaponTurnBonus = 1.0;
        let weaponSpeedBonus = 1.0;
        if (this.weaponId === 'ninja_katana') weaponTurnBonus = 1.3;
        if (this.weaponId === 'laser_saber') weaponSpeedBonus = 1.35;
        if (this.weaponId === 'chainsaw') this.maxStamina = 200 * (this.skin.stats?.boost || 1.0);
        if (this.weaponId === 'coral_staff') { weaponTurnBonus *= 1.15; weaponSpeedBonus *= 1.10; }
        if (this.weaponId === 'anchor_flail') weaponSpeedBonus *= 0.95;
        if (this.weaponId === 'crown_of_tides') {
            weaponTurnBonus *= 1.2;
            weaponSpeedBonus *= 1.25;
            this.maxStamina = Math.max(this.maxStamina, 150 * (this.skin.stats?.boost || 1.0));
        }

        this.currentTurnSpeed = Math.max(0.06, (this.turnSpeed * weaponTurnBonus) / Math.pow(scale, 0.22));
        this.currentBaseSpeed = Math.max(3.2, (this.baseSpeed * weaponSpeedBonus) / Math.pow(scale, 0.15));
    }

    addXP(amount, particleSystem = null, soundEngine = null) {
        if (this.isDead) return;
        const multiplier = this.powerupTimers.double_xp > 0 ? 2 : 1;
        const finalXP = amount * multiplier;

        this.xp += finalXP;
        this.score += finalXP * 10;

        let leveledUp = false;
        let safety = 0;
        while (this.xp >= this.xpForNextLevel && this.xpForNextLevel > 0 && safety < 30) {
            this.xp -= this.xpForNextLevel;
            this.level++;
            this.xpForNextLevel = Math.max(35, Math.round(35 * Math.pow(this.level, 1.42)));
            this.updateDimensions();
            leveledUp = true;
            safety++;
        }

        if (leveledUp) {
            if (particleSystem) {
                particleSystem.addShockwave(this.x, this.y, this.radius * 3.5, '#00f7ff');
                particleSystem.addFloatingText(this.x, this.y - this.radius - 20, `LEVEL UP! (${this.level})`, '#00f7ff', 24, true);
            }
            if (!this.isBot && soundEngine) {
                soundEngine.playLevelUp();
            }
        }
    }

    recordKill(victim, particleSystem = null, soundEngine = null, allFish = []) {
        this.kills++;
        let bonusXP = Math.round(victim.level * 35 + 60);

        // Weapon OP perks on kill
        if (this.weaponId === 'saw_blade') bonusXP = Math.round(bonusXP * 1.75);
        if (this.weaponId === 'dragon_horn') bonusXP = Math.round(bonusXP * 2.0);
        if (this.weaponId === 'harpoon_gun') bonusXP = Math.round(bonusXP * 1.3);
        if (this.weaponId === 'drill_saw') bonusXP = Math.round(bonusXP * 1.4);
        if (this.weaponId === 'leviathan_jaw') bonusXP = Math.round(bonusXP * 1.5);
        if (this.weaponId === 'meteor_maul') bonusXP = Math.round(bonusXP * 1.75);

        this.addXP(bonusXP, particleSystem, soundEngine);

        // Weapon special combat procs
        if (this.weaponId === 'ice_crystal') {
            // Glacial Crystal Burst on kill
            bonusXP += 60;
            if (particleSystem) {
                particleSystem.addShockwave(this.x, this.y, this.radius * 3.5, '#78ffd6');
                particleSystem.addSparks(this.x, this.y, 20, '#78ffd6');
                particleSystem.addFloatingText(this.x, this.y - this.radius - 55, '❄️ GLACIAL BURST! +60 XP', '#78ffd6', 22, true);
            }
        } else if (this.weaponId === 'thunder_spear' && allFish) {
            // Chain lightning stun on nearby enemies
            for (let i = 0; i < allFish.length; i++) {
                const target = allFish[i];
                if (target !== this && !target.isDead && Math.hypot(target.x - this.x, target.y - this.y) < 320) {
                    target.applyParry(Math.atan2(target.y - this.y, target.x - this.x), 12);
                    if (particleSystem) particleSystem.addSparks(target.x, target.y, 16, '#70a1ff');
                }
            }
            if (particleSystem) {
                particleSystem.addFloatingText(this.x, this.y - this.radius - 55, '⚡ MJOLNIR SHOCKWAVE!', '#70a1ff', 22, true);
            }
        } else if (this.weaponId === 'volcano_magma') {
            if (particleSystem) {
                particleSystem.addShockwave(this.x, this.y, this.radius * 4, '#ff4757');
                particleSystem.addFloatingText(this.x, this.y - this.radius - 55, '🔥 MAGMA BLAST!', '#ff4757', 22, true);
            }
        } else if (this.weaponId === 'eel_whip') {
            this.stamina = Math.min(this.maxStamina, this.stamina + 30);
            if (particleSystem) particleSystem.addSparks(this.x, this.y, 10, '#2ed573');
        } else if (this.weaponId === 'kraken_tentacle') {
            this.stamina = Math.min(this.maxStamina, this.stamina + 45);
            if (particleSystem) {
                particleSystem.addFloatingText(this.x, this.y - this.radius - 55, '🐙 DRAIN +45 ⚡', '#e056fd', 18, true);
            }
        } else if (this.weaponId === 'abyss_scythe') {
            this.powerupTimers.speed_star = Math.max(this.powerupTimers.speed_star, 2.5);
            if (particleSystem) particleSystem.addShockwave(this.x, this.y, this.radius * 3, '#e056fd');
        } else if (this.weaponId === 'meteor_maul') {
            if (particleSystem) {
                particleSystem.addShockwave(this.x, this.y, this.radius * 5, '#ff4757');
                particleSystem.addSparks(this.x, this.y, 18, '#ffa502');
            }
        }

        if (particleSystem) {
            particleSystem.addFloatingText(this.x, this.y - this.radius - 35, `+${bonusXP} XP! KILL #${this.kills}`, '#ffd700', 20, true);
        }

        if (victim.isKing) {
            this.isKing = true;
            if (particleSystem) {
                particleSystem.addShockwave(this.x, this.y, this.radius * 5, '#ffd700');
                particleSystem.addFloatingText(this.x, this.y - this.radius - 60, '👑 KING SLAYER! 👑', '#ffd700', 32, true);
            }
            if (!this.isBot && soundEngine) {
                soundEngine.playKingSlayer();
            }
        }
    }

    applyPowerup(type, duration = 10, particleSystem = null, soundEngine = null) {
        if (type === 'bubble_shield') {
            this.hasShield = true;
            if (particleSystem) particleSystem.addShockwave(this.x, this.y, this.radius * 3, '#00f7ff');
        } else {
            this.powerupTimers[type] = duration;
            this.updateDimensions();
            if (particleSystem) particleSystem.addShockwave(this.x, this.y, this.radius * 2.5, '#ffd700');
        }
        if (!this.isBot && soundEngine) {
            soundEngine.playPowerup();
        }
    }

    applyParry(recoilAngle, strength = 8) {
        this.recoil = strength;
        this.recoilAngle = recoilAngle;
    }

    update(dt, worldWidth, worldHeight, particleSystem = null, soundEngine = null) {
        if (this.isDead) return;

        // Power-up expiration timers
        for (const [key, val] of Object.entries(this.powerupTimers)) {
            if (val > 0) {
                this.powerupTimers[key] = Math.max(0, val - 0.016 * dt);
                if (this.powerupTimers[key] === 0) {
                    this.hasShield = false;
                    this.updateDimensions();
                }
            }
        }

        // Invulnerability
        if (this.invulnerableTimer > 0) {
            this.invulnerableTimer = Math.max(0, this.invulnerableTimer - 0.016 * dt);
            if (this.invulnerableTimer === 0) this.spawnProtected = false;
        }

        // Excalibur Passive Holy Radiance
        if (this.weaponId === 'excalibur') {
            if (!this.hasShield) {
                this.excaliburShieldTimer = (this.excaliburShieldTimer || 0) + 0.016 * dt;
                if (this.excaliburShieldTimer >= 25) {
                    this.excaliburShieldTimer = 0;
                    this.hasShield = true;
                    if (particleSystem) {
                        particleSystem.addShockwave(this.x, this.y, this.radius * 3, '#ffd700');
                        particleSystem.addFloatingText(this.x, this.y - this.radius - 30, '👑 DIVINE SHIELD! 🛡️', '#ffd700', 20, true);
                    }
                }
            }
        }

        // Speed modifiers
        let speedMult = 1.0;
        if (this.powerupTimers.speed_star > 0) speedMult *= 1.45;

        // Boosting (Shift / Space / Mouse Left)
        if (this.isBoosting && this.stamina > 0) {
            speedMult *= this.boostSpeedMultiplier;
            if (this.weaponId === 'anchor_flail') speedMult *= 1.18;
            this.stamina = Math.max(0, this.stamina - this.boostCostRate * 0.016 * dt);

            if (particleSystem && Math.random() < 0.35) {
                const tail = this.spine[this.spine.length - 1];
                particleSystem.addBoostTrail(tail.x, tail.y, tail.angle, this.weapon.glowColor || '#00f7ff');
            }
            if (!this.isBot && soundEngine && Math.random() < 0.08) {
                soundEngine.playBoost();
            }
        } else {
            this.isBoosting = false;
            this.stamina = Math.min(this.maxStamina, this.stamina + this.boostRechargeRate * 0.016 * dt);
        }

        // Fast & Safe angle turning without while loops
        if (!isFinite(this.targetAngle)) this.targetAngle = 0;
        if (!isFinite(this.angle)) this.angle = 0;
        if (!isFinite(this.currentTurnSpeed)) this.currentTurnSpeed = 0.14;

        let diff = (this.targetAngle - this.angle) % (Math.PI * 2);
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * Math.min(1, this.currentTurnSpeed * dt);

        // Velocity
        const targetSpeed = (isFinite(this.currentBaseSpeed) ? this.currentBaseSpeed : 4.4) * speedMult;
        if (!isFinite(this.speed)) this.speed = 0;
        this.speed += (targetSpeed - this.speed) * 0.15 * dt;

        let moveVx = Math.cos(this.angle) * this.speed;
        let moveVy = Math.sin(this.angle) * this.speed;

        if (this.recoil > 0.1 && isFinite(this.recoilAngle)) {
            moveVx += Math.cos(this.recoilAngle) * this.recoil;
            moveVy += Math.sin(this.recoilAngle) * this.recoil;
            this.recoil *= Math.pow(0.88, dt);
        } else {
            this.recoil = 0;
        }

        this.vx = isFinite(moveVx) ? moveVx : 0;
        this.vy = isFinite(moveVy) ? moveVy : 0;
        
        if (!isFinite(this.x)) this.x = 2000;
        if (!isFinite(this.y)) this.y = 2000;

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Arena boundary clamp
        const safeRadius = (isFinite(this.radius) && this.radius > 5) ? this.radius : 22;
        const margin = safeRadius + 15;
        if (this.x < margin) { this.x = margin; this.vx = Math.abs(this.vx); }
        if (this.x > worldWidth - margin) { this.x = worldWidth - margin; this.vx = -Math.abs(this.vx); }
        if (this.y < margin) { this.y = margin; this.vy = Math.abs(this.vy); }
        if (this.y > worldHeight - margin) { this.y = worldHeight - margin; this.vy = -Math.abs(this.vy); }

        // Spine Kinematics
        this.swimPhase += (this.speed * 0.08 + 0.04) * dt;
        this.finPhase += (this.speed * 0.1 + 0.05) * dt;

        this.spine[0].x = this.x;
        this.spine[0].y = this.y;
        this.spine[0].angle = this.angle;

        const segmentDist = (this.radius * 1.5) / this.numSegments;
        for (let i = 1; i < this.numSegments; i++) {
            const prev = this.spine[i - 1];
            const curr = this.spine[i];

            const wiggleAmp = Math.sin(this.swimPhase - i * 0.6) * (i * 1.2 * (this.radius / 20));
            const targetX = prev.x - Math.cos(prev.angle) * segmentDist - Math.sin(prev.angle) * wiggleAmp;
            const targetY = prev.y - Math.sin(prev.angle) * segmentDist + Math.cos(prev.angle) * wiggleAmp;

            curr.x += (targetX - curr.x) * 0.55 * dt;
            curr.y += (targetY - curr.y) * 0.55 * dt;
            curr.angle = Math.atan2(prev.y - curr.y, prev.x - curr.x);
        }

        // Blade Base and Tip
        const snoutOffset = this.radius * 0.95;
        this.bladeBase.x = this.x + Math.cos(this.angle) * snoutOffset;
        this.bladeBase.y = this.y + Math.sin(this.angle) * snoutOffset;

        this.bladeTip.x = this.bladeBase.x + Math.cos(this.angle) * this.bladeLength;
        this.bladeTip.y = this.bladeBase.y + Math.sin(this.angle) * this.bladeLength;

        if (this.bladeHistory.length < 8) {
            this.bladeHistory.unshift({ x: this.bladeTip.x, y: this.bladeTip.y });
        } else {
            const recycled = this.bladeHistory.pop();
            recycled.x = this.bladeTip.x;
            recycled.y = this.bladeTip.y;
            this.bladeHistory.unshift(recycled);
        }

        if (this.isKing && particleSystem) {
            particleSystem.addCrownAura(this.x, this.y, this.radius);
        }
    }

    render(ctx, camera) {
        if (this.isDead) return;
        if (!camera.isVisible(this.x, this.y, this.radius * 4 + this.bladeLength)) return;

        const screen = camera.worldToScreen(this.x, this.y);
        const r = this.radius * camera.zoom;
        const zoom = camera.zoom;

        ctx.save();

        if (this.invulnerableTimer > 0 && Math.floor(Date.now() / 80) % 2 === 0) {
            ctx.globalAlpha = 0.5;
        }

        // 1. Blade Energy Trail
        if (this.bladeHistory.length > 1) {
            ctx.beginPath();
            const firstPt = camera.worldToScreen(this.bladeHistory[0].x, this.bladeHistory[0].y);
            ctx.moveTo(firstPt.x, firstPt.y);
            for (let i = 1; i < this.bladeHistory.length; i++) {
                const pt = camera.worldToScreen(this.bladeHistory[i].x, this.bladeHistory[i].y);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.strokeStyle = this.weapon.trailColor || 'rgba(0, 247, 255, 0.4)';
            ctx.lineWidth = Math.max(1, (this.bladeWidth * 0.6) * zoom);
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // 2. Fish Body & Fins
        this.renderFishBody(ctx, camera, r, zoom);

        // 3. Hat / Accessory
        if (this.hatId && this.hatId !== 'none') {
            this.renderHat(ctx, screen, r, zoom);
        }

        // 4. Blade Weapon
        this.renderBlade(ctx, camera, zoom);

        // 5. Bubble Shield Aura
        if (this.hasShield) {
            ctx.save();
            ctx.strokeStyle = '#00f7ff';
            ctx.fillStyle = 'rgba(0, 247, 255, 0.18)';
            ctx.lineWidth = Math.max(1.5, 3 * zoom);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, (r * 1.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // 6. Crown if King
        if (this.isKing) {
            this.renderCrown(ctx, screen, r, zoom);
        }

        // 7. Nameplate & Level
        this.renderNameplate(ctx, screen, r, zoom);

        ctx.restore();
    }

    renderFishBody(ctx, camera, r, zoom) {
        ctx.save();

        const tailJoint = this.spine[this.spine.length - 1];
        const tailScreen = camera.worldToScreen(tailJoint.x, tailJoint.y);
        const finWiggle = Math.sin(this.swimPhase - 3.5) * 0.35;

        ctx.save();
        ctx.translate(tailScreen.x, tailScreen.y);
        ctx.rotate(tailJoint.angle + finWiggle);

        // Tail fin
        ctx.fillStyle = this.skin.finColor || '#2980b9';
        ctx.beginPath();
        if (this.skinId === 'thresher_shark') {
            // Extra long whip-tail
            ctx.moveTo(0, 0);
            ctx.lineTo(-r * 1.6, -r * 1.1);
            ctx.lineTo(-r * 0.8, 0);
            ctx.lineTo(-r * 1.2, r * 0.5);
        } else {
            ctx.moveTo(0, 0);
            ctx.lineTo(-r * 0.9, -r * 0.7);
            ctx.lineTo(-r * 0.6, 0);
            ctx.lineTo(-r * 0.9, r * 0.7);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1 * zoom;
        ctx.stroke();
        ctx.restore();

        // Pectoral Side Fins
        const midJoint = this.spine[1];
        const midScreen = camera.worldToScreen(midJoint.x, midJoint.y);
        const sideFinFlap = Math.sin(this.finPhase) * 0.25;

        ctx.save();
        ctx.translate(midScreen.x, midScreen.y);
        ctx.rotate(midJoint.angle);

        ctx.fillStyle = this.skin.finColor;
        ctx.beginPath();
        ctx.ellipse(r * 0.1, -r * 0.75, r * 0.45, r * 0.2, -0.4 + sideFinFlap, 0, Math.PI * 2);
        ctx.ellipse(r * 0.1, r * 0.75, r * 0.45, r * 0.2, 0.4 - sideFinFlap, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Hull calculation
        const leftPoints = [];
        const rightPoints = [];

        for (let i = 0; i < this.numSegments; i++) {
            const joint = this.spine[i];
            const scr = camera.worldToScreen(joint.x, joint.y);
            const t = i / (this.numSegments - 1);
            let segmentRadius = r * (1.0 - t * 0.65);
            if (i === 0) segmentRadius = r * 0.95;
            if (i === 1) segmentRadius = r * 1.05;

            const normalAngle = joint.angle + Math.PI / 2;
            leftPoints.push({
                x: scr.x + Math.cos(normalAngle) * segmentRadius,
                y: scr.y + Math.sin(normalAngle) * segmentRadius
            });
            rightPoints.push({
                x: scr.x - Math.cos(normalAngle) * segmentRadius,
                y: scr.y - Math.sin(normalAngle) * segmentRadius
            });
        }

        ctx.beginPath();
        const headScreen = camera.worldToScreen(this.x, this.y);
        const snoutScreen = {
            x: headScreen.x + Math.cos(this.angle) * (r * 1.0),
            y: headScreen.y + Math.sin(this.angle) * (r * 1.0)
        };

        ctx.moveTo(snoutScreen.x, snoutScreen.y);
        for (let i = 0; i < leftPoints.length; i++) ctx.lineTo(leftPoints[i].x, leftPoints[i].y);
        for (let i = rightPoints.length - 1; i >= 0; i--) ctx.lineTo(rightPoints[i].x, rightPoints[i].y);
        ctx.closePath();

        const r0 = Math.max(0.1, r * 0.2);
        const r1 = Math.max(r0 + 0.1, r * 1.4);
        if (isFinite(r0) && isFinite(r1) && isFinite(headScreen.x) && isFinite(headScreen.y)) {
            const bodyGrad = ctx.createRadialGradient(
                headScreen.x, headScreen.y, r0,
                headScreen.x, headScreen.y, r1
            );
            bodyGrad.addColorStop(0, this.skin.secondaryColor || '#ffffff');
            bodyGrad.addColorStop(0.7, this.skin.primaryColor || '#3498db');
            bodyGrad.addColorStop(1.0, this.skin.finColor || '#2980b9');
            ctx.fillStyle = bodyGrad;
        } else {
            ctx.fillStyle = this.skin.primaryColor || '#3498db';
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        ctx.stroke();

        // Custom Species Highlights
        if (this.skinId === 'clownfish') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4 * zoom;
            ctx.beginPath();
            ctx.arc(headScreen.x - Math.cos(this.angle) * (r * 0.3), headScreen.y - Math.sin(this.angle) * (r * 0.3), r * 0.75, this.angle - 1.2, this.angle + 1.2);
            ctx.stroke();
        } else if (this.skinId === 'hammerhead') {
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = this.skin.primaryColor;
            ctx.beginPath();
            ctx.roundRect(r * 0.3, -r * 1.2, r * 0.6, r * 2.4, r * 0.25);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (this.skinId === 'anglerfish') {
            // Glowing Bio-Lure
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.strokeStyle = '#9c27b0';
            ctx.lineWidth = 2 * zoom;
            ctx.beginPath();
            ctx.moveTo(r * 0.5, 0);
            ctx.quadraticCurveTo(r * 0.9, -r * 0.8, r * 1.2, -r * 0.5);
            ctx.stroke();
            ctx.fillStyle = '#00f7ff';
            ctx.beginPath();
            ctx.arc(r * 1.2, -r * 0.5, 4 * zoom, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (this.skinId === 'pufferfish') {
            // Radial spines
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#e67e22';
            for (let sp = 0; sp < 8; sp++) {
                const a = (sp * Math.PI * 2) / 8;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
                ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
                ctx.lineTo(Math.cos(a + 0.2) * r * 0.9, Math.sin(a + 0.2) * r * 0.9);
                ctx.fill();
            }
            ctx.restore();
        } else if (this.skinId === 'tiger_shark') {
            // Dark tiger stripes
            ctx.strokeStyle = '#2d3436';
            ctx.lineWidth = 2.5 * zoom;
            for (let s = 1; s < 4; s++) {
                const j = this.spine[s];
                const js = camera.worldToScreen(j.x, j.y);
                ctx.beginPath();
                ctx.moveTo(js.x - r * 0.4, js.y);
                ctx.lineTo(js.x + r * 0.4, js.y);
                ctx.stroke();
            }
        } else if (this.skinId === 'cyber_shark') {
            ctx.strokeStyle = '#00f7ff';
            ctx.lineWidth = 2.5 * zoom;
            ctx.beginPath();
            ctx.moveTo(headScreen.x, headScreen.y);
            ctx.lineTo(midScreen.x, midScreen.y);
            ctx.stroke();
        } else if (this.skinId === 'manta_ray') {
            // Giant sweeping manta wings
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = this.skin.primaryColor;
            ctx.beginPath();
            ctx.moveTo(r * 0.5, 0);
            ctx.lineTo(-r * 0.4, -r * 2.2);
            ctx.lineTo(-r * 0.9, 0);
            ctx.lineTo(-r * 0.4, r * 2.2);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 * zoom;
            ctx.stroke();
            ctx.restore();
        } else if (this.skinId === 'electric_eel') {
            // Sinuous voltage bands
            ctx.strokeStyle = '#eccc68';
            ctx.lineWidth = 2 * zoom;
            for (let s = 0; s < this.numSegments; s++) {
                const js = camera.worldToScreen(this.spine[s].x, this.spine[s].y);
                ctx.beginPath();
                ctx.arc(js.x, js.y, r * 0.4, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (this.skinId === 'sawshark') {
            // Serrated natural rostral teeth
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#f5f6fa';
            for (let t = 0; t < 6; t++) {
                const tx = r * (0.8 + t * 0.25);
                ctx.fillRect(tx, -r * 0.4, 3 * zoom, 3 * zoom);
                ctx.fillRect(tx, r * 0.3, 3 * zoom, 3 * zoom);
            }
            ctx.restore();
        } else if (this.skinId === 'kraken_squid') {
            // Multi-tentacle abyssal kraken fins
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#8e44ad';
            for (let tn = 0; tn < 6; tn++) {
                const ta = (tn - 2.5) * 0.35;
                ctx.beginPath();
                ctx.moveTo(-r * 0.5, 0);
                ctx.quadraticCurveTo(-r * 1.5, Math.sin(ta) * r * 1.6, -r * 2.0, Math.sin(ta) * r * 1.8);
                ctx.lineWidth = 3 * zoom;
                ctx.strokeStyle = '#e056fd';
                ctx.stroke();
            }
            ctx.restore();
        } else if (this.skinId === 'phoenix_fish') {
            // Blazing solar plumage
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#ffa502';
            ctx.beginPath();
            ctx.moveTo(r * 0.2, -r * 0.6);
            ctx.lineTo(-r * 0.3, -r * 1.8);
            ctx.lineTo(-r * 0.6, -r * 0.6);
            ctx.moveTo(r * 0.2, r * 0.6);
            ctx.lineTo(-r * 0.3, r * 1.8);
            ctx.lineTo(-r * 0.6, r * 0.6);
            ctx.fill();
            ctx.restore();
        } else if (this.skinId === 'sunfish_mola') {
            // Massive vertical disk dorsal and anal fins
            ctx.save();
            ctx.translate(headScreen.x, headScreen.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = '#57606f';
            ctx.fillRect(-r * 0.4, -r * 1.8, r * 0.5, r * 1.2);
            ctx.fillRect(-r * 0.4, r * 0.6, r * 0.5, r * 1.2);
            ctx.restore();
        }

        // Eyes
        ctx.save();
        ctx.translate(headScreen.x, headScreen.y);
        ctx.rotate(this.angle);

        const eyeOffsetX = r * 0.45;
        const eyeOffsetY = this.skinId === 'hammerhead' ? r * 1.1 : r * 0.45;
        const eyeRadius = Math.max(2, r * 0.18);

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(eyeOffsetX, -eyeOffsetY, eyeRadius, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX, eyeOffsetY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1 * zoom;
        ctx.stroke();

        ctx.fillStyle = this.skin.eyeColor || '#000000';
        ctx.beginPath();
        ctx.arc(eyeOffsetX + eyeRadius * 0.35, -eyeOffsetY, eyeRadius * 0.6, 0, Math.PI * 2);
        ctx.arc(eyeOffsetX + eyeRadius * 0.35, eyeOffsetY, eyeRadius * 0.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        ctx.restore();
    }

    renderHat(ctx, screen, r, zoom) {
        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(this.angle);

        const hatX = r * 0.3;
        const hatY = 0;

        switch (this.hatId) {
            case 'pirate_hat':
                ctx.fillStyle = '#1e272e';
                ctx.beginPath();
                ctx.ellipse(hatX, hatY, 14 * zoom, 7 * zoom, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.round(8 * zoom)}px sans-serif`;
                ctx.fillText('☠️', hatX - 4 * zoom, hatY + 3 * zoom);
                break;
            case 'viking_helmet':
                ctx.fillStyle = '#7f8c8d';
                ctx.beginPath();
                ctx.arc(hatX, hatY, 10 * zoom, Math.PI, 0);
                ctx.fill();
                ctx.fillStyle = '#f5f6fa';
                // Horns
                ctx.beginPath();
                ctx.moveTo(hatX - 8 * zoom, hatY);
                ctx.lineTo(hatX - 14 * zoom, hatY - 12 * zoom);
                ctx.lineTo(hatX - 6 * zoom, hatY - 5 * zoom);
                ctx.moveTo(hatX + 8 * zoom, hatY);
                ctx.lineTo(hatX + 14 * zoom, hatY - 12 * zoom);
                ctx.lineTo(hatX + 6 * zoom, hatY - 5 * zoom);
                ctx.fill();
                break;
            case 'mini_crown':
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.moveTo(hatX - 7 * zoom, hatY);
                ctx.lineTo(hatX - 8 * zoom, hatY - 8 * zoom);
                ctx.lineTo(hatX, hatY - 5 * zoom);
                ctx.lineTo(hatX + 8 * zoom, hatY - 8 * zoom);
                ctx.lineTo(hatX + 7 * zoom, hatY);
                ctx.fill();
                break;
            case 'samurai_kabuto':
                ctx.fillStyle = '#c0392b';
                ctx.beginPath();
                ctx.arc(hatX, hatY, 11 * zoom, Math.PI, 0);
                ctx.fill();
                ctx.fillStyle = '#ffd700';
                ctx.fillRect(hatX - 2 * zoom, hatY - 14 * zoom, 4 * zoom, 8 * zoom);
                break;
            case 'diving_goggles':
                ctx.fillStyle = '#f1c40f';
                ctx.fillRect(hatX + 2 * zoom, -8 * zoom, 6 * zoom, 16 * zoom);
                ctx.fillStyle = 'rgba(0, 247, 255, 0.7)';
                ctx.fillRect(hatX + 4 * zoom, -6 * zoom, 4 * zoom, 12 * zoom);
                break;
            case 'top_hat':
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(hatX - 10 * zoom, hatY - 4 * zoom, 20 * zoom, 4 * zoom);
                ctx.fillRect(hatX - 6 * zoom, hatY - 16 * zoom, 12 * zoom, 12 * zoom);
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(hatX - 6 * zoom, hatY - 7 * zoom, 12 * zoom, 3 * zoom);
                break;
            case 'cyber_visor':
                ctx.fillStyle = '#00f7ff';
                ctx.fillRect(hatX + 4 * zoom, -9 * zoom, 4 * zoom, 18 * zoom);
                break;
            case 'chef_hat':
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(hatX - 6 * zoom, hatY - 6 * zoom, 12 * zoom, 6 * zoom);
                ctx.beginPath();
                ctx.arc(hatX, hatY - 12 * zoom, 8 * zoom, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'angel_halo':
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2.5 * zoom;
                ctx.beginPath();
                ctx.ellipse(hatX, hatY - 14 * zoom, 10 * zoom, 4 * zoom, 0, 0, Math.PI * 2);
                ctx.stroke();
                break;
            case 'devil_horns':
                ctx.fillStyle = '#ff4757';
                ctx.beginPath();
                ctx.moveTo(hatX - 5 * zoom, hatY);
                ctx.lineTo(hatX - 9 * zoom, hatY - 12 * zoom);
                ctx.lineTo(hatX - 2 * zoom, hatY - 4 * zoom);
                ctx.moveTo(hatX + 5 * zoom, hatY);
                ctx.lineTo(hatX + 9 * zoom, hatY - 12 * zoom);
                ctx.lineTo(hatX + 2 * zoom, hatY - 4 * zoom);
                ctx.fill();
                break;
            case 'party_hat':
                ctx.fillStyle = '#ff007f';
                ctx.beginPath();
                ctx.moveTo(hatX - 6 * zoom, hatY);
                ctx.lineTo(hatX, hatY - 16 * zoom);
                ctx.lineTo(hatX + 6 * zoom, hatY);
                ctx.fill();
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(hatX, hatY - 16 * zoom, 2.5 * zoom, 0, Math.PI * 2);
                ctx.fill();
                break;
        }

        ctx.restore();
    }

    renderBlade(ctx, camera, zoom) {
        const base = camera.worldToScreen(this.bladeBase.x, this.bladeBase.y);
        const bladeLen = this.bladeLength * zoom;
        const bladeW = this.bladeWidth * zoom;

        ctx.save();
        ctx.translate(base.x, base.y);
        ctx.rotate(this.angle);

        switch (this.weaponId) {
            case 'coral_dagger': {
                // Jagged oceanic coral dagger
                ctx.fillStyle = this.weapon.hiltColor || '#2d3436';
                ctx.fillRect(0, -bladeW * 0.4, bladeLen * 0.12, bladeW * 0.8);

                ctx.fillStyle = this.weapon.bladeColor || '#00cec9';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.12, -bladeW * 0.35);
                ctx.lineTo(bladeLen * 0.4, -bladeW * 0.5);
                ctx.lineTo(bladeLen * 0.45, -bladeW * 0.3);
                ctx.lineTo(bladeLen * 0.75, -bladeW * 0.45);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.75, bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.45, bladeW * 0.3);
                ctx.lineTo(bladeLen * 0.4, bladeW * 0.5);
                ctx.lineTo(bladeLen * 0.12, bladeW * 0.35);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.2 * zoom;
                ctx.stroke();
                break;
            }
            case 'wooden_spear': {
                // Tribal bone spear with cord wrap
                ctx.strokeStyle = '#8d6e63';
                ctx.lineWidth = bladeW * 0.4;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.65, 0);
                ctx.stroke();

                // Cord wrap
                ctx.strokeStyle = '#f5cd79';
                ctx.lineWidth = 2 * zoom;
                for (let c = 1; c < 4; c++) {
                    ctx.beginPath();
                    ctx.moveTo(bladeLen * 0.15 * c, -bladeW * 0.3);
                    ctx.lineTo(bladeLen * 0.15 * c + 4 * zoom, bladeW * 0.3);
                    ctx.stroke();
                }

                // Sharpened bone spearhead
                ctx.fillStyle = '#f5f6fa';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.6, -bladeW * 0.45);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.6, bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.68, 0);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#dcdde1';
                ctx.lineWidth = 1.5 * zoom;
                ctx.stroke();
                break;
            }
            case 'iron_cutlass': {
                // Curved naval cutlass with gold crossguard
                ctx.fillStyle = '#f1c40f';
                ctx.fillRect(0, -bladeW * 0.6, bladeLen * 0.1, bladeW * 1.2);

                ctx.fillStyle = '#dcdde1';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.1, -bladeW * 0.25);
                ctx.quadraticCurveTo(bladeLen * 0.6, -bladeW * 0.45, bladeLen, 0);
                ctx.quadraticCurveTo(bladeLen * 0.5, bladeW * 0.45, bladeLen * 0.1, bladeW * 0.25);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.2 * zoom;
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.15, 0);
                ctx.quadraticCurveTo(bladeLen * 0.55, -bladeW * 0.2, bladeLen * 0.85, 0);
                ctx.stroke();
                break;
            }
            case 'ninja_katana': {
                // Sleek curved Japanese katana
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(0, -bladeW * 0.25, bladeLen * 0.15, bladeW * 0.5);

                // Tsuba guard
                ctx.fillStyle = '#e74c3c';
                ctx.beginPath();
                ctx.ellipse(bladeLen * 0.15, 0, bladeW * 0.2, bladeW * 0.65, 0, 0, Math.PI * 2);
                ctx.fill();

                // Blade
                ctx.fillStyle = '#f5f6fa';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.15, -bladeW * 0.2);
                ctx.quadraticCurveTo(bladeLen * 0.6, -bladeW * 0.35, bladeLen, 0);
                ctx.lineTo(bladeLen * 0.96, bladeW * 0.15);
                ctx.quadraticCurveTo(bladeLen * 0.55, -bladeW * 0.1, bladeLen * 0.15, bladeW * 0.2);
                ctx.closePath();
                ctx.fill();

                // Hamon line
                ctx.strokeStyle = '#00f7ff';
                ctx.lineWidth = 1.2 * zoom;
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.2, -bladeW * 0.05);
                ctx.quadraticCurveTo(bladeLen * 0.6, -bladeW * 0.2, bladeLen * 0.9, 0);
                ctx.stroke();
                break;
            }
            case 'trident': {
                // Majestic 3-pronged golden royal trident
                ctx.strokeStyle = this.weapon.hiltColor || '#d35400';
                ctx.lineWidth = 3 * zoom;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.65, 0);
                ctx.stroke();

                ctx.fillStyle = this.weapon.bladeColor || '#f1c40f';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.65, -bladeW * 0.2);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.65, bladeW * 0.2);
                ctx.moveTo(bladeLen * 0.55, -bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.9, -bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.65, -bladeW * 0.3);
                ctx.moveTo(bladeLen * 0.55, bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.9, bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.65, bladeW * 0.3);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1 * zoom;
                ctx.stroke();
                break;
            }
            case 'pirate_sabre': {
                // Heavy curved pirate scimitar
                ctx.fillStyle = '#f1c40f';
                ctx.beginPath();
                ctx.arc(bladeLen * 0.06, 0, bladeW * 0.55, -Math.PI / 2, Math.PI / 2);
                ctx.fill();

                ctx.fillStyle = '#bdc3c7';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.1, -bladeW * 0.3);
                ctx.quadraticCurveTo(bladeLen * 0.7, -bladeW * 0.7, bladeLen, 0);
                ctx.lineTo(bladeLen * 0.85, bladeW * 0.45);
                ctx.quadraticCurveTo(bladeLen * 0.5, bladeW * 0.3, bladeLen * 0.1, bladeW * 0.3);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#e17055';
                ctx.lineWidth = 1.2 * zoom;
                ctx.stroke();
                break;
            }
            case 'laser_saber': {
                // Ionized plasma energy blade
                ctx.fillStyle = this.weapon.hiltColor || '#2d3436';
                ctx.fillRect(0, -bladeW * 0.25, bladeLen * 0.2, bladeW * 0.5);

                ctx.fillStyle = this.weapon.bladeColor || '#ff007f';
                ctx.beginPath();
                ctx.roundRect(bladeLen * 0.18, -bladeW * 0.3, bladeLen * 0.82, bladeW * 0.6, bladeW * 0.3);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bladeLen * 0.22, -bladeW * 0.12, bladeLen * 0.74, bladeW * 0.24, bladeW * 0.12);
                ctx.fill();
                break;
            }
            case 'saw_blade': {
                // Dual-sided sawtooth ripper
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(0, -bladeW * 0.3, bladeLen * 0.15, bladeW * 0.6);

                ctx.fillStyle = this.weapon.bladeColor || '#e74c3c';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.15, -bladeW * 0.25);
                ctx.lineTo(bladeLen * 0.8, -bladeW * 0.4);
                for (let t = 0; t < 5; t++) {
                    const tx = bladeLen * (0.8 - t * 0.13);
                    ctx.lineTo(tx - bladeLen * 0.04, -bladeW * 0.85);
                    ctx.lineTo(tx - bladeLen * 0.08, -bladeW * 0.35);
                }
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.8, bladeW * 0.4);
                for (let t = 0; t < 5; t++) {
                    const tx = bladeLen * (0.8 - t * 0.13);
                    ctx.lineTo(tx - bladeLen * 0.04, bladeW * 0.85);
                    ctx.lineTo(tx - bladeLen * 0.08, bladeW * 0.35);
                }
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1 * zoom;
                ctx.stroke();
                break;
            }
            case 'ice_crystal': {
                // Glacial ice crystal spear
                ctx.fillStyle = 'rgba(120, 255, 214, 0.85)';
                ctx.beginPath();
                ctx.moveTo(0, -bladeW * 0.2);
                ctx.lineTo(bladeLen * 0.4, -bladeW * 0.55);
                ctx.lineTo(bladeLen * 0.7, -bladeW * 0.35);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.7, bladeW * 0.35);
                ctx.lineTo(bladeLen * 0.4, bladeW * 0.55);
                ctx.lineTo(0, bladeW * 0.2);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5 * zoom;
                ctx.stroke();

                // Facet spine
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen, 0);
                ctx.stroke();
                break;
            }
            case 'volcano_magma': {
                // Molten hydrothermal obsidian blade
                ctx.fillStyle = '#2f3542';
                ctx.fillRect(0, -bladeW * 0.35, bladeLen * 0.15, bladeW * 0.7);

                ctx.fillStyle = '#ff4757';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.15, -bladeW * 0.4);
                ctx.lineTo(bladeLen * 0.5, -bladeW * 0.6);
                ctx.lineTo(bladeLen * 0.55, -bladeW * 0.35);
                ctx.lineTo(bladeLen * 0.85, -bladeW * 0.5);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.85, bladeW * 0.5);
                ctx.lineTo(bladeLen * 0.55, bladeW * 0.35);
                ctx.lineTo(bladeLen * 0.5, bladeW * 0.6);
                ctx.lineTo(bladeLen * 0.15, bladeW * 0.4);
                ctx.closePath();
                ctx.fill();

                // Magma Core
                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.25, 0);
                ctx.lineTo(bladeLen * 0.85, 0);
                ctx.lineWidth = 3 * zoom;
                ctx.strokeStyle = '#ffa502';
                ctx.stroke();
                break;
            }
            case 'excalibur': {
                // Holy radiant broadsword
                ctx.fillStyle = '#f39c12';
                ctx.fillRect(0, -bladeW * 0.65, bladeLen * 0.14, bladeW * 1.3);

                // Sapphire jewel in guard
                ctx.fillStyle = '#00f7ff';
                ctx.beginPath();
                ctx.arc(bladeLen * 0.07, 0, bladeW * 0.25, 0, Math.PI * 2);
                ctx.fill();

                // Divine blade
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.14, -bladeW * 0.32);
                ctx.lineTo(bladeLen * 0.88, -bladeW * 0.32);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.88, bladeW * 0.32);
                ctx.lineTo(bladeLen * 0.14, bladeW * 0.32);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.5 * zoom;
                ctx.stroke();
                break;
            }
            case 'thunder_spear': {
                // Electrified Mjolnir thunder lance
                ctx.strokeStyle = '#5352ed';
                ctx.lineWidth = 3 * zoom;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.4, 0);
                ctx.stroke();

                // Lightning fork blade
                ctx.fillStyle = '#70a1ff';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.4, -bladeW * 0.4);
                ctx.lineTo(bladeLen * 0.6, -bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.65, -bladeW * 0.2);
                ctx.lineTo(bladeLen * 0.85, -bladeW * 0.6);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.85, bladeW * 0.6);
                ctx.lineTo(bladeLen * 0.65, bladeW * 0.2);
                ctx.lineTo(bladeLen * 0.6, bladeW * 0.7);
                ctx.lineTo(bladeLen * 0.4, bladeW * 0.4);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5 * zoom;
                ctx.stroke();
                break;
            }
            case 'chainsaw': {
                // Motorized deep sea chainsaw
                ctx.fillStyle = '#2f3542';
                ctx.fillRect(0, -bladeW * 0.5, bladeLen * 0.22, bladeW);

                ctx.fillStyle = '#ff6348';
                ctx.beginPath();
                ctx.roundRect(bladeLen * 0.2, -bladeW * 0.4, bladeLen * 0.78, bladeW * 0.8, bladeW * 0.3);
                ctx.fill();

                // Spinning chain teeth
                ctx.fillStyle = '#ffffff';
                for (let t = 0; t < 6; t++) {
                    const tx = bladeLen * (0.28 + t * 0.11);
                    ctx.fillRect(tx, -bladeW * 0.55, 3 * zoom, 4 * zoom);
                    ctx.fillRect(tx, bladeW * 0.4, 3 * zoom, 4 * zoom);
                }
                break;
            }
            case 'dragon_horn': {
                // Flaming ancient dragon horn
                ctx.fillStyle = '#6c5ce7';
                ctx.fillRect(0, -bladeW * 0.45, bladeLen * 0.12, bladeW * 0.9);

                ctx.fillStyle = '#ff7675';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.12, -bladeW * 0.4);
                ctx.quadraticCurveTo(bladeLen * 0.5, -bladeW * 0.7, bladeLen, 0);
                ctx.quadraticCurveTo(bladeLen * 0.5, bladeW * 0.7, bladeLen * 0.12, bladeW * 0.4);
                ctx.closePath();
                ctx.fill();

                // Dragon scales
                ctx.strokeStyle = '#d63031';
                ctx.lineWidth = 2 * zoom;
                for (let s = 1; s < 5; s++) {
                    ctx.beginPath();
                    ctx.arc(bladeLen * (0.15 * s), 0, bladeW * 0.25, -Math.PI / 2, Math.PI / 2);
                    ctx.stroke();
                }
                break;
            }
            case 'harpoon_gun': {
                // Harpoon shaft with rope coil and barbed head
                ctx.strokeStyle = '#8d6e63';
                ctx.lineWidth = bladeW * 0.28;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.72, 0);
                ctx.stroke();

                ctx.strokeStyle = '#f5cd79';
                ctx.lineWidth = 1.4 * zoom;
                for (let c = 0; c < 3; c++) {
                    ctx.beginPath();
                    ctx.arc(bladeLen * 0.2, 0, bladeW * (0.45 + c * 0.3), 0, Math.PI * 2);
                    ctx.stroke();
                }

                ctx.fillStyle = this.weapon.bladeColor || '#9ad0f5';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.72, -bladeW * 0.45);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.72, bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.78, 0);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#dfe6e9';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.72, -bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.58, -bladeW * 0.95);
                ctx.lineTo(bladeLen * 0.74, -bladeW * 0.55);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.72, bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.58, bladeW * 0.95);
                ctx.lineTo(bladeLen * 0.74, bladeW * 0.55);
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'coral_staff': {
                // Living coral staff with glowing orb
                ctx.strokeStyle = this.weapon.hiltColor || '#4a148c';
                ctx.lineWidth = bladeW * 0.32;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.92, 0);
                ctx.stroke();

                ctx.fillStyle = this.weapon.glowColor || '#ff6b81';
                ctx.beginPath();
                ctx.arc(bladeLen * 0.5, 0, bladeW * 0.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = this.weapon.bladeColor || '#ff6b81';
                ctx.lineWidth = 2 * zoom;
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.5, -bladeW * 0.4);
                ctx.lineTo(bladeLen * 0.42, -bladeW * 1.15);
                ctx.moveTo(bladeLen * 0.5, bladeW * 0.4);
                ctx.lineTo(bladeLen * 0.42, bladeW * 1.15);
                ctx.moveTo(bladeLen * 0.5, 0);
                ctx.lineTo(bladeLen * 0.64, -bladeW * 0.9);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(bladeLen, 0, bladeW * 0.35, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'anchor_flail': {
                // Chain flail ending in a shipwreck anchor
                ctx.strokeStyle = '#7f8c8d';
                ctx.lineWidth = bladeW * 0.22;
                for (let c = 0; c < 4; c++) {
                    ctx.beginPath();
                    ctx.arc(bladeLen * 0.1 + c * bladeLen * 0.16, 0, bladeW * 0.24, 0, Math.PI * 2);
                    ctx.stroke();
                }

                const ax = bladeLen * 0.82;
                ctx.strokeStyle = this.weapon.bladeColor || '#95a5a6';
                ctx.lineWidth = bladeW * 0.42;
                ctx.beginPath();
                ctx.moveTo(ax, -bladeW * 0.9);
                ctx.lineTo(ax, bladeW * 0.9);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(ax - bladeW * 0.55, -bladeW * 0.4);
                ctx.lineTo(ax, -bladeW * 0.95);
                ctx.lineTo(ax + bladeW * 0.55, -bladeW * 0.4);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(ax - bladeW * 0.65, bladeW * 0.45);
                ctx.quadraticCurveTo(ax, bladeW * 1.4, ax + bladeW * 0.65, bladeW * 0.45);
                ctx.stroke();

                ctx.fillStyle = '#2c3e50';
                ctx.beginPath();
                ctx.arc(ax, 0, bladeW * 0.2, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'eel_whip': {
                // Sinuous electric eel
                ctx.strokeStyle = this.weapon.bladeColor || '#2ed573';
                ctx.lineWidth = bladeW * 0.55;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo(bladeLen * 0.3, -bladeW * 0.95, bladeLen * 0.6, bladeW * 0.95, bladeLen, 0);
                ctx.stroke();

                ctx.strokeStyle = this.weapon.glowColor || '#7bed9f';
                ctx.lineWidth = bladeW * 0.18;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo(bladeLen * 0.3, -bladeW * 0.95, bladeLen * 0.6, bladeW * 0.95, bladeLen, 0);
                ctx.stroke();

                ctx.fillStyle = '#1e90ff';
                ctx.beginPath();
                ctx.arc(bladeLen, 0, bladeW * 0.3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'sonic_lance': {
                // Emitter housing and pulse cone
                ctx.fillStyle = this.weapon.hiltColor || '#2f3542';
                ctx.fillRect(0, -bladeW * 0.4, bladeLen * 0.3, bladeW * 0.8);

                ctx.fillStyle = this.weapon.bladeColor || '#70a1ff';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.3, -bladeW * 0.7);
                ctx.lineTo(bladeLen, -bladeW * 0.15);
                ctx.lineTo(bladeLen, bladeW * 0.15);
                ctx.lineTo(bladeLen * 0.3, bladeW * 0.7);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = 'rgba(159, 216, 255, 0.85)';
                ctx.lineWidth = 1.6 * zoom;
                for (let p = 1; p < 4; p++) {
                    ctx.beginPath();
                    ctx.arc(bladeLen * 0.3, 0, bladeW * 0.3 * p, -0.75, 0.75);
                    ctx.stroke();
                }
                break;
            }
            case 'drill_saw': {
                // Motor block and diamond drill cone
                ctx.fillStyle = this.weapon.hiltColor || '#2f3542';
                ctx.fillRect(0, -bladeW * 0.35, bladeLen * 0.26, bladeW * 0.7);

                ctx.fillStyle = this.weapon.bladeColor || '#ffa502';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.26, -bladeW * 0.55);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.26, bladeW * 0.55);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#2f3542';
                ctx.lineWidth = 2 * zoom;
                for (let g = 1; g < 5; g++) {
                    const gx = bladeLen * (0.26 + g * 0.145);
                    const spread = bladeW * 0.45 * (1 - g / 6.2);
                    ctx.beginPath();
                    ctx.moveTo(gx, -spread);
                    ctx.lineTo(gx + bladeLen * 0.055, spread);
                    ctx.stroke();
                }
                break;
            }
            case 'kraken_tentacle': {
                // Living tentacle with suckers
                ctx.strokeStyle = this.weapon.bladeColor || '#8e44ad';
                ctx.lineWidth = bladeW * 0.8;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo(bladeLen * 0.35, -bladeW * 1.3, bladeLen * 0.55, bladeW * 1.2, bladeLen, bladeW * 0.35);
                ctx.stroke();

                ctx.strokeStyle = this.weapon.glowColor || '#e056fd';
                ctx.lineWidth = bladeW * 0.24;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo(bladeLen * 0.35, -bladeW * 1.3, bladeLen * 0.55, bladeW * 1.2, bladeLen, bladeW * 0.35);
                ctx.stroke();

                ctx.fillStyle = '#f5f6fa';
                for (let s = 1; s < 5; s++) {
                    const t = s / 5;
                    ctx.beginPath();
                    ctx.arc(bladeLen * t, Math.sin(t * Math.PI) * -bladeW * 0.55, bladeW * 0.09, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            }
            case 'leviathan_jaw': {
                // Twin jaws of serrated teeth
                ctx.fillStyle = this.weapon.hiltColor || '#2d3436';
                ctx.beginPath();
                ctx.moveTo(0, -bladeW * 0.5);
                ctx.lineTo(bladeLen * 0.85, -bladeW * 0.8);
                ctx.lineTo(bladeLen, -bladeW * 0.1);
                ctx.lineTo(0, -bladeW * 0.15);
                ctx.closePath();
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(0, bladeW * 0.5);
                ctx.lineTo(bladeLen * 0.85, bladeW * 0.8);
                ctx.lineTo(bladeLen, bladeW * 0.1);
                ctx.lineTo(0, bladeW * 0.15);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#f5f6fa';
                for (let t = 0; t < 6; t++) {
                    const tx = bladeLen * (0.08 + t * 0.135);
                    ctx.beginPath();
                    ctx.moveTo(tx, -bladeW * 0.62);
                    ctx.lineTo(tx + bladeLen * 0.05, -bladeW * 0.16);
                    ctx.lineTo(tx + bladeLen * 0.1, -bladeW * 0.62);
                    ctx.closePath();
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(tx, bladeW * 0.62);
                    ctx.lineTo(tx + bladeLen * 0.05, bladeW * 0.16);
                    ctx.lineTo(tx + bladeLen * 0.1, bladeW * 0.62);
                    ctx.closePath();
                    ctx.fill();
                }

                ctx.strokeStyle = 'rgba(0, 206, 201, 0.9)';
                ctx.lineWidth = 2 * zoom;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.95, 0);
                ctx.stroke();
                break;
            }
            case 'abyss_scythe': {
                // Crescent harvest blade
                ctx.fillStyle = this.weapon.hiltColor || '#1e272e';
                ctx.fillRect(0, -bladeW * 0.35, bladeLen * 0.38, bladeW * 0.7);

                ctx.fillStyle = this.weapon.bladeColor || '#e056fd';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.32, bladeW * 0.45);
                ctx.quadraticCurveTo(bladeLen * 0.78, -bladeW * 1.25, bladeLen, -bladeW * 0.35);
                ctx.quadraticCurveTo(bladeLen * 0.6, -bladeW * 0.1, bladeLen * 0.32, -bladeW * 0.15);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = this.weapon.glowColor || '#8e44ad';
                ctx.lineWidth = 1.5 * zoom;
                ctx.stroke();
                break;
            }
            case 'crown_of_tides': {
                // Royal trident-crown
                ctx.fillStyle = this.weapon.hiltColor || '#0a3d62';
                ctx.fillRect(0, -bladeW * 0.5, bladeLen * 0.16, bladeW);

                ctx.strokeStyle = this.weapon.bladeColor || '#FFD740';
                ctx.lineWidth = bladeW * 0.3;
                for (let p = -1; p <= 1; p++) {
                    ctx.beginPath();
                    ctx.moveTo(bladeLen * 0.16, 0);
                    ctx.lineTo(bladeLen * 0.78, p * bladeW * 1.05);
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.16, 0);
                ctx.lineTo(bladeLen, 0);
                ctx.stroke();

                ctx.fillStyle = this.weapon.glowColor || '#00f7ff';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.5, -bladeW * 0.45);
                ctx.lineTo(bladeLen * 0.62, -bladeW * 1.05);
                ctx.lineTo(bladeLen * 0.74, -bladeW * 0.45);
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'meteor_maul': {
                // Chain handle and molten hammer head
                ctx.strokeStyle = '#6c5ce7';
                ctx.lineWidth = bladeW * 0.3;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(bladeLen * 0.58, 0);
                ctx.stroke();

                ctx.fillStyle = this.weapon.hiltColor || '#2c3e50';
                ctx.beginPath();
                ctx.roundRect(bladeLen * 0.54, -bladeW * 1.4, bladeLen * 0.44, bladeW * 2.8, bladeW * 0.25);
                ctx.fill();

                ctx.strokeStyle = this.weapon.bladeColor || '#ff4757';
                ctx.lineWidth = 2 * zoom;
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.62, -bladeW * 0.9);
                ctx.lineTo(bladeLen * 0.73, -bladeW * 0.2);
                ctx.lineTo(bladeLen * 0.64, bladeW * 0.4);
                ctx.lineTo(bladeLen * 0.8, bladeW * 0.95);
                ctx.stroke();

                ctx.fillStyle = '#ffa502';
                ctx.beginPath();
                ctx.arc(bladeLen * 0.76, 0, bladeW * 0.18, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            default: {
                ctx.fillStyle = this.weapon.hiltColor || '#2c3e50';
                ctx.fillRect(0, -bladeW * 0.5, bladeLen * 0.12, bladeW);

                ctx.fillStyle = this.weapon.bladeColor || '#00cec9';
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.12, -bladeW * 0.3);
                ctx.lineTo(bladeLen * 0.85, -bladeW * 0.3);
                ctx.lineTo(bladeLen, 0);
                ctx.lineTo(bladeLen * 0.85, bladeW * 0.3);
                ctx.lineTo(bladeLen * 0.12, bladeW * 0.3);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.2 * zoom;
                ctx.beginPath();
                ctx.moveTo(bladeLen * 0.15, 0);
                ctx.lineTo(bladeLen * 0.75, 0);
                ctx.stroke();
                break;
            }
        }

        ctx.restore();
    }

    renderCrown(ctx, screen, r, zoom) {
        ctx.save();
        const crownHover = Math.sin(Date.now() * 0.005) * 5 * zoom;
        const crownY = screen.y - r - 28 * zoom + crownHover;

        ctx.translate(screen.x, crownY);

        ctx.fillStyle = '#ffd700';

        const cw = 22 * zoom;
        const ch = 14 * zoom;

        ctx.beginPath();
        ctx.moveTo(-cw, ch);
        ctx.lineTo(-cw * 1.1, -ch * 0.5);
        ctx.lineTo(-cw * 0.45, 0);
        ctx.lineTo(0, -ch * 0.9);
        ctx.lineTo(cw * 0.45, 0);
        ctx.lineTo(cw * 1.1, -ch * 0.5);
        ctx.lineTo(cw, ch);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ff4757';
        ctx.beginPath();
        ctx.arc(0, -ch * 0.3, 2.5 * zoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#00f7ff';
        ctx.beginPath();
        ctx.arc(-cw * 0.65, 0, 2 * zoom, 0, Math.PI * 2);
        ctx.arc(cw * 0.65, 0, 2 * zoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    renderNameplate(ctx, screen, r, zoom) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const fontSize = Math.max(10, Math.round(12 * zoom));
        ctx.font = `bold ${fontSize}px 'Segoe UI', Roboto, sans-serif`;

        const nameY = screen.y - r - (this.isKing ? 38 : 16) * zoom;

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 3 * zoom;
        const label = `${this.isKing ? '👑 ' : ''}${this.name} (Lv.${this.level})`;
        ctx.strokeText(label, screen.x, nameY);

        ctx.fillStyle = this.isKing ? '#ffd700' : (this.isBot ? '#e8edf4' : '#00f7ff');
        ctx.fillText(label, screen.x, nameY);

        if (!this.isBot || this.isBoosting) {
            const barW = Math.max(26, r * 1.2);
            const barH = Math.max(3, 4 * zoom);
            const barY = screen.y + r + 12 * zoom;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(screen.x - barW / 2, barY, barW, barH);

            const fillRatio = this.stamina / this.maxStamina;
            ctx.fillStyle = fillRatio > 0.3 ? '#00f7ff' : '#ff4757';
            ctx.fillRect(screen.x - barW / 2, barY, barW * fillRatio, barH);
        }

        ctx.restore();
    }
}

window.Fish = Fish;
