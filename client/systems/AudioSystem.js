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
  // Live instances + global mute, so the 🔊 button silences every scene's BGM.
  static _instances = [];
  static _muted = false;
  static setMuted(m) {
    AudioSystem._muted = !!m;
    for (const i of AudioSystem._instances) i.applyMute();
  }

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
    this.muted = AudioSystem._muted;
    AudioSystem._instances.push(this);
  }

  // Call on first user gesture (Phaser blocks audio before a gesture).
  boot() {
    // The generative soundtrack ALWAYS starts on the first gesture (autoplay
    // policy requires a tap). This is separate from the wav BGM, so music plays
    // on mobile even if a background wav isn't loaded/ready yet.
    if (window.SpaceFarmer && window.SpaceFarmer.music) {
      try { window.SpaceFarmer.music.ensure(); } catch (e) { /* no audio ctx */ }
    }
    if (this.ready || this._dup) return;
    const sound = this.scene.sound;
    if (!sound) return;
    // Files are loaded by AudioSystem.preload(); just verify the key exists.
    if (!sound.game.cache.audio.has('bgm_town')) {
      // Not loaded yet — don't lock out; the next gesture retries (so a mobile
      // page that loads slowly still gets its BGM once the assets arrive).
      this.ready = false;
      return;
    }
    this.ready = true;
    this._dup = true;
    this.startBGM();
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
      this.applyMute();   // respect the 🔊 mute state (startBGM can run after mute)
    } catch (e) { /* no audio */ }
  }

  stopBGM() { if (this.bgm) { this.bgm.stop(); this.bgm = null; } }
  // Push the global mute onto this scene's BGM. Always reads the LIVE static
  // `AudioSystem._muted` (never the constructor snapshot) so the 🔊 button
  // mutes/unmutes this BGM even when the instance was built before the toggle
  // (which is the normal desktop flow: scenes construct an AudioSystem at boot,
  // then the user clicks mute later). The instance flag is kept in sync too.
  applyMute() {
    this.muted = AudioSystem._muted;
    if (this.bgm) this.bgm.setVolume(this.muted ? 0 : 0.32);
  }


  // play a one-shot SFX by registered key (silenced while global mute is on)
  sfx(key, { volume = 0.5 } = {}) {
    if (!this.ready || !this.scene.sound || AudioSystem._muted) return;
    try { this.scene.sound.play(key, { volume }); } catch (e) { /* no audio */ }
  }
}

export { AudioSystem };
