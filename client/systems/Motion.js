// client/systems/Motion.js — SF49 accessibility: reduced motion.
// A single source of truth for "did the player (or the OS) ask for less
// movement?" Two sources, in priority order:
//   1. the local override key `sf.reducedMotion` === '1' (the F9 in-game
//      toggle writes it, so it survives reloads);
//   2. the OS preference matchMedia('(prefers-reduced-motion: reduce)').
// Everything that moves pixels for atmosphere — crop sway, stardust drift,
// aurora undulation, festival lamp bloom scale/alpha, dusk/dawn easing,
// crowd bob, bell swings — checks this once per site. Nothing here needs
// Phaser, so it loads in every engine (and in headless node test stubs,
// where window/localStorage/matchMedia are simply absent).

export function reducedMotion() {
  try {
    if (localStorage.getItem('sf.reducedMotion') === '1') return true;
  } catch (e) { /* no localStorage (privacy mode / node stub) */ }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (e) {
    return false;
  }
}

// The explicit user override. `true` forces reduced motion on regardless of
// the OS preference; `false` forces it off. Stored so the choice reloads.
export function setReducedMotion(on) {
  try {
    localStorage.setItem('sf.reducedMotion', on ? '1' : '0');
  } catch (e) { /* best-effort: the toggle still works for the session */ }
}
