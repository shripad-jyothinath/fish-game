/**
 * Fish IO - Complete Shop, Species, Weapons, Hats, Maps, Level Challenges & Upgrades
 */
const FISH_MAPS = {
    coral_reef: {
        id: 'coral_reef',
        name: 'Tropical Coral Reef',
        desc: 'Sunlit turquoise shallow waters with vibrant coral bushes and warm gentle currents.',
        bgColor1: '#041026',
        bgColor2: '#072448',
        bgColor3: '#031124',
        gridColor: 'rgba(0, 247, 255, 0.05)',
        barrierColor: 'rgba(0, 206, 201, 0.7)',
        ambientHue: 180,
        kelpDensity: 45
    },
    deep_abyss: {
        id: 'deep_abyss',
        name: 'Midnight Trench Abyss',
        desc: 'Pitch-black deep sea trench with glowing bio-luminescence and high-speed hydrothermal thermal vents.',
        bgColor1: '#020308',
        bgColor2: '#08081a',
        bgColor3: '#010205',
        gridColor: 'rgba(155, 89, 182, 0.06)',
        barrierColor: 'rgba(142, 68, 173, 0.8)',
        ambientHue: 275,
        kelpDensity: 30
    },
    arctic_ocean: {
        id: 'arctic_ocean',
        name: 'Glacial Arctic Ocean',
        desc: 'Freezing sub-zero glacial sea with floating icebergs, falling frost crystals, and frosty currents.',
        bgColor1: '#051d2d',
        bgColor2: '#0d3b59',
        bgColor3: '#041520',
        gridColor: 'rgba(178, 235, 242, 0.07)',
        barrierColor: 'rgba(129, 236, 236, 0.85)',
        ambientHue: 195,
        kelpDensity: 35
    },
    sunken_atlantis: {
        id: 'sunken_atlantis',
        name: 'Sunken Atlantis Ruins',
        desc: 'Ancient sunken marble temples, Greek columns, mystical rune circles, and golden treasure chests.',
        bgColor1: '#09151e',
        bgColor2: '#132e3b',
        bgColor3: '#060d13',
        gridColor: 'rgba(241, 196, 15, 0.06)',
        barrierColor: 'rgba(243, 156, 18, 0.85)',
        ambientHue: 45,
        kelpDensity: 40
    }
};

