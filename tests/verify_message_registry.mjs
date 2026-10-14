// verify_message_registry.mjs — ROADMAP A4 gate: every message type the server
// room emits (literal client.send / broadcast payloads AND the reply:true
// rows in FarmRoom.GAME_ACTIONS) must have a matching room.onMessage('type')
// registered in the browser client (NetworkSystem.js). Otherwise @colyseus/sdk
// spams "onMessage() not registered for type 'X'" on every gameplay reply —
// quiet in live play, noisy in tests. Fails loudly listing the missing types.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const farmPath = path.join(root, 'server', 'rooms', 'FarmRoom.js');
const netPath = path.join(root, 'client', 'systems', 'NetworkSystem.js');
const farm = readFileSync(farmPath, 'utf8');
// SF_NS_OVERRIDE lets the gate be pointed at any NetworkSystem snapshot
// (e.g. `git show HEAD:client/systems/NetworkSystem.js > /tmp/ns_head.js`)
// so the gate can be proven to FAIL against unpatched code.
const net = readFileSync(process.env.SF_NS_OVERRIDE || netPath, 'utf8');

const literalTypes = new Set();
for (const m of farm.matchAll(/(\.send|\.broadcast|_broadcast)\(\s*(['"])([a-zA-Z0-9_-]+)\2/g)) {
  literalTypes.add(m[3]);
}
// Reply:true GAME_ACTIONS rows are server-emitted (dispatchGameAction sends
// the handler result back to the same client on the same channel).
const actionBlock = farm.match(/const GAME_ACTIONS = Object.freeze\(\[[\s\S]*?\n\]\);/);
const replyTypes = new Set();
if (actionBlock) {
  for (const entry of actionBlock[0].match(/\{[^{}]*\}/g) || []) {
    const t = entry.match(/type:\s*['"]([a-zA-Z0-9_-]+)['"]/);
    if (t && /reply:\s*true/.test(entry)) replyTypes.add(t[1]);
  }
}
const serverTypes = [...new Set([...literalTypes, ...replyTypes])].sort();

// onMessage('x') registrations in the client. The '*' catch-all is NOT a type
// registration — it silences unknown types but does not satisfy this gate.
const clientTypes = new Set();
for (const m of net.matchAll(/\bonMessage\(\s*['"]([a-zA-Z0-9_-]+)['"]/g)) {
  clientTypes.add(m[1]);
}

const missing = serverTypes.filter((t) => !clientTypes.has(t));
// Fire-and-forget GAME_ACTIONS rows never get a reply today, but a client may
// still register a handler for them (harmless future-proofing) — allowed.
const allActionTypes = new Set();
if (actionBlock) {
  for (const entry of actionBlock[0].match(/\{[^{}]*\}/g) || []) {
    const t = entry.match(/type:\s*['"]([a-zA-Z0-9_-]+)['"]/);
    if (t) allActionTypes.add(t[1]);
  }
}
const extra = [...clientTypes].filter((t) => !serverTypes.includes(t) && !allActionTypes.has(t));

console.log('  — SF34 message registry gate —');
console.log(`  server emits ${serverTypes.length} types: ${serverTypes.join(', ')}`);
console.log(`  client registers ${clientTypes.size} handlers`);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };

ok('FarmRoom parse found literal send/broadcast types', literalTypes.size >= 5,
  literalTypes.size ? `${literalTypes.size}: ${[...literalTypes].join(', ')}` : 'no literals parsed');
ok('FarmRoom GAME_ACTIONS reply:true types parsed', replyTypes.size >= 10,
  replyTypes.size ? `${replyTypes.size}: ${[...replyTypes].join(', ')}` : 'no GAME_ACTIONS parsed');
ok('every server-emitted type is registered on the client',
  missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
ok('client registers a wildcard catch-all', /\bonMessage\(\s*'[\*]'\s*,/.test(net),
  'no onMessage(\'*\') fallback');
ok('no stray client handler for a type the server never emits', extra.length === 0,
  extra.length ? `stray: ${extra.join(', ')}` : '');

console.log(`  ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
