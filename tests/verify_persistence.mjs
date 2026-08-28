// verify_persistence.mjs — headless verification of the JSON save system.
// The crux of the test: the STABLE player id (PID) is constant while the
// session id rotates (like a real browser reconnect). Proving a player's
// whole life survives a NEW session under the same PID is the whole point
// of persistence. Also: fresh PIDs get a fresh farm; onLeave flushes; the
// save file on disk is well-formed.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema } = require('@colyseus/schema');
const { loadPlayer, deleteSave, SAVE_DIR } = require(path.join(__dirname, '..', 'server', 'persistence.js'));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// A room-shaped harness that calls the real prototype methods (no colyseus server).
// Same stable PID each time; a FRESH session id each call (simulates reconnect).
const PID = 'persist-test-' + Math.random().toString(36).slice(2, 8);   // stable save key
let sessionCounter = 0;
function makeRoom(name = 'Saver', playerId = PID) {
  const room = Object.create(FarmRoom.prototype);
  room._persistence = true;   // this suite exercises the real save/load path
  room.state = {
    players: new MapSchema(),
    farms: new MapSchema(),
    day: 3, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false,
  };
  const sid = 'sess-' + (++sessionCounter) + '-' + Math.random().toString(36).slice(2, 6);
  room.sessionOf = sid;
  room.onJoin({ sessionId: sid }, { name, playerId });
  room.player = room.state.players.get(sid);
  room.farm = room.state.farms.get(sid);
  return room;
}

// clean slate
deleteSave(PID);

// ── build a rich life, then save ──
console.log('== Build + save ==');
const room = makeRoom();
const p = room.player;
const farm = room.farm;
check('new farmer got a starting quest', p.quests.current === 'q1_meet_quasar');
check('new farmer got starter seeds', (p.inventory.get('seeds') || 0) === 5);
check('player carries the stable playerId', p.playerId === PID);

p.credits = 1234;
p.energy = 42;
p.tool = 'iron';
p.marriedTo = 'rhea';
p.tutorialComplete = true;
p.friendships.set('nova', 55);
p.heartEvents.set('rhea', 80);
p.inventory.set('space-wheat', 7);
p.inventory.set('cooked-food', 3);
p.inventory.set('seeds', 0);   // deliberately drain: reload must restore 0, not re-grant 5
p.animals.set('chicken', 4);
p.storage.set('egg', 12);
// advance a quest objective + mark one complete
p.quests.current = 'q2_mine_crystal';
p.quests.progress.set('q2_mine_crystal::0', 2);
p.quests.completed.push('q1_meet_quasar');
// plant a crop on the farm
farm.tiles[0].type = 'growing'; farm.tiles[0].crop = 'space-wheat'; farm.tiles[0].growthDay = 1.5; farm.tiles[0].watered = true;
farm.tiles[5].type = 'mature'; farm.tiles[5].crop = 'moon-melon'; farm.tiles[5].growthDay = 3;

const saved = room.saveNow(room.sessionOf, false);
check('saveNow returns true', saved === true);
check('save file exists on disk', fs.existsSync(path.join(SAVE_DIR, PID + '.json')));
const onDisk = loadPlayer(PID);
check('loadPlayer parses the file', !!onDisk && onDisk.v === 1);
check('disk has the credits', onDisk.credits === 1234);

// ── reload into a FRESH SESSION (new session id, same stable PID) ──
console.log('== Reload into fresh session ==');
const room2 = makeRoom();   // new session, same PID
check('sessions actually differ', room2.sessionOf !== room.sessionOf);
const p2 = room2.player;
const farm2 = room2.farm;
check('returning farmer restored credits', p2.credits === 1234, `got ${p2.credits}`);
check('returning farmer restored energy', p2.energy === 42);
check('returning farmer restored tool', p2.tool === 'iron');
check('returning farmer restored marriage', p2.marriedTo === 'rhea');
check('returning farmer restored tutorial flag', p2.tutorialComplete === true);
check('returning farmer restored friendship', (p2.friendships.get('nova') || 0) === 55);
check('returning farmer restored heart event', (p2.heartEvents.get('rhea') || 0) === 80);
check('returning farmer restored inventory', (p2.inventory.get('space-wheat') || 0) === 7 && (p2.inventory.get('cooked-food') || 0) === 3);
check('returning farmer restored animals', (p2.animals.get('chicken') || 0) === 4);
check('returning farmer restored storage', (p2.storage.get('egg') || 0) === 12);
check('returning farmer restored quest current', p2.quests.current === 'q2_mine_crystal');
check('returning farmer restored quest progress', (p2.quests.progress.get('q2_mine_crystal::0') || 0) === 2);
check('returning farmer restored completed list', Array.from(p2.quests.completed).includes('q1_meet_quasar'));
check('returning farmer did NOT re-grant starter seeds', (p2.inventory.get('seeds') || 0) === 0, `seeds=${p2.inventory.get('seeds')}`);
check('returning farmer restored farm tile 0', farm2.tiles[0].type === 'growing' && farm2.tiles[0].crop === 'space-wheat' && Math.abs(farm2.tiles[0].growthDay - 1.5) < 0.001 && farm2.tiles[0].watered === true);
check('returning farmer restored farm tile 5 (mature)', farm2.tiles[5].type === 'mature' && farm2.tiles[5].crop === 'moon-melon');
check('returning farmer keeps an 8x8 farm', farm2.tiles.length === 64);

// ── a DIFFERENT stable id must NOT load the save ──
console.log('== Different-id isolation ==');
const PID2 = 'other-' + Math.random().toString(36).slice(2, 8);
deleteSave(PID2);
const room3 = makeRoom('Newbie', PID2);
const p3 = room3.player;
check('different id starts at 100 credits (not the save)', p3.credits === 100, `got ${p3.credits}`);
check('different id starts on q1_meet_quasar', p3.quests.current === 'q1_meet_quasar');
check('different id has starter seeds', (p3.inventory.get('seeds') || 0) === 5);

// ── onLeave persists (before state vanishes) ──
console.log('== onLeave persists ==');
deleteSave(PID);
const room4 = makeRoom();
const p4 = room4.player;
p4.credits = 777;
room4.onLeave({ sessionId: room4.sessionOf });
check('onLeave wrote a save', loadPlayer(PID) && loadPlayer(PID).credits === 777);

// cleanup
deleteSave(PID); deleteSave(PID2);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail === 0 ? 0 : 1);
