// TouchControls.js — On-screen virtual controller for Space Farmer.
//
// Renders as REAL DOM buttons in a dedicated `#touchbar` section BELOW the
// game canvas (not as Phaser objects inside the canvas). This keeps the canvas
// clean, makes taps register correctly on iPhone (Phaser in-canvas hit areas
// were misaligned/clipped on devices), and lets desktop users toggle it.
//
// The HTML lives in index.html; this class wires it to the scene's methods.
// A single shared instance routes to whichever scene is currently active,
// so it persists cleanly across the intro → ship → planet flow.

let activeScene = null;      // the scene whose handlers the buttons drive
let wired = false;           // have the DOM listeners been attached once?
let activeDir = null;        // current held D-pad direction

export class TouchControls {
  constructor(scene) {
    this.scene = scene;
    this.bar = document.getElementById('touchbar');
    this.toggle = document.getElementById('touch-float');   // always-visible floating toggle
    this.activeDir = null;
  }

  /**
   * Attach this scene as the active target, wiring listeners once on first call.
   * Call from each scene's create().
   */
  build() {
    activeScene = this.scene; // route handlers to the current scene
    if (wired) return;
    wired = true;
    const bar = this.bar;
    if (!bar) return;

    // ── D-pad buttons hold-to-move ──
    const dirBtns = bar.querySelectorAll('[data-dir]');
    dirBtns.forEach((btn) => {
      const dir = btn.dataset.dir;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.style.background = '#3aa';
        btn.style.color = '#02101a';
        activeDir = dir;
        if (activeScene && typeof activeScene.moveDir === 'function') activeScene.moveDir(dir);
      });
      const release = () => {
        btn.style.background = '';
        btn.style.color = '';
        if (activeDir === dir) {
          activeDir = null;
          if (activeScene && typeof activeScene.stopMove === 'function') activeScene.stopMove();
        }
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    });

    // ── Action buttons (tap) ──
    const actBtns = bar.querySelectorAll('[data-act]');
    actBtns.forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); _buttonPress(btn.dataset.act); });
      btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    });

    // ── Desktop / mobile toggle (floating button — always reachable) ──
    if (this.toggle) {
      this.toggle.addEventListener('click', () => {
        const show = this.bar.classList.contains('hidden');
        this.bar.classList.toggle('hidden', !show);
        try { localStorage.setItem('spacefarmer_touch', show ? '1' : '0'); } catch (e) {}
      });
    }

    // Default visibility: touch devices see it, desktops hide it (floating
    // 🎮 button brings it back anytime).
    let userPref;
    try { userPref = localStorage.getItem('spacefarmer_touch'); } catch (e) {}
    const isTouch = ('ontouchstart' in document.documentElement) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const show = userPref !== null ? userPref === '1' : isTouch;
    this.bar.classList.toggle('hidden', !show);
  }

  /** Hide the touch bar (e.g. during cutscenes). */
  hide() {
    if (this.bar) this.bar.classList.add('hidden');
  }

  /** Show the touch bar. */
  show() {
    if (this.bar) this.bar.classList.remove('hidden');
  }
}

/** Route an action-button tap to the active scene's method. */
function _buttonPress(id) {
  const scene = activeScene;
  if (!scene) return;
  switch (id) {
    case 'a':
      if (typeof scene.handleInteract === 'function') scene.handleInteract();
      break;
    case 'b':
      if (typeof scene.closeAllPanels === 'function') scene.closeAllPanels();
      else if (typeof scene.handleInteract === 'function') scene.handleInteract();
      break;
    case 'menu':
      if (typeof scene.openGrandExchange === 'function') scene.openGrandExchange();
      else if (typeof scene.openShop === 'function') scene.openShop();
      break;
    case 'sleep':
      // go to bed (Harvest Moon "sleep to advance day")
      if (typeof scene.goToBed === 'function') scene.goToBed();
      else if (typeof scene.sleep === 'function') scene.sleep();
      break;
  }
}