const FISH_SKINS = {
    baby_shark: {
        id: 'baby_shark',
        name: 'Baby Shark',
        cost: 0,
        unlocked: true,
        desc: 'Agile & hungry rookie of the reef.',
        primaryColor: '#3498db',
        secondaryColor: '#ecf0f1',
        bellyColor: '#ffffff',
        finColor: '#2980b9',
        eyeColor: '#2c3e50',
        stats: { speed: 1.0, turn: 1.0, boost: 1.0, reach: 1.0, growth: 1.0 }
    },
    clownfish: {
        id: 'clownfish',
        name: 'Clownfish (Nemo)',
        cost: 500,
        unlocked: false,
        desc: 'Quick and nimble with high maneuverability.',
        primaryColor: '#e67e22',
        secondaryColor: '#ffffff',
        bellyColor: '#d35400',
        finColor: '#1e272e',
        eyeColor: '#2c3e50',
        stats: { speed: 1.12, turn: 1.3, boost: 1.05, reach: 0.95, growth: 0.88 }
    },
    piranha: {
        id: 'piranha',
        name: 'Red-Belly Piranha',
        cost: 1200,
        unlocked: false,
        desc: 'Fierce Amazonian brawler with explosive burst speed.',
        primaryColor: '#c0392b',
        secondaryColor: '#e74c3c',
        bellyColor: '#f39c12',
        finColor: '#7f1d1d',
        eyeColor: '#ffeb3b',
        stats: { speed: 1.15, turn: 1.18, boost: 1.25, reach: 1.0, growth: 1.02 }
    },
    pufferfish: {
        id: 'pufferfish',
        name: 'Spiky Puffer',
        cost: 2500,
        unlocked: false,
        desc: 'Tough spiky body with extra stamina.',
        primaryColor: '#f1c40f',
        secondaryColor: '#e67e22',
        bellyColor: '#fdfefe',
        finColor: '#d4ac0d',
        eyeColor: '#1a5276',
        stats: { speed: 0.98, turn: 1.12, boost: 1.4, reach: 1.05, growth: 1.06 }
    },
    manta_ray: {
        id: 'manta_ray',
        name: 'Ocean Manta Ray',
        cost: 4800,
        unlocked: false,
        desc: 'Majestic broad-winged glider with exceptional maneuverability.',
        primaryColor: '#2c3e50',
        secondaryColor: '#ecf0f1',
        bellyColor: '#ffffff',
        finColor: '#1a252f',
        eyeColor: '#00cec9',
        stats: { speed: 1.16, turn: 1.38, boost: 1.22, reach: 1.15, growth: 1.08 }
    },
    anglerfish: {
        id: 'anglerfish',
        name: 'Abyss Anglerfish',
        cost: 8500,
        unlocked: false,
        desc: 'Deep-sea monster with glowing bio-luminescent lure.',
        primaryColor: '#4a148c',
        secondaryColor: '#7b1fa2',
        bellyColor: '#9c27b0',
        finColor: '#311b92',
        eyeColor: '#00f7ff',
        stats: { speed: 1.08, turn: 1.14, boost: 1.18, reach: 1.18, growth: 1.1 }
    },
    electric_eel: {
        id: 'electric_eel',
        name: 'Volt Electric Eel',
        cost: 14000,
        unlocked: false,
        desc: 'High-voltage sinuous predator that shocks prey.',
        primaryColor: '#2ed573',
        secondaryColor: '#7bed9f',
        bellyColor: '#70a1ff',
        finColor: '#1e90ff',
        eyeColor: '#eccc68',
        stats: { speed: 1.22, turn: 1.3, boost: 1.38, reach: 1.25, growth: 1.08 }
    },
    swordfish: {
        id: 'swordfish',
        name: 'Deep Swordfish',
        cost: 22000,
        unlocked: false,
        desc: 'Born with superior reach and piercing speed.',
        primaryColor: '#1b4f72',
        secondaryColor: '#5499c7',
        bellyColor: '#ebf5fb',
        finColor: '#154360',
        eyeColor: '#17202a',
        stats: { speed: 1.18, turn: 1.05, boost: 1.2, reach: 1.35, growth: 1.14 }
    },
    hammerhead: {
        id: 'hammerhead',
        name: 'Hammerhead Shark',
        cost: 35000,
        unlocked: false,
        desc: 'Heavy brawler with wide field of attack.',
        primaryColor: '#7f8c8d',
        secondaryColor: '#bdc3c7',
        bellyColor: '#f2f4f4',
        finColor: '#566573',
        eyeColor: '#17202a',
        stats: { speed: 1.08, turn: 1.08, boost: 1.25, reach: 1.22, growth: 1.16 }
    },
    thresher_shark: {
        id: 'thresher_shark',
        name: 'Thresher Shark',
        cost: 55000,
        unlocked: false,
        desc: 'Whip-tail predator with high agility and quick turns.',
        primaryColor: '#2c3e50',
        secondaryColor: '#4ca1af',
        bellyColor: '#ecf0f1',
        finColor: '#1a252f',
        eyeColor: '#00cec9',
        stats: { speed: 1.16, turn: 1.26, boost: 1.22, reach: 1.2, growth: 1.12 }
    },
    sawshark: {
        id: 'sawshark',
        name: 'Serrated Sawshark',
        cost: 80000,
        unlocked: false,
        desc: 'Prehistoric shark equipped with a deadly natural blade snout.',
        primaryColor: '#808e9b',
        secondaryColor: '#d2dae2',
        bellyColor: '#f1f2f6',
        finColor: '#485460',
        eyeColor: '#ff3f34',
        stats: { speed: 1.14, turn: 1.1, boost: 1.28, reach: 1.48, growth: 1.18 }
    },
    tiger_shark: {
        id: 'tiger_shark',
        name: 'Tiger Shark',
        cost: 120000,
        unlocked: false,
        desc: 'Striped oceanic stalker with high stamina & growth.',
        primaryColor: '#d35400',
        secondaryColor: '#f39c12',
        bellyColor: '#fef9e7',
        finColor: '#962d00',
        eyeColor: '#c0392b',
        stats: { speed: 1.12, turn: 1.12, boost: 1.28, reach: 1.25, growth: 1.16 }
    },
    orca: {
        id: 'orca',
        name: 'Killer Orca',
        cost: 180000,
        unlocked: false,
        desc: 'Deadly apex pack hunter with fierce burst and colossal size.',
        primaryColor: '#17202a',
        secondaryColor: '#ffffff',
        bellyColor: '#ffffff',
        finColor: '#0e1117',
        eyeColor: '#3498db',
        stats: { speed: 1.2, turn: 1.12, boost: 1.35, reach: 1.22, growth: 1.22 }
    },
    great_white: {
        id: 'great_white',
        name: 'Great White Shark',
        cost: 260000,
        unlocked: false,
        desc: 'Massive terror of the sea. Tremendous growth potential.',
        primaryColor: '#4a6572',
        secondaryColor: '#95a5a6',
        bellyColor: '#ffffff',
        finColor: '#34495e',
        eyeColor: '#c0392b',
        stats: { speed: 1.14, turn: 1.05, boost: 1.3, reach: 1.3, growth: 1.25 }
    },
    narwhal: {
        id: 'narwhal',
        name: 'Mystic Narwhal',
        cost: 380000,
        unlocked: false,
        desc: 'Unicorn of the depths with legendary spiral horn lance reach.',
        primaryColor: '#6c5ce7',
        secondaryColor: '#a29bfe',
        bellyColor: '#f1f2f6',
        finColor: '#574b90',
        eyeColor: '#00f7ff',
        stats: { speed: 1.15, turn: 1.15, boost: 1.3, reach: 1.45, growth: 1.2 }
    },
    ghost_shark: {
        id: 'ghost_shark',
        name: 'Phantom Ghost Shark',
        cost: 540000,
        unlocked: false,
        desc: 'Ethereal deep-sea chimera that glides unseen through shadows.',
        primaryColor: '#74b9ff',
        secondaryColor: '#dfe6e9',
        bellyColor: '#ffffff',
        finColor: '#a29bfe',
        eyeColor: '#00f7ff',
        stats: { speed: 1.28, turn: 1.22, boost: 1.35, reach: 1.35, growth: 1.2 }
    },
    sea_turtle: {
        id: 'sea_turtle',
        name: 'Ancient Sea Turtle',
        cost: 750000,
        unlocked: false,
        desc: 'Heavily armored shell with immense boost capacity.',
        primaryColor: '#27ae60',
        secondaryColor: '#2ecc71',
        bellyColor: '#f1c40f',
        finColor: '#1e8449',
        eyeColor: '#2c3e50',
        stats: { speed: 1.02, turn: 1.2, boost: 1.65, reach: 1.15, growth: 1.24 }
    },
    kraken_squid: {
        id: 'kraken_squid',
        name: 'Abyssal Kraken',
        cost: 1050000,
        unlocked: false,
        desc: 'Deep trench horror that expands into a multi-tentacled behemoth.',
        primaryColor: '#8e44ad',
        secondaryColor: '#9b59b6',
        bellyColor: '#e056fd',
        finColor: '#6c5ce7',
        eyeColor: '#ff007f',
        stats: { speed: 1.2, turn: 1.28, boost: 1.45, reach: 1.4, growth: 1.28 }
    },
    megalodon: {
        id: 'megalodon',
        name: 'Ancient Megalodon',
        cost: 1500000,
        unlocked: false,
        desc: 'Colossal prehistoric apex giant that grows to dominate the map.',
        primaryColor: '#2c3e50',
        secondaryColor: '#e74c3c',
        bellyColor: '#bdc3c7',
        finColor: '#1a252f',
        eyeColor: '#e74c3c',
        stats: { speed: 1.18, turn: 1.08, boost: 1.45, reach: 1.45, growth: 1.32 }
    },
    phoenix_fish: {
        id: 'phoenix_fish',
        name: 'Solar Phoenix Fish',
        cost: 2100000,
        unlocked: false,
        desc: 'Born from volcanic hydrothermal vents with blazing solar wings.',
        primaryColor: '#ff4757',
        secondaryColor: '#ffa502',
        bellyColor: '#ff6b81',
        finColor: '#ff7f50',
        eyeColor: '#ffd700',
        stats: { speed: 1.3, turn: 1.28, boost: 1.55, reach: 1.38, growth: 1.26 }
    },
    sunfish_mola: {
        id: 'sunfish_mola',
        name: 'Titan Ocean Sunfish',
        cost: 2900000,
        unlocked: false,
        desc: 'Colossal heavyweight giant with unmatched natural armor and massive size.',
        primaryColor: '#57606f',
        secondaryColor: '#a4b0be',
        bellyColor: '#ced6e0',
        finColor: '#2f3542',
        eyeColor: '#ffa502',
        stats: { speed: 1.06, turn: 1.0, boost: 1.7, reach: 1.5, growth: 1.35 }
    },
    cyber_shark: {
        id: 'cyber_shark',
        name: 'Cyber Mecha Shark',
        cost: 4000000,
        unlocked: false,
        desc: 'High-tech robotic predator with neon thrusters and hyper-agile frame.',
        primaryColor: '#00cec9',
        secondaryColor: '#0984e3',
        bellyColor: '#dfe6e9',
        finColor: '#fd79a8',
        eyeColor: '#ff007f',
        stats: { speed: 1.28, turn: 1.24, boost: 1.5, reach: 1.35, growth: 1.28 }
    },
    deep_goblin: {
        id: 'deep_goblin',
        name: 'Deep-Sea Goblin Shark',
        cost: 5500000,
        unlocked: false,
        desc: 'Living fossil from the abyss with terrifying strike distance and growth.',
        primaryColor: '#ff9ff3',
        secondaryColor: '#f368e0',
        bellyColor: '#54a0ff',
        finColor: '#5f27cd',
        eyeColor: '#ff4d4d',
        stats: { speed: 1.26, turn: 1.18, boost: 1.5, reach: 1.6, growth: 1.3 }
    },
    golden_leviathan: {
        id: 'golden_leviathan',
        name: 'Golden Leviathan Dragon',
        cost: 8000000,
        unlocked: false,
        desc: 'Mythical ruler of all oceans. Supreme royal stats and apocalyptic growth.',
        primaryColor: '#ffd700',
        secondaryColor: '#f39c12',
        bellyColor: '#fff9e6',
        finColor: '#e67e22',
        eyeColor: '#ff0000',
        stats: { speed: 1.35, turn: 1.28, boost: 1.6, reach: 1.55, growth: 1.38 }
    }
};

