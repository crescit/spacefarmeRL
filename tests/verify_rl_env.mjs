// verify_rl_env.mjs — RLForge Task 1: seeded RNG determinism.
// Two identically-seeded rooms driven through the same stochastic action
// script must land on byte-identical state; different seeds must diverge.
// Also asserts the live path (no setRng) still works (Math.random fallback).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema, ArraySchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

function makeRoom(seed) {
  const room = Object.create(FarmRoom.prototype);
  room.state = {
    players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchema(),
    day: 1, time: 360, isDay: true, season: 0, festival: true, festivalClaimed: false,
    festivalPhase: 'none', feastPeak: false,
  };
  if (seed !== undefined) room.setRng(seed);   // undefined → live fallback
  const client = { sessionId: 'f', send() {} };
  room.onJoin(client, { name: 'Farmer' });
  return { room, client };
}

// Canonical state hash for comparison: everything stochastic can touch.
function hashState(room) {
  const p = room.state.players.get('f');
  const inv = {}; p.inventory.forEach((v, k) => { inv[k] = v; });
  const fr = {}; p.friendships.forEach((v, k) => { fr[k] = v; });
  const lt = {}; p.lifetime.forEach((v, k) => { lt[k] = v; });
  return JSON.stringify({
    credits: p.credits, energy: p.energy, mineHp: p.mineHp, mineMax: p.mineMax,
    inv, fr, lt, day: room.state.day, claimed: room.state.festivalClaimed,
  });
}

// A stochastic-heavy script: mine to vein breaks, fish, claim festival.
// Farm work is tool-gated — equip the pickaxe and rod for their crafts.
function script(room, client) {
  const out = [];
  const p = room.state.players.get(client.sessionId);
  if (p) p.equipped = 'pickaxe';
  for (let i = 0; i < 12; i++) out.push(room.onMine(client, {}));          // several vein cycles
  if (p) p.equipped = 'rod';
  for (let i = 0; i < 6; i++) { room.state.isDay = i % 2 === 0; out.push(room.onFish(client, { spot: 'stardust', night: i % 2 === 1 })); }
  room.state.festival = true; room.state.festivalClaimed = false;
  out.push(room.onClaimFestival ? room.onClaimFestival(client) : { skipped: true });
  return out;
}

console.log('== Determinism ==');
// Same seed → identical states and identical reply streams
{
  const A = makeRoom(1234), B = makeRoom(1234);
  // Give A/B enough energy that low-energy gating can't desync the script
  A.room.state.players.get('f').energy = 10000;
  B.room.state.players.get('f').energy = 10000;
  const ra = script(A.room, A.client), rb = script(B.room, B.client);
  check('seeded rooms: identical final state', hashState(A.room) === hashState(B.room));
  check('seeded rooms: identical reply streams', JSON.stringify(ra) === JSON.stringify(rb));
}
// Different seeds → divergence (with overwhelming probability given 12 mines)
{
  const A = makeRoom(11), B = makeRoom(99999);
  A.room.state.players.get('f').energy = 10000;
  B.room.state.players.get('f').energy = 10000;
  script(A.room, A.client); script(B.room, B.client);
  check('different seeds diverge', hashState(A.room) !== hashState(B.room));
}
// Re-seed mid-life resets the stream (env reset semantics)
{
  const A = makeRoom(7), B = makeRoom(7);
  A.room.state.players.get('f').energy = 10000;
  B.room.state.players.get('f').energy = 10000;
  script(A.room, A.client);
  // "reset" = fresh join on same room object with re-seeded rng
  B.room.setRng(7);
  const clientB2 = { sessionId: 'f2', send() {} };
  B.room.state.players = new MapSchema(); B.room.state.farms = new MapSchema();
  B.room.onJoin(clientB2, { name: 'Farmer' });
  B.room.state.players.get('f2').energy = 10000;
  script(B.room, { sessionId: 'f2' });
  const pa = A.room.state.players.get('f'), pb = B.room.state.players.get('f2');
  const norm = (p) => { const o = {}; p.inventory.forEach((v, k) => { o[k] = v; }); return JSON.stringify({ c: p.credits, e: p.energy, mh: p.mineHp, mm: p.mineMax, o }); };
  check('re-seed reproduces identical run', norm(pa) === norm(pb));
}
// Live fallback: no setRng at all — room still functions (no crash, valid replies)
{
  const { room, client } = makeRoom(undefined);
  room.state.players.get('f').energy = 100;
  room.state.players.get('f').equipped = 'pickaxe';   // mining needs the pick
  const r = room.onMine(client, {});
  check('live fallback works (no rng injected)', r.ok === true && typeof room.mineRndProbe !== 'function', JSON.stringify(r && { ok: r.ok }));
}
// PRNG sanity: mulberry32 values in [0,1), uniform-ish spread
{
  const A = makeRoom(42);
  const vals = Array.from({ length: 5000 }, () => A.room._rand());
  const inRange = vals.every((v) => v >= 0 && v < 1);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  check('rng in [0,1)', inRange);
  check('rng mean ≈ 0.5', Math.abs(mean - 0.5) < 0.03, `mean=${mean.toFixed(4)}`);
}

