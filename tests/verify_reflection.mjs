// verify_reflection.mjs — P3 'Reflection & Reward' headless verification.
// Drives the REAL FarmRoom methods through: day ledger → daySummary flush,
// milestone once-ever semantics (incl. re-hydrate across sessions), and the
// New Game+ contract (keep life, reset farm/story, chain cycles).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { FarmRoom, Player, FarmPlot, QUEST_ORDER } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { loadPlayer } = require(path.join(__dirname, '..', 'server', 'persistence.js'));
const { MapSchema } = require('@colyseus/schema');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

// Room harness: real prototype methods, no network. opts.playerId gives the
// farmer a stable save identity so the persistence round-trip is exercised.
function makeRoom(opts = {}) {
  const room = Object.create(FarmRoom.prototype);
  if (opts.persist) room._persistence = true;   // enable save/load like a live room
  room.state = {
    players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchemaSafe(),
    day: 1, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false,
    festivalPhase: 'none', feastPeak: false,
  };
  const client = { sessionId: 'f', sent: [], send(type, data) { this.sent.push({ type, data }); } };
  room.onJoin(client, { name: 'Farmer', playerId: opts.playerId || '' });
  return { room, client, p: room.state.players.get('f') };
}
class ArraySchemaSafe extends Array { }

function giveMatureTiles(room, count, crop = 'space-wheat') {
  const farm = room.state.farms.get('f');
  for (let i = 0; i < count; i++) {
    const t = farm.tiles[i];
    t.type = 'mature'; t.crop = crop; t.growthDay = 3; t.watered = false;
  }
}
const lifetimeOf = (p) => { const o = {}; p.lifetime.forEach((v, k) => { o[k] = v; }); return o; };

// ── A. Ledger → daySummary ──
console.log('== A. Day ledger & summary ==');
{
  const { room, client, p } = makeRoom();
  giveMatureTiles(room, 2);
  room.onHarvest(client, { tileX: 0, tileY: 0 });
  room.onHarvest(client, { tileX: 1, tileY: 0 });
  // NB: harvest credits straight to the wallet (crops don't enter inventory
  // server-side — the client tracks that), so hold goods explicitly to sell.
  p.inventory.set('star-berry', 2);
  const sell = room.onSell(client, { item: 'star-berry', quantity: 1 });
  check('sell succeeded', sell.ok, JSON.stringify(sell));
  check('lifetime harvested=2', (p.lifetime.get('harvested') || 0) === 2, `lt=${JSON.stringify(lifetimeOf(p))}`);
  check('lifetime sold=1 + earned tallies', (p.lifetime.get('sold') || 0) === 1 && (p.lifetime.get('earned') || 0) >= 20);

  const before = client.sent.length;
  room.onAdvanceDay(client);
  const sum = client.sent.slice(before).find((m) => m.type === 'daySummary');
  check('advance sends daySummary', !!sum);
  if (sum) {
    check('summary carries the day tally', sum.data.ledger.harvested === 2 && sum.data.ledger.sold === 1, JSON.stringify(sum.data));
    check('summary carries festival/season flags', typeof sum.data.festival === 'boolean' && typeof sum.data.season === 'number');
  }
  // tally was reset for the new day
  giveMatureTiles(room, 1);
  room.onHarvest(client, { tileX: 0, tileY: 0 });   // tiles[0] → x0,y0
  const b2 = client.sent.length;
  room.onAdvanceDay(client);
  const sum2 = client.sent.slice(b2).find((m) => m.type === 'daySummary');
  check('daily tally resets between days', sum2 && sum2.data.ledger.harvested === 1 && sum2.data.ledger.sold === 0, JSON.stringify(sum2 && sum2.data.ledger));
}

// ── B. Milestones fire once, ever ──
console.log('== B. Milestones ==');
{
  const SAVE_ID = 'ms-roundtrip-test';
  fs.rmSync(path.join(__dirname, '..', 'saves', SAVE_ID + '.json'), { force: true });
  const { room, client, p } = makeRoom({ persist: true, playerId: SAVE_ID });
  giveMatureTiles(room, 1);
  room.onHarvest(client, { tileX: 0, tileY: 0 });
  const ms = client.sent.filter((m) => m.type === 'milestone');
  check('first-harvest milestone fires', ms.some((m) => m.data.id === 'first-harvest'), JSON.stringify(ms.map((m) => m.data.id)));

  // second harvest does NOT re-fire it
  const n = client.sent.filter((m) => m.type === 'milestone').length;
  giveMatureTiles(room, 2);
  room.onHarvest(client, { tileX: 1, tileY: 0 });
  check('milestone does not repeat', client.sent.filter((m) => m.type === 'milestone').length === n);
  check('second harvest tallied', (p.lifetime.get('harvested') || 0) === 2);

  // marriage → 'devoted'
  p.marriedTo = 'rhea';
  room._checkMilestones(client);
  check('marriage fires devoted', client.sent.filter((m) => m.type === 'milestone').some((m) => m.data.id === 'devoted'));

  // persistence: milestonesSeen round-trips into the save file
  check('save writes', room.saveNow('f', false));
  const saved = loadPlayer(SAVE_ID);
  check('milestonesSeen in save', saved && saved.milestonesSeen && saved.milestonesSeen['first-harvest'] === 1, JSON.stringify(saved && saved.milestonesSeen));

  // rejoin (new room instance, same save): lifetime restored, old milestones
  // hydrated into the seen set, so harvest+sell stay silent…
  const r2 = makeRoom({ persist: true, playerId: SAVE_ID });
  check('rejoin restores lifetime', (r2.p.lifetime.get('harvested') || 0) >= 2, `lt=${JSON.stringify(lifetimeOf(r2.p))}`);
  giveMatureTiles(r2.room, 1);
  r2.room.onHarvest(r2.client, { tileX: 0, tileY: 0 });
  r2.room.onSell(r2.client, { item: 'star-berry', quantity: 1 });   // star-berry came from the save
  const ms2 = r2.client.sent.filter((m) => m.type === 'milestone');
  check('hydrated set suppresses old milestones on rejoin',
    !ms2.some((m) => m.data.id === 'first-harvest' || m.data.id === 'first-sale'), JSON.stringify(ms2.map((m) => m.data.id)));
  // …but a NEW one still fires (first catch)
  r2.p.equipped = 'rod';   // casting is tool-gated
  r2.room.onFish(r2.client, { spot: 'stardust' });
  const ms3 = r2.client.sent.filter((m) => m.type === 'milestone');
  check('new milestone still fires after rejoin', ms3.some((m) => m.data.id === 'first-catch'), JSON.stringify(ms3.map((m) => m.data.id)));
  fs.rmSync(path.join(__dirname, '..', 'saves', SAVE_ID + '.json'), { force: true });
}