const WEAPON_SKINS = {
    coral_dagger: {
        id: 'coral_dagger',
        name: 'Coral Blade',
        cost: 0,
        unlocked: true,
        desc: 'Sharp oceanic coral dagger.',
        perk: 'Standard starter blade.',
        bladeColor: '#00cec9',
        glowColor: '#81ecec',
        hiltColor: '#2d3436',
        trailColor: 'rgba(0, 206, 201, 0.4)',
        lengthMult: 1.0,
        widthMult: 1.0
    },
    wooden_spear: {
        id: 'wooden_spear',
        name: 'Tribal Bone Spear',
        cost: 200,
        unlocked: false,
        desc: 'Handcrafted sharpened tribal sea spear with quick piercing range.',
        perk: '💨 +12% Boost Speed',
        bladeColor: '#dcdde1',
        glowColor: '#f5cd79',
        hiltColor: '#7158e2',
        trailColor: 'rgba(245, 205, 121, 0.4)',
        lengthMult: 1.2,
        widthMult: 1.05
    },
    iron_cutlass: {
        id: 'iron_cutlass',
        name: 'Iron Cutlass',
        cost: 450,
        unlocked: false,
        desc: 'Sturdy forged naval blade with a broad slashing arc.',
        perk: '⚔️ +20% Blade Cleave Width',
        bladeColor: '#b2bec3',
        glowColor: '#74b9ff',
        hiltColor: '#2d3436',
        trailColor: 'rgba(116, 185, 255, 0.4)',
        lengthMult: 1.38,
        widthMult: 1.22
    },
    ninja_katana: {
        id: 'ninja_katana',
        name: 'Ninja Katana',
        cost: 800,
        unlocked: false,
        desc: 'Forged underwater steel with razor edge and hyper-fast steering.',
        perk: '🔄 +30% Turn Agility',
        bladeColor: '#dfe6e9',
        glowColor: '#00f7ff',
        hiltColor: '#e74c3c',
        trailColor: 'rgba(0, 247, 255, 0.5)',
        lengthMult: 1.55,
        widthMult: 1.18
    },
    trident: {
        id: 'trident',
        name: 'Ocean Trident',
        cost: 1400,
        unlocked: false,
        desc: 'Three-pronged royal spear of Neptune with massive frontal coverage.',
        perk: '🔱 3-Pronged Tri-Strike (+50% Hitbox Area)',
        bladeColor: '#f1c40f',
        glowColor: '#f39c12',
        hiltColor: '#d35400',
        trailColor: 'rgba(241, 196, 15, 0.5)',
        lengthMult: 1.75,
        widthMult: 1.75
    },
    pirate_sabre: {
        id: 'pirate_sabre',
        name: 'Pirate Skull Sabre',
        cost: 2200,
        unlocked: false,
        desc: 'Heavy curved cutlass that plunders extra gold bounties from kills.',
        perk: '🏴‍☠️ Plunderer: +50% Bonus Gold on Kills',
        bladeColor: '#b2bec3',
        glowColor: '#e17055',
        hiltColor: '#f1c40f',
        trailColor: 'rgba(225, 112, 85, 0.5)',
        lengthMult: 1.95,
        widthMult: 1.55
    },
    laser_saber: {
        id: 'laser_saber',
        name: 'Plasma Laser Saber',
        cost: 3800,
        unlocked: false,
        desc: 'Supercharged ionized beam blade that accelerates swimming speed.',
        perk: '✨ Ion Core: +35% Base Swimming Speed',
        bladeColor: '#ff007f',
        glowColor: '#ff7675',
        hiltColor: '#2d3436',
        trailColor: 'rgba(255, 0, 127, 0.6)',
        lengthMult: 2.15,
        widthMult: 1.45
    },
    saw_blade: {
        id: 'saw_blade',
        name: 'Sawtooth Ripper',
        cost: 5800,
        unlocked: false,
        desc: 'Serrated titanium teeth that shred enemies for massive XP.',
        perk: '🪚 Meat Shredder: +75% XP per Kill',
        bladeColor: '#e74c3c',
        glowColor: '#c0392b',
        hiltColor: '#2c3e50',
        trailColor: 'rgba(231, 76, 60, 0.6)',
        lengthMult: 2.35,
        widthMult: 1.85
    },
    ice_crystal: {
        id: 'ice_crystal',
        name: 'Glacial Ice Spear',
        cost: 8000,
        unlocked: false,
        desc: 'Forged from eternal arctic permafrost. Chills and slows nearby enemies.',
        perk: '❄️ Frost Nova: Chills nearby prey by 50% on kill',
        bladeColor: '#a8ff78',
        glowColor: '#78ffd6',
        hiltColor: '#00cec9',
        trailColor: 'rgba(120, 255, 214, 0.6)',
        lengthMult: 2.6,
        widthMult: 1.65
    },
    volcano_magma: {
        id: 'volcano_magma',
        name: 'Volcano Magma Blade',
        cost: 11000,
        unlocked: false,
        desc: 'Molten hydrothermal obsidian sword that creates explosive magma bursts.',
        perk: '🔥 Magma Blast: Spawns explosive meat burst on kill',
        bladeColor: '#ff4757',
        glowColor: '#ffa502',
        hiltColor: '#2f3542',
        trailColor: 'rgba(255, 71, 87, 0.7)',
        lengthMult: 2.9,
        widthMult: 2.0
    },
    excalibur: {
        id: 'excalibur',
        name: 'Holy Excalibur',
        cost: 15000,
        unlocked: false,
        desc: 'Radiant blade blessed with divine underwater light and auto-shields.',
        perk: '👑 Holy Radiance: Spawns a Divine Bubble Shield every 25s',
        bladeColor: '#ffffff',
        glowColor: '#ffd700',
        hiltColor: '#f39c12',
        trailColor: 'rgba(255, 215, 0, 0.7)',
        lengthMult: 3.25,
        widthMult: 2.1
    },
    thunder_spear: {
        id: 'thunder_spear',
        name: 'Mjolnir Thunder Spear',
        cost: 19000,
        unlocked: false,
        desc: 'Electrified storm blade crackling with high voltage that zaps surrounding fish.',
        perk: '⚡ Mjolnir Shockwave: Chain lightning stuns nearby fish on kill',
        bladeColor: '#70a1ff',
        glowColor: '#1e90ff',
        hiltColor: '#5352ed',
        trailColor: 'rgba(30, 144, 255, 0.8)',
        lengthMult: 3.6,
        widthMult: 2.0
    },
    chainsaw: {
        id: 'chainsaw',
        name: 'Hydro Chainsaw',
        cost: 24000,
        unlocked: false,
        desc: 'Motorized dual-spinning diamond teeth with massive continuous cutting radius.',
        perk: '⛓️ Diamond Whirlwind: +100% Boost Stamina & Screen-clearing Cleave',
        bladeColor: '#ff6348',
        glowColor: '#ff4757',
        hiltColor: '#2f3542',
        trailColor: 'rgba(255, 99, 72, 0.8)',
        lengthMult: 4.0,
        widthMult: 2.5
    },
    dragon_horn: {
        id: 'dragon_horn',
        name: 'Dragon Horn Spear',
        cost: 32000,
        unlocked: false,
        desc: 'Flaming horn of the cosmic dragon. Colossal apocalyptic reach and 2x gold.',
        perk: '🐉 Dragon’s Wrath: Apocalyptic Range, +100% Gold & Double XP on Kills!',
        bladeColor: '#ff7675',
        glowColor: '#d63031',
        hiltColor: '#6c5ce7',
        trailColor: 'rgba(255, 82, 82, 0.8)',
        lengthMult: 4.5,
        widthMult: 2.8
    }
};

