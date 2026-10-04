/**
 * Fish.IO — 3D asset previews (Three.js, vendored in /vendor).
 *
 * Procedurally sculpted models for every weapon, fish and hat in the shop:
 * beveled extruded blades, lathe/tube bodies, PBR materials, a small studio
 * lighting rig with an environment map, blob shadows and hero poses.
 *
 * Everything degrades gracefully: if WebGL or the module fails to load, the
 * emoji/2D fallbacks in the UI keep working untouched.
 */
(function () {
    'use strict';

    let THREE = null;
    let ready = false;
    let failed = false;
    let previewPaused = false;

    const thumbCache = new Map();
    const materialCache = new Map();
    const pendingSlots = [];
    let pendingLoadout = null;
    let preview = null;

    // ============================================================ boot
    const VENDOR_URL = new URL('vendor/three.module.js', document.baseURI).href;

    (async function boot() {
        try {
            THREE = await import(VENDOR_URL);
            if (!webglSupported()) throw new Error('WebGL unavailable');
            ready = true;
            mountPreviewIfPossible();
            const draining = pendingSlots.splice(0, pendingSlots.length);
            if (draining.length) hydrateSlots(draining);
        } catch (err) {
            failed = true;
            console.warn('[item3d] 3D previews unavailable, keeping 2D fallbacks:', err);
        }
    })();

    function webglSupported() {
        try {
            const c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
        } catch {
            return false;
        }
    }

    // ============================================================ materials & geometry
    function mat(o) {
        const opts = Object.assign(
            { color: '#cccccc', metalness: 0.35, roughness: 0.55, emissive: null, emissiveIntensity: 1.6, flat: false, transparent: false, opacity: 1 },
            o,
        );
        const key = [opts.color, opts.metalness, opts.roughness, opts.emissive, opts.emissiveIntensity, opts.flat, opts.transparent, opts.opacity].join('|');
        if (materialCache.has(key)) return materialCache.get(key);
        const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(opts.color),
            metalness: opts.metalness,
            roughness: opts.roughness,
            flatShading: opts.flat,
            transparent: opts.transparent,
            opacity: opts.opacity,
        });
        if (opts.emissive) {
            m.emissive = new THREE.Color(opts.emissive);
            m.emissiveIntensity = opts.emissiveIntensity;
        }
        materialCache.set(key, m);
        return m;
    }

    function attach(mesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    function box(w, h, d, material) {
        return attach(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
    }

    function sphere(r, material, w = 20, h = 14) {
        return attach(new THREE.Mesh(new THREE.SphereGeometry(r, w, h), material));
    }

    function cone(r, h, material, seg = 18) {
        return attach(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), material));
    }

    function torus(r, tube, material, arc = Math.PI * 2, seg = 24) {
        return attach(new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, seg, arc), material));
    }

    function ico(r, material, detail = 0) {
        return attach(new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), material));
    }

    /** Cylinder along +X from x0 to x1 (radiusTop = radius at x1). */
    function shaftX(x0, x1, r0, r1, material, seg = 18) {
        const len = Math.abs(x1 - x0);
        const m = attach(new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), material));
        m.rotation.z = -Math.PI / 2;
        m.position.x = (x0 + x1) / 2;
        return m;
    }

    function polyShape(points) {
        const s = new THREE.Shape();
        s.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
        s.closePath();
        return s;
    }

    /** Beveled extrusion of a 2D profile (length along X, width along Y). */
    function extrusion(shape, thickness, material, bevel = 0.018) {
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSegments: 1,
            steps: 1,
            bevelSize: bevel,
            bevelThickness: bevel,
        });
        geo.translate(0, 0, -thickness / 2);
        return attach(new THREE.Mesh(geo, material));
    }

    /** Curved blade profile from a leading edge quadratic curve. */
    function curvedBlade(len, w, bow, thickness, material, backW = w) {
        const shape = new THREE.Shape();
        shape.moveTo(0, -backW * 0.4);
        shape.quadraticCurveTo(len * 0.55, -w * 0.7 + bow, len, bow * 0.35);
        shape.quadraticCurveTo(len * 0.5, w * 0.75 + bow, 0, backW * 0.4);
        shape.closePath();
        return extrusion(shape, thickness, material);
    }

    function tube(points, radius, material, tubular = 36, radial = 8) {
        const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
        return attach(new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, radius, radial, false), material));
    }

    function weaponMaterials(s) {
        return {
            steel: mat({ color: '#d9e2ec', metalness: 0.95, roughness: 0.22 }),
            dark: mat({ color: '#2b3440', metalness: 0.75, roughness: 0.38 }),
            gold: mat({ color: '#f4c542', metalness: 1.0, roughness: 0.2 }),
            wood: mat({ color: '#7a5230', metalness: 0.0, roughness: 0.85 }),
            bone: mat({ color: '#efe6d0', metalness: 0.05, roughness: 0.55 }),
            rope: mat({ color: '#e8cf8a', metalness: 0.0, roughness: 0.9 }),
            blade: mat({ color: s.bladeColor || '#9be7ff', metalness: 0.55, roughness: 0.3 }),
            glow: mat({ color: s.glowColor || s.bladeColor || '#00f7ff', emissive: s.glowColor || s.bladeColor || '#00f7ff', emissiveIntensity: 1.9, metalness: 0.2, roughness: 0.35 }),
            hilt: mat({ color: s.hiltColor || '#243040', metalness: 0.6, roughness: 0.45 }),
        };
    }

    // ============================================================ weapons
    const WEAPONS = {
        coral_dagger: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.32, 0.055, 0.045, m.hilt));
            g.add(shaftX(0.28, 0.4, 0.062, 0.062, m.gold));
            g.add(extrusion(polyShape([[0.4, -0.09], [0.6, -0.15], [0.68, -0.05], [0.9, -0.11], [1.12, 0], [0.9, 0.11], [0.68, 0.05], [0.6, 0.15], [0.4, 0.09]]), 0.055, m.blade));
            return g;
        },
        wooden_spear: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 1.95, 0.035, 0.03, m.wood));
            [0.65, 0.78, 0.91].forEach((x) => {
                const wrap = torus(0.05, 0.012, m.rope);
                wrap.rotation.y = Math.PI / 2;
                wrap.position.x = x;
                g.add(wrap);
            });
            g.add(extrusion(polyShape([[1.95, -0.09], [2.3, -0.14], [2.62, 0], [2.3, 0.14], [1.95, 0.09]]), 0.05, m.bone));
            return g;
        },
        iron_cutlass: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.3, 0.05, 0.045, m.hilt, 12));
            const guard = box(0.06, 0.34, 0.09, m.gold);
            guard.position.x = 0.3;
            g.add(guard);
            g.add(curvedBlade(1.45, 0.2, 0.18, 0.05, m.steel).translateX(0.3));
            return g;
        },
        ninja_katana: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.36, 0.045, 0.04, m.dark, 12));
            const tsuba = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20), m.gold));
            tsuba.rotation.z = Math.PI / 2;
            tsuba.position.x = 0.375;
            g.add(tsuba);
            [0.12, 0.22].forEach((x, i) => {
                const wrap = torus(0.05, 0.01, i ? m.gold : m.dark);
                wrap.rotation.y = Math.PI / 2;
                wrap.position.x = x;
                g.add(wrap);
            });
            g.add(curvedBlade(1.85, 0.12, 0.1, 0.035, m.steel, 0.08).translateX(0.39));
            return g;
        },
        trident: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 2.15, 0.045, 0.04, m.gold));
            const bar = box(0.08, 0.5, 0.08, m.gold);
            bar.position.x = 2.15;
            g.add(bar);
            [-0.23, 0, 0.23].forEach((y, i) => {
                const prong = shaftX(2.15, i === 1 ? 2.85 : 2.6, 0.035, 0.02, m.gold, 10);
                prong.position.y = y;
                g.add(prong);
                const tip = cone(0.055, 0.16, m.steel, 10);
                tip.rotation.z = -Math.PI / 2;
                tip.position.set(i === 1 ? 2.9 : 2.65, y, 0);
                g.add(tip);
            });
            return g;
        },
        pirate_sabre: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            const hook = torus(0.12, 0.035, m.gold, Math.PI * 1.4);
            hook.position.x = 0.05;
            hook.rotation.z = Math.PI * 0.55;
            g.add(hook);
            g.add(shaftX(0.1, 0.38, 0.05, 0.045, m.hilt, 12));
            const guard = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.035, 20), m.gold));
            guard.rotation.z = Math.PI / 2;
            guard.position.x = 0.4;
            g.add(guard);
            g.add(curvedBlade(1.7, 0.26, 0.3, 0.05, m.steel).translateX(0.42));
            return g;
        },
        harpoon_gun: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            const stock = box(0.5, 0.14, 0.14, m.wood);
            stock.position.set(-0.15, -0.03, 0);
            g.add(stock);
            g.add(shaftX(0.05, 1.7, 0.035, 0.03, m.steel));
            [0.55, 0.68, 0.81].forEach((x, i) => {
                const coil = torus(0.07, 0.02, i ? m.rope : m.gold);
                coil.rotation.y = Math.PI / 2;
                coil.position.x = x;
                g.add(coil);
            });
            const head = cone(0.07, 0.3, m.steel);
            head.rotation.z = -Math.PI / 2;
            head.position.x = 1.85;
            g.add(head);
            [-1, 1].forEach((d) => {
                const barb = cone(0.035, 0.2, m.steel, 8);
                barb.rotation.z = Math.PI / 2 - d * 0.7;
                barb.position.set(1.66, d * 0.08, 0);
                g.add(barb);
            });
            return g;
        },
        laser_saber: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.42, 0.055, 0.05, m.dark, 14));
            const emitter = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.08, 16), m.gold));
            emitter.rotation.z = Math.PI / 2;
            emitter.position.x = 0.45;
            g.add(emitter);
            const blade = attach(new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.5, 6, 12), m.glow));
            blade.rotation.z = -Math.PI / 2;
            blade.position.x = 1.28;
            g.add(blade);
            return g;
        },
        coral_staff: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 1.7, 0.04, 0.035, m.wood));
            const orb = ico(0.16, m.glow, 1);
            orb.position.x = 1.7;
            g.add(orb);
            [[1.7, 0.14, 0.05], [1.7, -0.12, -0.06], [1.62, 0.05, 0.15]].forEach((p, i) => {
                const branch = shaftX(0, 0.28, 0.025, 0.012, m.blade, 8);
                branch.position.set(1.55 + i * 0.02, p[1], p[2]);
                branch.rotation.y = i === 2 ? 0.6 : 0;
                g.add(branch);
                const bulb = sphere(0.045, m.blade, 10, 8);
                bulb.position.set(1.83 + i * 0.02, p[1] * 1.35, p[2] * 1.3);
                g.add(bulb);
            });
            return g;
        },
        saw_blade: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.32, 0.05, 0.045, m.hilt, 12));
            const pts = [[0.32, -0.12], [1.85, -0.16]];
            for (let t = 0; t < 7; t++) {
                const tx = 1.85 - t * 0.2;
                pts.push([tx - 0.06, -0.3], [tx - 0.12, -0.14]);
            }
            pts.push([1.98, 0], [1.85, 0.16]);
            for (let t = 0; t < 7; t++) {
                const tx = 1.85 - t * 0.2;
                pts.push([tx - 0.06, 0.3], [tx - 0.12, 0.14]);
            }
            pts.push([0.32, 0.12]);
            g.add(extrusion(polyShape(pts), 0.045, m.blade, 0.012));
            return g;
        },
        anchor_flail: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.3, 0.05, 0.04, m.dark, 12));
            for (let i = 0; i < 5; i++) {
                const link = torus(0.075, 0.024, m.steel);
                link.rotation.y = Math.PI / 2;
                link.rotation.x = i % 2 ? Math.PI / 2 : 0;
                link.position.x = 0.42 + i * 0.16;
                g.add(link);
            }
            const shank = shaftX(1.25, 2.15, 0.05, 0.05, m.steel);
            g.add(shank);
            const stock = box(0.5, 0.07, 0.07, m.steel);
            stock.position.x = 1.42;
            g.add(stock);
            const arms = attach(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 20, Math.PI), m.steel));
            arms.rotation.z = Math.PI;
            arms.position.set(2.15, 0, 0);
            g.add(arms);
            [-1, 1].forEach((d) => {
                const fluke = cone(0.09, 0.28, m.steel, 8);
                fluke.rotation.z = d * 0.5;
                fluke.position.set(2.4, d * 0.42, 0);
                g.add(fluke);
            });
            return g;
        },
        ice_crystal: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            const ice = mat({ color: '#bdf3ff', metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.9 });
            const shard = attach(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), ice));
            shard.scale.set(3.4, 0.55, 0.55);
            shard.position.x = 1.05;
            g.add(shard);
            g.add(shaftX(0, 0.35, 0.05, 0.045, m.hilt, 12));
            [[0.5, 0.18], [0.75, -0.2]].forEach((p) => {
                const small = attach(new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), ice));
                small.scale.set(2.4, 0.5, 0.5);
                small.rotation.z = p[1] * 2;
                small.position.set(p[0], p[1] * 0.6, 0.1);
                g.add(small);
            });
            return g;
        },
        eel_whip: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.3, 0.05, 0.045, m.hilt, 12));
            g.add(tube([[0.3, 0, 0], [0.9, 0.22, 0], [1.5, -0.22, 0], [2.1, 0.12, 0]], 0.075, m.blade, 40, 10));
            const head = sphere(0.11, m.glow, 14, 10);
            head.position.set(2.1, 0.12, 0);
            g.add(head);
            const fin = extrusion(polyShape([[0.6, 0.08], [1.1, 0.34], [1.55, -0.1], [1.1, -0.02]]), 0.02, m.glow, 0.006);
            g.add(fin);
            return g;
        },
        volcano_magma: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.32, 0.055, 0.05, m.dark, 12));
            g.add(extrusion(polyShape([[0.32, -0.18], [0.72, -0.26], [0.78, -0.12], [1.5, -0.16], [1.78, 0], [1.5, 0.16], [0.78, 0.12], [0.72, 0.26], [0.32, 0.18]]), 0.06, m.dark));
            const lava = box(1.15, 0.05, 0.03, m.glow);
            lava.position.set(1.05, 0, 0);
            g.add(lava);
            [[0.62, 0.1], [1.05, -0.09], [1.4, 0.08]].forEach((p) => {
                const crack = box(0.16, 0.035, 0.035, m.glow);
                crack.rotation.z = p[1] * 3;
                crack.position.set(p[0], p[1], 0.07);
                g.add(crack);
            });
            return g;
        },
        sonic_lance: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.6, 0.05, 0.045, m.dark, 14));
            const dish = cone(0.2, 0.35, m.blade, 24);
            dish.rotation.z = -Math.PI / 2;
            dish.position.x = 0.78;
            g.add(dish);
            [0.95, 1.12, 1.29].forEach((x, i) => {
                const ring = torus(0.1 + i * 0.05, 0.015, m.glow);
                ring.rotation.y = Math.PI / 2;
                ring.position.x = x;
                g.add(ring);
            });
            const core = attach(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.6, 5, 10), m.glow));
            core.rotation.z = -Math.PI / 2;
            core.position.x = 1.4;
            g.add(core);
            return g;
        },
        excalibur: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.42, 0.05, 0.045, m.hilt, 12));
            const guard = box(0.08, 0.52, 0.1, m.gold);
            guard.position.x = 0.44;
            g.add(guard);
            [-1, 1].forEach((d) => {
                const tip = cone(0.06, 0.2, m.gold, 8);
                tip.rotation.z = d * 1.2;
                tip.position.set(0.44, d * 0.3, 0);
                g.add(tip);
            });
            const gem = ico(0.07, m.glow, 0);
            gem.position.set(0.44, 0, 0.08);
            g.add(gem);
            g.add(extrusion(polyShape([[0.5, -0.16], [1.75, -0.15], [1.98, 0], [1.75, 0.15], [0.5, 0.16]]), 0.05, m.blade));
            const fuller = box(1.15, 0.05, 0.06, m.steel);
            fuller.position.x = 1.12;
            g.add(fuller);
            return g;
        },
        thunder_spear: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 1.1, 0.04, 0.035, m.dark));
            const boltPts = [[1.1, -0.04], [1.5, -0.04], [1.36, -0.22], [1.8, -0.1], [1.66, -0.3], [2.15, -0.12], [1.95, 0], [2.15, 0.12], [1.66, 0.3], [1.8, 0.1], [1.36, 0.22], [1.5, 0.04]];
            g.add(extrusion(polyShape(boltPts), 0.045, m.glow, 0.01));
            return g;
        },
        drill_saw: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            const body = box(0.55, 0.24, 0.24, m.dark);
            body.position.x = 0.28;
            g.add(body);
            g.add(shaftX(0.55, 0.8, 0.11, 0.11, m.dark));
            const drill = cone(0.16, 1.1, m.blade, 20);
            drill.rotation.z = -Math.PI / 2;
            drill.position.x = 1.35;
            g.add(drill);
            const helix = [];
            for (let i = 0; i <= 24; i++) {
                const t = i / 24;
                const a = t * Math.PI * 6;
                helix.push([0.85 + t * 1.0, Math.cos(a) * 0.17 * (1 - t * 0.85), Math.sin(a) * 0.17 * (1 - t * 0.85)]);
            }
            g.add(tube(helix, 0.022, m.steel, 60, 6));
            const handle = box(0.16, 0.3, 0.1, m.hilt);
            handle.position.set(0.1, -0.2, 0);
            g.add(handle);
            return g;
        },
        chainsaw: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            const engine = box(0.5, 0.3, 0.28, m.dark);
            engine.position.x = 0.3;
            g.add(engine);
            const bar = box(1.5, 0.2, 0.06, m.blade);
            bar.position.x = 1.3;
            g.add(bar);
            for (let i = 0; i < 9; i++) {
                const tooth = box(0.05, 0.07, 0.07, m.steel);
                tooth.position.set(0.62 + i * 0.16, 0.13, 0);
                g.add(tooth);
                const tooth2 = box(0.05, 0.07, 0.07, m.steel);
                tooth2.position.set(0.7 + i * 0.16, -0.13, 0);
                g.add(tooth2);
            }
            const grip = torus(0.16, 0.035, m.hilt, Math.PI * 1.2);
            grip.rotation.y = Math.PI / 2;
            grip.position.set(0.22, 0.22, 0);
            g.add(grip);
            return g;
        },
        dragon_horn: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.4, 0.06, 0.05, m.hilt, 12));
            const path = [[0.4, 0, 0], [1.0, 0.1, 0.05], [1.6, 0.05, -0.05], [2.2, 0.22, 0.02], [2.6, 0.3, 0]];
            g.add(tube(path, 0.11, m.blade, 40, 10));
            [[0.75, 0.14], [1.3, 0.11], [1.85, 0.08]].forEach((p) => {
                const ring = torus(p[1] + 0.02, 0.02, m.glow);
                ring.rotation.y = Math.PI / 2;
                ring.position.set(p[0], 0.08, 0);
                g.add(ring);
            });
            const tip = cone(0.09, 0.35, m.glow, 12);
            tip.rotation.z = -Math.PI / 2;
            tip.position.set(2.75, 0.33, 0);
            g.add(tip);
            return g;
        },
        kraken_tentacle: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.35, 0.06, 0.05, m.hilt, 12));
            const curve = [[0.35, 0, 0], [1.0, 0.3, 0.1], [1.6, -0.2, -0.05], [2.2, 0.2, 0.08], [2.6, 0.4, 0]];
            g.add(tube(curve, 0.12, m.blade, 42, 12));
            g.add(tube(curve, 0.05, m.glow, 42, 8).translateY(0).translateZ(0));
            for (let i = 0; i < 6; i++) {
                const t = 0.3 + i * 0.09;
                const pt = new THREE.CatmullRomCurve3(curve.map((p) => new THREE.Vector3(p[0], p[1], p[2]))).getPointAt(t);
                const sucker = sphere(0.035, mat({ color: '#f2d8ff', roughness: 0.5 }), 8, 6);
                sucker.position.copy(pt).add(new THREE.Vector3(0, -0.1, 0));
                g.add(sucker);
            }
            return g;
        },
        leviathan_jaw: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.35, 0.06, 0.05, m.hilt, 12));
            [
                [1, -0.14],
                [-1, 0.14],
            ].forEach(([d, y]) => {
                const jaw = box(1.5, 0.22, 0.16, m.dark);
                jaw.position.set(1.1, y, 0);
                jaw.rotation.z = d * 0.12;
                g.add(jaw);
                for (let i = 0; i < 7; i++) {
                    const tooth = cone(0.045, 0.16, m.bone, 8);
                    tooth.position.set(0.5 + i * 0.19, y + d * 0.13, 0);
                    tooth.rotation.z = d * Math.PI;
                    tooth.rotation.x = d * 0.12;
                    g.add(tooth);
                }
            });
            const glowLine = box(1.6, 0.03, 0.03, m.glow);
            glowLine.position.set(1.1, 0, 0.1);
            g.add(glowLine);
            return g;
        },
        abyss_scythe: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 1.5, 0.045, 0.04, m.hilt));
            const crescent = attach(new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.045, 8, 32, 2.1), m.blade));
            crescent.scale.z = 0.35;
            crescent.rotation.z = -1.2;
            crescent.position.set(1.85, 0.55, 0);
            g.add(crescent);
            const edge = attach(new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.02, 6, 32, 2.1), m.glow));
            edge.scale.z = 0.35;
            edge.rotation.z = -1.2;
            edge.position.set(1.85, 0.55, 0);
            g.add(edge);
            return g;
        },
        crown_of_tides: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 1.4, 0.04, 0.035, m.gold));
            const ring = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 18), m.gold));
            ring.rotation.z = Math.PI / 2;
            ring.position.x = 1.45;
            g.add(ring);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const spike = cone(0.045, 0.24, m.glow, 8);
                spike.position.set(1.45, Math.cos(a) * 0.2, Math.sin(a) * 0.2);
                spike.rotation.x = a;
                g.add(spike);
            }
            g.add(shaftX(1.5, 1.95, 0.05, 0.02, m.gold));
            const tip = cone(0.08, 0.3, m.glow, 10);
            tip.rotation.z = -Math.PI / 2;
            tip.position.x = 2.1;
            g.add(tip);
            return g;
        },
        meteor_maul: (s) => {
            const m = weaponMaterials(s), g = new THREE.Group();
            g.add(shaftX(0, 0.9, 0.045, 0.04, m.hilt));
            for (let i = 0; i < 3; i++) {
                const link = torus(0.06, 0.02, m.steel);
                link.rotation.y = Math.PI / 2;
                link.rotation.x = i % 2 ? Math.PI / 2 : 0;
                link.position.x = 0.98 + i * 0.12;
                g.add(link);
            }
            const head = box(0.6, 0.55, 0.55, m.dark);
            head.position.x = 1.55;
            head.rotation.y = 0.2;
            g.add(head);
            [[0.4, 0, 0], [-0.3, 0.1, 0.24], [0.05, -0.24, -0.2]].forEach((p) => {
                const crack = box(0.12, 0.12, 0.12, m.glow);
                crack.position.set(1.55 + p[0], p[1], p[2]);
                crack.rotation.set(p[0], p[1], p[2]);
                g.add(crack);
            });
            [[0.2, 0.25], [-0.2, -0.25]].forEach((p) => {
                const stud = sphere(0.06, m.steel, 8, 6);
                stud.position.set(1.55 + p[0], p[1], 0.28);
                g.add(stud);
            });
            return g;
        },
    };

    // ============================================================ fish
    function fishPalette(s) {
        return {
            body: mat({ color: s.primaryColor || '#3498db', roughness: 0.6, metalness: 0.12 }),
            belly: mat({ color: s.bellyColor || s.secondaryColor || '#ecf0f1', roughness: 0.7, metalness: 0.05 }),
            fin: mat({ color: s.finColor || s.primaryColor || '#2980b9', roughness: 0.58, metalness: 0.1 }),
            white: mat({ color: '#ffffff', roughness: 0.3, metalness: 0.05 }),
            eye: mat({ color: s.eyeColor || '#101820', roughness: 0.25, metalness: 0.1 }),
        };
    }

    function addEyes(g, x, y, z, r = 0.07) {
        [-1, 1].forEach((d) => {
            const white = sphere(r, mat({ color: '#f8fbff', roughness: 0.25 }), 10, 8);
            white.position.set(x, y, d * z);
            g.add(white);
            const pupil = sphere(r * 0.55, mat({ color: '#101820', roughness: 0.2 }), 8, 6);
            pupil.position.set(x + r * 0.4, y, d * (z + r * 0.3));
            g.add(pupil);
        });
    }

    function addFins(g, p, opts) {
        const finShape = [[0, 0], [-0.42, -0.5], [-0.5, -0.05]];
        [-1, 1].forEach((d) => {
            const fin = extrusion(polyShape(finShape), 0.03, p.fin, 0.008);
            fin.rotation.x = d * 0.9;
            fin.rotation.y = d * 0.25;
            fin.position.set(0.3, -0.2, d * 0.28);
            g.add(fin);
        });
        if (!opts.noDorsal) {
            const dorsal = extrusion(polyShape([[0.2, 0], [-0.28, opts.dorsal || 0.5], [-0.55, 0.03]]), 0.04, p.fin, 0.01);
            dorsal.position.set(-0.05, 0.28, 0);
            g.add(dorsal);
        }
        if (opts.whipTail) {
            g.add(tube([[-0.72, 0, 0], [-1.5, 0.25, 0], [-2.3, -0.1, 0]], 0.045, p.fin, 30, 8));
        } else {
            [-1, 1].forEach((d) => {
                const tail = extrusion(polyShape([[0, 0], [-0.5, d * 0.55], [-0.58, d * 0.05]]), 0.035, p.fin, 0.01);
                tail.position.set(-0.88, d * 0.05, 0);
                g.add(tail);
            });
        }
    }

    function fishShark(s, o = {}) {
        const p = fishPalette(s);
        const g = new THREE.Group();
        const scale = o.big ? 1.25 : o.tiny ? 0.72 : 1;
        const bodyMat = o.phantom ? mat({ color: s.primaryColor, transparent: true, opacity: 0.55, roughness: 0.3, metalness: 0.2 }) : p.body;

        const body = sphere(0.55, bodyMat, 26, 18);
        body.scale.set(1.5, 0.78, 0.72);
        g.add(body);

        const belly = sphere(0.5, o.phantom ? bodyMat : p.belly, 22, 14);
        belly.scale.set(1.28, 0.42, 0.6);
        belly.position.set(0.06, -0.2, 0);
        g.add(belly);

        if (o.head === 'hammer') {
            const head = box(0.34, 0.22, 1.3, bodyMat);
            head.position.set(0.82, 0.02, 0);
            g.add(head);
            addEyes(g, 0.82, 0.02, 0.66, 0.075);
        } else {
            const snout = cone(0.32, 0.55, bodyMat, 20);
            snout.rotation.z = -Math.PI / 2;
            snout.position.set(0.72, 0.02, 0);
            g.add(snout);
            addEyes(g, 0.62, 0.16, 0.34, 0.065);
        }

        if (o.snout === 'saw' || o.snout === 'goblin') {
            const sawLen = o.snout === 'goblin' ? 0.9 : 0.75;
            const saw = box(sawLen, 0.09, 0.16, p.body);
            saw.position.set(0.95 + sawLen / 2, -0.06, 0);
            g.add(saw);
            for (let i = 0; i < 7; i++) {
                [-1, 1].forEach((d) => {
                    const tooth = cone(0.03, 0.1, p.white, 6);
                    tooth.position.set(1.0 + i * (sawLen / 7), -0.06 + d * 0.08, 0);
                    tooth.rotation.z = d * Math.PI * 0.5;
                    g.add(tooth);
                });
            }
        }
        if (o.snout === 'bill') {
            g.add(shaftX(0.75, 1.7, 0.05, 0.012, p.body, 10));
        }
        if (o.horn) {
            g.add(shaftX(0.7, 1.6, 0.05, 0.012, mat({ color: '#f6e3b4', roughness: 0.4 }), 10));
        }
        if (o.jaw) {
            const lower = box(0.7, 0.1, 0.42, p.belly);
            lower.position.set(0.72, -0.24, 0);
            g.add(lower);
            for (let i = 0; i < 5; i++) {
                const tooth = cone(0.028, 0.09, p.white, 6);
                tooth.position.set(0.5 + i * 0.12, -0.16, 0.12 * (i % 2 ? 1 : -1));
                g.add(tooth);
            }
        }
        if (o.angler) {
            g.add(tube([[0.6, 0.3, 0], [0.95, 0.72, 0], [1.25, 0.6, 0]], 0.022, p.fin, 20, 6));
            const lure = sphere(0.09, mat({ color: '#9cffef', emissive: '#00f7ff', emissiveIntensity: 2.4, roughness: 0.3 }), 12, 10);
            lure.position.set(1.25, 0.6, 0);
            g.add(lure);
        }
        if (o.puffer) {
            for (let i = 0; i < 26; i++) {
                const phi = Math.acos(1 - (2 * (i + 0.5)) / 26);
                const theta = Math.PI * (1 + Math.sqrt(5)) * i;
                const spike = cone(0.035, 0.16, p.fin, 6);
                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.cos(phi);
                const nz = Math.sin(phi) * Math.sin(theta);
                spike.position.set(nx * 0.78, ny * 0.42, nz * 0.4);
                spike.lookAt(nx * 2, ny * 2, nz * 2);
                spike.rotateX(Math.PI / 2);
                g.add(spike);
            }
        }
        if (o.stripes === 'dark') {
            [-0.3, -0.02, 0.26].forEach((x) => {
                const stripe = torus(0.52, 0.035, mat({ color: '#26323c', roughness: 0.6 }), Math.PI * 2);
                stripe.rotation.y = Math.PI / 2;
                stripe.scale.set(1, 1, 0.72);
                stripe.position.x = x;
                g.add(stripe);
            });
        }
        if (o.stripes === 'clown') {
            [-0.28, 0.1, 0.42].forEach((x) => {
                const stripe = torus(0.52, 0.045, p.white, Math.PI * 2);
                stripe.rotation.y = Math.PI / 2;
                stripe.scale.set(1, 1, 0.72);
                stripe.position.x = x;
                g.add(stripe);
            });
        }
        if (o.cyber) {
            const visor = box(0.06, 0.1, 0.5, mat({ color: '#00f7ff', emissive: '#00f7ff', emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.3 }));
            visor.position.set(0.6, 0.2, 0);
            g.add(visor);
            const antenna = shaftX(0.1, 0.5, 0.02, 0.01, p.fin, 6);
            antenna.rotation.z = 0.6;
            antenna.position.set(0.2, 0.42, 0);
            g.add(antenna);
        }
        if (o.phoenix) {
            [-1, 1].forEach((d) => {
                const wing = extrusion(polyShape([[0, 0], [-0.7, d * 0.85], [-1.1, d * 0.55], [-0.5, 0]]), 0.03, mat({ color: '#ffa502', emissive: '#ff6b00', emissiveIntensity: 0.8, roughness: 0.5 }), 0.01);
                wing.position.set(0.15, 0.1, d * 0.2);
                wing.rotation.x = d * 0.5;
                g.add(wing);
            });
        }
        if (o.leviathan) {
            [-1, 1].forEach((d) => {
                const horn = cone(0.06, 0.45, mat({ color: '#f6e3b4', roughness: 0.35 }), 8);
                horn.rotation.z = -0.9;
                horn.rotation.x = d * 0.5;
                horn.position.set(0.55, 0.45, d * 0.2);
                g.add(horn);
            });
        }
        if (o.glow) {
            const glowMat = mat({ color: o.glow, emissive: o.glow, emissiveIntensity: 2.0, roughness: 0.4 });
            [-0.35, 0, 0.35].forEach((x) => {
                const band = torus(0.52, 0.025, glowMat);
                band.rotation.y = Math.PI / 2;
                band.scale.set(1, 1, 0.72);
                band.position.x = x;
                g.add(band);
            });
        }

        addFins(g, p, o);
        g.scale.setScalar(scale);
        return g;
    }

    function fishEel(s) {
        const p = fishPalette(s), g = new THREE.Group();
        const bodyMat = mat({ color: s.primaryColor, roughness: 0.55, metalness: 0.15 });
        g.add(tube([[-1.3, 0, 0], [-0.6, 0.22, 0], [0.1, -0.18, 0], [0.8, 0.12, 0], [1.25, 0, 0]], 0.19, bodyMat, 48, 12));
        g.add(tube([[-1.3, 0, 0], [-0.6, 0.22, 0], [0.1, -0.18, 0], [0.8, 0.12, 0], [1.25, 0, 0]], 0.06, mat({ color: s.finColor, emissive: s.finColor, emissiveIntensity: 0.9, roughness: 0.4 }), 48, 8));
        addEyes(g, 1.05, 0.12, 0.13, 0.055);
        const tail = extrusion(polyShape([[0, 0], [-0.4, 0.3], [-0.45, 0.02]]), 0.03, p.fin, 0.008);
        tail.position.set(-1.3, 0, 0);
        g.add(tail);
        const fin = extrusion(polyShape([[-0.9, 0.16], [0.5, 0.34], [1.0, 0.2], [0.4, 0.16]]), 0.02, p.fin, 0.006);
        g.add(fin);
        return g;
    }

    function fishManta(s) {
        const p = fishPalette(s), g = new THREE.Group();
        const bodyMat = mat({ color: s.primaryColor, roughness: 0.58, metalness: 0.12 });
        const body = sphere(0.6, bodyMat, 22, 16);
        body.scale.set(1.25, 0.22, 1.35);
        g.add(body);
        [-1, 1].forEach((d) => {
            const wing = extrusion(polyShape([[0, 0], [-0.2, d * 1.5], [-1.1, d * 1.15], [-0.85, 0]]), 0.05, bodyMat, 0.012);
            wing.position.set(0.15, 0, d * 0.1);
            wing.rotation.x = d * 0.08;
            g.add(wing);
        });
        addEyes(g, 0.62, 0.08, 0.28, 0.06);
        g.add(tube([[-0.55, 0, 0], [-1.3, 0.1, 0], [-1.9, 0, 0]], 0.03, p.fin, 20, 8));
        return g;
    }

    function fishTurtle(s) {
        const p = fishPalette(s), g = new THREE.Group();
        const shellMat = mat({ color: s.primaryColor, roughness: 0.5, metalness: 0.15 });
        const shell = sphere(0.62, shellMat, 24, 16);
        shell.scale.set(1.15, 0.55, 1.0);
        g.add(shell);
        const rim = torus(0.6, 0.07, mat({ color: s.finColor, roughness: 0.6 }));
        rim.rotation.x = Math.PI / 2;
        rim.scale.set(1.15, 1.0, 1);
        rim.position.y = -0.08;
        g.add(rim);
        const head = sphere(0.17, p.belly, 14, 10);
        head.position.set(0.72, 0.02, 0);
        g.add(head);
        addEyes(g, 0.8, 0.08, 0.12, 0.045);
        [[0.45, 0.5], [0.45, -0.5], [-0.5, 0.45], [-0.5, -0.45]].forEach((p2, i) => {
            const flipper = extrusion(polyShape([[0, 0], [-0.32, i < 2 ? 0.3 : -0.3], [0.1, 0.05]]), 0.04, p.fin, 0.01);
            flipper.position.set(p2[0], -0.15, p2[1]);
            flipper.rotation.x = p2[1] > 0 ? 0.7 : -0.7;
            g.add(flipper);
        });
        return g;
    }

    function fishSquid(s) {
        const p = fishPalette(s), g = new THREE.Group();
        const mantle = mat({ color: s.primaryColor, roughness: 0.5, metalness: 0.15 });
        const head = cone(0.4, 1.1, mantle, 20);
        head.rotation.z = -Math.PI / 2;
        head.position.set(0.45, 0.1, 0);
        g.add(head);
        addEyes(g, 0.9, 0.1, 0.3, 0.1);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const curve = [[0.05, 0, 0], [-0.5, Math.cos(a) * 0.3, Math.sin(a) * 0.3], [-1.1, Math.cos(a) * 0.55, Math.sin(a) * 0.55], [-1.6, Math.cos(a) * 0.4, Math.sin(a) * 0.4]];
            g.add(tube(curve, 0.09, p.fin, 26, 8));
        }
        return g;
    }

    function fishSunfish(s) {
        const p = fishPalette(s), g = new THREE.Group();
        const bodyMat = mat({ color: s.primaryColor, roughness: 0.6, metalness: 0.1 });
        const body = sphere(0.66, bodyMat, 22, 16);
        body.scale.set(1.0, 1.3, 0.32);
        g.add(body);
        [-1, 1].forEach((d) => {
            const fin = extrusion(polyShape([[0, 0], [-0.5, d * 0.8], [-0.75, d * 0.1]]), 0.04, p.fin, 0.01);
            fin.position.set(-0.05, d * 0.75, 0);
            g.add(fin);
        });
        addEyes(g, 0.5, 0.3, 0.12, 0.06);
        return g;
    }

    const FISH_BUILDERS = {
        electric_eel: fishEel,
        manta_ray: fishManta,
        sea_turtle: fishTurtle,
        kraken_squid: fishSquid,
        sunfish_mola: fishSunfish,
        hammerhead: (s) => fishShark(s, { head: 'hammer' }),
        sawshark: (s) => fishShark(s, { snout: 'saw' }),
        deep_goblin: (s) => fishShark(s, { snout: 'goblin', jaw: true }),
        swordfish: (s) => fishShark(s, { snout: 'bill', dorsal: 0.7 }),
        narwhal: (s) => fishShark(s, { horn: true, dorsal: 0.3 }),
        thresher_shark: (s) => fishShark(s, { whipTail: true }),
        orca: (s) => fishShark(s, { big: true, dorsal: 0.7 }),
        great_white: (s) => fishShark(s, { big: true }),
        tiger_shark: (s) => fishShark(s, { stripes: 'dark' }),
        clownfish: (s) => fishShark(s, { tiny: true, stripes: 'clown' }),
        piranha: (s) => fishShark(s, { tiny: true, jaw: true, dorsal: 0.3 }),
        pufferfish: (s) => fishShark(s, { puffer: true, noDorsal: true, tiny: true }),
        anglerfish: (s) => fishShark(s, { angler: true, jaw: true, tiny: true }),
        megalodon: (s) => fishShark(s, { big: true, jaw: true }),
        phoenix_fish: (s) => fishShark(s, { phoenix: true, glow: '#ff8c00' }),
        cyber_shark: (s) => fishShark(s, { cyber: true, glow: null }),
        ghost_shark: (s) => fishShark(s, { phantom: true }),
        golden_leviathan: (s) => fishShark(s, { leviathan: true, big: true, glow: '#ffd700' }),
        baby_shark: (s) => fishShark(s, {}),
    };

    // ============================================================ hats
    const HATS = {
        pirate_hat: () => {
            const g = new THREE.Group();
            const dark = mat({ color: '#1e272e', roughness: 0.7 });
            const brim = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 20), dark));
            g.add(brim);
            const dome = sphere(0.22, dark, 16, 10);
            dome.scale.set(1.15, 0.7, 1.0);
            dome.position.y = 0.1;
            g.add(dome);
            const patch = box(0.12, 0.08, 0.02, mat({ color: '#f5f6fa', roughness: 0.5 }));
            patch.position.set(0.1, 0.16, 0.2);
            g.add(patch);
            return g;
        },
        viking_helmet: () => {
            const g = new THREE.Group();
            const steel = mat({ color: '#8d99a6', metalness: 0.9, roughness: 0.3 });
            const dome = attach(new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), steel));
            dome.position.y = 0.08;
            g.add(dome);
            const band = torus(0.24, 0.03, steel);
            band.rotation.x = Math.PI / 2;
            band.position.y = 0.1;
            g.add(band);
            [-1, 1].forEach((d) => {
                const horn = tube([[d * 0.2, 0.14, 0], [d * 0.34, 0.32, 0], [d * 0.3, 0.5, 0]], 0.045, mat({ color: '#efe6d0', roughness: 0.45 }), 18, 8);
                g.add(horn);
            });
            return g;
        },
        mini_crown: () => {
            const g = new THREE.Group();
            const gold = mat({ color: '#f4c542', metalness: 1, roughness: 0.22 });
            const ring = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.12, 18, 1, true), gold));
            g.add(ring);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const spike = cone(0.05, 0.18, gold, 8);
                spike.position.set(Math.cos(a) * 0.2, 0.14, Math.sin(a) * 0.2);
                g.add(spike);
                const gem = sphere(0.028, i % 2 ? mat({ color: '#ff4757', emissive: '#ff4757', emissiveIntensity: 1.4 }) : mat({ color: '#00f7ff', emissive: '#00f7ff', emissiveIntensity: 1.4 }), 8, 6);
                gem.position.set(Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2);
                g.add(gem);
            }
            return g;
        },
        samurai_kabuto: () => {
            const g = new THREE.Group();
            const red = mat({ color: '#b03030', metalness: 0.55, roughness: 0.4 });
            const dome = attach(new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), red));
            dome.position.y = 0.05;
            g.add(dome);
            const brim = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.04, 20), red));
            brim.position.y = 0.05;
            g.add(brim);
            const crest = attach(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 20, Math.PI), mat({ color: '#f4c542', metalness: 1, roughness: 0.25 })));
            crest.position.set(0, 0.3, 0);
            g.add(crest);
            return g;
        },
        diving_goggles: () => {
            const g = new THREE.Group();
            [-1, 1].forEach((d) => {
                const lens = torus(0.09, 0.03, mat({ color: '#1f2a36', roughness: 0.6 }));
                lens.position.set(0.1, 0.05, d * 0.12);
                g.add(lens);
                const glass = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 16), mat({ color: '#7fd8ff', metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.7 })));
                glass.rotation.x = Math.PI / 2;
                glass.position.set(0.1, 0.05, d * 0.12);
                g.add(glass);
            });
            const strap = torus(0.2, 0.025, mat({ color: '#e6b800', roughness: 0.6 }), Math.PI * 1.2);
            strap.rotation.y = Math.PI / 2;
            strap.rotation.z = Math.PI / 2;
            g.add(strap);
            return g;
        },
        top_hat: () => {
            const g = new THREE.Group();
            const dark = mat({ color: '#252b33', roughness: 0.5, metalness: 0.1 });
            const brim = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 22), dark));
            g.add(brim);
            const tubeTop = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.42, 20), dark));
            tubeTop.position.y = 0.22;
            g.add(tubeTop);
            const band = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.195, 0.07, 20), mat({ color: '#c0392b', roughness: 0.6 })));
            band.position.y = 0.08;
            g.add(band);
            return g;
        },
        cyber_visor: () => {
            const g = new THREE.Group();
            const visor = box(0.1, 0.12, 0.5, mat({ color: '#00f7ff', emissive: '#00f7ff', emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.25 }));
            visor.position.set(0.12, 0.05, 0);
            visor.rotation.z = -0.15;
            g.add(visor);
            const strap = torus(0.22, 0.025, mat({ color: '#22303c', roughness: 0.6 }), Math.PI * 1.4);
            strap.rotation.y = Math.PI / 2;
            strap.rotation.z = Math.PI / 2;
            g.add(strap);
            return g;
        },
        chef_hat: () => {
            const g = new THREE.Group();
            const white = mat({ color: '#f7f9fb', roughness: 0.75 });
            const base = attach(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.19, 0.12, 18), white));
            base.position.y = 0.06;
            g.add(base);
            [[0, 0.24, 0], [0.13, 0.2, 0.06], [-0.12, 0.21, -0.05]].forEach((p) => {
                const puff = sphere(0.13, white, 14, 10);
                puff.position.set(p[0], p[1], p[2]);
                g.add(puff);
            });
            return g;
        },
        angel_halo: () => {
            const g = new THREE.Group();
            const halo = torus(0.2, 0.03, mat({ color: '#ffd700', emissive: '#ffd700', emissiveIntensity: 1.6, metalness: 0.8, roughness: 0.25 }));
            halo.rotation.x = Math.PI / 2;
            halo.position.y = 0.28;
            g.add(halo);
            return g;
        },
        devil_horns: () => {
            const g = new THREE.Group();
            [-1, 1].forEach((d) => {
                const horn = tube([[d * 0.1, 0.06, 0], [d * 0.2, 0.22, 0], [d * 0.16, 0.36, 0]], 0.045, mat({ color: '#c0392b', emissive: '#ff2d2d', emissiveIntensity: 0.5, roughness: 0.4 }), 16, 8);
                g.add(horn);
            });
            return g;
        },
        party_hat: () => {
            const g = new THREE.Group();
            const cone1 = cone(0.17, 0.42, mat({ color: '#ff4fa3', roughness: 0.5 }), 18);
            cone1.position.y = 0.21;
            g.add(cone1);
            const stripe = torus(0.1, 0.02, mat({ color: '#ffd700', roughness: 0.4 }));
            stripe.rotation.x = Math.PI / 2;
            stripe.position.y = 0.16;
            g.add(stripe);
            const pompom = sphere(0.06, mat({ color: '#ffd700', roughness: 0.6 }), 10, 8);
            pompom.position.y = 0.44;
            g.add(pompom);
            return g;
        },
    };

    // ============================================================ scene rig
    const lightRig = [];

    function addLights(scene, intense = false) {
        const hemi = new THREE.HemisphereLight(0xcfeaff, 0x0a2540, intense ? 0.9 : 1.1);
        scene.add(hemi);
        const key = new THREE.DirectionalLight(0xffffff, intense ? 2.4 : 2.0);
        key.position.set(2.6, 4.2, 2.4);
        if (intense) {
            key.castShadow = true;
            key.shadow.mapSize.set(1024, 1024);
            key.shadow.camera.near = 0.5;
            key.shadow.camera.far = 12;
            key.shadow.camera.left = -3;
            key.shadow.camera.right = 3;
            key.shadow.camera.top = 3;
            key.shadow.camera.bottom = -3;
            key.shadow.bias = -0.0004;
        }
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x4fc3f7, 1.4);
        rim.position.set(-3, 1.6, -2.4);
        scene.add(rim);
        lightRig.push(hemi, key, rim);
    }

    function makeEnvironment(renderer, scene) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 64);
        grad.addColorStop(0, '#dff3ff');
        grad.addColorStop(0.45, '#6fb8e8');
        grad.addColorStop(0.55, '#0d2c4d');
        grad.addColorStop(1, '#03080f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 64);
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
    }

    function makeBlobShadow() {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const ctx = c.getContext('2d');
        const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, 'rgba(0,0,0,0.5)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0.22)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(c);
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
        );
        m.rotation.x = -Math.PI / 2;
        return m;
    }

    function newRenderer(canvas) {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        return renderer;
    }

    // ============================================================ models
    function buildWeapon(id) {
        const skin = window.WEAPON_SKINS && window.WEAPON_SKINS[id];
        const builder = WEAPONS[id];
        if (!skin || !builder) return null;
        try {
            return builder(skin);
        } catch (err) {
            console.warn('[item3d] weapon build failed', id, err);
            return null;
        }
    }

    function buildFishModel(id) {
        const skin = window.FISH_SKINS && window.FISH_SKINS[id];
        const builder = FISH_BUILDERS[id] || FISH_BUILDERS.baby_shark;
        if (!skin) return null;
        try {
            return builder(skin);
        } catch (err) {
            console.warn('[item3d] fish build failed', id, err);
            return null;
        }
    }

    function buildHatModel(id) {
        if (!id || id === 'none' || !HATS[id]) return null;
        try {
            return HATS[id]();
        } catch (err) {
            console.warn('[item3d] hat build failed', id, err);
            return null;
        }
    }

    /** Recenter a model on origin and report its size. */
    function centerModel(object) {
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);
        const size = box.getSize(new THREE.Vector3());
        return size;
    }

    function frameCamera(camera, radius, factor = 1.25) {
        const fov = (camera.fov * Math.PI) / 180;
        const dist = (radius / Math.sin(fov / 2)) * factor;
        camera.position.set(dist * 0.62, dist * 0.42, dist * 0.72);
        camera.lookAt(0, 0, 0);
    }

    // ============================================================ thumbnails
    let thumbSetup = null;

    function ensureThumbSetup() {
        if (thumbSetup) return thumbSetup;
        const canvas = document.createElement('canvas');
        canvas.width = 192;
        canvas.height = 192;
        const renderer = newRenderer(canvas);
        const scene = new THREE.Scene();
        addLights(scene, false);
        makeEnvironment(renderer, scene);
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
        const holder = new THREE.Group();
        scene.add(holder);
        const shadow = makeBlobShadow();
        shadow.scale.setScalar(2.2);
        shadow.position.y = -0.0001;
        holder.add(shadow);
        thumbSetup = { canvas, renderer, scene, camera, holder };
        renderer.setSize(192, 192, false);
        return thumbSetup;
    }

    function renderThumbnail(category, id, pose) {
        const key = category + ':' + id;
        if (thumbCache.has(key)) return thumbCache.get(key);
        const model =
            category === 'weapon' ? buildWeapon(id) : category === 'fish' ? buildFishModel(id) : category === 'hat' ? buildHatModel(id) : null;
        if (!model) {
            thumbCache.set(key, null);
            return null;
        }
        try {
            const { canvas, renderer, scene, camera, holder } = ensureThumbSetup();
            holder.clear();
            const shadow = makeBlobShadow();
            holder.add(shadow);

            const wrapper = new THREE.Group();
            wrapper.add(model);
            const size = centerModel(model);
            const radius = Math.max(size.x, size.y, size.z) * 0.62 + 0.15;
            shadow.scale.setScalar(radius * 2.4);
            shadow.position.y = -size.y * 0.55;

            if (category === 'weapon') {
                // Blade flat side toward camera, length along the frame diagonal so
                // long swords fill the square instead of foreshortening to a sliver.
                wrapper.rotation.set(0.18, -0.35, 0.55);
            } else if (category === 'fish') {
                wrapper.rotation.set(0.1, 0.6, 0);
            } else {
                wrapper.rotation.set(0.15, 0.6, 0);
            }
            holder.add(wrapper);
            frameCamera(camera, radius, category === 'weapon' ? 1.0 : 1.25);
            renderer.render(scene, camera);
            const url = canvas.toDataURL('image/png');
            thumbCache.set(key, url);
            return url;
        } catch (err) {
            console.warn('[item3d] thumbnail failed', key, err);
            thumbCache.set(key, null);
            return null;
        }
    }

    // ============================================================ hydration
    function hydrateSlots(slots) {
        let index = 0;
        function step() {
            const budget = Math.min(slots.length - index, 4);
            for (let i = 0; i < budget; i++) {
                const slot = slots[index++];
                if (!slot.isConnected) continue;
                const url = renderThumbnail(slot.dataset.cat, slot.dataset.id);
                if (url) {
                    slot.innerHTML = `<img class="item-3d-icon" src="${url}" alt="">`;
                }
            }
            if (index < slots.length) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function hydrate(container) {
        if (!container) return;
        const slots = Array.from(container.querySelectorAll('.item-icon-slot[data-id]'));
        if (!slots.length) return;
        if (!ready) {
            if (!failed) pendingSlots.push(...slots);
            return;
        }
        hydrateSlots(slots);
    }

    // ============================================================ live preview
    function mountPreviewIfPossible() {
        if (!ready || preview) return;
        const canvas = document.getElementById('preview3dCanvas');
        if (!canvas) return;
        try {
            const renderer = newRenderer(canvas);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;
            const scene = new THREE.Scene();
            addLights(scene, true);
            makeEnvironment(renderer, scene);
            const camera = new THREE.PerspectiveCamera(32, 2.5, 0.1, 50);
            const stage = new THREE.Group();
            scene.add(stage);
            const shadow = makeBlobShadow();
            shadow.scale.setScalar(3.2);
            shadow.position.y = -1.05;
            scene.add(shadow);

            preview = { renderer, scene, camera, stage, canvas, t: 0, loadoutKey: '', raf: 0 };
            resizePreview();
            window.addEventListener('resize', resizePreview);
            if (window.ResizeObserver) new ResizeObserver(resizePreview).observe(canvas.parentElement || canvas);
            if (pendingLoadout) setLoadout(pendingLoadout);
            cancelAnimationFrame(preview.raf);
            preview.raf = requestAnimationFrame(tickPreview);
            canvas.classList.remove('hidden');
            window.__preview3dActive = true;
        } catch (err) {
            console.warn('[item3d] live preview failed, keeping 2D:', err);
            preview = null;
        }
    }

    function resizePreview() {
        if (!preview) return;
        const canvas = preview.canvas;
        const w = Math.max(120, canvas.clientWidth || canvas.parentElement && canvas.parentElement.clientWidth || 360);
        const h = Math.max(80, canvas.clientHeight || canvas.parentElement && canvas.parentElement.clientHeight || 140);
        preview.renderer.setSize(w, h, false);
        preview.camera.aspect = w / h;
        preview.camera.updateProjectionMatrix();
    }

    function setLoadout(loadout) {
        pendingLoadout = loadout;
        if (!preview) {
            mountPreviewIfPossible();
            return;
        }
        const key = [loadout.fish, loadout.weapon, loadout.hat].join('|');
        if (key === preview.loadoutKey) return;
        preview.loadoutKey = key;
        preview.stage.clear();

        const loadoutGroup = new THREE.Group();
        const fish = buildFishModel(loadout.fish) || buildFishModel('baby_shark');
        if (fish) {
            const size = centerModel(fish);
            fish.position.y += size.y * 0.1;
            fish.scale.multiplyScalar(1.15);
            loadoutGroup.add(fish);
            const hat = buildHatModel(loadout.hat);
            if (hat) {
                hat.scale.setScalar(1.1);
                hat.position.set(0.3, size.y * 0.55, 0);
                loadoutGroup.add(hat);
            }
            const weapon = buildWeapon(loadout.weapon);
            if (weapon) {
                weapon.scale.setScalar(0.62);
                weapon.position.set(size.x * 0.62, -size.y * 0.12, 0.42);
                weapon.rotation.set(0, -0.18, -0.1);
                loadoutGroup.add(weapon);
            }
        }
        const bounds = new THREE.Box3().setFromObject(loadoutGroup);
        const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.5, 0.8);
        centerModel(loadoutGroup);
        preview.stage.add(loadoutGroup);
        preview.stage.userData.model = loadoutGroup;
        preview.stage.userData.radius = radius;
        frameCamera(preview.camera, radius, 1.32);
    }

    function tickPreview() {
        if (!preview) return;
        const playing = typeof game !== 'undefined' && game && game.gameState === 'playing';
        const hidden = document.hidden || preview.canvas.offsetParent === null;
        if (!previewPaused && !playing && !hidden) {
            preview.t += 0.016;
            const model = preview.stage.userData.model;
            if (model) {
                model.rotation.y = preview.t * 0.45;
                model.position.y = Math.sin(preview.t * 1.4) * 0.05;
                model.rotation.x = Math.sin(preview.t * 0.9) * 0.04;
            }
            preview.renderer.render(preview.scene, preview.camera);
        }
        preview.raf = requestAnimationFrame(tickPreview);
    }

    // ============================================================ public API
    window.ItemPreview3D = {
        get ready() {
            return ready;
        },
        get failed() {
            return failed;
        },
        hydrate,
        setLoadout,
        mountPreviewIfPossible,
        setPaused(value) {
            previewPaused = Boolean(value);
        },
    };
})();