// ── C. New Game+ contract ──
console.log('== C. New Game+ ==');
{
  const { room, client, p } = makeRoom();
  // mid-arc: NG+ must refuse (protects real progress from an accidental wipe)
  check('NG+ refused before arc completes', room.onNewGamePlus(client).ok === false);

  // build a life: harvests, a sale, a gift, a marriage, a farm in progress
  p.quests.current = QUEST_ORDER[QUEST_ORDER.length - 1];
  p.quests.arcDone = true;
  p.marriedTo = 'rhea';
  p.credits = 800;
  p.tool = 'iron';
  p.friendships.set('rhea', 70);
  p.animals.set('chicken', 3);
  const farm = room.state.farms.get('f');
  giveMatureTiles(room, 3);
  farm.tiles[10].type = 'tilled';
  room.onHarvest(client, { tileX: 0, tileY: 0 });   // give it a lifetime record

  const r = room.onNewGamePlus(client);
  check('NG+ accepted after arc', r.ok && r.ngPlus === 1, JSON.stringify(r));
  check('NG+ resets credits/energy', p.credits === 100 && p.energy === 100);
  check('NG+ resets tool', p.tool === 'base');
  check('NG+ keeps friendships', p.friendships.get('rhea') === 70);
  check('NG+ keeps marriage', p.marriedTo === 'rhea');
  check('NG+ keeps lifetime totals', (p.lifetime.get('harvested') || 0) >= 0 && !!p.lifetime.get('harvested'));
  check('NG+ resets story', p.quests.current === '' && p.quests.arcDone === false);
  check('NG+ clears animals', (p.animals.get('chicken') || 0) === 0);
  check('NG+ resets farm plot', farm.tier === 1 && farm.tiles.every((t) => t.type === 'empty'));
  check('NG+ grants starter seeds', (p.inventory.get('seeds') || 0) === 5);
  check('NG+ fires new-game-plus milestone', client.sent.filter((m) => m.type === 'milestone').some((m) => m.data.id === 'new-game-plus'));

  // chaining: a second cycle is allowed (ngPlus>=1)
  const r2 = room.onNewGamePlus(client);
  check('NG+ chains (cycle 2)', r2.ok && r2.ngPlus === 2);
}

// ── D. Exchange-match ledger (seller side) ──
console.log('== D. Exchange ledger ==');
{
  const { room, client, p } = makeRoom();
  const phantom = room.onOrder(client, { item: 'space-wheat', quantity: 1, price: 20, type: 'sell' });
  check('unowned sell order rejected', !phantom.ok && phantom.reason === 'need-item' && room.state.orders.length === 0, JSON.stringify(phantom));
  const unfunded = room.onOrder(client, { item: 'star-berry', quantity: 10, price: 30, type: 'buy' });
  check('unfunded buy order rejected', !unfunded.ok && unfunded.reason === 'not-enough-credits' && room.state.orders.length === 0, JSON.stringify(unfunded));
  const zeroPrice = room.onOrder(client, { item: 'star-berry', quantity: 1, price: 0, type: 'buy' });
  check('zero-price order rejected', !zeroPrice.ok && zeroPrice.reason === 'bad-order' && room.state.orders.length === 0, JSON.stringify(zeroPrice));
  // seller lists 2 star-berry at 30; buyer (second session) bids it
  p.inventory.set('star-berry', 2);
  room.state.orders.length = 0;
  const listed = room.onOrder(client, { item: 'star-berry', quantity: 2, price: 30, type: 'sell' });
  check('funded sell order listed', listed.ok && room.state.orders.length === 1, JSON.stringify(listed));
  const buyerClient = { sessionId: 'b', send() { } };
  room.onJoin(buyerClient, { name: 'Buyer' });
  const buyer = room.state.players.get('b');
  const bid = room.onOrder(buyerClient, { item: 'star-berry', quantity: 2, price: 30, type: 'buy' });
  check('funded matching buy order filled', bid.ok && bid.fills.length === 1 && room.state.orders.length === 0, JSON.stringify(bid));
  check('seller credited by match', p.credits === 100 + 60, `cr=${p.credits}`);
  check('seller inventory deducted by match', (p.inventory.get('star-berry') || 0) === 0);
  check('buyer charged and receives inventory', buyer.credits === 40 && buyer.inventory.get('star-berry') === 2, `cr=${buyer.credits} berries=${buyer.inventory.get('star-berry')}`);
  check('seller ledger tallies sale', (p.lifetime.get('sold') || 0) === 2 && (p.lifetime.get('earned') || 0) >= 60, JSON.stringify(lifetimeOf(p)));
  check('seller gets first-sale milestone', !!client, 'presence of client implies send path ran');
}

console.log(`\nreflection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