const FISH_HATS = {
    none: {
        id: 'none',
        name: 'No Hat',
        cost: 0,
        unlocked: true,
        desc: 'Natural sleek look.',
        type: 'none'
    },
    pirate_hat: {
        id: 'pirate_hat',
        name: 'Pirate Tricorn',
        cost: 300,
        unlocked: false,
        desc: 'Captain of the seven seas with skull crest.',
        type: 'pirate'
    },
    viking_helmet: {
        id: 'viking_helmet',
        name: 'Viking Horned Helm',
        cost: 650,
        unlocked: false,
        desc: 'Fierce horned metal raider helmet.',
        type: 'viking'
    },
    mini_crown: {
        id: 'mini_crown',
        name: 'Royal Mini Crown',
        cost: 1200,
        unlocked: false,
        desc: 'Jeweled gold crown for true oceanic royalty.',
        type: 'crown'
    },
    samurai_kabuto: {
        id: 'samurai_kabuto',
        name: 'Samurai Kabuto',
        cost: 2000,
        unlocked: false,
        desc: 'Traditional warrior helm with golden crest.',
        type: 'samurai'
    },
    diving_goggles: {
        id: 'diving_goggles',
        name: 'Diving Goggles',
        cost: 3000,
        unlocked: false,
        desc: 'High-visibility yellow scuba mask and snorkel.',
        type: 'goggles'
    },
    top_hat: {
        id: 'top_hat',
        name: 'Gentleman Top Hat',
        cost: 4500,
        unlocked: false,
        desc: 'Sophisticated gentleman with red silk ribbon.',
        type: 'tophat'
    },
    cyber_visor: {
        id: 'cyber_visor',
        name: 'Neon Cyber Visor',
        cost: 6500,
        unlocked: false,
        desc: 'Glowing holographic sci-fi tactical visor.',
        type: 'cyber'
    },
    chef_hat: {
        id: 'chef_hat',
        name: 'Sushi Chef Hat',
        cost: 9000,
        unlocked: false,
        desc: 'Master sushi maker toque.',
        type: 'chef'
    },
    angel_halo: {
        id: 'angel_halo',
        name: 'Celestial Angel Halo',
        cost: 13000,
        unlocked: false,
        desc: 'Floating golden ring of heavenly light.',
        type: 'halo'
    },
    devil_horns: {
        id: 'devil_horns',
        name: 'Abyssal Devil Horns',
        cost: 18000,
        unlocked: false,
        desc: 'Glowing crimson infernal horns.',
        type: 'horns'
    },
    party_hat: {
        id: 'party_hat',
        name: 'Party Cone Hat',
        cost: 25000,
        unlocked: false,
        desc: 'Colorful festive cone with confetti pompom.',
        type: 'party'
    }
};

