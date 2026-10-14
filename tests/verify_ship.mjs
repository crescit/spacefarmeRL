// verify_ship.mjs — SHIP-01/02/03 gates (shippability, non-RL).
//   SHIP-01  NetworkSystem reconnects on its own: a refused first join backs
//            off and retries; a dropped room ('lost') rejoins with the same
//            stable player id; a consented leave (4000) never retries; the UI
//            hook hears connecting → offline → online → lost → online.
//   SHIP-02  Pause/settings menu: ESC/☰ wiring, volume persistence keys,
//            reduced-motion shared with F9, panel-aware ESC, scene pause.
//   SHIP-03  "Start a new colony" clears exactly the run keys (id, landed,
//            first-contact) and nothing else (mute, motion, touch survive).
// Runs headless in node with tiny window/localStorage/Colyseus stubs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

// ── stubs ──
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const events = [];
globalThis.window = { SpaceFarmer: { onConnection: (st) => events.push(st) }, location: { reload() { window._reloaded = true; } } };

let plan = [];            // per-join outcome: 'fail' | 'ok'
const joins = [];
class FakeRoom {
  constructor(opts) { this.opts = opts; this.sessionId = 's' + joins.length; this._leave = []; this.left = false; }
  onLeave(cb) { this._leave.push(cb); }
  onError() {}
  onStateChange() {}
  onMessage() {}
  send() { this.sent = (this.sent || 0) + 1; }
  drop(code) { this.left = true; for (const cb of this._leave) cb(code); }
}
globalThis.Colyseus = {
  Client: class {
    constructor(url) { this.url = url; }
    async joinOrCreate(name, opts) {
      const outcome = plan.shift() || 'ok';
      joins.push(opts);
      if (outcome === 'fail') throw new Error('ECONNREFUSED');
      const r = new FakeRoom(opts); this.last = r; FakeRoom.last = r; return r;
    }
  },
};

const { NetworkSystem } = await import(path.join(root, 'client/systems/NetworkSystem.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(25); } return false; };

console.log('SHIP-01 reconnect');
plan = ['fail', 'ok'];
const net = new NetworkSystem();
const first = await net.connect('ws://test');
check('refused first join reports offline and returns false', first === false && events.includes('offline'), JSON.stringify(events));
check('a retry is scheduled with backoff', !!net._retryTimer && net.nextRetryAt > Date.now());
check('retry joins and goes online', await until(() => net.connected), JSON.stringify(events));
check('status hook said online (restored)', events.at(-1) === 'online');
const id1 = joins[0].playerId;
check('stable player id reused across joins', joins.length === 2 && joins[1].playerId === id1 && /^p_/.test(id1));

FakeRoom.last.drop(1006);
check('dropped room → connected=false + lost', !net.connected && net.room === null && events.at(-1) === 'lost', JSON.stringify(events));
net.send('move', { x: 1 });   // must not throw while offline
check('send while offline is a no-op', true);
check('reconnects after a drop', await until(() => net.connected));
check('rejoin used the same save id', joins.at(-1).playerId === id1);

FakeRoom.last.drop(4000);
await sleep(1300);
check('consented leave (4000) does not retry', !net.connected && !net._retryTimer && events.at(-1) === 'offline');

plan = ['fail', 'fail', 'fail'];
net.retryNow();
await sleep(50);
const n0 = joins.length;
net.retryNow();   // Retry button resets the backoff and tries again
await sleep(1200);
check('Retry now re-attempts immediately (1s) after failures', joins.length > n0, `${n0}→${joins.length}`);
net._closing = true; clearTimeout(net._retryTimer); net._retryTimer = null;

console.log('SHIP-02 pause menu');
const pm = readFileSync(path.join(root, 'client/systems/PauseMenu.js'), 'utf8');
const game = readFileSync(path.join(root, 'client/game.js'), 'utf8');
const audio = readFileSync(path.join(root, 'client/systems/AudioSystem.js'), 'utf8');
check('game.js mounts PauseMenu + net banner before connecting',
  /new PauseMenu\(game\)[\s\S]*installNetBanner\(\)[\s\S]*net\.connect\(/.test(game));
check('ESC opens menu only when no panel owns ESC', /e\.key !== 'Escape'/.test(pm) && /scenes\.some\(panelOpen\)/.test(pm));
check('pausing pauses + resumes the Phaser scenes', /s\.scene\.pause\(\)/.test(pm) && /s\.scene\.resume\(\)/.test(pm));
check('music + sfx volume persist (sf.musicVol / sf.sfxVol)', /sf\.musicVol/.test(pm) && /sf\.sfxVol/.test(pm));
check('AudioSystem scales sfx + bgm by player volume', /setSfxVolume/.test(audio) && /volume \* AudioSystem\._sfxVol/.test(audio) && /0\.32 \* AudioSystem\._sfxVol/.test(audio));
check('reduced-motion checkbox uses the shared Motion toggle', /setReducedMotion\(e\.target\.checked\)/.test(pm));
check('tab hidden auto-pauses', /visibilitychange/.test(pm));
check('banner explains lost / offline / reconnected', /Connection to the colony lost/.test(pm) && /Reconnected/.test(pm) && /retryNow/.test(pm));

const { panelOpen, readVolumes, startNewColony, RUN_KEYS } = await import(path.join(root, 'client/systems/PauseMenu.js'));
check('panelOpen sees an open shop', panelOpen({ showingShop: true }) && !panelOpen({}));
store.set('sf.musicVol', '0.2'); store.set('sf.sfxVol', 'junk');
const v = readVolumes();
check('readVolumes parses + clamps (junk → default)', v.music === 0.2 && v.sfx === 1, JSON.stringify(v));

console.log('SHIP-03 new colony');
store.set('sf_player_id', 'p_old'); store.set('sf_landed', '1'); store.set('spacefarmer.firstContact', '1');
store.set('spacefarmer_mute', '1'); store.set('sf.reducedMotion', '1');
startNewColony();
check('run keys cleared', RUN_KEYS.every((k) => !store.has(k)));
check('preferences kept (mute, motion, volume)', store.get('spacefarmer_mute') === '1' && store.get('sf.reducedMotion') === '1' && store.get('sf.musicVol') === '0.2');
check('page reloads into a fresh colony', window._reloaded === true);
check('new colony needs a second confirming click', /_confirmNew/.test(pm) && /click again/.test(pm));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
