/**
 * Fish IO - Smart Bot AI Controller
 */
const BOT_NAMES = [
    'SharkBite', 'AquaKing', 'DeepPredator', 'SushiSlayer', 'Poseidon',
    'MegaFin', 'OceanReaper', 'NeonShark', 'TidalWave', 'HydroBlade',
    'AbyssWalker', 'KrakenBane', 'Gladiator', 'SwiftFin', 'Leviathan',
    'ViperFish', 'RazorGills', 'CoralHunter', 'GhostShark', 'SeaDragon',
    'Nemesis', 'AquaStriker', 'Torrent', 'ShadowFin', 'ReefDominator',
    'NemoHunter', 'Megalodon99', 'AbyssLord', 'ChronoShark', 'ApexFin'
];

class BotController {
    constructor(fish) {
        this.fish = fish;
        this.state = 'scavenge';
        this.targetFish = null;
        this.targetFood = null;
        this.targetChest = null;
        this.targetPowerup = null;
        this.stateTimer = 0;
        this.decisionInterval = 0.25;
        this.timeSinceDecision = Math.random() * this.decisionInterval;
        this.fearThreshold = 220;
        this.huntRadius = 480;
    }

    update(dt, allFish, foodManager) {
        if (this.fish.isDead) return;

        this.timeSinceDecision += 0.016 * dt;
        if (this.timeSinceDecision >= this.decisionInterval) {
            this.timeSinceDecision = 0;
            this.makeDecision(allFish, foodManager);
        }

        this.executeState(dt);
    }

    makeDecision(allFish, foodManager) {
        const myX = this.fish.x;
        const myY = this.fish.y;
        const mySize = this.fish.radius;

        // 1. Check for immediate threats (Evasion / Flee)
        let closestThreat = null;
        let threatDistSq = this.fearThreshold * this.fearThreshold;

        for (let i = 0; i < allFish.length; i++) {
            const other = allFish[i];
            if (other === this.fish || other.isDead) continue;

            const dx = other.x - myX;
            if (Math.abs(dx) > this.fearThreshold) continue;
            const dy = other.y - myY;
            if (Math.abs(dy) > this.fearThreshold) continue;

            const distSq = dx * dx + dy * dy;
            if (distSq >= threatDistSq) continue;

            const angleToUs = Math.atan2(myY - other.y, myX - other.x);
            let angleDiff = Math.abs((other.angle - angleToUs) % (Math.PI * 2));
            if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

            const isAimingAtUs = angleDiff < 0.65;
            const isDanger = (other.radius >= mySize * 0.9) || isAimingAtUs;

            if (isDanger) {
                threatDistSq = distSq;
                closestThreat = other;
            }
        }

        if (closestThreat) {
            this.state = 'flee';
            this.targetFish = closestThreat;
            return;
        }

        // 2. Look for Power-ups or Chests nearby
        if (foodManager && foodManager.powerups && foodManager.powerups.length > 0) {
            let closestPowerup = null;
            let pDistSq = 350 * 350;
            for (let i = 0; i < foodManager.powerups.length; i++) {
                const p = foodManager.powerups[i];
                const dx = p.x - myX;
                if (Math.abs(dx) > 350) continue;
                const dy = p.y - myY;
                if (Math.abs(dy) > 350) continue;
                const dSq = dx * dx + dy * dy;
                if (dSq < pDistSq) {
                    pDistSq = dSq;
                    closestPowerup = p;
                }
            }
            if (closestPowerup && Math.random() < 0.7) {
                this.state = 'powerup';
                this.targetPowerup = closestPowerup;
                return;
            }
        }

        // 3. Look for King or vulnerable prey (Hunt)
        let bestTarget = null;
        let bestScore = -Infinity;
        const huntRadiusSq = this.huntRadius * this.huntRadius;

        for (let i = 0; i < allFish.length; i++) {
            const other = allFish[i];
            if (other === this.fish || other.isDead) continue;

            const dx = other.x - myX;
            if (Math.abs(dx) > this.huntRadius) continue;
            const dy = other.y - myY;
            if (Math.abs(dy) > this.huntRadius) continue;

            const distSq = dx * dx + dy * dy;
            if (distSq > huntRadiusSq) continue;

            let score = 0;
            if (other.radius < mySize * 1.1) {
                score += (mySize - other.radius) * 2;
                score += (this.huntRadius - Math.sqrt(distSq));
            }
            if (other.isKing && mySize >= other.radius * 0.8) {
                score += 500;
            }

            if (score > bestScore) {
                bestScore = score;
                bestTarget = other;
            }
        }

        if (bestTarget && bestScore > 0) {
            this.state = 'hunt';
            this.targetFish = bestTarget;
            return;
        }

        // 4. Look for Treasure Chest
        if (foodManager && foodManager.chests && foodManager.chests.length > 0) {
            let closestChest = null;
            let cDistSq = 400 * 400;
            for (let i = 0; i < foodManager.chests.length; i++) {
                const c = foodManager.chests[i];
                const dx = c.x - myX;
                if (Math.abs(dx) > 400) continue;
                const dy = c.y - myY;
                if (Math.abs(dy) > 400) continue;
                const dSq = dx * dx + dy * dy;
                if (dSq < cDistSq) {
                    cDistSq = dSq;
                    closestChest = c;
                }
            }
            if (closestChest && Math.random() < 0.5) {
                this.state = 'chest';
                this.targetChest = closestChest;
                return;
            }
        }

        // 5. Otherwise, scavenge food and meat drops
        this.state = 'scavenge';
        this.findBestFood(foodManager);
    }