const WORKSHOP_UPGRADES = {
    speed_boost: {
        id: 'speed_boost',
        name: 'Swim Speed Engine',
        desc: 'Permanently boosts base swimming speed by +4% per level.',
        maxLevel: 5,
        baseCost: 200,
        costMult: 2.2,
        statName: 'speed',
        bonusPerLevel: 0.04
    },
    stamina_cap: {
        id: 'stamina_cap',
        name: 'Turbo Tank Capacity',
        desc: 'Increases maximum boost stamina by +15 per level.',
        maxLevel: 5,
        baseCost: 250,
        costMult: 2.2,
        statName: 'stamina',
        bonusPerLevel: 15
    },
    stamina_regen: {
        id: 'stamina_regen',
        name: 'Oxygen Rebreather',
        desc: 'Increases stamina recovery rate by +12% per level.',
        maxLevel: 5,
        baseCost: 300,
        costMult: 2.2,
        statName: 'regen',
        bonusPerLevel: 0.12
    },
    starting_size: {
        id: 'starting_size',
        name: 'Genetic Growth Surge',
        desc: 'Start every match with +1 starting Level.',
        maxLevel: 5,
        baseCost: 500,
        costMult: 2.5,
        statName: 'startLevel',
        bonusPerLevel: 1
    },
    magnet_radius: {
        id: 'magnet_radius',
        name: 'Sushi Magnet Aura',
        desc: 'Increases natural food attraction radius by +20% per level.',
        maxLevel: 5,
        baseCost: 350,
        costMult: 2.2,
        statName: 'magnet',
        bonusPerLevel: 0.20
    }
};

