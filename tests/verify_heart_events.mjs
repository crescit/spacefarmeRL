// verify_heart_events.mjs — ROADMAP A3 'heart-event dialogue deepen' gate.
// Guards the per-threshold heart cutscenes added to shared/story/npcs.js:
//   1. EVERY NPC authors heartByThreshold for ALL five server thresholds
//      (20/40/60/80/100), 2 lines each, ≤110 chars, and no line repeats
//      across thresholds — or anywhere else in the file's heart content
//      (heartByThreshold + fallback dialogue.heart of every NPC).
//   2. Any NPC WITHOUT heartByThreshold still has the fallback dialogue.heart.
//   3. PlanetScene's heart path actually reads heartByThreshold with a .heart
//      fallback (otherwise the client would replay the same cutscene at every
//      threshold and the bank would be dead weight).
// Set SF48_OLD=1 to point the checks at /tmp/sf48_old_npcs.js (HEAD copy) —
// used to prove the gate FAILS against the pre-patch code.
globalThis.Phaser = {
  Scene: class { },
  Input: { Keyboard: { JustDown: () => false, SPACE: 32, ESC: 27 } },
  BlendModes: { ADD: 0, MULTIPLY: 1 },
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = process.env.SF48_OLD === '1';
const npcRel = OLD ? '/tmp/sf48_old_npcs.js' : 'shared/story/npcs.js';
const sceneRel = 'client/scenes/PlanetScene.js';

const requireCjs = createRequire(import.meta.url);
const npcAbs = npcRel.startsWith('/') ? npcRel : path.join(root, npcRel);
const NPC_DATA = requireCjs(npcAbs).npcs || requireCjs(npcAbs);

const DEEP = Object.keys(NPC_DATA).filter(id => NPC_DATA[id] && NPC_DATA[id].dialogue);
const THRESHOLDS = [20, 40, 60, 80, 100];
const MAX_LEN = 110;
const GLOBAL_HEART_SEEN = new Set(); // every heart line anywhere in the bank

// ── 1. Per-threshold dialogue deepening ──
for (const id of DEEP) {
  const npc = NPC_DATA[id];
  const hbt = npc && npc.dialogue && npc.dialogue.heartByThreshold;
  const seen = new Set();
  for (const th of THRESHOLDS) {
    const lines = hbt && hbt[String(th)];
    check(`${id} heartByThreshold[${th}] exists`, !!lines, '(missing threshold)');
    if (!lines) continue;
    check(`${id} heartByThreshold[${th}] has 2 lines`, Array.isArray(lines) && lines.length === 2, `(${lines.length} lines)`);
    check(`${id} heartByThreshold[${th}] lines ≤${MAX_LEN}`,
      Array.isArray(lines) && lines.every(l => typeof l === 'string' && l.length <= MAX_LEN),
      `(${lines.map(l => l.length).join('/')})`);
    for (const l of lines) {
      check(`${id} line not repeated anywhere in heart content: "${l.slice(0, 34)}…"`,
        !seen.has(l) && !GLOBAL_HEART_SEEN.has(l));
      seen.add(l);
      GLOBAL_HEART_SEEN.add(l);
    }
  }
  // ── 2. Fallback `heart` stays available ──
  const heart = npc && npc.dialogue && npc.dialogue.heart;
  check(`${id} keeps dialogue.heart fallback`, Array.isArray(heart) && heart.length >= 1, '(missing)');
  for (const l of heart || []) {
    check(`${id} fallback heart line not repeated anywhere: "${l.slice(0, 34)}…"`,
      !GLOBAL_HEART_SEEN.has(l));
    GLOBAL_HEART_SEEN.add(l);
  }
}

// ── 3. PlanetScene heart path reads heartByThreshold with .heart fallback ──
const scene = readFileSync(sceneRel.startsWith('/') ? sceneRel : path.join(root, sceneRel), 'utf8');
const usesHbt = /data\.dialogue\?\.heartByThreshold\?\.\[threshold\]/.test(scene);
const usesFallback = /heartByThreshold\?\.\[threshold\][\s\S]*?data\.dialogue\?\.heart/.test(scene);
check('PlanetScene reads heartByThreshold per threshold', usesHbt,
  '(showHeartEvent still uses the single heart array only)');
check('PlanetScene falls back to dialogue.heart', usesFallback,
  '(no fallback for NPCs without heartByThreshold)');

console.log(fail === 0
  ? `\n  ✓ ${pass} checks — heart events deepen per threshold`
  : `\n  ✗ ${fail}/${pass + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
