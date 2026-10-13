// client/systems/PauseMenu.js — SHIP-02 pause / settings menu + SHIP-01
// connection banner. Plain DOM (no Phaser) so it sits above every scene,
// stays readable at any canvas scale, and works with mouse, keyboard and touch.
//
//   ESC (with no game panel open) or the ☰ button → pause the running scenes.
//   Settings persist in localStorage:
//     sf.musicVol   0..1  generative soundtrack master volume
//     sf.sfxVol     0..1  one-shot effects + wav BGM
//     sf.reducedMotion    (shared with the F9 toggle, see Motion.js)
//   "Start a new colony" forgets this browser's colonist id (the old save is
//   left on the server untouched) after an explicit confirm, then reloads.
//
// The colony clock is action-driven on the server (every action spends a
// moment of light), so pausing the client scenes really does stop time.

import { reducedMotion, setReducedMotion } from './Motion.js';
import { AudioSystem } from './AudioSystem.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// Every local key that ties this browser to its colonist. Clearing them
// starts a brand-new colony on the next load (new id → fresh server save).
export const RUN_KEYS = ['sf_player_id', 'sf_landed', 'spacefarmer.firstContact'];

export function startNewColony() {
  for (const k of RUN_KEYS) LS.del(k);
  try { window.location.reload(); } catch { /* node stub */ }
}

export function readVolumes() {
  const clamp = (x, d) => { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; };
  return { music: clamp(LS.get('sf.musicVol', 0.5), 0.5), sfx: clamp(LS.get('sf.sfxVol', 1), 1) };
}

export function applyVolumes() {
  const v = readVolumes();
  const sf = window.SpaceFarmer || {};
  if (sf.music) { sf.music.vol = v.music; sf.music.setMuted(sf.music.muted); }
  AudioSystem.setSfxVolume(v.sfx);
  return v;
}

// Scene flags that mean "a game panel is open — ESC belongs to it".
const PANEL_FLAGS = ['inAlienContact', 'inDialogue', 'showingGE', 'showingShop', 'showingRanch',
  'showingChest', 'showingQuests', 'showingRecipes', 'showingHub', 'showingBackpack',
  'showingSmithy', 'showingCorridor', 'showingReckoning'];

export function panelOpen(scene) {
  return !!scene && PANEL_FLAGS.some((f) => scene[f]);
}

const CSS = `
#pause-float { position: fixed; right: 178px; top: 10px; z-index: 40; border: 2px solid #39c5bb;
  background: linear-gradient(180deg, #232a48 0%, #181e34 100%); color: #bfeeff; font: 600 18px system-ui, 'Segoe UI', sans-serif;
  box-shadow: 0 0 12px rgba(57,197,187,.30); width: 48px; height: 48px; border-radius: 50%; cursor: pointer; display: grid; place-content: center; }
#pause-menu { position: fixed; inset: 0; z-index: 60; display: none; place-items: center;
  background: rgba(4, 10, 14, .72); backdrop-filter: blur(3px); font-family: system-ui, 'Segoe UI', sans-serif; }
#pause-menu.open { display: grid; }
#pause-menu .card { width: min(92vw, 420px); max-height: 88vh; overflow: auto; padding: 22px 24px 18px;
  background: linear-gradient(180deg, #13202a 0%, #0c1419 100%); border: 2px solid #67e1cd; border-radius: 12px;
  box-shadow: 0 0 0 4px #061116, 0 18px 50px rgba(0,0,0,.6); color: #dcf3ec; }
#pause-menu h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: .14em; color: #f7d698; text-align: center; }
#pause-menu .sub { text-align: center; color: #9fd9cd; font-size: 13px; margin-bottom: 14px; }
#pause-menu .row { display: grid; grid-template-columns: 1fr 150px; align-items: center; gap: 10px; margin: 10px 0; font-size: 15px; }
#pause-menu input[type=range] { width: 100%; accent-color: #67e1cd; }
#pause-menu input[type=checkbox] { width: 22px; height: 22px; accent-color: #67e1cd; justify-self: end; }
#pause-menu button.pm { display: block; width: 100%; margin: 8px 0 0; padding: 11px 12px; font: 600 15px system-ui, sans-serif;
  color: #061116; background: #67e1cd; border: 0; border-radius: 8px; cursor: pointer; }
#pause-menu button.pm.ghost { background: transparent; color: #dcf3ec; border: 1px solid #39c5bb88; }
#pause-menu button.pm.danger { background: transparent; color: #ffb0a0; border: 1px solid #ef786d; }
#pause-menu button.pm:focus-visible { outline: 3px solid #f7d698; outline-offset: 2px; }
#pause-menu .keys { margin-top: 14px; font-size: 13px; color: #a6c9c3; line-height: 1.6; columns: 2; }
#pause-menu .keys b { color: #f7d698; font-weight: 600; }
#pause-menu .net { margin-top: 12px; font-size: 13px; text-align: center; color: #9fd9cd; }
#net-banner { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 55; display: none;
  max-width: min(94vw, 720px); white-space: nowrap; padding: 9px 14px; border-radius: 8px; font: 600 14px system-ui, 'Segoe UI', sans-serif;
  background: #241a12; color: #f7d698; border: 1px solid #f2bd68; box-shadow: 0 6px 24px rgba(0,0,0,.5); align-items: center; gap: 12px; }
#net-banner.show { display: flex; }
#net-banner.ok { background: #0f2421; color: #bff5ea; border-color: #67e1cd; }
#net-banner button { font: 600 13px system-ui, sans-serif; padding: 5px 10px; border-radius: 6px; border: 0; background: #f7d698; color: #241a12; cursor: pointer; }
`;

