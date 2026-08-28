// verify_friendship.mjs — headless verification of the FarmRoom friendship engine.
// Exercises the real server logic (gift tiers, daily-talk cap, heart events, marriage).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom, Player, NPC_GIFTS } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// Build a room-shaped harness that calls the real prototype methods.
const makePlayer = () => {
  const p = new Player('test', 'Tester');
  p.inventory.set('seeds', 5);
  p.inventory.set('tech-part', 2);
  p.inventory.set('starlight-crystal', 1);
  p.inventory.set('exotic-seed', 1);
  p.inventory.set('space-feather', 1);
  p.inventory.set('data-crystal', 1);
  p.inventory.set('rare-mineral', 1);
  p.inventory.set('cooked-food', 1);
  p.inventory.set('weeds', 1);
  p.inventory.set('flowers', 1);
  return p;
};

const room = Object.create(FarmRoom.prototype);
room.state = { players: new MapSchema(), day: 0 };
const client = { sessionId: 'test' };

console.log('== Gift affinity (loved/liked/hated/neutral) ==');
check('loved item → tier loved, delta 15', (() => {
  const r = room.giftTier('nova', 'tech-part');
  return r.tier === 'loved' && r.delta === 15;
})());
check('liked item → tier liked, delta 5', (() => {
  const r = room.giftTier('astra', 'rare-mineral');
  return r.tier === 'liked' && r.delta === 5;
})());
check('hated item → tier hated, delta -8', (() => {
  const r = room.giftTier('nova', 'junk');
  return r.tier === 'hated' && r.delta === -8;
})());
check('unknown item → neutral +2', (() => {
  const r = room.giftTier('nova', 'stardust-crystal');
  return r.tier === 'neutral' && r.delta === 2;
})());
check('every NPC has a loved gift in the tables', Object.values(NPC_GIFTS).every(g => !!g.loved));
check('all hated gifts are distinct from loved', Object.entries(NPC_GIFTS).every(([id, g]) => g.hated.every(h => h !== g.loved)));

console.log('== onGift full flow ==');
let p = makePlayer();
room.state.players.set('test', p);

let r = room.onGift(client, { npc: 'nova', item: 'tech-part' });   // loved +15
check('onGift returns ok + tier loved', r.ok && r.tier === 'loved' && r.delta === 15);
check('friendship = 15 after loved gift', p.friendships.get('nova') === 15, `got ${p.friendships.get('nova')}`);
check('item consumed', p.inventory.get('tech-part') === 1);

r = room.onGift(client, { npc: 'nova', item: 'weeds' });           // hated -8
check('hated gift lowers friendship (15→7)', p.friendships.get('nova') === 7, `got ${p.friendships.get('nova')}`);
check('hated gift tier reported', r.tier === 'hated' && r.delta === -8);

r = room.onGift(client, { npc: 'nova', item: 'cooked-food' });     // liked +5
check('liked gift raises to 12', p.friendships.get('nova') === 12, `got ${p.friendships.get('nova')}`);

console.log('== heart events fire at thresholds ==');
const p2 = makePlayer();
room.state.players.set('test', p2);
room.onGift(client, { npc: 'nova', item: 'tech-part' });  // 15
room.onGift(client, { npc: 'nova', item: 'tech-part' });  // 30 → crosses 20
check('heart event fired at 20 threshold', p2.heartEvents.get('nova') === 20, `got ${p2.heartEvents.get('nova')}`);
room.onGift(client, { npc: 'nova', item: 'cooked-food' });  // 35, no new threshold
check('no duplicate fire below next threshold', p2.heartEvents.get('nova') === 20, `got ${p2.heartEvents.get('nova')}`);

console.log('== daily talk cap ==');
const p3 = makePlayer();
room.state.players.set('test', p3);
room.state.day = 5;
r = room.onTalk(client, { npc: 'luna' });
check('first talk +2', r.ok && p3.friendships.get('luna') === 2);
r = room.onTalk(client, { npc: 'luna' });
check('second talk same day rejected', r.ok === false && r.reason === 'already-talked');
room.state.day = 6;
r = room.onTalk(client, { npc: 'luna' });
check('talk on new day allowed', r.ok && p3.friendships.get('luna') === 4);

console.log('== marriage ==');
const p4 = makePlayer();
room.state.players.set('test', p4);
p4.friendships.set('nova', 90);
r = room.onPropose(client, { npc: 'nova' });
check('proposal accepted at 90 friendship', r.ok && p4.marriedTo === 'nova');
const r2 = room.onPropose(client, { npc: 'luna' });
check('already married rejected', r2.ok === false && r2.reason === 'already-married');
const p5 = makePlayer();
room.state.players.set('test', p5);
p5.friendships.set('quasar', 90);   // not a marriage candidate
r = room.onPropose(client, { npc: 'quasar' });
check('non-candidate rejected', r.ok === false && r.reason === 'not-candidate');

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
if (fail === 0) console.log('FRIENDSHIP ENGINE ALL GREEN ✓');
process.exit(fail > 0 ? 1 : 0);
