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
  check('update() calls the prompt refresher', /update\(time\) \{[\s\S]{0,400}this\._updateInteractPrompt\(time\)/.test(planetSrc));
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

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
