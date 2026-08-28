// client/game.js — Space Farmer game client entry point
// Loaded as module in index.html — Phaser 3 loaded from CDN

import { SpaceshipScene } from './scenes/SpaceshipScene.js';
import { PlanetScene } from './scenes/PlanetScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { TEXTURES } from './systems/SpriteSystem.js';
import { MusicDirector } from './systems/MusicDirector.js';

window.SpaceFarmer = {};

// ── Register all sprites as Phaser textures ──
// TEXTURES is the single source of truth (name → canvas) from SpriteSystem.
function registerTextures(game) {
  for (const [name, canvas] of Object.entries(TEXTURES)) {
    if (game.textures.exists(name)) continue;
    game.textures.addCanvas(name, canvas);
  }
}

function init() {
  // Portrait phones: boot at the device aspect so the world fills the tall
  // screen instead of being letterboxed into a tiny 4:3 box ("game for ants").
  // Scenes read layout dims from this.game.config, so HUD/backdrop/camera adapt.
  const touchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in document.documentElement;
  const portrait = window.innerHeight > window.innerWidth;
  const base = portrait && touchDevice
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 960, height: 720 };

  const config = {
    type: Phaser.AUTO,
    width: base.width,
    height: base.height,
    parent: 'game',
    backgroundColor: '#0b0e1c',
    pixelArt: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [IntroScene, SpaceshipScene, PlanetScene],
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 0 } } // top-down, no gravity
    },
    input: { touch: true },
    render: {
      antialias: true,
      pixelArt: false,
    },
  };

  const game = new Phaser.Game(config);

  game.events.once('ready', () => {
    registerTextures(game);
    window.SpaceFarmer.gameReady = true;

    // QA deep-link: ?scene=Intro|Spaceship|Planet&night=1
    // Lets the game boot straight to a scene (deterministic screenshots/debug).
    const params = new URLSearchParams(window.location.search);
    const want = (params.get('scene') || '').toLowerCase();
    const sceneKey =
      want === 'planet' ? 'PlanetScene' :
      want === 'spaceship' || want === 'ship' ? 'SpaceshipScene' :
      want === 'intro' ? 'IntroScene' : null;
    if (sceneKey) {
      const startIt = () => {
        // Stop the auto-advancing intro/shipping scene if it's running,
        // so the deep-linked target scene stays active.
        const running = game.scene.getScenes(true);
        for (const sc of running) {
          if (sc.key !== sceneKey) sc.scene.stop();
        }
        const data = { credits: 100 };
        game.scene.start(sceneKey, data);
        const sc = game.scene.getScene(sceneKey);
        if (params.get('night') === '1' && sc && sc.isNight !== undefined) {
          sc.isNight = true; sc.updateNightVisuals?.(); sc.nightOverlay?.setAlpha(0.42);
          (sc.glowRegistry || []).forEach(g => g.setVisible(true));
          (sc.lampGlows || []).forEach(g => g.setVisible(true));
        }
      };
      // let the first scene boot, then swap cleanly to the target
      setTimeout(startIt, 150);
    }
  });

  window.SpaceFarmer.game = game;
  window.SpaceFarmer.music = new MusicDirector();   // generative soundtrack

  // Default to the page's origin so HTTPS deployments automatically use WSS
  // and platform-assigned ports. Embedders may override the endpoint before
  // this module boots with window.SPACE_FARMER_SERVER.
  const sameOrigin = window.location.protocol === 'file:'
    ? 'ws://localhost:8900'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  const endpoint = window.SPACE_FARMER_SERVER || sameOrigin;
  const net = new NetworkSystem();
  window.SpaceFarmer.net = net;
  net.connect(endpoint).then(() => {
    console.log('Connected to Space Farmer server');
  }).catch(err => {
    console.warn('Server connect failed (offline mode OK):', err);
  });
}

// Poll for Phaser global
function checkPhaser() {
  if (typeof Phaser !== 'undefined') {
    init();
  } else {
    setTimeout(checkPhaser, 200);
  }
}
checkPhaser();
