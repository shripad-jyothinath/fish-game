/**
 * Fish IO - Complete Food, Power-ups, Drops & Treasure Chests System
 */
class FoodManager {
    constructor(worldWidth = 3500, worldHeight = 3500, maxFood = 250) {
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.maxFood = maxFood;
        this.foods = [];
        this.chests = [];
        this.powerups = [];
        this.maxChests = 12;
        this.maxPowerups = 8;
        this.init();
    }

    init() {
        this.foods = [];
        this.chests = [];
        this.powerups = [];
        for (let i = 0; i < this.maxFood; i++) {
            this.spawnRandomFood();
        }
        for (let i = 0; i < this.maxChests; i++) {
            this.spawnTreasureChest();
        }
        for (let i = 0; i < this.maxPowerups; i++) {
            this.spawnPowerup();
        }
    }

    spawnRandomFood() {
        const rand = Math.random();
        let type = 'plankton';
        let xp = 1;
        let radius = 4.5;
        let gold = 0;

        if (rand < 0.35) {
            type = 'plankton';
            xp = 1;
            radius = 4;
        } else if (rand < 0.55) {
            type = 'salmon_nigiri';
            xp = 6;
            radius = 8;
        } else if (rand < 0.72) {
            type = 'tuna_nigiri';
            xp = 7;
            radius = 8;
        } else if (rand < 0.85) {
            type = 'shrimp_nigiri';
            xp = 8;
            radius = 8.5;
        } else if (rand < 0.94) {
            type = 'maki_roll';
            xp = 10;
            radius = 9;
        } else if (rand < 0.98) {
            type = 'gold_coin';
            xp = 3;
            gold = 5 + Math.floor(Math.random() * 5);
            radius = 7.5;
        } else {
            type = 'star_orb';
            xp = 25;
            radius = 12;
        }

        this.foods.push({
            id: Math.random().toString(36).substr(2, 9),
            x: 60 + Math.random() * (this.worldWidth - 120),
            y: 60 + Math.random() * (this.worldHeight - 120),
            vx: 0,
            vy: 0,
            radius,
            baseRadius: radius,
            type,
            xp,
            gold,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.02,
            swayPhase: Math.random() * Math.PI * 2,
            isMeat: false
        });
    }

    spawnTreasureChest() {
        this.chests.push({
            id: Math.random().toString(36).substr(2, 9),
            x: 100 + Math.random() * (this.worldWidth - 200),
            y: 100 + Math.random() * (this.worldHeight - 200),
            radius: 22,
            hp: 2,
            maxHp: 2,
            wobble: 0,
            rotation: (Math.random() - 0.5) * 0.2
        });
    }

    spawnPowerup() {
        const types = ['speed_star', 'magnet', 'bubble_shield', 'mega_potion', 'double_xp'];
        const type = types[Math.floor(Math.random() * types.length)];
        this.powerups.push({
            id: Math.random().toString(36).substr(2, 9),
            x: 100 + Math.random() * (this.worldWidth - 200),
            y: 100 + Math.random() * (this.worldHeight - 200),
            type,
            radius: 16,
            rotation: 0,
            swayPhase: Math.random() * Math.PI * 2
        });
    }