// 15 Level Challenges with unique stage goals and boss battles!
const LEVEL_CHALLENGES = [
    { level: 1, title: 'Reef Rookie', map: 'coral_reef', goalType: 'kills', target: 3, reward: 200, stars: 3, desc: 'Slice 3 fish in the Tropical Reef' },
    { level: 2, title: 'Sushi Feast', map: 'coral_reef', goalType: 'food', target: 40, reward: 250, stars: 3, desc: 'Eat 40 sushi pieces to grow' },
    { level: 3, title: 'Treasure Seeker', map: 'coral_reef', goalType: 'chests', target: 1, reward: 300, stars: 3, desc: 'Break open 1 Sunken Treasure Chest' },
    { level: 4, title: 'Speed Striker', map: 'coral_reef', goalType: 'kills_timed', target: 4, timeLimit: 45, reward: 350, stars: 3, desc: 'Slice 4 fish in under 45 seconds' },
    { level: 5, title: 'Coral Gladiator', map: 'coral_reef', goalType: 'level', target: 6, reward: 450, stars: 3, desc: 'Reach Level 6 in the Reef' },
    
    { level: 6, title: 'Abyss Descent', map: 'deep_abyss', goalType: 'kills', target: 5, reward: 550, stars: 3, desc: 'Slice 5 predators in the Midnight Trench' },
    { level: 7, title: 'Hydro Rush', map: 'deep_abyss', goalType: 'food', target: 75, reward: 600, stars: 3, desc: 'Collect 75 deep-sea sushi pieces' },
    { level: 8, title: 'Crown Usurper', map: 'deep_abyss', goalType: 'slay_king', target: 1, reward: 800, stars: 3, desc: 'Hunt down and slay the Ocean King' },
    { level: 9, title: 'Deep Dominator', map: 'deep_abyss', goalType: 'level', target: 8, reward: 900, stars: 3, desc: 'Evolve to Level 8 in the Abyss' },
    { level: 10, title: 'BOSS: Megalodon', map: 'deep_abyss', goalType: 'boss_megalodon', target: 1, isBoss: true, reward: 1500, stars: 3, desc: 'Defeat the Giant Boss Megalodon!' },

    { level: 11, title: 'Glacial Hunt', map: 'arctic_ocean', goalType: 'kills', target: 7, reward: 1000, stars: 3, desc: 'Slice 7 sharks in the Arctic Ocean' },
    { level: 12, title: 'Frost Rampage', map: 'arctic_ocean', goalType: 'streak', target: 3, reward: 1200, stars: 3, desc: 'Achieve a Triple Kill streak in the Ice' },
    { level: 13, title: 'Atlantis Vault', map: 'sunken_atlantis', goalType: 'chests', target: 3, reward: 1500, stars: 3, desc: 'Crack open 3 Atlantis Treasure Chests' },
    { level: 14, title: 'Apex Predator', map: 'sunken_atlantis', goalType: 'level', target: 10, reward: 2000, stars: 3, desc: 'Reach Level 10 in Sunken Atlantis' },
    { level: 15, title: 'BOSS: Golden Leviathan', map: 'sunken_atlantis', goalType: 'boss_leviathan', target: 1, isBoss: true, reward: 3500, stars: 3, desc: 'Slay the Royal Golden Leviathan Dragon!' }
];

const DAILY_REWARDS = [
    { day: 1, gold: 200, label: '200 💰' },
    { day: 2, gold: 400, label: '400 💰' },
    { day: 3, gold: 600, label: '600 💰' },
    { day: 4, gold: 900, label: '900 💰' },
    { day: 5, gold: 1200, label: '1,200 💰' },
    { day: 6, gold: 1600, label: '1,600 💰' },
    { day: 7, gold: 3000, label: '3,000 💰 + 👑' }
];

const WHEEL_SECTORS = [
    { label: '100 💰', gold: 100, color: '#3498db' },
    { label: '250 💰', gold: 250, color: '#9b59b6' },
    { label: '500 💰', gold: 500, color: '#e67e22' },
    { label: '1,000 💰', gold: 1000, color: '#e74c3c' },
    { label: '2,500 👑', gold: 2500, color: '#f1c40f' },
    { label: '150 💰', gold: 150, color: '#1abc9c' },
    { label: '750 💰', gold: 750, color: '#e84393' },
    { label: '5,000 💎', gold: 5000, color: '#ffd700' }
];

