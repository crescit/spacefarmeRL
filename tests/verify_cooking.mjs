// verify_cooking.mjs — M4 "The Kitchen" headless verification.
// Drives the REAL FarmRoom handlers: named recipes consume exact ingredients
// and yield named dishes; earth-feast-plate is festival-gated; the generic
// 2-ingredient path still works; dishes sell for their listed value; dish
// gifts grant per-NPC bonuses; and q3_earth_feast now requires THE festival
// dish (generic cooking no longer satisfies it).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom, Player, RECIPES, DISH_SELL } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

function mkRoom(sid) {
  const room = Object.create(FarmRoom.prototype);
  room.state = { players: new MapSchema(), farms: new MapSchema(), day: 3, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false, quests: null };
  const p = new Player(sid, 'Chef');
  room.state.players.set(sid, p);
  return { room, p, cli: { sessionId: sid } };
}

// ── named recipe cooking ──
console.log('== Named recipes ==');
{
  const { room, p, cli } = mkRoom('c1');
  p.inventory.set('space-wheat', 3); p.inventory.set('egg', 3);
  const r = room.onCook(cli, { recipe: 'space-pudding' });
  check('cook space-pudding ok', r.ok === true, JSON.stringify(r));
  check('yields space-pudding item', (p.inventory.get('space-pudding') || 0) === 1);
  check('consumed 1 wheat', (p.inventory.get('space-wheat') || 0) === 2);
  check('consumed 1 egg', (p.inventory.get('egg') || 0) === 2);
  const r2 = room.onCook(cli, { recipe: 'space-pudding' });
  check('can cook again (had 3)', r2.ok === true && (p.inventory.get('space-pudding') || 0) === 2);

  // missing ingredient → refused, nothing consumed
  p.inventory.set('egg', 0);
  const r3 = room.onCook(cli, { recipe: 'space-pudding' });
  check('missing egg → need-ingredients', r3.ok === false && r3.reason === 'need-ingredients' && r3.missing === 'egg', JSON.stringify(r3));
  check('no consumption on refusal', (p.inventory.get('space-wheat') || 0) === 1);

  // unknown recipe → generic path behavior, not a crash
  const r4 = room.onCook(cli, { recipe: 'no-such-recipe' });
  check('unknown recipe falls back / refuses cleanly', r4 && (r4.ok === false || r4.ok === true));
}

// ── 3-ingredient recipe ──
console.log('== Three-ingredient recipe ==');
{
  const { room, p, cli } = mkRoom('c2');
  p.inventory.set('space-wheat', 2); p.inventory.set('plasma-tomato', 2); p.inventory.set('egg', 2);
  const r = room.onCook(cli, { recipe: 'autumn-roast' });
  check('autumn-roast ok (3 ingredients)', r.ok === true, JSON.stringify(r));
  check('all three consumed', (p.inventory.get('space-wheat') || 0) === 1 && (p.inventory.get('plasma-tomato') || 0) === 1 && (p.inventory.get('egg') || 0) === 1);
  check('autumn-roast sold for its price', (() => { const before = p.credits; room.onSell(cli, { item: 'autumn-roast', quantity: 1 }); return p.credits - before === DISH_SELL['autumn-roast']; })(), `expected ${DISH_SELL['autumn-roast']}`);
}

// ── festival dish: earth-feast-plate ──
console.log('== Earth Feast Plate (festival dish) ==');
{
  const { room, p, cli } = mkRoom('c3');
  p.inventory.set('space-wheat', 5); p.inventory.set('egg', 5); p.inventory.set('moon-melon', 5);

  // OFF festival day → refused
  room.state.festival = false;
  const r0 = room.onCook(cli, { recipe: 'earth-feast-plate' });
  check('earth-feast-plate refused off-festival', r0.ok === false && r0.reason === 'festival-only', JSON.stringify(r0));
  check('nothing consumed on refusal', (p.inventory.get('egg') || 0) === 5);

  // ON festival day → cooks
  room.state.festival = true;
  const r = room.onCook(cli, { recipe: 'earth-feast-plate' });
  check('earth-feast-plate cooks on festival day', r.ok === true && r.festival === true, JSON.stringify(r));
  check('yielded the plate', (p.inventory.get('earth-feast-plate') || 0) === 1);
  check('consumed one of each of the 3 ingredients',
    (p.inventory.get('space-wheat') || 0) === 4 && (p.inventory.get('egg') || 0) === 4 && (p.inventory.get('moon-melon') || 0) === 4);
}

