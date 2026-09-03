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
const { TEXTURES } = SS;
const { BUILDINGS, blocks, verifyWalkability, MINE_SPOT, DEEP_DROP_SPOT, MAP_W, MAP_H } = MD;

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
];
const PLAYER_WALK_FRAMES = [];
for (const dir of ['front', 'back', 'left', 'right'])
  for (let f = 0; f < 3; f++) PLAYER_WALK_FRAMES.push(`player.${dir}_${f}`);

for (const tex of [...BUILDING_TEX, ...INTERIOR_TEX, ...PLAYER_WALK_FRAMES]) {
  check(`texture exists: ${tex}`, !!TEXTURES[tex], '(missing from SpriteSystem registry)');
}

// ── 2. Map layout wiring: every building has a door, label, action; all
//     doors are walkable; the map is reachable from the player start ──
const KNOWN_ACTIONS = new Set(['shop', 'exchange', 'ranch', 'sleep', 'talk_rhea']);
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

// ── 3. PlanetScene building-action wiring: every BUILDINGS.action key is
//     dispatched to a real handler method ──
{
  const calls = [];
  const ps = Object.create(PS.PlanetScene.prototype);
  ps.openShop = () => calls.push('openShop');
  ps.openGrandExchange = () => calls.push('openGrandExchange');
  ps.openRanch = () => calls.push('openRanch');
  ps.enterHouse = () => calls.push('enterHouse');
  ps.startNPCDialogue = () => calls.push('startNPCDialogue');
  ps.showToast = () => {};
  // prototype methods the wiring relies on must actually exist
  for (const m of ['buildingAction', 'enterHouse', 'exitHouse', 'buildInterior',
    'openShop', 'openGrandExchange', 'openRanch', 'startNPCDialogue']) {
    check(`PlanetScene.prototype.${m} exists`, typeof ps[m] === 'function');
  }
  const byAction = { shop: 'openShop', exchange: 'openGrandExchange', ranch: 'openRanch', sleep: 'enterHouse', talk_rhea: 'startNPCDialogue' };
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
  check('intro update needs no frame clock (uses this.time)', /update\(\)/.test(introSrc));
  check('game.js scene registry: Intro→Ship→Planet',
    /scene:\s*\[IntroScene,\s*SpaceshipScene,\s*PlanetScene\]/.test(gameSrc));
  check('intro starts the ship', /scene\.start\('SpaceshipScene'\)/.test(introSrc));
  check('ship lands on the planet', /scene\.start\('PlanetScene'/.test(shipSrc));

  // the intro's building is the SAME house the planet renders — one texture
  check('intro renders the shared house (bld.house)', /'bld\.house'/.test(introSrc));
  check('intro renders the shared house glow (theme role bld.houseGlow)', /tex\('bld\.houseGlow'\)/.test(introSrc));
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

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