// ══ Task 2: env_core reset/step/obs/reward ══
console.log('== env_core ==');
{
  const { FarmEnv, ITEMS, GAME_ACTIONS, ACTION_TYPES, ACTION_DEFINITIONS, EVALUATION_CONTRACT } = require(path.join(__dirname, '..', 'rl', 'env_core.cjs'));
  const env = new FarmEnv({ horizonDays: 10 });

  // obs shape stable across resets + long random rollout
  const o0 = env.reset({ seed: 7 });
  check('action surface is exactly FarmRoom wire messages',
    JSON.stringify(ACTION_TYPES) === JSON.stringify(GAME_ACTIONS.map((a) => a.type)));
  check('reset starts on the live game day zero', o0.day === 0 && o0.time === 0);
  check('starter inventory is lossless and matches onJoin', JSON.stringify(o0.inventory) === JSON.stringify({
    seeds: 5, 'tech-part': 2, 'starlight-crystal': 1, 'exotic-seed': 1,
    'space-feather': 1, 'data-crystal': 1, 'rare-mineral': 1,
    'cooked-food': 1, weeds: 1, flowers: 1,
  }), JSON.stringify(o0.inventory));
  check('all live actions have native schemas and complete cost records',
    ACTION_TYPES.every((type) => ACTION_DEFINITIONS[type] && EVALUATION_CONTRACT.planningFacts.actionCosts[type]));
  check('planning contract exposes the real starter seeds and full economy',
    EVALUATION_CONTRACT.planningFacts.starter.inventory.seeds === 5 &&
    EVALUATION_CONTRACT.planningFacts.economy.shopPrices.seeds === 5 &&
    EVALUATION_CONTRACT.planningFacts.fishing.fish['nebula-marlin'].worth === 120 &&
    EVALUATION_CONTRACT.planningFacts.livestock.animals.chicken.cost === 100 &&
    EVALUATION_CONTRACT.planningFacts.actionCosts.fish.baseEnergy === 10 &&
    EVALUATION_CONTRACT.planningFacts.actionCosts.talk.baseEnergy === 0);
  const contact = env.step({ type: 'contact', alien: 'keth', doctrine: 'colonize' });
  check('alien doctrine is a persistent reward-neutral game action',
    contact.info.ok && contact.reward === 0 &&
    contact.obs.contactChoices['keth-refuge'] === 'colonize');
  const bought = env.step({ type: 'buy', item: 'seeds', quantity: 1 });
  check('handler reply is preserved in transition info',
    bought.info.result.ok === true && bought.info.result.item === 'seeds');
  check('client reply message is logged', bought.info.messages.some((m) => m.channel === 'client' && m.type === 'buy'));
  env.reset({ seed: 7 });
  let festivalMorning;
  for (let day = 0; day < 25; day++) festivalMorning = env.step({ type: 'advance' });
  check('client and broadcast messages are both logged',
    festivalMorning.info.messages.some((m) => m.type === 'daySummary') &&
    festivalMorning.info.messages.some((m) => m.channel === 'broadcast' && m.type === 'festivalPhase'));
  env.reset({ seed: 7 });
  const shapeOf = (o) => JSON.stringify({ k: Object.keys(o).sort(), inv: Object.keys(o.inventory).sort(), grid: o.farmState.length, crop: o.farmCrop.length });
  const shape = shapeOf(o0);
  check('obs initial shape (inventory vector 29, grid 64)', o0.inventoryVector.length === ITEMS.length && o0.farmState.length === 64);
  let stepsOk = true;
  const TYPES = ACTION_TYPES;
  for (let i = 0; i < 1000; i++) {
    const a = { type: TYPES[Math.floor(Math.random() * TYPES.length)] };
    if (a.type === 'sell') Object.assign(a, { item: 'space-wheat', quantity: 1 });
    if (a.type === 'gift') Object.assign(a, { npc: 'rhea', item: 'weeds' });
    if (a.type === 'talk') Object.assign(a, { npc: 'rhea' });
    if (a.type === 'contact') Object.assign(a, { alien: 'aurelian', doctrine: 'observe' });
    if (a.type === 'buyAnimal') Object.assign(a, { species: 'chicken' });
    if (['till', 'plant', 'water', 'harvest'].includes(a.type)) Object.assign(a, { tileX: i % 8, tileY: (i >> 3) % 8, crop: 'space-wheat' });
    const { obs } = env.step(a);
    if (obs.day > 10) { env.reset({ seed: 7 }); }
    if (shapeOf(obs) !== shape) { stepsOk = false; break; }
  }
  check('obs shape stable over 1000 random steps', stepsOk);

  // reward math: hand-computed script honoring the water-every-day rule
  env.reset({ seed: 3 });
  const st = env.room.state;
  // Growth rule (FarmRoom.onAdvanceDay): a tile grows ONLY if watered during
  // that day, then watered resets. So the correct script waters after plant
  // AND after every advance_day: plant → water → (advance → water) ×MD → harvest.
  // MD advances = MD growth ticks (≥ MD → mature). MD comes from the same
  // calendar service the server uses — the env has NO copy of that number.
  const MD = env.calendar.maturityDays();
  let R = 0;
  R += env.step({ type: 'equip', tool: 'hoe' }).reward;
  R += env.step({ type: 'till', tileX: 0, tileY: 0 }).reward;             // 0 (no Δcr)
  R += env.step({ type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' }).reward;
  R += env.step({ type: 'equip', tool: 'watering' }).reward;
  R += env.step({ type: 'water', tileX: 0, tileY: 0 }).reward;            // day-1 water
  for (let d = 0; d < MD; d++) {
    R += env.step({ type: 'advance' }).reward;                            // dayCost
    // Re-water for the next day's growth, but NOT once the tile is mature —
    // watering a mature tile is refused (illegal penalty), which would skew
    // the hand-computed total. Refill the can at the tap when it runs low.
    if (env.farm().tiles.find((t) => t.x === 0 && t.y === 0).type !== 'mature') {
      if ((env.player().waterLevel || 0) < 20) R += env.step({ type: 'fillWater' }).reward;
      R += env.step({ type: 'water', tileX: 0, tileY: 0 }).reward;        // watered=0 shaping
    }
  }
  R += env.step({ type: 'equip', tool: '' }).reward;                      // hands for the harvest
  const h = env.step({ type: 'harvest', tileX: 0, tileY: 0 });
  R += h.reward;
  const dayCost = env.w.dayCost;
  const expected = MD * dayCost + 20 / 100;   // space-wheat cr=20, no quest completion guaranteed in MD days
  check(`harvest matured after ${MD} watered days`, h.info.ok === true, JSON.stringify(h.obs.farmState.slice(0, 1)));
  check('reward = Δcredits + dayCosts (±0.001)', Math.abs(R - expected) < 0.001 + 1e-9, `R=${R} expected≈${expected}`);

  // illegal action: till a tilled tile → refused, illegal penalty, credits unchanged
  env.reset({ seed: 3 });
  env.step({ type: 'equip', tool: 'hoe' });
  env.step({ type: 'till', tileX: 1, tileY: 1 });
  const bad = env.step({ type: 'till', tileX: 1, tileY: 1 });
  check('illegal action flagged + penalized', bad.info.ok === false && Math.abs(bad.reward - env.w.illegal) < 1e-9);

  // episode isolation: reset wipes everything (fresh obs, day 1, starter state)
  const o1 = env.reset({ seed: 3 });
  check('reset isolates state (day 0, credits reset)', o1.day === 0 && o1.credits === o0.credits && o1.farmState.every((v) => v === 0));

  // truncation: advance past horizon → truncated
  env.reset({ seed: 3 });
  let last = null;
  for (let d = 0; d <= 10; d++) last = env.step({ type: 'advance' });
  check('horizon truncates episode', last.truncated === true && env.room.state.day >= 10);

  // determinism through the env API (same seed+actions → same trajectory)
  const run = (seed) => {
    const e = new FarmEnv({ horizonDays: 10 });
    e.reset({ seed });
    const MD = e.calendar.maturityDays();
    const rs = [];
    const grow = [
      { type: 'equip', tool: 'hoe' },
      { type: 'till', tileX: 0, tileY: 0 },
      { type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' },
      { type: 'equip', tool: 'watering' },
      { type: 'water', tileX: 0, tileY: 0 },
      ...Array.from({ length: MD }, () => [
        { type: 'advance' }, { type: 'fillWater' }, { type: 'water', tileX: 0, tileY: 0 },
      ]).flat(),
      { type: 'equip', tool: '' },
      { type: 'harvest', tileX: 0, tileY: 0 },
      { type: 'equip', tool: 'pickaxe' },
      { type: 'mine' }, { type: 'mine' }, { type: 'mine' },
      { type: 'equip', tool: 'rod' },
      { type: 'fish', spot: 'stardust' },
    ];
    for (const a of grow) rs.push(e.step(a).reward.toFixed(6));
    // Compare FULL final obs, not just reward strings: mining/fishing yields
    // vary inventory/vein hardness more often than credits, so reward-only
    // comparisons can coincide across seeds (false "no divergence").
    const out = rs.join(',') + '|' + JSON.stringify(e.obs());
    e.close();
    return out;
  };
  check('env-level deterministic replay', run(5) === run(5));
  check('different seeds diverge in env', run(5) !== run(6));

  env.close();
}

console.log(`\nrl-env(task1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
