// SpaceshipScene.js — Tutorial level inside a spaceship
// 2000s 8-bit pixel art rendering
// Player wakes from cryo, learns mechanics, reaches threshold to land on planet

import { SHIP_SPRITES } from '../systems/SpriteSystem.js';
import { TouchControls } from '../systems/TouchControls.js';
import { ColonyHub } from '../systems/ColonyHub.js';
import { DialoguePanel } from '../systems/DialoguePanel.js';
import { AudioSystem } from '../systems/AudioSystem.js';

const TILE_SIZE = 32;  // painterly colony scale (matches world)
const MAP_W = 60;
const MAP_H = 40;
const INTERACT_RANGE = 2.1;  // how close you must be for SPACE to act on a thing

// ── Ship tutorial tool kit (local only — the ship has no live room economy).
//    The planet's server grants the same starter kit on landing; here the kits
//    teach equip-water-fill-harvest with local state. ──
const SHIP_KIT = {
  hoe:      { label: 'Hoe' },
  watering: { label: 'Watering Can' },
  pickaxe:  { label: 'Pickaxe' },
  rod:      { label: 'Fishing Rod' },
};
const SHIP_TANK_MAX = 100;   // watering-can capacity (mirror of planet/server)
const SHIP_WATER_COST = 20;  // units drained per water action
// greenhouse tap — where the can refills (planet's shore tap has the same job)
const SHIP_TAP = { x: 34, y: 21 };

// Ship layout as tile map
const SHIP_MAP = [
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,4,4,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
];

// Tile type definitions for the spaceship (new texture registry keys)
import { tex, resolveKey } from '../systems/AssetTheme.js';

const TILE_TYPES = {
  0: { tex: () => tex('ship.floor'), color: 0xdcc090 },
  1: { tex: () => tex('ship.wall'), color: 0x5a6e6e },
  2: { tex: () => tex('ship.cryopod'), color: 0xaaccaa },
  3: { tex: () => tex('ship.console'), color: 0xaad286 },
  4: { tex: () => tex('ship.planter'), color: 0x5c4a1e },
  5: { tex: () => tex('ship.door'), color: 0xff6b6b },
  6: { tex: () => tex('ship.airlock'), color: 0x82aaac },
};

// Player texture keys
const PLAYER_TEX_FRONT = () => tex('player.front');
const PLAYER_TEX_BACK = () => tex('player.back');
const PLAYER_TEX_LEFT = () => tex('player.left');
const PLAYER_TEX_RIGHT = () => tex('player.right');
const FARM_TEX = { soil: () => tex('farm.empty'), tilled: () => tex('farm.tilled'), seeded: () => tex('farm.seeded'), growing: () => tex('farm.growing'), mature: () => tex('farm.mature'), empty: () => tex('ship.floor') };

// NPC dialogue data
const NPC_DIALOGUES = {
  cora_intro: {
    text: [
      '[C.O.R.A.]: Hello, recruit. I am C.O.R.A., your Central Operations & Resource Allocator.',
      '[C.O.R.A.]: You have been in cryo-sleep for 47 years. The ship is functional.',
      '[C.O.R.A.]: Your grandfather\u2019s farm on Asteroid B-612 awaits. But first — training.',
      '[C.O.R.A.]: Move with WASD or arrow keys. Press SPACE or E to interact.',
      '[C.O.R.A.]: Your starter kit: HOE, WATERING CAN, PICKAXE, FISHING ROD. Open MENU (M) → BACKPACK to equip them.',
    ],
    x: 10, y: 4,
  },
  cryo_tutorial: {
    text: [
      '[C.O.R.A.]: Good. You can move. Now approach the cryo-pod console and press SPACE.',
      '[C.O.R.A.]: This is where you were stored. Touch it to log your awakening.',
    ],
    x: 12, y: 8,
  },
  bridge_console: {
    text: [
      '[C.O.R.A.]: Welcome to the bridge. Here you can see our trajectory.',
      '[C.O.R.A.]: Asteroid B-612 is 2.4 million kilometers ahead.',
      '[C.O.R.A.]: The power crystal needs a PICKAXE. Open MENU (M) → BACKPACK and equip it.',
      '[C.O.R.A.]: Then press SPACE to swing. Each asteroid yields 50-100 credits worth of ore.',
    ],
    x: 40, y: 4,
  },
  greenhouse_tutorial: {
    text: [
      '[C.O.R.A.]: This is the greenhouse module. Practice farming here.',
      '[C.O.R.A.]: Step 1: Equip the HOE and press SPACE on an empty planter to till it.',
      '[C.O.R.A.]: Step 2: Press SPACE again to plant a seed.',
      '[C.O.R.A.]: Step 3: Equip the WATERING CAN and press SPACE to water the seedling.',
      '[C.O.R.A.]: The can drains as you water — refill it at the GREENHOUSE TAP.',
      '[C.O.R.A.]: Crops grow overnight. Sleep in the bunk, then harvest with bare hands.',
      '[C.O.R.A.]: Earn 500 credits total to qualify for planetary landing.',
    ],
    x: 30, y: 22,
  },
  greenhouse_tap: {
    text: [
      '[C.O.R.A.]: The greenhouse tap. Gasket-gleaming, gravity-fed stardust dew.',
      '[C.O.R.A.]: Equip the WATERING CAN and press SPACE to fill it back to 100.',
    ],
    x: 34, y: 22,
  },
  airlock: {
    text: [
      '[C.O.R.A.]: You have earned enough credits for landing. Proceeding to airlock.',
      '[C.O.R.A.]: Prepare for planetary descent.',
    ],
    x: 46, y: 14,
  },
};

// ── Tutorial POI registry — every place the player must find, labelled so the
//    ship reads as a map of buildings instead of anonymous dark pixels ──
const POI_SPECS = [
  { id: 'cryo',       x: 12,   y: 8.6, label: 'CRYO POD',       tone: '0x9fffd8', c: '#9fffd8', sub: 'Wake here' },
  { id: 'bridge',     x: 40,   y: 4.4, label: 'BRIDGE CONSOLE', tone: '0xffe9a0', c: '#ffe9a0', sub: 'Pickaxe → credits' },
  { id: 'greenhouse', x: 31,   y: 20.8,label: 'GREENHOUSE',     tone: '0xb6ff9a', c: '#b6ff9a', sub: 'Hoe · plant · water' },
  { id: 'tap',        x: 34,   y: 21,  label: 'GREENHOUSE TAP', tone: '0x67e1cd', c: '#a8eeff', sub: 'Refill the can' },
  { id: 'bunk',       x: 21.5, y: 4.2, label: 'BUNK',            tone: '0xd9b8ff', c: '#d9b8ff', sub: 'Sleep → next day', noLabel: true },
  { id: 'airlock',    x: 46,   y: 13.2,label: 'AIRLOCK',         tone: '0x9adcff', c: '#9adcff', sub: '500 cr → descend' },
];

class SpaceshipScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SpaceshipScene' });
  }

  preload() {
    AudioSystem.preload(this);
  }

  create() {
    const { width, height } = this.game.config;

    // ── Background (warm deep-space, not harsh 80s black-blue) ──
    this.add.rectangle(width / 2, height / 2, width, height, 0x101830);

    // ── Tilemap with pixel-art sprites ──
    this.mapData = [...SHIP_MAP];
    this.tileSprites = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = y * MAP_W + x;
        const val = this.mapData[idx];
        const tileInfo = TILE_TYPES[val] || TILE_TYPES[0];
        const texKey = tileInfo.tex();
        const spr = this.add.image(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          texKey
        );
        spr.tileVal = val;
        this.tileSprites.push(spr);
      }
    }

    // ── Player (pixel art) ──
    this.playerSpr = this.add.image(TILE_SIZE * 4 + TILE_SIZE / 2, TILE_SIZE * 6 + TILE_SIZE / 2, PLAYER_TEX_FRONT());
    this.playerSpeed = 6;
    this.playerDir = 'front';

    // ── Camera: zoom in on the action so sprites read clearly (2000s JRPG) ──
    this.cam = this.cameras.main;
    this.cam.setZoom(1.0);
    // follow the player smoothly so the interior stays navigable
    this.camTarget = this.add.image(this.playerSpr.x, this.playerSpr.y, PLAYER_TEX_FRONT()).setVisible(false);
    this.cam.startFollow(this.camTarget, false, 0.12, 0.12);
    this.cam.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);
    // counter the zoom so the full-screen dialogue/HUD aren't scaled up
    // (HUD/text created later will use setScrollFactor(0) to stay fixed)

    // ── Cinematic depth: vignette frames the interior; a starfield porthole on the hull ──
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.vignette'))
      .setDepth(960).setScrollFactor(0);
    this.porthole = this.add.image(696, 184, tex('ship.porthole')).setDepth(210).setScale(1.6);
    this.warmGlow = this.add.image(704, 256, tex('fx.lampGlow')).setDepth(150)
      .setScale(2.4).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
    // living porthole — a drift of stars behind the glass, twinkle + parallax
    this.portholeStars = [];
    this._portholeX = 696; this._portholeY = 184;
    for (let i = 0; i < 28; i++) {
      const st = this.add.circle(
        this._portholeX - 52 + Math.random() * 104,
        this._portholeY - 22 + Math.random() * 52,
        Math.random() < 0.7 ? 1 : 1.6,
        0xdffbff, 0.25 + Math.random() * 0.6
      ).setDepth(212);
      st.sp = 0.004 + Math.random() * 0.012;   // drift speed
      st.ph = Math.random() * Math.PI * 2;      // twinkle phase
      this.portholeStars.push(st);
    }
    // cryo-pod + bridge console breathe softly (the ship is alive, not a diorama)
    this.consoleGlow = this.add.image(40 * TILE_SIZE + TILE_SIZE / 2, 4 * TILE_SIZE + 12, tex('fx.lampGlow'))
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(205).setScale(1.1).setAlpha(0.18);
    this.cryoGlow = this.add.image(12 * TILE_SIZE + TILE_SIZE / 2, 8 * TILE_SIZE + 14, tex('fx.lampGlow'))
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(205).setScale(0.95).setAlpha(0.14);

    // ── Bunk (your bed) — warm PX banner + label, sleep to end the day ──
    const bunkX = 22, bunkY = 4;
    this.bunkSpr = this.add.container(TILE_SIZE * bunkX, TILE_SIZE * bunkY + TILE_SIZE / 2);
    const bunkBg = this.add.rectangle(0, 0, TILE_SIZE * 2, TILE_SIZE * 1.4, 0x2a2438)
      .setStrokeStyle(1, 0xe0a860);
    this.bunkSpr.add(bunkBg);
    this.bunkSpr.add(this.add.text(0, -TILE_SIZE * 0.4, 'BUNK', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '7px', color: '#ffe9a0',
    }).setOrigin(0.5));
    this.bunkSpr.add(this.add.text(0, TILE_SIZE * 0.4, 'SLEEP →', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '6px', color: '#a8d8d8',
    }).setOrigin(0.5));

    // ── POI signposts — every interactable glows and wears a labelled plate so
    //    you can always tell what's a building / a machine / a door ──
    this.poiBadges = [];
    for (const p of POI_SPECS) this.poiBadges.push(this._buildPOIBadge(p));

    // ── "GO HERE" objective marker + off-screen compass arrow ──
    this.objMarker = this.add.container(0, 0);
    this.objMarker.add(this.add.text(0, 0, '▼', {
      fontFamily: 'system-ui, sans-serif', fontSize: '16px', fontStyle: 'bold',
      color: '#ffd74a', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5));
    this.objMarker.add(this.add.text(0, 17, 'GO HERE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '8px', fontStyle: 'bold',
      color: '#ffe9a0', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5));
    this.objMarker.setDepth(230).setVisible(false);
    this._markerBaseY = 0;
    this.edgeArrow = this.add.graphics().setScrollFactor(0).setDepth(990);

    // ── Our little guide droid (BEEP) — flies ahead and shows you what's next ──
    this.droid = this.add.image(this.playerSpr.x + 22, this.playerSpr.y, tex('ship.droid'))
        .setDepth(220);
    this.droidCue = this.add.text(0, 0, '', { fontFamily: "system-ui,'Segoe UI'", fontSize: '11px', color: '#a8eeff', stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5).setDepth(221);
    this.droidCue.setVisible(false);
    this.droidY0 = this.droid.y;
    this.time.addEvent({ delay: 90, loop: true, callback: () => {
        this.droid.y = this.droidY0 + Math.sin(this.time.now / 160) * 5;
    } });

    // ── HUD (fixed to screen) ──
    this.hudBg = this.add.rectangle(width / 2, height - 20, width, 40, 0x16181f, 0.8).setScrollFactor(0);
    this.hudText = this.add.text(10, height - 32, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '11px', color: '#ffe3a8',
    }).setScrollFactor(0);

    // ── Persistent tutorial tracker — top-left checklist + descent-fuel bar ──
    const TRACK_W = 246, TRACK_H = 122;
    this.trackerBg = this.add.rectangle(12 + TRACK_W / 2, 12 + TRACK_H / 2, TRACK_W, TRACK_H, 0x0c1019, 0.85)
      .setScrollFactor(0).setDepth(984).setStrokeStyle(2, 0x39c5bb, 0.85);
    this.trackerTitle = this.add.text(26, 20, 'TUTORIAL', {
      fontFamily: "system-ui, 'Segoe UI'", fontSize: '10px', fontStyle: 'bold',
      color: '#39c5bb', stroke: '#000', strokeThickness: 3,
    }).setScrollFactor(0).setDepth(985);
    this.trackerText = this.add.text(26, 38, '', {
      fontFamily: "system-ui, 'Segoe UI'", fontSize: '10px', color: '#dfe6ff', lineSpacing: 5,
    }).setScrollFactor(0).setDepth(985);
    const fuelX = 26, fuelY = 12 + TRACK_H - 22, fuelW = TRACK_W - 42;
    this.fuelW = fuelW;
    this.fuelBg = this.add.rectangle(fuelX + fuelW / 2, fuelY, fuelW, 11, 0x1b2230, 1)
      .setScrollFactor(0).setDepth(985).setStrokeStyle(1, 0x3a4a5e, 1);
    this.fuelFill = this.add.rectangle(fuelX, fuelY, 2, 9, 0xffcf5e, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(986);
    this.fuelLabel = this.add.text(fuelX + fuelW, fuelY - 10, '', {
      fontFamily: "system-ui, 'Segoe UI'", fontSize: '9px', fontStyle: 'bold',
      color: '#ffd98a', stroke: '#000', strokeThickness: 2,
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(986);

    // ── Dialogue system (shared component: warm framed panel, cozy JRPG) ──
    // One DialoguePanel backs every scene's speech box — this one shows C.O.R.A.'s
    // tutorial lines, clipped + scrollable + collapsible like the planet's.
    this.dialog = new DialoguePanel(this, {
      x: width / 2, y: height * 0.84,
      width: Math.round(width * 0.7), height: Math.round(height * 0.2),
      fontSize: '14px',
    });
    // alias for any legacy refs
    this.dialogueBox = this.dialog.box;
    this.dialogueText = this.dialog.text;

    // ── Tutorial state ──
    this.tutorialStep = 0;
    this.credits = 0;
    this.energy = 100;
    this.tool = 'none';
    this.cropsPlanted = 0;
    this.cropsHarvested = 0;
    this.dayCount = 0;
    this.interactables = [];
    this.advanceButton = null;
    this.miningActive = false;

    // ── Tool kit (local tutorial economy; the planet's server grants the same
    //    starter kit on landing) ──
    this.tools = { hoe: 'base', watering: 'base', pickaxe: 'base', rod: 'base' };
    this.equipped = '';                 // '' = hands | 'hoe' | 'watering' | 'pickaxe' | 'rod'
    this.waterLevel = SHIP_TANK_MAX;    // watering-can tank (drains as you water)

    // ── The Colony Hub — same one-menu-one-path interface the planet uses:
    //    desktop M and the mobile MENU button both land here. ──
    this.showingHub = false;
    this.hub = new ColonyHub(this).build();
    this.hub.setSections([
      { id: 'backpack', label: 'BACKPACK', hint: 'equip tools · can tank', run: () => this.openBackpack() },
      { id: 'greenhouse', label: 'GREENHOUSE', hint: 'practice farming · refill the can', run: () => this._guideToGreenhouse() },
    ]);

    // ── Backpack panel (ship-local): equip Hands/Hoe/Can/Pickaxe/Rod. Rows are
    //    tap targets (mobile) AND 1-5 keys (desktop) — the planet teaches the
    //    same screen, so nothing new to learn after landing. ──
    this.showingBackpack = false;
    this.backpackPanel = this.add.container(width / 2, height / 2).setDepth(1015).setVisible(false);
    this.backpackPanel.add(this.add.rectangle(0, 0, 460, 340, 0x0a0f1a, 0.95).setStrokeStyle(3, 0x67e1cd));
    this.backpackPanel.add(this.add.text(0, -146, 'BACKPACK - EQUIP TOOLS', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '14px', color: '#9dffec',
    }).setOrigin(0.5));
    this.backpackPanel.add(this.add.text(0, 156, '[1-5] EQUIP    [SPACE/B] CLOSE', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5));
    this._backpackDynamic = [];

    // ── Greenhouse tap — a small teal faucet where the can refills ──
    this.tapGfx = this.add.graphics().setDepth(205);
    const tapX = SHIP_TAP.x * TILE_SIZE, tapY = SHIP_TAP.y * TILE_SIZE;
    this.tapGfx.fillStyle(0x0d4a50, 0.9).fillCircle(tapX, tapY, 7);
    this.tapGfx.fillStyle(0x67e1cd, 0.95).fillCircle(tapX, tapY, 4);
    this.tapGfx.lineStyle(1.2, 0x9dffec, 0.6).strokeCircle(tapX, tapY, 7);
    this.tapLabel = this.add.text(tapX, tapY + 14, 'WATER TAP', {
      fontFamily: "system-ui,'Segoe UI'", fontSize: '9px', color: '#a8eeff', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(206);

    // rework: persistent guidance state (checklist + active objective)
    this.checks = { wake: false, equip: false, power: false, plant: false, sleep: false, descend: false };
    this.objective = null;      // { id, x, y, label }
    this._fuelTarget = null;    // 'greenhouse' | 'bridge' — where the money lives

    // Define interactable positions
    this.defineInteractables();

    // ── Input ──
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard.addKey('W'),
      A: this.input.keyboard.addKey('A'),
      S: this.input.keyboard.addKey('S'),
      D: this.input.keyboard.addKey('D'),
    };
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard.addKey('E');
    this.mKey = this.input.keyboard.addKey('M');
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.oneKey = this.input.keyboard.addKey('ONE');
    this.twoKey = this.input.keyboard.addKey('TWO');
    this.threeKey = this.input.keyboard.addKey('THREE');
    this.fourKey = this.input.keyboard.addKey('FOUR');
    this.fiveKey = this.input.keyboard.addKey('FIVE');

    // Touch controls — on-screen virtual controller for iPhone
    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // Show the opening dialogue + our first objective (droid introduces the CRYO POD)
    this.showDialogue(NPC_DIALOGUES.cora_intro.text);
    this.setObjective('wake', 'Wake from the CRYO POD below — walk down and press SPACE.', this.cryoPod.x, this.cryoPod.y);

    // ── Audio: boot BGM + SFX on first input (autoplay policy) ──
    this.audio = new AudioSystem(this);
    const bootAudio = () => { this.audio.boot(); if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setContext('ship'); };
    this._bootAudio = bootAudio;            // TouchControls reuses this for DOM-button gestures
    this.input.once('pointerdown', bootAudio);
    this.input.keyboard.once('keydown', bootAudio);

    // Initial render
    this.renderSprites();
  }

  defineInteractables() {
    // Positions doubled from original 30x20 map — now 60x40
    this.cryoPod = { x: 12, y: 8, used: false };
    this.bunk = { x: 22, y: 4, label: 'BUNK' };  // your bed — sleep to advance the day
    this.bridgeConsole = { x: 40, y: 4, mined: false };
    this.planters = [
      { x: 30, y: 22, state: 'empty', crop: '', growth: 0, watered: false },
      { x: 32, y: 22, state: 'empty', crop: '', growth: 0, watered: false },
      { x: 30, y: 24, state: 'empty', crop: '', growth: 0, watered: false },
      { x: 32, y: 24, state: 'empty', crop: '', growth: 0, watered: false },
    ];
    this.airlock = { x: 46, y: 14, locked: true };
  }

  moveDir(dir) {
    // Set direction for continuous movement in update loop
    // The virtual D-pad buttons trigger this on press; the update loop reads the direction
    this.touchDir = dir;
  }

  /** Stop movement from touch (called on button release) */
  stopMove() {
    this.touchDir = null;
  }

  update(time, delta) {
    // ── Panel lock: while the hub or backpack is open the ship holds still.
    //    M/menu toggles the hub, ESC/B closes panels, and the number keys
    //    drive equip rows (the same interaction the planet uses). ──
    if (this.showingBackpack || (this.showingHub && this.hub)) {
      // M over the backpack closes panels rather than stacking the hub on top;
      // over the hub it toggles the hub like the mobile MENU button does.
      if (Phaser.Input.Keyboard.JustDown(this.mKey)) {
        if (this.showingBackpack) this.closeAllPanels();
        else this.toggleHub();
      }
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.closeAllPanels();
      if (this.showingBackpack) {
        const rowTools = ['', 'hoe', 'watering', 'pickaxe', 'rod'];
        const rowKeys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey, this.fiveKey];
        rowKeys.forEach((k, i) => { if (k && Phaser.Input.Keyboard.JustDown(k)) this.equipTool(rowTools[i]); });
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.closeAllPanels();
      }
      if (this.showingHub && this.hub) {
        const numKeys = [this.oneKey, this.twoKey, this.threeKey, this.fourKey, this.fiveKey];
        numKeys.forEach((k, i) => { if (k && Phaser.Input.Keyboard.JustDown(k)) this.hub.confirm(i); });
        if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) this.hub.move(-1);
        else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) this.hub.move(1);
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) this.hub.confirm(this.hub.sel);
      }
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.mKey)) this.toggleHub();
    // ── Movement ──
    let dx = 0, dy = 0;

    // Keyboard movement
    if (this.wasd.W.isDown || this.cursors.up.isDown) { dy = -this.playerSpeed; this.playerDir = 'back'; }
    else if (this.wasd.S.isDown || this.cursors.down.isDown) { dy = this.playerSpeed; this.playerDir = 'front'; }
    if (this.wasd.A.isDown || this.cursors.left.isDown) { dx = -this.playerSpeed; this.playerDir = 'left'; }
    else if (this.wasd.D.isDown || this.cursors.right.isDown) { dx = this.playerSpeed; this.playerDir = 'right'; }

    // Touch movement (continuous from virtual D-pad)
    if (!dx && !dy && this.touchDir) {
      switch (this.touchDir) {
        case 'up': dy = -this.playerSpeed; this.playerDir = 'back'; break;
        case 'down': dy = this.playerSpeed; this.playerDir = 'front'; break;
        case 'left': dx = -this.playerSpeed; this.playerDir = 'left'; break;
        case 'right': dx = this.playerSpeed; this.playerDir = 'right'; break;
      }
    }

    // Normalize diagonal
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    const newX = this.playerSpr.x + dx;
    const newY = this.playerSpr.y + dy;

    // Collision with walls
    const tileX = Math.floor(newX / TILE_SIZE);
    const tileY = Math.floor(newY / TILE_SIZE);
    const idx = tileY * MAP_W + tileX;
    const tileVal = this.mapData[idx];
    if (tileVal !== 1) {
      this.playerSpr.x = newX;
      this.playerSpr.y = newY;
    } else {
      const tryX = this.playerSpr.x + dx;
      const tryXidx = Math.floor(tryX / TILE_SIZE);
      if (this.mapData[tileY * MAP_W + tryXidx] !== 1) this.playerSpr.x = tryX;
      const tryY = this.playerSpr.y + dy;
      const tryYidx = Math.floor(tryY / TILE_SIZE);
      if (this.mapData[tryYidx * MAP_W + tileX] !== 1) this.playerSpr.y = tryY;
    }

    // ── Interact / dialogue advance (shared with the touchbar A-button) ──
    // SPACE acts first on whatever you're next to; otherwise it dismisses an
    // open dialogue; otherwise it coaches you to walk closer. The action never
    // gets swallowed by an open dialogue box.
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this._pressAction();
    }

    // ── Send player position to server ──
    const net = window.SpaceFarmer.net;
    if (net && net.connected) {
      net.send('move', { x: this.playerSpr.x, y: this.playerSpr.y });
    }

    // ── Camera follows the player ──
    if (this.camTarget) {
      this.camTarget.setPosition(this.playerSpr.x, this.playerSpr.y);
    }

    // ── Update HUD ──
    const inHand = this.equipped ? SHIP_KIT[this.equipped].label : 'HANDS';
    const tankPart = this.equipped === 'watering' ? ` 💧${this.waterLevel}/${SHIP_TANK_MAX}` : '';
    this.hudText.setText(
      `💰 ${this.credits} cr  ⚡ ${this.energy}  🛠️ ${inHand}${tankPart}  📅 Day ${this.dayCount}`
    );

    // ── Update planter visuals + render sprites ──
    this.moveIntent = !!(dx || dy);
    this._updateObjectiveMarkers(time);
    this.renderSprites(time);
  }

  // ── Pixel-art render pass ──
  renderSprites(time = 0) {
    // walk cycle — 3 frames × 4 directions (single-sourced player frames),
    // matching the planet's player exactly; idle holds frame 0.
    const moving = !!(this.touchDir || this.moveIntent);
    const f = moving ? Math.floor(time / 120) % 3 : 0;
    this.playerSpr.setTexture(`player.${this.playerDir}_${f}`);

    // living porthole: stars drift, twinkle, and slide in parallax
    if (this.portholeStars) {
      for (const st of this.portholeStars) {
        st.x -= 0.008; st.y += 0.004;
        if (st.x < this._portholeX - 56) st.x = this._portholeX + 56;
        if (st.y > this._portholeY + 30) st.y = this._portholeY - 28;
        st.alpha = 0.15 + 0.5 * (0.5 + 0.5 * Math.sin(time * st.sp + st.ph));
      }
    }
    if (this.warmGlow) {
      this.warmGlow.setAlpha(0.16 + 0.10 * Math.sin(time * 0.0022));
      this.warmGlow.y = 256 + Math.sin(time * 0.0014) * 2;
    }
    if (this.consoleGlow) this.consoleGlow.setScale(0.9 + 0.16 * (0.5 + 0.5 * Math.sin(time * 0.0037)));
    if (this.cryoGlow) this.cryoGlow.setAlpha(0.10 + 0.08 * Math.sin(time * 0.0029));
    if (this.poiBadges) {
      for (const b of this.poiBadges) {
        if (b.glow) b.glow.setAlpha(0.10 + 0.07 * (0.5 + 0.5 * Math.sin(time * 0.0032 + b.phase)));
      }
    }

    // Update tile sprites based on value
    for (let i = 0; i < this.tileSprites.length; i++) {
      const spr = this.tileSprites[i];
      const val = this.mapData[i];
      const tileInfo = TILE_TYPES[val] || TILE_TYPES[0];
      // planters (val 4) are handled below; give them a base for now
      const texKey = val === 4 ? tex('ship.floor') : tileInfo.tex();
      spr.setTexture(texKey);
    }

    // Update planter visuals (they override tile sprites)
    for (const p of this.planters) {
      const idx = p.y * MAP_W + p.x;
      const spr = this.tileSprites[idx];
      if (!spr) continue;
      spr.setTexture((FARM_TEX[p.state] || FARM_TEX.soil)());
      // sway the living crop — growing/mature plants breathe
      const baseY = p.y * TILE_SIZE + TILE_SIZE / 2;
      const sway = (p.state === 'growing' || p.state === 'mature') ? Math.sin(time * 0.004 + p.x * 0.7) * 1.6 : 0;
      spr.y = baseY + sway;
    }
  }

  handleInteract() {
    const px = this.playerSpr.x / TILE_SIZE;
    const py = this.playerSpr.y / TILE_SIZE;
    const range = INTERACT_RANGE;

    // Check proximity to interactables
    if (this.dist(px, py, this.cryoPod.x, this.cryoPod.y) < range && !this.cryoPod.used) {
      this.cryoPod.used = true;
      this.showDialogue(NPC_DIALOGUES.cryo_tutorial.text);
      this.checks.wake = true;
      this.tutorialStep = 1;
      this.tool = 'none';
      this.setObjective('power', 'Awake! Equip the PICKAXE (MENU → BACKPACK), then mine the BRIDGE CONSOLE to restore power.', this.bridgeConsole.x, this.bridgeConsole.y);
      return;
    }

    // Cryo pod / bunk — "go to bed" to sleep and advance the day (Harvest Moon style)
    if (this.dist(px, py, 22, 4) < range) {
      this.goToBed();
      return;
    }

    // Bridge console — needs the PICKAXE equipped (same rule as the planet:
    //    tools gate their craft; the console teaches you to switch tools).
    if (this.dist(px, py, this.bridgeConsole.x, this.bridgeConsole.y) < range) {
      if (this.equipped !== 'pickaxe') {
        this._cueText('The crystal needs a PICKAXE — open MENU (M) → BACKPACK and equip it.');
        return;
      }
      if (!this.bridgeConsole.mined) {
        this.mineAsteroid();
      } else {
        this.showDialogue(['[Console]: Mining complete. Power levels nominal.']);
      }
      return;
    }

    // Greenhouse tap — equip the can and press SPACE to refill it.
    if (this.dist(px, py, SHIP_TAP.x, SHIP_TAP.y) < range) {
      if (this.equipped !== 'watering') {
        this._cueText('Equip the WATERING CAN (MENU → BACKPACK) to use the tap.');
        return;
      }
      this.waterLevel = SHIP_TANK_MAX;
      this.showDialogue(NPC_DIALOGUES.greenhouse_tap.text);
      // if we were told to refill mid-watering, point back at the plants
      if (this.objective && this.objective.id === 'tap') {
        const seeded = this.planters.find(p => p.state === 'seeded');
        this.setObjective('plant', 'Can is full! Walk to a seeded planter and water it.', seeded ? seeded.x : 31, seeded ? seeded.y : 23);
      }
      this._refreshTracker();
      return;
    }

    // Planters
    for (const p of this.planters) {
      if (this.dist(px, py, p.x, p.y) < range) {
        this.handlePlanter(p);
        return;
      }
    }

    // Airlock
    if (this.dist(px, py, this.airlock.x, this.airlock.y) < range) {
      if (this.credits >= 500) {
        this.checks.descend = true;
        this.showDialogue(NPC_DIALOGUES.airlock.text);
        this._refreshTracker();
        this.setObjective('descend', 'You did it! Stay by the AIRLOCK — descent starting.', this.airlock.x, this.airlock.y);
        this.time.delayedCall(3000, () => this.landOnPlanet());
      } else {
        this.showDialogue([`[Airlock]: Need 500 cr to descend (you have ${this.credits} cr). Equip the PICKAXE and mine, or harvest with HANDS.`]);
        if (this.objective && this.objective.id !== 'fuel') {
          this.setObjective('fuel', 'Earn 500 cr — mine with the PICKAXE, harvest with HANDS.', this.bridgeConsole.x, this.bridgeConsole.y);
        }
      }
      return;
    }
  }

  // one shared action path for SPACE/E (desktop) and the touchbar A-button
  // (mobile): act on a nearby thing first, else dismiss dialogue, else coach.
  // The hub/backpack are first-class panels here too (same as the planet).
  _pressAction() {
    if (this.showingHub && this.hub) { this.hub.confirm(this.hub.sel); return; }
    if (this.showingBackpack) { this.closeAllPanels(); return; }
    if (this._nearInteractable()) {
      this.handleInteract();
    } else if (this.dialog.visible) {
      this.dismissDialogue();
    } else {
      this._cueStandCloser();
    }
  }

  closeAllPanels() {
    if (this.backpackPanel) this.backpackPanel.setVisible(false);
    if (this.hub) this.hub.close();
    this.showingBackpack = false;
    this.showingHub = false;
  }

  // ── Colony Hub — M (desktop) and MENU (mobile) both land here, the same
  //    one-menu path the planet uses. ──
  toggleHub() {
    if (this.hub) this.hub.toggle();
    this.showingHub = this.hub ? this.hub.open : !this.showingHub;
  }

  // ── Backpack (ship tutorial): equip tools from the starter kit. Purely
  //    local — the kit travels with you; the planet server re-grants it. ──
  openBackpack() {
    this.showingBackpack = true;
    this.backpackPanel.setVisible(true);
    this._renderBackpack();
  }

  equipTool(toolId) {
    const tool = toolId || '';
    if (tool && !this.tools[tool]) { this._cueText(`You don't own that tool yet.`); return; }
    this.equipped = tool;
    if (tool === '') { this._cueText('Hands free — harvest & interact.'); }
    else { this._cueText(`Equipped ${SHIP_KIT[tool].label}.`); }
    if (!this.checks.equip) {
      this.checks.equip = true;   // tracker line flips once you've used the menu
    }
    this._renderBackpack();
    this._refreshTracker();
  }

  _renderBackpack() {
    if (!this.backpackPanel) return;
    for (const d of this._backpackDynamic) d.destroy();
    this._backpackDynamic = [];
    const equipped = this.equipped || '';
    const rowH = 50, rowGap = 4, topY = -110;
    const defs = [
      { id: '',      label: 'HANDS',       sub: 'harvest · interact' },
      { id: 'hoe',     label: 'HOE',            sub: 'till soil' },
      { id: 'watering',label: 'WATERING CAN',    sub: `water crops · tank 💧 ${this.waterLevel}/${SHIP_TANK_MAX}` },
      { id: 'pickaxe', label: 'PICKAXE',         sub: 'mine the bridge crystal' },
      { id: 'rod',     label: 'FISHING ROD',     sub: 'cast at the planet shore' },
    ];
    const f = { fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", stroke: '#04080c', strokeThickness: 2 };
    defs.forEach((d, i) => {
      const cur = equipped === d.id;
      const y = topY + i * (rowH + rowGap);
      const rect = this.add.rectangle(0, y, 400, rowH - 6, cur ? 0x1a3344 : 0x101a26, 0.96)
        .setStrokeStyle(cur ? 2 : 1, cur ? 0x67e1cd : 0x2c3c50)
        .setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => this.equipTool(d.id));
      const name = this.add.text(-186, y, `[${i + 1}] ${d.label}${cur ? '   ◀ IN HAND' : ''}`, {
        ...f, fontSize: '12px', color: cur ? '#9dffec' : '#e8ecff', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const sub = this.add.text(-186, y + 16, d.sub, {
        ...f, fontSize: '9px', color: '#8fb8ae',
      }).setOrigin(0, 0.5);
      this._backpackDynamic.push(rect, name, sub);
      this.backpackPanel.add([rect, name, sub]);
    });
    const foot = this.add.text(0, 150, 'Starter kit — tools are yours. The planet smithy can upgrade them for credits.', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '9px', color: '#8fb8ae', align: 'center',
      wordWrap: { width: 420 },
    }).setOrigin(0.5);
    this.backpackPanel.add(foot);
    this._backpackDynamic.push(foot);
  }

  // hub row: point the guidance at the greenhouse (teaching the tap/farm loop)
  _guideToGreenhouse() {
    this.closeAllPanels();
    this._moveMarkerTo(31, 23);
    this._cueText('Walk to the GREENHOUSE — till, plant, water, harvest.');
  }

  // true when the player stands close enough to act on any interactable —
  // the same single range the GO HERE marker uses before it flashes "PRESS SPACE"
  _nearInteractable() {
    const px = this.playerSpr.x / TILE_SIZE;
    const py = this.playerSpr.y / TILE_SIZE;
    if (this.dist(px, py, this.cryoPod.x, this.cryoPod.y) < INTERACT_RANGE && !this.cryoPod.used) return true;
    if (this.dist(px, py, 22, 4) < INTERACT_RANGE) return true;
    if (this.dist(px, py, this.bridgeConsole.x, this.bridgeConsole.y) < INTERACT_RANGE) return true;
    if (this.dist(px, py, SHIP_TAP.x, SHIP_TAP.y) < INTERACT_RANGE) return true;
    for (const p of this.planters) {
      if (this.dist(px, py, p.x, p.y) < INTERACT_RANGE) return true;
    }
    if (this.dist(px, py, this.airlock.x, this.airlock.y) < INTERACT_RANGE) return true;
    return false;
  }

  // pressed SPACE with nothing in range: coach the player toward the nearest
  // interactable instead of silently doing nothing (or worse, looping dialogue)
  _cueStandCloser() {
    if (!this.droidCue) return;
    const px = this.playerSpr.x / TILE_SIZE;
    const py = this.playerSpr.y / TILE_SIZE;
    const spots = [
      { x: this.cryoPod.x, y: this.cryoPod.y, label: 'cryo-pod' },
      { x: 22, y: 4, label: 'bunk' },
      { x: this.bridgeConsole.x, y: this.bridgeConsole.y, label: 'bridge console' },
      { x: SHIP_TAP.x, y: SHIP_TAP.y, label: 'greenhouse tap' },
      ...this.planters.map(p => ({ x: p.x, y: p.y, label: 'planter' })),
      { x: this.airlock.x, y: this.airlock.y, label: 'airlock' },
    ];
    let best = null, bestD = Infinity;
    for (const s of spots) {
      const d = this.dist(px, py, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best && bestD < 4.5) {
      this._cueText(`Walk closer to the ${best.label}, then press SPACE.`);
    }
  }

  // one-shot droid hint bubble that fades (does not clobber the guidance marker)
  _cueText(msg) {
    this.droidCue.setText(msg).setPosition(this.playerSpr.x + 4, this.playerSpr.y - 40).setVisible(true);
    this.droidCue.alpha = 1;
    const cue = this.droidCue;
    this.time.delayedCall(3600, () => {
      if (this.droidCue && this.droidCue === cue) {
        this.tweens.add({ targets: this.droidCue, alpha: 0, duration: 300, onComplete: () => this.droidCue.setVisible(false) });
      }
    });
  }

  dist(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
  }

  // fly the little droid ahead to an objective with a hint bubble
  guideDroidTo(wx, wy, msg) {
    if (!this.droid) return;
    const tx = wx * TILE_SIZE, ty = wy * TILE_SIZE;
    this.droidY0 = ty;
    this.tweens.add({ targets: this.droid, x: tx, y: ty, duration: 900, ease: 'Sine.inOut' });
    this.droidCue.setText(msg).setPosition(tx, ty - 42).setVisible(true);
    this.droidCue.alpha = 1;
    this.time.delayedCall(6500, () => { if (this.droidCue) this.tweens.add({ targets: this.droidCue, alpha: 0, duration: 300, onComplete: () => this.droidCue.setVisible(false) }); });
  }
  // curt — dismiss the droid's bubble early
  clearDroidCue() { if (this.droidCue) { this.droidCue.setVisible(false); this.droidCue.alpha = 1; } }

  // ── Guidance core ──
  // setObjective drives everything: the tracker's active line, the droid's
  // fly-ahead callout combines with the "GO HERE" marker + compass arrow.
  setObjective(id, label, x, y) {
    this.objective = { id, x, y, label };
    if (this.droid) this.guideDroidTo(x, y, label);
    this._moveMarkerTo(x, y);
    this._refreshTracker();
  }

  _moveMarkerTo(x, y) {
    if (!this.objMarker) return;
    this._markerBaseY = y * TILE_SIZE;
    this.tweens.add({ targets: this.objMarker, x: x * TILE_SIZE, duration: 500, ease: 'Sine.out' });
    this.objMarker.setVisible(true);
  }

  // each frame: bob the GO-HERE marker over the objective, flash SPACE when the
  // player is close, and draw an edge compass arrow when the target is off-view
  _updateObjectiveMarkers(time) {
    if (!this.objective || !this.objMarker) return;

    // Fuel phase auto-guidance: point at where the money comes from next.
    if (this.objective.id === 'fuel') {
      if (this.credits >= 500) {
        this.setObjective('descend', 'Descent fueled! The AIRLOCK doors are ready.', this.airlock.x, this.airlock.y);
        return;
      }
      const hasMature = this.planters.some(p => p.state === 'mature');
      const hasWork = this.planters.some(p => p.state === 'empty' || p.state === 'tilled' || p.state === 'seeded');
      const nextKey = (hasMature || hasWork) ? 'greenhouse' : 'bridge';
      if (nextKey !== this._fuelTarget) {
        this._fuelTarget = nextKey;
        if (nextKey === 'greenhouse') this._moveMarkerTo(31, 23);
        else this._moveMarkerTo(this.bridgeConsole.x, this.bridgeConsole.y);
      }
    }

    const wx = this.objective.x * TILE_SIZE;
    const wyBase = this.objective.y * TILE_SIZE;
    // gentle bob above the objective + SPACE hint once you're close enough
    this.objMarker.y = wyBase - 20 + Math.sin(time * 0.005) * 5;
    const near = this.dist(this.playerSpr.x / TILE_SIZE, this.playerSpr.y / TILE_SIZE, this.objective.x, this.objective.y) < INTERACT_RANGE;
    const hint = (near && Math.floor(time / 320) % 2 === 0) ? 'PRESS SPACE' : 'GO HERE';
    if (this.objMarker.list[1]) this.objMarker.list[1].setText(hint);
    if (!this.objMarker.visible) this.objMarker.setVisible(true);

    // edge compass arrow when the target sits outside the camera view
    const wv = this.cam.worldView;
    const sx = wx - wv.x, sy = wyBase - wv.y;
    const onScreen = sx > -10 && sx < wv.width + 10 && sy > -10 && sy < wv.height + 10;
    if (onScreen) this.edgeArrow.clear();
    else this._drawEdgeArrow(sx, sy, wv.width, wv.height);
  }

  // a fixed-on-screen triangle at the viewport edge, pointing toward the
  // objective — so there is never a moment you don't know which way to walk
  _drawEdgeArrow(sx, sy, vw, vh) {
    const g = this.edgeArrow;
    g.clear();
    const cx = vw / 2, cy = vh / 2;
    const dx = sx - cx, dy = sy - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ang = Math.atan2(dy, dx);
    // slide to the viewport border, inside by a margin
    const halfW = vw / 2 - 28, halfH = vh / 2 - 32;
    const k = Math.min(Math.abs(halfW / dx), Math.abs(halfH / dy));
    const px = cx + dx * k, py = cy + dy * k;
    const L = 22, a1 = ang - 0.45, a2 = ang + 0.45;
    g.fillStyle(0xffd74a, 1);
    g.fillTriangle(px, py, px - L * Math.cos(a1), py - L * Math.sin(a1), px - L * Math.cos(a2), py - L * Math.sin(a2));
  }

  // rebuild the top-left tutorial checklist + descent-fuel bar
  _refreshTracker() {
    if (!this.trackerText) return;
    const c = this.checks;
    const active = this.objective ? this.objective.id : 'wake';
    const line = (id, label) => {
      const isActive = active === id;
      const glyph = isActive ? '▶' : (c[id] ? '✓' : '•');
      return `${glyph} ${label}`;
    };
    this.trackerText.setText([
      line('wake', 'Wake up'),
      line('equip', 'Equip a tool'),
      line('power', 'Mine w/ pickaxe'),
      line('plant', 'Plant, water, harvest'),
      line('sleep', 'Sleep so it grows'),
      line('fuel', 'Reach 500 cr & descend'),
    ].join('\n'));
    const frac = Math.min(1, this.credits / 500);
    this.fuelFill.setDisplaySize(Math.max(2, frac * this.fuelW), 9);
    this.fuelLabel.setText(`${Math.min(500, Math.floor(this.credits))} / 500 cr`);
  }

  // a labelled, glowing signpost so every interactable reads as a "building"
  _buildPOIBadge(p) {
    const wx = p.x * TILE_SIZE, wy = p.y * TILE_SIZE;
    const glow = this.add.image(wx, wy, tex('fx.lampGlow'))
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(206).setScale(1.05).setAlpha(0.13);
    const badge = { id: p.id, glow, phase: Math.random() * Math.PI * 2 };
    if (p.noLabel) return badge;
    const color = parseInt(p.tone, 16);
    const plateW = Math.max(46, p.label.length * 6.4 + 14);
    const plate = this.add.rectangle(wx, wy - 26, plateW, 15, 0x0d121c, 0.85)
      .setStrokeStyle(1, color, 0.9).setDepth(158).setOrigin(0.5, 1);
    const txt = this.add.text(wx, wy - 22, p.label, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '9px', fontStyle: 'bold', color: p.c, stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(160);
    const sub = this.add.text(wx, wy - 4, p.sub, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '6.5px', color: '#cfd6ea', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(159).setAlpha(0.95);
    badge.plate = plate;
    badge.txt = txt;
    badge.sub = sub;
    return badge;
  }


  handlePlanter(planter) {
    switch (planter.state) {
      case 'empty':
        // tilling needs the HOE (same rule as the planet)
        if (this.equipped !== 'hoe') {
          this._cueText('Equip the HOE (MENU → BACKPACK) to till soil.');
          return;
        }
        planter.state = 'tilled';
        this.showDialogue(['[C.O.R.A.]: Tilled the soil. Press SPACE again to plant a seed.']);
        break;
      case 'tilled':
        planter.crop = 'space-wheat';
        planter.state = 'seeded';
        this.cropsPlanted++;
        this.showDialogue(['[C.O.R.A.]: Seed planted. Now equip the WATERING CAN and press SPACE to water it.']);
        break;
      case 'seeded':
        // watering needs the can, and the can needs water in the tank
        if (this.equipped !== 'watering') {
          this._cueText('Equip the WATERING CAN (MENU → BACKPACK) to water the seedling.');
          return;
        }
        if (this.waterLevel < SHIP_WATER_COST) {
          this._cueText('The can is low — refill it at the GREENHOUSE TAP.');
          this.setObjective('tap', 'Refill the can at the GREENHOUSE TAP.', SHIP_TAP.x, SHIP_TAP.y);
          return;
        }
        this.waterLevel = Math.max(0, this.waterLevel - SHIP_WATER_COST);
        planter.watered = true;
        planter.state = 'growing';
        this.showDialogue(['[C.O.R.A.]: Watered! The crop will grow overnight. Sleep to advance the day.']);
        if (!this.checks.plant) {
          this.checks.plant = true;
          this.setObjective('sleep', 'Sleep in the BUNK so the crop grows overnight.', 21.5, 4);
        } else {
          this._refreshTracker();
        }
        break;
      case 'growing':
        if (planter.growth >= 3) {
          planter.state = 'mature';
          this.handleHarvest(planter);
        } else {
          this.showDialogue([`[C.O.R.A.]: Still growing. Day ${planter.growth + 1}/3.`]);
        }
        break;
      case 'mature':
        this.handleHarvest(planter);
        break;
    }
  }

  // harvest is bare-handed — equip EMPTY HANDS first (planet rule)
  handleHarvest(planter) {
    if (this.equipped !== '') {
      this._cueText('Empty your hands (MENU → BACKPACK) to harvest.');
      return;
    }
    const reward = 50;
    this.credits += reward;
    planter.state = 'empty';
    planter.crop = '';
    planter.growth = 0;
    planter.watered = false;
    this.cropsHarvested++;
    this.showDialogue([`[C.O.R.A.]: Harvested! +${reward} credits. Total: ${this.credits} cr.`]);
    if (this.objective && (this.objective.id === 'sleep' || this.objective.id === 'plant' || this.objective.id === 'tap')) {
      this.setObjective('fuel', 'Earn 500 cr — mine with the PICKAXE and harvest with HANDS.', this.bridgeConsole.x, this.bridgeConsole.y);
    } else {
      this._refreshTracker();
    }
  }

  mineAsteroid() {
    const reward = Math.floor(Math.random() * 50) + 50;
    this.credits += reward;
    this.bridgeConsole.mined = true;
    this.showDialogue([`[Console]: Asteroid mined with the pickaxe! +${reward} credits. Total: ${this.credits} cr.`]);
    if (!this.checks.power) {
      this.checks.power = true;
      this.tutorialStep = 2;
      this.setObjective('plant', 'Power is back! Now practice farming — go to the GREENHOUSE. Equip the HOE from the BACKPACK to till, plant a seed, water with the CAN.', 31, 23);
    } else {
      this._refreshTracker();
    }
    this.time.delayedCall(5000, () => { this.bridgeConsole.mined = false; });
  }

  showDialogue(lines, footer = 'Press SPACE to continue') {
    const text = Array.isArray(lines) ? lines.join('\n') : lines;
    this.dialog.setText(text, { footer });

    if (this.dialogueTimer) this.dialogueTimer.remove();
    this.dialogueTimer = this.time.delayedCall(14000, () => this.dismissDialogue());
  }

  dismissDialogue() {
    if (this.dialogueTimer) { this.dialogueTimer.remove(); this.dialogueTimer = null; }
    if (this.dialog) this.dialog.hide();
  }

  // ── Go to bed (Harvest Moon-style sleep to end the day) ──
  // Sleep in your bunk → screen fades to dark → crops grow → wake up next morning.
  goToBed() {
    // If a sleep is already in progress, ignore
    if (this._sleeping) return;
    this._sleeping = true;

    const sleepDialog = [
      'You climb into your bunk and pull the blanket up to your chin.',
      'The ship hums softly. You dream of asteroid soil and tall crops.',
      '...',
    ];

    // Fade-to-dark overlay
    const { width, height } = this.game.config;
    const shade = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setDepth(1000);
    this.tweens.add({
      targets: shade,
      alpha: 1,
      duration: 700,
      onComplete: () => {
        this.showDialogue(sleepDialog);
        this.advanceDay();
        // wake: fade back in after a beat
        this.time.delayedCall(900, () => {
          this.tweens.add({
            targets: shade,
            alpha: 0,
            duration: 700,
            onComplete: () => { shade.destroy(); this._sleeping = false; },
          });
        });
      },
    });
  }

  advanceDay() {
    this.dayCount++;
    for (const p of this.planters) {
      if (p.state === 'growing' && p.watered) {
        p.growth++;
      }
      if (p.growth >= 3 && p.crop) {
        p.state = 'mature';
      }
    }
    if (!this.checks.sleep) {
      this.checks.sleep = true;
      if (this.objective && (this.objective.id === 'sleep' || this.objective.id === 'plant')) {
        this.setObjective('fuel', 'Earn 500 cr — mine with the PICKAXE, harvest with HANDS.', this.bridgeConsole.x, this.bridgeConsole.y);
      }
    }
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('advance');
    this.showDialogue([`[C.O.R.A.]: Day ${this.dayCount} dawns. You feel rested. Crops are growing.`]);
    this._refreshTracker();
    this.renderSprites();
  }

  landOnPlanet() {
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('completeTutorial');
    this.showDialogue(['[C.O.R.A.]: Planetary landing sequence initiated.']);
    this.time.delayedCall(3000, () => {
      this.scene.start('PlanetScene', { credits: this.credits });
    });
  }
}

export { SpaceshipScene };