const KEYS = [
  ['WASD / ←↑→↓', 'move'], ['SPACE / E', 'use · talk'], ['M', 'colony hub'], ['I', 'shop'],
  ['U', 'upgrades'], ['Q', 'quest log'], ['J', 'fish'], ['ESC', 'close · pause'], ['F9', 'reduced motion'],
];

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.paused = [];
    this._confirmNew = false;
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.btn = document.createElement('button');
    this.btn.id = 'pause-float';
    this.btn.title = 'Pause & settings (Esc)';
    this.btn.textContent = '☰';
    this.btn.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
    document.body.appendChild(this.btn);

    this.el = document.createElement('div');
    this.el.id = 'pause-menu';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Paused');
    const v = readVolumes();
    this.el.innerHTML = `
      <div class="card">
        <h2>PAUSED</h2>
        <div class="sub">The colony waits for you.</div>
        <label class="row">Music <input id="pm-music" type="range" min="0" max="100" value="${Math.round(v.music * 100)}"></label>
        <label class="row">Sound effects <input id="pm-sfx" type="range" min="0" max="100" value="${Math.round(v.sfx * 100)}"></label>
        <label class="row">Reduced motion <input id="pm-motion" type="checkbox"></label>
        <button class="pm" id="pm-resume">Resume</button>
        <button class="pm ghost" id="pm-full">Fullscreen</button>
        <button class="pm danger" id="pm-new">Start a new colony…</button>
        <div class="keys">${KEYS.map(([k, d]) => `<div><b>${k}</b> ${d}</div>`).join('')}</div>
        <div class="net" id="pm-net"></div>
      </div>`;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });

    const $ = (id) => this.el.querySelector('#' + id);
    $('pm-music').addEventListener('input', (e) => { LS.set('sf.musicVol', (e.target.value / 100).toFixed(2)); applyVolumes(); });
    $('pm-sfx').addEventListener('input', (e) => { LS.set('sf.sfxVol', (e.target.value / 100).toFixed(2)); applyVolumes(); });
    $('pm-motion').addEventListener('change', (e) => setReducedMotion(e.target.checked));
    $('pm-resume').addEventListener('click', () => this.close());
    $('pm-full').addEventListener('click', () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      } catch { /* not allowed here */ }
    });
    if (!document.fullscreenEnabled) $('pm-full').style.display = 'none';
    $('pm-new').addEventListener('click', () => {
      const b = $('pm-new');
      if (!this._confirmNew) {
        this._confirmNew = true;
        b.textContent = 'Really? Your current colony stays behind — click again';
        return;
      }
      startNewColony();
    });

    // ESC opens the menu only when no game panel owns it. Capture phase runs
    // before Phaser's update() consumes the key, so the panel check is honest.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.open) { e.preventDefault(); this.close(); return; }
      const scenes = this.game.scene.getScenes(true);
      const playable = scenes.find((s) => s.sys.settings.key === 'PlanetScene' || s.sys.settings.key === 'SpaceshipScene');
      if (!playable || scenes.some(panelOpen)) return;
      e.preventDefault();
      this.show();
    }, true);
    // Leaving the tab mid-game pauses too (no surprise night on return).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.open) {
        const scenes = this.game.scene.getScenes(true);
        if (scenes.some((s) => s.sys.settings.key === 'PlanetScene' || s.sys.settings.key === 'SpaceshipScene')) this.show();
      }
    });
    applyVolumes();
  }

  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    if (this.open || !this.el) return;
    this.open = true;
    this._confirmNew = false;
    this.el.querySelector('#pm-new').textContent = 'Start a new colony…';
    this.el.querySelector('#pm-motion').checked = reducedMotion();
    this.paused = this.game.scene.getScenes(true).filter((s) => s.sys.settings.key !== 'IntroScene');
    for (const s of this.paused) s.scene.pause();
    this.refreshNet();
    this.el.classList.add('open');
    this.el.querySelector('#pm-resume').focus();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    for (const s of this.paused) { try { s.scene.resume(); } catch { /* scene gone */ } }
    this.paused = [];
    // drop any key held when the menu opened so the farmer doesn't keep walking
    try { for (const s of this.game.scene.getScenes(true)) s.input?.keyboard?.resetKeys(); } catch { /* old Phaser */ }
  }

  refreshNet() {
    const net = window.SpaceFarmer?.net;
    const el = this.el && this.el.querySelector('#pm-net');
    if (!el) return;
    el.textContent = net && net.connected ? 'Colony link: online — progress saves automatically.'
      : 'Colony link: offline — progress will not be saved until it reconnects.';
  }
}

