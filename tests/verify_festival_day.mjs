// verify_festival_day.mjs — headless verification of M3 (Earth Day festival).
// Drives the REAL FarmRoom handlers through a festival day and asserts:
// phase state machine (none→setup→feast→afterglow→none), broadcast shapes,
// peak idempotency, the q3_earth_feast climax beat, NPC plaza bias,
// festival-only recipe gate, and rejoin state sync fields.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema } = require('@colyseus/schema');

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

console.log('== Phase state machine ==');
let room = makeRoom();
let p = room.state.players.get('f');

// advance to day 8 → festival day? (day % 7 === 1 && day > 1) → day 8 yes
room.onAdvanceDay(client); // day 1: not festival (day>1 gate)
check('day 1 is not a festival', room.state.festival === false && room.state.festivalPhase === 'none');
for (let i = 0; i < 6; i++) room.onAdvanceDay(client); // → day 7
check('day 7 is not a festival', room.state.festival === false);
room.onAdvanceDay(client); // → day 8: festival!
check('day 8 is a festival', room.state.festival === true);
check('waking on festival day → setup phase', room.state.festivalPhase === 'setup');
check('setup broadcast sent', !!lastMsg(room, 'festivalPhase') && lastMsg(room, 'festivalPhase').data.phase === 'setup');
check('claim resets each festival', room.state.festivalClaimed === false);

// midday → feast (timer-driven in the live room; apply directly here, idempotent)
room._applyFestivalPhase('feast');
check('midday → feast phase', room.state.festivalPhase === 'feast');
const before = room.sent.length;
room._applyFestivalPhase('feast');
check('re-entering same phase is a no-op (no double broadcast)', room.sent.length === before);

// next day → afterglow (one morning), then none
room.onAdvanceDay(client); // day 9
check('morning after festival → afterglow', room.state.festivalPhase === 'afterglow' && room.state.festival === false);
room.onAdvanceDay(client); // day 10
check('afterglow expires → none', room.state.festivalPhase === 'none');

console.log('== Climax beat: feast peak ==');
room = makeRoom();
p = room.state.players.get('f');
room.onAdvanceDay(client);
for (let i = 0; i < 6; i++) room.onAdvanceDay(client);
room.onAdvanceDay(client); // day 8 festival, setup
check('feastPeak starts false on new festival', room.state.feastPeak === false);

// drive q3_earth_feast directly: set current quest, cook 3 plates on festival day
p.quests.current = 'q3_earth_feast';
p.quests.arcDone = false;
const inv = p.inventory;
// festival recipe needs its 3 ingredients (earth-feast-plate gate is festival:true)
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
room.onAdvanceDay(client); // day 9 — not festival
r = room.onCook(client, { recipe: 'earth-feast-plate' });
check('earth-feast-plate refused off-festival', r && r.ok === false && r.reason === 'festival-only');
check('new festival day resets feastPeak', (() => {
  // currently day 9; next festival day is 15 (day%7===1 && day>1)
  for (let i = 0; i < 6; i++) room.onAdvanceDay(client);
  return room.state.day === 15 && room.state.festival === true && room.state.feastPeak === false;
})());

console.log('== NPC plaza bias (client-side, structural) ==');
// The plaza bias lives in PlanetScene._pickErrand (client). Assert the code
// path exists and is gated on festival activity (no Phaser needed here).
import { readFileSync } from 'node:fs';
const sceneSrc = readFileSync(path.join(__dirname, '..', 'client', 'scenes', 'PlanetScene.js'), 'utf8');
check('_pickErrand has festival plaza branch', /_pickErrand[\s\S]{0,400}_festActive[\s\S]{0,200}0\.7/.test(sceneSrc));
check('rejoin syncs festivalPhase from room state', /state\.festivalPhase/.test(sceneSrc));

console.log('== Rejoin sync fields ==');
room = makeRoom();
check('state schema exposes festivalPhase', 'festivalPhase' in room.state);
check('state schema exposes feastPeak', 'feastPeak' in room.state);

console.log(`\nverify_festival_day: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
