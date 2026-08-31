// SpaceshipScene.js — Tutorial level inside a spaceship
// 2000s 8-bit pixel art rendering
// Player wakes from cryo, learns mechanics, reaches threshold to land on planet

import { SHIP_SPRITES } from '../systems/SpriteSystem.js';
import { TouchControls } from '../systems/TouchControls.js';
import { DialoguePanel } from '../systems/DialoguePanel.js';
import { AudioSystem } from '../systems/AudioSystem.js';

const TILE_SIZE = 32;  // painterly colony scale (matches world)
const MAP_W = 60;
const MAP_H = 40;

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
const TILE_TYPES = {
  0: { tex: 'ship.floor', color: 0xdcc090 },
  1: { tex: 'ship.wall', color: 0x5a6e6e },
  2: { tex: 'ship.cryopod', color: 0xaaccaa },
  3: { tex: 'ship.console', color: 0xaad286 },
  4: { tex: 'ship.planter', color: 0x5c4a1e },
  5: { tex: 'ship.door', color: 0xff6b6b },
  6: { tex: 'ship.airlock', color: 0x82aaac },
};

// Player texture keys
const PLAYER_TEX_FRONT = 'player.front';
const PLAYER_TEX_BACK = 'player.back';
const PLAYER_TEX_LEFT = 'player.left';
const PLAYER_TEX_RIGHT = 'player.right';
const FARM_TEX = { soil: 'tile.soil', tilled: 'tile.tilled', seeded: 'tile.seeded', growing: 'tile.growing', mature: 'tile.mature', empty: 'ship.floor' };

