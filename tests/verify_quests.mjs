// verify_quests.mjs — headless verification of 'The Stardust Story' quest engine.
// Drives the REAL FarmRoom handler methods through the full 3-act arc and
// asserts: objective matching, reward grants, chain advance, festival gating,
// level-based objectives, and the ending (arcDone + stardust-core item).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom, Player, QUESTS, QUEST_ORDER, NPC_GIFTS } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// A room-shaped harness that calls the real prototype methods.
function makeRoom() {
  const room = Object.create(FarmRoom.prototype);
  room.state = {
    players: new MapSchema(),
    farms: new MapSchema(),
    day: 0, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false,
  };
  room.onJoin({ sessionId: 'f' }, { name: 'Farmer' });
  return room;
}
const client = { sessionId: 'f' };

// A fake farm plot so plant/harvest work without the real tilemap.
function giveMatureTiles(room, count, crop = 'space-wheat') {
  const farm = room.state.farms.get('f');
  for (let i = 0; i < count; i++) {
    const t = farm.tiles[i];
    t.type = 'mature'; t.crop = crop; t.growthDay = 3; t.watered = false;
  }
}
function giveTilledTiles(room, count) {
  const farm = room.state.farms.get('f');
  for (let i = 0; i < count; i++) { farm.tiles[i].type = 'tilled'; farm.tiles[i].crop = ''; }
}

// ── ARC INTEGRITY ──
console.log('== Arc integrity ==');
check('14 quests defined, matching QUEST_ORDER', Object.keys(QUESTS).length === QUEST_ORDER.length && QUEST_ORDER.length === 14);
check('chain is unbroken (every next → a real quest id)', QUEST_ORDER.every((id, i) => {
  const q = QUESTS[id]; if (!q) return false;
  if (i === QUEST_ORDER.length - 1) return q.next === null;
  return QUESTS[q.next] && q.next === QUEST_ORDER[i + 1];
}));
check('acts partition into 5 / 5 / 4', [1, 2, 3].map((a) => QUEST_ORDER.filter((id) => QUESTS[id].act === a).length).join(',') === '5,5,4');
check('every quest has a giver in NPC_GIFTS', QUEST_ORDER.every((id) => QUESTS[id].giver && Object.keys(NPC_GIFTS).includes(QUESTS[id].giver)));

// ── ACT 1: learn + debt ──
console.log('== Act 1 — The Debt ==');
let room = makeRoom();
let p = room.state.players.get('f');
check('arc starts at q1_meet_quasar', p.quests.current === 'q1_meet_quasar');

// q1_meet_quasar: talk to quasar → complete, advance to q1_first_soil
room.onTalk(client, { npc: 'quasar' });
check('talk-to-quasar completes q1_meet_quasar', p.quests.completed.includes('q1_meet_quasar') && p.quests.current === 'q1_first_soil');

// q1_first_soil: plant 4 → complete
giveTilledTiles(room, 4);
[0,1,2,3].forEach((i) => room.onPlant(client, { tileX: i, tileY: 0, crop: 'space-wheat' }));
check('planting 4 completes q1_first_soil (reward: 30cr + 5 seeds)', p.quests.current === 'q1_first_harvest');
check('reward granted credits (30)', p.credits >= 30);

// q1_first_harvest: harvest 3 → complete
giveMatureTiles(room, 3);
[0,1,2].forEach((i) => room.onHarvest(client, { tileX: i, tileY: 0 }));
check('harvesting 3 completes q1_first_harvest', p.quests.current === 'q1_learn_fish');

// q1_learn_fish: catch 1 fish → complete (spring, stardust spot)
p.equipped = 'rod';   // casting is tool-gated — equip the rod first
room.onFish(client, { spot: 'stardust' });
check('catching a fish completes q1_learn_fish', p.quests.current === 'q1_debt_installment');

// q1_debt_installment: earn 150cr selling + talk quasar → complete
p.inventory.set('space-wheat', (p.inventory.get('space-wheat') || 0) + 10);
room.onSell(client, { item: 'space-wheat', quantity: 10 });   // 20*10 = 200 >= 150
room.onTalk(client, { npc: 'quasar' });
check('sell + talk completes q1_debt_installment', p.quests.current === 'q2_meet_nova');
check('Act 1 fully done (5 quests)', ['q1_meet_quasar','q1_first_soil','q1_first_harvest','q1_learn_fish','q1_debt_installment'].every((q) => p.quests.completed.includes(q)));

// ── ACT 2: the failing heart ──
console.log('== Act 2 — The Failing Heart ==');
room.onTalk(client, { npc: 'nova' });
check('talk-to-nova completes q2_meet_nova', p.quests.current === 'q2_mine_crystal');

// q2_mine_crystal: mine 3 broken veins (force single-swing veins for determinism)
p.equipped = 'pickaxe';   // mining needs the pickaxe in hand
let mined = 0;
while (mined < 3) {
  p.mineMax = 1; p.mineHp = 1; p.energy = 50;
  const r = room.onMine(client, {});
  if (r && r.broken) mined++;
}
check('mining 3 completes q2_mine_crystal', p.quests.current === 'q2_upgrade_tool');

// q2_upgrade_tool: upgrade to iron (need credits) → level-based
p.credits = 2000;
room.onUpgradeTool(client, {});
check('upgrading to iron completes q2_upgrade_tool (level-based)', p.quests.current === 'q2_cook_feast' && p.tool === 'iron');

