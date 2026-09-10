// rl/smoke.cjs — end-to-end smoke over the REAL env surface (rl/env_core.cjs).
// Usage: node rl/smoke.cjs [episodes]
//
// History note: this file previously required ./env_factory, ./tasks,
// ./imitation, ./model — modules that never existed in any git revision
// (emulator-era phantom API; the file was committed broken). The learner
// claims in RL_PROGRESS.md (DQN, imitation) belong to that lost lineage.
// This smoke proves the current env contract end-to-end, no external deps:
//   1. scripted episode: the farm loop is actually solvable headless
//   2. random rollout: obs shape stable, rewards finite, no crashes
//   3. action coverage: random play reaches every ACTION_TYPE at least once
//   4. determinism: same seed + same actions → identical trajectory
//   5. checkpoint: save/load mid-episode resumes byte-identically
'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { FarmEnv, ACTION_TYPES } = require('./env_core.cjs');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPISODES = Number(process.argv[2] || 4);
const HORIZON = 12;
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// ── 1. scripted oracle: equip → plant → water ×maturity → harvest pays ──
{
  const env = new FarmEnv({ horizonDays: HORIZON });
  env.reset({ seed: 1 });
  const cash0 = env.player().credits;
  const MATURITY = env.calendar.maturityDays();   // one source of truth (shared/calendar.js)
  env.step({ type: 'equip', tool: 'hoe' });
  env.step({ type: 'till', tileX: 0, tileY: 0 });
  env.step({ type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' });
  env.step({ type: 'equip', tool: 'watering' });
  env.step({ type: 'water', tileX: 0, tileY: 0 });
  for (let d = 0; d < MATURITY; d++) {
    env.step({ type: 'advance' });
    if (env.farm().tiles[0].type !== 'mature') {
      if ((env.player().waterLevel || 0) < 20) env.step({ type: 'fillWater' });
      env.step({ type: 'water', tileX: 0, tileY: 0 });
    }
  }
  env.step({ type: 'equip', tool: '' });          // hands for the harvest
  const h = env.step({ type: 'harvest', tileX: 0, tileY: 0 });
  if (!h.info.ok) { env.close(); fail('scripted harvest failed — env contract changed?'); }
  // the engine pays crops at harvest time (verify_rl_env's hand-computed
  // script: mature space-wheat → +20cr straight into credits)
  if (env.player().credits <= cash0) { env.close(); fail('oracle loop did not make money'); }
  console.log(`oracle: +${env.player().credits - cash0}cr via plant→harvest ✓`);
  env.close();
}

// ── 2+3. random rollouts: stability, finiteness, action coverage ──
const seen = new Set();
let stepsTotal = 0, rewardSum = 0;
for (let ep = 0; ep < EPISODES; ep++) {
  const rng = mulberry32(1000 + ep);
  const env = new FarmEnv({ horizonDays: HORIZON });
  const shapeOf = (o) => JSON.stringify({ k: Object.keys(o).sort(), inv: o.inventory.length, grid: o.farmState.length });
  const shape = shapeOf(env.reset({ seed: 1000 + ep }));
  let done = false, ticks = 0;
  while (!done && ticks < 400) {
    const a = { type: ACTION_TYPES[Math.floor(rng() * ACTION_TYPES.length)] };
    if (a.type === 'sell') Object.assign(a, { item: 'space-wheat', quantity: 1 });
    if (a.type === 'move') Object.assign(a, { x: 200, y: 200 });
    if (a.type === 'order') Object.assign(a, { data: { item: 'space-wheat', quantity: 1, price: 20, type: 'sell' } });
    if (a.type === 'buy') Object.assign(a, { item: 'seeds', quantity: 1 });
    if (a.type === 'gift') Object.assign(a, { npc: 'rhea', item: 'weeds' });
    if (a.type === 'talk') Object.assign(a, { npc: 'rhea' });
    if (a.type === 'propose') Object.assign(a, { npc: 'rhea' });
    if (a.type === 'buyAnimal') Object.assign(a, { species: 'chicken' });
    if (a.type === 'feedAnimal') Object.assign(a, { species: 'chicken' });
    if (a.type === 'deposit' || a.type === 'withdraw') Object.assign(a, { item: 'seeds', qty: 1 });
    if (a.type === 'upgradeTool') Object.assign(a, { tool: 'hoe' });
    if (a.type === 'equip') Object.assign(a, { tool: ['', 'hoe', 'watering', 'pickaxe', 'rod'][Math.floor(rng() * 5)] });
    if (a.type === 'fillWater') Object.assign(a, {});
    if (['till', 'plant', 'water', 'harvest'].includes(a.type)) Object.assign(a, { tileX: Math.floor(rng() * 8), tileY: Math.floor(rng() * 8), crop: 'space-wheat' });
    if (a.type === 'fish') Object.assign(a, { spot: 'stardust' });
    seen.add(a.type);
    const r = env.step(a);
    if (!Number.isFinite(r.reward)) { env.close(); fail(`NaN reward ep${ep} step${ticks} (${a.type})`); }
    if (shapeOf(r.obs) !== shape) { env.close(); fail(`obs shape drifted ep${ep} step${ticks}`); }
    rewardSum += r.reward; stepsTotal++; ticks++;
    done = r.terminated || r.truncated;
  }
  env.close();
}
const missing = ACTION_TYPES.filter((t) => !seen.has(t));
console.log(`random: ${EPISODES} eps, ${stepsTotal} steps, avg reward/step ${(rewardSum / stepsTotal).toFixed(4)} ✓`);
if (missing.length) fail(`action coverage: never exercised ${missing.join(',')}`);
console.log('coverage: all', ACTION_TYPES.length, 'action types exercised ✓');

// ── 4. determinism: identical seed + actions → identical trajectory ──
const script = [
  { type: 'equip', tool: 'hoe' },
  { type: 'till', tileX: 2, tileY: 3 },
  { type: 'plant', tileX: 2, tileY: 3, crop: 'star-berry' },
  { type: 'equip', tool: 'watering' },
  { type: 'water', tileX: 2, tileY: 3 },
  { type: 'advance' }, { type: 'water', tileX: 2, tileY: 3 },
  { type: 'fillWater' },
  { type: 'equip', tool: 'pickaxe' },
  { type: 'mine' }, { type: 'mine' }, { type: 'mine' },
  { type: 'equip', tool: 'rod' },
  { type: 'fish', spot: 'stardust' }, { type: 'fish', spot: 'copper' },
  { type: 'advance' },
];
const run = (seed) => {
  const e = new FarmEnv({ horizonDays: HORIZON });
  e.reset({ seed });
  const rs = script.map((a) => e.step(a).reward.toFixed(6));
  const out = rs.join(',') + '|' + JSON.stringify(e.obs());
  e.close();
  return out;
};
if (run(5) !== run(5)) fail('same-seed replay diverged');
if (run(5) === run(6)) fail('different seeds did not diverge');
console.log('determinism: replay identical, seeds diverge ✓');

// ── 5. checkpoint: save/load mid-episode resumes byte-identically ──
{
  const ck = path.join(os.tmpdir(), `farmenv-smoke-${process.pid}.json`);
  const cut = 7;
  const full = (() => {
    const e = new FarmEnv({ horizonDays: HORIZON });
    e.reset({ seed: 42 });
    const rs = script.map((a) => e.step(a).reward.toFixed(6));
    const out = rs.join(',') + '|' + JSON.stringify(e.obs());
    e.close();
    return out;
  })();
  const e2 = new FarmEnv({ horizonDays: HORIZON });
  e2.reset({ seed: 42 });
  const pre = script.slice(0, cut).map((a) => e2.step(a).reward.toFixed(6));
  const file = e2.save(ck);
  const e3 = new FarmEnv({ horizonDays: HORIZON });
  e3.load(file);
  const post = script.slice(cut).map((a) => e3.step(a).reward.toFixed(6));
  const joined = pre.concat(post).join(',') + '|' + JSON.stringify(e3.obs());
  fs.rmSync(file, { force: true });
  e2.close(); e3.close();
  if (joined !== full) fail('checkpoint resume diverged from uninterrupted run');
  console.log('checkpoint: save/load resumes byte-identically ✓');
}

console.log('SMOKE OK');