// ── generic fallback still works (verify_mechanics parity) ──
console.log('== Generic fallback ==');
{
  const { room, p, cli } = mkRoom('c4');
  p.inventory.set('space-wheat', 3);
  const r = room.onCook(cli, {});
  check('generic cook ok with 3 wheat', r.ok === true && r.dish === 'cooked-food', JSON.stringify(r));
  check('2 wheat consumed → 1 left', (p.inventory.get('space-wheat') || 0) === 1);
  check('got 1 cooked-food', (p.inventory.get('cooked-food') || 0) === 1);
  p.inventory.set('space-wheat', 1); p.inventory.set('star-berry', 1);
  const r2 = room.onCook(cli, {});
  check('generic mixed crops ok', r2.ok === true);
  const r3 = room.onCook(cli, {});
  check('generic no-ingredients → need-ingredients', r3.ok === false && r3.reason === 'need-ingredients', JSON.stringify(r3));
}

// ── dish sell values ──
console.log('== Dish sell values ==');
{
  const { room, p, cli } = mkRoom('c5');
  p.inventory.set('space-pudding', 2);
  const before = p.credits;
  room.onSell(cli, { item: 'space-pudding', quantity: 2 });
  check('space-pudding sells for 2 x 70', p.credits - before === 140, `diff=${p.credits - before}`);
  const b2 = p.credits;
  p.inventory.set('solar-omakase', 1);
  room.onSell(cli, { item: 'solar-omakase', quantity: 1 });
  check('solar-omakase sells for 280', p.credits - b2 === 280, `diff=${p.credits - b2}`);
}

// ── dish gift bonuses (per-NPC) ──
console.log('== Dish gift bonuses ==');
{
  const { room, p, cli } = mkRoom('c6');
  p.inventory.set('earth-feast-plate', 1);
  p.friendships.set('rhea', 10);
  const r = room.onGift(cli, { npc: 'rhea', item: 'earth-feast-plate' });
  // base: rhea loves 'cooked-food' but earth-feast-plate is neutral base (+2) + dishBonus 30
  check('rhea dish bonus reported', r.ok === true && r.dishBonus === 30, JSON.stringify(r));
  check('rhea bond moved up by base+dish', p.friendships.get('rhea') === 42, `got ${p.friendships.get('rhea')}`);
  check('strong dish bonus reads as loved tier', r.tier === 'loved');

  // nova likes solar omakase +15
  const { room: roomB, p: pb, cli: cliB } = mkRoom('c7');
  pb.inventory.set('solar-omakase', 1);
  pb.friendships.set('nova', 5);
  const rb = roomB.onGift(cliB, { npc: 'nova', item: 'solar-omakase' });
  check('nova +15 on omakase', rb.dishBonus === 15 && pb.friendships.get('nova') === 5 + 2 + 15, `got ${pb.friendships.get('nova')}`);
}

// ── q3_earth_feast now requires the festival DISH ──
console.log('== Quest gate: q3_earth_feast needs the plate ==');
{
  const { room, p, cli } = mkRoom('c8');
  // fast-forward the quest state to the climax (mirrors verify_quests)
  p.quests.current = 'q3_earth_feast';
  p.inventory.set('space-wheat', 9); p.inventory.set('egg', 9); p.inventory.set('moon-melon', 9);

  room.state.festival = false;
  room.onCook(cli, { recipe: 'space-pudding' });   // generic-ish, wrong dish, off-festival
  check('cooking a spring dish off-festival does NOT advance', p.quests.current === 'q3_earth_feast');

  room.state.festival = true;
  room.onCook(cli, { recipe: 'nebula-stew' });     // right day, wrong dish
  room.onCook(cli, {});                            // right day, generic cooked-food
  check('generic/wrong-dish cooking on festival day does NOT advance', p.quests.current === 'q3_earth_feast');

  room.onCook(cli, { recipe: 'earth-feast-plate' });
  room.onCook(cli, { recipe: 'earth-feast-plate' });
  room.onCook(cli, { recipe: 'earth-feast-plate' });
  check('3 Earth Feast Plates on festival day complete q3_earth_feast', p.quests.current === 'q3_heart_of_stardust', `got ${p.quests.current}`);
  check('quest reward credited', p.credits >= 150);
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail === 0 ? 0 : 1);