class ShopManager {
    constructor() {
        this.gold = 0;
        this.selectedFish = 'baby_shark';
        this.selectedWeapon = 'coral_dagger';
        this.selectedHat = 'none';
        this.selectedMap = 'coral_reef';
        this.playerName = 'SharkKing';
        this.highScore = 0;
        this.totalKills = 0;
        this.totalChests = 0;
        this.unlockedFish = ['baby_shark'];
        this.unlockedWeapons = ['coral_dagger'];
        this.unlockedHats = ['none'];
        this.upgrades = {
            speed_boost: 0,
            stamina_cap: 0,
            stamina_regen: 0,
            starting_size: 0,
            magnet_radius: 0
        };

        // Level Challenges Progression
        this.unlockedChallengeLevel = 1;
        this.completedChallengeLevels = [];
        this.levelStars = {};

        this.dailyLoginDay = 1;
        this.lastLoginTimestamp = 0;
        this.hasClaimedDailyToday = false;
        this.freeWheelSpins = 1;

        this.loadSaveData();
        this.checkDailyReset();
    }

    checkDailyReset() {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (now - this.lastLoginTimestamp > oneDay) {
            this.hasClaimedDailyToday = false;
            this.freeWheelSpins = Math.max(this.freeWheelSpins, 1);
            if (now - this.lastLoginTimestamp > 2 * oneDay) {
                this.dailyLoginDay = 1;
            }
        }
    }

    loadSaveData() {
        try {
            const data = JSON.parse(localStorage.getItem('fishio_savedata_v4') || '{}');
            if (data.gold !== undefined) this.gold = data.gold;
            if (data.selectedFish && FISH_SKINS[data.selectedFish]) this.selectedFish = data.selectedFish;
            if (data.selectedWeapon && WEAPON_SKINS[data.selectedWeapon]) this.selectedWeapon = data.selectedWeapon;
            if (data.selectedHat && FISH_HATS[data.selectedHat]) this.selectedHat = data.selectedHat;
            if (data.selectedMap && FISH_MAPS[data.selectedMap]) this.selectedMap = data.selectedMap;
            if (data.playerName) this.playerName = data.playerName;
            if (data.highScore) this.highScore = data.highScore;
            if (data.totalKills) this.totalKills = data.totalKills;
            if (data.totalChests) this.totalChests = data.totalChests;
            if (Array.isArray(data.unlockedFish)) this.unlockedFish = data.unlockedFish;
            if (Array.isArray(data.unlockedWeapons)) this.unlockedWeapons = data.unlockedWeapons;
            if (Array.isArray(data.unlockedHats)) this.unlockedHats = data.unlockedHats;
            if (data.upgrades) this.upgrades = Object.assign(this.upgrades, data.upgrades);

            if (data.unlockedChallengeLevel) this.unlockedChallengeLevel = data.unlockedChallengeLevel;
            if (Array.isArray(data.completedChallengeLevels)) this.completedChallengeLevels = data.completedChallengeLevels;
            if (data.levelStars) this.levelStars = data.levelStars;

            if (data.dailyLoginDay) this.dailyLoginDay = data.dailyLoginDay;
            if (data.lastLoginTimestamp) this.lastLoginTimestamp = data.lastLoginTimestamp;
            if (data.hasClaimedDailyToday !== undefined) this.hasClaimedDailyToday = data.hasClaimedDailyToday;
            if (data.freeWheelSpins !== undefined) this.freeWheelSpins = data.freeWheelSpins;

            if (!this.unlockedFish.includes('baby_shark')) this.unlockedFish.push('baby_shark');
            if (!this.unlockedWeapons.includes('coral_dagger')) this.unlockedWeapons.push('coral_dagger');
            if (!this.unlockedHats.includes('none')) this.unlockedHats.push('none');
        } catch (e) {
            console.warn('Save data load error', e);
        }
    }

    save() {
        try {
            const data = {
                gold: this.gold,
                selectedFish: this.selectedFish,
                selectedWeapon: this.selectedWeapon,
                selectedHat: this.selectedHat,
                selectedMap: this.selectedMap,
                playerName: this.playerName,
                highScore: this.highScore,
                totalKills: this.totalKills,
                totalChests: this.totalChests,
                unlockedFish: this.unlockedFish,
                unlockedWeapons: this.unlockedWeapons,
                unlockedHats: this.unlockedHats,
                upgrades: this.upgrades,
                unlockedChallengeLevel: this.unlockedChallengeLevel,
                completedChallengeLevels: this.completedChallengeLevels,
                levelStars: this.levelStars,
                dailyLoginDay: this.dailyLoginDay,
                lastLoginTimestamp: this.lastLoginTimestamp,
                hasClaimedDailyToday: this.hasClaimedDailyToday,
                freeWheelSpins: this.freeWheelSpins
            };
            localStorage.setItem('fishio_savedata_v4', JSON.stringify(data));
        } catch (e) {
            console.warn('Save error', e);
        }
    }

    addGold(amount) {
        this.gold += amount;
        this.save();
        return this.gold;
    }