    findBestFood(foodManager) {
        if (!foodManager || !foodManager.foods.length) return;

        let bestFood = null;
        let bestFoodScore = Infinity;
        const fx = this.fish.x;
        const fy = this.fish.y;
        const maxDist = 420;
        const foods = foodManager.foods;
        const len = foods.length;
        const step = len > 50 ? Math.floor(len / 35) : 1;

        for (let i = 0; i < len; i += step) {
            const f = foods[i];
            const dx = f.x - fx;
            if (Math.abs(dx) > maxDist) continue;
            const dy = f.y - fy;
            if (Math.abs(dy) > maxDist) continue;

            const distSq = dx * dx + dy * dy;
            let score = distSq;
            if (f.isMeat) score *= 0.35;
            if (f.type === 'star_orb') score *= 0.45;

            if (score < bestFoodScore) {
                bestFoodScore = score;
                bestFood = f;
            }
        }

        this.targetFood = bestFood;
    }

    executeState(dt) {
        switch (this.state) {
            case 'flee': {
                if (this.targetFish && !this.targetFish.isDead) {
                    const dx = this.fish.x - this.targetFish.x;
                    const dy = this.fish.y - this.targetFish.y;
                    this.fish.targetAngle = Math.atan2(dy, dx);
                    const distSq = dx * dx + dy * dy;
                    this.fish.isBoosting = distSq < (180 * 180) && this.fish.stamina > 20;
                } else {
                    this.state = 'scavenge';
                    this.fish.isBoosting = false;
                }
                break;
            }
            case 'hunt': {
                if (this.targetFish && !this.targetFish.isDead) {
                    const targetSpine = this.targetFish.spine[Math.min(2, this.targetFish.spine.length - 1)];
                    const dx = targetSpine.x - this.fish.x;
                    const dy = targetSpine.y - this.fish.y;
                    const distSq = dx * dx + dy * dy;

                    this.fish.targetAngle = Math.atan2(dy, dx);

                    let angleDiff = Math.abs((this.fish.angle - this.fish.targetAngle) % (Math.PI * 2));
                    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

                    this.fish.isBoosting = (distSq < (220 * 220) && distSq > (40 * 40) && angleDiff < 0.35 && this.fish.stamina > 30);
                } else {
                    this.state = 'scavenge';
                    this.fish.isBoosting = false;
                }
                break;
            }
            case 'powerup': {
                if (this.targetPowerup) {
                    const dx = this.targetPowerup.x - this.fish.x;
                    const dy = this.targetPowerup.y - this.fish.y;
                    this.fish.targetAngle = Math.atan2(dy, dx);
                    if (Math.hypot(dx, dy) < this.fish.radius + 20) {
                        this.targetPowerup = null;
                        this.state = 'scavenge';
                    }
                } else {
                    this.state = 'scavenge';
                }
                break;
            }
            case 'chest': {
                if (this.targetChest && this.targetChest.hp > 0) {
                    const dx = this.targetChest.x - this.fish.x;
                    const dy = this.targetChest.y - this.fish.y;
                    this.fish.targetAngle = Math.atan2(dy, dx);
                    this.fish.isBoosting = Math.hypot(dx, dy) < 150;
                } else {
                    this.state = 'scavenge';
                }
                break;
            }
            case 'scavenge':
            default: {
                this.fish.isBoosting = false;
                if (this.targetFood) {
                    const dx = this.targetFood.x - this.fish.x;
                    const dy = this.targetFood.y - this.fish.y;
                    this.fish.targetAngle = Math.atan2(dy, dx);

                    if (Math.hypot(dx, dy) < this.fish.radius + 15) {
                        this.targetFood = null;
                    }
                } else {
                    if (Math.random() < 0.02) {
                        this.fish.targetAngle += (Math.random() - 0.5) * 1.5;
                    }
                }
                break;
            }
        }
    }
}

window.BOT_NAMES = BOT_NAMES;
window.BotController = BotController;
