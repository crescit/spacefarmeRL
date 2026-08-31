// client/game.js — Space Farmer game client entry point
// Loaded as module in index.html — Phaser 3 loaded from CDN

import { SpaceshipScene } from './scenes/SpaceshipScene.js';
import { PlanetScene } from './scenes/PlanetScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { TEXTURES } from './systems/SpriteSystem.js';
import { MusicDirector } from './systems/MusicDirector.js';
import { AudioSystem } from './systems/AudioSystem.js';

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
  // Sizing: the Phaser world must match the ACTUAL #game element (the area of
  // the page above the touch bar), not the whole viewport. `window.innerHeight`
  // includes the touch bar and mobile browser chrome, so a world sized to the
  // viewport has a different aspect ratio than the canvas parent — Phaser FIT
  // then letterboxes the extras into black bars (left/right on phones).
  // Measuring #game directly gives an aspect that fills the canvas with no bars.
  const touching = (navigator.maxTouchPoints > 0) || ('ontouchstart' in document.documentElement);
  let w, h;
  if (touching) {
    const g = document.getElementById('game');
    w = g && g.clientWidth  ? g.clientWidth  : window.innerWidth;
    h = g && g.clientHeight ? g.clientHeight : window.innerHeight;
    if (!w || !h) {           // layout not ready — safe fallback, no divide-by-zero
      w = window.innerWidth; h = Math.round(w * 0.7);
    }
  } else {
    // Desktop keeps the classic 4:3 viewport, letterboxed inside the window.
    w = 960; h = 720;
  }

  const config = {
    type: Phaser.AUTO,
    width: w,
    height: Math.max(1, Math.round(h)),
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

  // Keep the canvas glued to the #game box if the viewport changes (mobile
  // URL bar collapse/expand, orientation). Re-fit to the parent's live size.
  const refit = () => {
    const g = document.getElementById('game');
    if (g && g.clientWidth > 0 && g.clientHeight > 0) {
      try { game.scale.resize(g.clientWidth, g.clientHeight); } catch (e) { /* noop */ }
    }
  };
  window.addEventListener('resize', () => setTimeout(refit, 10));

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

  // Music mute — always-on 🔊 button beside the 🎮 controller toggle. Music
  // autostarts on the first gesture (autoplay policy); this is the single
  // user control. Silences both the generative soundtrack and the wav BGM.
  (function wireMute() {
    const btn = document.getElementById('mute-float');
    if (!btn) return;
    let muted = false;
    try { muted = localStorage.getItem('spacefarmer_mute') === '1'; } catch (e) {}
    const apply = () => {
      window.SpaceFarmer.muted = muted;
      if (window.SpaceFarmer.music) window.SpaceFarmer.music.setMuted(muted);
      AudioSystem.setMuted(muted);
      btn.textContent = muted ? '🔇' : '🔊';
      btn.classList.toggle('muted', muted);
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      muted = !muted;
      try { localStorage.setItem('spacefarmer_mute', muted ? '1' : '0'); } catch (e2) {}
      apply();
    });
    apply();
  })();

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
