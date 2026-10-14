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
import { ColonyHub } from '../systems/ColonyHub.js';
import { DialoguePanel } from '../systems/DialoguePanel.js';
import { preloadPainted, paintedPortrait, paintedBackdrop, SEASON_PLATES } from '../systems/PaintedArt.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { reducedMotion, setReducedMotion } from '../systems/Motion.js';
import { questView, questChip, QUESTS, QUEST_ORDER, rewardLine } from '../systems/QuestSystem.js';
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
const FENCE_BEAM_INSET = 8;    // px gap kept clear on each side of every fence post (SF07)
const FENCE_BEAM_ALPHA = 0.55; // laser strands stay subtle, never a solid stroke (SF07)
const ZOOM = 1;
// [SF46] gift tier → portrait expression frame (port.<id>_3 warm, _4 troubled)
const GIFT_FACE = { loved: 3, hated: 4 };

// [SF29] SEASON_GRADE — tint grades that make the four seasons visibly differ.
// SPRING neutral (ground textures speak for themselves), SUMMER golden sun,
// FALL amber leaf-turn, WINTER cool silver-blue frost. Applied ONLY to ground
// tiles and natural decor (trees/bushes/flora); water tiles and tech props
// (lamps, solar, antennas) stay untinted so glow effects keep their hue.
// [SF41] SKY_GRADE — season tint for the painterly sky (`fx.sky_dusk`) and the
// deep-space planet sprites: SPRING neutral white, SUMMER warm gold, FALL warm
// amber (r > b), WINTER cool silver-blue (b > r). Tinted in applySeasonGrade.
const SKY_GRADE = [0xffffff, 0xffe9c0, 0xffc8a0, 0xc8d8f8];
const SEASON_GRADE = [
  { ground: 0xffffff, flora: 0xffffff },   // SPRING
  { ground: 0xfff2c8, flora: 0xfff0b0 },   // SUMMER (warm gold)
  { ground: 0xffd6a8, flora: 0xffb878 },   // FALL (amber; r > b)
  { ground: 0xd8e4f4, flora: 0xc8d8ee },   // WINTER (cool silver; b > r)
];

// [SF35] SEASON_HAZE — one soft additive atmosphere tint per season so the
// sky reads as living weather, not a static backdrop. Alpha stays ≤ 0.10
// (quiet wash; the world must stay readable underneath).
const SEASON_HAZE = [
  { color: 0x9fe8c0, alpha: 0.06 },   // SPRING (pale spring-green)
  { color: 0xffd68a, alpha: 0.08 },   // SUMMER (sun-warm amber)
  { color: 0xff9e5e, alpha: 0.09 },   // FALL (autumn orange)
  { color: 0xcfe0ff, alpha: 0.10 },   // WINTER (cold pale-blue)
];

// ── The colony tool kit (client mirror of the server's TOOL_DEFS) ──
// The server owns the economy (equip/upgrade tiers/tank); the browser only
// names tools and shows the tier the server granted.
const CLIENT_TOOLS = {
  hoe:      { label: 'Hoe' },
  watering: { label: 'Watering Can' },
  pickaxe:  { label: 'Pickaxe' },
  rod:      { label: 'Fishing Rod' },
};
const TOOL_TIER_NAME = { base: 'Basic', iron: 'Iron', gold: 'Gold' };
// smithy upgrade ladder (mirror of server TOOL_DEFS.upgradeCost): next[i] is the
// CR cost to go base→iron, iron→gold. The server owns the credits; this table
// only lets the smithy screen show prices without a round-trip.
const SMITHY_TOOLS = {
  hoe:      { label: 'Hoe',          next: [150, 400] },
  watering: { label: 'Watering Can', next: [200, 500] },
  pickaxe:  { label: 'Pickaxe',       next: [180, 450] },
  rod:      { label: 'Fishing Rod',   next: [120, 350] },
};
const TIER_TO_NEXT = { base: 'iron', iron: 'gold', gold: null };
const WATER_TANK_MAX = 100;          // mirror of server WATER_TANK_MAX (base tier)
// tank capacity by can tier — mirror of server TANK_MAX_FOR (100 → 160 → 240)
const TANK_MAX_FOR = { base: 100, iron: 160, gold: 240 };
const WATER_USE_COST = 20;           // mirror of server WATER_USE_COST (per water action)
const FILL_SPOT = { x: 27, y: 22 }; // the shore tap — refill the can here

// [SF38] Mood tiers for the dialogue portrait plate — heart level decides how
// warm the colony's friendships read on the box: a stranger's plate stays cool
// slate, acquaintances tint teal, friends amber, soulmates rose.
const MOOD_TIERS = [
  { min: 0, color: 0x3a4656 }, // 0–1 hearts  cool slate
  { min: 2, color: 0x67e1cd }, // 2–4 hearts  colony teal
  { min: 5, color: 0xf7d698 }, // 5–7 hearts  amber warmth
  { min: 8, color: 0xff9ec4 }, // 8+ hearts   rose soulmate
];
const moodTierFor = (h) => {
  let tier = MOOD_TIERS[0];
  for (const t of MOOD_TIERS) if (h >= t.min) tier = t;
  return tier;
};
const moodHeartsFor = (fp) => fp === 0 ? 0 : fp < 20 ? 1 : fp < 40 ? 3 : fp < 60 ? 5 : fp < 80 ? 7 : 9;

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
// ── SF08 — lamp ground light pools: three concentric amber discs under every
// lamp, additive-blended so they brighten the grass without occluding it.
// Only visible at night (they live in lightPools → updateNightVisuals).
const POOL_RINGS = [
  { scale: 2.0, alpha: 0.12 },
  { scale: 1.3, alpha: 0.07 },
  { scale: 0.7, alpha: 0.04 },
];
const FEST_GUESTS = [                                // festival crowd (one sprite per guest)
  { tex: 'nova', x: 22, y: 13 }, { tex: 'luna', x: 24, y: 13 },
  { tex: 'vega', x: 26, y: 13 }, { tex: 'astra', x: 23, y: 14 },
  { tex: 'comet', x: 25, y: 14 }, { tex: 'rhea', x: 22, y: 15 },
  { tex: 'cora', x: 27, y: 15 },
];
const EARTH_PALETTE = [0x2e7d4f, 0xf5f0e6, 0xc0392b]; // green / white / red

// ── SF22 — quest objective targets ──
// Every objective kind used in QUESTS maps to ONE concrete in-world target.
// NPC objectives are resolved live from the NPC's errand-brain position (see
// _questTarget); everything else points at a building door tile or a zone
// centre — the same spots PlanetScene already interacts at (FILL_SPOT shore,
// MINE_SPOT vein, festival plaza, building doors from MapData.BUILDINGS).
const QUEST_ZONES = (() => {
  const doorOf = (act) => {
    const b = BUILDINGS.find(bb => bb.action === act);
    return b && b.door ? { x: b.door.x, y: b.door.y } : null;
  };
  return {
    fish:       { ...(FILL_SPOT),         hint: 'FISH THE STARDUST SHORE' },
    sell:       { ...(doorOf('exchange')  || { x: 38, y: 32 }), hint: 'SELL AT THE GRAND EXCHANGE' },
    mine:       { ...(MINE_SPOT),         hint: 'MINE THE VEIN' },
    tool:       { ...(doorOf('shop')      || { x: 18, y: 32 }), hint: 'VISIT THE SUPPLY DEPOT' },
    cook:       { ...(doorOf('sleep')     || { x: 18, y: 44 }), hint: 'COOK IN THE HOME' },
    gift:       { ...(doorOf('talk_rhea') || { x: 28, y: 32 }), hint: 'GIVE A DISH AT THE TAVERN' },
    friendship: { ...(doorOf('talk_rhea') || { x: 28, y: 32 }), hint: 'BEFRIEND AT THE TAVERN' },
    animal:     { ...(doorOf('ranch')     || { x: 5,  y: 8 }),  hint: 'VISIT THE RANCH' },
    feed:       { ...(doorOf('ranch')     || { x: 5,  y: 8 }),  hint: 'FEED AT THE RANCH' },
    festival:   { ...(FEST_PLAZA),        hint: 'ATTEND THE PLAZA' },
  };
})();

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

import { tex, texAt, resolveKey } from '../systems/AssetTheme.js';

// ground variant name → texture key (resolved through the active theme)
// entries accept optional (x,y) so a role can carry per-position variation.
const GROUND_TEX = {
  grass_a: () => texAt('ground.grass', 0), grass_b: () => texAt('ground.grass', 1),
  grass_c: () => texAt('ground.grass', 2), grass_d: () => texAt('ground.grass', 3),
  grass_e: () => texAt('ground.grass', 4), grass_f: () => texAt('ground.grass', 5),
  path: () => tex('ground.path'), plaza: (x = 0, y = 0) => texAt('ground.plazaDeck', (y % 4) * 4 + (x % 4)),
  // water picks one of 3 caustic families per tile position (stable hash) so a
  // still frame already shows structure instead of a flat cyan slab
  water: (x = 0, y = 0) => texAt('ground.water', (x * 3 + y * 7) % 3),
  sand: () => tex('ground.sand'),
  wet_sand: () => tex('ground.wetSand'),
  cliff: () => tex('ground.cliff'),
  forest: () => tex('ground.forest'),
  // QA 0904B.9: soil picks an UNTILLED variant per tile position (stable coord
  // hash) so the farm block reads as textured worked earth — never one flat
  // rust slab. Both semantic keys ('soil', 'soil_b') use the same family with
  // different hash phases so neighbours alternate their ridge rows.
  soil: (x = 0, y = 0) => texAt('ground.soil', (x * 3 + y * 7) % 4),
  soil_b: (x = 0, y = 0) => texAt('ground.soil', (x * 5 + y * 11) % 4),
};
// farm state → tile key (overrides ground once farmed). 'empty' resolves the
// same untilled-variant family the ground grid started with (QA 0904B.9), so
// a worked tile reverting to bare earth keeps its ridge texture; farm.empty
// stays a single plain-soil key for the ship-interior plot in SpaceshipScene.
const TILE_FOR_STATE = {
  empty: (x = 0, y = 0) => texAt('ground.soil', (x * 3 + y * 7) % 4),
  tilled: () => tex('farm.tilled'),
  seeded: () => tex('farm.seeded'), growing: () => tex('farm.growing'),
  mature: () => tex('farm.mature'),
};

class PlanetScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PlanetScene' });
  }

  preload() {
    AudioSystem.preload(this);
    preloadPainted(this);   // ART-06 painted portraits + backdrops (optional)
  }

  init(data) {
    // SF19: credits are server-authoritative. Never seed them from scene data
    // (the ship's 500 cr was spent on descent fuel); show '—' until first sync.
    this.credits = null;
    this.energy = 100;
    this.staminaMax = 100;   // stamina ceiling — grows as you condition yourself
    this.tool = 'base';      // hoe tier (legacy alias for toolTiers.hoe)
    this.equipped = '';      // '' (hands) | 'hoe' | 'watering' | 'pickaxe' | 'rod'
    this.toolTiers = {};     // toolId → tier ('base'|'iron'|'gold')
    this.waterLevel = WATER_TANK_MAX;  // watering-can tank (server-authoritative)
    this.dayCount = 1;
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
    // SF33: contact doctrines are SERVER-authoritative while connected
    // (FarmRoom persists player.contactChoices). localStorage is only an
    // OFFLINE fallback, so a stale browser can never show an aftermath the
    // colony never chose — or disagree with another browser.
    this.contactChoices = {};
    this._loadOfflineContacts();
    this.showingGE = false;
    this.showingShop = false;
    this.showingRecipes = false;
    this._recipeSel = 0;
    this.showingQuests = false;
    this.showingBackpack = false;
    this.showingSmithy = false;
    // SF62 'Season Reckoning' — the season's-end screen starts closed
    this.showingReckoning = false;
    this._reckSeq = 0;    // SF62 — token for queued reckonings
    // SF51 'Companion Corridor' — the live agent day screen starts closed
    this.showingCorridor = false;
    this._prevQuestId = null;    // last-seen current quest → drives the "quest complete" banner
    this._arcDoneFired = false;  // ending banner fires once
    this.playerDir = 'front';
    // SF20: which input family the player is on — the touch bar says "A" where
    // the keyboard says "SPACE" in the context prompt chip.
    this.touchMode = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    // SF17: once the player has ever landed on the planet, remember it so the
    // intro title can offer a straight "CONTINUE — SPACE" back to the farm.
    try { localStorage.setItem('sf_landed', '1'); } catch {}
  }

  create() {
    const { width, height } = this.game.config;
    const worldX = (width - VW) / 2, worldY = (height - VH) / 2;
    // [SF28] undefined until the first season sync lands — that first sync
    // must stay silent, only LATER season changes raise the banner.
    this._shownSeason = undefined;

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
        const gKey = (GROUND_TEX[g] || GROUND_TEX.grass_a)(x, y);
        const img = this.add.image(x * T + T / 2, y * T + T / 2, gKey);
        if (g === 'soil' || g === 'soil_b') {
          this.farmTiles.push({
            img, x, y, baseKey: gKey,
            state: { x, y, type: 'empty', crop: '', growth: 0, watered: false },
          });
        } else if (g === 'water') {
          // carry the caustic family so the shimmer animates WITHOUT flattening
          // the per-position variety (each family shimmers on its own offset)
          this.waterTiles.push({ img, f: (x * 3 + y * 7) % 3 });
          this.tiles.push(img);
        } else {
          this.tiles.push(img);
        }
        this.world.add(img);
      }
    }

    // QA 0904B.9: packed sand/slate BORDER RING — soil tiles that touch grass
    // get a rim band so the farm edge feathers into worked earth instead of
    // ending at a razor seam (transparent core keeps the soil texture).
    const soilEdgeKey = resolveKey('ground.soilEdge');
    this.soilEdges = [];
    for (let ey = 0; ey < MAP_H; ey++) {
      for (let ex = 0; ex < MAP_W; ex++) {
        const eg = ground[ey][ex];
        if (eg !== 'soil' && eg !== 'soil_b') continue;
        let edge = false;
        for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = ex + dir[0], ny = ey + dir[1];
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) { edge = true; break; }
          const ng = ground[ny][nx];
          if (ng !== 'soil' && ng !== 'soil_b') { edge = true; break; }
        }
        if (!edge) continue;
        const eImg = this.add.image(ex * T + T / 2, ey * T + T / 2, soilEdgeKey).setDepth(0.02);
        this.world.add(eImg);
        this.soilEdges.push(eImg);
      }
    }

    // Raised agri-decks unify the farm tiles into two intentional fields.
    // This is presentation-only: the simulation and its 8x8 RL farm state
    // keep exactly the same coordinates and semantics.
    // QA 0904B.12: the rects/furrows/labels used to be hardcoded tile coords
    // (rows 16..29) — when FARM moved to rows 4..15 the overlay orphaned over
    // empty grass and read as floating CAD wireframes. Geometry is now DERIVED
    // from the ground grid (MapData ground = the single source of truth), so a
    // future farm relocation can never desync it again.
    const soilAt = (x, y) => ground[y][x] === 'soil' || ground[y][x] === 'soil_b';
    let sbx0 = 1e9, sby0 = 1e9, sbx1 = -1e9, sby1 = -1e9;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!soilAt(x, y)) continue;
        if (x < sbx0) sbx0 = x; if (y < sby0) sby0 = y;
        if (x > sbx1) sbx1 = x; if (y > sby1) sby1 = y;
      }
    }
    // Split into two decks at an interior non-soil column (a gate path cuts
    // the field), else at the midpoint so the pair always tiles over soil.
    let splitX = -1;
    for (let x = sbx0 + 2; x <= sbx1 - 2; x++) {
      let hasSoil = false;
      for (let y = sby0; y <= sby1; y++) if (soilAt(x, y)) { hasSoil = true; break; }
      if (!hasSoil) { splitX = x; break; }
    }
    if (splitX < 0) splitX = Math.floor((sbx0 + sbx1) / 2);
    const decks = [
      { x0: sbx0, x1: splitX - 1, label: 'AGRI-DECK 01' },
      { x0: splitX + 1, x1: sbx1, label: 'AGRI-DECK 02' },
    ].filter(function (d) { return d.x1 >= d.x0; });
    this.fieldDeck = this.add.graphics().setDepth(0.12);
    // QA 0904B.9 (SF10): the old 1px stroked rectangle read as a CAD wireframe
    // with posts only at corners. The outline is now a procedural fence — posts
    // every 2 tiles along the DERIVED soil-bounds perimeter with beams between
    // them, and a 2-tile gate gap on the side facing the main path. No tile
    // literals: every coordinate comes from sbx0/sbx1/sby0/sby1 above.
    const farmFenceGapTiles = 2;
    const perimeterTiles = 2 * (sbx1 - sbx0 + 1) + 2 * (sby1 - sby0 + 1);
    const perimeterPosts = Math.floor(perimeterTiles / 2) - farmFenceGapTiles;
    const farmPostKey = resolveKey('decor.farmPost');
    const farmBeamKey = resolveKey('decor.farmBeam');
    this.farmFencePosts = [];
    this.farmFenceBeams = [];
    const layFenceRun = function (tiles) {
      for (let i = 0; i < tiles.length; i++) {
        const pt = tiles[i];
        const post = this.add.image(pt.x * T + T / 2, pt.y * T + T / 2, farmPostKey).setDepth(0.11);
        this.world.add(post);
        this.farmFencePosts.push(post);
        if (i > 0) {
          const prev = tiles[i - 1];
          const dxT = Math.abs(pt.x - prev.x), dyT = Math.abs(pt.y - prev.y);
          const beam = this.add.image(
            (prev.x + pt.x) / 2 * T + T / 2, (prev.y + pt.y) / 2 * T + T / 2, farmBeamKey);
          const bpx = Math.hypot(dxT, dyT) * T - 8; // beam ends stay clear of post caps
          beam.setDisplaySize(bpx, 3);
          if (dxT === 0) beam.setAngle(90); // vertical run down a side edge
          beam.setAlpha(0.92).setDepth(0.1);
          this.world.add(beam);
          this.farmFenceBeams.push(beam);
        }
      }
    }.bind(this);
    for (const edgeY of [sby0, sby1]) {
      const run = [];
      for (let x = sbx0; x <= sbx1; x += 2) run.push({ x, y: edgeY });
      layFenceRun(run);
    }
    const gateSlot = sby0 + Math.floor((sby1 - sby0) / 2);
    for (const edgeX of [sbx0, sbx1]) {
      const run = [];
      for (let y = sby0; y <= sby1; y += 2) {
        if (edgeX === sbx1 && (y === gateSlot || y === gateSlot + 1)) continue; // gate gap
        run.push({ x: edgeX, y });
      }
      layFenceRun(run);
    }
    if (this.farmFencePosts.length < perimeterPosts - farmFenceGapTiles) {
      console.warn('SF10 farm fence covers ' + this.farmFencePosts.length +
        ' posts, expected >= ' + perimeterPosts);
    }
    this.fieldDeck.lineStyle(1, 0xd6b477, 0.18);
    for (const d of decks) {
      for (let fy = sby0; fy <= sby1; fy++) {
        this.fieldDeck.lineBetween(
          d.x0 * T + 8, fy * T + T / 2, (d.x1 + 1) * T - 8, fy * T + T / 2);
      }
    }
    this.world.add(this.fieldDeck);
    const deckLabelStyle = {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', fontStyle: 'bold',
      color: '#f1d69b', stroke: '#17231f', strokeThickness: 3,
    };
    this.fieldDeckLabels = decks.map(function (d) {
      return this.add.text(d.x0 * T + 10, sby0 * T + 8, d.label, deckLabelStyle).setDepth(0.2);
    }, this);
    this.world.add(this.fieldDeckLabels);
    // ── fence line ──
    this.fenceBeams = [];
    const spans = fenceSpans();
    for (const sp of spans) {
      // SF07: beams used to be stretched one tile past each post (wpx = span+1 tiles)
      // at full opacity, so adjacent spans fused into one unbroken cyan stroke across
      // the whole viewport. Run each beam post-to-post with a gap at every post, thin
      // and translucent, so it reads as a laser fence rather than a debug line.
      const wpx = (sp.x1 - sp.x0) * T - FENCE_BEAM_INSET * 2;
      const beam = this.add.image(
        (sp.x0 + (sp.x1 - sp.x0) / 2) * T + T / 2,
        sp.y * T + T / 2 - 6, 'decor.fence_beam_a'
      ).setDisplaySize(wpx, 2).setAlpha(FENCE_BEAM_ALPHA);
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
      // SF51 'Companion Corridor': the terminal is drawn as in-scene procedural
      // graphics (slate console + teal screen glow) rather than a flat decal,
      // so the screen reads as live colony hardware beside the bell tower.
      if (d.tex === 'bld.corridor_terminal') { this._buildCorridorTerminal(d); continue; }
      const decKey = resolveKey(d.tex);
      const img = this.add.image(d.x * T + T / 2, d.y * T + T / 2, decKey);
      img.setDepth(d.y);
      this.world.add(img);
      this.decorSprites.push({ img, d });
      // ROADMAP A1 'The first bell' — keep a handle on the bell tower sprite so
      // the festival dawn can swing it (setFestivalPhase → _ringBell).
      if (d.tex === 'bld.bell_tower') this.bellTower = img;
      // soft cast shadow under natural decor (trees, flora) — grounds the scene
      if (decKey !== resolveKey('decor.lamp') && decKey !== resolveKey('decor.pond')) {
        const sh = this.add.image(d.x * T + T / 2 + 3, d.y * T + 4, tex('fx.bldShadow'))
          .setScale(0.42, 0.5).setDepth(d.y - 0.05).setAlpha(0.5);
        this.world.add(sh);
      }
      if (decKey === resolveKey('decor.lamp')) {
        const glow = this.add.image(d.x * T + T / 2, d.y * T - 2, tex('fx.lampGlow'))
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(1000).setVisible(false);
        this.world.add(glow);
        // SF36: store each lamp glow's rest values ONCE at creation so the
        // festival bloom (setFestivalPhase → _startLampBloom) can pulse the
        // lamps and hand them back exactly as they were when the phase ends.
        glow._baseScale = 1.0;
        glow._baseAlpha = glow.alpha;
        this.lampGlows.push(glow);
        // Task 4: warm pool of light cast on the ground beneath the lamp
        const pool = this.add.image(d.x * T + T / 2, d.y * T + 12, tex('fx.poolWarm'))
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(902).setVisible(false).setAlpha(0);
        this.world.add(pool);
        this.lightPools.push({ img: pool, base: 0.55, phase: Math.random() * 6.283, speed: 0.0011 + Math.random() * 0.0006 });
        // SF08: three concentric amber discs give each lamp a proper ground
        // light pool — ADD-blended tinted-amber rings that fade with the overlay
        // (they ride the lightPools registry, so day hides them and night flicker
        // animates their alpha alongside the warm pool).
        for (const ring of POOL_RINGS) {
          const disc = this.add.image(d.x * T + T / 2, d.y * T + 12, tex('fx.poolWarm'))
            .setScale(ring.scale).setTint(0xffbe5a)
            .setBlendMode(Phaser.BlendModes.ADD).setDepth(902)
            .setVisible(false).setAlpha(0);
          this.world.add(disc);
          this.lightPools.push({
            img: disc, base: ring.alpha,
            phase: Math.random() * 6.283, speed: 0.0011 + Math.random() * 0.0006,
          });
        }
      }
    }

    // ── buildings (y-sorted) + night glows (in world, depth 1000) ──
    this.buildingSprites = [];
    this.glowRegistry = [];
    // SF51: the corridor terminal glow was built during the decor loop (before
    // glowRegistry existed) — hand it over here so night lights it live.
    if (this.corridorTerminalGlow) this.glowRegistry.push(this.corridorTerminalGlow);
    this.buildingGlows = [];
    for (const b of [...BUILDINGS].sort((a, c) => (a.y + a.h) - (c.y + c.h))) {
      const bldKey = b.key === 'tavern' ? texAt('bld.tavern', 0)
        : b.key === 'exchange' ? tex('bld.exchange') : resolveKey(b.tex);
      const img = this.add.image(b.x * T, b.y * T, bldKey);
      img.setDepth(b.y + b.h);
      this.world.add(img);
      // long soft cast shadow under the structure (light from upper-left)
      const bs = this.add.image(b.x * T + 6, (b.y + b.h) * T + 2, tex('fx.bldShadow'))
        .setScale(Math.max(0.6, (b.w || 3) * 0.5), 0.55)
        .setDepth(b.y - 0.05).setAlpha(0.55);
      this.world.add(bs);
      this.buildingSprites.push({ b, img });
      if (b.glow) {
        const glow = this.add.image(b.x * T, b.y * T, resolveKey(b.glow))
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(1001).setVisible(false);
        this.world.add(glow);
        glow.phase = Math.random() * Math.PI * 2;   // each landmark breathes on its own beat
        // QA 0904 2.5 — the learnable window-light RULE:
        //   warm windows lit by DAY  = "open for business" (shop/tavern/exchange)
        //   warm windows lit by NIGHT = "someone is home" (house/barracks/ranch)
        // Players can read the colony's state from across the map without a UI:
        // a dark depot at noon means the shutters are down; a lit bunk at noon
        // is off-duty. This is why the glow is no longer night-only for all.
        glow.litWhen = (b.key === 'shop' || b.key === 'tavern' || b.key === 'exchange') ? 'day' : 'night';
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
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#cfd6ff',
        stroke: '#000000', strokeThickness: 3,
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
        name: npc.name,
        emoji: npc.emoji,
        data: npc,
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
    // SF37 — the scene is still assembling its first load, so any envoy created
    // during create() SKIPS the arrival flash (the colony opens calm; only
    // envoys landing LIVE after create() pop in).
    this._createDone = false;
    this.alienSprites = [];
    for (const alien of ALIEN_DATA) {
      const ax = alien.x * T + T / 2, ay = alien.y * T + T / 2;
      // SF06: fx.lamp_glow is an OPAQUE disc (black edges) meant for additive blending —
      // drawn NORMAL it read as a dark square block behind the envoy.
      const aura = this.add.image(ax, ay + 20, "fx.lamp_glow").setScale(1.3).setAlpha(0.3)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(alien.y + 0.2);
      const spr = this.add.image(ax, ay, `alien.${alien.id}`).setScale(0.9).setDepth(alien.y + 0.6);
      const label = this.add.text(ax, ay - 48, alien.name, { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#dffcff", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(alien.y + 0.8);
      const marker = this.add.text(ax, ay + 42, "FIRST CONTACT", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#f3d99b", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(alien.y + 0.8);
      this.world.add([aura, spr, label, marker]);
      spr.alienId = alien.id; spr._aura = aura; spr._marker = marker; spr._label = label;
      spr._baseY = ay;
      spr._baseScale = spr.scaleY;          // SF37 — full scale the arrival tween restores
      spr._auraBase = aura.alpha;           // SF37 — aura alpha the arrival fade-in restores
      this.alienSprites.push(spr);
      this._envoyArrival(spr);              // SF37 — skipped during create() (see _createDone)
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
    // held tool — the equipped hoe/can/pickaxe/rod drawn beside the player so
    // every craft reads as a held tool, not an invisible press (swung on use).
    this.toolSpr = this.add.image(this.playerSpr.x, this.playerSpr.y, tex('tool.hoe'))
      .setVisible(false).setDepth(PLAYER_START.y + 1.2);
    this.world.add(this.toolSpr);
    // cool rim-light under the player so night keeps their silhouette readable
    // warm pool at the player's feet so night keeps their silhouette readable
    this.playerRim = this.add.image(this.playerSpr.x, this.playerSpr.y + 12, 'fx.pool_player')
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(903).setAlpha(0).setVisible(false);
    this.world.add(this.playerRim);
    this.glowRegistry.push(this.playerRim);

    // ══ NIGHT OVERLAY (screen-anchored rect, sized to the camera view) ══
    // SF52: the old overlay lived INSIDE the offset `this.world` container and
    // was positioned every frame at (cam.scrollX, cam.scrollY) in *world* coords
    // — inside that container the container offset was applied on top of the
    // scroll, so the overlay sat half a screen off the view and night read as
    // bright as day. Fix: a screen-anchored rect OUTSIDE the world container
    // (scrollFactor 0, origin 0, scene coords), sized each frame to
    // cam.width/zoom × cam.height/zoom so it covers the visible view at any
    // zoom. MULTIPLY at 0.62 alpha rendered as a near-no-op tint in this
    // renderer, so the overlay uses NORMAL blend: a 0.62-alpha 0x0e1838 wash
    // over the scene that reliably darkens, while the additive lamp pools and
    // window glows (depth ≥ 900) and the HUD (depth ≥ 990) still draw above it.
    this.nightOverlay = this.add.rectangle(0, 0, width, height, 0x0e1838, 0)
      .setOrigin(0, 0).setBlendMode(Phaser.BlendModes.NORMAL)
      .setScrollFactor(0).setDepth(900); // alpha 0 by day draws nothing
    // never a child of the offset `world` container — screen coords only

    // ══ SF32 DUSK/DAWN WASH: a warm amber-orange additive tint that breathes
    //    in during the night/day transition (peaks mid-transition, fades out).
    //    Screen-anchored, above the night overlay, below the HUD. ══
    this.duskWash = this.add.rectangle(width / 2, height / 2, width, height, 0xff9a5a, 0)
      .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0).setDepth(901).setAlpha(0.12).setVisible(false);

    // ══ SF32 AURORA: three wide additive ribbons near the top of the screen,
    //    teal/green/violet. Only at night AND on every third day (deterministic:
    //    this.dayCount % 3 === 0), undulating slowly in update(). ══
    this.aurora = [];
    const auroraColors = [0x67e1cd, 0x7dffb0, 0xb08cff];
    for (let ai = 0; ai < auroraColors.length; ai++) {
      const g = this.add.graphics().setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(902).setVisible(false).setAlpha(0.18);
      const color = auroraColors[ai];
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(-24, 30 + ai * 12);
      for (let x = 0; x <= width + 24; x += 24) {
        const y = 28 + ai * 12 + Math.sin(x * 0.012 + ai * 2.1) * 16 + Math.cos(x * 0.021 + ai * 0.7) * 7;
        g.lineTo(x, y);
      }
      // mirror the crest downward to close each ribbon band
      for (let x = width + 24; x >= -24; x -= 24) {
        const y = 28 + ai * 12 + Math.sin(x * 0.012 + ai * 2.1) * 16 + Math.cos(x * 0.021 + ai * 0.7) * 7;
        g.lineTo(x, y + 40 + ai * 14);
      }
      g.closePath();
      g.fillPath();
      g._ribbon = ai;                        // per-ribbon phase for update()
      this.aurora.push(g);
    }

    // ══ SEASON AMBIENT: tint ramp + particle weather emitters ══
    this.seasonOverlay = this.add.rectangle(0, 0, width, height, 0xffffff, 0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(898);
    this.world.add(this.seasonOverlay);

    // cinematic vignette — soft dark corners, screen-fixed through zoom
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.vignette')
      .setDepth(960).setScrollFactor(0).setAlpha(0.85);

    // ══ SF22 — quest objective marker: bobbing amber chevron over the active
    //    quest target + a screen-fixed edge arrow when it's off-camera ══
    // The chevron follows the target in-world (scene coords: local pixel + the
    // world container offset), so camera scroll moves it; the edge arrow locks
    // to the viewport the same way SpaceshipScene's compass arrow does.
    this.questMarker = this.add.container(0, 0).setDepth(986).setVisible(false);
    this.questMarker.add(this.add.text(0, 0, '▼', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '16px', fontStyle: 'bold',
      color: '#f7d698', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5));
    this.questMarker.add(this.add.text(0, 16, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '12px', fontStyle: 'bold',
      color: '#ffe9a0', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5));
    this.questEdgeArrow = this.add.graphics().setScrollFactor(0).setDepth(985).setVisible(false);

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
    this._buildCorridorPanel();
    this._buildInteractPrompt();
    this._bindSavedBlip();
    this._bindReflection();

    // ── Interior rooms (built lazily on first entry, one per building) ──
    this.intRooms = {};
    this.intKind = null;
    this.inInterior = false;

    // ── input ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard.addKey('W'), A: this.input.keyboard.addKey('A'),
      S: this.input.keyboard.addKey('S'), D: this.input.keyboard.addKey('D'),
    };
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard.addKey('E');
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.mKey = this.input.keyboard.addKey('M');
    // SF49: F9 toggles reduced motion (M toggles the colony hub, so F9 is the
    // free accessibility key). The choice persists via Motion.setReducedMotion.
    this.rmKey = this.input.keyboard.addKey('F9');
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
    this.ranchSign = this.add.text(0, -40, 'SPACE RANCH', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#9ddd72', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    this.ranchStage.add(this.ranchSign);
    this.ranchStage.add(this.add.rectangle(0, 24, 130, 58, 0x141a26, 0.5).setStrokeStyle(1, 0x39c5bb));
    this.ranchStage.add(this.add.text(0, 56, '[1][2][3] buy · feed daily', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8d8d8' }).setOrigin(0.5));
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
    this.mineHint.add(this.add.rectangle(0, 10, 252, 24, 0x101a26, 0.88).setStrokeStyle(1, 0xd8a05a));
    this.mineHint.add(this.add.text(0, 10, 'MINE the vein (A/SPACE · pickaxe)', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#ffe9a0' }).setOrigin(0.5));
    this.mineHint.setVisible(false);

    this.casting = false;
    // accessible fishing hint — floats above the player when near the pond
    this.fishHint = this.add.container(0, 0).setDepth(988);
    const hintBg = this.add.rectangle(0, 10, 190, 24, 0x101a26, 0.88).setStrokeStyle(1, 0x39c5bb);
    const hintTxt = this.add.text(0, 10, '[J] CAST · pick a spot', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8eeff' }).setOrigin(0.5);
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
    this.deepDropLabel = this.add.text(ddx, ddy + 16, 'DEEP DROP', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8eeff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(95);
    // the shore tap — where the watering can refills. Equip the can and press
    // A/SPACE on the pond's edge; a small teal faucet makes the spot visible.
    this.shoreTap = this.add.graphics().setDepth(94);
    const stx = FILL_SPOT.x * T, sty = FILL_SPOT.y * T;
    this.shoreTap.fillStyle(0x0d4a50, 0.9).fillCircle(stx, sty, 7);
    this.shoreTap.fillStyle(0x39c5bb, 0.95).fillCircle(stx, sty, 4);
    this.shoreTap.lineStyle(1.2, 0x9ddd72, 0.6).strokeCircle(stx, sty, 7);
    this.shoreTapLabel = this.add.text(stx, sty + 15, 'SHORE TAP', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8eeff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(95);
    this.uKey = this.input.keyboard.addKey('U');
    this.vKey = this.input.keyboard.addKey('V');
    this.qKey = this.input.keyboard.addKey('Q'); // The Stardust Story — quest log
    this.cKey = this.input.keyboard.addKey('C'); // Kitchen — recipe book

    // ── The Colony Hub — ONE menu for every activity. Desktop M and the
    //    mobile MENU button both call toggleHub(), so both inputs drive the
    //    same panel through the same code path (no more desktop-only hotkeys). ──
    this.showingHub = false;
    this.hub = new ColonyHub(this).build();
    this.hub.setSections([
      { id: 'backpack', label: 'BACKPACK', hint: 'equip tools · inventory · can tank', run: () => this.openBackpack() },
      { id: 'fish', label: 'FISH', hint: 'cast the stardust shore', run: () => this.fish() },
      { id: 'mine', label: 'MINE', hint: 'swing at the asteroid vein', run: () => this.mine() },
      { id: 'ranch', label: 'RANCH', hint: 'feed the herd · sell goods', run: () => this.openRanch() },
      { id: 'depot', label: 'SUPPLY DEPOT', hint: 'buy seeds & goods', run: () => this.openShop() },
      { id: 'smithy', label: 'SMITHY', hint: 'upgrade tools for credits', run: () => this.openSmithy() },
      { id: 'exchange', label: 'GRAND EXCHANGE', hint: 'trade at the Exchange building', run: () => this.openGrandExchange() },
      { id: 'quests', label: 'THE STARDUST STORY', hint: 'the quest log', run: () => this.toggleQuestLog() },
      { id: 'codex', label: 'COLONY CODEX', hint: 'world lore & guidance', run: () => this._toggleCodex() },
    ]);

    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // ── audio (2000s JRPG) ──
    this.audio = new AudioSystem(this);
    this._bootAudio = () => this.audio.boot();   // TouchControls reuses this for DOM-button gestures
    this.input.once('pointerdown', () => this.audio.boot());
    this.input.keyboard.once('keydown', () => this.audio.boot());

    this.updateNightVisuals();

    // ══ SF35 STARDUST: ~40 tiny screen-anchored motes drifting diagonally
    //    between the sky (depth -60) and the world (depth 0) so they sit just
    //    above the sky and never cover the world or the HUD. Positions come
    //    from a small LCG seeded deterministically per index — NO Math.random
    //    at create, so screenshots are stable from boot to boot. ══
    this.stardust = [];
    {
      let seed = 0x5f3759df >>> 0;
      const lcg = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let si = 0; si < 40; si++) {
        const px = lcg() * width, py = lcg() * height;
        const size = 1 + (si % 2);
        const mote = this.add.rectangle(px, py, size, size, 0xeafff5, 1)
          .setScrollFactor(0).setDepth(-58).setBlendMode(Phaser.BlendModes.ADD)
          .setAlpha(0.15 + lcg() * 0.30);
        mote._vx = 0.006 + lcg() * 0.020;   // px/ms diagonal drift
        mote._vy = 0.004 + lcg() * 0.014;
        mote._cx = px; mote._cy = py;       // deterministic origin (QA)
        this.stardust.push(mote);
      }
    }

    // ══ SF35 SEASON HAZE: one full-screen soft tint just below the film sheen
    //    (963 < filmSheen 964) that recolours with the season so the atmosphere
    //    changes every time the calendar rolls over. ══
    this.seasonHaze = this.add.rectangle(0, 0, width, height, SEASON_HAZE[0], 0)
      .setBlendMode(Phaser.BlendModes.ADD).setScrollFactor(0).setDepth(963);

    // [SF29] paint the season the server starts us in (default SPRING) —
    // applySeasonGrade also sets the SF35 haze colour for that season.
    this.applySeasonGrade(this.season ?? 0);

    // SF37 — the initial load is assembled: from here on, any envoy that lands
    // LIVE (created after create()) plays the arrival flash.
    this._createDone = true;
  }

  // [SF29] Seasonal ground grading — makes the four seasons visibly differ.
  // Idempotent: a repeated sync with the same season does zero work.
  // Ground tiles + farm tiles get grade.ground; water tiles and buildings
  // stay untinted (water glow must keep its hue); natural decor (trees,
  // bushes, alien flora) gets grade.flora; lamps/tech props are never tinted.
  applySeasonGrade(season) {
    const s = Math.max(0, Math.min(3, season | 0));
    if (this._gradedSeason === s) return;
    this._gradedSeason = s;
    const grade = SEASON_GRADE[s];
    // water images also live in this.tiles — keep their shimmer untinted
    const water = new Set(this.waterTiles.map(w => w.img));
    for (const img of this.tiles) {
      if (!water.has(img)) img.setTint(grade.ground);
    }
    for (const ft of this.farmTiles) ft.img.setTint(grade.ground);
    const FLORA = /tree|bush|flora/;
    for (const { img, d } of this.decorSprites) {
      if (FLORA.test(d.tex)) img.setTint(grade.flora);
    }
    // [SF41] painterly sky + deep-space planets: tint them with the same season
    // grade so the heavens change with the year turn too.
    if (this.skyTile) this.skyTile.setTint(SKY_GRADE[s]);
    if (this.planetSpr) this.planetSpr.setTint(SKY_GRADE[s]);
    if (this.planetSpr2) this.planetSpr2.setTint(SKY_GRADE[s]);
    // [SF35] season haze: recolour the atmosphere with the same season the
    // ground/flora grade uses, so the sky reacts to the year turn too.
    if (this.seasonHaze) {
      const haze = SEASON_HAZE[s] || SEASON_HAZE[0];
      this.seasonHaze.setFillStyle(haze.color).setAlpha(haze.alpha);
    }
  }

  // ── UI builders ──
  // SF20: the context prompt chip — a small teal pill above the target that
  // says what SPACE/A will do BEFORE you press it ("SPACE · Talk to NOVA",
  // "SPACE · Enter SUPPLY DEPOT", "SPACE · Water"...). Teal plate, amber key,
  // ≥11px font, world-local placement above the resolved target. Touch players
  // read "A ·" instead of "SPACE ·" (game.config.touchMode).
  _buildInteractPrompt() {
    const plate = this.add.rectangle(0, 0, 150, 22, 0x081a20, 0.88)
      .setStrokeStyle(1, 0x39c5bb, 0.9);
    const keyTxt = this.add.text(0, 0, 'SPACE', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', fontStyle: 'bold', color: '#f7d698',
    }).setOrigin(0, 0.5);
    const bodyTxt = this.add.text(0, 0, '', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#b8ffcf', stroke: '#061015', strokeThickness: 2,
    }).setOrigin(0, 0.5);
    // World-space (scrollFactor 1): x/y are the target's world pixels, so the
    // chip stays pinned above it while the camera follows the player.
    this.interactPrompt = this.add.container(0, 0, [plate, keyTxt, bodyTxt])
      .setScrollFactor(1).setDepth(996).setVisible(false);
    this._promptKey = keyTxt;
    this._promptBody = bodyTxt;
    this._promptPlate = plate;
  }
  // SF20: refresh the chip every ~8 frames from the live resolver result — the
  // chip says "SPACE · Enter SUPPLY DEPOT" etc. before the press lands.
  _updateInteractPrompt(time) {
    if (!this.interactPrompt) return;
    if (time - (this._promptLast || 0) < 125) return;
    this._promptLast = time;
    // hide while a dialogue/panel/interior is handled elsewhere
    const hidden = !!(this.inAlienContact || this.eventQueue || this.inDialogue || this.showingGE ||
      this.showingShop || this.showingRanch || this.showingChest || this.showingQuests || this.showingRecipes ||
      this.showingHub || this.showingBackpack || this.showingSmithy || this.showingCorridor || this.showingReckoning || this.inInterior);
    if (hidden) { this.interactPrompt?.setVisible(false); return; }
    const target = this._resolveInteractTarget();
    if (!target) { this.interactPrompt?.setVisible(false); return; }
    const keyTxt = this._promptKey, bodyTxt = this._promptBody, plate = this._promptPlate;
    keyTxt.setText(`${this.touchMode ? 'A' : 'SPACE'} ·`);
    bodyTxt.setText(target.label);
    const w = keyTxt.width + 6 + bodyTxt.width;
    keyTxt.setX(-w / 2);
    bodyTxt.setX(-w / 2 + keyTxt.width + 6);
    plate.setSize(w + 20, 22);
    this.interactPrompt.setVisible(true);
    this.interactPrompt.setPosition(target.x, target.y);
  }

  buildHUD(width, height) {
    const f = { fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', fontStyle: 'bold' };
    const y = height - 48;
    // Screen-fixed (scrollFactor 0): the HUD is viewport furniture. Without this
    // the strips scroll with the camera and the dark bars drift into the middle
    // of the world (QA 0904B.2). Every buildHUD element gets sf0 via the list.
    const screenFix = [];
    // Floating glass telemetry keeps status scannable without hiding the world.
    this.hudBar = this.add.rectangle(width / 2, y, width - 24, 44, 0x081a20, 0.88)
      .setStrokeStyle(1, 0x6be7d0, 0.7).setDepth(997); screenFix.push(this.hudBar);
    this.hudAccent = this.add.rectangle(24, y, 4, 28, 0xf3bd67, 1).setDepth(998); screenFix.push(this.hudAccent);
    this.hudText = this.add.text(38, y - 7, '', {
      ...f, color: '#effff9', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(1000); screenFix.push(this.hudText);
    this.energyTrack = this.add.rectangle(38, y + 11, 170, 5, 0x16363a, 1).setOrigin(0, 0.5).setDepth(999); screenFix.push(this.energyTrack);
    this.energyFill = this.add.rectangle(38, y + 11, 170, 5, 0x6be7d0, 1).setOrigin(0, 0.5).setDepth(1000); screenFix.push(this.energyFill);
    this.hudDay = this.add.text(width - 34, y, '', {
      ...f, fontSize: '12px', color: '#f8d797', align: 'right', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(1, 0.5).setDepth(1000); screenFix.push(this.hudDay);
    this.colonyMark = this.add.text(width - 18, 66, // below the HTML mute/touch buttons (top-right, ~58px)
      'B-612  /  FRONTIER AGRICULTURE', {
      ...f, fontSize: '12px', color: '#b8e0d8',
      stroke: '#061015', strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(1000); screenFix.push(this.colonyMark);
    this.questPlate = this.add.rectangle(12, 8, Math.min(430, width * 0.54), 38, 0x081a20, 0.78)
      .setOrigin(0, 0).setStrokeStyle(1, 0x6be7d0, 0.45).setDepth(997).setVisible(false); screenFix.push(this.questPlate);
    this.questChip = this.add.text(24, 18, '', {
      ...f, fontSize: '12px', color: '#d5f4e8', stroke: '#061015', strokeThickness: 3,
    }).setOrigin(0, 0).setDepth(1000); screenFix.push(this.questChip);
    screenFix.forEach(o => o.setScrollFactor(0));
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
      fontSize: '12px',
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
    // ART-06: painted bust — the speaker's Qwen-painted portrait stands on the
    // dialogue box's top-left edge (the 40px pixel face inside keeps the mouth).
    this.paintedBust = this.add.image(boxL + 78, boxT + 2, 'port.nova_0')
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(998).setVisible(false);
    this.paintedBustFrame = this.add.graphics().setScrollFactor(0).setDepth(998.5).setVisible(false);
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
    this._diaFace = opts.face || 0;   // [SF46] 3 = warm (loved gift), 4 = troubled (hated gift); held for the line
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_${this._diaFace}`);
    this._showPaintedBust(this._diaNPC);
    this.dialog.setText(full, {
      title: opts.title,
      footer: opts.footer,
      typewriter: true,
      onDone: () => { this._diaDone = true; this._diaTypesFinished(); },
    });
  }

  // Called when the shared panel finishes typing — settle the portrait and hint.
  _diaTypesFinished() {
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_${this._diaFace || 0}`);
    this.dialogueHint.setText(this._diaFooter || '[SPACE to continue]');
    this.dialogueHint.setVisible(true);
  }

  _finishTyping() {
    if (this._diaDone) return;
    this.dialog.finishTyping();
    this._diaDone = true;
    if (this.dialog.portrait) this.dialog.setPortrait(`port.${this._diaNPC}_${this._diaFace || 0}`);
    this.dialogueHint.setText(this._diaFooter || '[SPACE to continue]');
    this.dialogueHint.setVisible(true);
  }

  buildContactUI(width, height) {
    this.contactPanel = this.add.container(width / 2, height / 2).setDepth(1200).setScrollFactor(0).setVisible(false);
    const panelWidth = Math.min(720, width - 40);
    // ART-06: painted first-contact sky behind the council, envoy bust on the plate
    this.contactBackdrop = paintedBackdrop(this, 'contact', 0, 0, width, height);
    if (this.contactBackdrop) this.contactPanel.add(this.contactBackdrop.setAlpha(0.9));
    const bg = this.add.rectangle(0, 0, panelWidth, 500, 0x07121c, this.contactBackdrop ? 0.86 : 0.98).setStrokeStyle(2, 0x7adfd5);
    this.contactTitle = this.add.text(0, -220, "FIRST CONTACT COUNCIL", { fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#f2d99a", fontStyle: "bold" }).setOrigin(0.5);
    this.contactPremise = this.add.text(0, -182, "", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#e9f3f4", align: "center", wordWrap: { enable: true, width: panelWidth - 70 }, lineSpacing: 4 }).setOrigin(0.5, 0);
    this.contactPanel.add([bg, this.contactTitle, this.contactPremise]);
    this.contactEnvoy = this.add.image(-panelWidth / 2 - 4, -250, 'port.nova_0').setOrigin(0, 0).setVisible(false);
    this.contactPanel.add(this.contactEnvoy);
    this.contactRows = CONTACT_DOCTRINES.map((doctrine, index) => {
      const y = -55 + index * 62;
      const row = this.add.rectangle(0, y, panelWidth - 70, 52, 0x132432, 0.96).setStrokeStyle(1, doctrine.color).setInteractive({ useHandCursor: true });
      const copy = this.add.text(-panelWidth / 2 + 52, y, "[" + (index + 1) + "] " + doctrine.label + " — " + doctrine.description, { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#e9f3f4", wordWrap: { enable: true, width: panelWidth - 110 } }).setOrigin(0, 0.5);
      row.on("pointerdown", () => this.chooseContactDoctrine(doctrine.id));
      row.on("pointerover", () => row.setFillStyle(0x244154, 1));
      row.on("pointerout", () => row.setFillStyle(0x132432, 0.96));
      this.contactPanel.add([row, copy]);
      return { row, copy, doctrine };
    });
    this.contactNote = this.add.text(0, 220, "No reward · no correct answer · choice becomes colony history", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#b0c8d1" }).setOrigin(0.5);
    this.contactPanel.add(this.contactNote);
    this.cinemaTop = this.add.rectangle(width / 2, 34, width, 68, 0x000000, 0.92).setDepth(1190).setVisible(false);
    this.cinemaBottom = this.add.rectangle(width / 2, height - 34, width, 68, 0x000000, 0.92).setDepth(1190).setVisible(false);
  }

  buildPanels(width, height) {
    this.gePanel = this.add.container(width / 2, height / 2).setDepth(1002).setScrollFactor(0).setVisible(false);
    const geBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0x39c5bb);
    const geTitle = this.add.text(0, -134, 'GRAND EXCHANGE', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#7ef0ff',
    }).setOrigin(0.5);
    const geContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const geClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.gePanel.add([geBg, geTitle, geContent, geClose]);
    this.geTitle = geTitle; this.geContent = geContent; this.geClose = geClose;

    this.shopPanel = this.add.container(width / 2, height / 2).setDepth(1002).setScrollFactor(0).setVisible(false);
    const shopBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0x67e1cd);
    const shopTitle = this.add.text(0, -134, "SUPPLY DEPOT", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#9ddd72',
    }).setOrigin(0.5);
    const shopContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const shopClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.shopPanel.add([shopBg, shopTitle, shopContent, shopClose]);
    this.shopTitle = shopTitle; this.shopContent = shopContent; this.shopClose = shopClose;

    this.ranchPanel = this.add.container(width / 2, height / 2).setDepth(1002).setScrollFactor(0).setVisible(false);
    const ranchBg = this.add.rectangle(0, 0, 480, 340, 0x070714, 0.95).setStrokeStyle(3, 0x67e1cd);
    const ranchTitle = this.add.text(0, -134, "RANCH - STARDUST LIVESTOCK", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const ranchContent = this.add.text(0, -40, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#e8ecff',
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5);
    const ranchClose = this.add.text(0, 140, '[CLOSE: SPACE]', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.ranchPanel.add([ranchBg, ranchTitle, ranchContent, ranchClose]);
    this.ranchTitle = ranchTitle; this.ranchContent = ranchContent; this.ranchClose = ranchClose;

    // storage chest panel (interior)
    this.chestPanel = this.add.container(width / 2, height / 2).setDepth(1003).setScrollFactor(0).setVisible(false);
    const chestBg = this.add.rectangle(0, 0, 360, 300, 0x070714, 0.95).setStrokeStyle(3, 0x67e1cd);
    const chestTitle = this.add.text(0, -120, "HOME STORAGE", {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const chestContent = this.add.text(0, -20, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#e8ecff',
      align: 'center', lineSpacing: 8,
    }).setOrigin(0.5);
    this.chestPanel.add([chestBg, chestTitle, chestContent]);
    this.chestContent = chestContent;

    // ── Recipe book (M4 kitchen) — [C] at the stove ──
    this.recipePanel = this.add.container(width / 2, height / 2).setDepth(1003).setScrollFactor(0).setVisible(false);
    const recipeBg = this.add.rectangle(0, 0, 440, 360, 0x070714, 0.96).setStrokeStyle(3, 0x67e1cd);
    const recipeTitle = this.add.text(0, -146, 'KITCHEN — RECIPE BOOK', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '13px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const recipeContent = this.add.text(0, -118, '', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#e8ecff',
      lineSpacing: 5,
    }).setOrigin(0.5, 0);
    this.recipePanel.add([recipeBg, recipeTitle, recipeContent]);
    this.recipeContent = recipeContent;

    // ── 'The Stardust Story' quest log (Q key) — the arc's readable spine ──
    this.questPanel = this.add.container(width / 2, height / 2).setDepth(1004).setScrollFactor(0).setVisible(false);
    const qBg = this.add.rectangle(0, 0, 520, 380, 0x070714, 0.96).setStrokeStyle(3, 0x7ef0ff);
    const qTitle = this.add.text(0, -158, 'THE STARDUST STORY', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '15px', color: '#7ef0ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const qContent = this.add.text(0, -10, '', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#e8ecff', lineSpacing: 8,
    }).setOrigin(0.5, 0);
    const qClose = this.add.text(0, 168, '[Q] CLOSE', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.questPanel.add([qBg, qTitle, qContent, qClose]);
    this.questContent = qContent;

    // ── Backpack (Slice 3) — equip tools, read the tank, see your cargo. Rows
    //    are tap targets (mobile) AND 1-5 keys (desktop); _renderBackpack() fills
    //    the dynamic rows below the static title/close. ──
    this.backpackPanel = this.add.container(width / 2, height / 2).setDepth(1012).setScrollFactor(0).setVisible(false);
    const bkBg = this.add.rectangle(0, 0, 480, 420, 0x070714, 0.96).setStrokeStyle(3, 0x67e1cd);
    const bkTitle = this.add.text(0, -178, 'BACKPACK - TOOLS & CARGO', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#9dffec',
    }).setOrigin(0.5);
    const bkClose = this.add.text(0, 196, '[1-5] EQUIP    [SPACE/B] CLOSE', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.backpackPanel.add([bkBg, bkTitle, bkClose]);
    this.backpackTitle = bkTitle;
    this._backpackDynamic = [];

    // ── Smithy (Slice 4) — spend credits to upgrade each tool's tier. Rows are
    //    tap targets (mobile) AND 1-4 keys (desktop); _renderSmithy() fills the
    //    dynamic rows. U and the hub's SMITHY row both land here. ──
    this.smithyPanel = this.add.container(width / 2, height / 2).setDepth(1012).setScrollFactor(0).setVisible(false);
    const smBg = this.add.rectangle(0, 0, 480, 420, 0x070714, 0.96).setStrokeStyle(3, 0x67e1cd);
    const smTitle = this.add.text(0, -178, 'SMITHY - UPGRADE TOOLS', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#ffe9a0',
    }).setOrigin(0.5);
    const smClose = this.add.text(0, 196, '[1-4] UPGRADE    [SPACE/B] CLOSE', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0.5);
    this.smithyPanel.add([smBg, smTitle, smClose]);
    this.smithyTitle = smTitle;
    this._smithyDynamic = [];
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
        fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#b0c8d1',
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
  // ── SF51 'Companion Corridor' — the plaza terminal prop ──
  // Slate console + live teal screen, drawn procedurally in-scene (Graphics +
  // one ADD-blended cool pool) on a walkable-adjacent tile beside the bell
  // tower. The glow joins glowRegistry AFTER create() — see the flush above.
  _buildCorridorTerminal(d) {
    const cx = d.x * T + T / 2, cy = d.y * T + T / 2;
    const g = this.add.graphics();
    // slate console shell (same hull palette family as the depot buildings)
    g.fillStyle(0x1b2b33, 1);
    g.fillRect(cx - 13, cy - 22, 26, 38);
    // screen bezel + dark screen well + the live teal screen itself
    g.fillStyle(0x39484f, 1);
    g.fillRect(cx - 11, cy - 18, 22, 26);
    g.fillStyle(0x0c1019, 1);
    g.fillRect(cx - 9, cy - 16, 18, 14);
    g.fillStyle(0x67e1cd, 0.9);
    g.fillRect(cx - 8, cy - 15, 16, 12);
    // amber feed accent + two slate feed rows (the agent day scrolling by)
    g.fillStyle(0xf7d698, 0.75);
    g.fillRect(cx - 8, cy - 13, 6, 1);
    g.fillStyle(0x39484f, 1);
    g.fillRect(cx - 1, cy - 13, 8, 1);
    g.fillRect(cx - 8, cy - 10, 12, 1);
    // keyboard strip + antenna stub so it reads as hardware, not a sticker
    g.fillStyle(0x2a3a42, 1);
    g.fillRect(cx - 7, cy + 8, 14, 8);
    g.fillStyle(0x5a6a78, 1);
    g.fillRect(cx + 10, cy - 24, 2, 4);
    g.fillRect(cx + 11, cy - 26, 1, 2);
    g.setDepth(d.y + 0.5);
    this.world.add(g);
    this.decorSprites.push({ img: g, d });
    this.corridorTerminal = g;
    // teal screen glow so the terminal reads LIVE at night (litWhen 'night')
    const glow = this.add.image(cx, cy - 14, 'fx.pool_cool')
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(d.y + 0.6)
      .setScale(0.75).setAlpha(0.3).setVisible(false);
    glow.litWhen = 'night';
    this.world.add(glow);
    this.corridorTerminalGlow = glow;
  }

  _buildFestivalPlaza() {
    const px = (tx) => tx * T + T / 2, py = (ty) => ty * T + T / 2;
    this.festivalDecor = [];
    const add = (o) => { o.setVisible(false); this.world.add(o); this.festivalDecor.push(o); return o; };

    // bunting garlands between the lamp posts — sagging rows of colony pennants
    for (const s of FEST_BUNTING) {
      const x1 = px(s.x1), x2 = px(s.x2), y = py(s.y) - 26;
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const bx = x1 + (x2 - x1) * (i / n);
        const sag = Math.sin((i / n) * Math.PI) * 7;          // catenary-ish dip
        const by = y + sag;
        const flag = this.add.image(bx, by, texAt('fest.pennant', i)).setOrigin(0.5, 0).setScale(1.1);
        add(flag);
        if (i % 2 === 0) {                                    // string-light bulbs
          const bulb = this.add.image(bx, by + 9, tex('fest.bulb'))
            .setBlendMode(Phaser.BlendModes.ADD).setScale(0.8).setAlpha(0.9);
          add(bulb);
        }
      }
      // the string itself (thin line the pennants hang from)
      const gx = this.add.graphics().setDepth(12.2);
      gx.lineStyle(1, 0x8a90b0, 0.5);
      gx.beginPath().moveTo(x1, y).lineTo(x2, y + 4); gx.strokePath();
      add(gx);
    }

    // the stage — a colony platform facing the crowd, with a teal edge-glow
    const st = this.add.image(px(FEST_STAGE.x), py(FEST_STAGE.y) + 8, tex('fest.stage')).setScale(1.9);
    add(st);
    const stageGlow = this.add.rectangle(px(FEST_STAGE.x), py(FEST_STAGE.y) + 14, 5.6 * T, 0.8 * T, 0x2e7d4f, 0.18);
    add(stageGlow);
    const sign = this.add.text(px(FEST_STAGE.x), py(FEST_STAGE.y) - 12, '★ EARTH DAY ★', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#ffe9a0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12.4);
    add(sign);

    // two colony food stalls — holo awnings + a glowing counter of dishes
    for (const s of FEST_STALLS) {
      const tx = px(s.x), ty = py(s.y);
      const stall = this.add.image(tx, ty - 6, tex('fest.stall')).setOrigin(0.5, 0.5).setScale(1.4);
      add(stall);
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
    // ROADMAP A1 'The first bell': at festival dawn the old mission bell rings
    // over the plaza — sfx, four yoyo swings of the bell sprite, and the toast.
    if (phase === 'setup') this._ringBell();
    const on = phase !== 'none';
    for (const o of this.festivalDecor) o.setVisible(on);
    // festival music mood (brighter, faster + melody layer)
    if (window.SpaceFarmer && window.SpaceFarmer.music) window.SpaceFarmer.music.setMood(on ? 'festival' : null);
    // the "singer" on stage bobs while the feast is on
    if (this._festSingerTween) { this._festSingerTween.stop(); this._festSingerTween = null; }
    if (on && this.festivalGuests && !reducedMotion()) {
      const g = this.festivalGuests.find(x => x.singing);
      if (g) this._festSingerTween = this.tweens.add({
        targets: g.spr, y: g.baseY - 3, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
    if (phase === 'afterglow') {
      this.showToast?.('The heart hummed clean tonight. Nobody talked about it. That\u2019s the point.', { duration: 5200, y: 120 });
    }
    // SF36 — festival lamp bloom: while the festival is on, every colony lamp
    // pulses warm amber (scale up to 1.35x its base, alpha up to min(1,
    // base*1.6), 900ms yoyo, staggered index*80ms). Bloom only rescales /
    // fades / tints the glows — it never forces a lamp visible, so the SF08
    // day rule ("lamps hidden by day") stays true; when the phase returns to
    // 'none' every tween stops and each glow hands back its stored base
    // scale/alpha and its clear tint.
    if (on) this._startLampBloom(); else this._stopLampBloom();
  }

  // ── SF36 — festival lamp bloom ─────────────────────────────────────────
  // The colony lamps read as "any night" unless the festival lights them up.
  // Helper scale factor keeps the bloom relative to the SF08 night look
  // (lamps bloom bigger at night: 1.7x vs day 1.0x) instead of shrinking it.
  _lampNightScale() { return this.isNight ? 1.7 : 1.0; }
  _startLampBloom() {
    if (!this.lampGlows || !this.lampGlows.length) return;
    if (this._lampBloomTweens && this._lampBloomTweens.length) this._stopLampBloom();
    // SF49: reduced motion keeps the festival bloom as a TINT-ONLY statement —
    // every lamp glow still warms to amber so the plaza reads as lit, but no
    // scale or alpha tween runs and every glow holds exactly its rest values.
    if (reducedMotion()) {
      this._lampBloomTweens = [];
      this.lampGlows.forEach((l) => l.setTint(0xffd68a));
      return;
    }
    this._lampBloomTweens = [];
    this.lampGlows.forEach((l, i) => {
      if (l._baseScale === undefined) l._baseScale = 1.0;
      if (l._baseAlpha === undefined) l._baseAlpha = l.alpha;
      const tw = this.tweens.add({
        targets: l,
        scale: l._baseScale * this._lampNightScale() * 1.35,
        alpha: Math.min(1, l._baseAlpha * 1.6),
        duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: i * 80,
      });
      l.setTint(0xffd68a);
      this._lampBloomTweens.push(tw);
    });
  }
  _stopLampBloom() {
    if (!this.lampGlows) { this._lampBloomTweens = []; return; }
    for (const tw of this._lampBloomTweens || []) { if (tw) tw.stop(); }
    this._lampBloomTweens = [];
    for (const l of this.lampGlows) {
      this.tweens.killTweensOf(l);
      l.setScale((l._baseScale === undefined ? l.scaleX : l._baseScale) * this._lampNightScale());
      l.setAlpha(l._baseAlpha === undefined ? l.alpha : l._baseAlpha);
      // SF29: PlanetScene keeps zero tint-clearing calls anywhere — hand the
      // lamp back to its untinted look with the neutral white tint instead.
      l.setTint(0xffffff);
    }
  }

  // ── ROADMAP A1 'The first bell' ────────────────────────────────────────
  // Festival dawn: the old mission bell rings over the plaza. The bell sprite
  // swings ±6° with four yoyo swings, a chime plays, and one toast line marks
  // the beat. Self-cleaning: tweens die + the bell resets to 0°.
  _ringBell() {
    const bt = this.bellTower;
    if (!bt || !bt.active) return;
    if (this.audio) this.audio.sfx('star', { volume: 0.5 });
    this.tweens.killTweensOf(bt);
    bt.setAngle(0);
    // SF49: reduced motion skips the bell swing — the chime and toast still mark
    // the beat.
    if (reducedMotion()) { this.showToast('The old bell rings over the plaza.'); return; }
    this.tweens.add({
      targets: bt, angle: 6, duration: 170, yoyo: true, repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => bt.setAngle(0),
    });
    this.showToast('The old bell rings over the plaza.');
  }

  // SPACE near the tower → ONE lore line (never a signpost, never a menu).
  _showBellLore() {
    if (this.audio) this.audio.sfx('glow', { volume: 0.35 });
    this.showToast('Cast before the colony, older than anyone remembers. It rings when the colony gathers.', { duration: 5200 });
  }

  // The climax beat: 3 Earth Feast Plates served → the plaza erupts.
  _feastPeakBurst() {
    const px = FEST_PLAZA.x * T + T / 2, py = FEST_PLAZA.y * T + T / 2;
    // chime + confetti (tweened colored bits — no particle texture needed)
    if (this.audio) this.audio.sfx('star');
    for (let i = 0; i < 90; i++) {
      const x = px + (Math.random() - 0.5) * 40;
      const y = py - 30 - Math.random() * 20;
      const bit = this.add.image(x, y, texAt('fest.confetti', i % 3))
        .setDepth(600).setRotation(Math.random() * Math.PI).setScale(0.8 + Math.random() * 0.6);
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
      this._popReward(this.playerSpr.x, this.playerSpr.y - 46, 'QUEST COMPLETE', '#f7d698');
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

  // [SF28] season banner — a felt year turn when the server calendar rolls over
  // into a new season. First sync stays silent (this._shownSeason is undefined).
  _seasonBanner(season) {
    const { width, height } = this.game.config;
    const SUBTITLES = [
      'Thaw on the ridge — sow wheat and tomatoes.',   // SPRING
      'Long light — berries and melons ripen.',        // SUMMER
      'Harvest moon — peppers and wheat again.',       // FALL
      'Cold stars — only glow-kelp grows now.',        // WINTER
    ];
    const name = SEASON_NAMES[season] || 'SPRING';
    const sub = SUBTITLES[season] || SUBTITLES[0];
    // ART-07 — a painted season plate fills the screen behind the banner (falls
    // back to the plain banner when the PNG is missing). The banner drops to the
    // lower third so it doesn't sit on the painting's focal point.
    const art = paintedBackdrop(this, SEASON_PLATES[season] || SEASON_PLATES[0], width / 2, height / 2, width, height);
    if (art) art.setDepth(1499).setScrollFactor(0).setAlpha(0);
    const c = this.add.container(width / 2, art ? Math.round(height * 0.74) : height / 2 - 60)
      .setDepth(1500).setScrollFactor(0).setAlpha(0);
    const plate = this.add.graphics();
    plate.fillStyle(0x0c1019, 0.88);
    plate.fillRoundedRect(-240, -56, 480, 112, 12);
    plate.lineStyle(2, 0x67e1cd, 1);
    plate.strokeRoundedRect(-240, -56, 480, 112, 12);
    c.add(plate);
    c.add(this.add.text(0, -26, `${name} HAS COME`, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '24px', color: '#f7d698', align: 'center',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5));
    c.add(this.add.text(0, 22, sub, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '13px', color: '#e6f6f2', align: 'center',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5));
    c.setVisible(false);
    this._bannerActive = true;   // SF62 — the reckoning queues BEHIND the banner
    // defer the draw so brand-new container children settle before fading
    this.time.delayedCall(30, () => {
      c.setVisible(true);
      if (this.audio) this.audio.sfx('star');
      this.tweens.add({ targets: c, alpha: 1, duration: 400 });
      this.tweens.add({
        targets: c, alpha: 0, duration: 600, delay: 2600,
        onComplete: () => c.destroy(),
      });
      if (art) {
        this.tweens.add({ targets: art, alpha: 1, duration: 400 });
        this.tweens.add({ targets: art, scale: art.scale * 1.04, duration: 3600 });
        this.tweens.add({ targets: art, alpha: 0, duration: 600, delay: 2600, onComplete: () => art.destroy() });
      }
      // SF62 — the banner owns the screen until its fade completes (400 fade +
      // 2600 hold + 600 fade = 3600ms); the reckoning queues behind it.
      this.time.delayedCall(3600, () => { this._bannerActive = false; });
    });
  }

  // ── SF62 'Season Reckoning' — the season's-end screen (human face of the
  // same reckoning the agent season gets). Screen-anchored (scrollFactor 0,
  // depth 1650): a dark colony plate with a teal stroke, the title in amber,
  // the reckoning lines in cream wrapped to the panel width, and a slate
  // footer. Reward-neutral: no score, no grade, no reward rides on it.
  _showReckoning(payload) {
    const { width, height } = this.game.config;
    this.showingReckoning = true;
    if (this.reckoningPanel) this.reckoningPanel.destroy(true);
    this.reckoningPanel = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(1650);
    // ART-06: the season closes over a painted end-of-harvest dusk
    const reckBg = paintedBackdrop(this, 'reckoning', 0, 0, width, height);
    if (reckBg) {
      this.reckoningPanel.add(reckBg);
      if (!reducedMotion()) { reckBg.setAlpha(0); this.tweens.add({ targets: reckBg, alpha: 1, duration: 900 }); }
    }
    const plate = this.add.graphics();
    plate.fillStyle(0x0c1019, 0.92);
    plate.fillRoundedRect(-260, -152, 520, 300, 12);
    plate.lineStyle(2, 0x67e1cd, 1);
    plate.strokeRoundedRect(-260, -152, 520, 300, 12);
    this.reckoningPanel.add(plate);
    // QA hook + server payload both work: a raw record (credits/lifetime/
    // contactChoices) is built through the SAME StoryBank prose the server uses;
    // a finished payload {title, lines} renders as delivered.
    const p = (payload && payload.lines) ? payload : story.reckoning.buildReckoning(payload || {});
    const title = this.add.text(0, -128, p.title || 'The season is over.', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '20px', color: '#f7d698', align: 'center',
      wordWrap: { enable: true, width: 480 },
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.reckoningPanel.add(title);
    this.reckoningTitle = title;
    // the reckoning lines: cream, wrapped to the panel width, stacked downward
    this.reckoningLines = [];
    const lines = Array.isArray(p.lines) ? p.lines : [];
    let y = -104;
    for (const line of lines) {
      const txt = this.add.text(-240, y, String(line || ''), {
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
        fontSize: '12px', color: '#e6f6f2', lineSpacing: 4,
        wordWrap: { enable: true, width: 480 },
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0, 0);
      this.reckoningPanel.add(txt);
      this.reckoningLines.push(txt);
      y += Math.max(16, txt.height + 4);
    }
    // the footer in slate: SPACE hands the season to the keeper
    const footY = Math.min(122, y + 10);
    const foot = this.add.text(-240, footY, 'SPACE — the new season begins', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '12px', color: '#7c95a6',
    }).setOrigin(0, 0);
    this.reckoningPanel.add(foot);
    this.reckoningFoot = foot;
    this._layoutReckoning();
    this.updateHUD();
  }

  // Re-stack the wrapped lines (text heights settle after creation; this is
  // idempotent so an upgrade reply or a resize can relayout safely).
  _layoutReckoning() {
    if (!this.reckoningLines || !this.reckoningLines.length) return;
    let y = -104;
    for (const kept of this.reckoningLines) {
      kept.setY(y);
      y += Math.max(16, (kept.height || 16) + 4);
    }
    if (this.reckoningFoot) this.reckoningFoot.setY(Math.min(122, y + 10));
  }

  // The reckoning arrives with the daySummary on a season boundary; the
  // banner goes first, the reckoning follows once the banner fades (1.5s).
  _queueReckoning(d) {
    if (!d) return;
    const token = ++this._reckSeq;   // a later close supersedes a queued reckoning
    if (this._bannerActive) {
      this.time.delayedCall(1500, () => {
        if (this._reckSeq === token && !this._bannerActive) this._showReckoning(d);
      });
    } else {
      this._showReckoning(d);
    }
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
    // SF62 — the season's-end reckoning arrives with the daySummary (the server
    // sends both on the day the calendar rolls into a new season). The banner
    // runs first; the reckoning follows once the banner's fade completes.
    window.SpaceFarmer.onSeasonReckoning = (d) => this._queueReckoning(d);
    // [SF62] QA hook: show the reckoning screen from any payload, any time
    window.SpaceFarmer.showReckoning = (p) => this._showReckoning(p);
    // [SF28] QA hook: raise the season banner manually (0..3)
    window.SpaceFarmer.seasonBanner = (s) => this._seasonBanner(s);
    // [SF30] QA hook: fire the water glint at a tile (dew motes rising)
    window.SpaceFarmer.waterGlint = (x, y) => this._waterGlint(x, y);
    // SF51 QA hook: open the Companion Corridor agent day screen from anywhere
    window.SpaceFarmer.openCorridor = () => this.openCorridorPanel();
    // [SF29] QA hook: re-grade the ground/flora palette for a season (0..3)
    window.SpaceFarmer.setSeasonGrade = (s) => this.applySeasonGrade(s);
    // [SF35] QA hook: how many stardust motes are drifting (≥ 30 live)
    window.SpaceFarmer.stardustCount = () => (this.stardust ? this.stardust.length : 0);
    // [SF37] QA hook: play the arrival flash on a live envoy (index, default 0)
    window.SpaceFarmer.envoyArrival = (i = 0) => {
      const list = this.alienSprites;
      return this._envoyArrival(list && list[i] ? list[i] : null);
    };
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
    // ROADMAP A3 — 'Daily rumor lines': one colony gossip line rides the tail
    // of the morning card, in BOTH variants (ledgered and quiet). The pick is
    // deterministic per day from the StoryBank (shared/story/rumors.js).
    const rumor = 'Rumor: ' + story.rumors.rumorForDay(d.day);
    const { width } = this.game.config;
    const card = this.add.text(width / 2, 108, head + '\n' + body + '\n' + rumor, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#cfe8ff',
      align: 'center', lineSpacing: 6, backgroundColor: '#0a0f1fee', padding: { x: 14, y: 8 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1100).setAlpha(0);
    // The rumor tail: italic-ish TEAL colony voice pinned to the bottom of the
    // screen — slate card above it, gossip beneath it, both fading together.
    const { height } = this.game.config;
    const rumorLine = this.add.text(width / 2, height - 24, rumor, {
      fontFamily: "'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px',
      color: '#67e1cd', align: 'center',
      backgroundColor: '#0a0f1fdd', padding: { x: 12, y: 4 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1100).setAlpha(0);
    this.tweens.add({ targets: rumorLine, alpha: 1, duration: 500 });
    this.tweens.add({ targets: rumorLine, alpha: 0, duration: 800, delay: 4300, onComplete: () => rumorLine.destroy() });
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
    const animals = this.animals || {};
    const inv = this.inventory || {};
    this.ranchContent.setPosition(0, -100);   // header above the tap rows; [CLOSE] stays at the foot
    this.ranchContent.setText(`SPACE RANCH — tap a row (or [1-3]/[F]/[S])   ·   ${this.credits ?? '—'} CR on hand`);
    this._panelRows('_ranchTapRows', [
      { label: '[1] BUY CHICKEN', item: 'chicken', hot: true, sub: `100 CR · eggs · own ${animals.chicken || 0}` },
      { label: '[2] BUY COW', item: 'cow', hot: true, sub: `350 CR · milk · own ${animals.cow || 0}` },
      { label: '[3] BUY SHEEP', item: 'sheep', hot: true, sub: `300 CR · wool · own ${animals.sheep || 0}` },
      { label: '[F] FEED ALL', item: 'feed', hot: true, sub: 'daily — fed animals produce tomorrow' },
      { label: '[S] SELL PRODUCTS', item: 'sell', hot: true, sub: `egg×${inv.egg || 0} milk×${inv.milk || 0} wool×${inv.wool || 0}` },
    ], (d) => {
      if (d.item === 'chicken') this.buyAnimal('chicken');
      else if (d.item === 'cow') this.buyAnimal('cow');
      else if (d.item === 'sheep') this.buyAnimal('sheep');
      else if (d.item === 'feed') this.feedAnimals();
      else this.sellProducts();
    }, { panelKey: 'ranchPanel', rowH: 32, gap: 7, top: -30 });
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
        if (this.audio) this.audio.sfx('sell', { volume: 0.4 });   // SF25 coin ping
        this._popReward(this.playerSpr.x, this.playerSpr.y - 40, `+${r.credits} CR`, '#f7d698');
        this.showToast(`Sold 1 ${item} for +${r.credits} CR.`);
      } else {
        this.showToast('Nothing sold — the ledger held tight.');
      }
      this.updateHUD();
      if (this.showingRanch) this.openRanch();
    });
  }

  // ── Tool upgrade: spend credits at the smithy to raise a tool's tier.
  //    Server-authoritative (onUpgradeTool). `tool` defaults to 'hoe' for
  //    legacy callers (the old single-hoe upgrade path). ──
  upgradeTool(tool) {
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) { this.showToast('Offline — the smithy is closed.'); return; }
    if (this._smithyBusy) return;
    this._smithyBusy = true;
    net.request('upgradeTool', { tool: tool || 'hoe' }).then(r => {
      this._smithyBusy = false;
      if (r && r.ok) {
        this.toolTiers = this.toolTiers || {};
        this.toolTiers[r.tool] = r.tier;
        if (r.tool === 'hoe') this.tool = r.tier;    // keep the legacy alias honest
        if (this.audio) this.audio.sfx('confirm');
        this.showToast(`Upgraded to the ${r.name}! ${r.credits} CR left.`);
      } else if (r && r.reason === 'not-enough-credits') {
        const def = SMITHY_TOOLS[r.tool];
        this.showToast(`Need ${r.need} CR to upgrade the ${def ? def.label : 'tool'}.`);
      } else if (r && r.reason === 'max-tier') {
        this.showToast('This tool is already the finest in the colony.');
      } else if (r && r.reason === 'no-upgrade') {
        this.showToast('There is no further upgrade for that tool.');
      } else {
        this.showToast('Could not upgrade.');
      }
      if (this.showingSmithy) this._renderSmithy();
      if (this.showingReckoning) this._layoutReckoning();
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
      `CHEST — TAP A ROW (or [1-4])   ·   stash harvests at home`
    );
    const invKinds = Object.keys(inv).filter(k => (inv[k] || 0) > 0).length;
    const stKinds = Object.keys(st).filter(k => (st[k] || 0) > 0).length;
    this._panelRows('_chestTapRows', [
      { label: '[1] DEPOSIT A CROP', action: 'deposit', kind: 'crop', sub: `${invKinds} kinds in inventory` },
      { label: '[2] DEPOSIT A FISH', action: 'deposit', kind: 'fish', sub: 'stash 1 fish' },
      { label: '[3] WITHDRAW A CROP', action: 'withdraw', kind: 'crop', sub: `${stKinds} kinds stored` },
      { label: '[4] WITHDRAW A FISH', action: 'withdraw', kind: 'fish', sub: 'take 1 fish' },
    ], (d) => {
      if (d.action === 'withdraw') this.withdrawFromChest(d.kind);
      else this.depositToChest(d.kind);
    }, { panelKey: 'chestPanel', rowH: 30, gap: 4, top: 22, width: 320 });
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
    // tool gate: casting needs the FISHING ROD equipped (share the rule with
    // the server + RL env); J / hub / A-with-rod all land here.
    if (this.equipped !== 'rod') { this.showToast('Equip the FISHING ROD (backpack) to cast.'); return; }
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const net = window.SpaceFarmer.net;
    // two fishing spots: stardust shore (common) and the deep drop (rare)
    const d1 = Math.hypot(px - 27, py - 22), d2 = Math.hypot(px - 38, py - 21);
    let spot = null;
    if (d1 <= 3.5) spot = 'stardust';
    else if (d2 <= 3.5) spot = 'deep';
    if (!spot) {
      this._pingSpot(27, 22, 'STARDUST SHORE');
      this.showToast('No water here — fish from the lake shore (east).');
      return;
    }
    if (!net || !net.connected) { this.showToast('Offline — no fishing.'); return; }
    if (this.casting) return;                       // one cast at a time
    this.casting = true;
    if (this.audio) this.audio.sfx('space', { volume: 0.3 });
    if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setActivity('fishing');
    const isNight = !!this.isNight;
    const epCost = this._energyCost('fish', 10);     // rod tier cuts the casting cost
    this.showToast(`🎣 Casting ${spot === 'deep' ? 'into the deep drop' : 'at the stardust shore'}${isNight ? ' (night)' : ''}... (~${epCost} EP)`);
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
          if (this.audio) this.audio.sfx('fish_catch', { volume: 0.45 });   // SF25 rising catch
          this._fishCatch(r.item, r.worth, `season ${this._seasonName()} night fish`);   // popup
        } else if (r.reason === 'nothing-biting') this.showToast('Nothing biting here at this time of year/day. Try a different spot, season, or come back at night.');
        else if (r.reason === 'low-energy') { if (this.audio) this.audio.sfx('tired', { volume: 0.45 }); this.showToast('Too tired to fish. Sleep to recover energy.'); }
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
    const c = this.add.container(width / 2, height / 2 - 90).setDepth(999).setScrollFactor(0);
    const panel = this.add.rectangle(0, 0, 340, 104, 0x101a26, 0.92).setStrokeStyle(2, 0x39c5bb);
    const title = this.add.text(0, -32, 'CAUGHT', { fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#39c5bb' }).setOrigin(0.5);
    const fishTxt = this.add.text(0, -6, label, { fontFamily: "system-ui,'Segoe UI'", fontSize: '19px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    const worthTxt = this.add.text(0, 20, `+${worth} CR to your inventory`, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#9ddd72' }).setOrigin(0.5);
    const kids = [panel, title, fishTxt, worthTxt];
    if (note) { const nt = this.add.text(0, 38, note, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8d8d8' }).setOrigin(0.5); kids.push(nt); }
    c.add(kids);
    c.setScale(0.6);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.out' });
    this.time.delayedCall(2000, () => this.tweens.add({ targets: c, alpha: 0, y: height / 2 - 140, duration: 300, onComplete: () => c.destroy() }));
    this._popReward(this.playerSpr.x, this.playerSpr.y - 40, `+1 ${label}`, '#6be7d0');
    this._popReward(this.playerSpr.x + 14, this.playerSpr.y - 28, `+${worth} CR`, '#f7d698');
  }
  // per-frame: floating hint near EITHER fishing spot so it's discoverable
  _updateFishHint() {
    if (!this.fishHint) return;
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const d1 = Math.hypot(px - 27, py - 22), d2 = Math.hypot(px - 38, py - 21);
    let near = false, label = '';
    if (d1 <= 3.5 && !this.casting) { near = true; label = 'CAST · stardust shore (rod in hand)'; }
    else if (d2 <= 3.5 && !this.casting) { near = true; label = 'CAST · deep drop (rare · night fish)'; }
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
    // tool gate: swinging needs the PICKAXE equipped (server + RL env rule).
    if (this.equipped !== 'pickaxe') { this.showToast('Equip the PICKAXE (backpack) to mine.'); return; }
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const d = Math.hypot(px - this.mineX, py - this.mineY);
    const net = window.SpaceFarmer.net;
    if (d > 4) {
      this._pingSpot(this.mineX, this.mineY, 'ASTEROID VEIN');
      this.showToast('The ore vein is in the mine (south-west).');
      return;
    }
    if (!net || !net.connected) { this.showToast('Offline — no mining.'); return; }
    if (this.casting2) return;                    // one swing at a time (keep picking)
    this.casting2 = true;
    if (this.audio) this.audio.sfx('mine_hit', { volume: 0.45 });   // SF25 pick clack
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
      if (r.reason === 'low-energy') { if (this.audio) this.audio.sfx('tired', { volume: 0.45 }); this.showToast('Too tired to mine. Sleep to recover energy.'); return; }
      if (r.broken) {
        if (this.audio) this.audio.sfx('ore', { volume: 0.45 });   // SF25 vein collapse
        this._splash(rx, ry - 14, 0xd8a05a);         // rock collapses open
        this._showMineProgress(0, 0);
        if (r.item) this._oreCatch(r.item, r.worth, `broke through a ${r.max}-swing vein`);
        this._popReward(rx, ry - 18, `+${r.worth} CR · ${String(r.item || 'ore').replace(/-/g, ' ')}`, '#f7d698');
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
      this.mineProgTxt = this.add.text(0, 16, '', { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#ffe9a0' }).setOrigin(0.5);
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
    const c = this.add.container(width / 2 - 90, height / 2 - 90).setDepth(999).setScrollFactor(0);
    const panel = this.add.rectangle(0, 0, 340, 104, 0x101a26, 0.92).setStrokeStyle(2, 0x67e1cd);
    const title = this.add.text(0, -32, 'MINED', { fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#d8a05a' }).setOrigin(0.5);
    const oreTxt = this.add.text(0, -6, label, { fontFamily: "system-ui,'Segoe UI'", fontSize: '19px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    const worthTxt = this.add.text(0, 20, `+${worth} CR ore to inventory`, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#9ddd72' }).setOrigin(0.5);
    if (note) { const noteTxt = this.add.text(0, 40, note, { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8d8d8' }).setOrigin(0.5); c.add(noteTxt); }
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
    // mobile parity: ▲/▼ pick a dish, COOK makes it, CLOSE leaves — desktop
    // arrows/SPACE/C still work; rows re-render on every pick so the ▶ shows.
    if (this._recipeTapG) { for (const o of this._recipeTapG) o.destroy(); }
    this._recipeTapG = [];
    const mkBtn = (label, x, w, cb) => {
      const r = this.add.rectangle(x, 150, w, 26, 0x132432, 0.94)
        .setStrokeStyle(1, 0xd8a05a).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, 150, label, {
        fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5);
      r.on('pointerdown', cb);
      this.recipePanel.add([r, t]);
      this._recipeTapG.push(r, t);
    };
    mkBtn('▲', -140, 70, () => this._moveRecipeCursor(-1));
    mkBtn('▼', -70, 70, () => this._moveRecipeCursor(1));
    mkBtn('COOK', 40, 110, () => this._cookRecipeAt(this._recipeSel));
    mkBtn('CLOSE', 146, 90, () => this.closeAllPanels());
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
    lines.push('[▲▼] pick   [SPACE] cook   [C] close   (tap ▲▼/COOK on touch)');
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

  // ── Interior rooms (Harvest Moon quarters) — one room per building kind:
  //    home / shop / tavern / exchange / ranch each get a real room behind the
  //    door. Built lazily on first entry, cached per kind.
  buildRoom(kind) {
    const { width, height } = this.game.config;
    const stage = this.add.container(0, 0).setDepth(500).setVisible(false);
    stage.setScrollFactor(0);          // fixed to the screen, not the world
    const cx = width / 2, cy = height / 2;
    const W = 480, H = 340, wallH = 104;
    const top = cy - H / 2;

    // backdrop (full-viewport dim to mask the world behind)
    stage.add(this.add.rectangle(cx, cy, width, height, 0x000000, 0.82));
    // QA 0904B.7: the room used to sit centred in a raw black void with stray
    // asteroid sprites bleeding through the 82% dim. The interior now sits on
    // a habitat hull: an opaque deck apron larger than the room (so black never
    // touches the room edge), a teal hull ring stroke and an airlock collar at
    // the door. Asteroid/world-only sprites are hidden on entry (enterInterior).
    stage.add(this.add.rectangle(cx, cy, W + 140, H + 120, 0x0e1620, 1));      // dim deck apron
    stage.add(this.add.rectangle(cx, cy, W + 140, H + 120)
      .setStrokeStyle(2, 0x67e1cd, 0.55).setFillStyle(0x0e1620, 0.001));       // hull ring
    stage.add(this.add.rectangle(cx + W / 2 - 30, cy + H / 2 - 24, 76, 54, 0x10161f, 1)
      .setStrokeStyle(1, 0x6be7d0, 0.5));                                      // airlock collar
    // room shell — slate panelled wall (teal trim) + machined metal deck floor
    stage.add(this.add.image(cx, top + wallH / 2, tex('int.wall')).setScale(W / 96, wallH / 24));
    stage.add(this.add.image(cx, top + wallH + (H - wallH) / 2, tex('int.floor')).setScale(W / 96, (H - wallH) / 24));
    // QA 0904 Stage 3.3: every light pool gets a VISIBLE SOURCE. A pool with no
    // fixture over it reads as a grey blob on the floor (the QA complaint), so
    // each pool now hangs under a drawn ceiling lamp — stem, shade, hot emitter.
    // Round-2 lesson: a lamp 80px above a 150px-wide pool does not READ as its
    // source either — association is geometry. The fixture rides on the wall
    // band, the pool centre sits one pool-height under the emitter, and the
    // pool is narrow enough that a vertical line from lamp lands inside it.
    // Scale note: the shell draws its textures ~5x (W/96), so fx.lamp_glow's
    // 16 native px must ride at ~5x too — at 1.9 it was a 30px dot in a 480px
    // room and read as nothing. Pool ≈ 83x54, TOP EDGE meeting the fixture's
    // emitter so the vertical lamp→pool line never breaks. WARM TINT matters:
    // fx.lamp_glow's own core over the blue-slate deck composites near-neutral
    // at low alpha (measured [107,115,116] — grey!), so the pool is tinted
    // amber [255,190,90] and pushed to an alpha that measurably flips r>b.
    const hang = (px_, poolCy) => {
      stage.add(this.add.image(px_, top + wallH - 26, 'int.ceilingLight').setScale(4.3));
      stage.add(this.add.image(px_, top + wallH - 4, 'fx.lamp_glow')
        .setBlendMode(Phaser.BlendModes.ADD).setScale(2.6, 1.2).setTint(0xffbe5a).setAlpha(0.30));
      stage.add(this.add.image(px_, poolCy, 'fx.lamp_glow')
        .setBlendMode(Phaser.BlendModes.ADD).setScale(5.2, 3.4).setTint(0xffbe5a).setAlpha(0.32));
    };
    hang(cx - 30, top + wallH + 22);
    hang(cx + 90, top + wallH + 34);
    // window (against far wall) — glows with the sky
    stage.add(this.add.image(cx, top + 44, 'int.window').setScale(0.9));
    const windowGlow = this.add.image(cx, top + 46, 'fx.lamp_glow')
      .setBlendMode(Phaser.BlendModes.ADD).setScale(2.3, 1.2).setAlpha(0.10).setDepth(-1);
    stage.add(windowGlow);

    const room = { stage, W, H, cx, cy, windowGlow, points: [] };

    // the door (exit) — teal airlock sprite on the bottom edge
    const doorImg = this.add.image(cx + W / 2 - 30, cy + H / 2 - 24, 'int.door').setScale(0.8);
    stage.add(doorImg);
    room.door = { x: cx + W / 2 - 30, y: cy + H / 2 - 24 };
    room.points.push({ x: room.door.x, y: room.door.y, action: 'exit' });
    stage.add(this.add.text(cx + W / 2 - 30, cy + H / 2 - 58, 'DOOR', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#ffe9a0', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5));

    // interior player (drawn inside the room)
    const ip = this.add.image(cx, cy + H / 2 - 65, 'player.front').setScale(0.5);
    ip.setDepth(10);
    stage.add(ip);
    room.player = ip;
    room.shadow = this.add.image(ip.x, ip.y + 14, 'fx.shadow').setDepth(9);
    stage.add(room.shadow);

    // kind-specific props (colony habitat language, grounded + interaction points)
    this._decorateRoom(kind, room, stage);

    this.intRooms[kind] = room;
    return room;
  }

  // decorate a room kind with its props + interaction points
  _decorateRoom(kind, room, stage) {
    const { cx, cy, W, H } = room;
    const put = (x, y, key, scale, action) => {
      // QA fix: props used to hover on the deck with nothing beneath them and
      // read as floating cards. Every placed prop now gets a soft contact
      // shadow at its footprint (light reads from the window, upper-left),
      // so furniture sits ON the floor.
      const img = this.add.image(x, y, key).setScale(scale);
      const w = (img.width || 32) * scale, h = (img.height || 32) * scale;
      const sh = this.add.image(x + Math.round(w * 0.06), y + Math.round(h * 0.5) - 2, 'fx.shadow')
        .setScale(Math.max(0.55, (w / 34) * 0.9), Math.max(0.35, (h / 60) * 0.8))
        .setAlpha(0.55).setDepth(img.depth - 0.2);
      stage.add(sh);
      img.setData({ contactShadow: sh });
      stage.add(img);
      if (action) room.points.push({ x, y, action });
      return img;
    };
    // same grounding as put() for props placed without an interaction point
    const putG = (x, y, key, scale = 1) => put(x, y, key, scale);
    const label = (x, y, text, size) => stage.add(this.add.text(x, y, text, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: size, color: '#ffe9a0',
    }).setOrigin(0.5));
    // QA 0904 Stage 3.4: every room gets a named holosign over its service
    // point — a lit plate housing + the room's WORD as real text, so a player
    // reads SHOP/BAR/TRADE at a glance instead of guessing from furniture.
    // Round 1 shipped fake amber glyph bars on the plate that COLLIDED with
    // the label text underneath and read as noise; the plate now carries only
    // the housing + a teal 'open' pip, and this helper draws the word itself.
    const sign = (x, y, name) => {
      stage.add(this.add.image(x, y, 'int.signplate').setScale(1));
      stage.add(this.add.text(x - 2, y, name, {
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', fontStyle: 'bold',
        color: '#f2d9a2', stroke: '#061116', strokeThickness: 3,
      }).setOrigin(0.5));
    };
    if (kind === 'home') {
      // rug, bookcase, plant, table — the one room that gets a hearthome feel
      stage.add(this.add.image(cx, cy + 30, 'int.rug').setScale(1));
      sign(cx, cy - H / 2 + 66, 'HOME');                    // lit sign over the galley wall
      putG(cx - W / 2 + 55, cy - 40, 'int.bookcase', 0.9);
      const plant = put(cx + W / 2 - 55, cy + 20, 'int.plant', 0.9);
      room.plant = plant; room.plantBaseY = cy + 20;
      putG(cx, cy - H / 2 + 90, 'int.table', 0.9);
      // two stools at the kitchen table so the room reads lived-in
      putG(cx - 34, cy - H / 2 + 116, 'int.stool', 0.85);
      putG(cx + 34, cy - H / 2 + 116, 'int.stool', 0.85);
      // stove (cook 2 crops → 1 cooked-food) — colony galley
      put(cx + W / 2 - 55, cy - H / 2 + 40, 'int.stove', 1, 'recipes');
      label(cx + W / 2 - 55, cy - H / 2 + 6, 'STOVE (recipes)', '10px');
      // chest (deposit/withdraw harvests) — colony cargo pod
      put(cx - W / 2 + 22, cy - 40, 'int.chest', 0.9, 'chest');
      label(cx - W / 2 + 22, cy - 68, 'CHEST', '10px');
      // bed — your sleep spot (lower-left)
      put(cx - W / 2 + 65, cy + H / 2 - 55, 'int.bed', 1.1, 'sleep');
      label(cx - W / 2 + 65, cy + H / 2 - 88, 'SLEEP (SPACE)', '10px');
      // spouse: moves in when you marry (sits near the table)
      const spouse = this.add.image(cx + 95, cy + 42, 'player.front').setDepth(8);
      spouse.setVisible(false);
      stage.add(spouse);
      room.spouse = spouse; room.spouseBaseY = cy + 42;
      stage.add(this.add.text(cx + 95, cy + 14, '', {
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#ffe9a0',
      }).setOrigin(0.5));
      stage.add(this.add.text(cx, cy - H / 2 + 78, 'SLEEP IN YOUR BED (SPACE)', {
        fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#b8c0e0',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5));
    } else if (kind === 'shop') {
      // GROCER layout: counter front-left, a stocked shelf WALL on the right,
      // produce crates fanning toward the door — reads as commerce, not storage.
      sign(cx - W / 2 + 55, cy - 82, 'SHOP');                 // lit sign over the counter
      put(cx - W / 2 + 55, cy - 40, 'int.counter', 1, 'shop');
      label(cx - W / 2 + 55, cy - 68, 'COUNTER (BUY)', '10px');
      putG(cx + W / 2 - 46, cy - 52, 'int.shelf', 1.05);       // merchandise wall
      putG(cx + W / 2 - 58, cy + 26, 'int.chest', 0.85);       // overstock pod
      putG(cx - W / 2 + 24, cy + 30, 'int.chest', 0.8);        // produce crate
      putG(cx - W / 2 + 62, cy + 34, 'int.plant', 0.8);        // door greening
    } else if (kind === 'tavern') {
      // CANTINA layout: bar runs across the back wall with a bottle shelf behind
      // it, stools at the bar, two seated tables forward — the room is for people.
      putG(cx - W / 2 + 118, cy - 74, 'int.barback', 1.0);      // bottle shelf behind the bar
      sign(cx - W / 2 + 118, cy - 108, 'TAVERN');               // lit sign over the bar
      put(cx - W / 2 + 118, cy - 40, 'int.counter', 1, 'talk_rhea'); // bar
      label(cx - W / 2 + 118, cy - 96, 'BAR (RHEA)', '10px');
      putG(cx - W / 2 + 86, cy - 14, 'int.stool', 0.9);
      putG(cx - W / 2 + 150, cy - 14, 'int.stool', 0.9);
      putG(cx - 52, cy + 38, 'int.table', 0.85);
      putG(cx - 78, cy + 58, 'int.stool', 0.85);
      putG(cx - 26, cy + 58, 'int.stool', 0.85);
      putG(cx + 62, cy + 30, 'int.table', 0.85);
      putG(cx + 36, cy + 50, 'int.stool', 0.85);
      putG(cx + 88, cy + 50, 'int.stool', 0.85);
    } else if (kind === 'exchange') {
      // TRADE-HUB layout: terminal left, a holo market board centre-floor,
      // intake counter right — visibly distinct from the grocer's counter room.
      put(cx - W / 2 + 55, cy - 40, 'int.terminal', 1, 'exchange');
      sign(cx - W / 2 + 55, cy - 82, 'TRADE');               // lit sign over the terminal
      label(cx - W / 2 + 55, cy - 68, 'TERMINAL (TRADE)', '10px');
      putG(cx + 10, cy - 6, 'int.holotable', 1.0);              // market board centrepiece
      put(cx + W / 2 - 55, cy - 44, 'int.counter', 0.95);       // intake counter
      label(cx + W / 2 - 55, cy - 70, 'INTAKE', '10px');
      putG(cx - W / 2 + 26, cy + 34, 'int.chest', 0.85);        // valuation crates
      putG(cx - W / 2 + 64, cy + 40, 'int.chest', 0.8);
    } else if (kind === 'ranch') {
      // RANCH layout: service stall left, two livestock pens right with the
      // actual animals standing in them — the room cannot be mistaken for a shop.
      put(cx - W / 2 + 55, cy - 40, 'int.stall', 1, 'ranch');
      sign(cx - W / 2 + 55, cy - 82, 'RANCH');               // lit sign over the service stall
      label(cx - W / 2 + 55, cy - 68, 'STALL (RANCH)', '10px');
      putG(cx + W / 2 - 62, cy - 56, 'int.pen', 1.0);           // back pen
      putG(cx + W / 2 - 74, cy - 70, 'ranch.chicken', 0.8);     // pen occupant
      putG(cx + W / 2 - 34, cy - 66, 'ranch.sheep', 0.62);      // pen occupant
      putG(cx + 40, cy + 26, 'int.pen', 1.05);                  // front pen
      putG(cx + 40, cy + 8, 'ranch.cow', 0.8);                  // the cow
      putG(cx - W / 2 + 26, cy + 30, 'int.chest', 0.9);         // feed store
      label(cx - W / 2 + 26, cy + 6, 'FEED', '10px');
    } else if (kind === 'barracks') {
      // dormitory bunks — the villagers live here (rows of colony beds)
      sign(cx - W / 2 + 55, cy - 68, 'BUNKS');           // lit sign over the bunk row
      put(cx - W / 2 + 55, cy - 40, 'int.bed', 1);
      label(cx - W / 2 + 55, cy - 68, 'BUNK', '10px');
      put(cx + W / 2 - 55, cy - 40, 'int.bed', 1);
      put(cx - W / 2 + 20, cy + 20, 'int.bed', 1);
      put(cx + W / 2 - 20, cy + 20, 'int.bed', 1);
      stage.add(this.add.image(cx, cy + 20, 'int.table').setScale(0.9)); // mess table
      stage.add(this.add.image(cx - W / 2 + 22, cy + 20, 'int.chest').setScale(0.9)); // footlockers
    }
  }

  enterInterior(kind) {
    if (this.inInterior) return;
    const room = this.intRooms[kind] || this.buildRoom(kind);
    this.inInterior = true;
    this.intKind = kind;
    this.intStage = room.stage;
    this.intPlayer = room.player;
    this.intShadow = room.shadow;
    this.intDoor = room.door;
    this.intPoints = room.points;
    this.intWindowGlow = room.windowGlow;
    this.intPlant = room.plant;
    this.intSpouse = room.spouse;
    this._intPlantBaseY = room.plantBaseY;
    this._intSpouseBaseY = room.spouseBaseY;
    this.intW = room.W; this.intH = room.H; this.intCx = room.cx; this.intCy = room.cy;
    this.world.setVisible(false);
    // QA 0904B.7: world-only sprites (asteroid vein, deep drop rock) live
    // outside the `world` container, so hiding the world doesn't hide them —
    // they leaked into the interior void. Hide + restore on exit.
    this._worldOnlySprites = [this.mineRock, this.deepDrop];
    for (const s of this._worldOnlySprites) if (s) s.setVisible(false);
    room.stage.setVisible(true);
    // place player inside near the door
    this.intPlayer.setPosition(this.intDoor.x + 10, this.intDoor.y + 40);
    if (this.intShadow) this.intShadow.setPosition(this.intPlayer.x, this.intPlayer.y + 14);
    this.refreshInteriorSpouse();
    this.showToast(this._roomToast(kind));
    this.updateHUD();
  }

  _roomToast(kind) {
    return {
      home: this.marriedTo ? 'Welcome home. Your spouse is here.' : 'You step inside your cozy dome.',
      shop: 'The Supply Depot hums — shelves of colony goods.',
      tavern: 'Stardust Tavern — Rhea waves you in.',
      exchange: 'The Grand Exchange — trade terminals flicker.',
      ranch: 'The ranch barn — animals low softly.',
    }[kind] || '';
  }

  exitInterior() {
    if (!this.inInterior) return;
    this.inInterior = false;
    this.intStage.setVisible(false);
    for (const s of (this._worldOnlySprites || [])) if (s) s.setVisible(true);
    this.world.setVisible(true);
    if (this.audio) this.audio.sfx('door', { volume: 0.4 });   // SF25 door puff on the way out
    // back at the building door
    const act = this.intKind === 'home' ? 'sleep'
      : this.intKind === 'tavern' ? 'talk_rhea'
      : this.intKind || 'sleep';
    const bld = BUILDINGS.find(b => b.action === act);
    const door = bld ? bld.door : BUILDINGS[0].door;
    this.playerSpr.setPosition(door.x * T + T / 2, door.y * T + T / 2);
    this.playerShadow.setPosition(this.playerSpr.x, this.playerSpr.y + 14);
    this.showToast('Back outside. The colony hums.');
    this.updateHUD();
  }

  // back-compat aliases
  enterHouse() { this.enterInterior('home'); }
  exitHouse() { this.exitInterior(); }

  // dispatch an interior interaction point's action
  _roomAction(action) {
    if (!action) return;
    switch (action) {
      case 'exit': this.exitInterior(); break;
      case 'sleep': this.sleep(); break;
      case 'recipes': this.openRecipeBook(); break;
      case 'chest': this.openChest(); break;
      case 'shop': this.openShop(); break;
      case 'exchange': this.openGrandExchange(); break;
      case 'ranch': this.openRanch(); break;
      case 'talk_rhea': {
        const rhea = NPCS.find(n => n.id === 'rhea');
        if (rhea) this.startNPCDialogue(rhea);
        break;
      }
      default: this.showToast(this._roomToast(this.intKind));
    }
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

  isBlocked(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    return blocks[ty][tx];
  }

  moveDir(dir) { this.touchDir = dir; }
  stopMove() { this.touchDir = null; }

  // unified action path — the touchbar A-button mirrors SPACE/E on desktop:
  // advance/close dialogue and cutscenes, dismiss panels, or interact with the
  // world. Sharing one method keeps mobile and keyboard play identical.
  _pressAction() {
    if (this.inAlienContact) {
      if (this.contactPhase === 'choice') return;   // pick with the 1-5 keys / future bar
      if (!this._diaDone) this._finishTyping();
      else this.advanceAlienCutscene();
      return;
    }
    if (this.eventQueue) {
      if (!this._diaDone) this._finishTyping();
      else this.advanceEvent();
      return;
    }
    if (this.inDialogue) {
      if (!this._diaDone) this._finishTyping();
      else this.closeAllPanels();
      return;
    }
    if (this.showingHub && this.hub) {
      // mobile A confirms the hub's selected row (parity with keyboard SPACE)
      this.hub.confirm(this.hub.sel);
      return;
    }
    if (this.showingGE || this.showingShop || this.showingRanch || this.showingChest || this.showingQuests || this.showingRecipes || this.showingBackpack || this.showingSmithy || this.showingCorridor || this.showingReckoning) {
      this.closeAllPanels();
      return;
    }
    // Tool-aware action: an equipped rod/pickaxe turns A/SPACE into its craft
    // at the right spot; otherwise the hand does what hands do (interact).
    if (this._useEquippedTool()) return;
    this.handleInteract();
  }

  // ── Held tool sprite: follow the player, show the equipped tool's texture,
  //    and tuck it to the side the player faces (so it reads as "in hand"). ──
  _updateToolSprite() {
    if (!this.toolSpr) return;
    const e = this.equipped;
    this.toolSpr.setVisible(!!e);
    if (!e) return;
    this.toolSpr.setTexture(tex(`tool.${e}`));
    const dx = this.playerDir === 'left' ? -1 : this.playerDir === 'right' ? 1 : 0;
    // QA 0904 Stage 6.3: the held tool used to anchor around the BODY CENTRE at
    // head height (dy 7 with a -3 lift), so a swing rotated the can's spout over
    // the HAT. It now anchors to the HAND ROW — the sprite's hot spot is the
    // lower handle grip (~x30,y44 of 48) and the hand row of a 80px villager is
    // +18 from centre — so swings arc through the hand, never the head.
    this.toolSpr.setPosition(this.playerSpr.x + (dx ? dx * 11 : 7), this.playerSpr.y + 18);
    this.toolSpr.setDepth(this.playerSpr.depth + 0.4);
    this.toolSpr.setFlipX(dx < 0);
    this.toolSpr.setOrigin(0.62, 0.9);
    this.toolSpr.setScale(0.78);
  }

  // ── Swing the held tool: a quick raise-and-settle so a press visibly uses it.
  //    The tilt is POSITIVE (head tips away) so the raised head never crosses the
  //    brow line while the tool rides above the body during the arc. ──
  _swingTool() {
    if (!this.toolSpr || !this.toolSpr.visible) return;
    this.tweens.killTweensOf(this.toolSpr);
    // Hold the working arc long enough to read at normal play speed and in
    // captured footage; the old 130 ms / 26° twitch looked like an equip-only
    // pose at common 12–30 fps recording rates.
    this.toolSpr.setAngle(42);
    this.tweens.add({ targets: this.toolSpr, angle: 0, duration: 260, ease: 'Back.easeOut' });
  }

  // ── Equipped-tool action: only when the tool has a target in range, so a
  //    rod never hijacks talking to an NPC. Field work (hoe/can/harvest) is
  //    handled inside handleTileAction; the shore tap refill lives in
  //    handleInteract. ──
  // SF23: every dead-end now SAYS where to go instead of returning false
  // silently (showToast rate-limits identical lines to once per 2s).
  _useEquippedTool() {
    const e = this.equipped;
    if (!e) return false;                       // hands do the interacting
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    if (e === 'rod') {
      const atShore = Math.hypot(px - 27, py - 22) <= 3.5 || Math.hypot(px - 38, py - 21) <= 3.5;
      if (!atShore) {
        this.showToast('No water here — fish from the lake shore (east).');
        return false;
      }
      this._swingTool();
      this.fish();
      return true;
    }
    if (e === 'pickaxe') {
      if (Math.hypot(px - this.mineX, py - this.mineY) > 4) {
        this.showToast('The ore vein is in the mine (south-west).');
        return false;
      }
      this._swingTool();
      this.mine();
      return true;
    }
    return false;
  }

  update(time) {
    const { width, height } = this.game.config;   // viewport in world coords (meteor/cloud spawn)
    // ── SF30: living fields — every planted crop sways gently from its ROOT.
    // Per-tile phase (position-hash) so neighbours never move in lockstep.
    // SF49: reduced motion crops the sway amplitude to 0 — the field holds
    // still; angle never changes.
    if (this.farmTiles) {
      const swayAmp = reducedMotion() ? 0 : 3;
      for (const ft of this.farmTiles) {
        if (!ft.cropSpr || !ft.cropSpr.active) continue;
        ft.cropSpr.setAngle(Math.sin(time / 700 + (ft.x * 0.9 + ft.y * 1.7)) * swayAmp);
      }
    }
    // SF20: the context prompt chip (throttled ~8×/s) — shows what SPACE/A will
    // do at the resolved target, before the press lands.
    this._updateInteractPrompt(time);
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
    // SF32 aurora undulation: each ribbon drifts on its own slow sine phase
    // (y bounce + gentle scaleY breathing). Cheap transform-only animation.
    // SF49: reduced motion pins both ribbons' transforms to their create-time
    // values — no sine phase advances.
    if (this.auroraOn && this.aurora && !reducedMotion()) {
      const rt = time - (this.auroraTime || time);
      this.aurora.forEach((g, gi) => {
        g.setPosition(0, 6 + Math.sin(rt * 0.00035 + gi * 1.9) * 7);
        g.setScale(1, 1 + 0.09 * Math.sin(rt * 0.00025 + gi * 2.6) + 0.09);
      });
    }
    // SF35 stardust drift: every mote slides diagonally on its own velocity
    // and wraps at the screen edges (dt from the frame clock; cheap alpha-only
    // layer, no textures, so it never fights the HUD).
    // SF49: reduced motion leaves every mote at its deterministic origin —
    // positions are created from the LCG and then never move.
    if (this.stardust && !reducedMotion()) {
      const dtS = Math.min(time - (this._stardustLast || time), 50);
      this._stardustLast = time;
      for (const st of this.stardust) {
        st.x += st._vx * dtS; st.y += st._vy * dtS;
        if (st.x > width + 2) st.x = -2;
        else if (st.x < -2) st.x = width + 2;
        if (st.y > height + 2) st.y = -2;
        else if (st.y < -2) st.y = height + 2;
      }
    }
    // parallax backdrop: locked to screen (single zoomed cam) + gentle drift
    {
      const cam = this.cam;
      const vw = this.bgW / ZOOM, vh = this.bgH / ZOOM;
      const cx = cam.scrollX + vw / 2, cy = cam.scrollY + vh / 2;
      // SF49: reduced motion pins the nebula parallax drift to the exact
      // camera-locked base position (the planets + sun/moon arc stay, so the
      // day cycle keeps working — they are game-mechanic motion, not atmosphere).
      this.nebula.setPosition(reducedMotion() ? cx : cx + Math.sin(time * 0.00008) * 8,
        reducedMotion() ? cy : cy + Math.cos(time * 0.00006) * 6);
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
    const beamTex = Math.floor(time / 500) % 2 === 0 ? tex('decor.fenceBeamA') : tex('decor.fenceBeamB');
    for (const b of this.fenceBeams) b.setTexture(beamTex);
    // water shimmer — each caustic family cycles with its own phase offset so
    // neighbouring tiles never snap to the same frame across the whole lake
    const waterFamily = [0, 1, 2].map((i) => texAt('ground.water', i));
    const waterPhase = Math.floor(time / 600);
    for (const wt of this.waterTiles) wt.img.setTexture(waterFamily[(waterPhase + wt.f) % waterFamily.length]);
    // building animation frames
    for (const bs of this.buildingSprites) {
      if (bs.b.key === 'exchange') bs.img.setTexture(Math.floor(time / 400) % 2 === 0 ? tex('bld.exchange') : tex('bld.exchangeAlt'));
      if (bs.b.key === 'tavern') bs.img.setTexture(texAt('bld.tavern', Math.floor(time / 300) % 3));
    }
    // buildings breathe — windows/doors/signs pulse on their own beat. Day-lit
    // commercial glows breathe too (a lit 'OPEN' facade should still feel alive),
    // so the gate is on the glow's own visibility, not on the night flag.
    if (this.buildingGlows.length) {
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
    // ── Alien idle animation — bioluminescent envoys breathe and their aura
    // SF22 — quest objective marker: chevron over the live target + edge arrow.
    this._updateQuestMarkers(time);
    // ── Alien idle animation — bioluminescent envoys breathe and their aura
    //    pulses on their own phase, so first contact reads as alive, not a sticker.
    if (this.alienSprites) {
      for (const a of this.alienSprites) {
        if (a._arrival) continue;    // SF37 — an arrival tween owns alpha/scaleY right now
        const ph = (a.alienId || 'a').length * 1.7;
        a.y = (a._baseY || a.y) + Math.sin(time * 0.0012 + ph) * 2;
        if (a.setScale) a.setScale(0.9 + 0.02 * Math.sin(time * 0.0016 + ph));
        if (a._aura && a._aura.setAlpha) a._aura.setAlpha(0.24 + 0.12 * Math.sin(time * 0.0016 + ph));
      }
    }
    // ── Festival crowd idle sway — guests bob on their own phase (the singer
    //    keeps its dedicated tween), so the plaza reads as a living crowd.
    if (this.festivalGuests && this._festActive() && !reducedMotion()) {
      for (const g of this.festivalGuests) {
        if (g.singing) continue;
        g.spr.y = g.baseY + Math.sin(time * 0.0016 + g.phase) * 2;
      }
    }

    if (this.inAlienContact || this.inDialogue || this.showingGE || this.showingShop || this.showingRanch || this.showingChest || this.showingQuests || this.showingRecipes || this.showingHub || this.showingBackpack || this.showingSmithy || this.showingCorridor || this.showingReckoning) {
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
      // SF51 'Companion Corridor': ESC/SPACE closes the live agent screen and
      // tears down the SSE connection (es.close()) — the stream dies with the
      // watcher, exactly like the server's res.on('close').
      if (this.showingCorridor && (Phaser.Input.Keyboard.JustDown(this.escKey) || Phaser.Input.Keyboard.JustDown(this.spaceKey))) {
        this.closeAllPanels();
        this.updateHUD(); this.updateNightOverlay(); return;
      }
      // propose / heart-event prompt keys while in normal NPC dialogue
      if (this.inDialogue) {
        if (Phaser.Input.Keyboard.JustDown(this.gKey)) this.handleGift(this.selectedNPC);
        if (Phaser.Input.Keyboard.JustDown(this.pKey)) this.handlePropose(this.selectedNPC);
        if (Phaser.Input.Keyboard.JustDown(this.hKey)) this.toggleHeartEvent(this.selectedNPC);
        // EarthBound "blab" — the portrait's mouth opens/closes while the line
        // types out, and it gently bobs even when idle (never sits still)
        if (this._diaNPC) {
          if (!this._diaDone && !this._diaFace) this.dialoguePortrait.setTexture(`port.${this._diaNPC}_${Math.floor(time / 55) % 3}`);
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
      // ── Colony Hub: keys 1-9 jump straight to a row, arrows move, SPACE/A
      //    confirms, ESC closes — the SAME panel the touch bar drives. ──
      if (this.showingHub && this.hub) {
        const numKeys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey, this.fiveKey];
        numKeys.forEach((k, i) => { if (k && Phaser.Input.Keyboard.JustDown(k)) this.hub.confirm(i); });
        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) this.hub.move(-1);
        else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) this.hub.move(1);
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) this.hub.confirm(this.hub.sel);
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
      }
      // non-dialogue panels close on space/esc
      if (this.lKey && Phaser.Input.Keyboard.JustDown(this.lKey)) this._toggleCodex();
      if (this.showingQuests && this.qKey && Phaser.Input.Keyboard.JustDown(this.qKey)) this.toggleQuestLog();
      // ── Backpack: keys 1-5 equip Hands/Hoe/Can/Pickaxe/Rod; tap rows work on
      //    touch (each row is an interactive rect), and SPACE/ESC/B close. ──
      if (this.showingBackpack) {
        const rowTools = ['', 'hoe', 'watering', 'pickaxe', 'rod'];
        const rowKeys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey, this.fiveKey];
        rowKeys.forEach((k, i) => { if (k && Phaser.Input.Keyboard.JustDown(k)) this.equipTool(rowTools[i]); });
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
      }
      // ── Smithy: keys 1-4 upgrade a tool (same ladder the tap rows use). ──
      if (this.showingSmithy) {
        const smTools = ['hoe', 'watering', 'pickaxe', 'rod'];
        const smKeys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey];
        smKeys.forEach((k, i) => { if (k && Phaser.Input.Keyboard.JustDown(k)) this.upgradeTool(smTools[i]); });
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
      }
      // ── SF62 'Season Reckoning': SPACE/ESC closes the season's-end screen —
      //    the bell hands the season to the keeper, and SPACE opens the next one.
      if (this.showingReckoning) {
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.escKey)) {
          this.closeAllPanels();
          this.updateHUD(); this.updateNightOverlay(); return;
        }
      }
      if (!this.inDialogue && !this.showingHub && (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.escKey))) {
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
      this.intPlayer.setTexture(`player.${this.playerDir}_${fKey}`);
      if (this.intShadow) this.intShadow.setPosition(this.intPlayer.x, this.intPlayer.y + 14);

      // interact inside: route to the room's interaction points
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
        const pts = this.intPoints || [];
        for (const pt of pts) {
          if (Math.hypot(this.intPlayer.x - pt.x, this.intPlayer.y - pt.y) < 60) {
            this._roomAction(pt.action);
            break;
          }
        }
      }

      // ── the room is alive: window light breathes, the plant sways, and a
      // spouse (if any) rocks gently by the table whenever you are home
      if (this.intWindowGlow) {
        this.intWindowGlow.setAlpha(0.07 + 0.07 * Math.sin(time * 0.0016));
      }
      if (this.intPlant && this._intPlantBaseY != null && !reducedMotion()) {
        this.intPlant.y = this._intPlantBaseY + Math.sin(time * 0.0024) * 1.6;
      }
      if (this.intSpouse && this.intSpouse.visible && this._intSpouseBaseY != null && !reducedMotion()) {
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
    this.playerSpr.setTexture(`player.${this.playerDir}_${fKey}`);
    this._updateToolSprite();

    // camera target follows player (world-local → scene coords)
    this.camTarget.setPosition(this.playerSpr.x + this.worldX, this.playerSpr.y + this.worldY);

    // ── interact ── SPACE/E route through the SAME action path the touch-bar A
    //    button uses, so an equipped rod/pickaxe/hoe/can drives its craft exactly
    //    like on mobile (one code path for both inputs).
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this._pressAction();
    }
    // M opens the Colony Hub — the one menu both inputs share (touch bar:
    // MENU). The Grand Exchange is now a PLACE: walk to its building (or pick
    // the row in the hub) rather than a global hotkey.
    if (Phaser.Input.Keyboard.JustDown(this.mKey)) this.toggleHub();
    // SF49: F9 flips reduced motion for this run (reads the two Motion sources:
    // local key first, then prefers-reduced-motion). The scene reads the flag
    // live at every motion site, so the flip takes effect on the next frame.
    if (Phaser.Input.Keyboard.JustDown(this.rmKey)) {
      const next = !reducedMotion();
      setReducedMotion(next);
      this.showToast(`Reduced motion ${next ? 'ON' : 'OFF'}`);
    }
    if (Phaser.Input.Keyboard.JustDown(this.iKey)) this.openShop();
    if (Phaser.Input.Keyboard.JustDown(this.uKey)) this.openSmithy();
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

    // paused/talking: the NPC stands still and faces whoever is talking to them;
    // closeAllPanels flips the flag back and errands resume on the next tick.
    if (b.talking) {
      b.dir = (this.playerSpr.x > b.x) ? 'right' : 'left';
      spr.setPosition(b.x, b.y);
      spr.setDepth(Math.floor(b.y / T) + 0.5);
      spr.setTexture(`npc.${b.id}_${b.dir}_0`);
      if (spr._label) spr._label.setPosition(b.x, b.y - 16);
      return;
    }

    if (b.state === 'idle') {
      if (b.timer <= 0) {
        b.state = 'walk';
        b.walkT = 0;
        this._pickErrand(b);
      }
      spr.setTexture(`npc.${b.id}_0`);
      // idle "breath" — a gentle scale bob so the colony never sits frozen
      // (guarded: the headless test harness may expose a sprite without setScale)
      if (spr.setScale) spr.setScale(1 + 0.02 * Math.sin(time * 0.0018 + (b.id.length * 1.3)));
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
    const cur = b.path && b.path[0];
    if (!cur) { // walk state with no path left (dialogue/teleport cleared it) → idle, never crash update()
      b.path = []; b.state = 'idle'; b.timer = 600 + Math.random() * 1200;
      return;
    }
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

  // night overlay is screen-anchored (scrollFactor 0): keep it sized to the
  // camera's current view (zoom can change) so it always covers the screen
  updateNightOverlay() {
    if (!this.isNight || !this.nightOverlay?.active) return;
    const cam = this.cam;
    this.nightOverlay.setPosition(0, 0);
    this.nightOverlay.setSize(cam.width / cam.zoom, cam.height / cam.zoom);
    this.nightOverlay.setVisible(true);
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
          fontSize: '12px', color: '#ffd6f0',
          stroke: '#000000', strokeThickness: 3,
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
        if (ps.equipped !== undefined) this.equipped = ps.equipped;
        if (typeof ps.waterLevel === 'number') this.waterLevel = ps.waterLevel;
        this.toolTiers = this.toolTiers || {};
        for (const [k, v] of schemaEntries(ps.tools)) this.toolTiers[k] = v;
        // SF33: server-authoritative contact history. Drop stale local keys
        // (they were never chosen by the colony) and re-apply the aftermath for
        // any envoy whose doctrine changed — including choices recorded by
        // ANOTHER player/agent, so they appear beside the envoy live.
        const prevContacts = this.contactChoices || {};
        const serverContacts = Object.fromEntries(schemaEntries(ps.contactChoices));
        this.contactChoices = serverContacts;
        for (const alien of ALIEN_DATA) {
          const prev = prevContacts[alien.scenarioId];
          const now = serverContacts[alien.scenarioId];
          if (prev !== now) {
            if (now !== undefined) {
              this._applyContactAftermath(alien, false);
            } else if (prev !== undefined) {
              // stale/revoked choice: restore the default FIRST CONTACT marker
              const sprite = this.alienSprites && this.alienSprites.find((item) => item.alienId === alien.id);
              if (sprite) {
                sprite._marker.setText("FIRST CONTACT").setColor("#f3d99b");
                sprite._aura.setTint(0xffffff).setAlpha(0.3);
                sprite._label.setText(alien.name);
              }
            }
          }
        }
        if (this.toolTiers.hoe) this.tool = this.toolTiers.hoe;   // keep the legacy alias honest
        // The browser is a camera: reconcile each farm tile from the server's
        // authoritative grid so rejected moves (e.g. low-energy till) and
        // multiplayer contention can never leave the field lying about what it is.
        this._syncFarmState();
        if (net.room && net.room.state) {
          this.roomState = net.room.state;
          // colony calendar is server-authoritative: the local counter starts on
          // Day 1 and always mirrors state.day, so the HUD and briefings never
          // show "DAY 0" and a REJOIN lands on the same day everyone sees.
          if (typeof net.room.state.day === 'number') this.dayCount = net.room.state.day;
          // M3 — festival phase is authoritative in room state: sync it here so
          // a REJOIN (mid-festival or during afterglow) shows the plaza/decor
          // immediately, not only after the next live transition message.
          // setFestivalPhase is a no-op when the phase hasn't changed.
          // [_festHold] QA hook: screenshots + playtests can hold the room sync
          // off while they drive festival phases themselves (mirrors _nightOverride).
          if (!this._festHold && net.room.state.festivalPhase) this.setFestivalPhase(net.room.state.festivalPhase);
          if (net.room.state.season !== undefined) {
            const season = net.room.state.season;
            // [SF28] the year turn is a felt event: the first sync lands silently
            // (this._shownSeason starts undefined in create), but any later
            // change of the server-authoritative season raises the banner.
            if (this._shownSeason !== undefined && season !== this._shownSeason) {
              this._seasonBanner(season);
            }
            this._shownSeason = season;
            this.season = season;
            // [SF42] _seasonHold: QA contact sheets drive the grade themselves
            if (!this._seasonHold) this.applySeasonGrade(season);   // [SF29] re-grade ground + flora
            if (window.SpaceFarmer && window.SpaceFarmer.music) {
              window.SpaceFarmer.music.setSeason(this.season);  // seasonal soundtrack
            }
          }
          // The colony clock is server-authoritative: when the world turns dark
          // (isDay false), the browser follows — lamp pools, glows, night
          // fishing, and the moon all come alive on the same light everyone sees.
          if (!this._nightOverride && net.room.state.isDay !== undefined) {
            const night = !net.room.state.isDay;
            if (night !== this.isNight) {
              this.isNight = night;
              this.updateNightVisuals();
              this._updateFishHint?.();
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
    const equipLabel = this.equipped
      ? `${TOOL_TIER_NAME[this.toolTiers[this.equipped] || 'base']} ${(CLIENT_TOOLS[this.equipped] || {}).label || this.equipped}`
      : 'HANDS';
    const tankPart = this.equipped === 'watering' ? `   💧 ${this.waterLevel}/${this._tankMaxFor()}` : '';
    const crPart = typeof this.credits === 'number' ? `${this.credits} CR` : '— CR';
    this.hudText.setText(`${crPart}   ·   ${this.energy}/${this.staminaMax || 100} STAMINA   ·   ${seeds} SEEDS   ·   ${equipLabel}${tankPart}   ·   ${sName}${hudFest}`);
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
      // SF02: populate the chip from the active quest as soon as quest state
      // exists; a fresh farmer whose server state hasn't yet stamped a current
      // quest falls back to the first chapter in QUEST_ORDER so the HUD never
      // draws an empty plate box.
      let view = questView(this._questPS, this._questPS);
      if (!view.quest && !view.arcDone && this._questPS) {
        const q = QUEST_ORDER[0];
        view = questView({ current: q, completed: [], progress: {}, arcDone: false }, this._questPS);
      }
      const chip = questChip(view);
      this.questChip.setText(chip);
      // Hide the plate whenever the chip text is empty, and size its width to
      // the text (min 160, max the buildHUD width) instead of fixed 430.
      if (this.questPlate) {
        if (!chip) {
          this.questPlate.setVisible(false);
        } else {
          this.questPlate.setVisible(true);
          const wMax = Math.min(430, this.game.config.width * 0.54);
          this.questPlate.width = Math.max(160, Math.min(wMax, chip.length * 6.2 + 36));
        }
      }
    }
  }

  // ── SF22 — quest objective marker ──
  // Map the active quest's first unmet objective to ONE concrete in-world
  // target: npc → the NPC's live errand-brain position; building/zone → its
  // door tile or known spot; farm actions → the field centre. Any objective
  // kind we can't place returns null explicitly so the marker hides instead
  // of pointing somewhere wrong.
  _questTarget() {
    const net = window.SpaceFarmer.net;
    const ps = net && net.connected ? (net.getPlayerState && net.getPlayerState()) : null;
    if (!ps) return null;
    let view = questView(ps, ps);
    // Same fallback the quest chip uses: a fresh farmer whose server state
    // hasn't stamped a current quest yet still gets the first chapter target.
    if (!view.quest && !view.arcDone) {
      view = questView({ current: QUEST_ORDER[0], completed: [], progress: {}, arcDone: false }, ps);
    }
    if (!view.quest) return null;
    const qd = QUESTS[view.quest.id];
    if (!qd || !qd.objectives || !qd.objectives.length) return null;
    let obj = null;
    for (let i = 0; i < qd.objectives.length; i++) {
      const v = view.quest.objectives[i];
      if (v && !v.met) { obj = qd.objectives[i]; break; }
    }
    if (!obj) return null;      // every objective met — nothing left to point at
    const kind = obj.type || '';
    if (kind === 'talk' && obj.npc) {
      const b = this.npcBrains && this.npcBrains[obj.npc];
      if (b) return { x: b.x, y: b.y, hint: `TALK TO ${(b.name || obj.npc).toUpperCase()}` };
      return null;              // npc not on the planet — hide, don't guess
    }
    if (kind === 'plant' || kind === 'harvest') {
      const tiles = this.farmTiles || [];
      if (!tiles.length) return null;
      let sx = 0, sy = 0;
      for (const ft of tiles) { sx += ft.x * T + T / 2; sy += ft.y * T + T / 2; }
      const n = tiles.length;
      return { x: sx / n, y: sy / n, hint: kind === 'plant' ? 'PLANT IN THE FIELD' : 'HARVEST THE FIELD' };
    }
    const z = QUEST_ZONES[kind];
    if (!z || typeof z.x !== 'number' || typeof z.y !== 'number') return null;
    return { x: z.x * T + T / 2, y: z.y * T + T / 2, hint: (z.hint || '').toUpperCase() };
  }

  _updateQuestMarkers(time) {
    if (!this.questMarker || !this.questEdgeArrow) return;
    // hide while a dialogue/panel/interior is handled elsewhere (SF20 rule)
    const hidden = !!(this.inAlienContact || this.eventQueue || this.inDialogue || this.showingGE ||
      this.showingShop || this.showingRanch || this.showingChest || this.showingQuests || this.showingRecipes ||
      this.showingHub || this.showingBackpack || this.showingSmithy || this.showingCorridor || this.showingReckoning || this.inInterior);
    const t = hidden ? null : this._questTarget();
    if (!t) {
      this.questMarker.setVisible(false);
      this.questEdgeArrow.setVisible(false);
      return;
    }
    // bob the chevron above the target — the SpaceshipScene GO-HERE rhythm
    const bob = Math.sin(time * 0.005) * 5;
    this.questMarker.setPosition(t.x + this.worldX, t.y + this.worldY - 22 + bob);
    const label = this.questMarker.list[1];
    if (label && label.text !== t.hint) label.setText(t.hint);
    if (!this.questMarker.visible) this.questMarker.setVisible(true);
    // edge compass arrow when the target sits outside the camera view
    const wv = this.cam.worldView;
    const sx = (t.x + this.worldX) - wv.x, sy = (t.y + this.worldY) - wv.y;
    const onScreen = sx > -10 && sx < wv.width + 10 && sy > -10 && sy < wv.height + 10;
    this.questEdgeArrow.setVisible(!onScreen);
    if (!onScreen) this._drawQuestEdgeArrow(sx, sy, wv.width, wv.height);
  }

  // a fixed-on-screen triangle at the viewport edge pointing toward the
  // objective — the same shape/geometry as SpaceshipScene's compass arrow,
  // in amber so it reads as guidance, not decor
  _drawQuestEdgeArrow(sx, sy, vw, vh) {
    const g = this.questEdgeArrow;
    g.clear();
    const cx = vw / 2, cy = vh / 2;
    const dx = sx - cx, dy = sy - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ang = Math.atan2(dy, dx);
    const halfW = vw / 2 - 28, halfH = vh / 2 - 32;
    const k = Math.min(Math.abs(halfW / dx), Math.abs(halfH / dy));
    const px = cx + dx * k, py = cy + dy * k;
    const L = 22, a1 = ang - 0.45, a2 = ang + 0.45;
    g.fillStyle(0xf7d698, 1);
    g.fillTriangle(px, py, px - L * Math.cos(a1), py - L * Math.sin(a1), px - L * Math.cos(a2), py - L * Math.sin(a2));
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
        const isCropStage = type === 'seeded' || type === 'growing' || type === 'mature';
        local.img.setTexture(isCropStage ? (local.baseKey || tex('farm.empty'))
          : (TILE_FOR_STATE[type] || (() => local.baseKey))(local.x, local.y)
          || local.baseKey || tex('farm.empty'));
        this._setCropSprite(local);
      }
    }
  }

  // ── SF30: crop sprite — a planted crop is its own sprite layered ABOVE the
  // plain soil tile, origin bottom-center (0.5, 1) so it sways from the ROOT
  // rather than spinning around the tile centre. The tile image keeps its
  // untilled/ridge base key; every state change (plant / grow / mature /
  // harvest / server sync) refreshes the crop sprite, bare tiles destroy it.
  _setCropSprite(ft) {
    const s = ft.state;
    const px = ft.x * T + T / 2, py = ft.y * T + T / 2;
    const hasCrop = !!s.crop &&
      (s.type === 'seeded' || s.type === 'growing' || s.type === 'mature');
    if (!hasCrop) {
      if (ft.cropSpr) { ft.cropSpr.destroy(); ft.cropSpr = null; }
      return;
    }
    const key = tex('farm.' + s.type);
    if (!ft.cropSpr || !ft.cropSpr.active) {
      ft.cropSpr = this.add.image(px, py, key).setOrigin(0.5, 1);
      ft.cropSpr.setDepth(Math.floor(py / T) + 0.06);
      this.world.add(ft.cropSpr);
      ft.cropSpr.y = py + ft.cropSpr.displayHeight / 2;   // no origin jump
    } else if (ft.cropSpr.texture.key !== key) {
      ft.cropSpr.setTexture(key);
      ft.cropSpr.y = py + ft.cropSpr.displayHeight / 2;
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
    // SF20: target resolution lives in _resolveInteractTarget — the exact
    // priority order the old inline lookups ran, in one reusable pass (update()
    // draws the prompt chip from it, handleInteract executes it).
    const target = this._resolveInteractTarget();
    if (target && target.run) { target.run(); return; }
  }

  buildingAction(b) {
    const _roomActs = { shop: 1, exchange: 1, ranch: 1, sleep: 1, talk_rhea: 1, barracks: 1 };
    if (_roomActs[b.action] && this.audio) this.audio.sfx('door', { volume: 0.45 });   // SF25 airlock puff
    switch (b.action) {
      case 'shop': this.enterInterior('shop'); break;
      case 'exchange': this.enterInterior('exchange'); break;
      case 'ranch': this.enterInterior('ranch'); break;
      case 'sleep': this.enterInterior('home'); break;
      case 'talk_rhea': this.enterInterior('tavern'); break;
      case 'barracks': this.enterInterior('barracks'); break;
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
    const bedPt = (this.intPoints || []).find(p => p.action === 'sleep');
    if (this.intPlayer && bedPt) this.intPlayer.setPosition(bedPt.x + 10, bedPt.y + 24);
  }

  // ── farm actions ──
  // Tool tiers cut energy: base ×1.0, iron ×0.8, gold ×0.6. Mirror of the
  // server's TOOL_FOR_ACTION — each activity scales with ITS tool's tier (hoe
  // for till, can for water, pickaxe for mine, rod for fish); plant/harvest are
  // bare-handed and never scale. Online the server is authoritative anyway
  // (_burnEnergy reads it back); this keeps the offline sandbox honest with the
  // RL environment, where an agent pays the same per-tool prices.
  _energyCost(action, base) {
    const TOOL_FOR_ACTION = { till: 'hoe', water: 'watering', mine: 'pickaxe', fish: 'rod' };
    const toolId = TOOL_FOR_ACTION[action];
    const tier = (toolId && (this.toolTiers || {})[toolId]) || 'base';
    const m = { base: 1.0, iron: 0.8, gold: 0.6 }[tier] || 1.0;
    return Math.max(1, Math.round((base || 0) * m));
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
      if (this.energy === 0) { if (this.audio) this.audio.sfx('tired', { volume: 0.45 }); }   // SF25 low-energy cue
      return;
    }
    this.energy = Math.max(0, this.energy - cost);
    if (this.energy === 0) { if (this.audio) this.audio.sfx('tired', { volume: 0.45 }); }   // SF25 low-energy cue
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

  // ── SF30: watering feedback — three cyan dew motes rise off the tile and
  // fade (add-blended, 500ms) then destroy. Called by the water action and the
  // window.SpaceFarmer.waterGlint hook.
  _waterGlint(tx, ty) {
    const px = tx * T + T / 2, py = ty * T + T / 2;
    if (!this.world) return;
    const d = Math.floor(py / T) + 0.36;
    for (let i = 0; i < 3; i++) {
      const g = this.add.circle(px + (i - 1) * 4 + (Math.random() - 0.5) * 4,
        py + (Math.random() - 0.5) * 5, 1.6 + Math.random() * 0.8, 0x8fe9ff, 0.95)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(d);
      this.world.add(g);
      this.tweens.add({
        targets: g, y: g.y - 10, alpha: 0, duration: 500, ease: 'Sine.easeOut',
        onComplete: () => { g.destroy(); },
      });
    }
  }

  // ── SF20: resolve what SPACE/A will do right now (no side effects). ──
  // handleInteract calls it to act; update() calls it to draw the context
  // prompt chip. The exact priority order the old handleInteract ran is
  // preserved 1:1: dialogue → interior points → shore refill → equipped rod /
  // pickaxe → NPCs (live brain position, SF18) → aliens → building doors →
  // tile under/ahead.
  _resolveInteractTarget() {
    // interior interaction points (chest/stove/bed/counter/door/exit)
    if (this.inInterior && this.intPlayer) {
      for (const pt of (this.intPoints || [])) {
        if (Math.hypot(this.intPlayer.x - pt.x, this.intPlayer.y - pt.y) < 60) {
          return { kind: 'room', label: `${this._roomPointLabel(pt.action)} at ${this._roomName()}`, x: pt.x, y: pt.y - 30, run: () => this._roomAction(pt.action) };
        }
      }
    }
    const ptx = Math.floor(this.playerSpr.x / T);
    const pty = Math.floor(this.playerSpr.y / T);
    // shore tap refill (watering can in hand)
    if (this.equipped === 'watering' && Math.hypot(ptx - FILL_SPOT.x, pty - FILL_SPOT.y) <= 3.5) {
      return { kind: 'fill', label: 'Refill the can', x: FILL_SPOT.x * T + T / 2, y: FILL_SPOT.y * T - 18, run: () => this.fillWater() };
    }
    // equipped rod/pickaxe at their spots (same tests as _useEquippedTool)
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    if (this.equipped === 'rod') {
      const spot = Math.hypot(px - 27, py - 22) <= 3.5 ? 'stardust shore' : Math.hypot(px - 38, py - 21) <= 3.5 ? 'deep drop' : null;
      if (spot) return { kind: 'fish', label: `Cast at the ${spot}`, x: this.playerSpr.x, y: this.playerSpr.y - 42, run: () => this._useEquippedTool() };
    } else if (this.equipped === 'pickaxe') {
      if (Math.hypot(px - this.mineX, py - this.mineY) <= 4) return { kind: 'mine', label: 'Mine the asteroid vein', x: this.mineX * T, y: this.mineY * T - 22, run: () => this._useEquippedTool() };
    }
    // NPCs — LIVE brain position (SF18), nearest within 1.6 tiles
    const npcHit = { d: Infinity, npc: null, b: null };
    for (const b of Object.values(this.npcBrains)) {
      const d = Math.hypot(b.x / T - ptx, b.y / T - pty);
      if (d < npcHit.d) { npcHit.d = d; npcHit.npc = b.data || NPC_DATA[b.id]; npcHit.b = b; }
    }
    if (npcHit.npc && npcHit.d < 1.6) {
      const npc = npcHit.npc, b = npcHit.b;
      return { kind: 'talk', label: `Talk to ${npc.name || npc.id || 'townsperson'}`, x: b.x, y: b.y - 42, run: () => this.startNPCDialogue(npc) };
    }
    // aliens (first contact) — first within 2 tiles
    for (const alien of ALIEN_DATA) {
      if (Math.hypot(alien.x - ptx, alien.y - pty) < 2) {
        return { kind: 'contact', label: `Meet ${alien.name}`, x: alien.x * T + T / 2, y: alien.y * T - 18, run: () => this.startAlienContact(alien) };
      }
    }
    // SF51 'Companion Corridor': SPACE/A beside the terminal opens the live
    // agent day screen (SF50's /api/spectate/stub route). Placed ahead of the
    // bell lore so the tower prompt never hijacks it — its tile (36,42) is 2.2
    // tiles from the tower anchor anyway.
    const corridorDecor = (this.decorSprites || []).find(s => s.d && s.d.tex === 'bld.corridor_terminal');
    if (corridorDecor && Math.hypot(corridorDecor.d.x - ptx, corridorDecor.d.y - pty) < 1.6) {
      return {
        kind: 'corridor', label: 'Watch the agent work',
        x: corridorDecor.d.x * T + T / 2, y: corridorDecor.d.y * T - 30,
        run: () => this.openCorridorPanel(),
      };
    }
    // ROADMAP A1 'The first bell': SPACE near the old mission tower reads ONE
    // lore line — placed ahead of building doors so the tower never hijacks a
    // door prompt (its plaza tile is clear of every door anyway).
    const bellDecor = (this.decorSprites || []).find(s => s.d && s.d.tex === 'bld.bell_tower');
    if (bellDecor && Math.hypot(bellDecor.d.x - ptx, bellDecor.d.y - pty) < 1.6) {
      return {
        kind: 'lore', label: 'Read the bell tower',
        x: bellDecor.d.x * T + T / 2, y: bellDecor.d.y * T - 28,
        run: () => this._showBellLore(),
      };
    }
    // building doors — first within 2 tiles
    for (const b of BUILDINGS) {
      if (Math.hypot(b.door.x - ptx, b.door.y - pty) < 2) {
        return { kind: 'enter', label: `Enter ${b.label}`, x: b.door.x * T + T / 2, y: b.door.y * T - 24, run: () => this.buildingAction(b) };
      }
    }
    // farm tile under the player, else the one ahead
    const facing = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] }[this.playerDir] || [0, 1];
    const ft = this.farmTiles.find(f => f.x === ptx && f.y === pty)
      || this.farmTiles.find(f => f.x === ptx + facing[0] && f.y === pty + facing[1]);
    if (ft) return { kind: 'tile', label: this._tileActionLabel(ft.state), x: ft.x * T + T / 2, y: ft.y * T - 24, run: () => this.handleTileAction(ft) };
    return null;
  }

  // SF20: human label for an interior interaction point's action
  _roomPointLabel(action) {
    const _roomToastFor = { exit: 'Leave the room', sleep: 'Sleep', recipes: 'Cook at the stove', chest: 'Open the chest', shop: 'Buy from the counter', exchange: 'Trade at the terminal', ranch: 'Visit the ranch stall', talk_rhea: 'Talk to Rhea' }[action];
    return _roomToastFor || 'Interact';
  }
  _roomName() {
    return { home: 'your dome', shop: 'Supply Depot', tavern: 'Stardust Tavern', exchange: 'Grand Exchange', ranch: 'ranch barn', barracks: 'barracks' }[this.intKind] || 'the room';
  }
  // SF20: human label for a farm tile state
  _tileActionLabel(s) {
    switch (s.type) {
      case 'empty':   return this.equipped === 'hoe' ? 'Till the soil' : 'Till — equip the hoe';
      case 'tilled':  return this.inventory.seeds > 0 ? 'Plant a crop' : 'Plant — no seeds';
      case 'seeded':  case 'growing': return this.equipped === 'watering' ? (s.watered ? 'Watered' : 'Water') : 'Water — equip the can';
      case 'mature':  return this.equipped === '' ? `Harvest ${(CROPS[s.crop] || {}).label || 'crop'}` : 'Harvest — hands free';
      default:        return 'Interact';
    }
  }

  handleTileAction(ft) {
    const s = ft.state;
    switch (s.type) {
      case 'empty':
        if (this.equipped !== 'hoe') { this.showToast('Equip the HOE to till (M → Backpack).'); break; }
        const tillCost = this._energyCost('till', 5);   // hoe tier scales the till
        s.type = 'tilled';
        this._burnEnergy(tillCost);
        ft.img.setTexture(tex('farm.tilled'));
        const netTill = window.SpaceFarmer.net;
        if (netTill && netTill.connected) netTill.send('till', { tileX: s.x, tileY: s.y });
        this._swingTool();                            // the hoe swings as it tills
        this._tileFX(s.x, s.y, 'till');               // dust rings off the hoe
        if (this.audio) this.audio.sfx('till', { volume: 0.45 });   // SF25 soft till thunk
        this.showToast('Tilled the cosmic soil');
        break;
      case 'tilled':
        if (this.inventory.seeds > 0) {
          this._cropMenu(ft);          // pick which crop — shows seasons + regrow (accessibility)
        } else {
          this.showToast('Out of seeds — Supply Depot sells more.');
        }
        break;
      case 'seeded':
      case 'growing':
        if (this.equipped !== 'watering') {
          this.showToast('Equip the WATERING CAN to water (M → Backpack).');
          break;
        }
        if (this.waterLevel < WATER_USE_COST) {
          if (!this._emptyCanToastAt || this.time.now - this._emptyCanToastAt > 2500) {
            this._emptyCanToastAt = this.time.now;
            this.showToast('💧 Can is empty — refill at the pond (stand on the shore, press SPACE)');
          }
          break;
        }
        if (!s.watered) {
          s.watered = true;
          const wcost = this._energyCost('water', 5);      // can tier scales the water
          this._burnEnergy(wcost);
          const net2 = window.SpaceFarmer.net;
          if (net2 && net2.connected) net2.send('water', { tileX: s.x, tileY: s.y });
          this._swingTool();                          // the can tips as it waters
          this._tileFX(s.x, s.y, 'water');            // a dew-ring on the shoot
          this._waterGlint(s.x, s.y);                 // SF30 dew motes rise + fade
          if (this.audio) this.audio.sfx('glow');
          this.showToast('Watered with stardust dew');
          // SF65: the tank drains with each water action — the first time it
          // drops below WATER_USE_COST, tell the player where the tap is.
          const tankBefore = this.waterLevel;
          this.waterLevel = Math.max(0, (tankBefore ?? 0) - WATER_USE_COST);
          if (tankBefore >= WATER_USE_COST && this.waterLevel < WATER_USE_COST &&
              (!this._emptyCanToastAt || this.time.now - this._emptyCanToastAt > 2500)) {
            this._emptyCanToastAt = this.time.now;
            this.showToast('💧 Can is empty — refill at the pond (stand on the shore, press SPACE)');
          }
        } else {
          this.showToast('Already watered today');
        }
        break;
      case 'mature': {
        if (this.equipped !== '') { this.showToast('Wrong tool — empty your hands (backpack) to harvest.'); break; }
        const info = CROPS[s.crop] || { sellPrice: 20, label: 'crop' };
        const cs = CROP_SEASONS[s.crop] || { regrow: false };
        this.credits = (this.credits || 0) + info.sellPrice;
        this._tileFX(s.x, s.y, 'harvest');             // a reaping flash
        if (cs.regrow) {
          // continuous crop stays planted & regrows (needs watering again)
          s.type = 'growing'; s.growth = 0; s.watered = false; s.crop = s.crop;
          this._setCropSprite(ft);
          const tag = 'it will regrow';
          const net3 = window.SpaceFarmer.net;
          if (net3 && net3.connected) net3.send('harvest', { tileX: s.x, tileY: s.y });
          if (this.audio) this.audio.sfx('harvest', { volume: 0.4 });
          this._popReward(s.x * T + T / 2, s.y * T - 6, `+${info.sellPrice} CR`, '#f7d698');
          this.showToast(`Harvested ${info.label}! +${info.sellPrice} CR, +1 to your bag — ${tag}`);
        } else {
          s.type = 'empty'; s.crop = ''; s.growth = 0; s.watered = false;
          ft.img.setTexture(ft.baseKey || tex('farm.empty'));
          this._setCropSprite(ft);   // SF30 the bare tile loses its crop sprite
          const net4 = window.SpaceFarmer.net;
          if (net4 && net4.connected) net4.send('harvest', { tileX: s.x, tileY: s.y });
          if (this.audio) this.audio.sfx('harvest', { volume: 0.4 });
          this._popReward(s.x * T + T / 2, s.y * T - 6, `+${info.sellPrice} CR`, '#f7d698');
          this.showToast(`Harvested ${info.label}! +${info.sellPrice} CR, +1 to your bag (one-time)`);
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
    this._burnEnergy(this._energyCost('plant', 5));        // planting is bare-handed
    this._setCropSprite(ft);                               // SF30 crop sprite (sways)
    this._tileFX(s.x, s.y, 'plant');                   // a gold glint in the soil
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('plant', { tileX: s.x, tileY: s.y, crop: key });
    if (this.audio) this.audio.sfx('plant', { volume: 0.45 });   // SF25 soft seed tick
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
    const c = this.add.container(width / 2, height / 2).setDepth(1005).setScrollFactor(0);
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
        { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#a8eeff' }).setOrigin(1, 0.5);
      const regrowTxt = this.add.text(panelW / 2 - 74, y + 10, cs.regrow ? '↻ regrows' : '① one harvest',
        { fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: cs.regrow ? '#9ddd72' : '#ffdd44' }).setOrigin(1, 0.5);
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
          this._setCropSprite(ft);
        } else if (s.type === 'growing' && s.watered) {
          s.growth++;
        }
        if (s.growth >= growTo && s.crop) {
          s.type = 'mature';
          this._setCropSprite(ft);
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
      this._codexGroup = this.add.container(width / 2, height / 2).setDepth(985).setScrollFactor(0);
      const bx = this.add.rectangle(0, 0, 640, H, 0x0c0f1c, 0.95).setStrokeStyle(2, 0x3ec6c0);
      this._codexGroup.add(bx);
      this._codexGroup.add(this.add.text(0, -(H / 2) + 30, story.codex.title, { fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '24px', color: '#7ff0ff', fontStyle: 'bold' }).setOrigin(0.5));
      entries.forEach(([h, b], i) => {
        const y = -(H / 2) + 70 + i * rowH;
        this._codexGroup.add(this.add.text(-280, y, h.toUpperCase(), { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#ffd98a', fontStyle: 'bold' }));
        this._codexGroup.add(this.add.text(-280, y + 16, b, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#c8d6ff', wordWrap: { enable: true, width: 560 }, lineSpacing: 4 }));
      });
      this._codexGroup.add(this.add.text(0, H / 2 - 22, story.codex.closeHint, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#f7d698' }).setOrigin(0.5));
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

  // ── Cinematic letterbox: slide the black bars in/out so a cutscene opens and
  //    closes like a film, not a toggle. ──
  _cinema(on) {
    if (!this.cinemaTop || !this.cinemaBottom) return;
    const dur = 420;
    const h = this.game.config.height;
    if (on) {
      this.cinemaTop.setVisible(true).setY(-34);
      this.cinemaBottom.setVisible(true).setY(h + 34);
      this.tweens.add({ targets: this.cinemaTop, y: 34, duration: dur, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: this.cinemaBottom, y: h - 34, duration: dur, ease: 'Cubic.easeOut' });
    } else {
      this.tweens.killTweensOf([this.cinemaTop, this.cinemaBottom]);
      this.tweens.add({ targets: this.cinemaTop, y: -34, duration: dur, ease: 'Cubic.easeIn', onComplete: () => this.cinemaTop.setVisible(false) });
      this.tweens.add({ targets: this.cinemaBottom, y: h + 34, duration: dur, ease: 'Cubic.easeIn', onComplete: () => this.cinemaBottom.setVisible(false) });
    }
  }

  // ── First contact: cinematic arrival, ambiguous council, persistent aftermath ──
  // SF33: contact history lives on the server while connected (FarmRoom
  // persists player.contactChoices). localStorage is read ONLY as an offline
  // fallback, in one place, so a stale browser can never resurrect a doctrine
  // the colony never chose and two browsers never disagree.
  _loadOfflineContacts() {
    const net = window.SpaceFarmer.net;
    if (net && net.connected) return;   // server is authoritative when connected
    this.contactChoices = {};
    try {
      const raw = localStorage.getItem('spacefarmer.firstContact');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.contactChoices = parsed;
    } catch { this.contactChoices = {}; }
  }

  startAlienContact(alien) {
    this.closeAllPanels();
    this.selectedAlien = alien; this.inAlienContact = true;
    this._cinema(true);
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
    const envoyKey = paintedPortrait(this, alien.id);
    if (this.contactEnvoy) {
      // outside the plate's left edge when the screen has room, else a small
      // badge in the title row (never over the premise text)
      const pw = Math.min(720, this.game.config.width - 40);
      const roomy = (this.game.config.width - pw) / 2 >= 140;
      const sz = roomy ? 120 : 52;
      if (envoyKey) this.contactEnvoy.setTexture(envoyKey).setDisplaySize(sz, sz)
        .setPosition(roomy ? -pw / 2 - sz - 12 : -pw / 2 + 8, roomy ? -250 : -246).setVisible(true);
      else this.contactEnvoy.setVisible(false);
    }
    this.contactNote.setText(prior ? "Current doctrine: " + prior.toUpperCase() + " · choose again to revise the charter" : "No reward · no correct answer · this becomes colony history");
    this.contactPanel.setVisible(true);
  }

  chooseContactDoctrine(id) {
    const doctrine = CONTACT_DOCTRINES.find((item) => item.id === id);
    if (!doctrine || !this.selectedAlien) return;
    const alien = this.selectedAlien;
    const apply = () => {
      this.contactChoices[alien.scenarioId] = id;
      this._applyContactAftermath(alien, true); this.contactPanel.setVisible(false); this.contactPhase = "aftermath";
    };
    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      // SF33: connected play is persisted by FarmRoom — never write localStorage
      // here, or a stale browser would resurrect a doctrine the colony revoked.
      net.request('contact', { alien: alien.id, doctrine: id }).then((result) => {
        if (result && result.ok) apply();
        else this.showToast('The council could not record that doctrine.');
      });
    } else {
      // Offline fallback only.
      apply();
      try { localStorage.setItem("spacefarmer.firstContact", JSON.stringify(this.contactChoices)); } catch {}
    }
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
    sprite._auraBase = sprite._aura.alpha;   // SF37 — arrival fade-in target follows doctrine
    sprite._label.setText(alien.name + " · " + doctrine.label);
    if (announce) this.showToast(alien.name + ": " + doctrine.aftermath + " established");
  }

  // ── SF37 — envoy arrival flash ──
  // Envoys landing LIVE (created after create()) pop in gently instead of
  // hard-cutting into existence: the sprite fades in from alpha 0 / scaleY 0.2
  // over 500ms (Back.Out), a teal ADD ring ripples outward from radius 4 → 40
  // and fades over 700ms then destroys itself, and the aura fades in from 0 to
  // its normal alpha. Envoys created during create() skip all of it — the
  // scene opens calm (see this._createDone).
  _envoyArrival(spr) {
    if (!spr || !spr._aura || !this._createDone) return;   // skip initial-load envoys
    const aura = spr._aura;
    const auraBase = spr._auraBase !== undefined ? spr._auraBase : aura.alpha;
    const fullScaleY = spr._baseScale !== undefined ? spr._baseScale : spr.scaleX;
    spr._arrival = true;               // idle breathing hands alpha/scale to the tween
    spr.setAlpha(0).setScale(spr.scaleX, 0.2);
    this.tweens.add({
      targets: spr,
      scaleY: fullScaleY,
      alpha: 1,
      duration: 500,
      ease: 'Back.Out',
      onComplete: () => {
        spr._arrival = false;          // idle breathing resumes
        spr.setAlpha(1).setScale(spr.scaleX, fullScaleY);
      },
    });
    aura.setAlpha(0);
    this.tweens.add({
      targets: aura,
      alpha: auraBase,
      duration: 700,
      ease: 'Sine.Out',
    });
    const ring = this.add.circle(spr.x, spr.y, 4, 0x67e1cd, 0)
      .setStrokeStyle(2, 0x67e1cd, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(spr.depth + 0.1);
    this.world.add(ring);
    this.tweens.add({
      targets: ring,
      radius: 40,
      alpha: 0,
      duration: 700,
      ease: 'Sine.Out',
      onComplete: () => ring.destroy(),
    });
  }

  // ── NPC dialogue & story events ──
  // Friendship is server-authoritative (see FarmRoom). Client calls the server
  // for talk/gift/propose, then renders responses + per-NPC heart-event cutscenes.

  // [SF38] Mood tint for the dialogue portrait plate — the same plate no longer
  // reads identical for a stranger and a soulmate: its stroke picks the MOOD_TIERS
  // colour for this NPC's heart level (a faint wash of that colour fills the plate
  // behind the portrait), and a tiny '♥ n' badge sits just under the plate.
  _applyPortraitMood(h) {
    const plate = this.dialog && this.dialog.portraitPlate;
    if (!plate) return;
    const tier = moodTierFor(h);
    plate.setStrokeStyle(2, tier.color).setFillStyle(tier.color, 0.18);
    // tiny amber heart-count badge under the portrait
    if (!this._moodHeartText) {
      this._moodHeartText = this.add.text(plate.x, plate.y + 32, '', {
        fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#f7d698',
        stroke: '#061015', strokeThickness: 2,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002).setVisible(false);
    }
    const t = this._moodHeartText;
    t.setText(`♥ ${h}`).setVisible(true);
    // keep it screen-fixed and above the portrait even if the panel rebuilt
    if (t.scrollFactorX !== 0) t.setScrollFactor(0);
  }

  // [SF38] clear the heart badge and reset the plate to its neutral colony look
  // when dialogue closes (called from closeAllPanels alongside dialog.hide()).
  // ART-06: show the speaker's painted bust (or hide it when there is none).
  _showPaintedBust(id) {
    if (!this.paintedBust) return;
    const key = paintedPortrait(this, id);
    if (!key) { this.paintedBust.setVisible(false); this.paintedBustFrame.setVisible(false); return; }
    const size = Math.round(Math.min(168, this.game.config.height * 0.26));
    const was = this.paintedBust.visible && this.paintedBust.texture.key === key;
    this.paintedBust.setTexture(key).setDisplaySize(size, size).setVisible(true);
    const f = this.paintedBustFrame.clear();
    const x0 = this.paintedBust.x - size / 2, y0 = this.paintedBust.y - size;
    f.lineStyle(2, 0x67e1cd, 1).strokeRect(x0, y0, size, size);
    f.fillStyle(0xf7d698, 1).fillRect(x0 - 1, y0 - 1, 6, 2).fillRect(x0 + size - 5, y0 - 1, 6, 2);
    f.setVisible(true);
    if (!was && !reducedMotion()) {
      this.paintedBust.setAlpha(0); f.setAlpha(0);
      this.tweens.add({ targets: [this.paintedBust, f], alpha: 1, duration: 220 });
    } else { this.paintedBust.setAlpha(1); f.setAlpha(1); }
  }

  _clearPortraitMood() {
    const plate = this.dialog && this.dialog.portraitPlate;
    if (plate) plate.setStrokeStyle(2, 0x39c5bb).setFillStyle(0x141426, 1);
    if (this._moodHeartText) {
      this._moodHeartText.setText('').setVisible(false).setAlpha(1);
    }
    this._moodHeartText = null;
  }


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
    // pause the wandering brain for this NPC so the conversation partner stays
    // put and faces the player while the dialogue box is open
    const brain = this.npcBrains && this.npcBrains[npc.id];
    if (brain) {
      brain.talking = true;
      brain.path = [];
      const facing = Math.abs(this.playerSpr.x - brain.x) > Math.abs(this.playerSpr.y - brain.y)
        ? (this.playerSpr.x > brain.x ? 'right' : 'left')
        : (this.playerSpr.y > brain.y ? 'front' : 'back');
      brain.dir = facing;
    }
    const data = npc.data || NPC_DATA[npc.id] || {};
    const { fp } = this.heartbeat(npc);
    const hearts = fp < 20 ? 1 : fp < 40 ? 2 : fp < 60 ? 3 : fp < 80 ? 4 : 5;
    const heartStr = '·'.repeat(5 - hearts) + '#'.repeat(hearts);
    // [SF38] portrait plate mood: heart level decides plate tint + '♥ n' badge.
    this._applyPortraitMood(moodHeartsFor(fp));

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

  // Harvest Moon-style heart event. Plays the NPC's per-threshold cutscene
  // (dialogue.heartByThreshold[T]) when authored, else falls back to the single
  // `heart` cutscene. Threshold 100 reads as a culmination; 20 the first crack.
  showHeartEvent(npc, threshold) {
    const data = npc.data || NPC_DATA[npc.id] || {};
    const heartLines =
      data.dialogue?.heartByThreshold?.[threshold] ||
      data.dialogue?.heart || [
      `[A quiet moment with ${npc.name}.]`,
      `[Your bond deepens.]`,
    ];
    this.eventQueue = heartLines;
    this.eventIdx = 0;
    this._cinema(true);                     // cinematic letterbox for the payoff
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
      this._cinema(false);                      // close the letterbox
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
        this.showDialogueResponse(`${npc.name}: ${reactions[res.tier]}\n[${res.tier.toUpperCase()}] ${arrows[res.tier]} friendship → (${res.value}/100)`, GIFT_FACE[res.tier] || 0);
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
      this.showDialogueResponse(`${npc.name}: ${reactions[tier]}\n[${tier.toUpperCase()}] → (${this.friendships[npc.id]}/100)`, GIFT_FACE[tier] || 0);
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

  showDialogueResponse(text, face = 0) {
    this._speak(text, this.selectedNPC && this.selectedNPC.id, { footer: '[SPACE to continue]', face });
    this.dialogueBox.setVisible(true);
    this.dialogueText.setVisible(true);
  }

  // ── panels ──
  closeAllPanels() {
    if (this.dialog) { this.dialog.hide(); this._clearPortraitMood(); }
    if (this.paintedBust) { this.paintedBust.setVisible(false); this.paintedBustFrame.setVisible(false); }
    this._diaFace = 0;   // [SF46] reaction face ends with the line   // hides + resets dialogue box/scroll/collapse
    this._diaDone = true;
    this.gePanel.setVisible(false);
    if (this.contactPanel) this.contactPanel.setVisible(false);
    this._cinema(false);
    this.shopPanel.setVisible(false);
    this.ranchPanel.setVisible(false);
    this.chestPanel.setVisible(false);
    if (this.recipePanel) this.recipePanel.setVisible(false);
    if (this.questPanel) this.questPanel.setVisible(false);
    if (this.backpackPanel) this.backpackPanel.setVisible(false);
    if (this.smithyPanel) this.smithyPanel.setVisible(false);
    // SF62 — closing anything closes the reckoning screen too (it lives above
    // every panel; SPACE/ESC are its own close path as well).
    if (this.reckoningPanel) this.reckoningPanel.setVisible(false);
    this.showingReckoning = false;
    this._reckSeq++;   // SF62 — a close supersedes any queued reckoning
    if (this.hub) this.hub.close();
    this.showingHub = false;
    this.showingBackpack = false;
    this.showingSmithy = false;
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
    // resume any NPC brain paused for dialogue so errands continue
    for (const b of Object.values(this.npcBrains || {})) b.talking = false;
    // SF51 'Companion Corridor': closing the screen tears down the SSE stream —
    // the server stops pacing events when the watcher leaves (res.on('close')).
    if (this.corridorEs && this.corridorEs.readyState !== 2) {
      try { this.corridorEs.close(); } catch (err) { /* already dead */ }
    }
    if (this.corridorPanel) this.corridorPanel.setVisible(false);
    this.showingCorridor = false;
  }

  // ── SF51 'Companion Corridor' — watch the stub agent's day live ──
  // The screen-anchored panel streams SF50's /api/spectate/stub route through
  // EventSource and keeps the last 12 lines, scrolling up: briefing cream,
  // tool calls teal '▸ name(args)', results light slate, journal amber italic.
  _buildCorridorPanel() {
    const { width, height } = this.game.config;
    // screen-anchored (scrollFactor 0, depth 1500): the feed is viewport
    // furniture like every other panel — it never drifts with the camera.
    this.corridorPanel = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(1500).setVisible(false);
    const plate = this.add.rectangle(0, 0, 500, 320, 0x0c1019, 0.92)
      .setStrokeStyle(1, 0x67e1cd, 0.9).setScrollFactor(0);
    const head = this.add.text(-240, -148, 'COMPANION CORRIDOR · live agent day', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '13px', color: '#f6ecd4',
    }).setOrigin(0, 0).setScrollFactor(0);
    const foot = this.add.text(-240, 132, '[CLOSE: ESC]', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#f7d698',
    }).setOrigin(0, 0).setScrollFactor(0);
    const empty = this.add.text(-240, -122, '(awaiting the stream…)', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#7c95a6',
    }).setOrigin(0, 0).setScrollFactor(0);
    this.corridorPanel.add([plate, head, foot, empty]);
    this.corridorHead = head; this.corridorFoot = foot; this.corridorEmpty = empty;
    this.corridorLines = [];
  }

  _corridorAppend(kind, text) {
    if (!this.corridorLines) return;
    const styleBy = {
      briefing: { color: '#f6ecd4', fontStyle: 'normal' },   // briefing cream
      tool: { color: '#67e1cd', fontStyle: 'normal' },       // tool calls teal
      result: { color: '#cfe6df', fontStyle: 'normal' },     // results light slate
      journal: { color: '#f7d698', fontStyle: 'italic' },    // journal amber italic-ish
    };
    const st = styleBy[kind] || styleBy.result;
    if (this.corridorEmpty && this.corridorEmpty.visible) this.corridorEmpty.setVisible(false);
    const line = this.add.text(-240, 0, String(text || ''), {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px',
      color: st.color, fontStyle: st.fontStyle || 'normal',
      wordWrap: { enable: true, width: 470 }, stroke: '#061015', strokeThickness: 2,
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(1501);
    this.corridorLines.push(line);
    if (this.corridorLines.length > 12) {
      const old = this.corridorLines.shift();
      if (old && old.destroy) old.destroy();
    }
    // scroll up: reposition the kept lines from the top of the feed downward
    let y = -122;
    for (const kept of this.corridorLines) { kept.setY(y); y += kept.height + 2; }
  }

  openCorridorPanel() {
    if (this.showingCorridor) { this.closeAllPanels(); return; }
    this.showingCorridor = true;
    if (!this.corridorPanel) this._buildCorridorPanel();
    this.corridorPanel.setVisible(true);
    this._corridorAppend('briefing', 'COMPANION CORRIDOR — watching the agent season on B-612…');
    try {
      if (this.corridorEs && this.corridorEs.readyState !== 2) this.corridorEs.close();
      this.corridorEs = new EventSource('/api/spectate/stub?days=1');
      this.corridorEs.addEventListener('briefing', (e) => {
        let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
        this._corridorAppend('briefing', `DAY ${d.day !== undefined ? d.day : '—'} — ${d.text || ''}`);
      });
      this.corridorEs.addEventListener('tool', (e) => {
        let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
        const args = Object.keys(d.args || {}).map(k => d.args[k]).join(', ');
        this._corridorAppend('tool', `▸ ${d.name || 'tool'}(${args})`);
      });
      this.corridorEs.addEventListener('result', (e) => {
        let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
        this._corridorAppend('result', `${d.ok ? '✓' : '✗'} ${d.prose || ''}`);
      });
      this.corridorEs.addEventListener('journal', (e) => {
        let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
        this._corridorAppend('journal', d.text || '');
      });
      this.corridorEs.addEventListener('done', (e) => {
        let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
        this._corridorAppend('briefing', `season closed at day ${d.day !== undefined ? d.day : '—'}`);
      });
      this.corridorEs.onerror = () => { /* the stream dropped — the watcher left */ };
    } catch (err) {
      this._corridorAppend('result', `stream error: ${err.message}`);
    }
  }

  openGrandExchange() {
    // The Grand Exchange is a PLACE, not a menu item: you walk to its building
    // and use the sell board at its door. The hub's EXCHANGE row (and any
    // shortcut) coaches you there instead of teleporting the board open, so the
    // building stays the thing you visit — SPACE/A at the door opens it.
    const px = this.playerSpr.x / T, py = this.playerSpr.y / T;
    const exch = BUILDINGS.find(b => b.action === 'exchange');
    const door = exch ? exch.door : { x: 30, y: 11 };
    if (Math.hypot(px - door.x, py - door.y) > 2.5) {
      this.showToast('The Exchange is a building — walk to the grand exchange stand to trade.');
      this._pingBuilding('exchange');
      return;
    }
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
    this.geContent.setPosition(0, -100);
    this.geContent.setText(
      `GRAND EXCHANGE — tap a row (or [1-4]) · each sells 1   ·   ${this.credits ?? '—'} CR on hand`
    );
    this._panelRows('_geTapRows', [
      { label: '[1] CROP', kind: 'crop', sub: `${counts.crop} kinds you hold` },
      { label: '[2] FISH', kind: 'fish', sub: `${counts.fish} kinds you hold` },
      { label: '[3] PRODUCE (egg/milk/wool)', kind: 'produce', sub: `${counts.produce} kinds you hold` },
      { label: '[4] ORE / MINERAL', kind: 'ore', sub: `${counts.ore} kinds you hold` },
    ], (d) => this.sellCategory(d.kind), { panelKey: 'gePanel', rowH: 34, gap: 5, top: -20 });
  }

  // ── Bounce marker over a world spot (building, shore, vein) so the player
  //    can SEE where to walk — the same guidance the hub rows give for places. ──
  _pingSpot(tx, ty, label) {
    const mx = tx * T + T / 2, my = ty * T;
    const m = this.add.text(mx, my - 26, `${label}  ▼`, {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '12px', color: '#ffe9a0',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(960);
    this.world.add(m);
    this.tweens.add({ targets: m, y: my - 14, duration: 260, yoyo: true, repeat: 7 });
    this.time.delayedCall(4500, () => m.destroy());
  }

  _pingBuilding(key) {
    const bs = (this.buildingSprites || []).find(o => o.b && o.b.key === key);
    if (!bs) return;
    this._pingSpot(bs.b.x, bs.b.y, bs.b.label || '');
  }

  // ── Mobile parity for panels: rebuild a set of tappable rows over a panel so
  //    both desktop number keys AND touch taps drive the same actions — the
  //    same tap-row pattern the hub/backpack/smithy use. Rows are destroyed and
  //    re-created on every open so counts/prices never lie. ──
  _panelRows(store, defs, onTap, opts = {}) {
    if (!(this[store] instanceof Array)) this[store] = [];
    for (const o of this[store]) o.destroy();
    this[store] = [];
    const panel = this[opts.panelKey];
    if (!panel) return;
    const rowH = opts.rowH || 36, gap = opts.gap || 6, width = opts.width || 420;
    const top = opts.top != null ? opts.top : 12;
    const f = { fontFamily: "system-ui, 'Segoe UI', sans-serif", stroke: '#04080c', strokeThickness: 2 };
    defs.forEach((d, i) => {
      const y = top + i * (rowH + gap);
      const rect = this.add.rectangle(0, y, width, rowH, 0x132432, 0.92)
        .setStrokeStyle(1, d.hot ? 0xd8a05a : 0x2a4650)
        .setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => onTap(d, i));
      const label = this.add.text(-width / 2 + 18, y, d.label, {
        ...f, fontSize: '12px', fontStyle: 'bold', color: '#e8ecff',
      }).setOrigin(0, 0.5);
      const sub = this.add.text(width / 2 - 18, y, d.sub || '', {
        ...f, fontSize: '12px', color: '#a9d9d0',
      }).setOrigin(1, 0.5);
      panel.add([rect, label, sub]);
      this[store].push(rect, label, sub);
    });
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
        if (this.audio) this.audio.sfx('sell', { volume: 0.4 });   // SF25 coin ping
        this._popReward(this.playerSpr.x, this.playerSpr.y - 40, `+${r.credits} CR`, '#f7d698');
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
    this.shopContent.setPosition(0, -100);
    this.shopContent.setText(
      `QUASAR'S SUPPLY DEPOT — tap a row (or [1-4])   ·   ${this.credits ?? '—'} CR on hand`
    );
    this._panelRows('_shopTapRows', [
      { label: '[1] SPACE SEEDS', item: 'seeds', sub: `5 CR · have ${inv.seeds || 0}` },
      { label: '[2] STARDUST CRYSTAL', item: 'stardust-crystal', sub: `100 CR · have ${inv['stardust-crystal'] || 0}` },
      { label: '[3] TECH PART', item: 'tech-part', sub: `40 CR · have ${inv['tech-part'] || 0}` },
      { label: '[4] COOKED FOOD', item: 'cooked-food', sub: `40 CR · have ${inv['cooked-food'] || 0}` },
    ], (d) => this.buyFromShop(d.item), { panelKey: 'shopPanel', rowH: 34, gap: 5, top: -20 });
  }

  // ── The Colony Hub — one menu, one path. Desktop M and the mobile MENU
  //    button both land here; the hub's rows route to this scene's methods. ──
  toggleHub() {
    if (this.hub) this.hub.toggle();
    // the hub's own open/close is authoritative — mirror it AFTER the toggle
    // so openPanel's internal closeAllPanels() can't desync this flag.
    this.showingHub = this.hub ? this.hub.open : !this.showingHub;
  }

  // ── Backpack: the colony's TRUE inventory (Slice 3 — equip tools, view
  //    holdings, read the watering-can tank). Rows are tap-friendly (mobile)
  //    and 1-5 driven (desktop); the same screen both inputs share. ──
  openBackpack() {
    this._openBackpackPanel();
  }

  // human-friendly tier label for a tool, e.g. "Iron Hoe"
  _tierName(toolId) {
    const tier = this.toolTiers[toolId] || 'base';
    return `${TOOL_TIER_NAME[tier] || tier} ${(CLIENT_TOOLS[toolId] || {}).label || toolId}`;
  }

  // tank capacity for the can the player owns (mirror of server tankMaxFor)
  _tankMaxFor() {
    const tier = (this.toolTiers && this.toolTiers.watering) || 'base';
    return TANK_MAX_FOR[tier] || WATER_TANK_MAX;
  }

  _openBackpackPanel() {
    this.showingBackpack = true;
    this.backpackPanel.setVisible(true);
    this._renderBackpack();
    if (this.audio) this.audio.sfx('menu', { volume: 0.3 });
  }

  // ── Equip a tool ('' = hands). Server-authoritative: we ask, the server
  //    says yes, then we mirror equipped + tank + HUD. Offline sandbox keeps a
  //    local ledger so the preview still teaches the mechanic. ──
  equipTool(toolId) {
    const tool = toolId || '';
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) {
      this.equipped = tool;
      if (this.audio) this.audio.sfx('equip', { volume: 0.45 });   // SF25 tool clack (offline)
      this.showToast(tool ? `Equipped ${CLIENT_TOOLS[tool].label}.` : 'Hands free — harvest & talk.');
      if (this.showingBackpack) this._renderBackpack();
      this.updateHUD();
      return;
    }
    net.request('equip', { tool }).then(r => {
      if (r && r.ok) {
        this.equipped = r.equipped || '';
        if (this.audio) this.audio.sfx('equip', { volume: 0.45 });   // SF25 tool clack
        this.showToast(this.equipped
          ? `Equipped ${(CLIENT_TOOLS[this.equipped] || {}).label}.`
          : 'Hands free — harvest & talk.');
      } else if (r) {
        this.showToast(({
          'unknown-tool': 'Unknown tool.',
          'dont-own': `You don't own that tool yet — upgrade it at the smithy, not here.`,
        })[r.reason] || 'Could not equip.');
      }
      if (this.showingBackpack) this._renderBackpack();
      this.updateHUD();
    });
  }

  // ── Refill the watering can at a station (planet: the shore tap; ship:
  //    greenhouse tap). Server sets the tank — the can is a real container. ──
  fillWater() {
    if (this._fillBusy) return;
    const net = window.SpaceFarmer.net;
    if (!net || !net.connected) {
      this.waterLevel = this._tankMaxFor();
      if (this.audio) this.audio.sfx('refill', { volume: 0.45 });   // SF25 glug (offline)
      this.showToast('The can glugs full of stardust dew.');
      if (this.showingBackpack) this._renderBackpack();
      this.updateHUD();
      return;
    }
    this._fillBusy = true;
    net.request('fillWater', {}).then(r => {
      this._fillBusy = false;
      if (r && r.ok) {
        this.waterLevel = Math.min(r.waterLevel ?? this._tankMaxFor(), this._tankMaxFor());
        if (this.audio) this.audio.sfx('refill', { volume: 0.45 });   // SF25 glug
        this.showToast('The can glugs full of stardust dew.');
      } else if (r && r.reason === 'already-full') {
        this.showToast('The can is already full.');
      } else {
        this.showToast('No tap here — the tap sits at the lake shore (east).');
      }
      if (this.showingBackpack) this._renderBackpack();
      this.updateHUD();
    });
  }

  // ── Rebuild the backpack's dynamic rows (equip list + cargo). Called on open
  //    and after every equip/fill so the screen always tells the truth. ──
  _renderBackpack() {
    if (!this.backpackPanel) return;
    for (const d of this._backpackDynamic) d.destroy();
    this._backpackDynamic = [];
    const equipped = this.equipped || '';
    const rowH = 54, rowGap = 6, topY = -120;
    const defs = [
      { id: '',      label: 'HANDS',       sub: 'harvest ripe crops · talk to townsfolk' },
      { id: 'hoe',     label: 'HOE',            sub: 'till soil · ' + this._tierName('hoe') },
      { id: 'watering',label: 'WATERING CAN',    sub: `water crops · ${this._tierName('watering')} · tank 💧 ${this.waterLevel}/${this._tankMaxFor()}` },
      { id: 'pickaxe', label: 'PICKAXE',         sub: 'mine the asteroid vein · ' + this._tierName('pickaxe') },
      { id: 'rod',     label: 'FISHING ROD',     sub: 'cast the stardust shore · ' + this._tierName('rod') },
    ];
    const f = { fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", stroke: '#04080c', strokeThickness: 2 };
    defs.forEach((d, i) => {
      const cur = equipped === d.id;
      const y = topY + i * (rowH + rowGap);
      const rect = this.add.rectangle(0, y, 440, rowH - 8, cur ? 0x1a3344 : 0x0d1624, 0.96)
        .setStrokeStyle(cur ? 2 : 1, cur ? 0x67e1cd : 0x2c3c50)
        .setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.equipTool(d.id));
      const name = this.add.text(-206, y - 8, `[${i + 1}] ${d.label}${cur ? '   ◀ IN HAND' : ''}`, {
        ...f, fontSize: '13px', color: cur ? '#9dffec' : '#e8ecff', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const hint = this.add.text(-206, y + 12, d.sub, {
        ...f, fontSize: '12px', color: '#a9d9d0',
      }).setOrigin(0, 0.5);
      this.backpackPanel.add([rect, name, hint]);
      this._backpackDynamic.push(rect, name, hint);
    });
    // cargo readout — everything you carry, from the authoritative inventory
    const inv = this.inventory || {};
    const ITEM_LABEL = {
      'space-wheat': 'wheat', 'star-berry': 'star-berry', 'moon-melon': 'melon',
      'plasma-tomato': 'plasma tomato', 'nebula-pepper': 'nebula pepper', 'glow-kelp': 'glow kelp',
      'moonfish': 'moonfish', 'stardust-salmon': 'salmon', 'comet-trout': 'trout', 'nebula-marlin': 'marlin',
      'egg': 'egg', 'milk': 'milk', 'wool': 'wool',
      'asteroid-dust': 'asteroid dust', 'nickel-iron': 'nickel-iron', 'silicon-carbide': 'silicon carbide',
      'void-diamond': 'void diamond', 'stardust-crystal': 'stardust crystal',
      'tech-part': 'tech part', 'cooked-food': 'cooked food', 'seeds': 'seeds',
    };
    const parts = Object.keys(inv).filter(k => (inv[k] || 0) > 0).map(k => `${ITEM_LABEL[k] || k} ×${inv[k]}`);
    const cargo = this.add.text(0, 152, 'CARGO  ·  ' + (parts.length ? parts.join('   ') : 'empty — plant a field!'), {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#a9d9d0',
      align: 'center', wordWrap: { enable: true, width: 440 },
    }).setOrigin(0.5, 0);
    this.backpackPanel.add(cargo);
    this._backpackDynamic.push(cargo);
  }

  // ── Smithy: per-tool upgrades for credits (Slice 4). Rows are tap-friendly
  //    (mobile) and 1-4 driven (desktop). ──
  openSmithy() {
    this._openSmithyPanel();
  }

  _openSmithyPanel() {
    this.showingSmithy = true;
    this.smithyPanel.setVisible(true);
    this._renderSmithy();
    if (this.audio) this.audio.sfx('menu', { volume: 0.3 });
  }

  // ── Rebuild the smithy's rows: each owned tool, current tier → next tier,
  //    and the CR cost. Rebuilt on open and after every upgrade. ──
  _renderSmithy() {
    if (!this.smithyPanel) return;
    for (const d of this._smithyDynamic) d.destroy();
    this._smithyDynamic = [];
    const rowH = 54, rowGap = 6, topY = -120;
    const toolIds = ['hoe', 'watering', 'pickaxe', 'rod'];
    const f = { fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", stroke: '#04080c', strokeThickness: 2 };
    toolIds.forEach((id, i) => {
      const cur = this.toolTiers[id] || 'base';
      const next = TIER_TO_NEXT[cur];
      const def = SMITHY_TOOLS[id] || { label: id, next: [] };
      const cost = next ? def.next[cur === 'base' ? 0 : 1] : null;
      const y = topY + i * (rowH + rowGap);
      const rect = this.add.rectangle(0, y, 440, rowH - 8, 0x0d1624, 0.96)
        .setStrokeStyle(next ? 1.5 : 1, next ? 0xd8a05a : 0x2c3c50)
        .setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => { if (next) this.upgradeTool(id); });
      const name = this.add.text(-206, y - 8, `[${i + 1}] ${def.label}`, {
        ...f, fontSize: '13px', color: '#ffe9a0', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const hint = this.add.text(-206, y + 12,
        next ? `${TOOL_TIER_NAME[cur]} → ${TOOL_TIER_NAME[next]}   ·   ${cost} CR${id === 'watering' ? `   ·   tank 💧 ${TANK_MAX_FOR[next]}` : ''}` : `${TOOL_TIER_NAME[cur]} — the finest in the colony${id === 'watering' ? `   ·   tank 💧 ${TANK_MAX_FOR[cur]}` : ''}`,
        { ...f, fontSize: '12px', color: next ? '#8fb8ae' : '#d8a05a' }).setOrigin(0, 0.5);
      this.smithyPanel.add([rect, name, hint]);
      this._smithyDynamic.push(rect, name, hint);
    });
    const foot = this.add.text(0, 152, `${this.credits ?? '—'} CR on hand   ·   higher tiers cut energy costs and hold more water`, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', color: '#ffe9a0',
      align: 'center',
    }).setOrigin(0.5);
    this.smithyPanel.add(foot);
    this._smithyDynamic.push(foot);
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
    // SF23: identical toasts rate-limit to once per 2s, so spamming the same
    // dead-end press can't stack a wall of the same line.
    const now = this.time.now;
    if (this._toastKey === msg && now - (this._toastStamp || 0) < 2000) return;
    this._toastKey = msg; this._toastStamp = now;
    const { width } = this.game.config;
    const toast = this.add.text(width / 2, 44, msg, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '12px', color: '#b8ffcf',
      backgroundColor: '#070714cc', padding: { x: 10, y: 6 },
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1100);
    this.tweens.add({
      targets: toast, alpha: 0, y: 24, duration: 900, delay: 1800,
      onComplete: () => toast.destroy(),
    });
  }

  // SF24: reward pops AT the spot of the action — bold 12px text rises ~24px
  // and fades over ~900ms, with a small sparkle of fx.shadow glints (amber
  // for credits, teal for items). Skipped when the tab is hidden; the text
  // and the emitter are both destroyed on complete so repeated pops leak
  // nothing (self-cleaning, like the splash pattern).
  _popReward(x, y, text, color) {
    if (typeof document !== 'undefined' && document.hidden) return;
    const col = color || '#f7d698';
    const txt = this.add.text(x, y, text, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '12px', color: col, fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(1100);
    const spark = this.add.particles(x, y, 'fx.shadow', {
      speed: { min: 26, max: 58 },
      lifespan: 520, quantity: 8, scale: { min: 0.16, max: 0.42 },
      alpha: { start: 0.9, end: 0 }, angle: { min: 200, max: 340 },
      gravityY: 42, blendMode: Phaser.BlendModes.ADD,
      emitting: true, stopAfter: 8,
    }).setDepth(1100);
    this.tweens.add({
      targets: txt, alpha: 0, y: y - 24, duration: 900, ease: 'Quad.out',
      onComplete: () => { if (spark.active) spark.destroy(); txt.destroy(); },
    });
    this.time.delayedCall(1500, () => { if (spark.active) spark.destroy(); });
  }

  // ── day/night visuals ──
  updateNightVisuals() {
    // Task 4: night goes properly dark (0.27 read as "dimmed day"), and the
    // additive light pools + window glows are what earns visibility back —
    // light becomes a game mechanic of the scene, not a tint.
    // SF08: a deep-blue dusk that actually reads as night — 0.62 alpha over the
    // darker 0x0e1838 tint pushes the planet past "dimmed day"; the additive
    // lamp pools + window glows below earn visibility back as game mechanics.
    // SF32 dusk/dawn: night eases IN and OUT over a 2500ms tween instead of a
    // hard flip (final alpha identical to the old values: 0.62 night / 0 day),
    // and a warm amber dusk wash breathes in mid-transition, then fades out.
    // SF49: reduced motion shortens the flip to a 400ms ease so the sky change
    // reads as a quick brightness shift, not a slow animated wash.
    this.tweens.killTweensOf(this.nightOverlay);
    this.tweens.killTweensOf(this.duskWash);
    // SF52: on the CANVAS renderer Phaser draws Shape fill with `fillAlpha`,
    // NOT GameObject.alpha — the old tween only moved `alpha`, so the fillAlpha
    // stayed at its creation value (0) and night rendered as bright as day.
    // Reset BOTH alphas and tween BOTH together so the wash darkens on WebGL
    // and Canvas alike (final effective opacity 0.62 night / 0 day).
    // effective opacity = alpha × fillAlpha, so fillAlpha goes to 1 (not 0.62)
    // — tweening both to 0.62 rendered night at 0.38 and it read as day
    const flipMs = reducedMotion() ? 400 : 2500;
    const toNight = this.isNight ? 0.62 : 0;
    this.nightOverlay.setAlpha(0);
    this.nightOverlay.setFillStyle(0x0e1838, 0);
    this.duskWash.setAlpha(0);
    this.duskWash.setFillStyle(0xff9a5a, 0);
    this.tweens.add({
      targets: this.nightOverlay, alpha: toNight, fillAlpha: this.isNight ? 1 : 0,
      duration: flipMs, ease: 'Sine.inOut',
    });
    // dusk wash: rise to the peak during the first half of the flip, fall away
    // through the second half (both dawn and dusk read as a horizon glow)
    this.duskWash.setVisible(true);
    this.tweens.add({
      targets: this.duskWash, alpha: { from: 0, to: 0.12 }, fillAlpha: { from: 0, to: 0.12 },
      duration: flipMs / 2, ease: 'Sine.inOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.duskWash, alpha: { from: 0.12, to: 0 }, fillAlpha: { from: 0.12, to: 0 },
          duration: flipMs / 2, ease: 'Sine.inOut',
          onComplete: () => { this.duskWash.setVisible(false); this.duskWash.setAlpha(0); this.duskWash.setFillStyle(0xff9a5a, 0); },
        });
      },
    });
    if (this.nightAmbient) this.nightAmbient.setVisible(this.isNight);
    if (this.vignette) this.vignette.setAlpha(this.isNight ? 0.34 : 0.8); // no double-dark corners
    // SF32 aurora sky event: only at night, only on every third colony day.
    // Deterministic on dayCount so playtests reproduce it exactly.
    const auroraOn = this.isNight && (this.dayCount % 3) === 0;
    if (this.aurora) {
      this.auroraOn = auroraOn;
      this.auroraTime = this.time.now;
      for (const g of this.aurora) g.setVisible(auroraOn);
    }
    // QA 0904 2.5: glows split by the learnable window-light rule — commercial
    // facades ('day' = open for business) glow through daylight, residential
    // ones ('night' = someone home) only after dark. Character rim-lights stay
    // night-only (they live in glowRegistry without a litWhen tag).
    for (const g of this.glowRegistry) g.setVisible(this.isNight ? g.litWhen !== 'day' : g.litWhen === 'day');
    for (const l of this.lampGlows) l.setVisible(this.isNight);
    // SF08: lamps bloom bigger at night (1.7x vs day 1.0x) — SF36 keeps that
    // factor relative to each glow's stored base scale so the festival bloom
    // can pulse lamps without ever shrinking the night look below 1.7x.
    for (const l of this.lampGlows) l.setScale(l._baseScale !== undefined ? l._baseScale * (this.isNight ? 1.7 : 1.0) : (this.isNight ? 1.7 : 1.0));
    // SF36: a day/night flip mid-festival kills the bloom tweens' scale frames
    // — restart the bloom at the new cycle scale instead of leaving it dead.
    if (this._festActive && this._festActive()) { this._stopLampBloom(); this._startLampBloom(); }
    // Task 4: ground light pools switch with the day cycle; their flicker
    // animates in update() (alpha wobble) so lamps feel like real lamps.
    for (const p of this.lightPools) {
      p.img.setVisible(this.isNight);
      p.img.setAlpha(this.isNight ? p.base : 0);
    }
    // buildings LIGHT UP at night — their windows/doors/signs are the world's
    // readable landmarks after dark, so push the glows bigger than day-size
    for (const g of this.buildingGlows) g.setScale(this.isNight ? 1.8 : 1.0);
  }
}

export { PlanetScene };
