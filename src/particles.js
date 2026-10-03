/**
 * Fish IO - Particle Systems & Visual Effects Engine
 */
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.floatingTexts = [];
        this.shockwaves = [];
        this.ambientBubbles = [];
        this.maxAmbientBubbles = 120;
        this.initAmbientBubbles();
    }

    clear() {
        this.particles = [];
        this.floatingTexts = [];
        this.shockwaves = [];
    }

    initAmbientBubbles() {
        for (let i = 0; i < this.maxAmbientBubbles; i++) {
            this.ambientBubbles.push({
                x: Math.random() * 4000,
                y: Math.random() * 4000,
                radius: 1 + Math.random() * 3.5,
                speedY: 0.3 + Math.random() * 0.8,
                swaySpeed: 0.02 + Math.random() * 0.03,
                swayAmp: 0.5 + Math.random() * 1.5,
                phase: Math.random() * Math.PI * 2,
                opacity: 0.15 + Math.random() * 0.35
            });
        }
    }

    addBubble(x, y, vx, vy, radius = 3, color = 'rgba(200, 240, 255, 0.7)') {
        this.particles.push({
            type: 'bubble',
            x, y,
            vx: vx + (Math.random() - 0.5) * 0.8,
            vy: vy + (Math.random() - 0.5) * 0.8 - 0.5,
            radius,
            color,
            alpha: 0.8,
            decay: 0.015 + Math.random() * 0.02,
            life: 1.0
        });
    }

    addBoostTrail(x, y, angle, color = '#00f7ff') {
        if (this.particles.length > 200) return;
        const spread = (Math.random() - 0.5) * 0.6;
        const speed = 2 + Math.random() * 2.5;
        this.particles.push({
            type: 'boost',
            x: x + (Math.random() - 0.5) * 4,
            y: y + (Math.random() - 0.5) * 4,
            vx: -Math.cos(angle + spread) * speed,
            vy: -Math.sin(angle + spread) * speed,
            radius: 2.5 + Math.random() * 3,
            color,
            alpha: 0.85,
            decay: 0.05 + Math.random() * 0.03,
            life: 1.0
        });
    }

    addSparks(x, y, count = 18, color = '#ffeb3b') {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 6;
            this.particles.push({
                type: 'spark',
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 2 + Math.random() * 2.5,
                color,
                alpha: 1.0,
                decay: 0.03 + Math.random() * 0.03,
                life: 1.0
            });
        }
    }

    addFishDeathExplosion(x, y, size = 30, color = '#ff3366') {
        const count = 25;
        // Blood / ink clouds
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 5;
            this.particles.push({
                type: 'cloud',
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: (size * 0.2) + Math.random() * (size * 0.3),
                color,
                alpha: 0.75,
                decay: 0.015 + Math.random() * 0.015,
                life: 1.0
            });
        }

        // Bubbles burst
        for (let i = 0; i < 15; i++) {
            this.addBubble(x, y, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 3 + Math.random() * 5);
        }

        // Add shockwave
        this.addShockwave(x, y, size * 2.5, color);
    }

    addShockwave(x, y, maxRadius = 80, color = '#00f7ff') {
        this.shockwaves.push({
            x, y,
            radius: 5,
            maxRadius,
            growth: maxRadius / 15,
            color,
            alpha: 1.0,
            lineWidth: 4
        });
    }

    addFloatingText(x, y, text, color = '#fff', size = 18, isCritical = false) {
        this.floatingTexts.push({
            x, y,
            text,
            color,
            size,
            isCritical,
            vy: -1.8,
            alpha: 1.0,
            scale: isCritical ? 1.5 : 1.0,
            life: 1.0,
            decay: isCritical ? 0.015 : 0.025
        });
    }

    addCrownAura(x, y, radius = 25) {
        if (Math.random() > 0.4) return;
        const angle = Math.random() * Math.PI * 2;
        const dist = radius * (0.8 + Math.random() * 0.4);
        this.particles.push({
            type: 'spark',
            x: x + Math.cos(angle) * dist,
            y: y + Math.sin(angle) * dist,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -1 - Math.random() * 1.5,
            radius: 1.5 + Math.random() * 2,
            color: '#ffd700',
            alpha: 0.9,
            decay: 0.03,
            life: 1.0
        });
    }

    update(dt = 1, worldWidth = 4000, worldHeight = 4000) {
        // Update ambient bubbles
        for (let i = 0; i < this.ambientBubbles.length; i++) {
            const b = this.ambientBubbles[i];
            b.y -= b.speedY * dt;
            b.phase += b.swaySpeed * dt;
            b.x += Math.sin(b.phase) * b.swayAmp * dt;
            if (b.y < -50) {
                b.y = worldHeight + 50;
                b.x = Math.random() * worldWidth;
            }
            if (b.x < -50) b.x = worldWidth + 50;
            if (b.x > worldWidth + 50) b.x = -50;
        }

        // Update active particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.life -= p.decay * dt;
            p.alpha = Math.max(0, p.life);

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Update shockwaves
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const s = this.shockwaves[i];
            s.radius += s.growth * dt;
            s.alpha = Math.max(0, 1 - (s.radius / s.maxRadius));
            s.lineWidth = Math.max(0.5, 4 * s.alpha);
            if (s.radius >= s.maxRadius || s.alpha <= 0) {
                this.shockwaves.splice(i, 1);
            }
        }

        // Update floating texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const t = this.floatingTexts[i];
            t.y += t.vy * dt;
            t.vy *= 0.94;
            t.life -= t.decay * dt;
            t.alpha = Math.max(0, t.life);
            if (t.isCritical && t.scale > 1.0) {
                t.scale -= 0.02 * dt;
            }
            if (t.life <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }
    }

    render(ctx, camera) {
        ctx.save();

        // Render ambient bubbles
        for (let i = 0; i < this.ambientBubbles.length; i++) {
            const b = this.ambientBubbles[i];
            if (!camera.isVisible(b.x, b.y, b.radius * 2)) continue;
            const screen = camera.worldToScreen(b.x, b.y);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, b.radius * camera.zoom, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180, 235, 255, ${b.opacity})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 255, 255, ${b.opacity * 1.2})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }

        // Render shockwaves
        for (let i = 0; i < this.shockwaves.length; i++) {
            const s = this.shockwaves[i];
            if (!camera.isVisible(s.x, s.y, s.radius * 2)) continue;
            const screen = camera.worldToScreen(s.x, s.y);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, s.radius * camera.zoom, 0, Math.PI * 2);
            ctx.strokeStyle = s.color;
            ctx.globalAlpha = s.alpha;
            ctx.lineWidth = s.lineWidth * camera.zoom;
            ctx.stroke();
        }

        // Render particles
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (!camera.isVisible(p.x, p.y, p.radius * 2)) continue;
            const screen = camera.worldToScreen(p.x, p.y);
            const r = Math.max(0.5, p.radius * camera.zoom);

            ctx.globalAlpha = p.alpha;
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);

            if (p.type === 'bubble') {
                ctx.fillStyle = p.color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.5 * camera.zoom;
                ctx.stroke();
            } else if (p.type === 'spark') {
                ctx.fillStyle = p.color;
                ctx.fill();
            } else if (p.type === 'boost') {
                ctx.fillStyle = p.color;
                ctx.fill();
            } else {
                // cloud / splash
                ctx.fillStyle = p.color;
                ctx.fill();
            }
        }

        // Render floating texts
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < this.floatingTexts.length; i++) {
            const t = this.floatingTexts[i];
            if (!camera.isVisible(t.x, t.y, 100)) continue;
            const screen = camera.worldToScreen(t.x, t.y);

            ctx.globalAlpha = t.alpha;
            ctx.font = `bold ${Math.round(t.size * t.scale * camera.zoom)}px 'Segoe UI', Roboto, sans-serif`;

            // Text shadow/outline
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.lineWidth = 3 * camera.zoom;
            ctx.strokeText(t.text, screen.x, screen.y);

            ctx.fillStyle = t.color;
            ctx.fillText(t.text, screen.x, screen.y);
        }

        ctx.restore();
    }
}

window.ParticleSystem = ParticleSystem;
