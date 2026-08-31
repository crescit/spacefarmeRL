// verify_determinism.mjs — RL Task 2: deterministic episodes across save/load.
// The crux: a save/restore mid-episode must be a true checkpoint. Driving a
// restored room/env with the remaining actions must produce byte-identical
// outcomes to never having stopped. That requires restoring (a) world time,
// (b) the full player/farm state, and (c) the stochastic stream position —
// a fresh RNG would diverge on the very next mine/fish roll.
// Run: node tests/verify_determinism.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema, ArraySchema } = require('@colyseus/schema');
const { deleteSave } = require(path.join(__dirname, '..', 'server', 'persistence.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

// ── room harness (same shape as verify_persistence.mjs) ──
const PID = 'determinism-test-' + Math.random().toString(36).slice(2, 8);
let sessionCounter = 0;
function makeRoom({ persistence = true, seed } = {}) {
  const room = Object.create(FarmRoom.prototype);
  room._persistence = persistence;
  room.state = {
    players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchema(),
    day: 3, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false,
  };
  if (seed !== undefined) room.setRng(seed);
  const sid = 'det-' + (++sessionCounter);
  room.onJoin({ sessionId: sid }, { name: 'Saver', playerId: PID });
  return { room, client: { sessionId: sid, send() {} } };
}

// Full comparable state: everything a stochastic action can touch.
function snapshot(room) {
  const p = room.state.players.get([...room.state.players.keys()][0]);
  const farm = room.state.farms.get([...room.state.farms.keys()][0]);
  const map = (m) => { const o = {}; m.forEach((v, k) => { o[k] = v; }); return o; };
  return JSON.stringify({
    credits: p.credits, energy: p.energy, mineHp: p.mineHp, mineMax: p.mineMax,
    tool: p.tool, inv: map(p.inventory), fr: map(p.friendships), lt: map(p.lifetime),
    quests: { c: p.quests.current, d: Array.from(p.quests.completed), pr: map(p.quests.progress) },
    day: room.state.day, time: room.state.time, season: room.state.season,
    tiles: Array.from(farm.tiles).map((t) => `${t.type}:${t.crop}:${t.growthDay}:${t.watered ? 1 : 0}`),
  });
}

// Stochastic-heavy action script (the part a fresh RNG would diverge on).
function stochastic(room, client, n) {
  for (let i = 0; i < n; i++) {
    room.onMine(client, {});
    room.onFish(client, { spot: 'stardust', night: i % 2 === 1 });
    room.state.isDay = !room.state.isDay;
  }
}

console.log('== RNG stream state ==');
{
  const room = Object.create(FarmRoom.prototype);
  room.setRng(42);
  const before = [room._rand(), room._rand()];
  const st = room.rngState();
  check('rngState is a uint32 after seeded play', Number.isInteger(st) && st >= 0 && st <= 0xffffffff);
  const r2 = Object.create(FarmRoom.prototype);
  r2.setRngState(st);
  const after = [r2._rand(), r2._rand()];
  check('setRngState resumes the stream mid-sequence',
    JSON.stringify(after) === JSON.stringify([room._rand(), room._rand()]),
    JSON.stringify({ before, after }));
  // live path has no serializable state
  const live = Object.create(FarmRoom.prototype);
  check('live Math.random path reports null rngState', live.rngState() === null && live.setRngState(null) === false);
}

console.log('== Save carries the checkpoint fields ==');
{
  deleteSave(PID);
  const { room, client } = makeRoom({ seed: 7 });
  room.state.day = 9; room.state.time = 500; room.state.season = 1;
  stochastic(room, client, 3);
  room.saveNow(client.sessionId, false);
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'saves', PID + '.json'), 'utf8'));
  check('save includes stochastic stream position', Number.isInteger(file.rngState));
  check('save includes world clock', file.world && file.world.day === 9 && file.world.time === 500 && file.world.season === 1);
  deleteSave(PID);
}

console.log('== Mid-episode checkpoint replays identically (room) ==');
{
  // Uninterrupted run from seed
  const A = makeRoom({ seed: 1234 });
  A.room.state.players.get(A.client.sessionId).energy = 100000;
  stochastic(A.room, A.client, 4);
  const full = snapshot(A.room);

  // Same seed, stop after 2, save, restore into a fresh session, run the rest
  const B = makeRoom({ seed: 1234 });
  B.room.state.players.get(B.client.sessionId).energy = 100000;
  stochastic(B.room, B.client, 2);
  B.room.saveNow(B.client.sessionId, false);
  const C = makeRoom();               // persistence ON, no seed — restore supplies it
  check('restored session actually differs', C.client.sessionId !== B.client.sessionId);
  stochastic(C.room, C.client, 2);    // the remaining actions
  check('save/restore resumes the stochastic stream exactly', snapshot(C.room) === full,
    `restored=${snapshot(C.room).slice(0, 80)}… full=${full.slice(0, 80)}…`);
  deleteSave(PID);
}