    completeLevelChallenge(levelNum, stars = 3) {
        const stage = LEVEL_CHALLENGES.find(l => l.level === levelNum);
        if (!stage) return 0;

        const isFirstClear = !this.completedChallengeLevels.includes(levelNum);
        if (isFirstClear) {
            this.completedChallengeLevels.push(levelNum);
            this.unlockedChallengeLevel = Math.max(this.unlockedChallengeLevel, levelNum + 1);
            this.addGold(stage.reward);
        }

        this.levelStars[levelNum] = Math.max(this.levelStars[levelNum] || 0, stars);
        this.save();
        return stage.reward;
    }

    claimDailyReward() {
        if (this.hasClaimedDailyToday) return false;
        const reward = DAILY_REWARDS[(this.dailyLoginDay - 1) % DAILY_REWARDS.length];
        this.addGold(reward.gold);
        this.hasClaimedDailyToday = true;
        this.lastLoginTimestamp = Date.now();
        this.dailyLoginDay = (this.dailyLoginDay % 7) + 1;
        this.save();
        return reward;
    }

    recordMatch(score, matchKills, matchChests = 0, kingTime = 0, maxLevel = 1, matchFood = 0) {
        if (score > this.highScore) this.highScore = score;
        this.totalKills += matchKills;
        this.totalChests += matchChests;
        this.save();
    }

    unlockFish(id) {
        const item = FISH_SKINS[id];
        if (!item || this.unlockedFish.includes(id)) return false;
        if (this.gold >= item.cost) {
            this.gold -= item.cost;
            this.unlockedFish.push(id);
            this.selectedFish = id;
            this.save();
            return true;
        }
        return false;
    }

    unlockWeapon(id) {
        const item = WEAPON_SKINS[id];
        if (!item || this.unlockedWeapons.includes(id)) return false;
        if (this.gold >= item.cost) {
            this.gold -= item.cost;
            this.unlockedWeapons.push(id);
            this.selectedWeapon = id;
            this.save();
            return true;
        }
        return false;
    }

    unlockHat(id) {
        const item = FISH_HATS[id];
        if (!item || this.unlockedHats.includes(id)) return false;
        if (this.gold >= item.cost) {
            this.gold -= item.cost;
            this.unlockedHats.push(id);
            this.selectedHat = id;
            this.save();
            return true;
        }
        return false;
    }

    buyUpgrade(id) {
        const upg = WORKSHOP_UPGRADES[id];
        if (!upg) return false;
        const curLevel = this.upgrades[id] || 0;
        if (curLevel >= upg.maxLevel) return false;

        const cost = Math.round(upg.baseCost * Math.pow(upg.costMult, curLevel));
        if (this.gold >= cost) {
            this.gold -= cost;
            this.upgrades[id] = curLevel + 1;
            this.save();
            return true;
        }
        return false;
    }

    selectFish(id) {
        if (this.unlockedFish.includes(id)) {
            this.selectedFish = id;
            this.save();
            return true;
        }
        return false;
    }

    selectWeapon(id) {
        if (this.unlockedWeapons.includes(id)) {
            this.selectedWeapon = id;
            this.save();
            return true;
        }
        return false;
    }

    selectHat(id) {
        if (this.unlockedHats.includes(id)) {
            this.selectedHat = id;
            this.save();
            return true;
        }
        return false;
    }

    selectMap(id) {
        if (FISH_MAPS[id]) {
            this.selectedMap = id;
            this.save();
            return true;
        }
        return false;
    }
}

// ===== Gear Progression Tiers =====
// Weapons & fish species are grouped into 5 cost-based tiers. Early matches only
// face starter gear; stronger loadouts appear as the player levels up / match progresses.
function buildGearTiers(dict, tierCount = 5) {
    const items = Object.keys(dict).map(k => dict[k]).sort((a, b) => (a.cost || 0) - (b.cost || 0));
    const tiers = Array.from({ length: tierCount }, () => []);
    items.forEach((item, i) => {
        const t = Math.min(tierCount - 1, Math.floor((i / items.length) * tierCount));
        tiers[t].push(item.id);
    });
    return tiers;
}
const WEAPON_TIERS = buildGearTiers(WEAPON_SKINS, 5);
const FISH_TIERS = buildGearTiers(FISH_SKINS, 5);
const GEAR_TIER_NAMES = ['Rusty', 'Sharp', 'Forged', 'Exotic', 'Legendary'];

window.WEAPON_TIERS = WEAPON_TIERS;
window.FISH_TIERS = FISH_TIERS;
window.GEAR_TIER_NAMES = GEAR_TIER_NAMES;
window.getWeaponTier = function (id) {
    for (let t = 0; t < WEAPON_TIERS.length; t++) if (WEAPON_TIERS[t].includes(id)) return t;
    return 0;
};
window.getFishTier = function (id) {
    for (let t = 0; t < FISH_TIERS.length; t++) if (FISH_TIERS[t].includes(id)) return t;
    return 0;
};

window.FISH_MAPS = FISH_MAPS;
window.FISH_SKINS = FISH_SKINS;
window.WEAPON_SKINS = WEAPON_SKINS;
window.FISH_HATS = FISH_HATS;
window.WORKSHOP_UPGRADES = WORKSHOP_UPGRADES;
window.LEVEL_CHALLENGES = LEVEL_CHALLENGES;
window.DAILY_REWARDS = DAILY_REWARDS;
window.WHEEL_SECTORS = WHEEL_SECTORS;
window.ShopManager = ShopManager;
window.shopManager = new ShopManager();
