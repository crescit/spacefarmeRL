// AssetTheme.js — the ONE place scenes resolve texture keys by SEMANTIC ROLE.
//
// WHY: scenes used to hardcode raw Phaser keys ('tile.grass_a', 'bld.shop').
// That made every art retheme require touching scene code. Now a scene asks for
// a ROLE ('ground.grass', 'bld.shop') and this module returns the current theme's
// texture key. Retheming — or shipping an alternate skin — means editing (or
// registering) a THEME here; scenes never change.
//
// HOW TO THEME:
//   const myTheme = { ...THEME, bld: { ...THEME.bld, shop: 'bld.shop_night' } };
//   setTheme(myTheme);          // swap the whole active theme at runtime
//   registerTheme('night', myTheme);  // keep it for later / QA contact sheet
//
// Roles are namespaced: 'ground.*', 'farm.*', 'ship.*', 'player.*', 'npc.*',
// 'decor.*', 'bld.*', 'fx.*', 'int.*', 'alien.*', 'port.*'.
//
// The default THEME mirrors the SpriteSystem registry exactly, so the game runs
// identically today — but every lookup now flows through one resolvable place.

// ── Default theme: role → texture key ──
export const THEME = {
  // ground tiles (variant arrays let scenes pick per-position determinism)
  ground: {
    grass: ['tile.grass_a', 'tile.grass_b', 'tile.grass_c', 'tile.grass_d', 'tile.grass_e', 'tile.grass_f'],
    path: 'tile.path',
    plaza: 'tile.plaza',
    // 3 caustic families; the lake assigns a family per tile position and the
    // shimmer cycles each family on its own offset, so open water never reads
    // as one flat cyan billboard even on a still frame.
    water: ['tile.water', 'tile.water2', 'tile.water3'],
    water2: 'tile.water2',
    soil: 'tile.soil',
    soilB: 'tile.soil_b',
    sand: 'tile.sand',
    wetSand: 'tile.wet_sand',
    cliff: 'tile.cliff',
    forest: 'tile.forest',
  },
  // farm-state overrides once a tile is worked
  farm: {
    empty: 'tile.soil',
    tilled: 'tile.tilled',
    seeded: 'tile.seeded',
    growing: 'tile.growing',
    mature: 'tile.mature',
  },
  // spaceship interior
  ship: {
    floor: 'ship.floor',
    wall: 'ship.wall',
    cryopod: 'ship.cryopod',
    console: 'ship.console',
    planter: 'ship.planter',
    door: 'ship.door',
    airlock: 'ship.airlock',
    porthole: 'ship.porthole',
    droid: 'ship.droid',
  },
  // player body (walk frames resolved via playerFrame())
  player: {
    front: 'player.front',
    back: 'player.back',
    left: 'player.left',
    right: 'player.right',
  },
  // world decor
  decor: {
    fencePost: 'decor.fence_post',
    fenceBeamA: 'decor.fence_beam_a',
    fenceBeamB: 'decor.fence_beam_b',
    lamp: 'decor.lamp',
    lampGlow: 'decor.lamp_glow',
    planter: 'decor.planter',
    barrelWater: 'decor.barrel_water',
    barrelCargo: 'decor.barrel_cargo',
    bush: 'decor.bush',
    treeLeaf: 'decor.tree_leaf',
    treeBloom: 'decor.tree_bloom',
    alienFlora: 'decor.alien_flora',
    pond: 'decor.pond',
    colonySolar: 'decor.colony_solar',
    colonyAntenna: 'decor.colony_antenna',
    colonyCrate: 'decor.colony_crate',
    colonyHolosign: 'decor.colony_holosign',
  },
  // buildings
  bld: {
    house: 'bld.house',
    houseGlow: 'bld.house_glow',
    shop: 'bld.shop',
    shopGlow: 'bld.shop_glow',
    exchange: 'bld.exchange_a',
    exchangeAlt: 'bld.exchange_b',
    exchangeGlow: 'bld.exchange_glow',
    tavern: ['bld.tavern_a', 'bld.tavern_b', 'bld.tavern_c'],
    tavernGlow: 'bld.tavern_glow',
    barn: 'bld.barn',
  },
  // screen-space fx / atmosphere
  fx: {
    nebula: 'fx.nebula',
    planet: 'fx.planet',
    sun: 'fx.sun',
    moon: 'fx.moon',
    cloud: 'fx.cloud',
    vignette: 'fx.vignette',
    scanlines: 'fx.scanlines',
    asteroid: 'fx.asteroid',
    meteor: 'fx.meteor',
    skyDusk: 'fx.sky_dusk',
    fog: 'fx.fog',
    lampGlow: 'fx.lamp_glow',
    poolWarm: 'fx.pool_warm',
    poolCool: 'fx.pool_cool',
    poolPlayer: 'fx.pool_player',
    shadow: 'fx.shadow',
    bldShadow: 'fx.bld_shadow',
  },
  // home interior furniture
  int: {
    bed: 'int.bed',
    table: 'int.table',
    window: 'int.window',
    bookcase: 'int.bookcase',
    rug: 'int.rug',
    plant: 'int.plant',
    wall: 'int.wall',
    floor: 'int.floor',
  },
  // colony festival kit (Earth Day / Hearthnight plaza)
  fest: {
    stage: 'fest.stage',
    stall: 'fest.stall',
    pennant: ['fest.pennant_0', 'fest.pennant_1', 'fest.pennant_2'],
    bulb: 'fest.bulb',
    confetti: ['fest.confetti_0', 'fest.confetti_1', 'fest.confetti_2'],
  },
  // held tool kit — equipped tool beside the player + use swing
  tool: {
    hoe: 'tool.hoe',
    watering: 'tool.watering',
    pickaxe: 'tool.pickaxe',
    rod: 'tool.rod',
  },
};

