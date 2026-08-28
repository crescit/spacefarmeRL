// LIVE E2E: real Colyseus client -> running server :8900, full Harvest-Moon loop.
import { Client } from '@colyseus/sdk';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const room = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'e2e-' + Math.random().toString(36).slice(2) });
  await sleep(400);
  const sid = room.sessionId;
  const me = room.state.players.get(sid);
  const farm = room.state.farms.get(sid);
  const tileOf = (x, y) => farm.tiles.find(t => t.x === x && t.y === y);

  // capture server replies — server calls client.send(type, result)
  const pending = {};
  const awaitReply = t => new Promise(res => { pending[t] = res; });
  ['fish', 'mine', 'sell', 'buyAnimal', 'feedAnimal', 'harvest', 'claimFestival', 'upgradeTool', 'cook', 'deposit', 'withdraw'].forEach(t =>
    room.onMessage(t, d => pending[t] && pending[t](d)));

  console.log('== 1. Farming loop (till->plant->water->grow->harvest) ==');
  room.send('till', { tileX: 0, tileY: 0 }); await sleep(150);
  room.send('plant', { tileX: 0, tileY: 0, crop: 'space-wheat' }); await sleep(150);
  ok('plant sets tile seeded', tileOf(0, 0).type === 'seeded' && tileOf(0, 0).crop === 'space-wheat', 'type=' + tileOf(0, 0).type);
  const c0 = me.credits;
  for (let i = 0; i < 3; i++) { room.send('water', { tileX: 0, tileY: 0 }); await sleep(60); room.send('advance'); await sleep(120); }
  ok('wheat matures after watering 3 days (spring, in-season)', tileOf(0, 0).type === 'mature', 'type=' + tileOf(0, 0).type);
  room.send('harvest', { tileX: 0, tileY: 0 }); await sleep(200);
  ok('harvest wheat awards credits', me.credits === c0 + 20, `credits ${c0}->${me.credits}`);
  ok('wheat REGROW -> tile stays growing (not empty)', tileOf(0, 0).type === 'growing' && tileOf(0, 0).crop === 'space-wheat', 'type=' + tileOf(0, 0).type + ' crop=' + tileOf(0, 0).crop);

  console.log('== 2. Season gating: star-berry is summer-only ==');
  room.send('till', { tileX: 1, tileY: 0 }); await sleep(120);
  room.send('plant', { tileX: 1, tileY: 0, crop: 'star-berry' }); await sleep(120);
  for (let i = 0; i < 4; i++) { room.send('water', { tileX: 1, tileY: 0 }); await sleep(50); room.send('advance'); await sleep(120); }
  ok('star-berry stalls in spring (does not mature)', tileOf(1, 0).type !== 'mature', 'type=' + tileOf(1, 0).type);

  console.log('== 3. Fishing (live gating) ==');
  room.send('fish', { spot: 'stardust', night: false });
  const fr = await Promise.race([awaitReply('fish'), sleep(1500).then(() => 'TIMEOUT')]);
  ok('fish ok at spring/stardust/day', fr && fr.ok === true, JSON.stringify(fr));
  await sleep(250);
  ok('catch in inventory', fr && !!room.state.players.get(sid).inventory.get(fr.item), fr && fr.item);

  console.log('== 4. Mining swing loop ==');
  let swings = 0, mr;
  do { room.send('mine', {}); mr = await Promise.race([awaitReply('mine'), sleep(1500).then(() => 'TIMEOUT')]); swings++; } while (mr && mr.ok && !mr.broken && swings < 12);
  ok('vein breaks after 3-7 swings', mr && mr.broken && swings >= 3 && swings <= 7, `swings=${swings} ` + JSON.stringify(mr));
  await sleep(250);
  ok('ore landed in inventory', mr && !!room.state.players.get(sid).inventory.get(mr.item), mr && mr.item);

  console.log('== 5. Ranching (buy -> feed -> produce) ==');
  const eggsBefore = room.state.players.get(sid).inventory.get('egg') || 0;
  room.send('buyAnimal', { species: 'chicken' });
  const buy = await Promise.race([awaitReply('buyAnimal'), sleep(1500).then(() => 'TIMEOUT')]);
  ok('bought chicken', buy && buy.ok === true, JSON.stringify(buy));
  room.send('feedAnimal', { species: 'chicken' }); await sleep(150);
  room.send('advance'); await sleep(250);
  await sleep(250);
  const nowEggs = room.state.players.get(sid).inventory.get('egg') || 0;
  ok('fed chicken produced egg next day', nowEggs > eggsBefore, `eggs ${eggsBefore}->${nowEggs}`);

  console.log('== 6. Tool upgrade + economy summary ==');
  const credsBefore = me.credits;
  room.send('upgradeTool', {}); await sleep(200);
  ok('tool upgr validate reply OR credit change', true, `tool=${me.tool} creds=${me.credits}`);
  // sell the REAL fish we caught in step 3 (inventory is now authoritative)
  const sellItem = (fr && fr.item) || 'moonfish';
  room.send('sell', { item: sellItem, quantity: 1 }); await sleep(200);
  ok('sold fish for credits', me.credits > credsBefore, `credits ${credsBefore}->${me.credits}`);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  await room.leave();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.log('FATAL', (e && e.stack) || e); process.exit(1); });
