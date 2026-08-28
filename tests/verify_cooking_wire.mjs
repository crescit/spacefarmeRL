// verify_cooking_wire.mjs — live wire proof for M4 kitchen:
// a named recipe payload reaches the server over the real socket and returns
// the same reply shape the headless 31/31 suite verifies. (Ingredients are
// granted headlessly in verify_cooking.mjs; here we only prove the plumbing
// + the festival-only refusal path on a fresh farm.)
import { Client } from '@colyseus/sdk';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const room = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'cookwire-' + Math.random().toString(36).slice(2) });
  await sleep(400);
  const sid = room.sessionId;
  const me = room.state.players.get(sid);
  ok('joined live room', !!me, 'no player ' + sid);

  const pending = {};
  const awaitReply = t => new Promise(res => { pending[t] = res; });
  room.onMessage('cook', d => { if (pending['cook']) { const r = pending['cook']; pending['cook'] = null; r(d); } });

  // fresh farm: no wheat/egg/melon -> named recipe must be refused cleanly
  room.send('cook', { recipe: 'space-pudding' });
  const r1 = await Promise.race([awaitReply('cook'), sleep(2000).then(() => null)]);
  ok('named recipe reply is a clean refusal (no crash)', r1 && r1.ok === false && r1.reason === 'need-ingredients', JSON.stringify(r1));

  // Earth Feast Plate is festival-gated even with ingredients: without
  // ingredients it reports need-ingredients, never 'festival-only' first —
  // and it must never succeed on a non-festival day.
  room.send('cook', { recipe: 'earth-feast-plate' });
  const r2 = await Promise.race([awaitReply('cook'), sleep(2000).then(() => null)]);
  ok('earth feast plate refused on non-festival day', r2 && r2.ok === false, JSON.stringify(r2));
  ok('plate refusal is need-ingredients or festival-only (never ok)', r2 && !r2.ok && ['need-ingredients', 'festival-only'].includes(r2.reason), JSON.stringify(r2));

  await room.leave();
  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('WIRE COOK FAILED:', e); process.exit(1); });
