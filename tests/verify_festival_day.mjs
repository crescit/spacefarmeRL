// verify_festival_day.mjs — headless verification of the yearly festival system.
// Drives the REAL FarmRoom handlers through festival days and asserts:
// - the phase state machine (none→setup→feast→afterglow→none) on festival days,
// - broadcast shapes, peak idempotency, the q3_earth_feast climax beat,
// - festival-only recipe gate, claim/reset semantics,
// - the festivals recur once PER YEAR on the fixed B-612 dates from the shared
//   calendar service (shared/calendar.js) — no first-day-of-season monotony.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
// The festival calendar is a SERVICE, not duplicated math: ask IT which days
// are festivals, then hammer the server into those days.
const { createCalendar, DAYS_PER_SEASON } = require(path.join(__dirname, '..', 'shared', 'calendar.js'));
const { MapSchema } = require('@colyseus/schema');

const cal = createCalendar();
const F = Object.fromEntries(cal.festivals.map((f) => [f.id, f.dayInYear])); // year-day of each festival
const YEAR = cal.yearLength; // 120

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// Room harness that also spies on broadcasts (the real room uses this.broadcast).
function makeRoom() {
  const room = Object.create(FarmRoom.prototype);
  room.state = {
    players: new MapSchema(),
    farms: new MapSchema(),
    day: 0, time: 360, isDay: true, season: 0,
    festival: false, festivalClaimed: false, festivalPhase: 'none', feastPeak: false,
  };
  room.sent = [];
  room.broadcast = (type, data) => { room.sent.push({ type, data }); };
  room.onJoin({ sessionId: 'f' }, { name: 'Farmer' });
  return room;
}
const client = { sessionId: 'f' };
const lastMsg = (room, type) => [...room.sent].reverse().find((m) => m.type === type);
const advanceTo = (room, target) => { while (room.state.day < target) room.onAdvanceDay(client); };

console.log('== Calendar service: yearly, mixed-up, story-dated festivals ==');
{
  check('four festivals in a calendar year', cal.festivals.length === 4, `got ${cal.festivals.length}`);
  check('no festival on the first day of every season',
    cal.festivals.every((f) => f.dayInSeason !== 1), cal.festivals.map((f) => `${f.id}@${f.dayInSeason}`).join(', '));
  check('festival weekdays are distinct (spring 25, summer 24, fall 29, winter 25)',
    new Set(cal.festivals.map((f) => `${f.season}-${f.dayInSeason}`)).size === 4);
  check('Hearthnight is the Sol Earth Festival (earthDay) on winter 25',
    cal.festivals.some((f) => f.id === 'hearthnight' && f.earthDay === true && f.season === 3 && f.dayInSeason === 25),
    JSON.stringify(cal.festivals[3]));
  check('a year is 30 x 4 = 120 days', DAYS_PER_SEASON === 30 && YEAR === 120, `daysPerSeason=${DAYS_PER_SEASON} year=${YEAR}`);
  check('winter festival day 25 lands on absolute day 115', cal.festivalForDay(115)?.id === 'hearthnight');
}

console.log('== Phase state machine ==');
let room = makeRoom();
advanceTo(room, F.naming);
check(`day ${F.naming} is The Naming (festival)`, room.state.festival === true, `day=${room.state.day}`);
check('waking on festival day -> setup phase', room.state.festivalPhase === 'setup');
check('setup broadcast sent', !!lastMsg(room, 'festivalPhase') && lastMsg(room, 'festivalPhase').data.phase === 'setup');
check('claim resets each festival', room.state.festivalClaimed === false);

room.onAdvanceDay(client); // day after festival
check('day after a festival -> afterglow', room.state.festivalPhase === 'afterglow' && room.state.festival === false);
room.onAdvanceDay(client);
check('afterglow expires -> none', room.state.festivalPhase === 'none');

console.log('== Climax beat: feast peak on a festival ==');
room = makeRoom();
const p = room.state.players.get('f');
advanceTo(room, F.hearthnight); // Hearthnight — the ACT 3 finale festival
check('Hearthnight festival active', room.state.festival === true, `day=${room.state.day}`);
check('feastPeak starts false on new festival', room.state.feastPeak === false);

// drive q3_earth_feast: cook 3 Earth Feast Plates on the festival day
p.quests.current = 'q3_earth_feast';
p.quests.arcDone = false;
const inv = p.inventory;
for (const ing of ['space-wheat', 'egg', 'moon-melon']) inv.set(ing, 5);
let r = room.onCook(client, { recipe: 'earth-feast-plate' });
check('cook earth-feast-plate allowed on festival day', r && r.ok === true, JSON.stringify(r));
room.onCook(client, { recipe: 'earth-feast-plate' });
r = room.onCook(client, { recipe: 'earth-feast-plate' });
check('3rd plate completes q3_earth_feast', p.quests.completed.includes('q3_earth_feast'));
check('feast peak fired on completion', room.state.feastPeak === true);
check('feastPeak broadcast sent', !!lastMsg(room, 'feastPeak'));
const peakCount = room.sent.filter((m) => m.type === 'feastPeak').length;
room._markFeastPeak(); room._markFeastPeak();
check('peak is idempotent', room.sent.filter((m) => m.type === 'feastPeak').length === peakCount);

// festival-only gate: same recipe off-festival is refused
room.onAdvanceDay(client); // day after Hearthnight — not a festival
r = room.onCook(client, { recipe: 'earth-feast-plate' });
check('earth-feast-plate refused off-festival', r && r.ok === false && r.reason === 'festival-only');
{
  // same calendar says the NEXT festival is the first-day-of-next-year Gala…
  const next = cal.nextFestivalAfter(room.state.day);
  check('calendar names the next festival', !!next && next.day > room.state.day, `next=${next && next.name} day=${next && next.day}`);
  advanceTo(room, next.day);
  check('new festival day resets feastPeak',
    room.state.day === next.day && room.state.festival === true && room.state.feastPeak === false,
    `day=${room.state.day} fest=${room.state.festival} peak=${room.state.feastPeak}`);
}

console.log('== Festival claim: once per festival, resets each festival ==');
room = makeRoom();
advanceTo(room, F['solar-flare-fair']);
const claim = room.onClaimFestival(client);
check('claim works on festival day', claim.ok === true, JSON.stringify(claim));
const again = room.onClaimFestival(client);
check('cannot claim twice same festival', again.ok === false && again.reason === 'already-claimed');
room.onAdvanceDay(client);
const off = room.onClaimFestival(client);
check('cannot claim off-festival', off.ok === false && off.reason === 'no-festival-today');

console.log('== Festivals recur once per year on fixed dates ==');
{
  const year1 = Object.values(F).sort((a, b) => a - b);
  for (const yday of year1) check(`year-1 festival at year-day ${yday}`, cal.isFestivalDay(yday));
  for (const f of cal.festivals) {
    const d2 = f.dayInYear + YEAR; // one full year later
    const f2 = cal.festivalForDay(d2);
    check(`${f.id} recurs yearly (day ${d2} = year-day ${f.dayInYear} + 1 year)`,
      !!f2 && f2.id === f.id && f2.earthDay === f.earthDay, JSON.stringify(f2));
  }
  check('off-days are not festivals',
    !cal.isFestivalDay(2) && !cal.isFestivalDay(26) && !cal.isFestivalDay(90) && !cal.isFestivalDay(91));
}

console.log('== Rejoin sync fields ==');
room = makeRoom();
check('state schema exposes festivalPhase', 'festivalPhase' in room.state);
check('state schema exposes feastPeak', 'feastPeak' in room.state);

console.log(`\nverify_festival_day: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
