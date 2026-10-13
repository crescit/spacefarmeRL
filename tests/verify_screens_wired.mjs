// verify_screens_wired.mjs — makes sure every screen is properly WIRED:
// the same single-sourced building/interior/player textures exist, every
// BUILDING door is walkable and its action key is handled by PlanetScene,
// the three scene classes load and register their keys, and the intro +
// spaceship actually use the shared building/player assets. This is the
// "nothing is a sticker" gate — it fails loudly if a building, interior
// fixture, or screen-wiring link ever drifts out of sync.
globalThis.Phaser = {
  Scene: class { },
  Input: { Keyboard: { JustDown: () => false, SPACE: 32, ESC: 27 } },
  BlendModes: { ADD: 0, MULTIPLY: 1 },
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SS = await import('../client/systems/SpriteSystem.js');
const MD = await import('../client/systems/MapData.js');
const PS = await import('../client/scenes/PlanetScene.js');
const IS = await import('../client/scenes/IntroScene.js');
const SPS = await import('../client/scenes/SpaceshipScene.js');
const AT = await import('../client/systems/AssetTheme.js');
const { TEXTURES } = SS;
const { BUILDINGS, blocks, verifyWalkability, MINE_SPOT, DEEP_DROP_SPOT, MAP_W, MAP_H, DECOR, NPC_POS, ground } = MD;

// ── 1. Single-source texture wiring: buildings, interiors, player frames ──
const BUILDING_TEX = [
  'bld.house', 'bld.house_glow',
  'bld.shop', 'bld.shop_glow',
  'bld.barn',
  'bld.tavern_a', 'bld.tavern_b', 'bld.tavern_c', 'bld.tavern_glow',
  'bld.exchange_a', 'bld.exchange_b', 'bld.exchange_glow',
];
const INTERIOR_TEX = [
  'int.window', 'int.rug', 'int.bookcase', 'int.plant', 'int.table', 'int.bed',
  'int.stove', 'int.chest', 'int.door', 'int.counter', 'int.stall', 'int.terminal',
];
const PLAYER_WALK_FRAMES = [];
for (const dir of ['front', 'back', 'left', 'right'])
  for (let f = 0; f < 3; f++) PLAYER_WALK_FRAMES.push(`player.${dir}_${f}`);

for (const tex of [...BUILDING_TEX, ...INTERIOR_TEX, ...PLAYER_WALK_FRAMES]) {
  check(`texture exists: ${tex}`, !!TEXTURES[tex], '(missing from SpriteSystem registry)');
}

// ── 2. Map layout wiring: every building has a door, label, action; all
//     doors are walkable; the map is reachable from the player start ──
const KNOWN_ACTIONS = new Set(['shop', 'exchange', 'ranch', 'sleep', 'talk_rhea', 'barracks']);
for (const b of BUILDINGS) {
  check(`building ${b.key} has door+label+action`,
    !!b.door && !!b.label && !!b.action, JSON.stringify(b));
  check(`building ${b.key} action known: ${b.action}`, KNOWN_ACTIONS.has(b.action));
  if (b.door) {
    const { x, y } = b.door;
    check(`building ${b.key} door (${x},${y}) walkable`,
      !blocks[y]?.[x], `blocked tile`);
  }
}
const walk = verifyWalkability();
check('map walkability: all buildings/soil/NPCs reachable', walk.ok,
  JSON.stringify(walk.unreachable && walk.unreachable.slice(0, 5)));

// world activity spots must live ON the map and on walkable tiles (the mining
// rock was once x=52 on a 40-wide map — unreachable in the browser)
for (const [name, spot] of [['mine', MINE_SPOT], ['deep drop', DEEP_DROP_SPOT]]) {
  check(`activity spot ${name} within map bounds`,
    spot.x >= 0 && spot.x < MAP_W && spot.y >= 0 && spot.y < MAP_H,
    JSON.stringify(spot));
  check(`activity spot ${name} on walkable tile`, !blocks[spot.y]?.[spot.x],
    JSON.stringify(spot));
}

// ── 3. PlanetScene building-action wiring: every BUILDINGS.action key routes
//     into its interior room, and each room's interaction point dispatches to
//     the real handler method ──
{
  const calls = [];
  const ps = Object.create(PS.PlanetScene.prototype);
  ps.openShop = () => calls.push('openShop');
  ps.openGrandExchange = () => calls.push('openGrandExchange');
  ps.openRanch = () => calls.push('openRanch');
  ps.sleep = () => calls.push('sleep');
  ps.openRecipeBook = () => calls.push('openRecipeBook');
  ps.openChest = () => calls.push('openChest');
  ps.startNPCDialogue = () => calls.push('startNPCDialogue');
  ps.showToast = () => {};
  ps.enterInterior = (k) => { calls.push('enterInterior:' + k); };
  ps.exitInterior = () => calls.push('exitInterior');
  // prototype methods the wiring relies on must actually exist
  for (const m of ['buildingAction', 'enterInterior', 'exitInterior', 'buildRoom', '_roomAction',
    'openShop', 'openGrandExchange', 'openRanch', 'startNPCDialogue']) {
    check(`PlanetScene.prototype.${m} exists`, typeof ps[m] === 'function');
  }
  // buildingAction routes each kind into its interior room
  const byAction = {
    shop: 'enterInterior:shop', exchange: 'enterInterior:exchange',
    ranch: 'enterInterior:ranch', sleep: 'enterInterior:home', talk_rhea: 'enterInterior:tavern',
    barracks: 'enterInterior:barracks',
  };
  for (const b of BUILDINGS) {
    calls.length = 0;
    try {
      ps.buildingAction(b);
      check(`buildingAction(${b.key}) → ${byAction[b.action]}`,
        calls.includes(byAction[b.action]), `got [${calls}]`);
    } catch (error) {
      check(`buildingAction(${b.key}) → ${byAction[b.action]}`,
        false, `threw: ${error.message}`);
    }
  }
  // _roomAction dispatches interior interaction points to the real handlers
  const roomByAction = {
    exit: 'exitInterior', sleep: 'sleep', recipes: 'openRecipeBook', chest: 'openChest',
    shop: 'openShop', exchange: 'openGrandExchange', ranch: 'openRanch', talk_rhea: 'startNPCDialogue',
  };
  for (const [action, handler] of Object.entries(roomByAction)) {
    calls.length = 0;
    try {
      ps._roomAction(action);
      check(`_roomAction(${action}) → ${handler}`, calls.includes(handler), `got [${calls}]`);
    } catch (error) {
      check(`_roomAction(${action}) → ${handler}`, false, `threw: ${error.message}`);
    }
  }
}

// ── 3b. Interior composition gate (QA 0904 gate-blindness fix): the five
//     rooms used to be the SAME room with glyphs swapped and no test noticed,
//     because wiring was checked but composition never was. Contract: each
//     _decorateRoom kind branch must reference ≥1 prop texture key that is not
//     present in EVERY other room's branch — no room may collapse to the fully
//     generic shared set — plus the named signature props QA called out
//     (tavern owns bar furniture, ranch owns livestock). ──
{
  const src = read('client/scenes/PlanetScene.js');
  const m = src.match(/_decorateRoom\(kind, room, stage\) \{([\s\S]*?)\n  \}\n/);
  check('_decorateRoom found in PlanetScene', !!m);
  if (m) {
    const body = m[1];
    const kinds = ['home', 'shop', 'tavern', 'exchange', 'ranch'];
    const sets = {};
    for (const k of kinds) {
      // slice this kind's branch: from its `kind === '<k>'` to the next branch (or end)
      const start = body.search(new RegExp(`kind\\s*===\\s*'${k}'`));
      if (start < 0) { sets[k] = null; continue; }
      let end = body.length;
      for (const other of kinds) {
        if (other === k) continue;
        const om = body.slice(start + 1).match(new RegExp(`kind\\s*===\\s*'${other}'`));
        if (om && start + 1 + om.index < end) end = start + 1 + om.index;
      }
      const seg = body.slice(start, end);
      sets[k] = new Set([...seg.matchAll(/'(?:int|ranch)\.[a-z0-9_]+'/g)].map((mm) => mm[0]));
    }
    for (const k of kinds) {
      if (!sets[k]) { check(`room ${k} has a decoration branch`, false, 'no kind branch found'); continue; }
      const unique = [...sets[k]].filter(key => kinds.some(o => o !== k && (!sets[o] || !sets[o].has(key))));
      check(`room ${k} has ≥1 signature prop (not shared by all rooms)`, unique.length >= 1,
        `props=[${[...sets[k]].join(', ')}]`);
    }
    // the two rooms QA called out specifically: tavern must own bar furniture,
    // ranch must own livestock (the report read: "the tavern has no bar; the
    // ranch has no animals")
    check('tavern owns bar furniture (counter/barback/stool)', sets.tavern && [...sets.tavern].some(k => /counter|barback|stool/.test(k)));
    check('ranch owns livestock sprites (ranch.*)', sets.ranch && [...sets.ranch].some(k => k.startsWith("'ranch.")));
  }
}

// ── 4. Scene classes load and register keys; boot sequence is wired ──
{
  const introSrc = read('client/scenes/IntroScene.js');
  const shipSrc = read('client/scenes/SpaceshipScene.js');
  const planetSrc = read('client/scenes/PlanetScene.js');
  const touchSrc = read('client/systems/TouchControls.js');
  const gameSrc = read('client/game.js');

  check('scene classes export', !!IS.IntroScene && !!SPS.SpaceshipScene && !!PS.PlanetScene);
  check('IntroScene registers key', /super\(\{\s*key:\s*'IntroScene'\s*\}\)/.test(introSrc));
  check('SpaceshipScene registers key', /super\(\{\s*key:\s*'SpaceshipScene'\s*\}\)/.test(shipSrc));
  check('PlanetScene registers key', /super\(\{\s*key:\s*'PlanetScene'\s*\}\)/.test(planetSrc));
  // scene update loops that read the frame clock must declare it — the ship
  // once crashed the whole game loop with `renderSprites(time)` in an
  // unparameterized update() (ReferenceError: time), freezing the title screen
  check('ship update declares the frame clock', /update\(time, delta\)/.test(shipSrc));
  check('planet update declares the frame clock', /update\(time\)/.test(planetSrc));
  const playerFrameLookups = planetSrc.match(/setTexture\(`player\.\$\{this\.playerDir\}_\$\{fKey\}`\)/g) || [];
  check('world + interior walk cycles use registered player.* texture keys',
    playerFrameLookups.length === 2, `got ${playerFrameLookups.length}/2 namespaced lookups`);
  check('intro update needs no frame clock (uses this.time)', /update\(\)/.test(introSrc));
  check('game.js scene registry: Intro→Ship→Planet',
    /scene:\s*\[IntroScene,\s*SpaceshipScene,\s*PlanetScene\]/.test(gameSrc));
  check('intro starts the ship', /scene\.start\('SpaceshipScene'\)/.test(introSrc));
  check('ship lands on the planet', /scene\.start\('PlanetScene'/.test(shipSrc));

  // the intro's building is the SAME house the planet renders — one texture
  check('intro renders the shared house (bld.house)', /'bld\.house'/.test(introSrc));
  check('intro renders the shared house glow (theme role bld.houseGlow)', /tex\('bld\.houseGlow'\)/.test(introSrc));
  // SF12 QA 0904B.4: one nebula tileSprite tiles the SAME blob cluster 3×3 —
  // wallpaper. Gate: >= 2 nebula tile layers with DISTINCT drift vectors +
  // >= 4 hand-placed single cloud sprites, and the generator wraps seamlessly.
  const nebLayers = introSrc.match(/this\.nebula\d?\s*= this\.add\.tileSprite/g) || [];
  check('intro has >= 2 nebula tile layers', nebLayers.length >= 2, `got ${nebLayers.length}/2`);
  check('intro nebula layers cross-fade (distinct alpha)',
    /\.setAlpha\(0\.4\)\.setTileScale\(/.test(introSrc));
  const driftXs = introSrc.match(/tilePositionX\s*-=\s*0\.\d+/g) || [];
  const driftSet = new Set(driftXs);
  check('nebula layers have distinct drift vectors', driftXs.length >= 2 && driftSet.size >= 2,
    `got ${driftXs.length} drift lines, ${driftSet.size} distinct`);
  check('intro renders a nebula-cloud texture', /tex\('fx\.nebula-cloud'\)/.test(introSrc));
  const cloudRows = introSrc.match(/\{ x: width \* [\d.]+, y: height \* [\d.]+, scale: [\d.]+, alpha: [\d.]+, drift: [\d.]+ \}/g) || [];
  check('intro places >= 4 single nebula cloud sprites', cloudRows.length >= 4, `got ${cloudRows.length}/4`);
  check('intro clouds drift and wrap', /c\.img\.x -= c\.drift/.test(introSrc) && /c\.img\.x = W \+/.test(introSrc));
  const spriteSrc = read('client/systems/SpriteSystem.js');
  check('nebula generator wraps seamlessly (toroidal distance)',
    /const wrap = \(v\) => Math\.min\(Math\.abs\(v\), size - Math\.abs\(v\)\)/.test(spriteSrc) && /wrap\(x - bl\.x\)/.test(spriteSrc));
  check('fx.nebula-cloud texture registered', /'fx\.nebula-cloud':\s*makeNebulaCloud\(\)/.test(spriteSrc));
  // the ship's player walks with the same frames the planet player uses
  check('ship uses shared player walk frames', /\$\{this\.playerDir\}_\$\{f\}/.test(shipSrc));

  // ── tutorial rework: persistent guidance layer — every interactable is
  //    labelled, and the player always knows which way the objective is ──
  check('ship has a POI registry (labelled interactables)', /const POI_SPECS\s*=\s*\[/.test(shipSrc));
  check('ship builds POI signposts', /this\.poiBadges\.push\(this\._buildPOIBadge\(p\)\)/.test(shipSrc));
  check('ship builds the GO HERE marker', /this\.objMarker\s*=\s*this\.add\.container/.test(shipSrc));
  check('ship draws an off-screen compass arrow', /_drawEdgeArrow\(/.test(shipSrc));
  check('ship has a persistent tutorial tracker panel', /this\.trackerText\s*=\s*this\.add\.text/.test(shipSrc));
  check('ship has a descent-fuel bar in the tracker', /this\.fuelFill\s*=\s*this\.add\.rectangle/.test(shipSrc));
  check('ship objective core is wired', /setObjective\(id, label, x, y\)/.test(shipSrc));
  check('ship refreshes the tracker checklist', /_refreshTracker\(\)/.test(shipSrc));
  check('ship hints SPACE from the marker when nearby', /PRESS SPACE/.test(shipSrc));
  check('ship dismisses dialogue with SPACE/E', /this\.dismissDialogue\(\)/.test(shipSrc));
  check('ship objective steps all defined (wake/power/plant/sleep/fuel/descend)',
    /setObjective\('wake'/.test(shipSrc) &&
    /setObjective\('power'/.test(shipSrc) &&
    /setObjective\('plant'/.test(shipSrc) &&
    /setObjective\('sleep'/.test(shipSrc) &&
    /setObjective\('fuel'/.test(shipSrc) &&
    /setObjective\('descend'/.test(shipSrc));
  check('ship dialogue advertises the continue key', /Press SPACE to continue/.test(shipSrc));

  // ── cross-device controls: SPACE/E (desktop) and the touchbar A-button
  //    (mobile) drive the SAME _pressAction on ship + planet; one interact
  //    range is shared by the marker hint, handleInteract and _nearInteractable
  check('ship defines ONE shared interact range', /const INTERACT_RANGE = 2\.1/.test(shipSrc));
  check('ship handleInteract uses the shared range', /const range = INTERACT_RANGE/.test(shipSrc));
  check('ship _nearInteractable uses the shared range', (shipSrc.match(/INTERACT_RANGE/g) || []).length >= 4);
  check('ship marker hint flashes at the SAME range it acts', /objective\.x, this\.objective\.y\) < INTERACT_RANGE/.test(shipSrc));
  check('ship exposes a unified SPACE/A action path', /_pressAction\(\) \{/.test(shipSrc) && /this\._pressAction\(\)/.test(shipSrc));
  check('ship coaches you to walk closer when too far', /_cueStandCloser\(\)/.test(shipSrc));
  check('planet exposes a unified SPACE/A action path', /_pressAction\(\) \{/.test(planetSrc) && /this\.handleInteract\(\)/.test(planetSrc));
  check('touchbar A-button drives _pressAction when present', /typeof scene\._pressAction === 'function'/.test(touchSrc));
}

// ── 5. Shared touch bar routes each scene's controls on mobile ──
{
  const touchSrc = read('client/systems/TouchControls.js');
  check('touch bar ships a D-pad for movement', /data-dir/.test(touchSrc) || /moveDir\(dir\)/.test(touchSrc));
  check('touch bar ships a menu button (GE / shop)', /'menu'/.test(touchSrc) && /openGrandExchange/.test(touchSrc));
  check('touch bar B dismisses panels', /closeAllPanels/.test(touchSrc));
}

// ── 6. QA 0904B.12 ATTRIBUTE gate: the agri-deck overlay must COVER the soil,
//     never float over it as an orphan. The bug that shipped green: hardcoded
//     strokeRoundedRect rows desynced from the FARM zone when the layout moved.
//     Gate shape: (a) the deck geometry must be DERIVED from the ground grid —
//     no literal tile-row constants in the deck block; (b) the derived bounds
//     must coincide with the actual soil tile bounds. ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const deckBlock = (() => {
    const i = planetSrc.indexOf('this.fieldDeck = this.add.graphics');
    if (i < 0) return '';
    const j = planetSrc.indexOf('this.world.add(this.fieldDeckLabels)', i);
    return planetSrc.slice(Math.max(0, planetSrc.indexOf('QA 0904B.12', i) - 40), j > 0 ? j : i + 2200);
  })();
  check('agri-deck overlay block exists', deckBlock.length > 100);
  check('agri-deck derives from the ground grid (soilAt scan)', /soilAt|ground\[y\]\[x\] === 'soil'/.test(deckBlock));
  check('agri-deck has NO hardcoded tile-row literals (0904B.12 regression)',
    !/strokeRoundedRect\(\s*\d+\s*\*\s*T/.test(deckBlock) && !/for \(let fy = \d+;/.test(deckBlock));
  // (b) derived deck bounds must equal soil bounds — recompute here the same way
  const { ground } = MD;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = 0; y < MD.MAP_H; y++) for (let x = 0; x < MD.MAP_W; x++) {
    if (ground[y][x] !== 'soil' && ground[y][x] !== 'soil_b') continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  const farm = MD.FARM;
  check('soil tiles exist at all', x1 > 0, 'no soil tiles in the ground grid!');
  if (farm) {
    check('soil bounds match FARM zone (MapData self-consistency)',
      x0 === farm.x0 && y0 === farm.y0 && x1 === farm.x1 && y1 === farm.y1,
      `soil(${x0},${y0})-(${x1},${y1}) vs FARM(${farm.x0},${farm.y0})-(${farm.x1},${farm.y1})`);
  }
}

// ── 6b. QA 0904B.9 ATTRIBUTE gate: the NW farm block must not render as one
//     flat rust slab. Gate shape: (a) untilled soil resolves ≥2 variant keys
//     per tile position (ridge rows), (b) soil/grass borders use the packed
//     sand/slate border-ring role, (c) the crop-tile base stays plain soil so
//     tilled/seeded states stay visually distinct. Negative control: FAILS on
//     the old code — no soilEdge role, soil resolved a single key. ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const themeSrc = read('client/systems/AssetTheme.js');
  const sprSrc = read('client/systems/SpriteSystem.js');
  const soilArray = /soil:\s*\[['"]/.test(themeSrc);
  const variantCalls = /texAt\('ground\.soil',/.test(planetSrc);
  check('untilled soil uses ≥2 variant keys per tile position', soilArray && variantCalls,
    `theme soil array: ${soilArray}, planet variant calls: ${variantCalls}`);
  const edgeRole = /soilEdge/.test(themeSrc) && /soilEdge/.test(sprSrc) && /ground\.soilEdge/.test(planetSrc);
  check('soil/grass border ring uses the border role', edgeRole,
    `theme:${/soilEdge/.test(themeSrc)} sprites:${/soilEdge/.test(sprSrc)} planet:${/ground\.soilEdge/.test(planetSrc)}`);
  const edgeScan = planetSrc.indexOf('ground.soilEdge');
  const edgeBlock = edgeScan >= 0 ? planetSrc.slice(Math.max(0, edgeScan - 1400), edgeScan + 700) : '';
  check('border ring is placed on soil tiles that touch grass',
    /eg !== 'soil' && eg !== 'soil_b'/.test(edgeBlock) && /ng !== 'soil' && ng !== 'soil_b'/.test(edgeBlock));
  check('crop-tile base stays plain soil (tilled stays distinct)', /soil: tile\('soil'\)/.test(sprSrc));
}

// ── 7. QA 0904B.2/B.3/B.1 ATTRIBUTE gates: HUD screen-anchor, dialogue
//     header guard + real wrapping, deep-link start retry. Each gate was
//     negative-controlled against the pre-fix source (gate FAILS on old bug). ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const diaSrc = read('client/systems/DialoguePanel.js');
  const gameSrc = read('client/game.js');
  const shipSrc2 = read('client/scenes/SpaceshipScene.js');

  // B.2 — buildHUD: every screen-HUD element must be scroll-anchored
  const hudBlock = (() => {
    const i = planetSrc.indexOf('buildHUD(width, height) {');
    const j = planetSrc.indexOf('\n  }', i);
    return i < 0 ? '' : planetSrc.slice(i, j > 0 ? j : i + 3000);
  })();
  check('buildHUD exists', hudBlock.length > 100);
  check('buildHUD screen-anchors its strips (scrollFactor 0 sweep)', /setScrollFactor\(0\)/.test(hudBlock));
  check('buildHUD anchors the telemetry bar ref', /screenFix\.push\(this\.hudBar\)/.test(hudBlock));

  // B.3 — dialogue header can never render literal undefined/empty-brackets,
  // and body wrapping must be actually ENABLED (Phaser needs enable:true —
  // a bare {width} silently disables wrapping => clipped words, 0904B.3)
  check('dialogue title guards undefined/null/blank (no "undefined undefined")',
    /title !== undefined && title !== null && String\(title\)\.trim\(\)/.test(diaSrc));
  check('dialogue body wrap is enabled', /wordWrap: \{ enable: true, width: wrapW \}/.test(diaSrc));
  const noEnable = [planetSrc, shipSrc2].filter(src =>
    /wordWrap: \{ width:/.test(src.replace(/wordWrap: \{ enable: true, width:/g, '')));
  check('no wordWrap-without-enable sites remain in scenes', noEnable.length === 0,
    noEnable.length ? `${noEnable.length} file(s) still pass {width} without enable` : '');

  // SF21 — routine actions must NOT block play behind a SPACE-dismissed modal.
  // PlanetScene already used showToast for refill etc.; the ship now ports it.
  // (Negative-controlled: pre-SF21 handleHarvest/mineAsteroid called
  // showDialogue on every harvest/mine — this gate FAILS on the old code.)
  check('SpaceshipScene defines a toast helper',
    /showToast\(msg\) \{/.test(shipSrc2));
  const fnBody = (src, header) => {
    const i = src.indexOf(header);
    if (i < 0) return '';
    const j = src.indexOf('\n  }', i);
    return j > 0 ? src.slice(i, j) : '';
  };
  const harvestBody = fnBody(shipSrc2, 'handleHarvest(planter) {');
  const mineBody = fnBody(shipSrc2, 'mineAsteroid() {');
  check('handleHarvest body exists', harvestBody.length > 100);
  check('mineAsteroid body exists', mineBody.length > 100);
  check('handleHarvest rewards via toast (no blocking modal)',
    !/this\.showDialogue\(/.test(harvestBody) && /this\.showToast\(/.test(harvestBody));
  check('mineAsteroid rewards via toast (no blocking modal)',
    !/this\.showDialogue\(/.test(mineBody) && /this\.showToast\(/.test(mineBody));
  const shipRoutine = fnBody(shipSrc2, 'handlePlanter(planter) {');
  check('ship crop till/plant/water feedback is non-blocking',
    shipRoutine.length > 100 && (shipRoutine.match(/this\.showDialogue\(/g) || []).length === 0);
  // modal dialogue stays for story/tutorial beats
  check('SpaceshipScene still has modal beats (C.O.R.A. intro/airlock/sleep)',
    /showDialogue\(NPC_DIALOGUES\.cora_intro\.text\)/.test(shipSrc2) && /showDialogue\(NPC_DIALOGUES\.airlock\.text\)/.test(shipSrc2));

  // B.1 — deep-link boot: the startIt cycle must stop ALL scenes (incl. target),
  // wait for the queue to settle to an empty active list, then start once, and
  // retry the whole cycle (attempt<3) if the target never activates.
  // (Old bug: start() on an already-active target took the swallowed restart()
  // branch behind queued sibling stop()s → every scene inactive, black canvas.)
  check('deep-link boot stops all scenes incl. target then settles before start',
    /startIt = \(attempt\)/.test(gameSrc) && /for \(const sc of game\.scene\.getScenes\(true\)\)/.test(gameSrc)
    && /settle = \(n\)/.test(gameSrc) && /n < 40/.test(gameSrc) && /attempt < 3/.test(gameSrc));
}

// ── 8. QA 0904C gate: Colony Hub rows must be tappable through TWO paths —
//     the object pointerdown AND a scene-level manual hit-test fallback (the
//     codebase's known flaky-device quirk: in-canvas hit areas can slip).
{
  const hubSrc = read('client/systems/ColonyHub.js');
  check('hub row pointerdown wired', /rect\.on\('pointerdown'[^)]*confirm/.test(hubSrc.replace(/\s+/g, ' ')) || /pointerdown.*confirm\(/.test(hubSrc));
  check('hub scene-level tap fallback', /scene\.input\.on\('pointerdown'/.test(hubSrc) && /indexOf\(rw\.rect\) !== -1/.test(hubSrc));
  check('hub fallback guarded on open+visible', /if \(!this\.open \|\| !this\.panel \|\| !this\.panel\.visible\) return;/.test(hubSrc));
  check('hub fallback dedupes vs object over-list', /const ol = over \|\| \[\];/.test(hubSrc));
}

// ── 9. SF17 gate: returning players can CONTINUE straight to the farm. ──
// PlanetScene stamps localStorage 'sf_landed'='1' on first landing; IntroScene
// reads it and, on the title, SPACE starts PlanetScene directly (server-side
// save restore supplies credits — no fake credits value is passed), N replays
// the ship tutorial. No flag → behaviour unchanged (SpaceshipScene).
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const introSrc = read('client/scenes/IntroScene.js');

  check('PlanetScene stamps sf_landed in init', /localStorage\.setItem\('sf_landed', '1'\)/.test(planetSrc));
  check('IntroScene reads the sf_landed flag', /localStorage\.getItem\('sf_landed'\)/.test(introSrc));
  check('IntroScene CONTINUE path starts PlanetScene (no fake credits)',
    /if \(this\.landed\) \{ this\.scene\.start\('PlanetScene'\); return; \}/.test(introSrc));
  check('IntroScene NEW RUN — N still starts SpaceshipScene',
    /startNewRun\(\) \{[\s\S]*?this\.scene\.start\('SpaceshipScene'\)/.test(introSrc));
  check('IntroScene unchanged without the flag (spaceship on first run)',
    /titleShown\) \{[\s\S]*?this\.scene\.start\('PlanetScene'\); return; \}[\s\S]*?this\.scene\.start\('SpaceshipScene'\)/.test(introSrc));
  check('returning CONTINUE hint shows only for landed players', /setVisible\(this\.landed\)/.test(introSrc));
}

// ── 10. SF19 gate: ship credits don't silently vanish on landing. ──
// The 500 cr is the descent-fuel fee: C.O.R.A. says so at the airlock, the
// fuel bar drains on landing, and PlanetScene never seeds credits from scene
// data (server value only; '—' until the first sync).
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const shipSrc = read('client/scenes/SpaceshipScene.js');
  const initBody = (planetSrc.match(/\n  init\(data\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('PlanetScene.init exists', initBody.length > 0);
  check('PlanetScene.init does not read data.credits', !/data\.credits/.test(initBody));
  check('PlanetScene HUD shows — until first credits sync', /'— CR'/.test(planetSrc));
  check('SpaceshipScene does not pass credits to PlanetScene', !/scene\.start\('PlanetScene',\s*\{\s*credits/.test(shipSrc));
  const airlock = (SPS.NPC_DIALOGUES || {}).airlock;
  const airlockText = airlock ? airlock.text.join(' ') : (shipSrc.match(/airlock: \{[\s\S]*?\],/) || [''])[0];
  check('descent copy mentions the fuel fee', /landing-fuel fee|descent fuel/i.test(airlockText));
  check('landing drains the fuel bar', /landOnPlanet\(\) \{[\s\S]*?this\._drainDescentFuel\(\)/.test(shipSrc));
}

// ── 11. SF20 gate: context prompt — show what SPACE/A will do before you
//     press it. handleInteract delegates target resolution to
//     _resolveInteractTarget (EXACT existing priority order), and update()
//     shows a small prompt chip above the resolved target (teal plate,
//     amber key, font ≥ 11px, scroll-anchored world-local placement). ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');

  // handleInteract must delegate to the resolver, not inline its own lookups
  const hiBody = (planetSrc.match(/\n  handleInteract\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('handleInteract exists', hiBody.length > 0);
  check('handleInteract delegates to _resolveInteractTarget',
    /_resolveInteractTarget\(\)/.test(hiBody));
  // the resolver must run the current priority order: interior points → shore
  // refill → equipped rod/pickaxe → aliens → NPCs → building doors → tiles
  const resBody = (planetSrc.match(/\n  _resolveInteractTarget\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('_resolveInteractTarget exists', resBody.length > 0);
  check('resolver reads interior points', /intPoints/.test(resBody));
  check('resolver reads the shore tap (FILL_SPOT)', /FILL_SPOT/.test(resBody));
  check('resolver checks the equipped rod/pickaxe', /_useEquippedTool/.test(resBody));
  check('resolver reads alien envoys', /ALIEN_DATA/.test(resBody));
  check('resolver reads npc brains', /npcBrains/.test(resBody));
  check('resolver reads building doors', /BUILDINGS/.test(resBody));
  check('resolver reads the farm tiles', /farmTiles/.test(resBody));
  // priority = the pre-SF20 handleInteract order: interior points → shore →
  // NPCs → aliens → doors → tiles (first occurrence of each lookup)
  const order = ['intPoints', 'FILL_SPOT', 'npcBrains', 'ALIEN_DATA', 'BUILDINGS', 'farmTiles'];
  const idxs = order.map((tok) => resBody.indexOf(tok));
  check('resolver keeps the existing priority order',
    idxs.every((i) => i > 0) && idxs.every((i, k) => k === 0 || i > idxs[k - 1]),
    `indices ${idxs.join(',')} for ${order.join('>')}`);

  // the prompt chip: world-space container pinned above the target
  check('prompt chip object exists', /this\.interactPrompt\s*=\s*this\.add\.container\(/.test(planetSrc));
  check('prompt chip plate is teal', /0x39c5bb/.test(planetSrc));
  check('prompt chip key text is amber', /#f7d698/.test(planetSrc));
  const buildBody = (planetSrc.match(/\n  _buildInteractPrompt\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  const fontSizes = [...buildBody.matchAll(/fontSize:\s*'(\d+)px'/g)];
  check('prompt chip font ≥ 11px',
    fontSizes.length > 0 && fontSizes.every((m) => parseInt(m[1], 10) >= 11),
    fontSizes.map((m) => m[1] + 'px').join(','));
  check('prompt chip lives in world space (scrollFactor 1, not 0)',
    /setScrollFactor\(1\)/.test(buildBody) && !/setScrollFactor\(0\)/.test(buildBody));
  const updBody = (planetSrc.match(/\n  _updateInteractPrompt\(time\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('prompt chip hides during panels/interiors (update() guard)',
    /interactPrompt\?\.setVisible\(false\)/.test(updBody));
  check('prompt chip positioned at the resolved target',
    /this\.interactPrompt\.setPosition\(target\.x, target\.y\)/.test(updBody));
  // every identifier the updater touches must be defined in it (a bare
  // `plate.` here was a ReferenceError that crashed update() every frame)
  for (const id of ['plate', 'keyTxt', 'bodyTxt']) {
    check(`_updateInteractPrompt defines ${id} before use`,
      !new RegExp(`\\b${id}\\.`).test(updBody) || new RegExp(`(const|let)[^;]*\\b${id}\\b`).test(updBody));
  }
  check('touch mode detected in-scene (Phaser drops custom config keys)', /navigator\.maxTouchPoints/.test(planetSrc));
  check('update() calls the prompt refresher', /update\(time\) \{[\s\S]{0,900}this\._updateInteractPrompt\(time\)/.test(planetSrc));
  check('touch says "A ·" instead of SPACE', /this\.touchMode \? 'A' : 'SPACE'/.test(planetSrc));
}

// ── 12. SF02 gate: the quest HUD chip never draws an empty box. questPlate's
//     visibility is tied to non-empty chip text (hide when '' / show + width
//     sized to text when a quest fills the chip), and a fresh-game questView
//     with no current quest yet falls back to QUEST_ORDER[0] producing a
//     non-empty chip string. ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const chipBlock = (planetSrc.match(/SF02: populate the chip[\s\S]*?questChip\.setText\(chip\);[\s\S]*?questPlate\)[\s\S]*?}\n/) || [''])[0];
  check('SF02 chip block exists in updateHUD', chipBlock.length > 0);
  check('questPlate hidden when chip empty',
    /if \(!chip\) \{\s*this\.questPlate\.setVisible\(false\);/.test(chipBlock));
  check('questPlate shown when chip non-empty',
    /else \{\s*this\.questPlate\.setVisible\(true\);/.test(chipBlock));
  check('questPlate width sized to text (min 160, max current width)',
    /Math\.max\(160,\s*Math\.min\(wMax,/.test(chipBlock) && /Math\.min\(430,\s*this\.game\.config\.width\s*\* 0\.54/.test(chipBlock));
  check('chip populated from active quest with QUEST_ORDER[0] fallback',
    /QUEST_ORDER\[0\]/.test(chipBlock) && /!view\.quest && !view\.arcDone/.test(chipBlock));
  // fresh-game questView produces a non-empty chip string (pure helper test)
  const QS = await import('../client/systems/QuestSystem.js');
  const freshView = QS.questView({ current: QS.QUEST_ORDER[0], completed: [], progress: {}, arcDone: false }, null);
  const freshChip = QS.questChip(freshView);
  check('fresh-game questView produces non-empty chip',
    typeof freshChip === 'string' && freshChip.length > 0 && freshChip.startsWith('◆'), freshChip);
}

// ── 13. SF03 gate: the controls hint lives BELOW the canvas (normal flow,
//     never position:fixed/absolute over it), is single-sourced, and IntroScene
//     hides it until gameplay starts. ──
{
  const html = read('index.html');
  const infoRule = (html.match(/#controls-info\s*\{[^}]*\}/) || [''])[0];
  check('SF03 #controls-info rule exists', infoRule.length > 0);
  check('SF03 #controls-info CSS has no position:fixed/absolute',
    !/position\s*:\s*(fixed|absolute)/.test(infoRule), infoRule.slice(0, 80));
  const markup = (html.match(/<div id="controls-info"[^>]*>/) || [''])[0];
  check('SF03 #controls-info is empty in markup (single source)', markup.trim().endsWith('</>') || /\/>/.test(markup) || /"hidden"/.test(markup));
  const TC = await import('../client/systems/TouchControls.js');
  const hint = 'WASD/Arrows: Move · SPACE/E: Interact · M: Colony Hub · I: Shop · U: Upgrades · ESC: Close';
  check('SF03 CONTROLS_HINT_TEXT exported with U: Upgrades',
    TC.CONTROLS_HINT_TEXT === hint, TC.CONTROLS_HINT_TEXT);
  const hintSources = [read('client/systems/TouchControls.js'), html, read('client/scenes/IntroScene.js')];
  const totalHits = hintSources.reduce((n, s) => n + (s.split(hint).length - 1), 0);
  check('SF03 hint string appears exactly once across sources', totalHits === 1, `hits=${totalHits}`);
  const introSrc = read('client/scenes/IntroScene.js');
  check('SF03 IntroScene hides the hint strip', /this\.touchCtrl\.hideInfo\(\)/.test(introSrc));
  check('SF03 IntroScene restores it on shutdown', /events\.on\('shutdown'[\s\S]{0,120}touchCtrl\.showInfo\(\)/.test(introSrc));
}

// ── 14. SF22 gate: the planet points at its quest objective — every objective
//     kind used in QUESTS resolves to a concrete in-world target (or null
//     explicitly), the chevron bobs in-world, and the edge arrow is
//     scrollFactor 0 at the viewport border. ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const zoneBlock = (planetSrc.match(/const QUEST_ZONES\s*=\s*\(\(\) => \{[\s\S]*?\}\)\(\);/) || [''])[0];
  check('SF22 QUEST_ZONES table exists', zoneBlock.length > 0);
  const zoneKeys = [...zoneBlock.matchAll(/\n\s{4}(?:'|")?([a-zA-Z]+):\s+\{/g)].map(m => m[1]);
  const QS = await import('../client/systems/QuestSystem.js');
  const kinds = new Set();
  for (const q of Object.values(QS.QUESTS)) for (const o of q.objectives) kinds.add(o.type || '');
  const branchKinds = [...planetSrc.matchAll(/kind === '(\w+)'/g)].map(m => m[1]);
  const covered = new Set([...zoneKeys, ...branchKinds]);
  const missing = [...kinds].filter(k => !covered.has(k));
  check('SF22 every objective kind used in QUESTS maps to a target (or null fallback)',
    missing.length === 0, `kinds=${[...kinds].join(',')} missing=${missing.join(',')}`);
  check('SF22 unresolvable kinds return null explicitly (no wrong pointer)',
    /const z = QUEST_ZONES\[kind\];\s*\n\s*if \(!z[\s\S]{0,120}return null;/.test(planetSrc));
  check('SF22 talk objectives resolve the live npc brain or return null',
    /kind === 'talk'[\s\S]{0,240}npcBrains\[obj\.npc\][\s\S]{0,120}return null/.test(planetSrc));
  check('SF22 met objectives yield null (nothing left to point at)',
    /if \(!obj\) return null;/.test(planetSrc));
  check('SF22 planet builds the bobbing chevron marker',
    /this\.questMarker = this\.add\.container\(0, 0\)\.setDepth\(986\)/.test(planetSrc));
  check('SF22 planet builds a screen-fixed edge arrow (scrollFactor 0)',
    /this\.questEdgeArrow = this\.add\.graphics\(\)\.setScrollFactor\(0\)/.test(planetSrc));
  check('SF22 marker positions use the world container offset',
    /this\.questMarker\.setPosition\(t\.x \+ this\.worldX/.test(planetSrc));
  const questUpdate = (planetSrc.match(/_updateQuestMarkers\(time\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('SF22 marker hidden during dialogue/panels/interiors',
    questUpdate.includes('inAlienContact') && questUpdate.includes('inInterior'));
  check('SF22 no target → chevron and edge arrow both hidden',
    /if \(!t\) \{\s*this\.questMarker\.setVisible\(false\);\s*this\.questEdgeArrow\.setVisible\(false\);/.test(planetSrc));
}

// ── 15. SF23 gate: every tool dead-end SAYS where to go. Each `return false`
//     dead-end branch in _useEquippedTool carries a direction toast (rod →
//     lake shore east, pickaxe → vein south-west), fish/mine/fillWater carry
//     the same wording for their own gate paths, each handleTileAction refusal
//     reason has a toast, and identical toasts rate-limit to once per 2s.
//     (Negative-controlled: pre-SF23 _useEquippedTool returned false with NO
//     toast and showToast had no limiter — this gate FAILS on the old code.) ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const fnBody = (src, header) => {
    const i = src.indexOf(header);
    if (i < 0) return '';
    const j = src.indexOf('\n  }', i);
    return j > 0 ? src.slice(i, j) : '';
  };
  const toolBody = fnBody(planetSrc, '_useEquippedTool() {');
  const rodBranch = (toolBody.match(/if \(!atShore\) \{[\s\S]*?\}/) || [''])[0];
  const pickBranch = (toolBody.match(/> 4\) \{[\s\S]*?\}/) || [''])[0];
  check('SF23 rod dead-end branch toasts a direction', rodBranch.includes('showToast')
    && /lake shore \(east\)/.test(rodBranch));
  check('SF23 pickaxe dead-end branch toasts a direction', pickBranch.includes('showToast')
    && /mine \(south-west\)/.test(pickBranch));
  check('SF23 hands-free branch stays silent (no hijacked NPC talk)', (toolBody.match(/if \(!e\) return false/) || []).length === 1);

  const fishBody = fnBody(planetSrc, 'fish() {');
  const mineBody = fnBody(planetSrc, 'mine() {');
  check('SF23 fish() out-of-spot toast says east shore', /No water here — fish from the lake shore \(east\)/.test(fishBody));
  check('SF23 mine() out-of-range toast says south-west vein', /The ore vein is in the mine \(south-west\)/.test(mineBody));
  const fillBody = fnBody(planetSrc, 'fillWater() {');
  check('SF23 fillWater no-tap toast points at the shore', /No tap here[\s\S]{0,80}shore \(east\)/.test(fillBody));

  const tileBody = fnBody(planetSrc, 'handleTileAction(ft) {');
  const refusalCases = {
    hoe: /showToast\('Equip the HOE to till \(M → Backpack\)/,
    seeds: /showToast\('Out of seeds — Supply Depot sells more/,
    can: /showToast\('Equip the WATERING CAN to water \(M → Backpack\)/,
    empty: /showToast\('Can is empty — refill at the shore \(east\)/,
    hands: /showToast\('Wrong tool — empty your hands \(backpack\) to harvest/,
  };
  for (const [k, re] of Object.entries(refusalCases)) {
    check(`SF23 tile refusal "${k}" carries a toast`, re.test(tileBody));
  }

  const toastBody = fnBody(planetSrc, 'showToast(msg) {');
  check('SF23 showToast rate-limits identical lines to 2s',
    /_toastKey === msg/.test(toastBody) && /< 2000/.test(toastBody), toastBody.slice(0, 120));
}

// ── 16. SF24 gate: reward pops at the spot of the action. _popReward exists,
//     destroys BOTH its text and its particle emitter on complete (and has a
//     delayed-call safety sweep), skips entirely when the tab is hidden, uses
//     an EXISTING fx texture for the sparkle (fx.shadow), and is called from
//     the harvest, sell, mine and fish result handlers (plus quest reward).
//     (Negative-controlled: pre-SF24 PlanetScene had no _popReward at all —
//     this gate FAILS on the old code.) ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const pop = planetSrc.indexOf('_popReward(x, y, text, color) {');
  check('SF24 _popReward method exists', pop >= 0);
  const popBody = pop >= 0 ? planetSrc.slice(pop, planetSrc.indexOf('\n  }', pop)) : '';
  check('SF24 pop tween destroys its text on complete',
    /onComplete: \(\) => \{[\s\S]*?txt\.destroy\(\)/.test(popBody));
  check('SF24 pop destroys its particle emitter (no leak)',
    /spark\.destroy\(\)/.test(popBody) && /delayedCall\([\s\S]*?spark\.destroy\(\)/.test(popBody));
  check('SF24 pop rises ~24px and fades ~900ms',
    /y: y - 24/.test(popBody) && /duration: 900/.test(popBody));
  check('SF24 pop is bold 12px with a 3px stroke',
    /fontSize: '12px'/.test(popBody) && /strokeThickness: 3/.test(popBody));
  check('SF24 pop skips when the tab is hidden',
    /document\.hidden/.test(popBody));
  check('SF24 sparkle uses an EXISTING fx texture',
    /add\.particles\(x, y, 'fx\.shadow'/.test(popBody));
  check('SF24 sparkle is a small 6-8 particle burst',
    /quantity: 8/.test(popBody) && /stopAfter: 8/.test(popBody));
  check('SF24 harvest handler pops a credit reward',
    /_popReward\(s\.x \* T/.test(planetSrc) && /#f7d698/.test(planetSrc.slice(pop)));
  check('SF24 mine handler pops an ore/credit reward',
    /_popReward\(rx, ry - 18/.test(planetSrc));
  check('SF24 fish handler pops a teal item + amber credit reward',
    /_popReward\(this\.playerSpr\.x, this\.playerSpr\.y - 40, `\+1 \$\{label\}`, '#6be7d0'\)/.test(planetSrc));
  const sellPop = (planetSrc.match(/_popReward\(this\.playerSpr\.x, this\.playerSpr\.y - 40, `\+\$\{r\.credits\} CR`, '#f7d698'\)/g) || []).length;
  check('SF24 both sell handlers pop the credit reward', sellPop === 2, `${sellPop} sell pop sites`);
  check('SF24 quest reward pops on quest completion',
    /_popReward\(this\.playerSpr\.x, this\.playerSpr\.y - 46, 'QUEST COMPLETE'/.test(planetSrc));
}

{
  // SF04 — the tutorial tracker's fuel bar is laid out from the tracker text
  // bounds, so the "Sleep so it grows" line is never covered by the bar.
  const shipSrc = read('client/scenes/SpaceshipScene.js');
  const trackerBody = shipSrc.slice(shipSrc.indexOf('_refreshTracker'));
  check('SF04 fuel bar Y derives from trackerText bounds',
    /const fuelY = Math\.round\(textBottom \+ 8\)/.test(trackerBody) &&
    /const textBottom = this\.trackerText\.y \+ this\.trackerText\.height/.test(trackerBody));
  check('SF04 no fixed fuelY literal remains',
    !/fuelY\s*=\s*\d+\s*\+/.test(shipSrc) &&
    !/const fuelY = .*TRACK_H/.test(shipSrc));
  const trackerFonts = [];
  for (const m of shipSrc.matchAll(/tracker(?:Text|Title)\s*=\s*this\.add\.text\([\s\S]{0,180}?fontSize:\s*['"](\d+)px['"]/g)) trackerFonts.push(+m[1]);
  check('SF04 tracker title + checklist font >= 12px',
    trackerFonts.length >= 2 && trackerFonts.every(f => f >= 12), trackerFonts.join(','));
  check('SF04 tracker panel grows to contain text + bar + padding',
    /this\.trackerBg\.setSize\(TRACK_W, trackH\)/.test(trackerBody) &&
    /const trackH = Math\.round\(fuelY - 12 \+ 11 \+ 10\)/.test(trackerBody));
  check('SF04 fuel bar repositions on every tracker refresh',
    /this\.fuelBg\.setPosition\(fuelX \+ fuelW \/ 2, fuelY\)/.test(trackerBody) &&
    /this\.fuelFill\.setPosition\(fuelX, fuelY\)/.test(trackerBody) &&
    /this\.fuelLabel\.setPosition\(fuelX \+ fuelW, fuelY - 10\)/.test(trackerBody));
}

{
  // SF05 — min-font gate (QA 0904B.13): no Text in either scene may use a font
  // below 10px. Names/nameplates read at 11px; everything else >= 10px.
  const minFontScenes = ['client/scenes/PlanetScene.js', 'client/scenes/SpaceshipScene.js'];
  for (const sceneFile of minFontScenes) {
    const src = read(sceneFile);
    const sizes = [...src.matchAll(/fontSize:\s*['"](\d+(?:\.\d+)?)px['"]/g)].map((m) => parseFloat(m[1]));
    const tooSmall = sizes.filter((n) => n < 10);
    check(`SF05 ${sceneFile} fontSize literals >= 10px`,
      sizes.length > 0 && tooSmall.length === 0,
      tooSmall.length ? `${tooSmall.length} below 10px: ${tooSmall.map((n) => n + 'px').join(',')}` : `${sizes.length} literals, all >= 10px`);
  }
  // The interior room helper passes sizes as call arguments — no arg below 10px.
  const planetSrcMin = read('client/scenes/PlanetScene.js');
  const labelSizes = [...planetSrcMin.matchAll(/,\s*'(\d+(?:\.\d+)?)px'\)/g)].map((m) => parseFloat(m[1]));
  const labelSmall = labelSizes.filter((n) => n < 10);
  check('SF05 interior label size args >= 10px', labelSmall.length === 0,
    labelSmall.length ? `${labelSmall.map((n) => n + 'px').join(',')}` : `${labelSizes.length} args`);
}

// ── SF10: the farm outline is a procedural fence, not a stroked wireframe ──
//     Negative control: FAILS on the old code (1px strokeRoundedRect outline,
//     posts only via the separate laser-fence spans, no farm_post texture).
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const themeSrc = read('client/systems/AssetTheme.js');
  const sprSrc = read('client/systems/SpriteSystem.js');
  // colony palette textures exist and resolve through the theme
  check('SF10 farm fence post texture is colony slate+teal (not wood)',
    /const farmPost = mkSprite/.test(sprSrc) && /'decor\.farm_post'/.test(sprSrc));
  check('SF10 farm fence beam texture stretches post-to-post',
    /const farmBeam = mkSprite/.test(sprSrc) && /'decor\.farm_beam'/.test(sprSrc));
  check('SF10 farm fence roles resolve through AssetTheme',
    /farmPost:\s*'decor\.farm_post'/.test(themeSrc) && /farmBeam:\s*'decor\.farm_beam'/.test(themeSrc) &&
    /resolveKey\('decor\.farmPost'\)/.test(planetSrc));
  // fence block: posts derived from soil bounds — no tile literals
  const i = planetSrc.indexOf('perimeterTiles = 2 * (sbx1 - sbx0');
  const block = i >= 0 ? planetSrc.slice(Math.max(0, i - 700), planetSrc.indexOf('farmFencePosts.length < perimeterPosts', i) + 60) : '';
  check('SF10 fence posts are derived from soil bounds', block.length > 200,
    `block length: ${block.length}`);
  check('SF10 fence perimeter formula uses soil bounds only',
    /perimeterTiles = 2 \* \(sbx1 - sbx0 \+ 1\) \+ 2 \* \(sby1 - sby0 \+ 1\)/.test(block));
  check('SF10 fence block has no tile-literal coordinates',
    !/=\s*\d+\s*\*\s*T/.test(block) && !/\*\s*T\s*\+\s*\d+\s*\*\s*T/.test(block));
  // posts every 2 tiles + beam between them (vertical runs rotated)
  check('SF10 posts are placed every 2 tiles with beams between them',
    /for \(let x = sbx0; x <= sbx1; x \+= 2\)/.test(block) &&
    /for \(let y = sby0; y <= sby1; y \+= 2\)/.test(block) &&
    /if \(dxT === 0\) beam\.setAngle\(90\)/.test(block));
  // gate gap on the side facing the main path (east edge skip)
  check('SF10 east edge keeps a gate gap (facing the main path)',
    /if \(edgeX === sbx1 && \(y === gateSlot/.test(block));
  // the old stroked rectangle is gone from the deck/fence block
  const deckStart = planetSrc.indexOf('this.fieldDeck = this.add.graphics');
  const deckBlock = planetSrc.slice(deckStart, planetSrc.indexOf('this.world.add(this.fieldDeckLabels)', deckStart));
  check('SF10 no strokeRect remains for the farm outline',
    !/strokeRoundedRect|\.strokeRect/.test(deckBlock),
    deckBlock.match(/strokeRoundedRect|\.strokeRect/) && 'stroke call still present');
  // runtime audit: count >= perimeter/2 - gaps
  check('SF10 post count must be >= perimeter/2 minus gate gaps',
    /farmFencePosts\.length < perimeterPosts - farmFenceGapTiles/.test(block));
}

// ── SF07: fence beams must not fuse into one full-width cyan stroke ──
{
  const src = readFileSync('client/scenes/PlanetScene.js', 'utf8');
  const i = src.indexOf("'decor.fence_beam_a'\n");
  const block = src.slice(Math.max(0, i - 700), i + 120);
  check('SF07 fence beam width is post-to-post minus inset (no +1 tile overhang)',
    /const wpx = \(sp\.x1 - sp\.x0\) \* T - FENCE_BEAM_INSET \* 2;/.test(block) && !/\(sp\.x1 - sp\.x0 \+ 1\) \* T/.test(block));
  const inset = Number((src.match(/const FENCE_BEAM_INSET = (\d+)/) || [])[1]);
  const alpha = Number((src.match(/const FENCE_BEAM_ALPHA = ([\d.]+)/) || [])[1]);
  check('SF07 fence beams leave a visible gap at each post (inset >= 4px)', inset >= 4, String(inset));
  check('SF07 fence beams are translucent (alpha <= 0.6)', alpha > 0 && alpha <= 0.6, String(alpha));
  check('SF07 fence beams are drawn with a thin height and the alpha constant',
    /setDisplaySize\(wpx, [1-3]\)\.setAlpha\(FENCE_BEAM_ALPHA\)/.test(block));
}

// ── 17. SF13 gate: the crawl panel fits its text (height derived from text
//     bounds + 28px padding, no fixed 300 slab), frames itself colony-style
//     (1px teal stroke + 4 corner bracket ticks + two-stacked-rect gradient),
//     and the BEEP droid's drift lane is bounds-checked against the panel rect
//     so the cameo stays in the outer margins, never over the text.
//     Negative control: FAILS on the old code (fixed 300px height, 3px stroke,
//     no brackets, droid lane hard-coded at y=300 INSIDE the panel band). ──
{
  const introSrc = read('client/scenes/IntroScene.js');
  const crawlBlock = (() => {
    const i = introSrc.indexOf('this.crawlPanel =');
    return i < 0 ? '' : introSrc.slice(Math.max(0, i - 1400), i + 1200);
  })();
  check('SF13 crawl panel block exists', crawlBlock.length > 300);
  check('SF13 panel height derives from text bounds + 28px padding (no fixed 300)',
    /Math\.round\(sampler\.height\) \+ 28/.test(crawlBlock) && !/crawlPanel = this\.add\.rectangle[\s\S]{0,80}?300,/.test(crawlBlock));
  check('SF13 crawl text style is single-sourced (sampler reuses it)', /const crawlStyle = \{/.test(introSrc) &&
    /const sampler = this\.add\.text\(width \/ 2, height \* 0\.42, sampleText, crawlStyle\)/.test(introSrc) &&
    /'', crawlStyle\)/.test(crawlBlock));
  check('SF13 panel stroke is 1px teal', /setStrokeStyle\(1,\s*0x39c5bb/.test(crawlBlock));
  check('SF13 corner bracket ticks drawn (colony style)', /_drawCrawlBrackets\(brackets/.test(crawlBlock) &&
    /lineStyle\(2,\s*0x67e1cd/.test(crawlBlock));
  check('SF13 bracket arms + inset are numeric constants', /const inset = 6/.test(introSrc) && /const arm = 14/.test(introSrc));
  check('SF13 vertical gradient = two stacked backing rects', /crawlPanelTop/.test(crawlBlock));
  check('SF13 droid lane is derived from the panel rect bounds', /droidLane|laneTop|laneBottom/.test(crawlBlock) &&
    /crawlPanelRect\s*=\s*\{ left:/.test(crawlBlock));
  check('SF13 lane keeps 22px + half-sprite margin outside the panel', /- 22 - droidHalf/.test(crawlBlock) &&
    /\+ 22 \+ droidHalf/.test(crawlBlock));
  check('SF13 droid bounds-checked against the panel rect every frame',
    /if \(db\.right > pb\.left && db\.left < pb\.right && db\.bottom > pb\.top && db\.top < pb\.bottom\)/.test(introSrc) &&
    /db\.y - halfD|d\.y - halfD/.test(introSrc));
  check('SF13 no hard-coded droid y=300 remains', !/this\.introDroid\.y\s*=\s*300/.test(introSrc));
  // numeric sanity: recompute the lane vs panel band like the scene does
  const laneNums = crawlBlock.match(/laneTop = this\.crawlPanelRect\.top - (\d+) - droidHalf/) || [];
  check('SF13 lane margin >= 20px (numeric)', laneNums.length > 0 && Number(laneNums[1]) >= 20, laneNums[1] || 'no laneTop literal');
}

// ── SF15: panel footer hints are the most important text — amber #f7d698 and
//     >= 11px; meta text one step brighter and >= 11px; every panel border in
//     the teal trim family (QA 0904B.16: shop border was bright GREEN 0x9ddd72,
//     hub/dialog footers were 9px dim grey — gate FAILS on that old code). ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const hubSrc = read('client/systems/ColonyHub.js');
  const diaSrc = read('client/systems/DialoguePanel.js');

  // amber footer hint style: every static footer/close hint declaration
  const footers = [
    ['GE close', /\[CLOSE: SPACE\][\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['shop close', /\[CLOSE: SPACE\][\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['ranch close', /\[CLOSE: SPACE\][\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['quest close', /\[Q\] CLOSE[\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['backpack close', /\[SPACE\/B\] CLOSE[\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['smithy close', /\[SPACE\/B\] CLOSE[\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
    ['hub close', /\[ESC \/ B\] close[\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/],
  ];
  const AMBER = '#f7d698';
  for (const [name, re] of footers) {
    const m = planetSrc.match(re) || (name === 'hub close' ? hubSrc.match(re) : null) || hubSrc.match(re);
    const ok = m && Number(m[1]) >= 11 && m[2] === AMBER;
    check(`SF15 ${name} footer hint is amber >= 11px`, ok,
      m ? `${m[1]}px ${m[2]}${ok ? ' (ok)' : ' — must be >= 11px ' + AMBER}` : 'footer text not found');
  }
  // DialoguePanel footer hint (shared panel helper, used by every scene)
  const diaHint = diaSrc.match(/this\.hint\s*=\s*scene\.add\.text\(boxR - 4[\s\S]{0,180}?fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#f7d698|#[0-9a-f]+)'/);
  check('SF15 dialogue footer hint is amber >= 11px',
    diaHint && Number(diaHint[1]) >= 11 && diaHint[2] === AMBER,
    diaHint ? `${diaHint[1]}px ${diaHint[2]}${Number(diaHint[1]) >= 11 && diaHint[2] === AMBER ? ' (ok)' : ' — must be >= 11px ' + AMBER}` : 'dialog hint not found');

  // meta text >= 11px (hub sub-line, hub row hints, dialogue footer setter)
  const metaSizes = [...hubSrc.matchAll(/fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'#(?:7fb8ae|8fb8ae|8a90b0|93aeb7|93d7cc|a9d9d0|b0c8d1|f7d698)['"]/g)]
    .map((m) => parseFloat(m[1]));
  check('SF15 hub meta text >= 11px (no 9px/10px dim meta remains)',
    metaSizes.length >= 2 && metaSizes.every((n) => n >= 11),
    `${metaSizes.length} meta literals, min ${Math.min(...metaSizes)}px`);
  const planetMetaSmall = [...planetSrc.matchAll(/fontSize:\s*['"](\d+(?:\.\d+)?)px['"],\s*color:\s*'(#8a90b0|#93aeb7|#7fb8ae|#8fb8ae|#8dc9c0)'/g)]
    .map((m) => parseFloat(m[1]));
  check('SF15 planet meta text >= 11px (no dim grey 10px meta remains)',
    planetMetaSmall.length === 0,
    planetMetaSmall.length ? `${planetMetaSmall.length} dim small meta remain` : 'none');

  // panel border colors: thick (>=2px) strokes in the scene + shared helpers
  // must ALL sit in the teal trim family (amber accents live in TEXT, not borders).
  const ALLOWED_TEAL = ['0x67e1cd', '0x6be7d0', '0x39c5bb', '0x3ec6c0', '0x7adfd5', '0x7ef0ff'];
  const strokes = [];
  for (const [name, src] of [['planet', planetSrc], ['hub', hubSrc], ['dialog', diaSrc]]) {
    for (const m of src.matchAll(/setStrokeStyle\((\d+(?:\.\d+)?)\s*,\s*(0x[0-9a-fA-F]+)/g)) {
      if (parseFloat(m[1]) >= 2) strokes.push([name, m[1], m[2]]);
    }
  }
  const offTeal = strokes.filter(([, , hex]) => ALLOWED_TEAL.indexOf(hex.toLowerCase()) === -1);
  check(`SF15 every panel border >= 2px is teal (${ALLOWED_TEAL.join(' | ')})`,
    strokes.length > 0 && offTeal.length === 0,
    offTeal.length ? `off-teal borders: ${offTeal.map(([f, w, h]) => `${f}(${w}px ${h})`).join(', ')}` : `${strokes.length} thick strokes, all teal`);
  // negative control against the old bug: the bright GREEN shop border is gone
  check('SF15 shop panel border no longer bright green 0x9ddd72',
    !/setStrokeStyle\(3,\s*0x9ddd72/.test(planetSrc) &&
    !/setStrokeStyle\(2,\s*0x9ddd72/.test(planetSrc));
  // QA 0904B.7 — interior habitat surround + warm lamp pools: the builder
  // must draw an opaque deck apron LARGER than the room (so black never touches
  // the room edge) with a teal hull ring + airlock collar, and interior lamp
  // pools must be tinted warm amber 0xffbe5a at alpha >= 0.25.
  const apronDim = [...planetSrc.matchAll(/rectangle\(cx,\s*cy,\s*W \+ (\d+),\s*H \+ (\d+),\s*0x([0-9a-f]+),\s*1\)/g)];
  const apronBig = apronDim.length > 0 && apronDim.every((m) => parseFloat(m[1]) >= 40 && parseFloat(m[2]) >= 40);
  const hullRing = /setStrokeStyle\(2,\s*0x67e1cd/.test(planetSrc) && /airlock collar/.test(planetSrc);
  check('QA0904B.7 interior surround: opaque deck apron bigger than room + teal hull ring/airlock collar',
    apronBig && hullRing,
    apronBig && hullRing ? 'apron dims ' + apronDim.map((m) => `${m[1]}+${m[2]}`).join('/') + ', ring + collar present'
      : `apron=${apronDim.length ? apronDim.map((m) => `${m[1]}+${m[2]}`).join('/') : 'none'} ring=${hullRing}`);
  const warmLamps = [...planetSrc.matchAll(/setTint\(0xffbe5a\)\.setAlpha\(0\.(\d+)\)/g)].map((m) => parseFloat('0.' + m[1]));
  const lampOk = warmLamps.length >= 2 && warmLamps.every((a) => a >= 0.25);
  check('QA0904B.7 interior lamp pools tinted 0xffbe5a with alpha >= 0.25',
    lampOk,
    warmLamps.length ? `lamps: ${warmLamps.length} tints, min alpha ${Math.min(...warmLamps)}` : 'no warm lamp tints found');

}

{
  // SF28 — season banner: the year turn is a FELT event. The server calendar
  // rolls state.season over (shared/calendar.js: 30 days = 1 season); the
  // browser used to just update this.season silently. Gate the new
  // _seasonBanner wiring statically against the PlanetScene source.
  const planetSrc = read('client/scenes/PlanetScene.js');

  check('SF28 _seasonBanner method defined',
    /_seasonBanner\(season\) \{/.test(planetSrc));

  const bannerBody = planetSrc.slice(planetSrc.indexOf('_seasonBanner(season) {'),
    planetSrc.indexOf('// [SF28] QA hook'));

  check('SF28 banner container is screen-anchored',
    /\.setScrollFactor\(0\)/.test(bannerBody) && /setDepth\(1500\)/.test(bannerBody));

  check('SF28 banner plate is dark slate with teal 2px stroke',
    /fillStyle\(0x0c1019,\s*0\.88\)/.test(bannerBody) &&
    /lineStyle\(2,\s*0x67e1cd/.test(bannerBody));

  check('SF28 big season text is amber >=22px with stroke',
    /fontSize:\s*'2[2-9]px',\s*color:\s*'#f7d698'[\s\S]{0,120}stroke:\s*'#000'/.test(bannerBody));

  check('SF28 banner headline is "${NAME} HAS COME"',
    /`\$\{name\} HAS COME`/.test(bannerBody));

  for (const [k, v] of [
    ['SPRING', 'Thaw on the ridge — sow wheat and tomatoes.'],
    ['SUMMER', 'Long light — berries and melons ripen.'],
    ['FALL',   'Harvest moon — peppers and wheat again.'],
    ['WINTER', 'Cold stars — only glow-kelp grows now.'],
  ]) {
    check(`SF28 ${k} subtitle present`, bannerBody.includes(v));
  }

  check('SF28 fade-in 400ms / hold 2600ms / fade-out 600ms',
    /duration:\s*400\b/.test(bannerBody) &&
    /duration:\s*600,\s*delay:\s*2600/.test(bannerBody));

  check('SF28 banner destroys itself after the fade',
    /onComplete:\s*\(\) => c\.destroy\(\)/.test(bannerBody));

  check('SF28 banner plays the star sfx if audio exists',
    /if \(this\.audio\) this\.audio\.sfx\('star'\)/.test(bannerBody));

  // The sync block must compare against _shownSeason BEFORE calling the
  // banner (first sync silent) and init _shownSeason undefined in create.
  const syncStart = planetSrc.indexOf('if (net.room.state.season !== undefined)');
  const bannerCallIdx = planetSrc.indexOf('this._seasonBanner(season)', syncStart);
  const afterIdx = planetSrc.indexOf('this._shownSeason = season;', bannerCallIdx);
  check('SF28 sync compares _shownSeason before calling the banner',
    /this\._shownSeason !== undefined && season !== this\._shownSeason/.test(planetSrc.slice(syncStart, bannerCallIdx)) &&
    bannerCallIdx > syncStart);
  check('SF28 sync sets _shownSeason = season after the banner call',
    afterIdx > bannerCallIdx &&
    planetSrc.slice(bannerCallIdx, afterIdx).includes('this._shownSeason = season;') === false);
  check('SF28 _shownSeason inits undefined in create',
    /this\._shownSeason = undefined;/.test(planetSrc));

  check('SF28 window.SpaceFarmer.seasonBanner hook exists',
    /window\.SpaceFarmer\.seasonBanner = \(s\) => this\._seasonBanner\(s\)/.test(planetSrc));
}

// ── SF29 — seasonal ground grading: the world must not look identical in
//    all four seasons. Ground tiles + farm tiles are tinted per season
//    (water stays untinted so the shimmer keeps its hue), and natural decor
//    (trees / bushes / alien flora) takes the flora grade; lamps and tech
//    props are never tinted.
{
  const planetSrc = read('client/scenes/PlanetScene.js');

  const gradeBody = planetSrc.slice(planetSrc.indexOf('const SEASON_GRADE = ['),
    planetSrc.indexOf('];', planetSrc.indexOf('const SEASON_GRADE = [')) + 2);
  const rows = gradeBody.match(/ground:\s*0x[0-9a-f]{6}\s*,\s*flora:\s*0x[0-9a-f]{6}/gi) || [];
  check('SF29 SEASON_GRADE has 4 entries with 4 distinct ground tints',
    rows.length === 4 && new Set(rows.map(r => r.match(/ground:\s*0x[0-9a-f]{6}/i)[0])).size === 4,
    `got ${rows.length} rows`);

  const grounds = rows.map(r => parseInt(r.match(/ground:\s*(0x[0-9a-f]+)/i)[1], 16));
  const rgb = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const [spring, summer, fall, winter] = grounds;
  const wr = rgb(winter), fr = rgb(fall);

  // ── SF41: the painterly sky grades with the season ──
  const skyGrade = planetSrc.slice(planetSrc.indexOf('const SKY_GRADE = ['),
    planetSrc.indexOf('];', planetSrc.indexOf('const SKY_GRADE = [')) + 2);
  const skyVals = (skyGrade.match(/0x[0-9a-f]{6}/gi) || []).map(h => parseInt(h, 16));
  const sr = skyVals.map(rgb);
  check('SF41 SKY_GRADE has 4 distinct season tints',
    skyVals.length === 4 && new Set(skyVals).size === 4,
    `got ${skyVals.length} tints, distinct=${new Set(skyVals).size}`);
  check('SF41 winter sky tint is cool (b > r)',
    sr[3] && sr[3][2] > sr[3][0], `winter sky rgb(${sr[3] ? sr[3].join(',') : 'n/a'})`);
  check('SF41 fall sky tint is warm (r > b)',
    sr[2] && sr[2][0] > sr[2][2], `fall sky rgb(${sr[2] ? sr[2].join(',') : 'n/a'})`);
  check('SF41 spring sky tint is neutral 0xffffff', sr[0] && sr[0].join(',') === '255,255,255');
  // ── SF46: portraits gain warm (_3) / troubled (_4) reaction faces on gifts ──
  {
    const ps46 = readFileSync(path.join(root, 'client/scenes/PlanetScene.js'), 'utf8');
    const ss46 = readFileSync(path.join(root, 'client/systems/SpriteSystem.js'), 'utf8');
    check('SF46 GIFT_FACE maps loved→3 and hated→4', /const GIFT_FACE = \{ loved: 3, hated: 4 \}/.test(ps46));
    check('SF46 both gift paths pass the reaction face', (ps46.match(/GIFT_FACE\[(res\.)?tier\]/g) || []).length === 2);
    check('SF46 reaction face suppresses the blab loop', /!this\._diaDone && !this\._diaFace/.test(ps46));
    check('SF46 closeAllPanels resets the face', /this\._diaFace = 0;/.test(ps46));
    check('SF46 portrait generator builds 5 frames', /\[0, 1, 2, 3, 4\]\.map\(/.test(ss46));
  }
  check('SF41 winter sky tint equals 0xc8d8f8', skyVals[3] === 0xc8d8f8);
  check('SF41 applySeasonGrade tints skyTile',
    /if \(this\.skyTile\) this\.skyTile\.setTint\(SKY_GRADE\[s\]\)/.test(planetSrc));
  check('SF41 applySeasonGrade tints planet sprites too',
    /planetSpr2\) this\.planetSpr2\.setTint\(SKY_GRADE\[s\]\)/.test(planetSrc));
  check('SF29 winter ground tint is cool (b > r)', wr && wr[2] > wr[0],
    `winter 0x${winter && winter.toString(16)} rgb(${wr ? wr.join(',') : 'n/a'})`);
  check('SF29 fall ground tint is warm (r > b)', fr && fr[0] > fr[2],
    `fall 0x${fall && fall.toString(16)} rgb(${fr ? fr.join(',') : 'n/a'})`);
  check('SF29 summer ground tint is warm gold (r > b)',
    summer !== undefined && rgb(summer)[0] > rgb(summer)[2]);
  check('SF29 spring ground tint is neutral 0xffffff', spring === 0xffffff);

  const method = planetSrc.slice(planetSrc.indexOf('applySeasonGrade(season) {'),
    planetSrc.indexOf('applySeasonGrade(season) {') + 900);
  check('SF29 applySeasonGrade is idempotent (_gradedSeason guard)',
    /_gradedSeason === s\) return/.test(method));
  check('SF29 applySeasonGrade excludes waterTiles',
    /waterTiles\.map\(w => w\.img\)/.test(method) && /!water\.has\(img\)/.test(method));
  check('SF29 applySeasonGrade tints every farm tile (never clears tint)',
    /farmTiles\) ft\.img\.setTint\(grade\.ground\)/.test(planetSrc) &&
    /clearTint/.test(planetSrc) === false);
  check('SF29 applySeasonGrade tints natural decor, not lamps/tech',
    /\/tree\|bush\|flora\//.test(method));
  const createEnd = planetSrc.indexOf('this.updateNightVisuals();', planetSrc.indexOf('create() {'));
  const gradeTail = planetSrc.indexOf('this.applySeasonGrade(this.season ?? 0)', createEnd);
  check('SF29 create() applies the initial season grade',
    /applySeasonGrade\(this\.season \?\? 0\)/.test(planetSrc.slice(createEnd, gradeTail + 60)));
  const syncIdx = planetSrc.indexOf('this.applySeasonGrade(season);');
  check('SF29 season sync re-grades on season change',
    syncIdx > planetSrc.indexOf('net.room.state.season') && syncIdx !== -1,
    'call found after the room.state.season read');
  check('SF29 window.SpaceFarmer.setSeasonGrade hook exists',
    /window\.SpaceFarmer\.setSeasonGrade = \(s\) => this\.applySeasonGrade\(s\)/.test(planetSrc));
}

// ── SF30: living water & fields (ROADMAP A1) ──
{
  const planetSrc = readFileSync('client/scenes/PlanetScene.js', 'utf8');
  const updIdx = planetSrc.indexOf('update(time) {');
  const sway = planetSrc.slice(updIdx, planetSrc.indexOf('_updateInteractPrompt(time)', updIdx));
  check('SF30 update() sways crops with Math.sin + per-tile phase',
    /Math\.sin\(time \/ 700 \+ \(ft\.x \* 0\.9 \+ ft\.y \* 1\.7\)\)/.test(sway));
  check('SF30 sway amplitude ≤ 4 degrees (0 when reduced motion is on)', /\* swayAmp\)/.test(sway));
  check('SF30 crop sprite origin bottom-center',
    /setOrigin\(0\.5, 1\)/.test(planetSrc));
  const glIdx = planetSrc.indexOf('_waterGlint(tx, ty)');
  const gl = glIdx === -1 ? '' : planetSrc.slice(glIdx, glIdx + 900);
  check('SF30 _waterGlint defined', glIdx !== -1);
  check('SF30 glint motes are add-blended cyan',
    /BlendModes\.ADD/.test(gl) && /0x8fe9ff/.test(gl));
  check('SF30 glint motes rise + fade then destroy',
    /y: g\.y - 10/.test(gl) && /alpha: 0/.test(gl) && /onComplete: \(\) => \{ g\.destroy\(\); \}/.test(gl));
  const waterIdx = planetSrc.indexOf("this._tileFX(s.x, s.y, 'water');");
  const waterPath = planetSrc.slice(Math.max(0, waterIdx - 700), waterIdx + 120);
  check('SF30 water path calls _waterGlint on the tile',
    /_waterGlint\(s\.x, s\.y\)/.test(waterPath));
  check('SF30 window.SpaceFarmer.waterGlint hook exists',
    /window\.SpaceFarmer\.waterGlint = \(x, y\) => this\._waterGlint\(x, y\)/.test(planetSrc));
  check('SF30 crop stage transitions refresh the crop sprite',
    /_setCropSprite\(ft\)/.test(planetSrc) && /_setCropSprite\(local\)/.test(planetSrc));
}

// ── SF31 — ROADMAP A1 'The first bell': the plaza mission bell tower ──
{
  // 1) the tower sprite exists in the SpriteSystem registry at the shared 64px
  //    building scale, painted with amber/brass bell + teal trim pixels
  const btTex = TEXTURES['bld.bell_tower'];
  check('SF31 bld.bell_tower registered in TEXTURES', !!btTex);
  if (btTex) {
    check('SF31 bell tower is at the shared 64px building scale',
      btTex.width === TEXTURES['bld.barn'].width && btTex.height === TEXTURES['bld.barn'].height,
      `${btTex.width}x${btTex.height} vs ${TEXTURES['bld.barn'].width}x${TEXTURES['bld.barn'].height}`);
    let amber = 0, teal = 0, slate = 0;
    for (let y = 0; y < btTex.height; y++) for (let x = 0; x < btTex.width; x++) {
      const p = SS.px(btTex, x, y);
      if (p[3] <= 0) continue;
      if (p[0] >= 200 && p[1] >= 150 && p[2] <= 200) amber++;
      if (p[1] >= 150 && p[2] >= 150 && p[0] <= 130) teal++;
      if (p[0] <= 70 && p[1] <= 80 && p[2] <= 110) slate++;
    }
    check('SF31 bell tower paints amber/brass bell pixels', amber > 20, `${amber} amber px`);
    check('SF31 bell tower paints teal trim pixels', teal > 10, `${teal} teal px`);
    check('SF31 bell tower paints slate hull pixels', slate > 60, `${slate} slate px`);
  }
  // 2) role + semantic key registered in AssetTheme THEME.bld
  const theme = AT.THEME;
  check('SF31 bellTower role registered in THEME.bld',
    theme.bld && theme.bld.bellTower === 'bld.bell_tower');
  check('SF31 semantic key bld.bell_tower resolves through THEME.bld',
    theme.bld && theme.bld.bell_tower === 'bld.bell_tower');
  check('SF31 resolveKey("bld.bell_tower") returns the texture key',
    AT.resolveKey('bld.bell_tower') === 'bld.bell_tower');
  // 3) DECOR entry: inside TOWN plaza bounds, clear of every conflict
  const TOWN = { x0: 18, x1: 41, y0: 26, y1: 46 };
  const entries = DECOR.filter(d => d.tex === 'bld.bell_tower');
  check('SF31 bell tower is a DECOR entry (not BUILDINGS)', entries.length === 1
    && !BUILDINGS.some(b => b.tex === 'bld.bell_tower' || b.key === 'bell_tower'));
  const bt = entries[0];
  if (bt) {
    check('SF31 bell tower sits inside TOWN bounds',
      bt.x >= TOWN.x0 && bt.x <= TOWN.x1 && bt.y >= TOWN.y0 && bt.y <= TOWN.y1,
      JSON.stringify(bt));
    check('SF31 bell tower stands on plaza ground (TOWN zone)',
      ground[bt.y] && ground[bt.y][bt.x] === 'plaza', `${ground[bt.y]?.[bt.x]}`);
    check('SF31 bell tower tile is walkable', !blocks[bt.y]?.[bt.x], 'blocked');
    check('SF31 bell tower is NOT on the vertical road (x 24..25)',
      bt.x < 24 || bt.x > 25);
    check('SF31 bell tower is NOT on the horizontal road (y 22..23)',
      bt.y < 22 || bt.y > 23);
    check('SF31 bell tower is NOT on a building footprint',
      !BUILDINGS.some(b => bt.x >= b.x && bt.x < b.x + (b.w || 4)
        && bt.y >= b.y && bt.y < b.y + (b.h || 4)));
    check('SF31 bell tower is NOT on an NPC_POS tile',
      !Object.values(NPC_POS).some(p => p.x === bt.x && p.y === bt.y));
    const others = DECOR.filter(d => d !== bt && d.x === bt.x && d.y === bt.y);
    check('SF31 bell tower does not share a tile with other decor', others.length === 0,
      JSON.stringify(others));
  }
  // 4) walkability still passes with the tower on the plaza
  const walk31 = verifyWalkability();
  check('SF31 verifyWalkability() still true', walk31.ok === true,
    JSON.stringify(walk31.unreachable?.slice(0, 5)));
  // 5) PlanetScene wiring: ring the bell only on festival dawn, lore on SPACE
  const planetSrc = read('client/scenes/PlanetScene.js');
  check('SF31 PlanetScene keeps a handle on the bell decor sprite',
    /if \(d\.tex === 'bld\.bell_tower'\) this\.bellTower = img;/.test(planetSrc));
  const phaseIdx = planetSrc.indexOf('setFestivalPhase(phase) {');
  const phaseBody = phaseIdx === -1 ? '' : planetSrc.slice(phaseIdx, planetSrc.indexOf('_feastPeakBurst() {', phaseIdx));
  const ringCallsIdx = phaseBody.indexOf("if (phase === 'setup') this._ringBell();");
  const ringCallsSlice = ringCallsIdx === -1 ? '' : phaseBody.slice(0, ringCallsIdx);
  check('SF31 setFestivalPhase rings the bell on festival dawn (setup)', ringCallsIdx !== -1);
  check('SF31 setFestivalPhase rings the bell ONLY for setup',
    ringCallsSlice.indexOf('_ringBell') === -1
      && !/phase === ['"]none['"][^;]*this\._ringBell/.test(phaseBody)
      && !/phase === ['"]afterglow['"][^;]*this\._ringBell/.test(phaseBody));
  const bellIdx = planetSrc.indexOf('_ringBell() {');
  const bellBody = bellIdx === -1 ? '' : planetSrc.slice(bellIdx, planetSrc.indexOf('_showBellLore() {', bellIdx));
  check('SF31 _ringBell defined', bellIdx !== -1);
  check('SF31 _ringBell plays the star chime behind the audio guard',
    /if \(this\.audio\) this\.audio\.sfx\('star'/.test(bellBody));
  check('SF31 _ringBell swings the bell sprite ±6° with 4 yoyo swings',
    /angle: 6/.test(bellBody) && /yoyo: true/.test(bellBody) && /repeat: 3/.test(bellBody));
  check('SF31 _ringBell toast line present',
    bellBody.includes('The old bell rings over the plaza.'));
  check('SF31 _ringBell resets the bell angle when the swing ends',
    /setAngle\(0\)/.test(bellBody));
  check('SF31 lore line present (ONE line only)',
    planetSrc.includes('Cast before the colony, older than anyone remembers. It rings when the colony gathers.'));
  check('SF31 SPACE near the tower routes to _showBellLore',
    /bellDecor\.d\.x - ptx/.test(planetSrc) && /_showBellLore\(\)/.test(planetSrc));
  const loreIdx = planetSrc.indexOf('_showBellLore() {');
  const loreBody = loreIdx === -1 ? '' : planetSrc.slice(loreIdx, planetSrc.indexOf('// The climax beat', loreIdx));
  check('SF31 lore shows ONE line via showToast', /showToast\('Cast before the colony/.test(loreBody));
}

// ── SF32 — ROADMAP A1 'Weather & light': eased dusk/dawn + aurora sky event ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const nvIdx = planetSrc.indexOf('updateNightVisuals() {');
  const nv = nvIdx === -1 ? '' : planetSrc.slice(nvIdx, planetSrc.indexOf('export { PlanetScene }', nvIdx));
  check('SF32 updateNightVisuals kills any previous night tween',
    /this\.tweens\.killTweensOf\(this\.nightOverlay\)/.test(nv));
  const nightTwIdx = nv.indexOf('targets: this.nightOverlay');
  const nightTw = nightTwIdx === -1 ? '' : nv.slice(nightTwIdx, nv.indexOf('});', nightTwIdx));
  const ndurs = [...nightTw.matchAll(/duration: (\d+)/g)].map(m => +m[1]);
  check('SF32 night tween still eases (2500ms default, 400ms under reduced motion)',
    /duration: flipMs/.test(nightTw) &&
    /const flipMs = reducedMotion\(\) \? 400 : 2500;/.test(nv) &&
    (ndurs.length === 0 || Math.min(...ndurs) >= 1500),
    'durations=' + ndurs.join(','));
  check('SF32 final night alpha stays 0.62 / 0 (SF08 gate intact)',
    /this\.isNight \? 0\.62 : 0/.test(nv));
  check('SF32 dusk wash peaks mid-transition then returns to 0',
    /targets: this\.duskWash, alpha: \{ from: 0, to: 0\.12 \}/.test(nv)
      && /from: 0\.12, to: 0/.test(nv));
  const dwIdx = planetSrc.indexOf('this.duskWash = this.add.rectangle');
  const dw = dwIdx === -1 ? '' : planetSrc.slice(dwIdx, dwIdx + 220);
  check('SF32 dusk wash exists: amber-orange, screen-anchored, ADD blend',
    /0xff9a5a/.test(dw) && /BlendModes\.ADD/.test(dw) && /setScrollFactor\(0\)/.test(dw));
  check('SF32 dusk wash peak alpha ≤ 0.15', /0\.12/.test(dw));
  const auIdx = planetSrc.indexOf('this.aurora = [];');
  const au = auIdx === -1 ? '' : planetSrc.slice(auIdx, planetSrc.indexOf('SEASON AMBIENT', auIdx));
  const auColors = au.match(/auroraColors = \[(.*?)\]/)?.[1]?.split(',').map(s => s.trim()) || [];
  check('SF32 aurora: 3 ribbons screen-anchored with ADD blend',
    auColors.length === 3 && /for \(let ai = 0; ai < auroraColors\.length; ai\+\+\)/.test(au)
      && /setScrollFactor\(0\)/.test(au) && /BlendModes\.ADD/.test(au)
      && /this\.aurora\.push\(g\)/.test(au));
  const auAlphas = [...au.matchAll(/setAlpha\((\d?\.\d+)\)/g)].map(m => +m[1]);
  check('SF32 aurora alpha ≤ 0.18',
    auAlphas.length >= 1 && Math.max(...auAlphas) <= 0.18, 'alphas=' + auAlphas.join(','));
  check('SF32 aurora ribbon palette teal/green/violet',
    ['0x67e1cd', '0x7dffb0', '0xb08cff'].every(c => au.includes(c)));
  check('SF32 aurora sits above the night overlay, below the HUD',
    /setDepth\(90\d\)/.test(au));
  check('SF32 aurora gated on isNight', /const auroraOn = this\.isNight/.test(nv));
  check('SF32 aurora gated on dayCount % 3 (deterministic)',
    /\(this\.dayCount % 3\) === 0/.test(nv));
  const updIdx = planetSrc.indexOf('update(time) {');
  const upd = updIdx === -1 ? '' : planetSrc.slice(updIdx, planetSrc.indexOf('parallax backdrop', updIdx));
  check('SF32 aurora undulates in update() via sine y/scaleY',
    /Math\.sin\(rt \* 0\.00035/.test(upd) && /g\.setScale\(1,/.test(upd));
}

// ── SF33: contact doctrine history is server-authoritative (ROADMAP A2) ──
{
  const planetSrc = readFileSync('client/scenes/PlanetScene.js', 'utf8');
  // (1) create() no longer reads 'spacefarmer.firstContact' directly — the only
  // localStorage.getItem lives inside the offline-only helper.
  const getItemIdx = planetSrc.indexOf("localStorage.getItem('spacefarmer.firstContact')");
  const fnIdx = planetSrc.indexOf('_loadOfflineContacts() {');
  const fnEnd = fnIdx === -1 ? -1 : planetSrc.indexOf('\n  }\n', fnIdx);
  check('SF33 create() no longer reads firstContact from localStorage',
    getItemIdx !== -1 && fnIdx !== -1 && fnEnd > fnIdx && getItemIdx > fnIdx && getItemIdx < fnEnd,
    `getItem=${getItemIdx} fn=${fnIdx}-${fnEnd}`);
  check('SF33 create() seeds an empty contactChoices map',
    /this\.contactChoices = \{\};/.test(planetSrc));
  // (2) the localStorage.setItem in chooseContactDoctrine sits in the offline
  // branch only — never inside the shared apply() closure.
  const cdIdx = planetSrc.indexOf('\n  chooseContactDoctrine(');
  const cd = cdIdx === -1 ? '' : planetSrc.slice(cdIdx, planetSrc.indexOf('\n  _applyContactAftermath', cdIdx));
  const applyIdx = cd.indexOf('const apply = () => {');
  const applyEnd = cd.indexOf('};', applyIdx);
  check('SF33 apply() closure writes no localStorage',
    applyIdx !== -1 && applyEnd > applyIdx && cd.slice(applyIdx, applyEnd).indexOf('localStorage.setItem') === -1);
  const setIdx = cd.indexOf('localStorage.setItem');
  const netIdx = cd.indexOf('if (net && net.connected)');
  const elseIdx = cd.indexOf('} else {', netIdx);
  check('SF33 setItem sits inside the offline else branch',
    setIdx !== -1 && netIdx !== -1 && elseIdx !== -1 && elseIdx < setIdx && setIdx < cd.length,
    `set=${setIdx} net=${netIdx} else=${elseIdx}`);
  // (3) the state-sync hydration re-applies aftermath for any envoy whose
  // doctrine changed (choices recorded by another player/agent appear live).
  const hyIdx = planetSrc.indexOf('const prevContacts =');
  const hy = hyIdx === -1 ? '' : planetSrc.slice(hyIdx, planetSrc.indexOf('if (this.toolTiers.hoe)', hyIdx));
  check('SF33 sync hydrates contactChoices from the server schema',
    /Object\.fromEntries\(schemaEntries\(ps\.contactChoices\)\)/.test(hy));
  check('SF33 sync re-applies _applyContactAftermath on changed doctrine',
    /_applyContactAftermath\(alien, false\)/.test(hy) && /prev !== now/.test(hy));
}

{
  // SF35 — stardust + season haze: the sky is a living atmosphere between
  // meteors. ~40 tiny screen-anchored motes sit just above the sky (depth < 0
  // so they can never cover the world or HUD) and drift diagonally with
  // screen-edge wrap; one full-screen additive haze recolours per season.
  const planetSrc = read('client/scenes/PlanetScene.js');

  const dustIdx = planetSrc.indexOf('this.stardust = [];');
  const dustBody = dustIdx === -1 ? '' :
    planetSrc.slice(dustIdx, planetSrc.indexOf('SEASON HAZE', dustIdx));
  check('SF35 stardust block exists with ≥30 motes',
    /\bfor \(let si = 0; si < (\d+); si\+\+\)/.test(dustBody) &&
    parseInt(dustBody.match(/si < (\d+)/)[1], 10) >= 30 &&
    parseInt(dustBody.match(/si < (\d+)/)[1], 10) <= 60,
    `count=${dustBody.match(/si < (\d+)/)?.[1]}`);

  check('SF35 stardust motes are screen-anchored (scrollFactor 0)',
    /setScrollFactor\(0\)/.test(dustBody));
  check('SF35 stardust motes use ADD blend', /BlendModes\.ADD/.test(dustBody));
  check('SF35 stardust sits just above the sky, below the world (depth < 0)',
    /setDepth\(-\d+\)/.test(dustBody) && parseInt(dustBody.match(/setDepth\(-(\d+)\)/)[1], 10) > -60);
  const alphas = [...dustBody.matchAll(/0\.15 \+ lcg\(\) \* (\d+\.?\d*)/g)].map(m => 0.15 + parseFloat(m[1]));
  check('SF35 stardust alpha range stays within 0.15–0.45',
    alphas.length > 0 && alphas.every(a => a >= 0.15 && a <= 0.45),
    `got ${alphas.map(a => a.toFixed(2)).join(',')}`);
  check('SF35 stardust positions are deterministic (no Math.random)',
    /lcg\(\) \* width/.test(dustBody) && /Math\.random/.test(dustBody) === false);

  const hazeIdx = planetSrc.indexOf('this.seasonHaze = this.add.rectangle');
  const hazeBody = hazeIdx === -1 ? '' : planetSrc.slice(hazeIdx, hazeIdx + 320);
  check('SF35 seasonHaze is one screen-anchored full-screen rect',
    /setScrollFactor\(0\)/.test(hazeBody));
  check('SF35 seasonHaze sits below the film sheen (depth 963)',
    /setDepth\(963\)/.test(hazeBody));
  const haRows = planetSrc.slice(planetSrc.indexOf('const SEASON_HAZE = ['),
    planetSrc.indexOf('];', planetSrc.indexOf('const SEASON_HAZE = [')) + 2)
    .match(/color:\s*0x[0-9a-f]{6},\s*alpha:\s*(0?\.\d+)/gi) || [];
  const haVals = haRows.map(r => parseFloat(r.match(/alpha:\s*(0?\.\d+)/)[1]));
  check('SF35 haze colours: 4 rows, all alpha ≤ 0.10, all distinct',
    haRows.length === 4 && haVals.every(a => a <= 0.10) && new Set(haVals).size === 4,
    `got ${haRows.length} rows, alphas=${haVals.join(',')}`);
  const hazeColors = haRows.map(r => parseInt(r.match(/color:\s*0x([0-9a-f]+)/i)[1], 16));
  check('SF35 haze palette matches the card [spring green, summer amber, fall orange, winter blue]',
    hazeColors.length === 4 &&
    hazeColors[0] === 0x9fe8c0 && hazeColors[1] === 0xffd68a &&
    hazeColors[2] === 0xff9e5e && hazeColors[3] === 0xcfe0ff);

  const gradeEnd = planetSrc.indexOf('// ── UI builders ──');
  const gradeHaze = planetSrc.slice(planetSrc.indexOf('applySeasonGrade(season) {'), gradeEnd);
  check('SF35 applySeasonGrade recolours the season haze',
    /SEASON_HAZE\[s\] \|\| SEASON_HAZE\[0\]/.test(gradeHaze) &&
    /setFillStyle\(haze\.color\)\.setAlpha\(haze\.alpha\)/.test(gradeHaze));

  const updIdx = planetSrc.indexOf('if (this.stardust && !reducedMotion()) {');
  const updBody = updIdx === -1 ? '' : planetSrc.slice(updIdx, planetSrc.indexOf('if (st.y > height', updIdx) + 60);
  check('SF35 update() moves stardust diagonally with dt (skipped under reduced motion)',
    /st\.x \+= st\._vx \* dtS/.test(updBody) && /st\.y \+= st\._vy \* dtS/.test(updBody) &&
    updIdx >= 0);
  check('SF35 update() wraps stardust at the screen edges (drift gated on motion flag)',
    /st\.x > width \+ 2\) st\.x = -2/.test(updBody) && /st\.y > height \+ 2\) st\.y = -2/.test(updBody) &&
    updIdx >= 0);

  check('SF35 window.SpaceFarmer.stardustCount hook exists',
    /window\.SpaceFarmer\.stardustCount = \(\) => \(this\.stardust \? this\.stardust\.length : 0\)/.test(planetSrc));
}

// ── SF36 — ROADMAP A1 'festival lamp bloom' ──
{
  const planetSrc = readFileSync('client/scenes/PlanetScene.js', 'utf8');
  const phaseIdx = planetSrc.indexOf('setFestivalPhase(phase) {');
  const phaseEnd = phaseIdx === -1 ? -1 : planetSrc.indexOf('\n  _ringBell() {', phaseIdx);
  const phaseBody = phaseIdx === -1 || phaseEnd === -1 ? '' : planetSrc.slice(phaseIdx, phaseEnd);
  check('SF36 setFestivalPhase routes bloom: on → _startLampBloom, else → _stopLampBloom',
    /if \(on\) this\._startLampBloom\(\); else this\._stopLampBloom\(\);/.test(phaseBody));
  const startIdx = planetSrc.indexOf('_startLampBloom() {');
  const startEnd = startIdx === -1 ? -1 : planetSrc.indexOf('\n  _stopLampBloom() {', startIdx);
  const startBody = startIdx === -1 || startEnd === -1 ? '' : planetSrc.slice(startIdx, startEnd);
  const stopIdx = planetSrc.indexOf('_stopLampBloom() {');
  const stopEnd = stopIdx === -1 ? -1 : planetSrc.indexOf('\n  _ringBell() {', stopIdx);
  const stopBody = stopIdx === -1 || stopEnd === -1 ? '' : planetSrc.slice(stopIdx, stopEnd);
  check('SF36 _startLampBloom stores/restores tweens on _lampBloomTweens',
    /this\._lampBloomTweens = \[\];/.test(startBody) && /this\._lampBloomTweens\.push\(tw\)/.test(startBody));
  check('SF36 bloom scales lamps to 1.35x base, yoyo, 900ms, staggered index*80ms',
    /\* 1\.35/.test(startBody) && /yoyo: true/.test(startBody) && /duration: 900/.test(startBody) && /delay: i \* 80/.test(startBody));
  check('SF36 bloom alpha caps at min(1, base*1.6)',
    /alpha: Math\.min\(1, l\._baseAlpha \* 1\.6\)/.test(startBody));
  check('SF36 bloom tint is warm amber 0xffd68a',
    /setTint\(0xffd68a\)/.test(startBody));
  check('SF36 bloom code never calls setVisible(true)',
    !/setVisible\(true\)/.test(startBody) && !/setVisible\(true\)/.test(phaseBody));
  check('SF36 restore path stops tweens, kills target tweens, resets base scale/alpha',
    /tw\.stop\(\)/.test(stopBody) && /killTweensOf\(l\)/.test(stopBody) &&
    /l\.setScale\(/.test(stopBody) && /_baseScale/.test(stopBody) &&
    /l\.setAlpha\(/.test(stopBody) && /_baseAlpha/.test(stopBody));
  check('SF36 restore path clears the bloom tint (neutral white — SF29 keeps no clearTint)',
    /l\.setTint\(0xffffff\)/.test(stopBody) && !/clearTint\(\)/.test(planetSrc));
  check('SF36 lamp glows store base scale/alpha ONCE at creation',
    /glow\._baseScale = 1\.0;/.test(planetSrc) && /glow\._baseAlpha = glow\.alpha;/.test(planetSrc));
  check('SF36 SF08 night lamp scale stays ≥ 1.7 (bloom respects the night factor)',
    /l\._baseScale !== undefined \? l\._baseScale \* \(this\.isNight \? 1\.7 : 1\.0\)/.test(planetSrc));
}

// ── SF37 — ROADMAP A1 'Envoy auras and arrival flashes polished' ──
// Envoys landing LIVE (created after create()) pop in gently instead of
// hard-cutting into existence: sprite alpha 0 / scaleY 0.2 → full over 500ms
// (Back.Out), a teal ADD ring ripples radius 4 → 40 over 700ms then destroys
// itself, and the aura fades in from 0 to its normal alpha. Envoys created
// during create() must NOT animate (the colony opens calm).
// Negative control: pre-SF37 PlanetScene had no _envoyArrival at all — every
// check below FAILS on the old source.
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const fnIdx = planetSrc.indexOf('_envoyArrival(spr) {');
  check('SF37 _envoyArrival method exists', fnIdx >= 0);
  const fnBody = fnIdx >= 0 ? planetSrc.slice(fnIdx, planetSrc.indexOf('\n  }', fnIdx)) : '';
  check('SF37 arrival skips envoys created during create() (_createDone guard)',
    /!this\._createDone/.test(fnBody));
  check('SF37 sprite starts at alpha 0 / scaleY 0.2',
    /setAlpha\(0\)/.test(fnBody) && /setScale\(spr\.scaleX, 0\.2\)/.test(fnBody));
  check('SF37 sprite tween restores alpha 1 onComplete',
    /onComplete: \(\) => \{[\s\S]*?spr\.setAlpha\(1\)/.test(fnBody));
  check('SF37 ring uses ADD blending',
    /setBlendMode\(Phaser\.BlendModes\.ADD\)/.test(fnBody));
  check('SF37 ring expands radius 4 → 40 and fades over 700ms',
    /radius: 40/.test(fnBody) && /alpha: 0/.test(fnBody) && /duration: 700/.test(fnBody));
  check('SF37 ring destroys onComplete',
    /onComplete: \(\) => ring\.destroy\(\)/.test(fnBody));
  check('SF37 aura fades in 0 → its normal alpha',
    /aura\.setAlpha\(0\)/.test(fnBody) && /alpha: auraBase/.test(fnBody));
  check('SF37 create() flags the initial load and unlocks live arrivals',
    /this\._createDone = false;/.test(planetSrc) && /this\._createDone = true;/.test(planetSrc));
  check('SF37 create() calls _envoyArrival for every envoy (guarded by the flag)',
    /this\._envoyArrival\(spr\)/.test(planetSrc));
  check('SF37 live hook window.SpaceFarmer.envoyArrival routes to _envoyArrival',
    /window\.SpaceFarmer\.envoyArrival = \(i = 0\) =>/.test(planetSrc));
  check('SF37 idle breathing yields alpha/scaleY while an arrival tween runs',
    /if \(a\._arrival\) continue/.test(planetSrc));
  check('SF37 PlanetScene.prototype._envoyArrival exists',
    typeof PS.PlanetScene.prototype._envoyArrival === 'function');
}

// ── SF38 — ROADMAP A1 'Portraits & mood' ──
// The dialogue portrait plate must react to friendship: MOOD_TIERS (module scope)
// holds 4 tiers with ASCENDING thresholds and DISTINCT colours (slate → teal →
// amber → rose); the dialogue-open path calls the tint helper with the NPC's
// heart level; the plate's stroke/fill take that tier colour; a tiny '♥ n'
// badge sits under the portrait and is cleared (destroyed/hidden + text wiped)
// when dialogue closes.
// Negative control: pre-SF38 PlanetScene had no MOOD_TIERS/_applyPortraitMood —
// every check below FAILS on the old source.
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const tiersIdx = planetSrc.indexOf('const MOOD_TIERS =');
  check('SF38 MOOD_TIERS is a module-scope const', tiersIdx >= 0 && planetSrc.indexOf('const MOOD_TIERS', tiersIdx + 14) === -1);
  const tiers = tiersIdx >= 0 ? planetSrc.slice(tiersIdx, planetSrc.indexOf('];', tiersIdx)) : '';
  check('SF38 MOOD_TIERS has exactly 4 tiers',
    tiers !== '' && (tiers.match(/\{ min:/g) || []).length === 4);
  const mins = [...tiers.matchAll(/min:\s*(\d+)/g)].map(m => Number(m[1]));
  const cols = [...tiers.matchAll(/color:\s*(0x[0-9a-fA-F]+)/g)].map(m => m[1]);
  check('SF38 tiers have ascending thresholds', mins.length === 4 && mins[0] < mins[1] && mins[1] < mins[2] && mins[2] < mins[3]);
  check('SF38 tiers have distinct colours',
    cols.length === 4 && new Set(cols).size === 4 &&
    cols.includes('0x3a4656') && cols.includes('0x67e1cd') &&
    cols.includes('0xf7d698') && cols.includes('0xff9ec4'));
  check('SF38 moodTierFor picks the highest unlocked tier',
    /let tier = MOOD_TIERS\[0\][\s\S]*?for \(const t of MOOD_TIERS\) if \(h >= t\.min\) tier = t/.test(planetSrc));
  check('SF38 moodHeartsFor scales hearts with friendship',
    /const moodHeartsFor = \(fp\) => fp === 0 \? 0 : fp < 20 \? 1 : fp < 40 \? 3 : fp < 60 \? 5 : fp < 80 \? 7 : 9/.test(planetSrc));
  check('SF38 _applyPortraitMood tint helper exists',
    typeof PS.PlanetScene.prototype._applyPortraitMood === 'function');
  const moodIdx = planetSrc.indexOf('_applyPortraitMood(h) {');
  const moodBody = moodIdx >= 0 ? planetSrc.slice(moodIdx, planetSrc.indexOf('\n  }', moodIdx)) : '';
  check('SF38 helper tints BOTH plate stroke and fill',
    moodBody !== '' && /setStrokeStyle\(2, tier\.color\)/.test(moodBody) && /setFillStyle\(tier\.color, 0\.18\)/.test(moodBody));
  check('SF38 dialogue-open path calls the tint helper with heart level',
    /this\._applyPortraitMood\(moodHeartsFor\(fp\)\)/.test(planetSrc));
  check('SF38 heart badge text is amber 10px with ♥ glyph',
    /fontSize: '10px', color: '#f7d698'/.test(moodBody) && /`♥ \$\{h\}`/.test(moodBody));
  check('SF38 heart badge is screen-fixed under the portrait',
    moodBody !== '' && /setScrollFactor\(0\)/.test(moodBody) && /plate\.y \+ 32/.test(moodBody));
  const clearIdx = planetSrc.indexOf('_clearPortraitMood() {');
  const clearBody = clearIdx >= 0 ? planetSrc.slice(clearIdx, planetSrc.indexOf('\n  }', clearIdx)) : '';
  check('SF38 clear helper exists',
    typeof PS.PlanetScene.prototype._clearPortraitMood === 'function');
  check('SF38 clear hides/wipes the heart text on close',
    clearBody !== '' && /setVisible\(false\)/.test(clearBody) && /setText\(''\)/.test(clearBody) && /this\._moodHeartText = null/.test(clearBody));
  check('SF38 clear resets the plate to neutral colony colours',
    clearBody !== '' && /0x39c5bb/.test(clearBody) && /0x141426/.test(clearBody));
  check('SF38 closeAllPanels calls the clear helper beside dialog.hide()',
    /this\.dialog\.hide\(\); this\._clearPortraitMood\(\);/.test(planetSrc));
}

// ── SF49 — ROADMAP A4 accessibility: reduced motion ──
// Contract: Motion.js exports reducedMotion() reading BOTH sources (the local
// `sf.reducedMotion` key first, then prefers-reduced-motion), plus an explicit
// setReducedMotion(on) writer; PlanetScene checks it at every motion site
// (crop sway amplitude, stardust drift, festival lamp bloom = tint-only, and
// the dusk/dawn flip easing, plus aurora/crowd/bell/interior/parallax sites),
// and F9 (M is the hub toggle) flips the flag and toasts ON/OFF.
// Negative control: pre-SF49 had no Motion.js and no reducedMotion call sites —
// every check below FAILS on the old source.
{
  const motionSrc = read('client/systems/Motion.js');
  check('SF49 Motion.js exports reducedMotion()',
    /export function reducedMotion\(\)/.test(motionSrc));
  check('SF49 Motion.js reads the local sf.reducedMotion key first',
    motionSrc.includes("localStorage.getItem('sf.reducedMotion') === '1'"));
  check('SF49 Motion.js falls back to prefers-reduced-motion',
    motionSrc.includes('(prefers-reduced-motion: reduce)') &&
    /\.matches/.test(motionSrc));
  check('SF49 Motion.js exports setReducedMotion(on) writing the key',
    /export function setReducedMotion\(on\)/.test(motionSrc) &&
    motionSrc.includes("localStorage.setItem('sf.reducedMotion'"));

  const planetSrc = read('client/scenes/PlanetScene.js');
  const sites = (planetSrc.match(/reducedMotion\(\)/g) || []).length;
  check('SF49 PlanetScene checks reduced motion at ≥4 motion sites',
    sites >= 4, `got ${sites} call sites`);

  // site 1 — crop sway amplitude collapses to 0 when reduced
  const swayIdx = planetSrc.indexOf('SF49: reduced motion crops the sway amplitude');
  check('SF49 site 1: crop sway amplitude gated to 0',
    swayIdx >= 0 && /const swayAmp = reducedMotion\(\) \? 0 : 3;/.test(planetSrc) &&
    planetSrc.slice(swayIdx, swayIdx + 600).includes('swayAmp'));

  // site 2 — stardust motes stay static (drift loop skipped)
  const stIdx = planetSrc.indexOf('SF49: reduced motion leaves every mote at its deterministic origin');
  check('SF49 site 2: stardust drift loop skipped when reduced',
    stIdx >= 0 && /if \(this\.stardust && !reducedMotion\(\)\) \{/.test(planetSrc));

  // site 3 — festival lamp bloom is tint-only (no scale/alpha tween)
  const bloomIdx = planetSrc.indexOf('_startLampBloom() {');
  const bloomBody = bloomIdx >= 0
    ? planetSrc.slice(bloomIdx, planetSrc.indexOf('_stopLampBloom() {', bloomIdx))
    : '';
  check('SF49 site 3: lamp bloom keeps the amber tint under reduced motion',
    bloomBody.includes('SF49') && /if \(reducedMotion\(\)\) \{/.test(bloomBody) &&
    bloomBody.includes('setTint(0xffd68a)'));
  const rmIdx = bloomBody.indexOf('if (reducedMotion()) {');
  const rmSeg = rmIdx >= 0 ? bloomBody.slice(rmIdx, bloomBody.indexOf('return;', rmIdx)) : '';
  const tintOnly = rmIdx >= 0 && rmSeg.length > 0 &&
    rmSeg.indexOf('this.tweens.add') === -1 && rmSeg.includes('setTint(0xffd68a)');
  check('SF49 site 3: the reduced branch adds NO scale/alpha tween',
    tintOnly, rmSeg === '' ? 'reduced branch not found' : 'tweens.add appears inside the reduced branch');

  // site 4 — dusk/dawn flip eases over 400ms when reduced (2500ms otherwise)
  const flipIdx = planetSrc.indexOf('const flipMs = reducedMotion() ? 400 : 2500;');
  check('SF49 site 4: dusk/dawn flip duration gated (2500 → 400ms)',
    flipIdx >= 0 &&
    planetSrc.slice(flipIdx, flipIdx + 400).includes('duration: flipMs') &&
    planetSrc.includes('duration: flipMs / 2'));

  // F9 toggle + toast (M is taken — the colony hub toggle)
  check('SF49 F9 key registered (M stays the hub toggle)',
    /this\.rmKey = this\.input\.keyboard\.addKey\('F9'\)/.test(planetSrc));
  check('SF49 F9 flips the Motion flag and toasts ON/OFF',
    /const next = !reducedMotion\(\);\s*setReducedMotion\(next\);/.test(planetSrc) &&
    /`Reduced motion \$\{next \? 'ON' : 'OFF'\}`/.test(planetSrc));
  check('SF49 game.js exposes window.SpaceFarmer.setReducedMotion',
    /window\.SpaceFarmer\.setReducedMotion = setReducedMotion/.test(read('client/game.js')));
}

// ── SF51 'Companion Corridor' gate: the agent day screen is truly wired —
//     SF50 streams a stub agent's day at /api/spectate/stub and nothing in the
//     game showed it. Gate: the terminal prop exists near the bell tower, its
//     texture role is registered (AssetTheme + SpriteSystem TEXTURES), the
//     screen panel opens SF50's SSE route, its close path calls es.close(),
//     and the panel is screen-anchored (setScrollFactor(0)). ──
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const spriteSrc = read('client/systems/SpriteSystem.js');
  const themeSrc = read('client/systems/AssetTheme.js');
  check('SF51 corridor opens SF50\u2019s SSE route', planetSrc.includes('/api/spectate/stub?days=1'));
  check('SF51 close path tears the stream down (es.close())',
    /this\.corridorEs\.close\(\)/.test(planetSrc));
  check('SF51 corridor panel is screen-anchored (setScrollFactor(0))',
    /this\.corridorPanel\s*=\s*this\.add\.container\([^;]*\.setScrollFactor\(0\)/.test(planetSrc));
  check('SF51 window.SpaceFarmer.openCorridor exposed',
    /window\.SpaceFarmer\.openCorridor = /.test(planetSrc));
  check('SF51 corridor lines capped at 12', /this\.corridorLines\.length\s*>\s*12/.test(planetSrc));
  check('SF51 journal lines render amber italic',
    /journal:\s*\{ color: '#f7d698', fontStyle: 'italic' \}/.test(planetSrc));
  check('SF51 tool lines render teal with a ▸ prefix',
    /tool:\s*\{ color: '#67e1cd'/.test(planetSrc) && /`▸ \$\{/.test(planetSrc));
  const terminal = DECOR.find(d => d.tex === 'bld.corridor_terminal');
  check('SF51 terminal decor entry exists near the bell tower',
    !!terminal && Math.hypot(terminal.x - 34, terminal.y - 41) <= 3,
    terminal ? `tile (${terminal.x},${terminal.y})` : 'missing DECOR entry');
  check('SF51 terminal texture role registered in AssetTheme',
    /corridor_terminal:\s*'bld\.corridor_terminal'/.test(themeSrc));
  check('SF51 terminal texture key registered in SpriteSystem TEXTURES',
    /'bld\.corridor_terminal':\s*BLD_CORRIDOR_TERMINAL/.test(spriteSrc));
  check('SF51 terminal tile is walkable-adjacent (solid, reachable beside)',
    !!terminal && !!blocks[terminal.y] && blocks[terminal.y][terminal.x] === true,
    terminal ? JSON.stringify(terminal) : 'no terminal');
  const neighbours = terminal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [terminal.x + dx, terminal.y + dy])
        .filter(([x, y]) => !blocks[y]?.[x]).length
    : 0;
  check('SF51 terminal has ≥1 walkable adjacent tile', neighbours >= 1, `open neighbours=${neighbours}`);
  check('SF51 resolver routes the corridor terminal',
    /kind: 'corridor'/.test(planetSrc) && /openCorridorPanel\(\)/.test(planetSrc));
}

// ── SF62 'Season Reckoning' gate: the season's-end screen is truly wired —
//     the server room sends 'seasonReckoning' on the day the calendar rolls
//     into a new season, guarded by a season-index comparison captured BEFORE
//     the day increments; the client registers the message (SF34 rule); and
//     PlanetScene opens/closes/hides it in exactly the same panel lists the
//     smithy screen participates in (same count of flag mentions).
{
  const planetSrc = read('client/scenes/PlanetScene.js');
  const farmSrc = read('server/rooms/FarmRoom.js');
  const netSrc = read('client/systems/NetworkSystem.js');
  const farmRev = farmSrc.indexOf('onAdvanceDay(client)');
  const farmBlock = farmRev >= 0 ? farmSrc.slice(farmRev, farmSrc.indexOf('  // ── M3', farmRev)) : '';
  check('SF62 FarmRoom captures the season index BEFORE the day increments',
    /const\s+beforeSeason\s*=\s*this\.state\.season/.test(farmBlock));
  check('SF62 FarmRoom sends seasonReckoning inside onAdvanceDay, guarded by a season-index comparison',
    /client\.send\('seasonReckoning'/.test(farmBlock) &&
    /beforeSeason\s*!==\s*this\.state\.season/.test(farmBlock));
  check('SF62 FarmRoom builds the record from the player state (credits/lifetime/friends/contacts/quests/married)',
    /_reckoningRecord\(p,\s*beforeSeason\)/.test(farmBlock) &&
    /questsCompleted:/.test(farmSrc) && /marriedTo:/.test(farmSrc));
  check('SF62 NetworkSystem registers seasonReckoning',
    /onMessage\('seasonReckoning'/.test(netSrc) &&
    /seasonReckoning:\s*'onSeasonReckoning'/.test(netSrc));
  const smCount = (planetSrc.match(/showingSmithy/g) || []).length;
  const recCount = (planetSrc.match(/showingReckoning/g) || []).length;
  check('SF62 showingReckoning count equals showingSmithy count', recCount === smCount && recCount >= 8,
    `smithy=${smCount} reckoning=${recCount}`);
  check('SF62 reckoning screen is screen-anchored at depth 1650',
    /_showReckoning\(payload\)/.test(planetSrc) && /setDepth\(1650\)/.test(planetSrc));
  check('SF62 Space closes the reckoning screen',
    /this\.showingReckoning\) \{[\s\S]*?closeAllPanels\(\)/.test(planetSrc.slice(
      planetSrc.indexOf('if (this.showingReckoning)'), planetSrc.indexOf('if (!this.inDialogue'))));
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);