// NPC dialogue data
const NPC_DIALOGUES = {
  cora_intro: {
    text: [
      '[C.O.R.A.]: Hello, recruit. I am C.O.R.A., your Central Operations & Resource Allocator.',
      '[C.O.R.A.]: You have been in cryo-sleep for 47 years. The ship is functional.',
      '[C.O.R.A.]: Your grandfather\u2019s farm on Asteroid B-612 awaits. But first — training.',
      '[C.O.R.A.]: Move with WASD or arrow keys. Press SPACE or E to interact.',
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
      '[C.O.R.A.]: But the ship needs power. Use the console to start mining nearby asteroids.',
      '[C.O.R.A.]: Press SPACE to mine. Each asteroid yields 50-100 credits worth of ore.',
    ],
    x: 40, y: 4,
  },
  greenhouse_tutorial: {
    text: [
      '[C.O.R.A.]: This is the greenhouse module. Practice farming here.',
      '[C.O.R.A.]: Step 1: Press SPACE to till soil on an empty planter.',
      '[C.O.R.A.]: Step 2: Press SPACE again to plant a seed.',
      '[C.O.R.A.]: Water the planter (press SPACE while holding watering can).',
      '[C.O.R.A.]: Crops grow overnight. Go to bed in your bunk to sleep and end the day.',
      '[C.O.R.A.]: Harvest mature crops for credits. Earn 500 credits total to qualify for planetary landing.',
    ],
    x: 30, y: 22,
  },
  airlock: {
    text: [
      '[C.O.R.A.]: You have earned enough credits for landing. Proceeding to airlock.',
      '[C.O.R.A.]: Prepare for planetary descent.',
    ],
    x: 46, y: 14,
  },
};

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
        const texKey = tileInfo.tex;
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
    this.playerSpr = this.add.image(TILE_SIZE * 4 + TILE_SIZE / 2, TILE_SIZE * 6 + TILE_SIZE / 2, PLAYER_TEX_FRONT);
    this.playerSpeed = 6;
    this.playerDir = 'front';

    // ── Camera: zoom in on the action so sprites read clearly (2000s JRPG) ──
    this.cam = this.cameras.main;
    this.cam.setZoom(1.0);
    // follow the player smoothly so the interior stays navigable
    this.camTarget = this.add.image(this.playerSpr.x, this.playerSpr.y, PLAYER_TEX_FRONT).setVisible(false);
    this.cam.startFollow(this.camTarget, false, 0.12, 0.12);
    this.cam.setBounds(0, 0, MAP_W * TILE_SIZE, MAP_H * TILE_SIZE);
    // counter the zoom so the full-screen dialogue/HUD aren't scaled up
    // (HUD/text created later will use setScrollFactor(0) to stay fixed)

    // ── Cinematic depth: vignette frames the interior; a starfield porthole on the hull ──
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.vignette')
      .setDepth(960).setScrollFactor(0);
    this.porthole = this.add.image(696, 184, 'ship.porthole').setDepth(210).setScale(1.6);
    this.warmGlow = this.add.image(704, 256, 'fx.lamp_glow').setDepth(150)
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
    this.consoleGlow = this.add.image(40 * TILE_SIZE + TILE_SIZE / 2, 4 * TILE_SIZE + 12, 'fx.lamp_glow')
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(205).setScale(1.1).setAlpha(0.18);
    this.cryoGlow = this.add.image(12 * TILE_SIZE + TILE_SIZE / 2, 8 * TILE_SIZE + 14, 'fx.lamp_glow')
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

    // ── Our little guide droid (BEEP) — flies ahead and shows you what's next ──
    this.droid = this.add.image(this.playerSpr.x + 22, this.playerSpr.y, 'ship.droid')
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
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.SPACE);
    this.eKey = this.input.keyboard.addKey('E');

    // Touch controls — on-screen virtual controller for iPhone
    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // Show initial dialogue
    this.showDialogue(NPC_DIALOGUES.cora_intro.text);
    this.tutorialStep = 0;
    // little droid guide introduces itself and leads you to the first objective
    this.droidCue.setText("I'm BEEP — I'll show you around. That's your cryo-pod down there!")
      .setPosition(this.playerSpr.x + 22, this.playerSpr.y - 30).setVisible(true);
    this.time.delayedCall(6000, () => { this.guideDroidTo(12, 8, 'Go to the cryo-pod and press SPACE to log your awakening.'); });

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

    // ── Interact button ──
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.handleInteract();
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
    this.hudText.setText(
      `💰 ${this.credits} cr  ⚡ ${this.energy}  🛠️ ${this.tool}  📅 Day ${this.dayCount}`
    );

    // ── Update planter visuals + render sprites ──
    this.moveIntent = !!(dx || dy);
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

    // Update tile sprites based on value
    for (let i = 0; i < this.tileSprites.length; i++) {
      const spr = this.tileSprites[i];
      const val = this.mapData[i];
      const tileInfo = TILE_TYPES[val] || TILE_TYPES[0];
      // planters (val 4) are handled below; give them a base for now
      const texKey = val === 4 ? 'ship.floor' : tileInfo.tex;
      spr.setTexture(texKey);
    }

    // Update planter visuals (they override tile sprites)
    for (const p of this.planters) {
      const idx = p.y * MAP_W + p.x;
      const spr = this.tileSprites[idx];
      if (!spr) continue;
      spr.setTexture(FARM_TEX[p.state] || 'tile.soil');
      // sway the living crop — growing/mature plants breathe
      const baseY = p.y * TILE_SIZE + TILE_SIZE / 2;
      const sway = (p.state === 'growing' || p.state === 'mature') ? Math.sin(time * 0.004 + p.x * 0.7) * 1.6 : 0;
      spr.y = baseY + sway;
    }
  }

  handleInteract() {
    const px = this.playerSpr.x / TILE_SIZE;
    const py = this.playerSpr.y / TILE_SIZE;
    const range = 1.5;

    // Check proximity to interactables
    if (this.dist(px, py, this.cryoPod.x, this.cryoPod.y) < range && !this.cryoPod.used) {
      this.cryoPod.used = true;
      this.showDialogue(NPC_DIALOGUES.cryo_tutorial.text);
      this.tutorialStep = 1;
      this.tool = 'none';
      this.guideDroidTo(40, 4, 'Awake! Follow me — mine the bridge console to restore power.');
      return;
    }

    // Cryo pod / bunk — "go to bed" to sleep and advance the day (Harvest Moon style)
    if (this.dist(px, py, 22, 4) < 1.8) {
      this.goToBed();
      return;
    }

    // Bridge console
    if (this.dist(px, py, this.bridgeConsole.x, this.bridgeConsole.y) < range) {
      if (!this.bridgeConsole.mined) {
        this.mineAsteroid();
      } else {
        this.showDialogue(['[Console]: Mining complete. Power levels nominal.']);
      }
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
        this.showDialogue(NPC_DIALOGUES.airlock.text);
        this.guideDroidTo(46, 14, 'You did it! Follow me to the airlock — time to descend to Asteroid B-612.');
        this.time.delayedCall(3000, () => this.landOnPlanet());
      } else {
        this.showDialogue([`[Airlock]: Insufficient credits. Need 500 cr (you have ${this.credits} cr).`]);
      }
      return;
    }

    // Generic NPC dialogue — doubled coords for 60x40 map
    if (py < 10 && !this.cryoPod.used) {
      this.showDialogue(NPC_DIALOGUES.cora_intro.text);
    } else if (px > 36 && py < 16) {
      this.showDialogue(NPC_DIALOGUES.bridge_console.text);
    } else if (py > 20 && px > 24 && px < 36) {
      this.showDialogue(NPC_DIALOGUES.greenhouse_tutorial.text);
    }
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
    this.droidCue.setText(msg).setPosition(tx, ty - 34).setVisible(true);
    this.droidCue.alpha = 1;
    this.time.delayedCall(5200, () => { if (this.droidCue) this.tweens.add({ targets: this.droidCue, alpha: 0, duration: 300, onComplete: () => this.droidCue.setVisible(false) }); });
  }
  // curt — dismiss the droid's bubble early
  clearDroidCue() { if (this.droidCue) { this.droidCue.setVisible(false); this.droidCue.alpha = 1; } }


  handlePlanter(planter) {
    switch (planter.state) {
      case 'empty':
        this.tool = 'hoe';
        planter.state = 'tilled';
        this.showDialogue(['[C.O.R.A.]: Tilled the soil. Press SPACE again to plant a seed.']);
        break;
      case 'tilled':
        this.tool = 'seeds';
        planter.crop = 'space-wheat';
        planter.state = 'seeded';
        this.cropsPlanted++;
        this.showDialogue(['[C.O.R.A.]: Seed planted. Now water it with the watering can.']);
        break;
      case 'seeded':
        this.tool = 'watering-can';
        planter.watered = true;
        planter.state = 'growing';
        this.showDialogue(['[C.O.R.A.]: Watered! The crop will grow. Advance the day to see progress.']);
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

  handleHarvest(planter) {
    const reward = 50;
    this.credits += reward;
    planter.state = 'empty';
    planter.crop = '';
    planter.growth = 0;
    planter.watered = false;
    this.cropsHarvested++;
    this.showDialogue([`[C.O.R.A.]: Harvested! +${reward} credits. Total: ${this.credits} cr.`]);
  }

  mineAsteroid() {
    const reward = Math.floor(Math.random() * 50) + 50;
    this.credits += reward;
    this.bridgeConsole.mined = true;
    this.showDialogue([`[Console]: Asteroid mined! +${reward} credits. Total: ${this.credits} cr.`]);
    this.guideDroidTo(30, 22, "Power is back. Now let's practice farming — this way to the greenhouse.");
    this.time.delayedCall(5000, () => { this.bridgeConsole.mined = false; });
  }

  showDialogue(lines) {
    const text = Array.isArray(lines) ? lines.join('\n') : lines;
    this.dialog.setText(text);

    if (this.dialogueTimer) this.dialogueTimer.remove();
    this.dialogueTimer = this.time.delayedCall(8000, () => {
      this.dialog.hide();
    });
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
    const net = window.SpaceFarmer.net;
    if (net && net.connected) net.send('advance');
    this.showDialogue([`[C.O.R.A.]: Day ${this.dayCount} dawns. You feel rested. Crops are growing.`]);
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
