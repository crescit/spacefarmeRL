// verify_night_wire.mjs — live wire proof for the server-authoritative colony
// clock: a fresh world starts at dawn, meaningful actions spend the day's
// light until night falls (isDay flips false deterministically), resting
// resets to a fresh dawn, and night fishing (night:true) actually bites while
// the world is dark. This is the "the sun sets and the lamps breathe" gate.
import { Client } from '@colyseus/sdk';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const room = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'night-wire-' + Math.random().toString(36).slice(2) });
  await sleep(500);
  const st = () => ({ isDay: room.state.isDay, time: room.state.time });
  ok('fresh world starts at dawn', st().isDay === true, JSON.stringify(st()));

  // 18 sell-attempts (each a meaningful action) threshold: 18 * 22 = 396 < 520
  for (let i = 0; i < 18; i++) room.send('sell', { item: 'void-diamond', quantity: 1 });
  await sleep(500);
  ok('daylight holds after a light morning', st().isDay === true, JSON.stringify(st()));

  // reach the dusk threshold: 24 total ticks * 22 = 528 >= 520 → night falls
  for (let i = 0; i < 7; i++) room.send('sell', { item: 'void-diamond', quantity: 1 });
  await sleep(500);
  ok('night falls after a long day (isDay false)', st().isDay === false, JSON.stringify(st()));

  // night fishing actually bites while the world is dark (moonfish is any-time
  // in spring; the point is the night gate lets the pool open at all).
  // Casting is tool-gated: equip the FISHING ROD first (the same equip message
  // the backpack panel sends).
  const pending = {};
  room.onMessage('equip', d => { if (pending.e) { const r = pending.e; pending.e = null; r(d); } });
  room.send('equip', { tool: 'rod' });
  await Promise.race([new Promise(res => { pending.e = res; }), sleep(2500).then(() => null)]);
  room.onMessage('fish', d => { if (pending.f) { const r = pending.f; pending.f = null; r(d); } });
  room.send('fish', { spot: 'stardust', night: true });
  const caught = await Promise.race([new Promise(res => { pending.f = res; }), sleep(2500).then(() => null)]);
  ok('night fishing bites after dark', caught && caught.ok === true && !!caught.item, JSON.stringify(caught));

  // resting through the night resets to a fresh dawn
  room.send('advance');
  await sleep(500);
  ok('rest resets to a fresh dawn (isDay true)', st().isDay === true && st().time === 0, JSON.stringify(st()));

  await room.leave();
  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('NIGHT WIRE FAILED:', e); process.exit(1); });