// ── Active theme (mutable; scenes read through getTheme/tex) ──
let active = THEME;

export function setTheme(theme) { active = theme || THEME; }
export function getTheme() { return active; }
export function registerTheme(name, theme) { themes[name] = theme; }
const themes = { default: THEME };

// ── Resolve a dotted role ('ground.grass') → texture key ──
// Throws loudly on a missing role so a typo never silently renders a blank
// sprite — better a crash at author time than a gray box in-game.
export function tex(role) {
  const [ns, ...rest] = role.split('.');
  const group = active[ns];
  if (!group) throw new Error(`AssetTheme: unknown namespace '${ns}' in role '${role}'`);
  let node = group;
  for (const part of rest) {
    if (node == null) throw new Error(`AssetTheme: missing role '${role}'`);
    node = node[part];
  }
  if (node == null) throw new Error(`AssetTheme: role '${role}' has no texture in active theme`);
  return node;
}

// Resolve a role that resolves to an ARRAY of variants → pick one.
export function texAt(role, index) {
  const v = tex(role);
  const i = ((index % v.length) + v.length) % v.length;
  return v[i];
}

// Resolve a MapData-style semantic key ('bld.shop', 'decor.lamp') through the
// active theme when it names a known role; otherwise pass it through unchanged.
// This lets declarative data (MapData) stay theme-agnostic while still honoring
// a runtime theme override. Returns a texture key string.
export function resolveKey(semantic) {
  if (typeof semantic !== 'string') return semantic;
  const [ns, ...rest] = semantic.split('.');
  const group = active[ns];
  if (group && rest.length) {
    let node = group;
    for (const part of rest) {
      node = node == null ? undefined : node[part];
    }
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node[0];
  }
  return semantic;
}

// Convenience: player walk-frame key 'player.<dir>_<frame>'.
export function playerFrame(dir, frame) {
  return `player.${dir}_${frame}`;
}

// Convenience: npc walk-frame key 'npc.<id>_<frame>'.
export function npcFrame(id, frame) {
  return `npc.${id}_${frame}`;
}
