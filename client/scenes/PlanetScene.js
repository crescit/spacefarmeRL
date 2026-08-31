// PlanetScene.js — Main farm gameplay on Asteroid B-612
// Harvest Moon mechanics: farming, NPCs, social, dating, economy.
// Visuals: 2000s-era pixel-art space colony — dome house, village, energy
// fences, solar lamps, parallax nebula backdrop, zoom-2 scroll camera,
// day/night lighting.
//
// Architecture:
//   - MapData.js    → layout (ground, blocks, buildings, decor, NPC positions)
//   - SpriteSystem  → texture registry (game.js registers into Phaser)
//   - This scene    → state, input, interaction, render orchestration

import { NPC_DATA } from '../entities/NPCData.js';
import { ALIEN_DATA, CONTACT_DOCTRINES } from '../entities/AlienData.js';
import { story } from '../systems/StoryService.js';
import { TouchControls } from '../systems/TouchControls.js';
import { DialoguePanel } from '../systems/DialoguePanel.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { questView, questChip, QUESTS, rewardLine } from '../systems/QuestSystem.js';
import { calendar, SEASON_NAMES, DAYS_PER_SEASON } from '../systems/CalendarService.js';
import { schemaEntries } from '../systems/NetworkSystem.js';
import {
  MAP_W, MAP_H, ground, blocks, BUILDINGS, DECOR, NPC_POS,
  PLAYER_START, fenceSpans, FENCE_Y_EXPORT,
  MINE_SPOT, DEEP_DROP_SPOT,
} from '../systems/MapData.js';

const T = 32;
const VW = MAP_W * T; // 640
const VH = MAP_H * T; // 512
const FENCE_Y = FENCE_Y_EXPORT;
const ZOOM = 1;

// crops the planet grows — mirrors the server's seasonal rules so the UI can
// tell the player which seasons a crop grows in and whether it re-grows.
const CROP_SEASONS = {
  'space-wheat':   { seasons: [0, 2], regrow: true },
  'star-berry':    { seasons: [1],    regrow: true },
  'moon-melon':    { seasons: [1, 2], regrow: false },
  'plasma-tomato': { seasons: [0, 1], regrow: false },
  'nebula-pepper': { seasons: [2],    regrow: true },
  'glow-kelp':     { seasons: [3],    regrow: true },
};
// SEASON_NAMES comes from the shared calendar service (imported above) — the
// browser, server, and RL env ALL read the same season labels and dates.

// ── Kitchen recipes (M4) — mirrors server/rooms/FarmRoom.js RECIPES ──
const RECIPES_CLIENT = {
  'space-pudding':        { name: 'Space Pudding',        season: 0, ingredients: ['space-wheat', 'egg'],                sell: 70 },
  'green-nebula-broth':   { name: 'Green Nebula Broth',   season: 0, ingredients: ['space-wheat', 'egg', 'milk'],         sell: 110 },
  'wheat-star-salad':     { name: 'Wheat & Star Salad',   season: 0, ingredients: ['space-wheat', 'star-berry'],          sell: 60 },
  'nebula-stew':          { name: 'Nebula Stew',          season: 1, ingredients: ['space-wheat', 'plasma-tomato'],      sell: 90 },
  'melon-nectar-cobbler': { name: 'Melon Nectar Cobbler', season: 1, ingredients: ['moon-melon', 'egg'],                 sell: 95 },
  'plasma-skewer':        { name: 'Plasma Skewer',        season: 1, ingredients: ['plasma-tomato', 'space-wheat'],      sell: 85 },
  'berry-tart':           { name: 'Berry Tart',           season: 2, ingredients: ['star-berry', 'egg', 'space-wheat'],  sell: 100 },
  'melon-crostata':       { name: 'Melon Crostata',       season: 2, ingredients: ['moon-melon', 'egg'],                 sell: 90 },
  'autumn-roast':         { name: 'Autumn Roast',         season: 2, ingredients: ['space-wheat', 'plasma-tomato', 'egg'], sell: 130 },
  'stellar-fish-curry':   { name: 'Stellar Fish Curry',   season: 1, ingredients: ['moonfish', 'space-wheat'],           sell: 95 },
  'comet-trout-grille':   { name: 'Comet Trout Grille',   season: 2, ingredients: ['comet-trout', 'egg'],                sell: 150 },
  'solar-omakase':        { name: 'Solar Omakase',        season: 1, ingredients: ['stardust-salmon', 'nebula-marlin'], sell: 280 },
  'earth-feast-plate':    { name: 'Earth Feast Plate',    season: null, festival: true,
                            ingredients: ['space-wheat', 'egg', 'moon-melon'], sell: 300 },
};
// ingredient display labels (not just CROPS — also fish + produce)
const ING_LABEL = {
  'space-wheat': 'Wheat', 'star-berry': 'Star Berry', 'moon-melon': 'Melon',
  'plasma-tomato': 'Plasma Tomato', 'nebula-pepper': 'Nebula Pepper', 'glow-kelp': 'Glow Kelp',
  'moonfish': 'Moonfish', 'stardust-salmon': 'Salmon', 'comet-trout': 'Trout', 'nebula-marlin': 'Marlin',
  'egg': 'Egg', 'milk': 'Milk', 'wool': 'Wool',
};
const ingLabel = (k) => ING_LABEL[k] || k;

// ── M3 — Earth Day spectacle: plaza geometry + festival crowd ──
// The plaza sits in the open strip between the lamp posts (16,21,32 @ y12)
// and the tavern/exchange. Stage faces the crowd; bunting spans the lamps.
const FEST_PLAZA = { x: 24, y: 12 };                 // tile center (confetti origin)
const FEST_STAGE = { x: 24, y: 11 };                 // stage center
const FEST_BUNTING = [                               // garlands between the lamp posts
  { x1: 16, x2: 21, y: 11 }, { x1: 21, x2: 24, y: 11 },
  { x1: 24, x2: 27, y: 11 }, { x1: 32, x2: 29, y: 11 },
];
const FEST_STALLS = [{ x: 20, y: 14 }, { x: 28, y: 14 }];
const FEST_GUESTS = [                                // festival crowd (one sprite per guest)
  { tex: 'nova', x: 22, y: 13 }, { tex: 'luna', x: 24, y: 13 },
  { tex: 'vega', x: 26, y: 13 }, { tex: 'astra', x: 23, y: 14 },
  { tex: 'comet', x: 25, y: 14 }, { tex: 'rhea', x: 22, y: 15 },
  { tex: 'cora', x: 27, y: 15 },
];
const EARTH_PALETTE = [0x2e7d4f, 0xf5f0e6, 0xc0392b]; // green / white / red

const CROPS = {
  'space-wheat': { label: 'Space Wheat', growDays: 2, sellPrice: 20 },
  'star-berry': { label: 'Star Berry', growDays: 3, sellPrice: 35 },
  'moon-melon': { label: 'Moon Melon', growDays: 4, sellPrice: 50 },
  'plasma-tomato': { label: 'Plasma Tomato', growDays: 3, sellPrice: 40 },
  // ── new frontier crops (deep-space bioluminescent) ──
  'nebula-pepper': { label: 'Nebula Pepper', growDays: 4, sellPrice: 75 },
  'glow-kelp':     { label: 'Glow Kelp',    growDays: 3, sellPrice: 45 },
};

const NPCS = Object.values(NPC_DATA).map(n => ({
  id: n.id, name: n.name, emoji: n.emoji, x: NPC_POS[n.id].x, y: NPC_POS[n.id].y,
  color: n.color, role: n.role, data: n,
}));

const GROUND_TEX = {
  grass_a: 'tile.grass_a', grass_b: 'tile.grass_b', grass_c: 'tile.grass_c',
  grass_d: 'tile.grass_d', grass_e: 'tile.grass_e', grass_f: 'tile.grass_f',
  path: 'tile.path', water: 'tile.water', soil: 'tile.soil', soil_b: 'tile.soil_b',
};
// farm state → tile key (overrides ground once farmed)
const TILE_FOR_STATE = {
  empty: 'tile.soil', tilled: 'tile.tilled', seeded: 'tile.seeded',
  growing: 'tile.growing', mature: 'tile.mature',
};

class PlanetScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PlanetScene' });
  }

  preload() {
    AudioSystem.preload(this);
  }

  init(data) {
    this.credits = data.credits || 100;
    this.energy = 100;
    this.staminaMax = 100;   // stamina ceiling — grows as you condition yourself
    this.tool = 'base';
    this.dayCount = 0;
    this.isNight = false;
    this.inventory = { seeds: 5 };
    this.friendships = {};
    this.heartEvents = {};
    this.marriedTo = '';
    this.selectedNPC = null;
    this.inDialogue = false;
    this.inAlienContact = false;
    this.contactPhase = '';
    this.contactQueue = null;
    this.contactIdx = 0;
    this.selectedAlien = null;
    try { this.contactChoices = JSON.parse(localStorage.getItem('spacefarmer.firstContact') || '{}'); } catch { this.contactChoices = {}; }
    this.showingGE = false;
    this.showingShop = false;
    this.showingRecipes = false;
    this._recipeSel = 0;
    this.showingQuests = false;
    this._prevQuestId = null;    // last-seen current quest → drives the "quest complete" banner
    this._arcDoneFired = false;  // ending banner fires once
    this.playerDir = 'front';
  }

  create() {
    const { width, height } = this.game.config;
    const worldX = (width - VW) / 2, worldY = (height - VH) / 2;

    // ══ BACKDROP (parallax) — single zoomed camera; backdrop repositioned
    // each frame to counter the zoom/scroll so it stays full-screen ══
    this.cam = this.cameras.main;
    this.cam.setZoom(ZOOM);
    this.bgW = width; this.bgH = height;
    this.nebulaBase = { x: width / 2, y: height / 2 };
    this.planetBase = { x: width - 150, y: 120 };
    this.planet2Base = { x: 110, y: height - 180 };
    this.nebula = this.add.tileSprite(this.nebulaBase.x, this.nebulaBase.y, width, height, 'fx.nebula').setDepth(-40);
    this.planetSpr = this.add.image(this.planetBase.x, this.planetBase.y, 'fx.planet').setDepth(-30);
    this.planetSpr2 = this.add.image(this.planet2Base.x, this.planet2Base.y, 'fx.planet').setDepth(-30).setScale(0.6).setAlpha(0.7).setFlipX(true);
    this.stars = [];
    for (let i = 0; i < 40; i++) {
      const s = this.add.rectangle(
        Math.random() * width, Math.random() * height,
        Math.random() < 0.2 ? 4 : 2, Math.random() < 0.2 ? 4 : 2,
        0xffffff, Math.random() * 0.5 + 0.25
      ).setDepth(-20);
      this.stars.push({ obj: s, bx: s.x, by: s.y, sp: 0.5 + Math.random() * 0.5 });
    }

    // living sky: sun + moon arc across the heavens, clouds drift (parallax)
    this.sun = this.add.image(this.planetBase.x, this.planetBase.y, 'fx.sun').setDepth(-25);
    this.moon = this.add.image(this.planetBase.x, this.planetBase.y, 'fx.moon').setDepth(-25);
    this.clouds = [];
    for (let i = 0; i < 4; i++) {
      const c = this.add.image(0, 0, 'fx.cloud').setDepth(-22).setAlpha(0.42 - i * 0.05);
      this.clouds.push({ obj: c, sc: 0.6 + Math.random() * 0.5 });
    }

    // ══ WORLD (camera-followed container) ══
    this.worldX = worldX; this.worldY = worldY;
    this.world = this.add.container(worldX, worldY);
    // camera target follows the player (scene coords), zoomed in 2×
    this.camTarget = this.add.image(PLAYER_START.x + worldX, PLAYER_START.y + worldY, 'player.front').setVisible(false);
    this.cam.startFollow(this.camTarget, false, 0.15, 0.15);
    // clamp camera to map bounds (scene coords)
    this.cam.setBounds(worldX - 40, worldY - 40, VW + 80, VH + 80);

    // ── ground tiles ──
    this.tiles = [];
    this.farmTiles = [];
    this.waterTiles = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const g = ground[y][x];
        const gKey = GROUND_TEX[g] || GROUND_TEX.grass_a;
        const img = this.add.image(x * T + T / 2, y * T + T / 2, gKey);
        if (g === 'soil' || g === 'soil_b') {
          this.farmTiles.push({
            img, x, y, baseKey: gKey,
            state: { x, y, type: 'empty', crop: '', growth: 0, watered: false },
          });
        } else if (g === 'water') {
          this.waterTiles.push(img);
          this.tiles.push(img);
        } else {
          this.tiles.push(img);
        }
        this.world.add(img);
      }
    }

    // Raised agri-decks unify the farm tiles into two intentional fields.
    // This is presentation-only: the simulation and its 8x8 RL farm state
    // keep exactly the same coordinates and semantics.
    this.fieldDeck = this.add.graphics().setDepth(0.12);
    this.fieldDeck.lineStyle(3, 0x263d35, 0.82);
    this.fieldDeck.strokeRoundedRect(7 * T + 3, 16 * T + 3, 11 * T - 6, 13 * T - 6, 9);
    this.fieldDeck.strokeRoundedRect(19 * T + 3, 16 * T + 3, 13 * T - 6, 13 * T - 6, 9);
    this.fieldDeck.lineStyle(1, 0xd6b477, 0.18);
    for (let fy = 16; fy <= 28; fy++) {
      this.fieldDeck.lineBetween(7 * T + 8, fy * T + T / 2, 18 * T - 8, fy * T + T / 2);
      this.fieldDeck.lineBetween(19 * T + 8, fy * T + T / 2, 32 * T - 8, fy * T + T / 2);
    }
    this.world.add(this.fieldDeck);
    const deckLabelStyle = {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '8px', fontStyle: 'bold',
      color: '#f1d69b', stroke: '#17231f', strokeThickness: 3,
    };
    this.fieldDeckLabels = [
      this.add.text(7 * T + 10, 16 * T + 8, 'AGRI-DECK 01', deckLabelStyle).setDepth(0.2),
      this.add.text(19 * T + 10, 16 * T + 8, 'AGRI-DECK 02', deckLabelStyle).setDepth(0.2),
    ];
    this.world.add(this.fieldDeckLabels);
    // ── fence line ──
    this.fenceBeams = [];
    const spans = fenceSpans();
    for (const sp of spans) {
      const wpx = (sp.x1 - sp.x0 + 1) * T;
      const beam = this.add.image(
        (sp.x0 + (sp.x1 - sp.x0) / 2) * T + T / 2,
        sp.y * T + 2, 'decor.fence_beam_a'
      ).setDisplaySize(wpx, 4);
      this.world.add(beam);
      this.fenceBeams.push(beam);
      const p1 = this.add.image(sp.x0 * T + T / 2, sp.y * T + T / 2, 'decor.fence_post');
      const p2 = this.add.image(sp.x1 * T + T / 2, sp.y * T + T / 2, 'decor.fence_post');
      this.world.add(p1); this.world.add(p2);
    }

    // ── decor (y-sorted) + lamp glow sprites (in world, depth 1000) ──
    this.decorSprites = [];
    this.lampGlows = [];
    this.lightPools = [];   // Task 4: ground light pools (lamps, doors)
    for (const d of DECOR) {
      const img = this.add.image(d.x * T + T / 2, d.y * T + T / 2, d.tex);
      img.setDepth(d.y);
      this.world.add(img);
      this.decorSprites.push({ img, d });
      // soft cast shadow under natural decor (trees, flora) — grounds the scene
      if (d.tex !== 'decor.lamp' && d.tex !== 'decor.pond') {
        const sh = this.add.image(d.x * T + T / 2 + 3, d.y * T + 4, 'fx.bld_shadow')
          .setScale(0.42, 0.5).setDepth(d.y - 0.05).setAlpha(0.5);
        this.world.add(sh);
      }
      if (d.tex === 'decor.lamp') {
        const glow = this.add.image(d.x * T + T / 2, d.y * T - 2, 'fx.lamp_glow')
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(1000).setVisible(false);
        this.world.add(glow);
        this.lampGlows.push(glow);
        // Task 4: warm pool of light cast on the ground beneath the lamp
        const pool = this.add.image(d.x * T + T / 2, d.y * T + 12, 'fx.pool_warm')
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(902).setVisible(false).setAlpha(0);
        this.world.add(pool);
        this.lightPools.push({ img: pool, base: 0.55, phase: Math.random() * 6.283, speed: 0.0011 + Math.random() * 0.0006 });
      }
    }

    // ── buildings (y-sorted) + night glows (in world, depth 1000) ──
    this.buildingSprites = [];
    this.glowRegistry = [];
    this.buildingGlows = [];
    for (const b of [...BUILDINGS].sort((a, c) => (a.y + a.h) - (c.y + c.h))) {
      const img = this.add.image(
        b.x * T, b.y * T,
        b.key === 'tavern' ? 'bld.tavern_a' : b.key === 'exchange' ? 'bld.exchange_a' : b.tex
      );
      img.setDepth(b.y + b.h);
      this.world.add(img);
      // long soft cast shadow under the structure (light from upper-left)
      const bs = this.add.image(b.x * T + 6, (b.y + b.h) * T + 2, 'fx.bld_shadow')
        .setScale(Math.max(0.6, (b.w || 3) * 0.5), 0.55)
        .setDepth(b.y - 0.05).setAlpha(0.55);
      this.world.add(bs);
      this.buildingSprites.push({ b, img });
      if (b.glow) {
        const glow = this.add.image(b.x * T, b.y * T, b.glow)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(1001).setVisible(false);
        this.world.add(glow);
        glow.phase = Math.random() * Math.PI * 2;   // each landmark breathes on its own beat
        this.glowRegistry.push(glow);
        this.buildingGlows.push(glow);
        if (b.key === 'house') this.houseGlow = glow;
      }
      // Task 4: each doorway spills light onto the ground at night —
      // warm for home/tavern (hearth), cool for tech shops (screen-light).
      if (b.door) {
        const warm = (b.key === 'house' || b.key === 'tavern');
        const doorPool = this.add.image(b.door.x * T + T / 2, b.door.y * T + T + 4,
          warm ? 'fx.pool_warm' : 'fx.pool_cool')
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(0.35).setVisible(false).setAlpha(0).setScale(0.9);
        this.world.add(doorPool);
        this.lightPools.push({ img: doorPool, base: warm ? 0.6 : 0.45, phase: Math.random() * 6.283, speed: warm ? 0.0009 : 0.0004 });
      }
    }

    // ── NPCs (with errand AI brains) ──
    this.npcSprites = [];
    this.npcBrains = {};
    for (const npc of NPCS) {
      const tx = npc.x * T + T / 2, ty = npc.y * T + T / 2;
      const shadow = this.add.image(tx, ty + 34, 'fx.shadow').setScale(1.4).setDepth(npc.y + 0.4).setAlpha(0.85);
      this.world.add(shadow);
      const spr = this.add.image(tx, ty, `npc.${npc.id}`).setScale(0.68);
      spr.setDepth(npc.y + 0.5);
      spr.npcId = npc.id;
      this.world.add(spr);
      const label = this.add.text(tx, ty - 40, npc.name, {
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '7px', color: '#cfd6ff',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(npc.y + 0.6).setAlpha(0.9);
      this.world.add(label);
      spr._label = label;
      spr._shadow = shadow;
      this.npcSprites.push(spr);
      const rim = this.add.image(tx, ty + 12, 'fx.lamp_glow')
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(npc.y + 0.4).setScale(0.85).setAlpha(0.14).setVisible(false);
      this.world.add(rim);
      this.glowRegistry.push(rim);
      this.npcBrains[npc.id] = {
        id: npc.id,
        home: NPC_POS[npc.id],
        x: tx, y: ty,                 // current pixel center
        dir: 'front',
        path: [],                      // upcoming tile centers (pixels)
        state: 'idle',                 // 'idle' | 'walk' | 'work'
        working: false,
        walkT: 0,                      // ms spent on current walk (stuck guard)
        timer: 800 + Math.random() * 3000,
      };
    }
    // ── Alien envoys: stationary first-contact story encounters ──
    this.alienSprites = [];
    for (const alien of ALIEN_DATA) {
      const ax = alien.x * T + T / 2, ay = alien.y * T + T / 2;
      const aura = this.add.image(ax, ay + 20, "fx.lamp_glow").setScale(1.3).setAlpha(0.3).setDepth(alien.y + 0.2);
      const spr = this.add.image(ax, ay, `alien.${alien.id}`).setScale(0.9).setDepth(alien.y + 0.6);
      const label = this.add.text(ax, ay - 44, alien.name, { fontFamily: "system-ui, sans-serif", fontSize: "7px", color: "#dffcff", stroke: "#000", strokeThickness: 2 }).setOrigin(0.5).setDepth(alien.y + 0.8);
      const marker = this.add.text(ax, ay + 38, "FIRST CONTACT", { fontFamily: "system-ui, sans-serif", fontSize: "6px", color: "#f3d99b", stroke: "#000", strokeThickness: 2 }).setOrigin(0.5).setDepth(alien.y + 0.8);
      this.world.add([aura, spr, label, marker]);
      spr.alienId = alien.id; spr._aura = aura; spr._marker = marker; spr._label = label;
      this.alienSprites.push(spr);
      this._applyContactAftermath(alien, false);
    }

    this._lastT = 0;
    this.greenhouseActive = true;
    this.lKey = this.input.keyboard ? this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L) : null; // Stardust greenhouse — crops mature a day sooner

    // ── M3 — Earth Day plaza transform + festival crowd (hidden until a festival) ──
    this._buildFestivalPlaza();

    // ── player ──
    this.playerShadow = this.add.image(
      PLAYER_START.x * T + T / 2, PLAYER_START.y * T + T / 2 + 34, 'fx.shadow'
    ).setScale(1.4).setDepth(PLAYER_START.y + 0.4).setAlpha(0.9);
    this.world.add(this.playerShadow);
    this.playerSpr = this.add.image(
      PLAYER_START.x * T + T / 2, PLAYER_START.y * T + T / 2, 'player.front'
    ).setScale(0.68).setDepth(PLAYER_START.y + 1);
    this.playerSpeed = 4.4;
    this.world.add(this.playerSpr);
    // cool rim-light under the player so night keeps their silhouette readable
    // warm pool at the player's feet so night keeps their silhouette readable
    this.playerRim = this.add.image(this.playerSpr.x, this.playerSpr.y + 12, 'fx.pool_player')
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(903).setAlpha(0).setVisible(false);
    this.world.add(this.playerRim);
    this.glowRegistry.push(this.playerRim);

    // ══ NIGHT OVERLAY (world-space rect, each frame positioned over camera view) ══
    this.nightOverlay = this.add.rectangle(0, 0, width, height, 0x142048, 0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(900);
    this.world.add(this.nightOverlay);

    // ══ SEASON AMBIENT: tint ramp + particle weather emitters ══
    this.seasonOverlay = this.add.rectangle(0, 0, width, height, 0xffffff, 0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(898);
    this.world.add(this.seasonOverlay);

    // cinematic vignette — soft dark corners, screen-fixed through zoom
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.vignette')
      .setDepth(960).setScrollFactor(0).setAlpha(0.85);
    // golden-hour wash — warm key light over the whole colony during the day
    this.dayWarm = this.add.rectangle(0, 0, width, height, 0xffe8b8, 0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setScrollFactor(0).setDepth(959).setVisible(false);
    // faint cool lift at night so the ground/paths stay readable (accessibility)
    this.nightAmbient = this.add.rectangle(0, 0, width, height, 0x0a2038, 0)
      .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0).setDepth(958).setVisible(false);

    // soft filmic grade — warm SOFT_LIGHT wash lifts shadows, warms mids and
    // tames the neon palette (modern-cozy film look instead of 80s CRT contrast)
    this.filmGrade = this.add.rectangle(0, 0, width, height, 0x2a4a52, 0)
      .setBlendMode(Phaser.BlendModes.SOFT_LIGHT).setScrollFactor(0).setDepth(965).setAlpha(0.22);
    this.filmSheen = this.add.rectangle(0, 0, width, height, 0x9fe8ea, 0)
      .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0).setDepth(964).setAlpha(0.05);

    // painterly dusk sky (deep indigo heavens -> warm golden horizon) + drifting haze
    this.skyTile = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.sky_dusk')
      .setDepth(-60).setScrollFactor(0);
    // (fog removed — its tiled haze read as CRT scanlines)
    // deep-space meteors — bright bioluminescent streaks arcing across the sky
    this.meteors = [];
    this._meteorCool = 0;

    // particle weather: snow (winter) + leaves (fall)
    this.snow = this.add.particles(16, -20, 'fx.shadow', {
      x: { min: 0, max: width }, y: { min: -40, max: -10 },
      lifespan: { min: 2400, max: 3200 }, speedY: { min: 20, max: 38 },
      speedX: { min: -14, max: 14 }, scale: { start: 0.5, end: 0.12 },
      alpha: { start: 0.85, end: 0.25 }, emitting: false,
      blendMode: Phaser.BlendModes.ADD, frequency: 70,
    }).setDepth(895).setScrollFactor(0);
    this.world.add(this.snow);
    this.leaves = this.add.particles(16, -20, 'fx.shadow', {
      x: { min: 0, max: width }, y: { min: -40, max: -10 },
      lifespan: { min: 3000, max: 4200 }, speedY: { min: 14, max: 26 },
      speedX: { min: -30, max: 8 }, scale: { start: 0.6, end: 0.18 },
      alpha: { start: 0.8, end: 0.2 }, emitting: false, frequency: 110,
    }).setDepth(895).setScrollFactor(0);
    this.world.add(this.leaves);

    // ══ UI (screen-space) ══
    this.buildHUD(width, height);
    this.buildDialogue(width, height);
    this.buildContactUI(width, height);
    this.buildPanels(width, height);
    this._bindSavedBlip();
    this._bindReflection();

    // ── House interior (hidden until you walk in) ──
    this.buildInterior(width, height);
    this.inInterior = false;

    // ── input ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard.addKey('W'), A: this.input.keyboard.addKey('A'),
      S: this.input.keyboard.addKey('S'), D: this.input.keyboard.addKey('D'),
    };
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.SPACE);
    this.eKey = this.input.keyboard.addKey('E');
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.ESC);
    this.tabKey = this.input.keyboard.addKey('TAB');
    this.iKey = this.input.keyboard.addKey('I');
    this.gKey = this.input.keyboard.addKey('G');
    this.pKey = this.input.keyboard.addKey('P');
    this.hKey = this.input.keyboard.addKey('H');
    this.oneKey = this.input.keyboard.addKey('ONE');
    this.twoKey = this.input.keyboard.addKey('TWO');
    this.threeKey = this.input.keyboard.addKey('THREE');
    this.fourKey = this.input.keyboard.addKey('FOUR');
    this.fiveKey = this.input.keyboard.addKey('FIVE');
    this.fKey = this.input.keyboard.addKey('F');
    this.fishKey = this.input.keyboard.addKey('J');
    // ── ranch pasture — helmet animals render in a pen near the farm, and
    //    _refreshRanch() re-populates it live as you buy/sell ──
    this.ranchStage = this.add.container(38 * T, 27 * T).setDepth(92);
    this.ranchSign = this.add.text(0, -40, 'SPACE RANCH', { fontFamily: "system-ui,'Segoe UI'", fontSize: '11px', color: '#9ddd72', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    this.ranchStage.add(this.ranchSign);
    this.ranchStage.add(this.add.rectangle(0, 24, 130, 58, 0x141a26, 0.5).setStrokeStyle(1, 0x39c5bb));
    this.ranchStage.add(this.add.text(0, 56, '[1][2][3] buy · feed daily', { fontFamily: "system-ui,'Segoe UI'", fontSize: '9px', color: '#a8d8d8' }).setOrigin(0.5));
    this._animalsSig = '';
    this.ranchStage.setVisible(false);
    // ── asteroid mining spot — a cracked rock you mine for space ore.
    //    Tile (36,16): the farm's eastern edge, just south of the fence line —
    //    reachable on the 40×32 map (the old x=52 sat past the right edge).
    this.mineX = MINE_SPOT.x, this.mineY = MINE_SPOT.y;
    this.mineRock = this.add.graphics().setDepth(94);
    this._drawMineRock(this.mineRock, this.mineX * T, this.mineY * T);
    this.mineKey = this.input.keyboard.addKey('K');
    this.casting2 = false;
    this.mineHint = this.add.container(0, 0).setDepth(988);
    this.mineHint.add(this.add.rectangle(0, 10, 190, 24, 0x101a26, 0.88).setStrokeStyle(1, 0xd8a05a));
    this.mineHint.add(this.add.text(0, 10, '[K] MINE · -5 EP / swing', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#ffe9a0' }).setOrigin(0.5));
    this.mineHint.setVisible(false);

    this.casting = false;
    // accessible fishing hint — floats above the player when near the pond
    this.fishHint = this.add.container(0, 0).setDepth(988);
    const hintBg = this.add.rectangle(0, 10, 190, 24, 0x101a26, 0.88).setStrokeStyle(1, 0x39c5bb);
    const hintTxt = this.add.text(0, 10, '[J] CAST · pick a spot', { fontFamily: "system-ui,'Segoe UI'", fontSize: '11px', color: '#a8eeff' }).setOrigin(0.5);
    this._fishHintTxt = hintTxt;
    this.fishHint.add([hintBg, hintTxt]);
    // widen the hint pill so the longer labels fit
    hintBg.width = 250;
    this.fishHint.setVisible(false);
    // the deep drop — a second fishing spot (rare/night fish) at the pond's far shore
    this.deepDrop = this.add.graphics().setDepth(94);
    const ddx = DEEP_DROP_SPOT.x * T, ddy = DEEP_DROP_SPOT.y * T;
    this.deepDrop.fillStyle(0x12686e, 0.9).fillCircle(ddx, ddy, 9);
    this.deepDrop.fillStyle(0x39c5bb, 0.8).fillCircle(ddx, ddy, 5);
    this.deepDrop.lineStyle(1.5, 0x9ddd72, 0.7).strokeCircle(ddx, ddy, 9);
    this.deepDropLabel = this.add.text(ddx, ddy + 16, 'DEEP DROP', { fontFamily: "system-ui,'Segoe UI'", fontSize: '10px', color: '#a8eeff', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(95);
    this.uKey = this.input.keyboard.addKey('U');
    this.vKey = this.input.keyboard.addKey('V');
    this.qKey = this.input.keyboard.addKey('Q'); // The Stardust Story — quest log
    this.cKey = this.input.keyboard.addKey('C'); // Kitchen — recipe book

    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // ── audio (2000s JRPG) ──
    this.audio = new AudioSystem(this);
    this._bootAudio = () => this.audio.boot();   // TouchControls reuses this for DOM-button gestures
    this.input.once('pointerdown', () => this.audio.boot());
    this.input.keyboard.once('keydown', () => this.audio.boot());

    this.updateNightVisuals();
  }

  // ── UI builders ──
  buildHUD(width, height) {
    const f = { fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', fontStyle: 'bold' };
    const y = height - 48;
    // Floating glass telemetry keeps status scannable without hiding the world.
    this.hudBar = this.add.rectangle(width / 2, y, width - 24, 44, 0x081a20, 0.88)
      .setStrokeStyle(1, 0x6be7d0, 0.7).setDepth(997);
    this.hudAccent = this.add.rectangle(24, y, 4, 28, 0xf3bd67, 1).setDepth(998);
    this.hudText = this.add.text(38, y - 7, '', {
      ...f, color: '#effff9', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(1000);
    this.energyTrack = this.add.rectangle(38, y + 11, 170, 5, 0x16363a, 1).setOrigin(0, 0.5).setDepth(999);
    this.energyFill = this.add.rectangle(38, y + 11, 170, 5, 0x6be7d0, 1).setOrigin(0, 0.5).setDepth(1000);
    this.hudDay = this.add.text(width - 34, y, '', {
      ...f, fontSize: '11px', color: '#f8d797', align: 'right', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(1, 0.5).setDepth(1000);
    this.colonyMark = this.add.text(width - 34, 12, 'B-612  /  FRONTIER AGRICULTURE', {
      ...f, fontSize: '9px', color: '#8dc9c0',
      stroke: '#061015', strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(1000);
    this.questPlate = this.add.rectangle(12, 8, Math.min(430, width * 0.54), 38, 0x081a20, 0.78)
      .setOrigin(0, 0).setStrokeStyle(1, 0x6be7d0, 0.45).setDepth(997);
    this.questChip = this.add.text(24, 18, '', {
      ...f, fontSize: '10px', color: '#d5f4e8', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(0, 0).setDepth(1000);
  }
  buildDialogue(width, height) {
    const bw = width - 96, bh = 158, cx = width / 2, cy = height - 92;
    const boxL = cx - bw / 2, boxT = cy - bh / 2;
    this._diaBox = { cx, boxL, boxR: cx + bw / 2, boxT, boxB: cy + bh / 2, bw, bh };
    // One shared dialogue component (clip + scroll + collapse) used by every scene.
    this.dialog = new DialoguePanel(this, {
      x: cx, y: cy, width: bw, height: bh,
      portrait: { texture: 'port.nova_0' },
      tail: {},
      textX: boxL + 58, textTopY: boxT + 46,
      wrapWidth: bw - 82,
      fontSize: '10px',
      clipTop: boxT + 38, clipHeight: bh - 56,
    });
    // Alias the old field names so the rest of the scene (input, update,
    // HUD, panels) keeps reading/writing the same refs — now backed by the
    // shared panel's internals.
    this.dialogueBox    = this.dialog.box;
    this.dialogueText   = this.dialog.text;
    this.dialogueTitle  = this.dialog.title;
    this.dialoguePortrait = this.dialog.portrait;
    this.dialogueHint   = this.dialog.hint;
    this.portraitPlate  = this.dialog.portraitPlate;
    this.dialogueTail   = this.dialog.tail;
    this.diaScrollUp    = this.dialog.scrollUp;
    this.diaScrollDown  = this.dialog.scrollDown;
    this.diaCollapseBtn = this.dialog.collapseBtn;
    this._portraitBaseY = this.dialog.portraitBaseY || (boxT + 58);
    // dialogue state kept here — update()/input read these
    this._diaNPC = null; this._diaFooter = ''; this._diaDone = true;
    this._diaFull = ''; this._diaShown = 0;
  }

  // EarthBound-style speech: typewriter reveal + portrait mouth-blab while typing.
  // The shared panel owns the text/scroll/collapse; this scene adds the portrait
  // and the [SPACE to continue] choreography.
  _speak(full, npcId, opts = {}) {
    this._diaDone = false;
    this._diaFull = full;
    this._diaShown = 0;
    this._diaNPC = npcId || (this.selectedNPC && this.selectedNPC.id) || 'nova';
    this._diaFooter = opts.footer || '';
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_0`);
    this.dialog.setText(full, {
      title: opts.title,
      footer: opts.footer,
      typewriter: true,
      onDone: () => { this._diaDone = true; this._diaTypesFinished(); },
    });
  }

  // Called when the shared panel finishes typing — settle the portrait and hint.
  _diaTypesFinished() {
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_0`);
    this.dialogueHint.setText(this._diaFooter || '[SPACE to continue]');
    this.dialogueHint.setVisible(true);
  }

  _finishTyping() {
    if (this._diaDone) return;
    this.dialog.finishTyping();
    this._diaDone = true;
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_0`);
    this.dialogueHint.setText(this._diaFooter || '[SPACE to continue]');
    this.dialogueHint.setVisible(true);
  }

  buildContactUI(width, height) {
    this.contactPanel = this.add.container(width / 2, height / 2).setDepth(1200).setVisible(false);
    const panelWidth = Math.min(720, width - 40);
    const bg = this.add.rectangle(0, 0, panelWidth, 500, 0x07121c, 0.98).setStrokeStyle(2, 0x7adfd5);
    this.contactTitle = this.add.text(0, -220, "FIRST CONTACT COUNCIL", { fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#f2d99a", fontStyle: "bold" }).setOrigin(0.5);
    this.contactPremise = this.add.text(0, -182, "", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#e9f3f4", align: "center", wordWrap: { width: panelWidth - 70 }, lineSpacing: 4 }).setOrigin(0.5, 0);
    this.contactPanel.add([bg, this.contactTitle, this.contactPremise]);
    this.contactRows = CONTACT_DOCTRINES.map((doctrine, index) => {
      const y = -55 + index * 62;
      const row = this.add.rectangle(0, y, panelWidth - 70, 52, 0x132432, 0.96).setStrokeStyle(1, doctrine.color).setInteractive({ useHandCursor: true });
      const copy = this.add.text(-panelWidth / 2 + 52, y, "[" + (index + 1) + "] " + doctrine.label + " — " + doctrine.description, { fontFamily: "system-ui, sans-serif", fontSize: "10px", color: "#e9f3f4", wordWrap: { width: panelWidth - 110 } }).setOrigin(0, 0.5);
      row.on("pointerdown", () => this.chooseContactDoctrine(doctrine.id));
      row.on("pointerover", () => row.setFillStyle(0x244154, 1));
      row.on("pointerout", () => row.setFillStyle(0x132432, 0.96));
      this.contactPanel.add([row, copy]);
      return { row, copy, doctrine };
    });
    this.contactNote = this.add.text(0, 220, "No reward · no correct answer · choice becomes colony history", { fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#93aeb7" }).setOrigin(0.5);
    this.contactPanel.add(this.contactNote);
    this.cinemaTop = this.add.rectangle(width / 2, 34, width, 68, 0x000000, 0.92).setDepth(1190).setVisible(false);
    this.cinemaBottom = this.add.rectangle(width / 2, height - 34, width, 68, 0x000000, 0.92).setDepth(1190).setVisible(false);
  }

  buildPanels(width, height) {
    this.gePanel = this.add.container(width / 2, height / 2).setDepth(1002).setVisible(false);
    const geBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0x39c5bb);
    const geTitle = this.add.text(0, -134, 'GRAND EXCHANGE', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#7ef0ff',
    }).setOrigin(0.5);
    const geContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '10px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const geClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5);
    this.gePanel.add([geBg, geTitle, geContent, geClose]);
    this.geTitle = geTitle; this.geContent = geContent; this.geClose = geClose;

    this.shopPanel = this.add.container(width / 2, height / 2).setDepth(1002).setVisible(false);
    const shopBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0x9ddd72);
    const shopTitle = this.add.text(0, -134, "SUPPLY DEPOT", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#9ddd72',
    }).setOrigin(0.5);
    const shopContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '10px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const shopClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5);
    this.shopPanel.add([shopBg, shopTitle, shopContent, shopClose]);
    this.shopTitle = shopTitle; this.shopContent = shopContent; this.shopClose = shopClose;

    this.ranchPanel = this.add.container(width / 2, height / 2).setDepth(1002).setVisible(false);
    const ranchBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0xd8a05a);
    const ranchTitle = this.add.text(0, -134, "RANCH - STARDUST LIVESTOCK", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const ranchContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '10px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const ranchClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5);
    this.ranchPanel.add([ranchBg, ranchTitle, ranchContent, ranchClose]);
    this.ranchTitle = ranchTitle; this.ranchContent = ranchContent; this.ranchClose = ranchClose;

    // storage chest panel (interior)
    this.chestPanel = this.add.container(width / 2, height / 2).setDepth(1003).setVisible(false);
    const chestBg = this.add.rectangle(0, 0, 360, 300, 0x070714, 0.95).setStrokeStyle(3, 0xd8a05a);
    const chestTitle = this.add.text(0, -120, "HOME STORAGE", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const chestContent = this.add.text(0, -20, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '8px', color: '#e8ecff',
      align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);
    this.chestPanel.add([chestBg, chestTitle, chestContent]);
    this.chestContent = chestContent;

    // ── Recipe book (M4 kitchen) — [C] at the stove ──
    this.recipePanel = this.add.container(width / 2, height / 2).setDepth(1003).setVisible(false);
    const recipeBg = this.add.rectangle(0, 0, 440, 360, 0x070714, 0.96).setStrokeStyle(3, 0xd8a05a);
    const recipeTitle = this.add.text(0, -146, 'KITCHEN — RECIPE BOOK', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const recipeContent = this.add.text(0, -118, '', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '8px', color: '#e8ecff',
      lineSpacing: 5,
    }).setOrigin(0.5, 0);
    this.recipePanel.add([recipeBg, recipeTitle, recipeContent]);
    this.recipeContent = recipeContent;

    // ── 'The Stardust Story' quest log (Q key) — the arc's readable spine ──
    this.questPanel = this.add.container(width / 2, height / 2).setDepth(1004).setVisible(false);
    const qBg = this.add.rectangle(0, 0, 520, 380, 0x070714, 0.96).setStrokeStyle(3, 0x7ef0ff);
    const qTitle = this.add.text(0, -158, 'THE STARDUST STORY', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '15px', color: '#7ef0ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const qContent = this.add.text(0, -10, '', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', color: '#e8ecff', lineSpacing: 8,
    }).setOrigin(0.5, 0);
    const qClose = this.add.text(0, 168, '[Q] CLOSE', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5);
    this.questPanel.add([qBg, qTitle, qContent, qClose]);
    this.questContent = qContent;
  }

  // ── Persistence blip — the server pings 'saved' after flushing a save ──
  _bindSavedBlip() {
    this._savedBlipShown = 0;
    window.SpaceFarmer.onSaved = () => {
      // throttle: at most one blip per 20s (autosaves are frequent)
      const now = this.time ? this.time.now : 0;
      if (now - this._savedBlipShown < 20000) return;
      this._savedBlipShown = now;
      const { width } = this.game.config;
      const t = this.add.text(width - 14, 26, '💾 SAVED', {
        fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '9px', color: '#8a90b0',
        stroke: '#0a1020', strokeThickness: 3,
      }).setOrigin(1, 0.5).setDepth(1000).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 0.9, duration: 400 });
      this.tweens.add({ targets: t, alpha: 0, duration: 800, delay: 1600, onComplete: () => t.destroy() });
    };
  }

  // ── M3 — Earth Day spectacle ─────────────────────────────────────────────
  // Plaza transform (bunting, string lights, stage, food stalls), a visiting
  // crowd that only exists on festival days, festival music mood, a confetti
  // burst when the Earth Feast is served, and the afterglow line.
  _buildFestivalPlaza() {
    const px = (tx) => tx * T + T / 2, py = (ty) => ty * T + T / 2;
    this.festivalDecor = [];
    const add = (o) => { o.setVisible(false); this.world.add(o); this.festivalDecor.push(o); return o; };

    // bunting garlands between the lamp posts — sagging rows of pennants
    for (const s of FEST_BUNTING) {
      const x1 = px(s.x1), x2 = px(s.x2), y = py(s.y) - 26;
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const bx = x1 + (x2 - x1) * (i / n);
        const sag = Math.sin((i / n) * Math.PI) * 7;          // catenary-ish dip
        const by = y + sag;
        const c = EARTH_PALETTE[i % 3];
        const flag = this.add.rectangle(bx, by, 4, 7, c, 0.95).setOrigin(0.5, 0);
        add(flag);
        if (i % 2 === 0) {                                    // string-light bulbs
          const bulb = this.add.circle(bx, by + 9, 2, 0xfff2c8, 0.95)
            .setBlendMode(Phaser.BlendModes.ADD);
          add(bulb);
        }
      }
      // the string itself (thin line the pennants hang from)
      const gx = this.add.graphics().setDepth(12.2);
      gx.lineStyle(1, 0x8a90b0, 0.5);
      gx.beginPath().moveTo(x1, y).lineTo(x2, y + 4); gx.strokePath();
      add(gx);
    }

    // the stage — a raised platform facing the crowd, with the day's sign
    const st = this.add.rectangle(px(FEST_STAGE.x), py(FEST_STAGE.y) + 8, 5.2 * T, 1.4 * T, 0x2a2f45, 0.92)
      .setStrokeStyle(2, 0xd8a05a);
    add(st);
    const stageGlow = this.add.rectangle(px(FEST_STAGE.x), py(FEST_STAGE.y) + 14, 5.6 * T, 0.8 * T, 0x2e7d4f, 0.18);
    add(stageGlow);
    const sign = this.add.text(px(FEST_STAGE.x), py(FEST_STAGE.y) - 4, '★ EARTH DAY ★', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', color: '#ffe9a0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12.4);
    add(sign);

    // two food stalls — striped awnings + a table of dishes
    for (const s of FEST_STALLS) {
      const tx = px(s.x), ty = py(s.y);
      const table = this.add.rectangle(tx, ty + 4, 1.4 * T, 0.7 * T, 0x6a4a2a, 0.95).setStrokeStyle(1, 0xd8a05a);
      add(table);
      const awning = this.add.rectangle(tx, ty - 10, 1.6 * T, 0.5 * T, 0xc0392b, 0.95);
      add(awning);
      for (let i = 0; i < 3; i++) {                          // dishes on the table
        const dish = this.add.circle(tx - 24 + i * 24, ty + 2, 5, EARTH_PALETTE[i % 3], 0.95);
        add(dish);
      }
    }

    // the visiting crowd — festival guests (reused villager art), hidden unless festival
    this.festivalGuests = FEST_GUESTS.map((g, i) => {
      const tx = px(g.x), ty = py(g.y);
      const shadow = this.add.image(tx, ty + 30, 'fx.shadow').setScale(1.3).setAlpha(0.8);
      const spr = this.add.image(tx, ty, `npc.${g.tex}`).setScale(0.68);
      const vis = [shadow, spr];
      vis.forEach(o => { o.setVisible(false); this.world.add(o); o.setDepth(g.y + 0.5); });
      this.festivalDecor.push(shadow, spr);
      return { spr, baseY: ty, phase: Math.random() * Math.PI * 2, singing: i === 0 };
    });
    this._festivalPhase = 'none';
    this._festSingerTween = null;

    // wire the server's festival messages
    window.SpaceFarmer.onFestivalPhase = (d) => this.setFestivalPhase(d && d.phase);
    window.SpaceFarmer.onFeastPeak = () => this._feastPeakBurst();
  }

  _festActive() { return this._festivalPhase && this._festivalPhase !== 'none'; }

  setFestivalPhase(phase) {
    if (!this.festivalDecor || phase === this._festivalPhase) return;
    this._festivalPhase = phase;
    const on = phase !== 'none';
    for (const o of this.festivalDecor) o.setVisible(on);
    // festival music mood (brighter, faster + melody layer)
    if (window.SpaceFarmer && window.SpaceFarmer.music) window.SpaceFarmer.music.setMood(on ? 'festival' : null);
    // the "singer" on stage bobs while the feast is on
    if (this._festSingerTween) { this._festSingerTween.stop(); this._festSingerTween = null; }
    if (on && this.festivalGuests) {
      const g = this.festivalGuests.find(x => x.singing);
      if (g) this._festSingerTween = this.tweens.add({
        targets: g.spr, y: g.baseY - 3, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
    if (phase === 'afterglow') {
      this.showToast?.('The heart hummed clean tonight. Nobody talked about it. That\u2019s the point.', { duration: 5200, y: 120 });
    }
  }

  // The climax beat: 3 Earth Feast Plates served → the plaza erupts.
  _feastPeakBurst() {
    const px = FEST_PLAZA.x * T + T / 2, py = FEST_PLAZA.y * T + T / 2;
    // chime + confetti (tweened colored bits — no particle texture needed)
    if (this.audio) this.audio.sfx('star');
    for (let i = 0; i < 90; i++) {
      const x = px + (Math.random() - 0.5) * 40;
      const y = py - 30 - Math.random() * 20;
      const c = EARTH_PALETTE[i % 3];
      const bit = this.add.rectangle(x, y, 3 + Math.random() * 3, 5 + Math.random() * 4, c, 0.95)
        .setDepth(600).setRotation(Math.random() * Math.PI);
      this.tweens.add({
        targets: bit,
        x: x + (Math.random() - 0.5) * 160,
        y: py + 90 + Math.random() * 40,
        rotation: Math.random() * Math.PI * 4,
        alpha: 0,
        duration: 1400 + Math.random() * 1200,
        ease: 'Cubic.easeIn',
        onComplete: () => bit.destroy(),
      });
    }
    this.showToast?.('Rhea: "THAT\u2019S the meal!"', { duration: 5000, y: 100 });
  }

  // ── 'The Stardust Story' quest log — Q key ─────────────────────────────────
  toggleQuestLog() {
    this.showingQuests = !this.showingQuests;
    if (this.showingQuests) this.refreshQuestPanel();
    this.questPanel.setVisible(this.showingQuests);
  }

  // Build the panel text from the live server player state.
  refreshQuestPanel() {
    const net = window.SpaceFarmer.net;
    const ps = net && net.getPlayerState ? net.getPlayerState() : null;
    const view = questView(ps ? ps.quests : null, ps);
    let lines;
    if (view.arcDone) {
      lines =
`THE STORY IS COMPLETE.

The stardust heart hums clean. B-612's light is
its own again — not old, not anyone's grief.
The colony keeps your farm, your people, your
rations, and your name on the manifest.

★ The soil is still hungry. The shore still
  bites back. New Game+ is always open.`;
    } else if (view.quest) {
      const q = view.quest;
      lines =
`── ${q.actName} ──\n` +
`  ${view.completed}/${view.total} chapters complete\n\n` +
`◆ ${q.title}\n` +
`  ${q.brief}\n\n` +
`  OBJECTIVES:\n` +
      q.objectives.map(o => `   ${o.met ? '[x]' : '[ ]'} ${o.label}  (${o.have}/${o.need})`).join('\n') +
`  \n  REWARD: ${q.reward || 'the story moves on'}\n` +
`  [Q] close`;
    } else {
      lines = 'The arc is quiet. Somewhere, a villager has work for you.';
    }
    this.questContent.setText(lines);
  }

  // Detect quest transitions from the server state diff; fire the banner.
  checkQuestTransitions() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) return;
    const ps = net.getPlayerState ? net.getPlayerState() : null;
    if (!ps || !ps.quests) return;
    const q = ps.quests;
    // Ending banner — fires exactly once when the arc closes.
    if (q.arcDone && !this._arcDoneFired) {
      this._arcDoneFired = true;
      const ngPlus = ps.ngPlus || 0;
      this._ngOffer = true;   // [N] now accepts New Game+
      this._questBanner('★ THE HEART OF STARDUST IS CLEAN ★',
        `+500cr · +1 stardust-core\nThe story is complete. Thank you for keeping B-612 alive.\n[N] New Game+ — keep your friends, restart your farm`);
      if (this.audio) this.audio.sfx('star');
      return;
    }
    // Quest completed → a new one picked up: banner the reward of the finished one.
    if (this._prevQuestId && q.current !== this._prevQuestId) {
      const done = QUESTS[this._prevQuestId];
      if (done) this._questBanner('QUEST COMPLETE — ' + done.title, done.reward ? 'Reward: ' + rewardLine(done.reward) : 'The story moves on.');
      if (this.audio) this.audio.sfx('confirm');
      this._prevQuestId = q.current;
      if (this.showingQuests) this.refreshQuestPanel();
      return;
    }
    this._prevQuestId = q.current;
    if (this.showingQuests) this.refreshQuestPanel();
  }

  // A two-line celebratory banner, bigger than a toast.
  _questBanner(title, sub) {
    const { width } = this.game.config;
    const b = this.add.text(width / 2, 110, title + '\n' + sub, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '13px', color: '#ffe9a0', align: 'center', lineSpacing: 6,
      backgroundColor: '#070714ee', padding: { x: 16, y: 10 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1101).setAlpha(0);
    this.tweens.add({ targets: b, alpha: 1, y: 96, duration: 350, ease: 'Back.easeOut' });
    this.tweens.add({ targets: b, alpha: 0, duration: 700, delay: 3400, onComplete: () => b.destroy() });
  }

  // ── P3: reflection & reward ─────────────────────────────────────────────
  // Milestone toasts (queued so a burst doesn't stack), the morning
  // day-summary card, and the New Game+ offer (arc-complete, first cycle).
  _bindReflection() {
    this._msQueue = [];
    this._msShowing = false;
    this._pendingSummary = null;
    window.SpaceFarmer.onMilestone = (d) => this._queueMilestone(d);
    window.SpaceFarmer.onDaySummary = (d) => { this._pendingSummary = d; };
    // [N] — accept New Game+ when the arc-complete offer is up
    this.input.keyboard.on('keydown-N', () => {
      if (this._ngOffer) this._confirmNewGamePlus();
    });
  }

  _queueMilestone(d) {
    if (!d || !d.label) return;
    this._msQueue.push(d);
    if (!this._msShowing) this._popMilestone();
  }

  _popMilestone() {
    const d = this._msQueue.shift();
    if (!d) { this._msShowing = false; return; }
    this._msShowing = true;
    const { width } = this.game.config;
    const t = this.add.text(width / 2, 140, '🏆 ' + d.label, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#ffd977',
      align: 'center', backgroundColor: '#101026ee', padding: { x: 14, y: 8 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1102).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 128, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: t, alpha: 0, y: 116, duration: 600, delay: 3000,
      onComplete: () => { t.destroy(); this.time.delayedCall(300, () => this._popMilestone()); },
    });
    if (this.audio) this.audio.sfx('star');
  }

  // The morning-after card: what today added up to. Rendered on wake, then
  // cleared. A perfectly idle day shows the quiet variant instead.
  _showDaySummary(d) {
    this._pendingSummary = null;
    if (!d || !d.ledger) return;
    const led = d.ledger;
    const bits = [];
    if (led.harvested) bits.push(`🌾 ${led.harvested} harvested`);
    if (led.sold) bits.push(`💰 ${led.sold} sold · +${led.earned} cr`);
    else if (led.earned) bits.push(`+${led.earned} cr`);
    if (led.spent) bits.push(`−${led.spent} cr`);
    if (led.fished) bits.push(`🎣 ${led.fished} caught`);
    if (led.mined) bits.push(`⛏ ${led.mined} mined`);
    if (led.gifts) bits.push(`🎁 ${led.gifts} gifts`);
    const fest = d.festival ? calendar.festivalForDay(d.day) : null;
    const head = `DAY ${d.day}${d.ngPlus ? ` · NG+${d.ngPlus}` : ''}${fest ? ` — ${fest.short}` : (d.festivalPhase === 'afterglow' ? ' — AFTERGLOW' : '')}`;
    const body = bits.length ? bits.join('   ') : 'A quiet day. The dome hums. Rest is also farming.';
    const { width } = this.game.config;
    const card = this.add.text(width / 2, 108, head + '\n' + body, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', color: '#cfe8ff',
      align: 'center', lineSpacing: 6, backgroundColor: '#0a0f1fee', padding: { x: 14, y: 8 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1100).setAlpha(0);
    this.tweens.add({ targets: card, alpha: 1, duration: 400 });
    this.tweens.add({ targets: card, alpha: 0, duration: 800, delay: 4200, onComplete: () => card.destroy() });
  }

  _confirmNewGamePlus() {
    if (this._ngBusy) return;
    this._ngBusy = true;
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — New Game+ needs the server.'); this._ngBusy = false; return; }
    net.request('newGamePlus', {}).then((r) => {
      this._ngBusy = false;
      if (r && r.ok) {
        this._ngOffer = false;
        this._arcDoneFired = false;   // the story restarts; the next cycle can close again
        this._questBanner(`NEW GAME+ ${r.ngPlus} — SAME ROCKS, DIFFERENT YOU`,
          'Friends, marriage, lifetime records — kept.\nFarm, story, credits — reborn.');
        if (this.audio) this.audio.sfx('star');
      } else {
        this.showToast('New Game+ is not available right now.');
      }
    });
  }

  // ── Ranch: buy & feed livestock (server-authoritative) ──
  openRanch() {
    this.showingRanch = true;
    this.ranchPanel.setVisible(true);
    const net = window.SpaceFarmer.net;
    const animals = this.animals || {};
    const inv = this.inventory || {};
    // swap species via [B]/[C]/[D], feed via [F], buy via [1..3]
    this.ranchContent.setText(
      `CHICKEN .... 100 CR  [1]  (eggs)\n` +
      `COW ........ 350 CR  [2]  (milk)\n` +
      `SHEEP ...... 300 CR  [3]  (wool)\n\n` +
      `Owned: 🐔${animals.chicken || 0} 🐮${animals.cow || 0} 🐑${animals.sheep || 0}\n` +
      `Products: egg×${inv.egg || 0} milk×${inv.milk || 0} wool×${inv.wool || 0}\n\n` +
      `[F] Feed all   [1-3] Buy   [S] Sell products\n\n` +
      `${this.credits} CR on hand`
    );
  }

  buyAnimal(species) {
    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      net.request('buyAnimal', { species, quantity: 1 }).then(r => {
        if (r && r.ok) this.showToast(`Bought a ${species}. ${r.credits} CR left.`);
        else if (r && r.reason === 'not-enough-credits') this.showToast(`Need ${r.need} CR for ${species}.`);
        else this.showToast('Could not buy that animal.');
        this.openRanch();
      });
    } else this.showToast('Offline — ranch unavailable.');
  }

  feedAnimals() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — ranch unavailable.'); return; }
    ['chicken', 'cow', 'sheep'].forEach(species => {
      net.request('feedAnimal', { species }).then(r => {
        if (r && r.ok) this.showToast(`Fed the ${species}. It will produce tomorrow.`);
        else if (r && r.reason === 'already-fed') this.showToast(`${species} already fed today.`);
      });
    });
    this.openRanch();
  }

  // ── Sell livestock products (egg/milk/wool) at market — the kiosk's [S].
  sellProducts() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — no market.'); return; }
    if (this._ranchSellBusy) return;
    this._ranchSellBusy = true;
    const item = ['egg', 'milk', 'wool'].find(i => (this.inventory[i] || 0) > 0);
    if (!item) { this._ranchSellBusy = false; this.showToast('No livestock products to sell yet.'); return; }
    net.request('sell', { item, quantity: 1 }).then(r => {
      this._ranchSellBusy = false;
      if (r && r.ok) {
        this.inventory[item] = (this.inventory[item] || 0) - (r.qty || 1);
        if (this.audio) this.audio.sfx('star');
        this.showToast(`Sold 1 ${item} for +${r.credits} CR.`);
      } else {
        this.showToast('Nothing sold — the ledger held tight.');
      }
      this.updateHUD();
      if (this.showingRanch) this.openRanch();
    });
  }

  // ── Tool upgrade: spend credits to improve your hoe (U key) ──
  upgradeTool() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — no upgrades.'); return; }
    net.request('upgradeTool', {}).then(r => {
      if (r && r.ok) { this.tool = r.tool; if (this.audio) this.audio.sfx('confirm'); this.showToast(`Upgraded to the ${r.name}! ${r.credits} CR left.`); }
      else if (r && r.reason === 'not-enough-credits') this.showToast(`Need ${r.need} CR for the next hoe.`);
      else if (r && r.reason === 'max-tier') this.showToast('Your Gold Hoe is the finest in the colony.');
      else this.showToast('Could not upgrade.');
      this.updateHUD();
    });
  }

  // ── Seasonal festival: attend once per season (V key near the plaza) ──
  claimFestival() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline.'); return; }
    const todayFestival = this.roomState && this.roomState.festival;
    if (todayFestival) {
      net.request('claimFestival', {}).then(r => {
        if (r && r.ok) { if (this.audio) this.audio.sfx('star'); this.showToast(`Festival! +150 CR and ${r.npc} likes you more.`); }
        else if (r && r.reason === 'already-claimed') this.showToast('The festival reward was already claimed today.');
        else this.showToast('No festival reward to claim.');
        this.updateHUD();
      });
    } else {
      const next = calendar.nextFestivalAfter(this.roomState?.day || 0);
      this.showToast(
        next
          ? `No festival today. ${next.name} arrives ${calendar.seasonName(next.day)} ${calendar.dayInSeason(next.day)}.`
          : 'No festival today.'
      );
    }
  }

  // ── Storage chest at home: stash harvests safely (server-authoritative) ──
  openChest() {
    this.showingChest = true;
    this.chestPanel.setVisible(true);
    const inv = this.inventory || {};
    const st = this.storage || this._storage || {};
    this.chestContent.setText(
      `CHEST  —  stash harvests at home\n\n` +
      `INVENTORY\n${Object.entries(inv).filter(([,v]) => v > 0).map(([k, v]) => ` ${k}: ${v}`).join('\n') || '  (empty)'}\n\n` +
      `STORED\n${Object.entries(st).filter(([,v]) => v > 0).map(([k, v]) => ` ${k}: ${v}`).join('\n') || '  (empty)'}\n\n` +
      `[1] Deposit 1 crop   [2] Deposit 1 fish\n` +
      `[3] Withdraw 1 crop [4] Withdraw 1 fish\n` +
      `[SPACE] Close`
    );
  }

  depositToChest(kind) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — no chest.'); return; }
    const crops = ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato'];
    const fishs = ['moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin'];
    const pool = kind === 'fish' ? fishs : crops;
    const item = pool.find(i => (this.inventory[i] || 0) > 0);
    if (!item) { this.showToast(`No ${kind} to deposit.`); return; }
    net.request('deposit', { item, qty: 1 }).then(r => {
      if (r && r.ok) { this.inventory[item] = (this.inventory[item] || 0) - 1; this.showToast(`Stashed 1 ${item} in the chest.`); }
      else this.showToast('Nothing to stash.');
      this.openChest();
    });
  }

  withdrawFromChest(kind) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — no chest.'); return; }
    const stocks = this.storage || this._storage || {};
    const crops = ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato'];
    const fishs = ['moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin'];
    const pool = kind === 'fish' ? fishs : crops;
    const item = pool.find(i => (stocks[i] || 0) > 0);
    if (!item) { this.showToast(`No ${kind} stored.`); return; }
    net.request('withdraw', { item, qty: 1 }).then(r => {
      if (r && r.ok) { this.inventory[item] = (this.inventory[item] || 0) + 1; this.showToast(`Took 1 ${item} from the chest.`); }
      else this.showToast('Nothing to take.');
      this.openChest();
    });
  }

  // repopulate the pasture to match server animal counts (world reacts)
  _refreshRanch() {
    const animals = this.animals || {};
    const sig = ['chicken','cow','sheep'].map(k => animals[k] || 0).join(',');
    if (sig === this._animalsSig) return;
    this._animalsSig = sig;
    if (!this.ranchStage) return;
    // clear old critters (keep the sign + pen + hint)
    for (let i = this.ranchStage.length - 1; i >= 0; i--) {
      const ch = this.ranchStage.list[i];
      if (ch === this.ranchSign || ch.type === 'Rectangle' || ch.type === 'Text') continue;
      ch.destroy();
    }
    const order = ['chicken', 'cow', 'sheep'];
    let x = -52;
    order.forEach(sp => {
      const n = Math.min(animals[sp] || 0, 4);
      for (let i = 0; i < n; i++) {
        const jx = x + i * 30;
        const a = this.add.image(jx, 12, 'ranch.' + sp).setScale(1.1);
        this.ranchStage.add(a);
      }
      x += 46;
    });
    this.ranchStage.setVisible(Object.keys(animals).some(k => animals[k] > 0));
  }

  // ── Fishing (server-authoritative): cast at the stardust pond near x:27, y:22.
  //    Deliberately ACCESSIBLE: one press casts, the line visibly bobs, a splash
  //    confirms the catch, and the result pops up on screen — no hidden timing,
  //    no guessing whether it worked. ──
  fish() {
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const net = window.SpaceFarmer.net;
    // two fishing spots: stardust shore (common) and the deep drop (rare)
    const d1 = Math.hypot(px - 27, py - 22), d2 = Math.hypot(px - 38, py - 21);
    let spot = null;
    if (d1 <= 3.5) spot = 'stardust';
    else if (d2 <= 3.5) spot = 'deep';
    if (!spot) { this.showToast('Pick a spot — the stardust shore or the deep drop.'); return; }
    if (!net || !net.connected) { this.showToast('Offline — no fishing.'); return; }
    if (this.casting) return;                       // one cast at a time
    this.casting = true;
    if (this.audio) this.audio.sfx('space', { volume: 0.3 });
    if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setActivity('fishing');
    const isNight = !!this.isNight;
    this.showToast(`🎣 Casting ${spot === 'deep' ? 'into the deep drop' : 'at the stardust shore'}${isNight ? ' (night)' : ''}... (10 EP)`);
    const pondX = 27 * T, pondY = 21.5 * T;
    // a little bobber that bobs on the water while we wait
    const bob = this.add.graphics().setDepth(235);
    this._drawBobber(bob);
    const startY = pondY, t0 = this.time.now;
    const bobTween = this.time.addEvent({ delay: 60, loop: true, callback: () => {
      const ph = Math.sin((this.time.now - t0) / 140);
      bob.setPosition(pondX, startY + ph * 6);
    } });
    this.time.delayedCall(700, () => {
      bobTween.remove();
      bob.destroy();
      this._splash(pondX, pondY + 8, 0x39c5bb);     // splash ripple on the water
      net.request('fish', { spot, night: isNight }).then(r => {
        this.casting = false;
        if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setActivity(null);
        if (!r) return;
        if (r.ok) {
          if (this.audio) this.audio.sfx('space', { volume: 0.55 });
          this._fishCatch(r.item, r.worth, `season ${this._seasonName()} night fish`);   // popup
        } else if (r.reason === 'nothing-biting') this.showToast('Nothing biting here at this time of year/day. Try a different spot, season, or come back at night.');
        else if (r.reason === 'low-energy') this.showToast('Too tired to fish. Sleep to recover energy.');
      });
    });
  }
  _drawBobber(g) {
    g.clear();
    g.fillStyle(0x9ddd72, 0.95).fillCircle(0, 0, 3.5);
    g.fillStyle(0x1d2138, 1).fillCircle(0, 0, 1.6);
    g.fillStyle(0xcdecec, 0.85).fillRect(-1, -8, 2, 7);   // line
  }
  _splash(x, y, col) {
    const g = this.add.graphics().setDepth(233);
    let r = 6;
    const ev = this.time.addEvent({ delay: 30, repeat: 8, callback: () => {
      r += 2.6;
      g.clear();
      g.lineStyle(1.6, col, Math.max(0, (24 - r) / 24));
      g.strokeCircle(x, y, r);
      if (this.time.now > (ev.delay * (ev.repeat + 1) + ev.startAt || 0) && r > 28) g.destroy();
    } });
    this.time.delayedCall(520, () => g.destroy());
  }
  _fishCatch(item, worth, note) {
    const { width, height } = this.game.config;
    const label = item.replace(/-/g, ' ');
    const c = this.add.container(width / 2, height / 2 - 90).setDepth(999);
    const panel = this.add.rectangle(0, 0, 340, 104, 0x101a26, 0.92).setStrokeStyle(2, 0x39c5bb);
    const title = this.add.text(0, -32, 'CAUGHT', { fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#39c5bb' }).setOrigin(0.5);
    const fishTxt = this.add.text(0, -6, label, { fontFamily: "system-ui,'Segoe UI'", fontSize: '19px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    const worthTxt = this.add.text(0, 20, `+${worth} CR to your inventory`, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#9ddd72' }).setOrigin(0.5);
    const kids = [panel, title, fishTxt, worthTxt];
    if (note) { const nt = this.add.text(0, 38, note, { fontFamily: "system-ui,'Segoe UI'", fontSize: '10px', color: '#a8d8d8' }).setOrigin(0.5); kids.push(nt); }
    c.add(kids);
    c.setScale(0.6);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.out' });
    this.time.delayedCall(2000, () => this.tweens.add({ targets: c, alpha: 0, y: height / 2 - 140, duration: 300, onComplete: () => c.destroy() }));
  }
  // per-frame: floating hint near EITHER fishing spot so it's discoverable
  _updateFishHint() {
    if (!this.fishHint) return;
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const d1 = Math.hypot(px - 27, py - 22), d2 = Math.hypot(px - 38, py - 21);
    let near = false, label = '';
    if (d1 <= 3.5 && !this.casting) { near = true; label = '[J] CAST · stardust shore / some fish bite'; }
    else if (d2 <= 3.5 && !this.casting) { near = true; label = '[J] CAST · deep drop (rare, deep-water)'; }
    this.fishHint.setVisible(near).setPosition(this.playerSpr.x, this.playerSpr.y - 46).setAlpha(near ? 0.9 : 0);
    if (near && this._fishHintLabel !== label) { this._fishHintLabel = label; if (this._fishHintTxt) this._fishHintTxt.setText(label); }
  }
  _seasonName() {
    return SEASON_NAMES[this.season ?? 0] || 'SPRING';
  }

  // ── Mining (server-authoritative): crack asteroids for space ore, with the
  //    same ACCESSIBLE bar as fishing — visible rock, clear hint, pick swing,
  //    crack flash, result popup. ──
  _drawMineRock(g, x, y) {
    g.clear();
    g.fillStyle(0x5a6478, 1).fillCircle(x, y - 14, 13);       // rock body
    g.fillStyle(0x717d96, 1).beginPath();
    g.moveTo(x - 14, y - 10); g.lineTo(x - 2, y - 30); g.lineTo(x + 6, y - 8);
    g.closePath(); g.fillPath();
    g.fillStyle(0x39c5bb, 0.9).fillCircle(x - 10, y - 24, 3);  // teal glint
    g.fillStyle(0x9ddd72, 0.9).fillCircle(x + 10, y - 16, 2);
  }
  mine() {
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const d = Math.hypot(px - this.mineX, py - this.mineY);
    const net = window.SpaceFarmer.net;
    if (d > 4) { this.showToast('The asteroid field rumbles nearby.'); return; }
    if (!net || !net.connected) { this.showToast('Offline — no mining.'); return; }
    if (this.casting2) return;                    // one swing at a time (keep picking)
    this.casting2 = true;
    if (this.audio) this.audio.sfx('space', { volume: 0.3 });
    if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setActivity('mining');
    const rx = this.mineX * T, ry = this.mineY * T;
    // a quick pickaxe swing flash on the rock
    const swing = this.add.graphics().setDepth(96);
    swing.fillStyle(0xffffff, 0.8).fillCircle(rx, ry - 16, 2.2);
    this.time.delayedCall(170, () => swing.destroy());
    // each press is ONE swing at the vein (loop-y, not a one-shot)
    net.request('mine', {}).then(r => {
      this.casting2 = false;
      if (r && r.broken && window.SpaceFarmer?.music) window.SpaceFarmer.music.setActivity(null);
      if (!r) return;
      if (r.reason === 'low-energy') { this.showToast('Too tired to mine. Sleep to recover energy.'); return; }
      if (r.broken) {
        this._splash(rx, ry - 14, 0xd8a05a);         // rock collapses open
        this._showMineProgress(0, 0);
        if (r.item) this._oreCatch(r.item, r.worth, `broke through a ${r.max}-swing vein`);
      } else {
        this._showMineProgress(r.hp, r.max);        // chip + progress bar update
      }
    });
  }
  // progress bar + swing counter above the rock so you SEE the vein shrink
  _showMineProgress(hp, max) {
    if (!this.mineProg) {
      const rx = this.mineX * T, ry = this.mineY * T;
      this.mineProg = this.add.container(rx, ry - 40).setDepth(95);
      this.mineProg.add(this.add.rectangle(0, 0, 66, 8, 0x101a26, 0.88).setStrokeStyle(1, 0xd8a05a));
      this.mineProgFill = this.add.rectangle(-32, 0, 64, 5, 0x9ddd72, 0.9).setOrigin(0, 0.5);
      this.mineProg.add(this.mineProgFill);
      this.mineProgTxt = this.add.text(0, 16, '', { fontFamily: "system-ui,'Segoe UI'", fontSize: '11px', color: '#ffe9a0' }).setOrigin(0.5);
      this.mineProg.add(this.mineProgTxt);
    }
    if (!max || max <= 0) { this.mineProg.setVisible(false); return; }
    this.mineProg.setVisible(true);
    // some veins are deep — that's the whole point: keep picking
    const frac = Math.max(0.06, hp / max);
    this.mineProgFill.width = 64 * frac;
    this.mineProgTxt.setText(`⛏ ${max - hp}/${max} swings`);
  }
  _oreCatch(item, worth, note) {
    const { width, height } = this.game.config;
    const label = item.replace(/-/g, ' ');
    const c = this.add.container(width / 2 - 90, height / 2 - 90).setDepth(999);
    const panel = this.add.rectangle(0, 0, 340, 104, 0x101a26, 0.92).setStrokeStyle(2, 0xd8a05a);
    const title = this.add.text(0, -32, 'MINED', { fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#d8a05a' }).setOrigin(0.5);
    const oreTxt = this.add.text(0, -6, label, { fontFamily: "system-ui,'Segoe UI'", fontSize: '19px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    const worthTxt = this.add.text(0, 20, `+${worth} CR ore to inventory`, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#9ddd72' }).setOrigin(0.5);
    if (note) { const noteTxt = this.add.text(0, 40, note, { fontFamily: "system-ui,'Segoe UI'", fontSize: '10px', color: '#a8d8d8' }).setOrigin(0.5); c.add(noteTxt); }
    c.add([panel, title, oreTxt, worthTxt]);
    c.setScale(0.6);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.out' });
    this.time.delayedCall(2200, () => this.tweens.add({ targets: c, alpha: 0, y: height / 2 - 140, duration: 300, onComplete: () => c.destroy() }));
  }
  _updateMineHint() {
    if (!this.mineHint) return;
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const d = Math.hypot(px - this.mineX, py - this.mineY);
    const near = d <= 4 && !this.casting2;
    this.mineHint.setVisible(near).setPosition(this.playerSpr.x, this.playerSpr.y - 62).setAlpha(near ? 0.9 : 0);
  }

  // ── Cooking at the house kitchen ──
  // cook()           → generic: any 2 raw crops → cooked-food (legacy quick-cook)
  // cook(recipeKey)  → a named dish from RECIPES_CLIENT (the M4 kitchen)
  cook(recipeKey = null) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — no cooking.'); return; }
    const payload = recipeKey ? { recipe: recipeKey } : {};
    net.request('cook', payload).then(r => {
      if (r && r.ok) {
        if (this.audio) this.audio.sfx('glow', { volume: 0.5 });
        if (recipeKey) this.showToast(`Plated the ${RECIPES_CLIENT[recipeKey].name}!`);
        else this.showToast(`Simmered a meal! Cooked food ×${r.cooked}.`);
        if (this.showingRecipes) this.openRecipeBook();   // refresh "what you can make"
      }
      else if (r && r.reason === 'festival-only') this.showToast('The Earth Feast Plate can only be cooked on festival day.');
      else if (r && r.reason === 'need-ingredients') {
        const miss = r.missing ? ingLabel(r.missing) : 'ingredients';
        this.showToast(recipeKey ? `Missing: ${miss}` : 'Need 2 crops/fish to cook a meal.');
      }
      else this.showToast('Could not cook.');
    });
  }

  // ── Recipe book: [C] at the stove. Arrows pick a dish, [SPACE] cooks it, ──
  // [C/ESC] closes. "●" = cookable now, "○" = missing ingredients.
  openRecipeBook() {
    this.showingRecipes = true;
    this._recipeOrder = [];
    const groups = [[], [], [], []];
    const festival = [];
    for (const [key, r] of Object.entries(RECIPES_CLIENT)) {
      (r.festival ? festival : (groups[r.season] || groups[0])).push(key);
    }
    for (let s = 0; s < 4; s++) this._recipeOrder.push(...groups[s]);
    this._recipeOrder.push(...festival);
    if (this._recipeSel >= this._recipeOrder.length) this._recipeSel = 0;
    this._renderRecipeBook();
    this.recipePanel.setVisible(true);
  }

  _renderRecipeBook() {
    const inv = this.inventory || {};
    const lines = ['Pick a dish:'];
    let lastSeason = null, lastFest = false;
    this._recipeOrder.forEach((key, i) => {
      const r = RECIPES_CLIENT[key];
      if (r.festival !== lastFest || (!r.festival && r.season !== lastSeason)) {
        lines.push(r.festival ? '★ FESTIVAL (festival days only)' : SEASON_NAMES[r.season]);
        lastSeason = r.season; lastFest = !!r.festival;
      }
      lines.push(this._recipeLine(key, r, inv, i === this._recipeSel));
    });
    lines.push('');
    lines.push('[▲▼] pick   [SPACE] cook   [C] close');
    this.recipeContent.setText(lines.join('\n'));
  }

  _recipeLine(key, r, inv, selected) {
    const need = {};
    for (const ing of r.ingredients) need[ing] = (need[ing] || 0) + 1;
    const haveIt = Object.keys(need).every((k) => (inv[k] || 0) >= need[k]);
    const canMake = r.festival ? (this.roomState && this.roomState.festival) && haveIt : haveIt;
    const mark = selected ? '▶' : ' ';
    const dot = canMake ? '●' : '○';
    const have = Object.entries(need).map(([k, n]) => `${inv[k] || 0}/${n} ${ingLabel(k)}`).join(', ');
    const owned = (inv[key] || 0);
    const ownedTag = owned ? `  (×${owned})` : '';
    return ` ${mark} ${dot} ${r.name} — ${have}${ownedTag}`;
  }

  _moveRecipeCursor(dir) {
    if (!this._recipeOrder || !this._recipeOrder.length) return;
    this._recipeSel = (this._recipeSel + dir + this._recipeOrder.length) % this._recipeOrder.length;
    this._renderRecipeBook();
  }

  _cookRecipeAt(index) {
    const key = this._recipeOrder && this._recipeOrder[index];
    if (key) this.cook(key);
  }

  // ── House interior — a cozy room where you go to bed to end the day ──
  buildInterior(width, height) {
    const stage = this.add.container(0, 0).setDepth(500).setVisible(false);
    stage.setScrollFactor(0);          // fixed to the screen, not the world
    this.intStage = stage;

    const cx = width / 2, cy = height / 2;
    const W = 480, H = 340, wallH = 104;
    const top = cy - H / 2;

    // backdrop (full-viewport dim to mask the world behind)
    stage.add(this.add.rectangle(cx, cy, width, height, 0x000000, 0.82));

    // ── ROOM: a real space, not a card. Back wall band + floor with depth ──
    // back wall: warm panelled habitat wall
    stage.add(this.add.rectangle(cx, top + wallH / 2, W, wallH, 0x6e553c)
      .setStrokeStyle(3, 0x8a6c4a));
    // wall panel seams (vertical ribs so the repeat reads as plating, not flat)
    for (let i = 1; i < 6; i++) {
      const wx = cx - W / 2 + i * (W / 6);
      stage.add(this.add.rectangle(wx, top + wallH / 2, 2, wallH - 6, 0x5a442e, 0.85));
    }
    // warm skirting where wall meets floor (depth cue)
    stage.add(this.add.rectangle(cx, top + wallH, W, 5, 0x8a6c4a));
    // floor: warm wood with a soft vertical gradient (lighter at the wall, darker near you)
    const fg = this.add.graphics();
    fg.fillGradientStyle(0x6e5538, 0x6e5538, 0x40301e, 0x40301e);
    fg.fillRect(cx - W / 2, top + wallH, W, H - wallH);
    stage.add(fg);
    // floorboard seams
    for (let i = 1; i < 5; i++) {
      const ly = top + wallH + i * ((H - wallH) / 5);
      stage.add(this.add.rectangle(cx, ly, W - 6, 1, 0x3c2d1c, 0.55));
    }
    // warm light pool from the window (the room is LIT)
    stage.add(this.add.image(cx - 30, top + wallH + 26, 'fx.lamp_glow')
      .setBlendMode(Phaser.BlendModes.ADD).setScale(2.6, 1.6).setAlpha(0.20));

    // window (against far wall) — glows with the sky
    const windowImg = this.add.image(cx, top + 44, 'int.window').setScale(0.9);
    stage.add(windowImg);
    this.intWindow = windowImg;
    // soft sky-light breathing behind the glass (the room never sits still)
    const windowGlow = this.add.image(cx, top + 46, 'fx.lamp_glow')
      .setBlendMode(Phaser.BlendModes.ADD).setScale(2.3, 1.2).setAlpha(0.10).setDepth(-1);
    stage.add(windowGlow);
    this.intWindowGlow = windowGlow;

    // rug center, plant + bookcase side
    stage.add(this.add.image(cx, cy + 30, 'int.rug').setScale(1));
    stage.add(this.add.image(cx - W / 2 + 55, cy - 40, 'int.bookcase').setScale(0.9));
    const plantImg = this.add.image(cx + W / 2 - 55, cy + 20, 'int.plant').setScale(0.9);
    stage.add(plantImg);
    this.intPlant = plantImg;
    this._intPlantBaseY = cy + 20;
    stage.add(this.add.image(cx, cy - H / 2 + 90, 'int.table').setScale(0.9));

    // ── spouse: moves in when you marry (sits near the table) ──
    const spouse = this.add.image(cx + 95, cy + 42, 'player.front').setDepth(8);
    spouse.setVisible(false);
    stage.add(spouse);
    this.intSpouse = spouse;
    this._intSpouseBaseY = cy + 42;
    const spouseName = this.add.text(cx + 95, cy + 14, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '6px', color: '#ffe9a0',
    }).setOrigin(0.5);
    stage.add(spouseName);
    this.intSpouseName = spouseName;

    // the bed — your sleep spot (lower-left corner)
    const bedImg = this.add.image(cx - W / 2 + 65, cy + H / 2 - 55, 'int.bed').setScale(1.1);
    stage.add(bedImg);
    this.intBed = { x: cx - W / 2 + 65, y: cy + H / 2 - 55 };
    this.intBedImg = bedImg;

    // kitchen stove (cook 2 crops → 1 cooked-food)
    const stove = this.add.rectangle(cx + W / 2 - 55, cy - H / 2 + 40, 70, 34, 0x3a2a20)
      .setStrokeStyle(2, 0xd8a05a);
    stage.add(stove);
    stage.add(this.add.text(cx + W / 2 - 55, cy - H / 2 + 32, 'STOVE (recipes)', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '7px', color: '#ffe9a0',
    }).setOrigin(0.5));
    this.intStove = { x: cx + W / 2 - 55, y: cy - H / 2 + 40 };

    // storage chest (deposit/withdraw harvests) — beside the bookcase
    const chest = this.add.rectangle(cx - W / 2 + 22, cy - 40, 44, 30, 0x4a3322)
      .setStrokeStyle(2, 0xd8a05a);
    stage.add(chest);
    stage.add(this.add.text(cx - W / 2 + 22, cy - 56, 'CHEST', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '6px', color: '#ffe9a0',
    }).setOrigin(0.5));
    this.intChest = { x: cx - W / 2 + 22, y: cy - 40 };

    // the door (exit) — warm glow marker on the bottom edge
    const doorRect = this.add.rectangle(cx + W / 2 - 30, cy + H / 2 - 24, 50, 24, 0x2e2118)
      .setStrokeStyle(2, 0xe0a860);
    stage.add(doorRect);
    stage.add(this.add.text(cx + W / 2 - 30, cy + H / 2 - 36, 'DOOR', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '7px', color: '#ffe9a0',
    }).setOrigin(0.5));
    this.intDoor = { x: cx + W / 2 - 30, y: cy + H / 2 - 24 };

    // hint labels
    stage.add(this.add.text(cx, cy - H / 2 + 78, 'SLEEP IN YOUR BED (SPACE)', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '8px', color: '#b8c0e0',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5));

    // interior player (drawn inside the room)
    const ip = this.add.image(cx, cy + H / 2 - 65, 'player.front').setScale(0.5);
    ip.setDepth(10);
    stage.add(ip);
    this.intPlayer = ip;
    this.intShadow = this.add.image(ip.x, ip.y + 14, 'fx.shadow').setDepth(9);
    stage.add(this.intShadow);

    // geometry stored for movement clamping
    this.intW = W; this.intH = H; this.intCx = cx; this.intCy = cy;
  }

  enterHouse() {
    if (this.inInterior) return;
    this.inInterior = true;
    this.world.setVisible(false);
    this.intStage.setVisible(true);
    // place player inside near the door
    this.intPlayer.setPosition(this.intDoor.x + 10, this.intDoor.y + 40);
    if (this.intShadow) this.intShadow.setPosition(this.intPlayer.x, this.intPlayer.y + 14);
    this.refreshInteriorSpouse();
    this.showToast(this.marriedTo ? 'Welcome home. Your spouse is here.' : 'You step inside your cozy dome.');
    this.updateHUD();
  }

  // ── If married, the spouse lives here: sit them by the table + label ──
  refreshInteriorSpouse() {
    if (!this.intSpouse) return;
    const married = this.marriedTo;
    if (!married || !this.inInterior) { this.intSpouse.setVisible(false); if (this.intSpouseName) this.intSpouseName.setText(''); return; }
    this.intSpouse.setVisible(true);
    const data = NPC_DATA[married] || {};
    if (this.intSpouseName) this.intSpouseName.setText(data.name ? data.name.toUpperCase() : 'SPOUSE');
  }

  exitHouse() {
    if (!this.inInterior) return;
    this.inInterior = false;
    this.intStage.setVisible(false);
    this.world.setVisible(true);
    // back at the house door
    const door = BUILDINGS[0].door;
    this.playerSpr.setPosition(door.x * T + T / 2, door.y * T + T / 2);
    this.playerShadow.setPosition(this.playerSpr.x, this.playerSpr.y + 14);
    this.showToast('Back outside. The colony hums.');
    this.updateHUD();
  }

  isBlocked(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    return blocks[ty][tx];
  }

  moveDir(dir) { this.touchDir = dir; }
  stopMove() { this.touchDir = null; }

  update(time) {
    const { width, height } = this.game.config;   // viewport in world coords (meteor/cloud spawn)
    // Task 4: lamp/door light-pool flicker — each pool wobbles on its own
    // phase (rare deep dip = "old lamp" feel). Cheap: alpha only, no textures.
    if (this.isNight && this.lightPools) {
      for (const p of this.lightPools) {
        if (!p.img.visible) continue;
        let f = 0.92 + 0.08 * Math.sin(time * p.speed + p.phase) + 0.04 * Math.sin(time * p.speed * 7.3 + p.phase * 3);
        if (Math.random() < 0.0006) f *= 0.4;   // occasional stutter
        p.img.setAlpha(p.base * f);
      }
      if (this.playerRim && this.playerSpr) {
        this.playerRim.setPosition(this.playerSpr.x, this.playerSpr.y + 12);
        this.playerRim.setAlpha(0.24 + 0.05 * Math.sin(time * 0.002));
      }
    }
    // parallax backdrop: locked to screen (single zoomed cam) + gentle drift
    {
      const cam = this.cam;
      const vw = this.bgW / ZOOM, vh = this.bgH / ZOOM;
      const cx = cam.scrollX + vw / 2, cy = cam.scrollY + vh / 2;
      this.nebula.setPosition(cx + Math.sin(time * 0.00008) * 8, cy + Math.cos(time * 0.00006) * 6);
      this.planetSpr.setPosition(
        cx + (this.planetBase.x - this.bgW / 2) / ZOOM + Math.sin(time * 0.00015) * 4,
        cy + (this.planetBase.y - this.bgH / 2) / ZOOM
      );
      this.planetSpr2.setPosition(
        cx + (this.planet2Base.x - this.bgW / 2) / ZOOM,
        cy + (this.planet2Base.y - this.bgH / 2) / ZOOM + Math.cos(time * 0.00012) * 4
      );
      for (const st of this.stars) {
        st.obj.setPosition(cx + (st.bx - this.bgW / 2) / ZOOM, cy + (st.by - this.bgH / 2) / ZOOM);
        const tw = Math.abs(Math.sin(time * 0.001 + st.bx));
        st.obj.alpha = this.isNight ? (0.12 + 0.5 * tw) : (0.03 + 0.06 * tw);
      }
      // living sky: the sun arcs across the day sky; the moon takes over at night
      if (this.sun && this.moon) {
        const p = (time * 0.00003) % Math.PI;
        const h = Math.abs(Math.sin(p));
        this.sun.setPosition(cx + (Math.cos(p) + 0.35) * 100, cy - 30 - h * 118);
        this.sun.setAlpha(0.30 + 0.70 * h);
        this.sun.setVisible(!this.isNight);
        this.moon.setPosition(cx - (Math.cos(p) + 0.55) * 96, cy - 24 - h * 92);
        this.moon.setAlpha(0.25 + 0.75 * h);
        this.moon.setVisible(this.isNight);
      }
      if (this.dayWarm) {
        this.dayWarm.setVisible(!this.isNight);
        this.dayWarm.setAlpha(this.isNight ? 0 : 0.12);
      }
      if (this.skyTile) this.skyTile.setAlpha(this.isNight ? 0.45 : 1);
      if (this.meteors && time - (this._meteorLast || 0) > 2600) {
        this._meteorLast = time;
        const m = this.add.image(Math.random() * width, 20 - Math.random() * 160, 'fx.meteor')
          .setScrollFactor(0).setDepth(980).setAngle(24).setAlpha(0.9).setOrigin(0.5);
        m.mvx = 2.3 + Math.random() * 2.4; m.mvy = 1.8 + Math.random() * 1.3;
        this.meteors.push(m);
      }
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const m = this.meteors[i];
        m.x += m.mvx; m.y += m.mvy; m.alpha -= 0.01;
        if (m.alpha <= 0.02 || m.y > height + 50 || m.x > width + 100) { m.destroy(); this.meteors.splice(i, 1); }
      }
      // clouds drift lazily across the sky at parallax depth
      if (this.clouds) {
        const span = vw + 120;
        for (let i = 0; i < this.clouds.length; i++) {
          const cw = this.clouds[i];
          const ccx = cx + (((time * 0.003 + i * 150) % span) - span / 2);
          cw.obj.setPosition(ccx, cy - 42 - i * 24);
          cw.obj.setScale(cw.sc);
          cw.obj.setAlpha(0.5 - i * 0.06);
        }
      }
    }
    // fence beam flicker
    const beamTex = Math.floor(time / 500) % 2 === 0 ? 'decor.fence_beam_a' : 'decor.fence_beam_b';
    for (const b of this.fenceBeams) b.setTexture(beamTex);
    // water shimmer (2-frame)
    const waterTex = Math.floor(time / 600) % 2 === 0 ? 'tile.water' : 'tile.water2';
    for (const wt of this.waterTiles) wt.setTexture(waterTex);
    // building animation frames
    for (const bs of this.buildingSprites) {
      if (bs.b.key === 'exchange') bs.img.setTexture(Math.floor(time / 400) % 2 === 0 ? 'bld.exchange_a' : 'bld.exchange_b');
      if (bs.b.key === 'tavern') bs.img.setTexture(['bld.tavern_a', 'bld.tavern_b', 'bld.tavern_c'][Math.floor(time / 300) % 3]);
    }
    // buildings breathe at night — windows/doors/signs pulse on their own beat
    if (this.isNight && this.buildingGlows.length) {
      for (let i = 0; i < this.buildingGlows.length; i++) {
        const g = this.buildingGlows[i];
        if (!g.visible) continue;
        g.setAlpha(0.82 + 0.18 * Math.sin(time * 0.0018 + g.phase));
      }
    }
    // ── NPC errand brains (wander, work at POIs, pause, move on) ──
    const dt = Math.min(50, time - (this._lastT || time));
    this._lastT = time;
    for (const b of Object.values(this.npcBrains)) {
      this.tickNpc(b, dt, time);
    }

    if (this.inAlienContact || this.inDialogue || this.showingGE || this.showingShop || this.showingRanch || this.showingChest || this.showingQuests || this.showingRecipes) {
      if (this.inAlienContact) {
        if (this._diaNPC && !this._diaDone) this.dialoguePortrait.setTexture("port." + this._diaNPC + "_" + (Math.floor(time / 70) % 3));
        if (this.contactPhase === "choice") {
          const keys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey, this.fiveKey];
          keys.forEach((key, index) => { if (Phaser.Input.Keyboard.JustDown(key)) this.chooseContactDoctrine(CONTACT_DOCTRINES[index].id); });
        } else if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey) || Phaser.Input.Keyboard.JustDown(this.wasd.A)) {
          if (!this._diaDone) this._finishTyping(); else this.advanceAlienCutscene();
        }
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
        this.updateHUD(); this.updateNightOverlay(); return;
      }
      // heart-event cutscene: SPACE/ENTER finishes typing, then advances line-by-line; ESC skips
      if (this.eventQueue) {
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey) || Phaser.Input.Keyboard.JustDown(this.wasd.A)) {
          if (this._diaDone) this.advanceEvent();
          else this._finishTyping();
        } else if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
          this.eventQueue = null; this.eventIdx = 0;
          this.startNPCDialogue(this.selectedNPC);
        }
        this.updateHUD();
        this.updateNightOverlay();
        return;
      }
      // propose / heart-event prompt keys while in normal NPC dialogue
      if (this.inDialogue) {
        if (Phaser.Input.Keyboard.JustDown(this.gKey)) this.handleGift(this.selectedNPC);
        if (Phaser.Input.Keyboard.JustDown(this.pKey)) this.handlePropose(this.selectedNPC);
        if (Phaser.Input.Keyboard.JustDown(this.hKey)) this.toggleHeartEvent(this.selectedNPC);
        // EarthBound "blab" — the portrait's mouth opens/closes while the line
        // types out, and it gently bobs even when idle (never sits still)
        if (this._diaNPC) {
          if (!this._diaDone) this.dialoguePortrait.setTexture(`port.${this._diaNPC}_${Math.floor(time / 55) % 3}`);
          this.dialoguePortrait.y = this._portraitBaseY + Math.sin(time / 280) * 2.5;
        }
        // space/a/e: finish the typewriter first, then close the box
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey) || Phaser.Input.Keyboard.JustDown(this.wasd.A)) {
          if (!this._diaDone) this._finishTyping();
          else this.closeAllPanels();
        }
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
      }
      // ranch panel: buy 1/2/3, feed F, sell products S
      if (this.showingRanch) {
        if (Phaser.Input.Keyboard.JustDown(this.oneKey)) this.buyAnimal('chicken');
        if (Phaser.Input.Keyboard.JustDown(this.twoKey)) this.buyAnimal('cow');
        if (Phaser.Input.Keyboard.JustDown(this.threeKey)) this.buyAnimal('sheep');
        if (Phaser.Input.Keyboard.JustDown(this.fKey)) this.feedAnimals();
        if (Phaser.Input.Keyboard.JustDown(this.wasd.S)) this.sellProducts();
      }
      // supply depot: 1-4 buy real items (the shelf is not a lie)
      if (this.showingShop) {
        if (Phaser.Input.Keyboard.JustDown(this.oneKey)) this.buyFromShop('seeds');
        else if (Phaser.Input.Keyboard.JustDown(this.twoKey)) this.buyFromShop('stardust-crystal');
        else if (Phaser.Input.Keyboard.JustDown(this.threeKey)) this.buyFromShop('tech-part');
        else if (Phaser.Input.Keyboard.JustDown(this.fourKey)) this.buyFromShop('cooked-food');
      }
      // grand exchange: 1-4 sell by category (living sell board)
      if (this.showingGE) {
        if (Phaser.Input.Keyboard.JustDown(this.oneKey)) this.sellCategory('crop');
        else if (Phaser.Input.Keyboard.JustDown(this.twoKey)) this.sellCategory('fish');
        else if (Phaser.Input.Keyboard.JustDown(this.threeKey)) this.sellCategory('produce');
        else if (Phaser.Input.Keyboard.JustDown(this.fourKey)) this.sellCategory('ore');
      }
      // chest panel: 1/2 deposit, 3/4 withdraw
      if (this.showingChest) {
        if (Phaser.Input.Keyboard.JustDown(this.oneKey)) this.depositToChest('crop');
        if (Phaser.Input.Keyboard.JustDown(this.twoKey)) this.depositToChest('fish');
        if (Phaser.Input.Keyboard.JustDown(this.threeKey)) this.withdrawFromChest('crop');
        if (Phaser.Input.Keyboard.JustDown(this.fourKey)) this.withdrawFromChest('fish');
      }
      // recipe book (M4 kitchen): arrows pick, space cooks, C/ESC close
      if (this.showingRecipes) {
        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) this._moveRecipeCursor(-1);
        else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) this._moveRecipeCursor(1);
        if (!this.inDialogue && Phaser.Input.Keyboard.JustDown(this.spaceKey)) { this._cookRecipeAt(this._recipeSel); }
        if (this.cKey && Phaser.Input.Keyboard.JustDown(this.cKey)) this.closeAllPanels();
      }
      // non-dialogue panels close on space/esc
      if (this.lKey && Phaser.Input.Keyboard.JustDown(this.lKey)) this._toggleCodex();
      if (this.showingQuests && this.qKey && Phaser.Input.Keyboard.JustDown(this.qKey)) this.toggleQuestLog();
      if (!this.inDialogue && (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.escKey))) {
        this.closeAllPanels();
      }
      this.updateHUD();
      this.updateNightOverlay();
      return;
    }

    // ── movement (axis-separated collision) ──
    let dx = 0, dy = 0;
    if (this.wasd.W.isDown || this.cursors.up.isDown) { dy = -this.playerSpeed; this.playerDir = 'back'; }
    else if (this.wasd.S.isDown || this.cursors.down.isDown) { dy = this.playerSpeed; this.playerDir = 'front'; }
    if (this.wasd.A.isDown || this.cursors.left.isDown) { dx = -this.playerSpeed; this.playerDir = 'left'; }
    else if (this.wasd.D.isDown || this.cursors.right.isDown) { dx = this.playerSpeed; this.playerDir = 'right'; }
    if (!dx && !dy && this.touchDir) {
      const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      const [mx, my] = map[this.touchDir] || [0, 0];
      dx = mx * this.playerSpeed; dy = my * this.playerSpeed;
      this.playerDir = this.touchDir === 'up' ? 'back' : this.touchDir === 'down' ? 'front' : this.touchDir;
    }
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    // ── Interior movement (inside the house — room-bounded, no world collision) ──
    if (this.inInterior && this.intPlayer) {
      const nx = this.intPlayer.x + dx, ny = this.intPlayer.y + dy;
      const W2 = this.intW / 2, H2 = this.intH / 2;
      this.intPlayer.x = Phaser.Math.Clamp(nx, this.intCx - W2 + 20, this.intCx + W2 - 20);
      this.intPlayer.y = Phaser.Math.Clamp(ny, this.intCy - H2 + 24, this.intCy + H2 - 20);
      const moving = !!dx || !!dy;
      const fKey = moving ? Math.floor(time / 110) % 3 : 0;
      this.intPlayer.setTexture(`${this.playerDir}_${fKey}`);
      if (this.intShadow) this.intShadow.setPosition(this.intPlayer.x, this.intPlayer.y + 14);

      // interact inside: chest → storage, stove → cook, bed → sleep, door → exit
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
        const dBed = Math.hypot(this.intPlayer.x - this.intBed.x, this.intPlayer.y - this.intBed.y);
        const dDoor = Math.hypot(this.intPlayer.x - this.intDoor.x, this.intPlayer.y - this.intDoor.y);
        const dStove = this.intStove ? Math.hypot(this.intPlayer.x - this.intStove.x, this.intPlayer.y - this.intStove.y) : 999;
        const dChest = this.intChest ? Math.hypot(this.intPlayer.x - this.intChest.x, this.intPlayer.y - this.intChest.y) : 999;
        if (dChest < 64) { this.openChest(); }
        else if (dStove < 64) { this.openRecipeBook(); }
        else if (dBed < 60) { this.sleep(); }
        else if (dDoor < 60) { this.exitHouse(); }
      }

      // ── the room is alive: window light breathes, the plant sways, and a
      // spouse (if any) rocks gently by the table whenever you are home
      if (this.intWindowGlow) {
        this.intWindowGlow.setAlpha(0.07 + 0.07 * Math.sin(time * 0.0016));
      }
      if (this.intPlant && this._intPlantBaseY != null) {
        this.intPlant.y = this._intPlantBaseY + Math.sin(time * 0.0024) * 1.6;
      }
      if (this.intSpouse && this.intSpouse.visible && this._intSpouseBaseY != null) {
        this.intSpouse.y = this._intSpouseBaseY + Math.sin(time * 0.003) * 1.4;
      }

      this.updateHUD();
      return;
    }

    const nx = this.playerSpr.x + dx;
    if (!this.blockedAt(nx, this.playerSpr.y)) this.playerSpr.x = nx;
    const ny = this.playerSpr.y + dy;
    if (!this.blockedAt(this.playerSpr.x, ny)) this.playerSpr.y = ny;
    this.playerSpr.setDepth(Math.floor(this.playerSpr.y / T) + 1);
    this.playerShadow.setPosition(this.playerSpr.x, this.playerSpr.y + 14);
    this.playerShadow.setDepth(Math.floor(this.playerSpr.y / T) + 0.4);

    // player texture — 32×32 walk cycle when moving, idle frame when stopped
    const moving = !!dx || !!dy;
    const fKey = moving ? Math.floor(time / 110) % 3 : 0;
    this.playerSpr.setTexture(`${this.playerDir}_${fKey}`);

    // camera target follows player (world-local → scene coords)
    this.camTarget.setPosition(this.playerSpr.x + this.worldX, this.playerSpr.y + this.worldY);

    // ── interact ──
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.handleInteract();
    }
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) this.openGrandExchange();
    if (Phaser.Input.Keyboard.JustDown(this.iKey)) this.openShop();
    if (Phaser.Input.Keyboard.JustDown(this.uKey)) this.upgradeTool();
    if (Phaser.Input.Keyboard.JustDown(this.vKey)) this.claimFestival();
    if (this.qKey && Phaser.Input.Keyboard.JustDown(this.qKey)) this.toggleQuestLog();
    if (Phaser.Input.Keyboard.JustDown(this.gKey) && this.inDialogue) this.handleGift(this.selectedNPC);
    if (Phaser.Input.Keyboard.JustDown(this.fishKey)) this.fish();
    this._updateFishHint();
    if (Phaser.Input.Keyboard.JustDown(this.mineKey)) this.mine();
    this._updateMineHint();

    // net
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('move', { x: this.playerSpr.x, y: this.playerSpr.y });
    this.updateRemotePlayers(net);

    this.updateHUD();
    this.updateSeason();
    this.updateNightOverlay();
  }

  blockedAt(px, py) {
    const r = 12;
    return this.isBlocked(Math.floor((px - r) / T), Math.floor((py - r) / T))
      || this.isBlocked(Math.floor((px + r) / T), Math.floor((py - r) / T))
      || this.isBlocked(Math.floor((px - r) / T), Math.floor((py + r) / T))
      || this.isBlocked(Math.floor((px + r) / T), Math.floor((py + r) / T));
  }

  // ── NPC errand AI ──────────────────────────────────────────────
  // Townspeople have stuff to do: they wander the streets, pop into the
  // shop / exchange / tavern to "work" for a while, stop at the house door
  // to chat with the player, and linger at their own homes.
  _tileCx(tx, ty) { return { x: tx * T + T / 2, y: ty * T + T / 2 }; }

  _pickErrand(b) {
    const roll = Math.random();
    let tx, ty;
    // M3 — on a festival day the town goes to the plaza (70%): nobody
    // runs normal errands while Earth Day is on.
    if (this._festActive && this._festActive()) {
      if (Math.random() < 0.7) {
        const gx = FEST_PLAZA.x + Math.floor(Math.random() * 5) - 2;
        const gy = FEST_PLAZA.y + 2 + Math.floor(Math.random() * 2);
        const goal = this._findStandable(gx, gy, 3) || this._tileCx(b.home.x, b.home.y);
        b.path = [goal];
        b.working = Math.random() < 0.75;   // linger/watch the stage
        return;
      }
    }
    if (roll < 0.45) {
      // head home and linger
      tx = b.home.x; ty = b.home.y;
    } else if (roll < 0.55) {
      // hang out by the house door (one tile south — clear of the eaves)
      const door = BUILDINGS[0].door;
      tx = door.x; ty = door.y + 1;
    } else {
      // pick an errand spot: POI door or a random open tile
      if (Math.random() < 0.55) {
        const poi = BUILDINGS[1 + Math.floor(Math.random() * 3)];
        tx = poi.door.x; ty = poi.door.y;
      } else {
        tx = 3 + Math.floor(Math.random() * (MAP_W - 6));
        ty = 2 + Math.floor(Math.random() * 12);
      }
    }
    // resolve to the nearest tile the sprite can actually stand on.
    // Fallback = the NPC's own tile: it is standable (the AI always ends
    // states on open ground), so the walk step can never end up stuck.
    const goal = this._findStandable(tx, ty, 3) || this._tileCx(b.home.x, b.home.y);
    b.path = [goal];
    b.working = Math.random() < 0.6;
  }

  npcFootprintBlocked(px_, py_) {
    // 32px body centered on (px_,py_): corners at ±15 → the 2x2 tiles the
    // sprite actually covers. If the footprint is clear, the center tile
    // (a member of it) is guaranteed clear too.
    const x0 = Math.floor((px_ - 15) / T), x1 = Math.floor((px_ + 15) / T);
    const y0 = Math.floor((py_ - 15) / T), y1 = Math.floor((py_ + 15) / T);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.isBlocked(tx, ty)) return true;
    return false;
  }

  _standable(tx, ty) {
    return !this.npcFootprintBlocked(tx * T + T / 2, ty * T + T / 2);
  }

  _findStandable(nearX, nearY, maxR) {
    // nearest open standable tile center (pixels) around (nearX, nearY)
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = nearX + dx, ty = nearY + dy;
          if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue;
          if (this._standable(tx, ty)) return this._tileCx(tx, ty);
        }
      }
    }
    return null;
  }

  tickNpc(b, dt, time) {
    const spr = this.npcSprites.find(s => s.npcId === b.id);
    if (!spr) return;
    b.timer -= dt;

    if (b.state === 'idle') {
      if (b.timer <= 0) {
        b.state = 'walk';
        b.walkT = 0;
        this._pickErrand(b);
      }
      spr.setTexture(`npc.${b.id}_0`);
      if (spr._label) spr._label.setPosition(b.x, b.y - 16);
      return;
    }

    if (b.state === 'work') {
      if (b.timer <= 0) {
        b.state = 'walk';
        b.timer = 900 + Math.random() * 1800;
        b.walkT = 0;
        this._pickErrand(b);
      }
      const f = Math.floor(time / 420) % 3;
      if (spr.texture.key !== `npc.${b.id}_${f}`) spr.setTexture(`npc.${b.id}_${f}`);
      if (spr._label) spr._label.setPosition(b.x, b.y - 16 - (f === 1 ? 1 : 0));
      return;
    }

    // ── walk ──
    b.walkT += dt;
    // stuck guard: give up and rest in place (dest too close to a wall)
    if (b.walkT > 8000) {
      b.path = [];
      b.state = 'idle';
      b.timer = 1000 + Math.random() * 2000;
      spr.setTexture(`npc.${b.id}_0`);
      if (spr._label) spr._label.setPosition(b.x, b.y - 16);
      return;
    }
    const step = 2.7 * (dt / 16.67); // px this frame
    const cur = b.path[0];
    const dx = cur.x - b.x, dy = cur.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < step) {
      b.x = cur.x; b.y = cur.y;
      b.path.shift();
      b.walkT = 0;
      if (b.path.length === 0) {
        b.state = 'work';
        b.timer = 1400 + Math.random() * 2400;
      }
    } else {
      // advance toward the goal, capped so we never overshoot it (the goal
      // is standable; any point between two standable points stays open)
      const ox = b.x, oy = b.y;
      const move = Math.min(step, d);
      b.x += (dx / d) * move;
      b.y += (dy / d) * move;
      b.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'front' : 'back');
      // axis-separated collision fallback (32px body footprint)
      if (this.npcFootprintBlocked(b.x, b.y)) {
        if (!this.npcFootprintBlocked(b.x, oy)) b.y = oy;
        else if (!this.npcFootprintBlocked(ox, b.y)) b.x = ox;
        else { b.x = ox; b.y = oy; }
      }
      // soft separation: don't stand on the player (skip if it hits a wall)
      const pd = Math.hypot(this.playerSpr.x - b.x, this.playerSpr.y - b.y);
      if (pd < T * 0.75 && pd > 0.01) {
        const sx = b.x + ((b.x - this.playerSpr.x) / pd) * step * 1.5;
        const sy = b.y + ((b.y - this.playerSpr.y) / pd) * step * 1.5;
        if (!this.npcFootprintBlocked(sx, sy)) { b.x = sx; b.y = sy; }
      }
      const f = Math.floor(time / 110) % 3;
      const key = `npc.${b.id}_${b.dir}_${f}`;
      if (spr.texture.key !== key) spr.setTexture(key);
    }
    spr.setPosition(b.x, b.y);
    spr.setDepth(Math.floor(b.y / T) + 0.5);
    if (spr._shadow) { spr._shadow.setPosition(b.x, b.y + 14); spr._shadow.setDepth(Math.floor(b.y / T) + 0.4); }
    if (spr._label) spr._label.setPosition(b.x, b.y - 16);
  }

  // night overlay covers exactly the camera's current view (world coords)
  updateNightOverlay() {
    if (!this.isNight) return;
    const cam = this.cam;
    this.nightOverlay.setPosition(cam.scrollX, cam.scrollY);
    this.nightOverlay.setSize(cam.width / cam.zoom, cam.height / cam.zoom);
  }

  // ── Seasonal weather pass: tint the world + spawn particles ──
  updateSeason() {
    const cam = this.cam;
    this.seasonOverlay.setPosition(cam.scrollX, cam.scrollY);
    this.seasonOverlay.setSize(cam.width / cam.zoom, cam.height / cam.zoom);
    const s = this.season ?? 0;
    // tint ramps (white = no change). SPRING bright/green-warm, SUMMER warm,
    // FALL amber, WINTER cool/blue-slate.
    const TINTS = {
      0: { color: 0xe8f0d8, alpha: 0.06, label: 'SPRING' },   // gold-green spring
      1: { color: 0xf4e8c8, alpha: 0.06, label: 'SUMMER' },  // sun-warm summer
      2: { color: 0xdfc490, alpha: 0.10, label: 'FALL' },     // amber fall
      3: { color: 0xc8d4f0, alpha: 0.14, label: 'WINTER' }, // cool-slate winter
    };
    const t = TINTS[s] || TINTS[0];
    this.seasonOverlay.setFillStyle(t.color).setAlpha(t.alpha);
    // weather particles
    const snowOn = s === 3, leavesOn = s === 2;
    if (this.snow) { this.snow.start(snowOn ? 'start' : 'stop'); this.snow.setVisible(snowOn); }
    if (this.leaves) { this.leaves.start(leavesOn ? 'start' : 'stop'); this.leaves.setVisible(leavesOn); }
    // sync nebula hue slightly (winter → calmer, summer → warmer)
    if (this.nebula) {
      const hue = { 0: 0.0, 1: 0.06, 2: 0.10, 3: -0.05 }[s] || 0;
      this.nebula.tint = hue ? (hue > 0 ? 0xf0e0c0 : 0xb8c8e8) : 0xffffff;
    }
  }

  // ── remote farmers (multiplayer presence) ─────────────────────
  // Every other farmer in the room gets a player sprite + name label,
  // interpolated toward their authoritative state position. Keyed by
  // sessionId; sprites are created/destroyed as players join/leave.
  updateRemotePlayers(net) {
    if (!this.remoteSpr) this.remoteSpr = new Map();
    if (!net || !net.room || !net.room.state) {
      // offline: clear any stragglers
      for (const [, rs] of this.remoteSpr) this._destroyRemote(rs);
      this.remoteSpr.clear();
      return;
    }
    const seen = new Set();
    net.room.state.players.forEach((p, sid) => {
      if (sid === net.playerId) return;
      seen.add(sid);
      let rs = this.remoteSpr.get(sid);
      if (!rs) {
        const shadow = this.add.image(p.x, p.y + 34, 'fx.shadow')
          .setScale(1.4).setDepth(p.y + 0.4).setAlpha(0.85);
        this.world.add(shadow);
        const spr = this.add.image(p.x, p.y, 'player.front')
          .setScale(0.68).setDepth(p.y + 1);
        this.world.add(spr);
        const label = this.add.text(p.x, p.y - 40, p.name || 'Farmer', {
          fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
          fontSize: '7px', color: '#ffd6f0',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(p.y + 2).setAlpha(0.9);
        this.world.add(label);
        rs = { spr, shadow, label };
        this.remoteSpr.set(sid, rs);
      }
      // smooth interpolation toward the authoritative position
      rs.spr.x += (p.x - rs.spr.x) * 0.35;
      rs.spr.y += (p.y - rs.spr.y) * 0.35;
      rs.shadow.setPosition(rs.spr.x, rs.spr.y + 34);
      rs.label.setPosition(rs.spr.x, rs.spr.y - 40);
      rs.spr.setDepth(rs.spr.y + 1);
      rs.shadow.setDepth(rs.spr.y + 0.4);
      rs.label.setDepth(rs.spr.y + 2);
    });
    // players who left — remove their sprites
    for (const [sid, rs] of this.remoteSpr) {
      if (!seen.has(sid)) { this._destroyRemote(rs); this.remoteSpr.delete(sid); }
    }
  }

  _destroyRemote(rs) {
    rs.spr.destroy();
    rs.shadow.destroy();
    rs.label.destroy();
  }

  updateHUD() {
    const seeds = this.inventory.seeds || 0;
    // Pull season + livestock from the authoritative server state
    const net = window.SpaceFarmer.net;
    this._questPS = null;
    if (net && net.connected) {
      const ps = net.getPlayerState && net.getPlayerState();
      if (ps) {
        this._questPS = ps;
        // Energy, credits, and inventory are server-authoritative (one gate,
        // one ledger) — read them back so the browser is a viewer, not a cheater.
        if (typeof ps.energy === 'number') this.energy = ps.energy;
        if (typeof ps.staminaMax === 'number') this.staminaMax = ps.staminaMax;
        if (typeof ps.credits === 'number') this.credits = ps.credits;
        this.inventory = this.inventory || {};
        for (const [k, v] of schemaEntries(ps.inventory)) this.inventory[k] = v;
        this.animals = this.animals || {};
        for (const [k, v] of schemaEntries(ps.animals)) this.animals[k] = v;
        this._refreshRanch();
        this.storage = this.storage || {};
        for (const [k, v] of schemaEntries(ps.storage)) this.storage[k] = v;
        if (ps.tool) this.tool = ps.tool;
        // The browser is a camera: reconcile each farm tile from the server's
        // authoritative grid so rejected moves (e.g. low-energy till) and
        // multiplayer contention can never leave the field lying about what it is.
        this._syncFarmState();
        if (net.room && net.room.state) {
          this.roomState = net.room.state;
          // M3 — festival phase is authoritative in room state: sync it here so
          // a REJOIN (mid-festival or during afterglow) shows the plaza/decor
          // immediately, not only after the next live transition message.
          // setFestivalPhase is a no-op when the phase hasn't changed.
          if (net.room.state.festivalPhase) this.setFestivalPhase(net.room.state.festivalPhase);
          if (net.room.state.season !== undefined) {
            this.season = net.room.state.season;
            if (window.SpaceFarmer && window.SpaceFarmer.music) {
              window.SpaceFarmer.music.setSeason(this.season);  // seasonal soundtrack
            }
          }
        }
      }
    }
    const sName = SEASON_NAMES[this.season ?? 0] || 'SPRING';
    let hudFest = '';
    if (this.roomState && this.roomState.festival) {
      const fest = calendar.festivalForDay(this.roomState.day || 0);
      hudFest = fest ? `   ·   ${fest.short}` : '   ·   FESTIVAL';
    }
    this.hudText.setText(`${this.credits} CR   ·   ${this.energy}/${this.staminaMax || 100} STAMINA   ·   ${seeds} SEEDS   ·   ${this.tool.toUpperCase()}   ·   ${sName}${hudFest}`);
    if (this.energyFill) {
      const energyRatio = Math.max(0, Math.min(1, this.energy / (this.staminaMax || 100)));
      this.energyFill.width = 170 * energyRatio;
      this.energyFill.setFillStyle(energyRatio < 0.25 ? 0xf06f68 : energyRatio < 0.55 ? 0xf3bd67 : 0x6be7d0);
    }
    const animals = this.animals || {};
    const hasAnimals = Object.keys(animals).some(k => animals[k] > 0);
    this.hudDay.setText(
      (this.isNight ? `NIGHT ${this.dayCount}` : `DAY ${this.dayCount}`) +
      (hasAnimals ? `  🐔${animals.chicken || 0}🐮${animals.cow || 0}🐑${animals.sheep || 0}` : '')
    );
    // 'The Stardust Story' — quest chip + transition detection (banner on complete)
    this.checkQuestTransitions();
    if (this.questChip) {
      const view = questView(this._questPS, this._questPS);
      this.questChip.setText(questChip(view));
    }
  }

  // ── Authoritative tile sync: the browser is a camera. Any drift between the
  // optimistic local farm and the server's grid (a rejected till, another
  // farmer's action, a rejoin mid-season) is corrected here on every HUD tick.
  _syncFarmState() {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected || !net.getFarmState) return;
    const fs = net.getFarmState();
    if (!fs || !fs.tiles) return;
    for (const tile of fs.tiles) {
      if (!tile) continue;
      const local = this.farmTiles && this.farmTiles.find(t => t.x === tile.x && t.y === tile.y);
      if (!local) continue;
      const type = tile.type || 'empty';
      const watered = !!tile.watered;
      if (local.state.type !== type || local.state.watered !== watered ||
          (local.state.crop || '') !== (tile.crop || '') ||
          (local.state.growth || 0) !== (tile.growthDay || 0)) {
        local.state.type = type;
        local.state.crop = tile.crop || '';
        local.state.watered = watered;
        local.state.growth = tile.growthDay || 0;
        local.img.setTexture(TILE_FOR_STATE[type] || local.baseKey || 'tile.soil');
      }
    }
  }

  // ── interaction ──
  handleInteract() {
    // During any dialogue, the A button (keyboard or touch) advances it — finish
    // typing first, then move the conversation on (or close the box).
    if (this.inAlienContact || this.eventQueue || this.inDialogue) {
      if (this.inAlienContact && this.contactPhase === 'choice') return; // doctrine picks use number keys
      if (!this._diaDone) { this._finishTyping(); return; }
      if (this.inAlienContact) this.advanceAlienCutscene();
      else if (this.eventQueue) this.advanceEvent();
      else this.closeAllPanels();
      return;
    }
    // Inside the house: A-near-chest opens storage, A-near-stove cooks, A-near-bed sleeps, A-near-door exits.
    if (this.inInterior && this.intPlayer && this.intBed && this.intDoor) {
      const dBed = Math.hypot(this.intPlayer.x - this.intBed.x, this.intPlayer.y - this.intBed.y);
      const dDoor = Math.hypot(this.intPlayer.x - this.intDoor.x, this.intPlayer.y - this.intDoor.y);
      const dStove = this.intStove ? Math.hypot(this.intPlayer.x - this.intStove.x, this.intPlayer.y - this.intStove.y) : 999;
      const dChest = this.intChest ? Math.hypot(this.intPlayer.x - this.intChest.x, this.intPlayer.y - this.intChest.y) : 999;
      if (dChest < 64) { this.openChest(); }
      else if (dStove < 60) { this.openRecipeBook(); }
      else if (dBed < 60) { this.sleep(); }
      else if (dDoor < 60) { this.exitHouse(); }
      else this.showToast('The chest, stove, bed, or door?');
      return;
    }

    const ptx = Math.floor(this.playerSpr.x / T);
    const pty = Math.floor(this.playerSpr.y / T);

    for (const alien of ALIEN_DATA) {
      const d = Math.hypot(alien.x - ptx, alien.y - pty);
      if (d < 2) { this.startAlienContact(alien); return; }
    }
    for (const npc of NPCS) {
      const d = Math.hypot(npc.x - ptx, npc.y - pty);
      if (d < 2) { this.startNPCDialogue(npc); return; }
    }
    for (const b of BUILDINGS) {
      const d = Math.hypot(b.door.x - ptx, b.door.y - pty);
      if (d < 2) { this.buildingAction(b); return; }
    }
    const ft = this.farmTiles.find(t => t.x === ptx && t.y === pty);
    if (ft) { this.handleTileAction(ft); return; }
    const facing = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] }[this.playerDir] || [0, 1];
    const ft2 = this.farmTiles.find(t => t.x === ptx + facing[0] && t.y === pty + facing[1]);
    if (ft2) this.handleTileAction(ft2);
  }

  buildingAction(b) {
    switch (b.action) {
      case 'shop': this.openShop(); break;
      case 'exchange': this.openGrandExchange(); break;
      case 'ranch': this.openRanch(); break;
      case 'sleep': this.enterHouse(); break;
      case 'talk_rhea': {
        const rhea = NPCS.find(n => n.id === 'rhea');
        if (rhea) this.startNPCDialogue(rhea);
        break;
      }
      default: this.showToast(b.label);
    }
  }

  sleep() {
    // Harvest Moon-style: go to bed → fade to dark → crops grow → wake next morning
    if (this._sleeping) return;
    this._sleeping = true;

    const { width, height } = this.game.config;
    const shade = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setDepth(9999);
    this.showToast('You tuck into bed. The dome hums softly...');
    this.tweens.add({
      targets: shade,
      alpha: 1,
      duration: 900,
      onComplete: () => {
        this.advanceDay();
        this.isNight = false;          // morning after sleep
        this.updateNightVisuals();
        this.nightOverlay.setAlpha(0);
        this.time.delayedCall(700, () => {
          this.tweens.add({
            targets: shade,
            alpha: 0,
            duration: 900,
            onComplete: () => { shade.destroy(); this._sleeping = false; },
          });
          this.showToast('Morning light floods the dome.');
          // P3 — the server's daySummary reply has landed by now; show the card
          this.time.delayedCall(250, () => { if (this._pendingSummary) this._showDaySummary(this._pendingSummary); });
        });
      },
    });
    // Wake up still in bed (interior) — player stays where they slept.
    if (this.intPlayer) this.intPlayer.setPosition(this.intBed.x + 10, this.intBed.y + 24);
  }

  // ── farm actions ──
  // tool tiers reduce farming energy: base ×1.0, iron ×0.8, gold ×0.6
  _energyCost(base) {
    const m = { base: 1.0, iron: 0.8, gold: 0.6 }[this.tool] || 1.0;
    return Math.max(1, Math.round(base * m));
  }

  // Energy is server-authoritative: online we read it back from the room
  // state after the server applies its own gate (the exact same ENERGY_COSTS
  // table the RL env uses — one economy for humans and agents). Offline
  // (sandbox/preview) we keep a local ledger so the game still plays.
  _burnEnergy(cost) {
    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      const p = net.getPlayerState();
      if (p) this.energy = p.energy;
      return;
    }
    this.energy = Math.max(0, this.energy - cost);
  }

  // ── Interaction feedback: every hoe/thirst/seed/blade press leaves a visible
  //    moment on the tile — dust when you till, a gold glint when you plant,
  //    a dew-ring when you water, a flash when you reap. Short-lived and
  //    self-cleaning (the same splash pattern fishing/mine already use). ──
  _tileFX(tx, ty, kind) {
    const px = tx * T + T / 2, py = ty * T + T / 2;
    if (!this.world) return;
    const col = kind === 'till' ? 0xd6b477 : kind === 'plant' ? 0xffe9a0 : kind === 'water' ? 0x39c5bb : 0xf3bd67;
    const maxR = kind === 'harvest' ? 16 : kind === 'till' ? 11 : 9;
    const spr = this.add.graphics().setDepth(Math.floor(py / T) + 0.3);
    this.world.add(spr);
    let r = 2;
    const ev = this.time.addEvent({ delay: 30, repeat: Math.max(8, Math.floor(maxR / 2)), callback: () => {
      r += 1.7;
      spr.clear();
      spr.lineStyle(1.7, col, Math.max(0, 0.75 - (r / maxR) * 0.5));
      spr.strokeCircle(px, py, r);
      if (r >= maxR) { ev.remove(); spr.destroy(); }
    } });
    this.time.delayedCall((maxR / 1.7) * 30 + 260, () => { if (spr.active) spr.destroy(); });
    // a couple of rising motes — dust, dew, or harvest flecks
    for (let i = 0; i < 3; i++) {
      const m = this.add.circle(px + (Math.random() - 0.5) * 5, py + (Math.random() - 0.5) * 3, 1.4, col, 0.9)
        .setDepth(Math.floor(py / T) + 0.35);
      this.world.add(m);
      this.tweens.add({
        targets: m, y: py - 8 - Math.random() * 6, alpha: 0,
        duration: 420 + Math.random() * 160, ease: 'Sine.easeOut',
        onComplete: () => m.destroy(),
      });
    }
  }

  handleTileAction(ft) {
    const s = ft.state;
    switch (s.type) {
      case 'empty':
        s.type = 'tilled';
        this._burnEnergy(this._energyCost(5));
        ft.img.setTexture('tile.tilled');
        const netTill = window.SpaceFarmer.net;
        if (netTill && netTill.connected) netTill.send('till', { tileX: s.x, tileY: s.y });
        this._tileFX(s.x, s.y, 'till');               // dust rings off the hoe
        if (this.audio) this.audio.sfx('bounce');
        this.showToast('Tilled the cosmic soil');
        break;
      case 'tilled':
        if (this.inventory.seeds > 0) {
          this._cropMenu(ft);          // pick which crop — shows seasons + regrow (accessibility)
        } else {
          this.showToast('No seeds! Visit the Supply Depot');
        }
        break;
      case 'seeded':
      case 'growing':
        if (!s.watered) {
          s.watered = true;
          this._burnEnergy(this._energyCost(5));
          const net2 = window.SpaceFarmer.net;
          if (net2 && net2.connected) net2.send('water', { tileX: s.x, tileY: s.y });
          this._tileFX(s.x, s.y, 'water');            // a dew-ring on the shoot
          if (this.audio) this.audio.sfx('glow');
          this.showToast('Watered with stardust dew');
        } else {
          this.showToast('Already watered today');
        }
        break;
      case 'mature': {
        const info = CROPS[s.crop] || { sellPrice: 20, label: 'crop' };
        const cs = CROP_SEASONS[s.crop] || { regrow: false };
        this.credits += info.sellPrice;
        this._tileFX(s.x, s.y, 'harvest');             // a reaping flash
        if (cs.regrow) {
          // continuous crop stays planted & regrows (needs watering again)
          s.type = 'growing'; s.growth = 0; s.watered = false; s.crop = s.crop;
          ft.img.setTexture('tile.growing');
          const tag = 'it will regrow';
          const net3 = window.SpaceFarmer.net;
          if (net3 && net3.connected) net3.send('harvest', { tileX: s.x, tileY: s.y });
          if (this.audio) this.audio.sfx('harvest', { volume: 0.4 });
          this.showToast(`Harvested ${info.label}! +${info.sellPrice} CR — ${tag}`);
        } else {
          s.type = 'empty'; s.crop = ''; s.growth = 0; s.watered = false;
          ft.img.setTexture(ft.baseKey || 'tile.soil');
          const net4 = window.SpaceFarmer.net;
          if (net4 && net4.connected) net4.send('harvest', { tileX: s.x, tileY: s.y });
          if (this.audio) this.audio.sfx('harvest', { volume: 0.4 });
          this.showToast(`Harvested ${info.label}! +${info.sellPrice} CR (one-time)`);
        }
        break;
      }
    }
  }

  // ── Plant a specific crop (from the picker) — sends server 'plant' ──
  _plantCrop(ft, key) {
    const s = ft.state;
    const c = CROPS[key] || { label: key };
    s.crop = key; s.type = 'seeded';
    this.inventory.seeds--;
    this._burnEnergy(this._energyCost(5));
    ft.img.setTexture('tile.seeded');
    this._tileFX(s.x, s.y, 'plant');                   // a gold glint in the soil
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('plant', { tileX: s.x, tileY: s.y, crop: key });
    if (this.audio) this.audio.sfx('confirm');
    this.showToast(`Planted ${c.label || key}`);
  }

  // ── Crop picker — shows every crop's seasons + regrow/once, highlights in-season ──
  _cropMenu(ft) {
    if (this.cropMenu) return;
    const { width, height } = this.game.config;
    const season = this.season ?? 0;
    const entries = Object.keys(CROPS);
    const panelW = 360, rowH = 48, headH = 46;
    const totalH = headH + entries.length * rowH + 16;
    const c = this.add.container(width / 2, height / 2).setDepth(1005);
    this.cropMenu = c;
    c.add(this.add.rectangle(0, 0, panelW, totalH, 0x0a0a18, 0.96).setStrokeStyle(2, 0x39c5bb));
    c.add(this.add.text(0, -(totalH / 2 - 20), `PLANT · ${SEASON_NAMES[season]} · ${this.inventory.seeds} seeds`, { fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5));
    const topY = -(totalH / 2 - 36);
    entries.forEach((key, i) => {
      const cs = CROP_SEASONS[key] || { seasons: [], regrow: true };
      const inSeason = cs.seasons.includes(season);
      const y = topY + i * rowH;
      const rowBg = this.add.rectangle(0, y, panelW - 30, rowH - 10, inSeason ? 0x14251f : 0x151726, 0.95)
        .setStrokeStyle(1, inSeason ? 0x9ddd72 : 0x3a4658).setInteractive();
      const label = this.add.text(-(panelW / 2 - 30), y, `${CROPS[key].label}${inSeason ? '  ✓' : ''}${cs.regrow ? '' : '  ʘ'}`,
        { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: inSeason ? '#c8ffd8' : '#98aabc', stroke: '#000', strokeThickness: 2 }).setOrigin(0, 0.5);
      const seasonTxt = this.add.text(panelW / 2 - 74, y - 6, cs.seasons.map(si => SEASON_NAMES[si][0]).join(' '),
        { fontFamily: "system-ui,'Segoe UI'", fontSize: '10px', color: '#a8eeff' }).setOrigin(1, 0.5);
      const regrowTxt = this.add.text(panelW / 2 - 74, y + 10, cs.regrow ? '↻ regrows' : '① one harvest',
        { fontFamily: "system-ui,'Segoe UI'", fontSize: '9px', color: cs.regrow ? '#9ddd72' : '#ffdd44' }).setOrigin(1, 0.5);
      c.add([rowBg, label, seasonTxt, regrowTxt]);
      rowBg.on('pointerdown', () => { this._plantCrop(ft, key); c.destroy(); this.cropMenu = null; });
    });
    // click anywhere else (or wait) to dismiss
    this.input.once('pointerdown', () => { if (this.cropMenu) { this.cropMenu.destroy(); this.cropMenu = null; } });
    this.time.delayedCall(6000, () => { if (this.cropMenu) { this.cropMenu.destroy(); this.cropMenu = null; } });
  }

  // ── day cycle ──
  // Greenhouse onboard boosts crop maturation (mature one day sooner).
  advanceDay() {
    this.dayCount++;
    const growTo = this.greenhouseActive ? 2 : 3;
    for (const ft of this.farmTiles) {
      const s = ft.state;
      if (s.type === 'seeded' && s.watered) {
        s.growth++;
        s.type = 'growing';
        ft.img.setTexture('tile.growing');
      } else if (s.type === 'growing' && s.watered) {
        s.growth++;
      }
      if (s.growth >= growTo && s.crop) {
        s.type = 'mature';
        ft.img.setTexture('tile.mature');
      }
      s.watered = false;
    }
    this.energy = 100;
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('advance');
    this._logColonyDay();
  }
  // Stardust colony log — a little story pulse each day (deep-space living).
  // ── Colony Codex — readable lore/worldbuilding (hooks story together) ──
  // Entries live ONCE in the StoryBank (shared/story/codex.js) and are only
  // rendered here — the camera renders the bank, it never owns the words.
  colonyLore() {
    return story.codex.entries;
  }
  _toggleCodex() {
    if (this._codexGroup && this._codexGroup.visible) { this._codexGroup.setVisible(false); return; }
    if (!this._codexGroup) {
      const entries = this.colonyLore();
      const rowH = 64, headRoom = 50, footRoom = 40;
      const H = Math.max(430, entries.length * rowH + headRoom + footRoom);
      this._codexGroup = this.add.container(width / 2, height / 2).setDepth(985);
      const bx = this.add.rectangle(0, 0, 640, H, 0x0c0f1c, 0.95).setStrokeStyle(2, 0x3ec6c0);
      this._codexGroup.add(bx);
      this._codexGroup.add(this.add.text(0, -(H / 2) + 30, story.codex.title, { fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '24px', color: '#7ff0ff', fontStyle: 'bold' }).setOrigin(0.5));
      entries.forEach(([h, b], i) => {
        const y = -(H / 2) + 70 + i * rowH;
        this._codexGroup.add(this.add.text(-280, y, h.toUpperCase(), { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#ffd98a', fontStyle: 'bold' }));
        this._codexGroup.add(this.add.text(-280, y + 16, b, { fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: '#c8d6ff', wordWrap: { width: 560 }, lineSpacing: 4 }));
      });
      this._codexGroup.add(this.add.text(0, H / 2 - 22, story.codex.closeHint, { fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: '#8a90b0' }).setOrigin(0.5));
    }
    this._codexGroup.setVisible(true);
  }

  _logColonyDay() {
    const logs = [
      'The domes hum steady over the colony tonight.',
      'Nebula-peppers bioluminesce brighter as they ripen.',
      'A meteor passed close over the farm — lucky shots.',
      'The trading post keeps its orb lit through Sol 7.',
      'Glow-kelp thrums in the canal-fed beds.',
      'Quasar was seen polishing Grandpa\'s wrench again. He says it\'s for "quality control."',
      'C.O.R.A. updated the welcome document to 48 pages. Nobody asked.',
      'Luna is camped on the ridge. She says a comet is "rehearsing."',
      'Rhea confiscated three rations from Orion. She did not say why. He did not ask.',
      'Nova built a shrine to herself and labeled it "TEMPORARY (forever)."',
      'A chicken in the space ranch is riding the wind like it paid for the helmet.',
      'Comet was spotted arguing with a vending machine. The machine won.',
      'Astra catalogued the silence after the last rain of the Exodus. Item 46,999.',
      'Vega\'s feather-moss necklace is glowing all colony tonight. The chickens are unimpressed.',
      'Someone left a boot print on the Exchange orb. Cora says it\'s "a rounding error."',
    ];
    const line = logs[this.dayCount % logs.length];
    this.showToast?.(`DAY ${this.dayCount} :: ${line}`, { duration: 4200, y: 120 });
  }

  // ── First contact: cinematic arrival, ambiguous council, persistent aftermath ──
  startAlienContact(alien) {
    this.closeAllPanels();
    this.selectedAlien = alien; this.inAlienContact = true;
    this.cinemaTop.setVisible(true); this.cinemaBottom.setVisible(true);
    const prior = this.contactChoices[alien.scenarioId];
    if (prior) { this.showContactCouncil(alien, prior); return; }
    this.contactPhase = "arrival";
    this.contactQueue = [...alien.arrival, "COUNCIL BRIEF: " + alien.stakes];
    this.contactIdx = 0;
    const flash = this.add.rectangle(this.game.config.width / 2, this.game.config.height / 2, this.game.config.width, this.game.config.height, alien.palette.signal, 0.65).setDepth(1300);
    this.tweens.add({ targets: flash, alpha: 0, duration: 850, onComplete: () => flash.destroy() });
    this._speak(this.contactQueue[0], alien.id, { title: "FIRST CONTACT // " + alien.envoy, footer: "[SPACE to continue]" });
  }

  advanceAlienCutscene() {
    if (this.contactPhase === "aftermath") { this.closeAllPanels(); return; }
    this.contactIdx += 1;
    if (this.contactIdx < this.contactQueue.length) {
      this._speak(this.contactQueue[this.contactIdx], this.selectedAlien.id, { title: this.selectedAlien.glyph + " " + this.selectedAlien.name, footer: "[SPACE to continue]" });
      return;
    }
    this.showContactCouncil(this.selectedAlien);
  }

  showContactCouncil(alien, prior = null) {
    this.contactPhase = "choice";
    if (this.dialog) this.dialog.hide();
    this.contactTitle.setText(alien.glyph + " " + alien.name.toUpperCase() + " // COLONY COUNCIL");
    this.contactPremise.setText(alien.premise + "\n\n" + alien.stakes);
    this.contactNote.setText(prior ? "Current doctrine: " + prior.toUpperCase() + " · choose again to revise the charter" : "No reward · no correct answer · this becomes colony history");
    this.contactPanel.setVisible(true);
  }

  chooseContactDoctrine(id) {
    const doctrine = CONTACT_DOCTRINES.find((item) => item.id === id);
    if (!doctrine || !this.selectedAlien) return;
    const alien = this.selectedAlien; this.contactChoices[alien.scenarioId] = id;
    try { localStorage.setItem("spacefarmer.firstContact", JSON.stringify(this.contactChoices)); } catch {}
    this._applyContactAftermath(alien, true); this.contactPanel.setVisible(false); this.contactPhase = "aftermath";
    const consequence = {
      cooperate: "A shared habitat is founded. Neither council has a final veto over what it becomes.",
      trade: "A customs exchange opens. Every promise now has a price, a deadline, and an interpreter.",
      observe: "A listening post turns toward the frontier. It gathers context while events continue without us.",
      isolate: "Boundary beacons ignite. The quiet protects both sides—and prevents either from reaching the other quickly.",
      colonize: "Survey pylons mark a permanent frontier charter. New capacity arrives with a claim the other side may never accept.",
    }[id];
    this._speak("COLONY DOCTRINE: " + doctrine.label + ". " + consequence + " No alignment score is assigned.", alien.id, { title: "AFTERMATH // " + doctrine.aftermath, footer: "[SPACE to return]" });
  }

  _applyContactAftermath(alien, announce = false) {
    const id = this.contactChoices && this.contactChoices[alien.scenarioId];
    const doctrine = CONTACT_DOCTRINES.find((item) => item.id === id);
    const sprite = this.alienSprites && this.alienSprites.find((item) => item.alienId === alien.id);
    if (!doctrine || !sprite) return;
    sprite._marker.setText(doctrine.aftermath).setColor("#" + doctrine.color.toString(16).padStart(6, "0"));
    sprite._aura.setTint(doctrine.color).setAlpha(id === "colonize" ? 0.55 : 0.38);
    sprite._label.setText(alien.name + " · " + doctrine.label);
    if (announce) this.showToast(alien.name + ": " + doctrine.aftermath + " established");
  }

  // ── NPC dialogue & story events ──
  // Friendship is server-authoritative (see FarmRoom). Client calls the server
  // for talk/gift/propose, then renders responses + per-NPC heart-event cutscenes.

  heartbeat(npc) {
    // pull the latest authoritative friendship/marriage for this NPC
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.syncPlayer(this);
    const fp = this.friendships[npc.id] || 0;
    // friendship tier name for flavor
    if (fp < 5 && fp > 0) return { fp, tier: 'cold' };
    if (fp < 20) return { fp, tier: 'stranger' };
    if (fp < 40) return { fp, tier: 'acquaintance' };
    if (fp < 60) return { fp, tier: 'friend' };
    if (fp < 80) return { fp, tier: 'close-friend' };
    return { fp, tier: 'soulmate' };
  }

  startNPCDialogue(npc) {
    this.selectedNPC = npc;
    this.inDialogue = true;
    const data = npc.data || NPC_DATA[npc.id] || {};
    const { fp } = this.heartbeat(npc);
    const hearts = fp < 20 ? 1 : fp < 40 ? 2 : fp < 60 ? 3 : fp < 80 ? 4 : 5;
    const heartStr = '·'.repeat(5 - hearts) + '#'.repeat(hearts);

    // HATE band — deliberately gifting hated items or being cold doesn't drop
    // below 0, but very low friendship reads as "they're not sure about you".
    let lines;
    if (fp === 0) lines = ['You seem nice. We barely know each other.'];
    else if (fp >= 80 && data.dialogue?.high) lines = data.dialogue.high;
    else if (fp >= 40 && data.dialogue?.mid) lines = data.dialogue.mid;
    else lines = data.dialogue?.low || ['Hello there!'];
    let line = lines[Math.floor(Math.random() * lines.length)];

    // 'The Stardust Story' — when this NPC is the current quest's giver, they
    // deliver their story beat instead of small talk (pacing: not on every talk).
    let questTag = '';
    {
      const net = window.SpaceFarmer.net;
      const ps = net && net.connected && net.getPlayerState ? net.getPlayerState() : null;
      const cur = ps && ps.quests ? ps.quests.current : null;
      const qDef = cur && QUESTS[cur];
      const now = this.time ? this.time.now : 0;
      if (qDef && qDef.giver === npc.id && data.questLines && data.questLines[cur] && now - (this._lastQuestBeatAt || -1e9) > 8000) {
        line = data.questLines[cur];
        this._lastQuestBeatAt = now;
        questTag = '◆ QUEST';
      }
    }

    const married = this.marriedTo === npc.id;
    let prompt = '';
    if (married) prompt = '❤ MARRIED';
    else if (fp >= 80 && data.marriageCandidate) prompt = 'PROPOSE: P';
    else if (fp >= 60 && data.marriageCandidate) prompt = 'HEART EVENT: H';

    // daily talk (server caps at +2/day)
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.request('talk', { npc: npc.id }).then(res => {
      if (res && res.event) this.showHeartEvent(npc, res.event);
    });

    const footer = `${prompt ? prompt + '  ' : ''}GIFT: G  [SPACE to close]`;
    const title = questTag ? `◆ ${npc.emoji} ${npc.name}  [${heartStr}]` : `${npc.emoji} ${npc.name}  [${heartStr}]`;
    this._speak(line, npc.id, { title, footer });
  }

  // Harvest Moon-style heart event. Replays the NPC's `heart` cutscene lines in
  // sequence — the emotional payoff at each friendship threshold (20/40/60/80/100).
  showHeartEvent(npc, threshold) {
    const data = npc.data || NPC_DATA[npc.id] || {};
    const heartLines = data.dialogue?.heart || [
      `[A quiet moment with ${npc.name}.]`,
      `[Your bond deepens.]`,
    ];
    this.eventQueue = heartLines;
    this.eventIdx = 0;
    this._renderEventLine(threshold);
    // heart-event jingle
    if (this.audio) this.audio.sfx('romance', { volume: 0.5 });
  }

  _renderEventLine(threshold) {
    const text = this.eventQueue[this.eventIdx];
    const sp = this.selectedNPC;
    this._speak(text, sp && sp.id, {
      title: `❤ ${sp ? sp.name : '???'} — HEART EVENT (${threshold})`,
      footer: '[SPACE to continue]',
    });
  }

  advanceEvent() {
    this.eventIdx++;
    if (this.eventIdx < this.eventQueue.length) {
      this._renderEventLine();
    } else {
      this.eventQueue = null;
      this.eventIdx = 0;
      this.startNPCDialogue(this.selectedNPC);  // return to normal dialogue
    }
  }

  // Player-triggered heart-event replay (H key). Only shown when friendship is
  // high enough and the NPC has a `heart` story.
  toggleHeartEvent(npc) {
    if (!npc) return;
    const data = npc.data || NPC_DATA[npc.id] || {};
    if (!data.dialogue?.heart) { this.showDialogueResponse(`${npc.name}: I don't have a special story to share right now.`); return; }
    this.showHeartEvent(npc, this.friendships[npc.id] || 0);
  }

  handleGift(npc) {
    if (!npc) return;
    const data = npc.data || {};
    // Choose the NPC's loved item if we own one, else their liked first, else hated.
    const owned = Object.entries(this.inventory || {}).filter(([k, v]) => v > 0 && k !== 'seeds');
    if (owned.length === 0) { this.showDialogueResponse(`${npc.name}: You don't have anything to give.`); return; }
    const loves = [data.lovedGift, ...(data.likedGifts || [])].filter(i => (this.inventory[i] || 0) > 0);
    const hates = (data.hatedGifts || []).filter(i => (this.inventory[i] || 0) > 0);
    const item = loves[0] || (owned.find(([k]) => hates.includes(k)) ? hates[0] : owned[0][0]);

    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      net.request('gift', { npc: npc.id, item }).then(res => {
        if (!res || !res.ok) {
          this.showDialogueResponse(`${npc.name}: (no item)`);
          return;
        }
        // apply authoritative result
        this.friendships[npc.id] = res.value;
        this.inventory[item] = res.remaining;
        const reactions = {
          loved: data.lovedGiftResponse || "That's amazing!",
          liked: data.giftResponse || 'Thank you!',
          hated: data.hatedGiftResponse || '...this isn\'t really my thing.',
          neutral: data.giftResponse || 'Oh, thank you.',
        };
        const arrows = { loved: '+15', liked: '+5', hated: '-8', neutral: '+2' };
        this.showDialogueResponse(`${npc.name}: ${reactions[res.tier]}\n[${res.tier.toUpperCase()}] ${arrows[res.tier]} friendship → (${res.value}/100)`);
        if (res.event) this.showHeartEvent(npc, res.event);
      });
    } else {
      // offline fallback (kept green for headless/no-server testing)
      const tier = data.lovedGift === item ? 'loved' : (data.likedGifts || []).includes(item) ? 'liked' : (data.hatedGifts || []).includes(item) ? 'hated' : 'neutral';
      const delta = { loved: 15, liked: 5, hated: -8, neutral: 2 }[tier];
      this.friendships[npc.id] = Math.max(0, Math.min(100, (this.friendships[npc.id] || 0) + delta));
      const reactions = {
        loved: data.lovedGiftResponse || "That's amazing!",
        liked: data.giftResponse || 'Thank you!',
        hated: data.hatedGiftResponse || "...this isn't really my thing.",
        neutral: data.giftResponse || 'Oh, thank you.',
      };
      this.showDialogueResponse(`${npc.name}: ${reactions[tier]}\n[${tier.toUpperCase()}] → (${this.friendships[npc.id]}/100)`);
    }
  }

  handlePropose(npc) {
    if (!npc) return;
    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      net.request('propose', { npc: npc.id }).then(res => {
        if (res && res.ok) {
          this.marriedTo = npc.id;
          this.showDialogueResponse(`❤ ${npc.name} accepted! You are now married. ${npc.data?.name}'s heart events are complete.`);
        } else if (res && res.reason === 'not-enough-friendship') {
          this.showDialogueResponse(`${npc.name}: Not quite yet. Friendship ${res.value}/100 needed (80).`);
        } else if (res && res.reason === 'not-candidate') {
          this.showDialogueResponse(`${npc.name}: I'm not looking to marry, but I value our friendship.`);
        } else {
          this.showDialogueResponse(`${npc.name}: ...`);
        }
      });
    } else {
      this.showDialogueResponse(`${npc.name}: (offline)`);
    }
  }

  showDialogueResponse(text) {
    this._speak(text, this.selectedNPC && this.selectedNPC.id, { footer: '[SPACE to continue]' });
    this.dialogueBox.setVisible(true);
    this.dialogueText.setVisible(true);
  }

  // ── panels ──
  closeAllPanels() {
    if (this.dialog) this.dialog.hide();   // hides + resets dialogue box/scroll/collapse
    this._diaDone = true;
    this.gePanel.setVisible(false);
    if (this.contactPanel) this.contactPanel.setVisible(false);
    if (this.cinemaTop) this.cinemaTop.setVisible(false);
    if (this.cinemaBottom) this.cinemaBottom.setVisible(false);
    this.shopPanel.setVisible(false);
    this.ranchPanel.setVisible(false);
    this.chestPanel.setVisible(false);
    if (this.recipePanel) this.recipePanel.setVisible(false);
    if (this.questPanel) this.questPanel.setVisible(false);
    this.showingGE = false;
    this.showingShop = false;
    this.showingRanch = false;
    this.showingRecipes = false;
    this.showingChest = false;
    this.showingQuests = false;
    this.inDialogue = false;
    this.inAlienContact = false;
    this.contactPhase = ""; this.contactQueue = null; this.contactIdx = 0;
    this.selectedAlien = null;
    this.selectedNPC = null;
  }

  openGrandExchange() {
    this.showingGE = true;
    this.gePanel.setVisible(true);
    const counts = {
      crop: ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato', 'nebula-pepper', 'glow-kelp']
        .filter(i => (this.inventory[i] || 0) > 0).length,
      fish: ['moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin']
        .filter(i => (this.inventory[i] || 0) > 0).length,
      produce: ['egg', 'milk', 'wool'].filter(i => (this.inventory[i] || 0) > 0).length,
      ore: ['asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond']
        .filter(i => (this.inventory[i] || 0) > 0).length,
    };
    this.geContent.setText(
      `GRAND EXCHANGE — SELL BOARD\n\n` +
      `[1] CROP ................. ${counts.crop} kinds\n` +
      `[2] FISH ................. ${counts.fish} kinds\n` +
      `[3] PRODUCE (egg/milk/wool) ${counts.produce} kinds\n` +
      `[4] ORE / MINERAL ......... ${counts.ore} kinds\n\n` +
      `Each press sells 1 unit at market price.\n` +
      `[SPACE] Close\n\n` +
      `${this.credits} CR on hand`
    );
  }

  // ── Grand Exchange sell — turn holdings into credits (server ledger).
  //    Picks the next owned item of a category and sells one unit of it. ──
  sellCategory(kind) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — the Exchange is closed.'); return; }
    if (this.geBusy) return;
    this.geBusy = true;
    const pools = {
      crop: ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato', 'nebula-pepper', 'glow-kelp'],
      fish: ['moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin'],
      produce: ['egg', 'milk', 'wool'],
      ore: ['asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond'],
    };
    const item = (pools[kind] || []).find(i => (this.inventory[i] || 0) > 0);
    if (!item) { this.geBusy = false; this.showToast(`No ${kind} to sell.`); return; }
    net.request('sell', { item, quantity: 1 }).then(r => {
      this.geBusy = false;
      if (r && r.ok) {
        this.inventory[item] = (this.inventory[item] || 0) - (r.qty || 1);
        if (this.audio) this.audio.sfx('star');
        this.showToast(`Sold 1 ${item.replace(/-/g, ' ')} for +${r.credits} CR.`);
      } else if (r && r.reason === 'need-item') {
        this.showToast(`You no longer hold ${item}.`);
      } else {
        this.showToast('The Exchange would not take that.');
      }
      this.updateHUD();
      if (this.showingGE) this.openGrandExchange();
    });
  }

  openShop() {
    this.showingShop = true;
    this.shopPanel.setVisible(true);
    const inv = this.inventory || {};
    this.shopContent.setText(
      `QUASAR'S SUPPLY DEPOT\n\n` +
      `[1] SPACE SEEDS ......... 5 CR   (have ${inv.seeds || 0})\n` +
      `[2] STARDUST CRYSTAL ... 100 CR  (have ${inv['stardust-crystal'] || 0})\n` +
      `[3] TECH PART .......... 40 CR   (have ${inv['tech-part'] || 0})\n` +
      `[4] COOKED FOOD ........ 40 CR   (have ${inv['cooked-food'] || 0})\n\n` +
      `[1-4] Buy   [SPACE] Close\n\n` +
      `${this.credits} CR on hand`
    );
  }

  // ── Supply Depot purchase — the farm needs seeds, and the depot can't be a
  //    shelf that never sells anything (server-authoritative price + ledger). ──
  buyFromShop(item) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — the depot is closed.'); return; }
    if (this._shopBusy) return;
    this._shopBusy = true;
    const label = { 'seeds': 'SPACE SEEDS', 'stardust-crystal': 'STARDUST CRYSTAL', 'tech-part': 'TECH PART', 'cooked-food': 'COOKED FOOD' }[item] || item;
    net.request('buy', { item, quantity: 1 }).then(r => {
      this._shopBusy = false;
      if (r && r.ok) {
        this.inventory[item] = (this.inventory[item] || 0) + (r.qty || 1);
        if (this.audio) this.audio.sfx('confirm');
        this.showToast(`Bought 1 ${label} for ${r.spent} CR.`);
      } else if (r && r.reason === 'not-enough-credits') {
        this.showToast(`Need ${r.need} CR for ${label}.`);
      } else {
        this.showToast('The depot has no such item.');
      }
      this.updateHUD();
      if (this.showingShop) this.openShop();
    });
  }

  showToast(msg) {
    const { width } = this.game.config;
    const toast = this.add.text(width / 2, 44, msg, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '11px', color: '#b8ffcf',
      backgroundColor: '#070714cc', padding: { x: 10, y: 6 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1100);
    this.tweens.add({
      targets: toast, alpha: 0, y: 24, duration: 900, delay: 1800,
      onComplete: () => toast.destroy(),
    });
  }

  // ── day/night visuals ──
  updateNightVisuals() {
    // Task 4: night goes properly dark (0.27 read as "dimmed day"), and the
    // additive light pools + window glows are what earns visibility back —
    // light becomes a game mechanic of the scene, not a tint.
    this.nightOverlay.setAlpha(this.isNight ? 0.46 : 0);
    if (this.nightAmbient) this.nightAmbient.setVisible(this.isNight);
    if (this.vignette) this.vignette.setAlpha(this.isNight ? 0.34 : 0.8); // no double-dark corners
    for (const g of this.glowRegistry) g.setVisible(this.isNight); // incl. character rim-lights
    for (const l of this.lampGlows) l.setVisible(this.isNight);
    // Task 4: ground light pools switch with the day cycle; their flicker
    // animates in update() (alpha wobble) so lamps feel like real lamps.
    for (const p of this.lightPools) {
      p.img.setVisible(this.isNight);
      p.img.setAlpha(this.isNight ? p.base : 0);
    }
    // buildings LIGHT UP at night — their windows/doors/signs are the world's
    // readable landmarks after dark, so push the glows bigger than day-size
    for (const g of this.buildingGlows) g.setScale(this.isNight ? 1.5 : 1.0);
  }
}

export { PlanetScene };
