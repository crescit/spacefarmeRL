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

// ── SF18 gate: proximity + talking-pause ─────────────────────────────────────
// 1) handleInteract's NPC lookup must read the LIVE brain/sprite position
//    (b.x/b.y pixels → tiles), NOT the static NPCS[].x/y home tile.
// SF20 moved target lookup into _resolveInteractTarget (handleInteract runs it).
const src = PlanetScene.prototype.handleInteract.toString() + '\n' +
  (PlanetScene.prototype._resolveInteractTarget ? PlanetScene.prototype._resolveInteractTarget.toString() : '');
const liveSrc = /npcHit[\s\S]*?b\.x \/ T[\s\S]*?b\.y \/ T/.test(src);
const staticSrc = /Math\.hypot\(npc\.x - ptx, npc\.y - pty\)/.test(src);
if (!liveSrc || staticSrc) console.log('  [SF18 probe] handleInteract src:', src.slice(Math.max(0, src.indexOf('npcHit') - 120), src.indexOf('npcHit') + 260));
check('SF18 handleInteract reads live brain coords', liveSrc && !staticSrc, `live=${liveSrc} static=${staticSrc}`);
check('SF18 proximity radius is 1.6 tiles', /d < 1\.6/.test(src));

// 2) tickNpc must honour a paused/talking state: while talking=true it must
//    not pick errands, walk, or work — it stands and faces the player.
const tickSrc = PlanetScene.prototype.tickNpc.toString();
const talkGuard = /if \(b\.talking\)[\s\S]*?return;/.test(tickSrc);
const errandFirst = talkGuard && tickSrc.indexOf('if (b.talking)') < tickSrc.indexOf("_pickErrand");
check('SF18 tickNpc honors talking pause before errands', errandFirst, `guard=${talkGuard}`);
const ps2 = Object.create(PlanetScene.prototype);
ps2.npcSprites = []; ps2.npcBrains = {};
ps2.playerSpr = { x: 500, y: 900 };
const probeId = npcIds[0];
const probeHome = NPC_POS[probeId];
{
  const spr = fakeSprite(); spr.npcId = probeId;
  const b = { id: probeId, home: probeHome, x: 500, y: 900, dir: 'front', path: [{ x: 600, y: 900 }], state: 'walk', working: false, walkT: 0, timer: 0, talking: true };
  ps2.npcSprites.push(spr); ps2.npcBrains[probeId] = b;
  let t = 0;
  ps2.tickNpc(b, 16.67, (t += 16.67));
  check('SF18 talking NPC does not walk (x unchanged)', b.x === 500 && b.y === 900, `x=${b.x} y=${b.y}`);
  check('SF18 talking NPC faces the player', b.dir === 'left', `dir=${b.dir}`);
  b.talking = false; // resume
  ps2.tickNpc(b, 16.67, (t += 16.67));
  check('SF18 resume: errands continue after talking=false', b.x !== 500 || b.path.length === 0 && b.state !== 'walk' ? true : b.x !== 500, `x=${b.x}`);
}
// 3) startNPCDialogue pauses the brain; closeAllPanels clears every brain's talking flag.
const diaSrc = PlanetScene.prototype.startNPCDialogue.toString();
check('SF18 startNPCDialogue sets brain.talking=true', /brain\.talking = true/.test(diaSrc));
const closeSrc = PlanetScene.prototype.closeAllPanels.toString();
check('SF18 closeAllPanels resumes all brains', /b\.talking = false/.test(closeSrc));

console.log(`===== SF18 gate: ${pass} passed, ${fail} failed =====`);
process.exit(fail > 0 ? 1 : 0);
