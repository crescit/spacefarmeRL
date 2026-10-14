// verify_night_wire.mjs — live wire proof for the server-authoritative colony
// clock: a fresh world starts at dawn, meaningful actions spend the day's
// light until night falls (isDay flips false deterministically), resting
// resets to a fresh dawn, and night fishing (night:true) actually bites while
// the world is dark. This is the "the sun sets and the lamps breathe" gate.
import { Client } from '@colyseus/sdk';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── SF08 static night-light gate: the scene's day/night wiring must be
// readable straight from the source before the live wire is checked —
// (1) night overlay alpha ≥ 0.6, (2) every lamp gets ≥ 3 concentric ADD-blend
// pool discs, (3) pools hidden by day (updateNightVisuals drives visibility).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const SCENE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'scenes', 'PlanetScene.js');

function checkNightScene() {
  const src = readFileSync(SCENE, 'utf8');
  console.log('  — SF08 static night-light gate —');
  // 1: night overlay alpha ≥ 0.6
  // (SF32 tweens the overlay to `toNight`; older builds set it directly)
  const alpha = src.match(/toNight = this\.isNight \? ([\d.]+) : 0/)
    || src.match(/nightOverlay\.setAlpha\(this\.isNight \? ([\d.]+) : 0\)/);
  ok('night overlay alpha ≥ 0.6', !!alpha && Number(alpha[1]) >= 0.6, alpha ? `alpha=${alpha[1]}` : 'no night overlay alpha line');
  // deeper blue tint (e.g. 0x0e1838) on the overlay rectangle
  const tint = src.match(/nightOverlay = this\.add\.rectangle\([^;]*, 0x([0-9a-fA-F]{6}), 0\)/);
  ok('night overlay uses a deeper blue tint', !!tint && tint[1] !== '142048', tint ? `0x${tint[1]}` : 'no rectangle tint');
  // 2: every lamp gets ≥ 3 concentric ADD-blend amber pool discs
  const rings = src.match(/const POOL_RINGS = \[[\s\S]*?\n\];/);
  ok('POOL_RINGS table defines ≥ 3 concentric rings', !!rings && (rings[0].match(/\{ scale:/g) || []).length >= 3,
    rings ? `${(rings[0].match(/\{ scale:/g) || []).length} rings` : 'no POOL_RINGS table');
  ok('pool discs are amber (0xffbe5a) + ADD blend', src.includes('setTint(0xffbe5a)')
    && (src.match(/\.setBlendMode\(Phaser\.BlendModes\.ADD\)/g) || []).length >= 4);
  // the rings loop is inside the lamp branch (guarded by decor.lamp key)
  // (no fixed char window: the loop just has to come before the next decKey branch)
  const lampStart = src.indexOf("if (decKey === resolveKey('decor.lamp'))");
  const ringLoop = lampStart < 0 ? -1 : src.indexOf('for (const ring of POOL_RINGS)', lampStart);
  const nextBranch = lampStart < 0 ? -1 : src.indexOf('if (decKey', lampStart + 1);
  ok('every lamp branch creates 3 pool discs', ringLoop > 0 && (nextBranch < 0 || ringLoop < nextBranch));
  // 3: pools hidden by day — the shared registry toggles with isNight
  // 3: pools hidden by day — the shared registry toggles with isNight.
  // Simple line-level check, not a fragile distance regex.
  ok('light pools hidden by day (visible=setAlpha driven by isNight)',
    /for \(const p of this\.lightPools\)/.test(src)
    && /p\.img\.setVisible\(this\.isNight\)/.test(src)
    && /p\.img\.setAlpha\(this\.isNight \? p\.base : 0\)/.test(src));
}

checkNightScene();

async function main() {
  const room = await new Client('http://localhost:8900').joinOrCreate('farm', { name: 'night-wire-' + Math.random().toString(36).slice(2) });
  // Raw client: no-op catch-all so server replies (sell results, milestone
  // toasts) never warn "onMessage() not registered".
  room.onMessage('*', () => {});
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
