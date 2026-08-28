// net_friendship.mjs — end-to-end over-the-wire test against the live server.
// Connects a real Colyseus client to :8900 and exercises gift/talk/propose.
import { Client } from 'colyseus.js';

let pass = 0, fail = 0;
const check = (n, c, d='') => c ? pass++ : (fail++, console.log(`  ✗ ${n} ${d}`));

const client = new Client('ws://localhost:8900');

try {
  const room = await client.joinOrCreate('farm', { name: 'NetTester' });
  console.log('joined room', room.sessionId);

  // syncPlayer shape
  const p = room.state.players[room.sessionId];

  // gift loved item to nova (tech-part in starter inventory)
  const g1 = await room.send('gift', { npc: 'nova', item: 'tech-part' }, true);
  check('server replies to gift', !!g1 && g1.ok);
  check('loved gift +15 (value 15)', g1 && g1.value === 15, JSON.stringify(g1));
  check('tier loved', g1 && g1.tier === 'loved');

  // hated gift (weeds — nova hates it) → -8
  const g2 = await room.send('gift', { npc: 'nova', item: 'weeds' }, true);
  check('hated gift −8 (value 7)', g2 && g2.value === 7, JSON.stringify(g2));
  check('tier hated', g2 && g2.tier === 'hated');

  // talk daily cap
  const t1 = await room.send('talk', { npc: 'luna' }, true);
  check('talk ok +2', t1 && t1.ok && t1.value === 2);
  const t2 = await room.send('talk', { npc: 'luna' }, true);
  check('talk capped same day', t2 && t2.ok === false);

  // propose too early rejected
  const pr1 = await room.send('propose', { npc: 'nova' }, true);
  check('propose rejected below 80', pr1 && pr1.ok === false);

  // drive nova to 80+ for marriage
  room.state.players[room.sessionId].friendships['nova'] = 90;
  const pr2 = await room.send('propose', { npc: 'nova' }, true);
  check('propose accepted at 90', pr2 && pr2.ok === true && pr2.marriedTo === 'nova');

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail > 0 ? 1 : 0);
} catch (err) {
  console.log('❌ Connection/test failed:', err.message);
  process.exit(1);
}