    spawnFishMeatDrops(x, y, fishSize, fishLevel, fishName = 'Player') {
        const lvl = Math.max(1, fishLevel || 1);
        // Meat count smoothly scales with the victim's current level
        const count = Math.min(5 + Math.round(lvl * 1.8), 24);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.0 + Math.random() * 5.0;
            const xp = Math.round(8 + Math.pow(lvl, 1.12) * 4);
            const radius = Math.min(8 + (fishSize * 0.12), 18);

            this.foods.push({
                id: Math.random().toString(36).substr(2, 9),
                x: x + Math.cos(angle) * 12,
                y: y + Math.sin(angle) * 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius,
                baseRadius: radius,
                type: 'sashimi_meat',
                xp,
                gold: Math.round(2 + lvl * 1.2),
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.08,
                swayPhase: Math.random() * Math.PI * 2,
                isMeat: true,
                decayTimer: 35.0
            });
        }
    }

    spawnChestLoot(x, y) {
        // Explode into 8 gold coins and 6 sashimi slices
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 6;
            this.foods.push({
                id: Math.random().toString(36).substr(2, 9),
                x: x + Math.cos(angle) * 10,
                y: y + Math.sin(angle) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 9,
                baseRadius: 9,
                type: 'gold_coin',
                xp: 5,
                gold: 10 + Math.floor(Math.random() * 10),
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: 0.05,
                swayPhase: 0,
                isMeat: false
            });
        }
        for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 5;
            this.foods.push({
                id: Math.random().toString(36).substr(2, 9),
                x: x + Math.cos(angle) * 10,
                y: y + Math.sin(angle) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 12,
                baseRadius: 12,
                type: 'sashimi_meat',
                xp: 40,
                gold: 5,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: 0.04,
                swayPhase: 0,
                isMeat: true,
                decayTimer: 45.0
            });
        }
    }

    update(dt = 1) {
        if (this.foods.length < this.maxFood) {
            const needed = Math.min(this.maxFood - this.foods.length, 5);
            for (let i = 0; i < needed; i++) {
                this.spawnRandomFood();
            }
        }

        if (this.chests.length < this.maxChests && Math.random() < 0.015) {
            this.spawnTreasureChest();
        }

        if (this.powerups.length < this.maxPowerups && Math.random() < 0.02) {
            this.spawnPowerup();
        }

        for (let i = this.foods.length - 1; i >= 0; i--) {
            const f = this.foods[i];
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.vx *= 0.92;
            f.vy *= 0.92;

            f.swayPhase += 0.03 * dt;
            f.rotation += f.rotSpeed * dt;

            if (f.x < 30) f.x = 30;
            if (f.x > this.worldWidth - 30) f.x = this.worldWidth - 30;
            if (f.y < 30) f.y = 30;
            if (f.y > this.worldHeight - 30) f.y = this.worldHeight - 30;

            if (f.isMeat) {
                f.decayTimer -= 0.016 * dt;
                if (f.decayTimer <= 0) {
                    this.foods.splice(i, 1);
                }
            }
        }

        for (let i = 0; i < this.powerups.length; i++) {
            const p = this.powerups[i];
            p.swayPhase += 0.04 * dt;
            p.rotation += 0.02 * dt;
        }

        for (let i = 0; i < this.chests.length; i++) {
            const c = this.chests[i];
            if (c.wobble > 0.05) {
                c.wobble *= Math.pow(0.85, dt);
            } else {
                c.wobble = 0;
            }
        }
    }

    render(ctx, camera) {
        ctx.save();

        // 1. Render Treasure Chests
        for (let i = 0; i < this.chests.length; i++) {
            const c = this.chests[i];
            if (!camera.isVisible(c.x, c.y, 60)) continue;
            const screen = camera.worldToScreen(c.x, c.y);
            const r = c.radius * camera.zoom;

            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(c.rotation + Math.sin(Date.now() * 0.03) * c.wobble);

            // Wooden chest box
            ctx.fillStyle = '#6d4c41';
            ctx.beginPath();
            ctx.roundRect(-r * 1.2, -r * 0.9, r * 2.4, r * 1.8, r * 0.25);
            ctx.fill();
            ctx.strokeStyle = '#d7ccc8';
            ctx.lineWidth = 1.5 * camera.zoom;
            ctx.stroke();

            // Gold trims & bands
            ctx.fillStyle = '#ffd700';
            ctx.fillRect(-r * 1.2, -r * 0.2, r * 2.4, r * 0.35);
            ctx.fillRect(-r * 0.35, -r * 0.9, r * 0.7, r * 1.8);

            // Keyhole
            ctx.fillStyle = '#212121';
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }

        // 2. Render Power-ups
        for (let i = 0; i < this.powerups.length; i++) {
            const p = this.powerups[i];
            if (!camera.isVisible(p.x, p.y, 50)) continue;
            const screen = camera.worldToScreen(p.x, p.y);
            const r = p.radius * camera.zoom;
            const floatY = Math.sin(p.swayPhase) * (4 * camera.zoom);

            ctx.save();
            ctx.translate(screen.x, screen.y + floatY);

            // High-visibility orb
            ctx.fillStyle = p.type === 'bubble_shield' ? '#00f7ff' : p.type === 'speed_star' ? '#ffd700' : p.type === 'magnet' ? '#e056fd' : p.type === 'mega_potion' ? '#ff4757' : '#f0932b';
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * camera.zoom;
            ctx.stroke();

            // Powerup Icon Emoji
            ctx.font = `${Math.round(r * 1.2)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let icon = '⚡';
            if (p.type === 'speed_star') icon = '⭐';
            if (p.type === 'magnet') icon = '🧲';
            if (p.type === 'bubble_shield') icon = '🛡️';
            if (p.type === 'mega_potion') icon = '🧪';
            if (p.type === 'double_xp') icon = '2️⃣';
            ctx.fillText(icon, 0, 0);

            ctx.restore();
        }

        // 3. Render Food Items (High-Performance Zero Allocation Loop)
        for (let i = 0; i < this.foods.length; i++) {
            const f = this.foods[i];
            if (!camera.isVisible(f.x, f.y, f.radius * 3)) continue;

            const screen = camera.worldToScreen(f.x, f.y);
            const r = Math.max(1.5, f.radius * camera.zoom);
            const swayOffset = Math.sin(f.swayPhase) * (1.5 * camera.zoom);
            const sy = screen.y + swayOffset;

            if (f.type === 'plankton') {
                // Plankton (Most frequent item - direct draw without matrix save/restore)
                ctx.fillStyle = '#00d2d3';
                ctx.beginPath();
                ctx.arc(screen.x, sy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(screen.x - r * 0.25, sy - r * 0.25, r * 0.35, 0, Math.PI * 2);
                ctx.fill();
            } else if (f.type === 'gold_coin') {
                ctx.fillStyle = '#f1c40f';
                ctx.beginPath();
                ctx.arc(screen.x, sy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#e67e22';
                ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
                ctx.stroke();

                ctx.fillStyle = '#d35400';
                ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('$', screen.x, sy);
            } else if (f.type === 'maki_roll') {
                ctx.fillStyle = '#1e272e';
                ctx.beginPath();
                ctx.arc(screen.x, sy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#f5f6fa';
                ctx.beginPath();
                ctx.arc(screen.x, sy, r * 0.75, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#00b894';
                ctx.beginPath();
                ctx.arc(screen.x - r * 0.15, sy, r * 0.25, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff7675';
                ctx.beginPath();
                ctx.arc(screen.x + r * 0.18, sy, r * 0.22, 0, Math.PI * 2);
                ctx.fill();
            } else if (f.type === 'star_orb') {
                ctx.fillStyle = '#a29bfe';
                ctx.beginPath();
                ctx.arc(screen.x, sy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = Math.max(1, 2 * camera.zoom);
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                for (let p = 0; p < 5; p++) {
                    const a1 = (p * Math.PI * 2) / 5 - Math.PI / 2;
                    const a2 = a1 + Math.PI / 5;
                    const rOuter = r * 0.85;
                    const rInner = r * 0.4;
                    if (p === 0) ctx.moveTo(screen.x + Math.cos(a1) * rOuter, sy + Math.sin(a1) * rOuter);
                    else ctx.lineTo(screen.x + Math.cos(a1) * rOuter, sy + Math.sin(a1) * rOuter);
                    ctx.lineTo(screen.x + Math.cos(a2) * rInner, sy + Math.sin(a2) * rInner);
                }
                ctx.closePath();
                ctx.fill();
            } else if (f.type === 'sashimi_meat') {
                ctx.save();
                ctx.translate(screen.x, sy);
                ctx.rotate(f.rotation);
                ctx.fillStyle = '#ff4757';
                ctx.beginPath();
                ctx.ellipse(0, 0, r * 1.3, r * 0.85, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = Math.max(1, 1.2 * camera.zoom);
                ctx.stroke();
                ctx.restore();
            } else {
                // Nigiri types (Salmon, Tuna, Shrimp)
                ctx.save();
                ctx.translate(screen.x, sy);
                ctx.rotate(f.rotation);

                ctx.fillStyle = '#f8f9fa';
                ctx.beginPath();
                ctx.roundRect(-r * 1.1, -r * 0.6, r * 2.2, r * 1.2, r * 0.4);
                ctx.fill();

                if (f.type === 'salmon_nigiri') {
                    ctx.fillStyle = '#ff7675';
                    ctx.beginPath();
                    ctx.roundRect(-r * 1.2, -r * 0.7, r * 2.4, r * 0.8, r * 0.4);
                    ctx.fill();
                } else if (f.type === 'tuna_nigiri') {
                    ctx.fillStyle = '#d63031';
                    ctx.beginPath();
                    ctx.roundRect(-r * 1.2, -r * 0.7, r * 2.4, r * 0.85, r * 0.4);
                    ctx.fill();
                } else if (f.type === 'shrimp_nigiri') {
                    ctx.fillStyle = '#fab1a0';
                    ctx.beginPath();
                    ctx.roundRect(-r * 1.2, -r * 0.7, r * 2.2, r * 0.8, r * 0.4);
                    ctx.fill();
                }

                ctx.fillStyle = '#2d3436';
                ctx.fillRect(-r * 0.3, -r * 0.7, r * 0.6, r * 1.3);
                ctx.restore();
            }
        }

        ctx.restore();
    }
}

window.FoodManager = FoodManager;