// q2_cook_feast: cook 2 + gift cooked-food → complete
p.inventory.set('space-wheat', 10);
room.onCook(client, {});
room.onCook(client, {});
p.inventory.set('cooked-food', 1);
room.onGift(client, { npc: 'rhea', item: 'cooked-food' });
check('cook 2 + gift dish completes q2_cook_feast', p.quests.current === 'q2_bond');

// q2_bond: 2 villagers at bond >= 40 → level-based (gift loved items to 2)
p.inventory.set('tech-part', 10);
p.inventory.set('data-crystal', 10);
room.onGift(client, { npc: 'nova', item: 'tech-part' });     // +15 (loved)
room.onGift(client, { npc: 'astra', item: 'data-crystal' }); // +15 (loved)
room.onGift(client, { npc: 'nova', item: 'tech-part' });     // +15 → 30
room.onGift(client, { npc: 'astra', item: 'data-crystal' }); // +15 → 30
room.onGift(client, { npc: 'nova', item: 'tech-part' });     // +15 → 45
room.onGift(client, { npc: 'astra', item: 'data-crystal' }); // +15 → 45
check('two villagers at 40 bond completes q2_bond (level-based)', p.quests.current === 'q3_animal_farm');
check('act 2 fully done (5 quests)', ['q2_meet_nova','q2_mine_crystal','q2_upgrade_tool','q2_cook_feast','q2_bond'].every((q) => p.quests.completed.includes(q)));

// ── ACT 3: Earth Day ──
console.log('== Act 3 — Earth Day ==');
// q3_animal_farm: own 2 animals (level-based) + feed
p.credits = 5000;
room.onBuyAnimal(client, { species: 'chicken', quantity: 1 });
room.onBuyAnimal(client, { species: 'cow', quantity: 1 });
room.onFeedAnimal(client, { species: 'chicken' });
check('owning 2 + feed completes q3_animal_farm', p.quests.current === 'q3_festival_stock');

// q3_festival_stock: earn 300cr selling + catch 1 fish
p.inventory.set('void-diamond', (p.inventory.get('void-diamond') || 0) + 2);
room.onSell(client, { item: 'void-diamond', quantity: 2 });  // 250*2=500 >=300
p.equipped = 'rod';   // tool-gated casting again
room.onFish(client, { spot: 'stardust' });
check('sell 300 + fish completes q3_festival_stock', p.quests.current === 'q3_earth_feast');

// q3_earth_feast: cook 3 Earth Feast Plates ON FESTIVAL DAY (dish-gated)
// Gate A: cooking the plate on a NON-festival day must NOT advance.
p.inventory.set('space-wheat', 30); p.inventory.set('egg', 30); p.inventory.set('moon-melon', 30);
room.state.festival = false;
room.onCook(client, { recipe: 'earth-feast-plate' });   // refused: festival-only
room.onCook(client, { recipe: 'earth-feast-plate' });
room.onCook(client, { recipe: 'earth-feast-plate' });
const notAdvancedOffFestival = p.quests.current === 'q3_earth_feast';
// Gate B: generic / wrong-dish cooking on festival day must NOT advance.
room.state.festival = true;
room.onCook(client, {});                                  // generic cooked-food
room.onCook(client, { recipe: 'space-pudding' });         // a normal dish
room.onCook(client, { recipe: 'nebula-stew' });
const notAdvancedWrongDish = p.quests.current === 'q3_earth_feast';
// Now: 3 actual Earth Feast Plates on festival day → completes.
room.onCook(client, { recipe: 'earth-feast-plate' });
room.onCook(client, { recipe: 'earth-feast-plate' });
room.onCook(client, { recipe: 'earth-feast-plate' });
check('plate off-festival does NOT advance q3_earth_feast', notAdvancedOffFestival);
check('generic/wrong dish on festival day does NOT advance', notAdvancedWrongDish);
check('3 Earth Feast Plates on festival day complete q3_earth_feast', p.quests.current === 'q3_heart_of_stardust');

// q3_heart_of_stardust: mine 5 + attend festival + talk nova → complete
p.equipped = 'pickaxe';   // back to the pick for the final vein
let m2 = 0;
while (m2 < 5) {
  p.mineMax = 1; p.mineHp = 1; p.energy = 50;
  const r = room.onMine(client, {});
  if (r && r.broken) m2++;
}
room.state.festival = true;
room.onClaimFestival(client, {});   // festival objective
room.onTalk(client, { npc: 'nova' });
check('mine 5 + festival + talk-nova completes the arc', p.quests.arcDone === true);
check('final reward: 500cr + stardust-core item', p.credits >= 500 && (p.inventory.get('stardust-core') || 0) >= 1);
check('all 14 quests completed', p.quests.completed.length === 14);

// ── No-op after arc ──
console.log('== Post-arc ==');
const before = p.quests.completed.length;
room.onHarvest(client, { tileX: 0, tileY: 0 });
room.onSell(client, { item: 'space-wheat', quantity: 1 });
check('events after arcDone do not change completed count', p.quests.completed.length === before);

// ── Determinism: a fresh room yields a clean, reproducible start ──
const r2 = makeRoom();
check('fresh room always starts at q1_meet_quasar', r2.state.players.get('f').quests.current === 'q1_meet_quasar');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
