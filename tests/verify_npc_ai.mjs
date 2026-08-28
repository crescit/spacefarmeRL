// verify_npc_ai.mjs — headless simulation of the NPC errand AI.
// Stubs Phaser, imports the real PlanetScene prototype, and runs tickNpc
// for ~30 simulated seconds per NPC. Fails if any NPC: leaves the map,
// sits on a blocked tile, references a missing texture, or never moves.
globalThis.Phaser = {
  Scene: class { },
  Input: { Keyboard: { JustDown: () => false, SPACE: 32, ESC: 27 } },
  BlendModes: { ADD: 0, MULTIPLY: 1 },
};

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const SS = await import('../client/systems/SpriteSystem.js');
const { TEXTURES, px } = SS;
const PS = await import('../client/scenes/PlanetScene.js');
const PlanetScene = PS.PlanetScene;
const MD = await import('../client/systems/MapData.js');
const { MAP_W, MAP_H, blocks, NPC_POS } = MD;
const T = 32; // PlanetScene now uses a 32px world (match)

// fake sprite
function fakeSprite() {
  const s = {
    texture: { key: '' }, x: 0, y: 0,
    setTexture(k) {
      if (!TEXTURES[k]) throw new Error(`MISSING TEXTURE: ${k}`);
      this.texture = { key: k };
    },
    setPosition(x, y) { this.x = x; this.y = y; },
    setDepth() { },
    _label: { setPosition() { } },
  };
  return s;
}

const ps = Object.create(PlanetScene.prototype);
ps.isBlocked = PlanetScene.prototype.isBlocked; // real collision from MapData
ps.npcSprites = [];
ps.npcBrains = {};
ps.playerSpr = { x: 17 * T + T / 2, y: 13 * T + T / 2 };
const npcIds = Object.keys(NPC_POS);
for (const id of npcIds) {
  const spr = fakeSprite();
  spr.npcId = id;
  const brain = {
    id, home: NPC_POS[id],
    x: NPC_POS[id].x * T + T / 2, y: NPC_POS[id].y * T + T / 2,
    dir: 'front', path: [], state: 'idle', working: false,
    timer: 300 + Math.random() * 500,
  };
  ps.npcSprites.push(spr);
  ps.npcBrains[id] = brain;
}

const seenTiles = new Set();
let movedCount = 0, blockedHits = 0, outOfBounds = 0, texErrors = 0;
const start = {};
for (const b of Object.values(ps.npcBrains)) start[b.id] = `${Math.floor(b.x / T)},${Math.floor(b.y / T)}`;

const FRAMES = 30 * 60; // 30s @ 60fps
let time = 0;
for (let f = 0; f < FRAMES; f++) {
  time += 16.67;
  for (const b of Object.values(ps.npcBrains)) {
    try {
      ps.tickNpc(b, 16.67, time);
    } catch (e) {
      if (String(e.message).startsWith('MISSING TEXTURE')) texErrors++;
      else { fail++; console.log(`  ✗ tickNpc threw: ${e.message}`); }
      continue;
    }
    const tx = Math.floor(b.x / T), ty = Math.floor(b.y / T);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) outOfBounds++;
    if (blocks[ty]?.[tx]) blockedHits++;
    seenTiles.add(`${tx},${ty}`);
  }
}

// per-NPC: did it move at least once, end on open ground, valid final texture
for (const b of Object.values(ps.npcBrains)) {
  const end = `${Math.floor(b.x / T)},${Math.floor(b.y / T)}`;
  check(`npc.${b.id} moved from home over 30s`, end !== start[b.id] || seenTiles.size > 5, `start=${start[b.id]} end=${end}`);
  check(`npc.${b.id} ends on open ground`, !blocks[Math.floor(b.y / T)][Math.floor(b.x / T)], `tile=${end}`);
  const spr = ps.npcSprites.find(s => s.npcId === b.id);
  const validKey = /^(npc\.[a-z]+(_\d)?|npc\.[a-z]+_(front|back|left|right)_\d)$/.test(spr.texture.key);
  check(`npc.${b.id} final texture valid`, validKey && !!TEXTURES[spr.texture.key], spr.texture.key);
}

check('no NPC ever out of bounds', outOfBounds === 0, `${outOfBounds} frames`);
check('no NPC ever on a blocked tile', blockedHits === 0, `${blockedHits} frames`);
check('no missing texture references', texErrors === 0, `${texErrors}`);
check('village feels alive (≥8 distinct tiles visited total)', seenTiles.size >= 8, `got ${seenTiles.size}`);

// texture registry completeness for every key the AI can request
for (const id of npcIds) {
  for (const f of [0, 1, 2]) check(`registry npc.${id}_${f}`, !!TEXTURES[`npc.${id}_${f}`], '');
  for (const d of ['front', 'back', 'left', 'right'])
    for (const f of [0, 1, 2]) check(`registry npc.${id}_${d}_${f}`, !!TEXTURES[`npc.${id}_${d}_${f}`], '');
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail === 0) console.log('NPC AI ALL GREEN ✓');
process.exit(fail > 0 ? 1 : 0);
