// tests/verify_reckoning.mjs — SF62 gate: the season's-end reckoning exists
// for HUMAN players, with the SAME faces the agent season's testimony() gets
// (rl/env_core.cjs), and is reward-neutral.
//
// Gate must fail against the pre-SF62 sources: HEAD has no shared/story/
// reckoning.js at all (buildReckoning undefined). Override with
// SF_RECKONING_SRC=/tmp/old_reckoning.js.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
function assert(condition, message) { if (!condition) throw new Error(message); }

const reckoningPath = process.env.SF_RECKONING_SRC || path.join(__dirname, '..', 'shared/story/reckoning.js');
const planetPath = process.env.SF_PLANET_SRC || path.join(__dirname, '..', 'client/scenes/PlanetScene.js');

// 1. The bank ships buildReckoning: a pure function from a per-player record.
const bank = req(reckoningPath);
assert(typeof bank.buildReckoning === 'function',
  'shared/story/reckoning.js must export buildReckoning');

// 2. EMPTY record — the stranger season: fields left to the weather, frontier
//    unanswered, and the bell's final question last.
const empty = bank.buildReckoning({});
assert(typeof empty.title === 'string' && empty.title.includes(' on B-612 is over.'),
  `title must be '<Season> on B-612 is over.' (got ${empty.title})`);
const emptyText = empty.lines.join('\n');
assert(emptyText.includes('left to the weather'),
  `empty record must say the fields were 'left to the weather' (got ${emptyText.slice(0, 120)})`);
assert(emptyText.includes('unanswered'),
  `empty record must leave 'the frontier remained unanswered' (got ${emptyText.slice(0, 200)})`);
assert(emptyText.includes('stranger to stranger'),
  `empty record must pass 'stranger to stranger' (got ${emptyText.slice(0, 240)})`);
const bellQ = 'The bell asks the only question worth asking: What kind of keeper were you?';
const nonEmptyLines = empty.lines.filter((l) => String(l).length > 0);
assert(nonEmptyLines[nonEmptyLines.length - 1] === bellQ,
  `the LAST line must be the bell question (got ${JSON.stringify(nonEmptyLines[nonEmptyLines.length - 1])})`);

// 3. RICH record — credits 900 (solvent), 3 friends, 2 contact choices with
//    their doctrine ids listed, 40 harvested, a spouse, closed quests.
const rich = bank.buildReckoning({
  season: 2, credits: 900,
  lifetime: { earned: 600, harvested: 40, sold: 30, fished: 7, mined: 11, gifts: 5 },
  friends: { rhea: 72, luna: 83, nova: 60 },
  contactChoices: { 'keth-refuge': 'cooperate', 'machine-secession': 'trade' },
  questsCompleted: 4, marriedTo: 'luna',
});
const richText = rich.lines.join('\n');
assert(richText.includes('solvent'),
  `rich record (900 cr) must read 'solvent' (got ${richText.slice(0, 160)})`);
assert(richText.includes('keth-refuge=cooperate'),
  `doctrine 1 must be listed as scenario=doctrine (got ${richText.slice(300, 520)})`);
assert(richText.includes('machine-secession=trade'),
  `doctrine 2 must be listed as scenario=doctrine (got ${richText.slice(300, 520)})`);
assert(richText.includes('40 harvests'),
  `rich record must record the ${40} harvests (got ${richText.slice(0, 160)})`);
assert(richText.includes('3 colonists came to know you'),
  `rich record must count the 3 friends (got ${richText.slice(160, 320)})`);
assert(richText.includes('bound to luna'),
  `rich record must name the vow (got ${richText.slice(160, 320)})`);
assert(nonEmptyLinesCheck(rich.lines));
function nonEmptyLinesCheck(lines) {
  const nel = lines.filter((l) => String(l).length > 0);
  return nel[nel.length - 1] === bellQ;
}
const richNel = rich.lines.filter((l) => String(l).length > 0);
assert(richNel.length >= 7, `rich record must carry ≥ 6 prose lines + the bell (got ${richNel.length})`);

// 4. Reward-neutral by construction: NO key of the returned object (any depth)
//    may match /score|grade|reward/.
const scanKeys = (obj, path = '') => {
  const out = [];
  for (const k of Object.keys(obj || {})) {
    out.push(path + k);
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...scanKeys(v, path + k + '.'));
  }
  return out;
};
const keys = scanKeys(rich).concat(scanKeys(empty));
const banned = keys.filter((k) => /score|grade|reward/.test(k));
assert(banned.length === 0,
  `the reckoning must carry no score/grade/reward key (found ${banned.join(', ')})`);
assert(Object.keys(rich).sort().join(',') === 'lines,title',
  `the returned object carries only { title, lines } (got ${Object.keys(rich).join(', ')})`);

// 5. Deterministic: the same record yields byte-identical prose twice.
assert(JSON.stringify(bank.buildReckoning({
  season: 2, credits: 900,
  lifetime: { earned: 600, harvested: 40, sold: 30, fished: 7, mined: 11, gifts: 5 },
  friends: { rhea: 72, luna: 83, nova: 60 },
  contactChoices: { 'keth-refuge': 'cooperate', 'machine-secession': 'trade' },
  questsCompleted: 4, marriedTo: 'luna',
})) === JSON.stringify(rich), 'the same record must yield identical prose');

// 6. Locus of truth: PlanetScene renders the payload as a screen-anchored
//    season's-end screen (scrollFactor 0, depth 1650), amber title, cream
//    lines, slate footer — and never grades it.
const planetSrc = readFileSync(planetPath, 'utf8');
assert(planetSrc.includes('_showReckoning(payload)'), 'PlanetScene must keep _showReckoning(payload)');
const reckStart = planetSrc.indexOf('_showReckoning(payload)');
assert(reckStart >= 0, '_showReckoning must exist');
const reckBody = planetSrc.slice(reckStart, planetSrc.indexOf('_layoutReckoning()', reckStart));
assert(reckBody.includes('setScrollFactor(0)'), 'the reckoning screen must be screen-anchored (scrollFactor 0)');
assert(reckBody.includes('1650'), 'the reckoning screen must sit at depth 1650');
assert(reckBody.includes('#f7d698'), 'the reckoning title must render in amber #f7d698');
assert(reckBody.includes('#e6f6f2'), 'the reckoning lines must render in cream #e6f6f2');
assert(reckBody.includes("'SPACE — the new season begins'"), 'the footer must say SPACE opens the new season');
assert(reckBody.includes('#7c95a6'), 'the footer must render in slate');
assert(!/score|grade|reward/.test(reckBody.slice(reckBody.indexOf('_showReckoning'), reckBody.length)),
  'the screen must never grade the season (no score/grade/reward anywhere in the panel code)');
assert(planetSrc.includes('window.SpaceFarmer.showReckoning ='),
  'PlanetScene must expose the QA hook window.SpaceFarmer.showReckoning');
assert(planetSrc.includes('_queueReckoning') && planetSrc.includes('_bannerActive'),
  'the reckoning must queue BEHIND the season banner (banner first)');

console.log('✓ SF62: the season\'s-end reckoning is reward-neutral, mirrors testimony()\'s faces (fields / ledger / people / frontier / quests / bell), and PlanetScene renders it as a screen-anchored colony screen');
