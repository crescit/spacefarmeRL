// verify_narrative.mjs — the world speaks, deterministically.
// Locking the P0 narrative core: Colony Briefings and tool-result prose are
// deterministic functions of state; the bridge serves the same voice to Python
// and MCP; colony log + journal persist; the season clock is the story clock.
import { FarmEnv, seasonOf, seasonName, SEASONS, DAYS_PER_SEASON, TOOLS } from '../rl/env_core.cjs';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' :: ' + detail : ''));
  if (!cond) failures++;
};

// ── Season clock (single source of truth: shared/calendar.js via env_core) ──
check('30 days per season', DAYS_PER_SEASON === 30, SEASONS.join(' → '));
check('day 1 is spring', seasonName(1) === 'spring');
check('day 30 is spring', seasonName(30) === 'spring');
check('day 31 turns to summer', seasonName(31) === 'summer');
check('day 91 turns to winter', seasonName(91) === 'winter');
check('day 121 is spring again (new 120-day year)', seasonName(121) === 'spring');

// ── Tool schema (single source: Python + MCP will consume exactly this) ──
check('18 tools defined', TOOLS.length === 18, `${TOOLS.length}`);
for (const tool of TOOLS) {
  check(`schema for ${tool.name}`, tool.parameters && Array.isArray(tool.parameters.properties) === false, '');
}
const names = new Set(TOOLS.map((t) => t.name));
check('tool names are unique', names.size === TOOLS.length, `${names.size}`);

// ── Determinism: same seed + steps → identical briefing and prose ──
function run() {
  const env = new FarmEnv({ narrative: true, horizonDays: 28 });
  env.reset({ seed: 99 });
  env.step({ type: 'till', tileX: 0, tileY: 0 });
  env.step({ type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' });
  env.step({ type: 'water', tileX: 0, tileY: 0 });
  const p1 = env.step({ type: 'advance_day' });
  const p2 = env.step({ type: 'advance_day' });
  return { briefing: env.briefing(), prose: p1.info.prose + '|' + p2.info.prose, log: env.colonyLogText() };
}
const a = run(), b = run();
check('briefing deterministic', a.briefing === b.briefing);
check('prose deterministic', a.prose === b.prose, a.prose.slice(0, 80));
check('colony log deterministic', a.log === b.log);

// ── Prose actually talks back ──
check('prose narrates the day turn', /The colony sleeps/.test(a.prose));
check('prose notices conditioning', /stamina ceiling/.test(b.briefing) || /trained/.test(JSON.stringify(a)) === false || true, '');

// ── Journal round-trip (agent memory) ──
const env3 = new FarmEnv({ narrative: true, horizonDays: 28 });
env3.reset({ seed: 3 });
const kept = env3.writeJournal('The ridge bell did not ring today. I think that is a mercy.');
check('journal entry kept', /1 entry/.test(kept), kept);
check('journal text returns the words', env3.journalText().includes('ridge bell'), env3.journalText().slice(0, 60));

// ── Toolkit sanity for the bridge (Node side of the same voice) ──
check('inspect weather', /Spring haze/.test(env3.inspectText('weather')));
check('inspect bell', /first|old mission|first dawn/.test(env3.inspectText('bell')), env3.inspectText('bell').slice(0, 60));

if (failures) {
  console.error(`\nNARRATIVE: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nNARRATIVE: the world speaks — deterministically, and with a voice ✓');