console.log('== World clock survives save/load ==');
{
  deleteSave(PID);
  const A = makeRoom({ seed: 5 });
  A.room.state.day = 12; A.room.state.time = 900; A.room.state.season = 2; A.room.state.isDay = false;
  A.room.saveNow(A.client.sessionId, false);
  const B = makeRoom();
  const p = B.room.state.players.get(B.client.sessionId);
  check('day restored', B.room.state.day === 12, `got ${B.room.state.day}`);
  check('time restored', B.room.state.time === 900);
  check('season restored', B.room.state.season === 2);
  check('isDay restored', B.room.state.isDay === false);
  // a restored episode must not re-grant starter gifts
  check('restored inventory is the save, not starter + save', p.inventory.get('seeds') === (A.room.state.players.get(A.client.sessionId).inventory.get('seeds') || 0));
  deleteSave(PID);
}

console.log('== Env-level checkpoint (deterministic replay) ==');
{
  const { FarmEnv } = require(path.join(__dirname, '..', 'rl', 'env_core.cjs'));
  const ck = path.join(os.tmpdir(), `farmenv-ckpt-test-${process.pid}.json`);
  const E0 = new FarmEnv({ horizonDays: 12 });
  E0.reset({ seed: 77 });
  const MD = E0.calendar.maturityDays();   // shared calendar service → 6
  E0.close();
  const script = [
    { type: 'till', tileX: 0, tileY: 0 },
    { type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' },
    { type: 'water', tileX: 0, tileY: 0 },
  ];
  for (let d = 0; d < MD; d++) script.push({ type: 'advance_day' }, { type: 'water', tileX: 0, tileY: 0 });
  script.push(
    { type: 'mine' }, { type: 'mine' }, { type: 'fish', spot: 'stardust' },
    { type: 'advance_day' },
    { type: 'harvest', tileX: 0, tileY: 0 },
    { type: 'mine' }, { type: 'mine' }, { type: 'fish', spot: 'copper' },
  );
  const traj = (rs, obs) => rs.join(',') + '|' + JSON.stringify(obs);

  // uninterrupted
  const E1 = new FarmEnv({ horizonDays: 12 });
  E1.reset({ seed: 77 });
  const r1 = [];
  for (const a of script) r1.push(E1.step(a).reward.toFixed(6));
  const full = traj(r1, E1.obs());
  E1.close();

  // stop midway, checkpoint, fresh env, restore, run the rest
  const E2 = new FarmEnv({ horizonDays: 12 });
  E2.reset({ seed: 77 });
  const cut = 12;
  const rPre = [];
  for (const a of script.slice(0, cut)) rPre.push(E2.step(a).reward.toFixed(6));
  const file = E2.save(ck);
  check('checkpoint file written outside saves/', file.startsWith(os.tmpdir()) && fs.existsSync(file));

  const E3 = new FarmEnv({ horizonDays: 12 });
  const obs0 = E3.load(ck);
  check('load reproduces obs at the checkpoint', JSON.stringify(obs0) === JSON.stringify(E2.obs()));
  const rPost = [];
  for (const a of script.slice(cut)) rPost.push(E3.step(a).reward.toFixed(6));
  const joined = traj(rPre.concat(rPost), E3.obs());
  check('env checkpoint resumes the stochastic stream exactly', joined === full);

  // checkpoints must never touch the live saves/ dir
  check('env episodes never write saves/', !fs.existsSync(path.join(__dirname, '..', 'saves', 'agent.json')));
  fs.rmSync(file, { force: true });
  E2.close(); E3.close();
}

console.log('== Negative control: fresh-seed restore WOULD diverge ==');
{
  // Guards the test itself: if the streams happened to align for any reason,
  // a plain re-seed (no rngState) must NOT reproduce a mid-stream continuation.
  const mk = (seed) => { const r = Object.create(FarmRoom.prototype); r.setRng(seed); return r; };
  const A = mk(99); for (let i = 0; i < 12; i++) A._rand();
  const stream = [A._rand(), A._rand(), A._rand()];
  const B = mk(99); const reseeded = [B._rand(), B._rand(), B._rand()];
  check('mid-stream ≠ from-seed (checkpoint is load-bearing)',
    JSON.stringify(stream) !== JSON.stringify(reseeded));
}

console.log(`\ndeterminism(task2): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