// ── SHIP-01 connection banner ───────────────────────────────────────────
// NetworkSystem reports 'connecting' | 'online' | 'lost' | 'offline'; the
// banner explains each in plain words and offers a Retry button.
export function installNetBanner() {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.id = 'net-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span id="net-msg"></span><button id="net-retry">Retry now</button>';
  document.body.appendChild(el);
  const msg = el.querySelector('#net-msg');
  const retry = el.querySelector('#net-retry');
  retry.addEventListener('click', () => window.SpaceFarmer?.net?.retryNow());
  let hideT = null, tickT = null;
  const countdown = (net, lead) => {
    clearInterval(tickT);
    const draw = () => {
      const s = Math.max(0, Math.ceil(((net.nextRetryAt || 0) - Date.now()) / 1000));
      msg.textContent = s > 0 ? `${lead} Retrying in ${s}s…` : `${lead} Reconnecting…`;
    };
    draw();
    tickT = setInterval(draw, 500);
  };
  window.SpaceFarmer.onConnection = (status, info) => {
    const net = window.SpaceFarmer.net;
    clearTimeout(hideT);
    window.SpaceFarmer.pauseMenu?.refreshNet();
    if (status === 'online') {
      clearInterval(tickT);
      if (!info.restored) { el.classList.remove('show'); return; }
      msg.textContent = 'Reconnected — your farm is safe.';
      retry.style.display = 'none';
      el.classList.add('show', 'ok');
      hideT = setTimeout(() => el.classList.remove('show', 'ok'), 3500);
    } else if (status === 'lost') {
      el.classList.remove('ok'); el.classList.add('show'); retry.style.display = '';
      countdown(net, 'Connection to the colony lost. Your last save is safe.');
    } else if (status === 'offline') {
      el.classList.remove('ok'); el.classList.add('show'); retry.style.display = '';
      countdown(net, 'Playing offline — progress won’t save.');
    }
  };
  return el;
}
