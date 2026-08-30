// verify_calendar.mjs — the calendar is a SERVICE with one implementation and
// ONE tuning knob. This test proves the "trivial to change" promise: flip the
// days-per-season and seasons, crop maturity, and festival dates all follow;
// and FarmRoom honors an injected calendar (no hardcoded numbers anywhere).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Calendar, createCalendar, DEFAULT_CALENDAR, DAYS_PER_SEASON } = require(path.join(__dirname, '..', 'shared', 'calendar.js'));
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema, ArraySchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('== Default B-612 calendar ==');
{
  check('30 days per season', DAYS_PER_SEASON === 30, `got ${DAYS_PER_SEASON}`);
  check('year = 120 days (4 seasons x 30)', DEFAULT_CALENDAR.yearLength === 120, `got ${DEFAULT_CALENDAR.yearLength}`);
  check('maturity = 6 (round(30/5))', DEFAULT_CALENDAR.maturityDays() === 6, `got ${DEFAULT_CALENDAR.maturityDays()}`);
  check('winter grows at half speed (growth scaling lives here)',
    DEFAULT_CALENDAR.growthMultiplier(3) === 0.5 && DEFAULT_CALENDAR.growthMultiplier(0) === 1 && DEFAULT_CALENDAR.growthMultiplier(2) === 0.75);
}

console.log('== One knob: daysPerSeason re-tunes everything ==');
{
  // Festival specs are season-relative ({season, dayInSeason}), so they are
  // legal at any season length; the absolute dates move with the knob.
  const FEST = [
    { id: 'naming', season: 0, dayInSeason: 3, name: 'The Naming', short: 'THE NAMING', earthDay: false },
    { id: 'hearthnight', season: 3, dayInSeason: 2, name: 'Hearthnight', short: 'HEARTHNIGHT', earthDay: true },
  ];
  const cal14 = createCalendar({ daysPerSeason: 14, festivals: FEST });
  check('year scales (14 x 4 = 56)', cal14.yearLength === 56, `got ${cal14.yearLength}`);
  check('season boundaries follow the knob',
    cal14.seasonIndex(1) === 0 && cal14.seasonIndex(14) === 0 &&
    cal14.seasonIndex(15) === 1 && cal14.seasonIndex(29) === 2 &&
    cal14.seasonIndex(43) === 3 && cal14.seasonIndex(57) === 0,   // 57 = year 2 spring
    [1, 14, 15, 29, 43, 57].map((d) => `${d}=${cal14.seasonIndex(d)}`).join(' '));
  check('maturity scales (max(3, round(14/5)) = 3)', cal14.maturityDays() === 3, `got ${cal14.maturityDays()}`);
  check('festival dates move with the season',
    cal14.festivalForDay(3)?.id === 'naming' && cal14.festivalForDay(44)?.id === 'hearthnight', // 3*14+2
    `naming@${cal14.festivalForDay(3) && 'y'} hearthnight@${cal14.festivalForDay(44) ? 'y' : 'n'}`);
  check('festivals still recur yearly', cal14.festivalForDay(44 + 56)?.id === 'hearthnight');
  const next = cal14.nextFestivalAfter(44);   // after winter-2 festival → next The Naming, one year later
  check('nextFestivalAfter scans at most one year ahead', !!next && next.id === 'naming' && next.day === 59 && next.inDays === 15,
    JSON.stringify(next));
}

console.log('== FarmRoom honors an injected calendar (no hardcoded constants) ==');
{
  function makeRoom(calendar) {
    const room = Object.create(FarmRoom.prototype);
    room.state = {
      players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchema(),
      day: 0, time: 360, isDay: true, season: 0,
      festival: false, festivalClaimed: false, festivalPhase: 'none', feastPeak: false,
    };
    room.calendar = calendar;   // DI: the room uses ONLY this calendar
    return room;
  }
  const calA = createCalendar({
    daysPerSeason: 10,        // a 40-day year, just to prove it is all derived
    festivals: [{ id: 'test-fest', season: 2, dayInSeason: 7, name: 'Test Feast', short: 'TEST FEAST', earthDay: false }],
  });
  check('custom year length is 40', calA.yearLength === 40 && makeRoom(calA)._cal().yearLength === 40);
  const room = makeRoom(calA);
  const cli = { sessionId: 'noone' };
  room.onAdvanceDay(cli);
  const dayOneFestivalActive = room.state.festival;
  // advance to the injected festival (season 2, day-in-season 7 → abs. 2*10+7=27)
  while (room.state.day < 27) room.onAdvanceDay(cli);
  check('injected festival fires on its derived date', room.state.festival === true,
    `day=${room.state.day} season=${room.state.season} festival=${room.state.festival}`);
  check('phase machine still runs', room.state.festivalPhase === 'setup');
  check('day 1 is never a festival', !dayOneFestivalActive);

  // growth pacing from the injected calendar: 10-day seasons → maturity max(3, 10/5)=3
  const calB = createCalendar({ daysPerSeason: 10 });
  check('injected maturity feeds FarmRoom growth (10-day season → 3)',
    calB.maturityDays() === 3 && makeRoom(calB)._cal().maturityDays() === 3);
}

console.log('== Injection seam on the class ==');
{
  const before = FarmRoom.calendar;
  try {
    FarmRoom.calendar = createCalendar({ daysPerSeason: 8 });   // non-default knob
    const room = Object.create(FarmRoom.prototype);
    check('FarmRoom.calendar static seam is consulted', room._cal().daysPerSeason === 8, `got ${room._cal().daysPerSeason}`);
    check('8-day seasons, 32-day year, maturity 3', room._cal().yearLength === 32 && room._cal().maturityDays() === 3);
  } finally {
    FarmRoom.calendar = before;   // restore — never leak state into other tests
  }
}

console.log(`\nverify_calendar: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
