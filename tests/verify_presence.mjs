// verify_presence.mjs — remote farmer rendering (P2).
// Part A: headless unit test of PlanetScene.updateRemotePlayers with a fake
//         net/room/state — creation, interpolation, removal on leave, offline.
// Part B: LIVE two-client test against :8900 — both clients see each other in
//         state.players and moves replicate.
globalThis.Phaser = {
  Scene: class { },
  Input: { Keyboard: { JustDown: () => false } },
  BlendModes: { ADD: 0, MULTIPLY: 1 },
};

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

const SS = await import('../client/systems/SpriteSystem.js');
const { TEXTURES } = SS;
const PS = await import('../client/scenes/PlanetScene.js');
const PlanetScene = PS.PlanetScene;

// ── Part A: headless ────────────────────────────────────────────
console.log('== A. updateRemotePlayers headless ==');

function fakeImg(key) {
  if (key && !TEXTURES[key]) throw new Error(`MISSING TEXTURE: ${key}`);
  const o = {
    key, x: 0, y: 0, destroyed: false, visible: true,
    setScale() { return this; }, setDepth(d) { this.depth = d; return this; },
    setAlpha() { return this; }, setOrigin() { return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setVisible(v) { this.visible = v; return this; },
    destroy() { this.destroyed = true; },
  };
  return o;
}

const ps = Object.create(PlanetScene.prototype);
ps.world = { add() { } };
ps.add = {
  image(x, y, key) { const i = fakeImg(key); i.x = x; i.y = y; return i; },
  text(x, y, str) { const t = fakeImg(null); t.text = str; t.x = x; t.y = y; return t; },
};

// fake MapSchema: Map with forEach(value,key) like Colyseus
function fakePlayers(entries) {
  const m = new Map(entries);
  m.forEach = (fn) => { for (const [k, v] of entries) fn(v, k); };
  return m;
}
function fakeNet(players, playerId) {
  return { playerId, room: { state: { players } }, connected: true };
}

const pA = { x: 100, y: 200, name: 'Alice' };
const pB = { x: 300, y: 400, name: 'Bob' };
let players = fakePlayers([['me', { x: 0, y: 0, name: 'Me' }], ['sid-a', pA], ['sid-b', pB]]);
let net = fakeNet(players, 'me');

ps.updateRemotePlayers(net);
check('two remote sprites created', ps.remoteSpr.size === 2, `size=${ps.remoteSpr.size}`);
check('own player NOT rendered remotely', !ps.remoteSpr.has('me'));
const rsA = ps.remoteSpr.get('sid-a');
check('sprite A at join position', rsA && rsA.spr.x === 100 && rsA.spr.y === 200);
check('label carries name', rsA && rsA.label.text === 'Alice', rsA && rsA.label.text);

// move A — interpolation should step toward the target, not teleport
pA.x = 200;
ps.updateRemotePlayers(net);
check('interpolates toward target (not teleport)', rsA.spr.x > 100 && rsA.spr.x < 200, `x=${rsA.spr.x}`);
for (let i = 0; i < 30; i++) ps.updateRemotePlayers(net);
check('converges to target', Math.abs(rsA.spr.x - 200) < 0.5, `x=${rsA.spr.x}`);

// depth sorts with y (walk behind/in front of things)
check('depth tracks y', rsA.spr.depth === rsA.spr.y + 1, `depth=${rsA.spr.depth}`);

// B leaves the room
players = fakePlayers([['me', { x: 0, y: 0, name: 'Me' }], ['sid-a', pA]]);
net = fakeNet(players, 'me');
ps.updateRemotePlayers(net);
check('departed player sprite removed', ps.remoteSpr.size === 1 && !ps.remoteSpr.has('sid-b'));

// a new player joins
players = fakePlayers([['me', { x: 0, y: 0, name: 'Me' }], ['sid-a', pA], ['sid-c', { x: 50, y: 60, name: 'Cleo' }]]);
net = fakeNet(players, 'me');
ps.updateRemotePlayers(net);
check('new joiner gets a sprite', ps.remoteSpr.size === 2 && ps.remoteSpr.has('sid-c'));

// offline clears everything
ps.updateRemotePlayers({ connected: false, room: null });
check('offline clears all remote sprites', ps.remoteSpr.size === 0);

// ── Part B: live two clients ────────────────────────────────────
console.log('== B. live two-client presence ==');
try {
  const { Client } = await import('@colyseus/sdk');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const c1 = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'pres-1' });
  const c2 = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'pres-2' });
  await sleep(400);

  const s1 = c1.state.players.get(c1.sessionId);
  const s2on1 = c1.state.players.get(c2.sessionId);
  check('client1 sees client2 in state.players', !!s2on1, '');
  check('remote name replicated', s2on1 && s2on1.name === 'pres-2', s2on1 && s2on1.name);

  // client2 moves; client1 must observe it
  c2.send('move', { x: 444, y: 555 });
  await sleep(400);
  const seen = c1.state.players.get(c2.sessionId);
  check('move replicates to other client', seen && seen.x === 444 && seen.y === 555,
    seen && `(${seen.x},${seen.y})`);

  // client2 leaves; must vanish from client1's state
  const onGone = new Promise(res => {
    const iv = setInterval(() => {
      if (!c1.state.players.get(c2.sessionId)) { clearInterval(iv); res(true); }
    }, 100);
    setTimeout(() => { clearInterval(iv); res(false); }, 3000);
  });
  await c2.leave();
  check('leaving player removed from state', await onGone);

  await c1.leave();
} catch (err) {
  check('live server reachable on :8900', false, String(err && err.message || err));
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
