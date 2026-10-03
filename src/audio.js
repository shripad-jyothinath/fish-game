/**
 * Fish IO - Web Audio API Procedural Sound Synthesizer
 * Zero external audio files required - works offline and instantly!
 */
class SoundEngine {
    constructor() {
        this.ctx = null;
        this.masterVolume = 0.8;
        this.sfxEnabled = true;
        this.musicEnabled = true;
        this.ambientNode = null;
        this.ambientGain = null;
        this.isInitialized = false;

        this.unlockHandler = () => {
            this.init();
            window.removeEventListener('click', this.unlockHandler);
            window.removeEventListener('keydown', this.unlockHandler);
            window.removeEventListener('touchstart', this.unlockHandler);
        };
        window.addEventListener('click', this.unlockHandler, { once: true });
        window.addEventListener('keydown', this.unlockHandler, { once: true });
        window.addEventListener('touchstart', this.unlockHandler, { once: true });
    }

    init() {
        if (this.isInitialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
            this.masterGain.connect(this.ctx.destination);

            // Pre-allocate slash sound buffer once to eliminate real-time memory allocations
            const slashBufSize = Math.floor(this.ctx.sampleRate * 0.18);
            this.slashBuffer = this.ctx.createBuffer(1, slashBufSize, this.ctx.sampleRate);
            const slashData = this.slashBuffer.getChannelData(0);
            for (let i = 0; i < slashBufSize; i++) {
                slashData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (slashBufSize * 0.25));
            }

            this.isInitialized = true;
            if (this.musicEnabled) {
                this.startAmbient();
            }
        } catch (e) {
            console.warn('Web Audio API not supported', e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    startAmbient() {
        if (!this.ctx || this.ambientNode || !this.musicEnabled) return;
        try {
            const bufferSize = this.ctx.sampleRate * 2;
            const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
                b6 = white * 0.115926;
            }

            const whiteNoise = this.ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;
            whiteNoise.loop = true;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(140, this.ctx.currentTime);
            filter.Q.setValueAtTime(3, this.ctx.currentTime);

            const subOsc = this.ctx.createOscillator();
            subOsc.type = 'sine';
            subOsc.frequency.setValueAtTime(55, this.ctx.currentTime);
            const subGain = this.ctx.createGain();
            subGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
            subOsc.connect(subGain);

            this.ambientGain = this.ctx.createGain();
            this.ambientGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

            whiteNoise.connect(filter);
            filter.connect(this.ambientGain);
            subGain.connect(this.ambientGain);
            this.ambientGain.connect(this.masterGain);

            whiteNoise.start(0);
            subOsc.start(0);
            this.ambientNode = { whiteNoise, subOsc };
        } catch (e) {
            console.warn('Ambient start failed', e);
        }
    }

    stopAmbient() {
        if (this.ambientNode) {
            try {
                this.ambientNode.whiteNoise.stop();
                this.ambientNode.subOsc.stop();
            } catch (e) {}
            this.ambientNode = null;
        }
    }

    playEat(isMeat = false) {
        if (!this.sfxEnabled || !this.ctx) return;
        const now = performance.now();
        if (this.lastEatTime && now - this.lastEatTime < 45) return;
        this.lastEatTime = now;

        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        if (isMeat) {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, t);
            osc.frequency.exponentialRampToValueAtTime(480, t + 0.12);
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        } else {
            osc.type = 'sine';
            const baseFreq = 520 + Math.random() * 120;
            osc.frequency.setValueAtTime(baseFreq, t);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.08);
            gain.gain.setValueAtTime(0.18, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.09);
        }

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.16);
    }

    playBoost() {
        if (!this.sfxEnabled || !this.ctx) return;
        const now = performance.now();
        if (this.lastBoostTime && now - this.lastBoostTime < 220) return;
        this.lastBoostTime = now;

        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.25);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.exponentialRampToValueAtTime(800, t + 0.25);
        filter.Q.setValueAtTime(2, t);

        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(t);
        osc.stop(t + 0.26);
    }

    playSlash() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;

        const noise = this.ctx.createBufferSource();
        noise.buffer = this.slashBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, t);
        filter.frequency.exponentialRampToValueAtTime(300, t + 0.18);
        filter.Q.setValueAtTime(3, t);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.45, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        const punch = this.ctx.createOscillator();
        const punchGain = this.ctx.createGain();
        punch.type = 'sine';
        punch.frequency.setValueAtTime(180, t);
        punch.frequency.exponentialRampToValueAtTime(40, t + 0.18);
        punchGain.gain.setValueAtTime(0.5, t);
        punchGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

        punch.connect(punchGain);
        punchGain.connect(this.masterGain);

        noise.start(t);
        punch.start(t);
        punch.stop(t + 0.2);
    }

    playParry() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;

        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1200, t);
        osc1.frequency.exponentialRampToValueAtTime(900, t + 0.25);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1850, t);
        osc2.frequency.exponentialRampToValueAtTime(1400, t + 0.25);

        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.masterGain);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.26);
        osc2.stop(t + 0.26);
    }

    playPowerup() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [440, 554, 659, 880, 1108];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + idx * 0.05);

            gain.gain.setValueAtTime(0.2, t + idx * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.05 + 0.15);

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t + idx * 0.05);
            osc.stop(t + idx * 0.05 + 0.18);
        });
    }

    playShieldBreak() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(120, t + 0.3);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.32);
    }

    playChestSmash() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [523, 659, 783, 1046, 1318];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, t + idx * 0.06);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2200, t);

            gain.gain.setValueAtTime(0.22, t + idx * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.06 + 0.2);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t + idx * 0.06);
            osc.stop(t + idx * 0.06 + 0.22);
        });
    }

    playLevelUp() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t + idx * 0.08);

            gain.gain.setValueAtTime(0, t + idx * 0.08);
            gain.gain.linearRampToValueAtTime(0.25, t + idx * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.08 + 0.22);

            osc.connect(gain);
            gain.connect(this.masterGain);

            osc.start(t + idx * 0.08);
            osc.stop(t + idx * 0.08 + 0.25);
        });
    }

    playKingSlayer() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [440, 554.37, 659.25, 880, 1108.73];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, t + idx * 0.09);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2000, t);

            gain.gain.setValueAtTime(0, t + idx * 0.09);
            gain.gain.linearRampToValueAtTime(0.3, t + idx * 0.09 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.09 + 0.35);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start(t + idx * 0.09);
            osc.stop(t + idx * 0.09 + 0.4);
        });
    }

    playWheelTick() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.03);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.03);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.04);
    }

    playJackpot() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [523, 659, 783, 1046, 1318, 1567];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, t + idx * 0.07);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2400, t);

            gain.gain.setValueAtTime(0.25, t + idx * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.07 + 0.3);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t + idx * 0.07);
            osc.stop(t + idx * 0.07 + 0.35);
        });
    }

    playStreak(streak) {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const baseFreq = Math.min(300 + streak * 60, 900);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(baseFreq, t);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, t + 0.2);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1500, t);

        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(t);
        osc.stop(t + 0.26);
    }

    playGameOver() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const notes = [300, 260, 220, 160];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, t + idx * 0.15);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, t);

            gain.gain.setValueAtTime(0.25, t + idx * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.01, t + idx * 0.15 + 0.25);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            osc.start(t + idx * 0.15);
            osc.stop(t + idx * 0.15 + 0.28);
        });
    }

    playClick() {
        if (!this.sfxEnabled || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(400, t + 0.05);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.06);
    }

    toggleSFX() {
        this.sfxEnabled = !this.sfxEnabled;
        return this.sfxEnabled;
    }

    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        if (this.musicEnabled) {
            this.startAmbient();
        } else {
            this.stopAmbient();
        }
        return this.musicEnabled;
    }
}

window.soundEngine = new SoundEngine();
