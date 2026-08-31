// verify_shop_ge_wire.mjs — live wire proof for the colony economy surfaces:
// the Supply Depot actually sells seeds (credits → item), refuses when you
// can't pay, and the sell paths (GE sell + ranch product sell through the
// same ledger) actually turn holdings into credits. This is the "no dead
// storefront" gate for the web experience.
import { Client } from '@colyseus/sdk';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const room = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'shop-wire-' + Math.random().toString(36).slice(2) });
  await sleep(400);
  const me = room.state.players.get(room.sessionId);
  ok('joined live room', !!me, 'no player');

  const pending = {};
  const awaitReply = t => new Promise(res => { pending[t] = res; });
  for (const t of ['buy', 'sell']) {
    room.onMessage(t, d => { if (pending[t]) { const r = pending[t]; pending[t] = null; r(d); } });
  }
  const request = (type, data) => { room.send(type, data); return awaitReply(type); };

  const credits0 = me.credits;
  const seeds0 = me.inventory.get('seeds') || 0;

  // 1. Depot sells seeds — credits go down, seeds go up, all server-side
  const b1 = await Promise.race([request('buy', { item: 'seeds', quantity: 1 }), sleep(2500).then(() => null)]);
  await sleep(150);   // let the authoritative state patch land before asserting
  ok('depot sells 1 seed', b1 && b1.ok === true && b1.item === 'seeds', JSON.stringify(b1));
  ok('seed purchase deducted 5 CR', b1 && b1.spent === 5 && b1.balance === credits0 - 5, JSON.stringify(b1));
  ok('player seeds grew server-side', (me.inventory.get('seeds') || 0) === seeds0 + 1, `have ${me.inventory.get('seeds')} want ${seeds0 + 1}`);

  // 2. Refusal path: asking for a quantity you can't afford fails cleanly
  const b2 = await Promise.race([request('buy', { item: 'stardust-crystal', quantity: 50 }), sleep(2500).then(() => null)]);
  ok('depot refuses unaffordable buy (no crash)', b2 && b2.ok === false && b2.reason === 'not-enough-credits', JSON.stringify(b2));

  // 3. Unknown shelf item is refused, not accepted
  const b3 = await Promise.race([request('buy', { item: 'stardust-cannon' }), sleep(2500).then(() => null)]);
  ok('depot refuses phantom shelf item', b3 && b3.ok === false && b3.reason === 'not-for-sale', JSON.stringify(b3));

  // 4. GE sell — a real owned item becomes credits via the same 'sell' ledger
  const sellCandidate = ['cooked-food', 'tech-part', 'stardust-crystal'].find(i => (me.inventory.get(i) || 0) > 0) || 'space-wheat';
  const have = me.inventory.get(sellCandidate) || 0;
  const creditsBefore = me.credits;
  const s1 = await Promise.race([request('sell', { item: sellCandidate, quantity: 1 }), sleep(2500).then(() => null)]);
  await sleep(150);   // let the authoritative state patch land before asserting
  ok('exchange sells an owned item', s1 && s1.ok === true && s1.item === sellCandidate, JSON.stringify(s1));
  ok('sell moved credits up', s1 && s1.balance > creditsBefore, `balance ${s1 && s1.balance} > ${creditsBefore}`);
  ok('player inventory decremented server-side', (me.inventory.get(sellCandidate) || 0) === have - 1, `have ${me.inventory.get(sellCandidate)} want ${have - 1}`);

  // 5. Selling something you don't hold refuses cleanly
  const s2 = await Promise.race([request('sell', { item: 'void-diamond', quantity: 1 }), sleep(2500).then(() => null)]);
  ok('exchange refuses phantom holdings', s2 && s2.ok === false && s2.reason === 'need-item', JSON.stringify(s2));

  await room.leave();
  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('SHOP/GE WIRE FAILED:', e); process.exit(1); });
