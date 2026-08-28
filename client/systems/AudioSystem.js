// AudioSystem.js — 2000s JRPG audio for Space Farmer.
// Wires the sounds/*.wav assets into Phaser's WebAudio.
//
// IMPORTANT (bug fixed 2026-08-21): Phaser's sound manager does NOT fetch files
// from `sound.add(key, url)` — the URL is ignored unless the file is first loaded
// via the LoaderPlugin (`scene.load.audio(key, url)` in `preload()`). This old
// version registered keys but never loaded any data, so nothing ever played.
// Every scene that plays audio MUST call `AudioSystem.preload(scene)` inside its
// own `preload()` (or rely on a shared scene that does). Then `boot()` (gated on a
// user gesture for autoplay policy) starts the BGM loop.
class AudioSystem {
  // Register all sound assets into a scene's loader. Call from scene.preload().
  static preload(scene) {
    scene.load.audio('bgm_town', '/sounds/bgm_town.wav');
    scene.load.audio('bgm_ship', '/sounds/bgm_ship.wav');
    scene.load.audio('romance', '/sounds/romance.wav');
    scene.load.audio('intro', '/sounds/intro.wav');
    scene.load.audio('select', '/sounds/select.wav');
    scene.load.audio('confirm', '/sounds/confirm.wav');
    scene.load.audio('harvest', '/sounds/harvest.wav');
    scene.load.audio('space', '/sounds/space.wav');
    scene.load.audio('star', '/sounds/star.wav');
    scene.load.audio('glow', '/sounds/glow.wav');
    scene.load.audio('bounce', '/sounds/bounce.wav');
    scene.load.audio('alarm', '/sounds/alarm.wav');
  }

  constructor(scene) {
    this.scene = scene;
    this.ready = false;
    this.bgm = null;
    this._dup = false;
  }

  // Call on first user gesture (Phaser blocks audio before a gesture).
  boot() {
    if (this.ready || this._dup) return;
    this._dup = true;
    const sound = this.scene.sound;
    if (!sound) return;
    // Files are loaded by AudioSystem.preload(); just verify the key exists.
    if (!sound.game.cache.audio.has('bgm_town')) {
      // Not loaded — nothing we can play yet. The owning scene should have
      // called preload(). Fail quietly rather than throw.
      this.ready = false;
      return;
    }
    this.ready = true;
    this.startBGM();
    // Also ensure the generative soundtrack engine is up (graceful if absent).
    if (window.SpaceFarmer && window.SpaceFarmer.music) {
      try { window.SpaceFarmer.music.ensure(); } catch (e) { /* no audio ctx */ }
    }
  }

  // Which BGM fits this scene: cozy town theme on the planet, airy ship/cryo
  // theme in the tutorial (SpaceshipScene + IntroScene).
  _trackForScene() {
    const key = this.scene.scene && this.scene.scene.key;
    if (key === 'PlanetScene') return 'bgm_town';
    return 'bgm_ship';
  }

  startBGM() {
    if (!this.ready || this.bgm) return;
    const track = this._trackForScene();
    try {
      // Set loop in the ADD config (most reliable in Phaser 3.60 — `loop` in
      // play() config can ignore the flag on some builds, causing one-shot).
      this.bgm = this.scene.sound.add(track, { loop: true, volume: 0.32 });
      this.bgm.play();
    } catch (e) { /* no audio */ }
  }

  stopBGM() { if (this.bgm) { this.bgm.stop(); this.bgm = null; } }

  // play a one-shot SFX by registered key
  sfx(key, { volume = 0.5 } = {}) {
    if (!this.ready || !this.scene.sound) return;
    try { this.scene.sound.play(key, { volume }); } catch (e) { /* no audio */ }
  }
}

export { AudioSystem };
