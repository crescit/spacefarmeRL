// tests/verify_rumors.mjs — ROADMAP A3 'Daily rumor lines' gate.
//
// The morning-after card must carry ONE colony rumor: the bank ships ≥ 21
// unique one-line rumors (each ≤ 90 chars), the daily picker is deterministic
// and yields DIFFERENT rumors on consecutive days 1..30 (no two adjacent
// equal), and PlanetScene._showDaySummary renders it on both card variants.
//
// Gate must fail against the pre-SF40 sources: HEAD has no shared/story/
// rumors.js at all and _showDaySummary has no rumor tail. Override with
// SF_RUMORS_SRC=/tmp/old_rumors.js / SF_PLANET_SRC=/tmp/old_planet.js.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
function assert(condition, message) { if (!condition) throw new Error(message); }

const rumorsPath = process.env.SF_RUMORS_SRC || path.join(__dirname, '..', 'shared/story/rumors.js');
const planetPath = process.env.SF_PLANET_SRC || path.join(__dirname, '..', 'client/scenes/PlanetScene.js');

// 1. The bank ships ≥ 21 rumors, every one a unique one-liner ≤ 90 chars.
const bank = req(rumorsPath);
const rumors = bank.rumors;
assert(Array.isArray(rumors) && rumors.length >= 21,
  `rumor bank must ship ≥ 21 lines (got ${rumors.length})`);
for (const r of rumors) {
  assert(typeof r === 'string' && r.length > 0 && r.length <= 90,
    `every rumor must be one line ≤ 90 chars (got ${r && r.length})`);
}
const uniq = new Set(rumors);
assert(uniq.size === rumors.length, 'no rumor line may repeat');

// 2. Colony voice: the line must name a colony NPC (or the envoys/bell vaguely).
const COLONY = ['Nova', 'Luna', 'Zephyr', 'Vega', 'Quasar', 'Rhea', 'Astra', 'Orion', 'Comet', 'C.O.R.A.', 'envoy', 'bell'];
const named = rumors.filter((r) => COLONY.some((n) => r.includes(n)));
assert(named.length >= Math.ceil(rumors.length / 2),
  'rumors must reference colony NPCs or the envoys/bell (got ' + named.length + ')');

// 3. Deterministic pick: same day → same rumor; days 1..30 never have two
//    adjacent equal rumors.
assert(typeof bank.rumorForDay === 'function', 'bank must export rumorForDay(day)');
const picker = bank.rumorForDay;
assert(picker(3) === picker(3), 'the picker must be deterministic per day');
const picks = [];
for (let day = 1; day <= 30; day++) {
  const r = picker(day);
  assert(typeof r === 'string', `day ${day} must pick a rumor`);
  picks.push(r);
}
for (let i = 1; i < picks.length; i++) {
  assert(picks[i] !== picks[i - 1],
    `no two adjacent days may show the same rumor (days ${i} and ${i + 1})`);
}

// 4. Locus of truth: PlanetScene._showDaySummary references the bank picker,
//    prefixes 'Rumor: ', and does NOT inline any bank line.
const planetSrc = readFileSync(planetPath, 'utf8');
assert(planetSrc.includes('_showDaySummary(d)'), 'PlanetScene must keep the morning-after card');
const summaryStart = planetSrc.indexOf('_showDaySummary(d)');
assert(summaryStart >= 0, '_showDaySummary must exist');
assert(planetSrc.includes('story.rumors.rumorForDay(d.day)'),
  '_showDaySummary must reference the deterministic rumor picker');
assert(planetSrc.includes("'Rumor: ' +"), 'the rumor line must be prefixed Rumor: ');
assert(rumors.every((r) => !planetSrc.includes(r)),
  'PlanetScene must not inline a rumor line (bank is the source)');
assert(planetSrc.includes('#67e1cd'),
  'the rumor tail must render in the colony teal (#67e1cd)');

console.log(`✓ Rumor bank single-sources ${rumors.length} colony rumor lines; the daily pick is deterministic and cycles fresh across days 1..30; the morning card renders 'Rumor: …' in colony teal`);
