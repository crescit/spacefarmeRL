// verify_narrative_stats.mjs — RL W5 narrative ledger: the episode's record.
// FarmEnv keeps a reward-neutral narrative ledger (seeds planted, harvests,
// gifts, talks, festivals claimed, journal entries, unique tools), exposes it
// through narrativeStats(), and renders a deterministic end-of-season
// testimony() — "What kind of keeper were you?" — that never changes reward.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmEnv } = require(path.join(__dirname, '..', 'rl', 'env_core.cjs'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('== narrative ledger ==');
{
  const env = new FarmEnv({ horizonDays: 12, narrative: true });
  env.reset({ seed: 42 });
  env.step({ type: 'equip', tool: 'hoe' });
  env.step({ type: 'till', tileX: 0, tileY: 0 });
  env.step({ type: 'till', tileX: 0, tileY: 0 });          // illegal (already tilled) — must not count
  env.step({ type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' });
  env.step({ type: 'equip', tool: 'watering' });
  env.step({ type: 'water', tileX: 0, tileY: 0 });
  env.writeJournal('the sky is big here');
  env.writeJournal('second verse');
  env.step({ type: 'talk', npc: 'rhea' });
  env.step({ type: 'gift', npc: 'rhea', item: 'weeds' });
  env.step({ type: 'advance_day' });
  const s = env.narrativeStats();
  check('seedsPlanted tallied', s.seedsPlanted === 1, JSON.stringify(s));
  check('illegal step not counted', s.cropsHarvested === 0 && s.tools.indexOf('harvest') < 0);
  check('unique tools recorded (equip, till, plant, water, talk, gift, advance_day)',
    s.tools.length === 7 && s.tools.indexOf('till') >= 0 && s.tools.indexOf('equip') >= 0 && s.tools.indexOf('advance_day') >= 0,
    JSON.stringify(s.tools));
  check('journal entries tallied via writeJournal', s.journalEntries === 2, String(s.journalEntries));
  check('friendships recorded', s.friendshipsTotal > 0 && s.friendsMade === 1, JSON.stringify(s.friendshipsTotal));
  check('days survived = day - 1', s.daysSurvived === 1 && s.day === 2, JSON.stringify(s));
  env.close();
}

console.log('== reset clears the ledger ==');
{
  const env = new FarmEnv({ horizonDays: 12, narrative: true });
  env.reset({ seed: 1 });
  env.writeJournal('once');
  env.step({ type: 'advance_day' });
  env.reset({ seed: 2 });
  const s = env.narrativeStats();
  check('fresh episode has zeroed journal + tools',
    s.journalEntries === 0 && s.tools.length === 0 && s.restDays === 0,
    JSON.stringify(s));
  env.close();
}

console.log('== testimony: deterministic, seed-fixed; faithful to the record ==');
{
  const run = (seed, actions) => {
    const e = new FarmEnv({ horizonDays: 12, narrative: true });
    e.reset({ seed });
    for (const action of actions) e.step(action);
    const out = e.testimony();
    e.close();
    return out;
  };
  const gentle = [
    { type: 'equip', tool: 'hoe' },
    { type: 'till', tileX: 1, tileY: 1 },
    { type: 'plant', tileX: 1, tileY: 1, crop: 'space-wheat' },
    { type: 'equip', tool: 'watering' },
    { type: 'water', tileX: 1, tileY: 1 },
    { type: 'talk', npc: 'rhea' },
  ];
  const miner = [
    { type: 'equip', tool: 'hoe' },
    { type: 'till', tileX: 1, tileY: 1 },
    { type: 'plant', tileX: 1, tileY: 1, crop: 'space-wheat' },
    { type: 'equip', tool: 'watering' },
    { type: 'water', tileX: 1, tileY: 1 },
    { type: 'equip', tool: 'pickaxe' },
    ...Array.from({ length: 12 }, () => ({ type: 'mine' })),
    { type: 'equip', tool: 'rod' },
    { type: 'fish', spot: 'stardust', night: true },
    { type: 'talk', npc: 'rhea' },
  ];
  const a = run(7, gentle), a2 = run(7, gentle), b = run(7, miner);
  check('testimony identical for same seed + same life', a === a2);
  check('different lives leave different reckonings', a !== b, a.slice(0, 160) + ' || ' + b.slice(0, 160));
  check('testimony asks the keeper question', a.includes('What kind of keeper were you?'), a);
  check('testimony records the work', /\bplanted 1 seed\b/.test(a), a);
  check('testimony never mentions reward', !/reward/i.test(a));
  check('miner testimony records the pick', /\bswung the pick\b/.test(b), b);
}

console.log(`\nnarrative-stats: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
