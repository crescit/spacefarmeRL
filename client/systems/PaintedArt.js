// PaintedArt.js — ART-06: painted plates (Qwen Image 2.1, generated on the Mac,
// pixelized to a fixed palette and rendered NEAREST so they sit in the pixel
// style). Portraits are 128x128 busts shown above the dialogue box; scenes are
// 480x270 backdrops cover-scaled behind the reckoning and first-contact council.
// Everything is optional: if a PNG is missing the game falls back to the
// procedural art (texture-exists checks at every use site).

export const PAINTED_PORTRAITS = [
  'nova', 'luna', 'zephyr', 'vega', 'quasar', 'rhea', 'astra', 'orion', 'comet', 'cora',
  'aurelian', 'keth', 'archive', 'velari', 'spore', 'orison', 'ember', 'nacre',
];
const ALIENS = new Set(['aurelian', 'keth', 'archive', 'velari', 'spore', 'orison', 'ember', 'nacre']);
export const PAINTED_SCENES = ['reckoning', 'contact', 'season_spring', 'season_summer', 'season_fall', 'season_winter'];
/** ART-07: painted plate for a season index (0 spring … 3 winter). */
export const SEASON_PLATES = ['season_spring', 'season_summer', 'season_fall', 'season_winter'];

export const paintedPortraitKey = (id) => `paint.port.${id}`;
export const paintedSceneKey = (id) => `paint.scene.${id}`;

/** Queue every painted plate on a scene's loader (skips keys already loaded). */
export function preloadPainted(scene) {
  const q = (key, url) => { if (!scene.textures.exists(key)) scene.load.image(key, url); };
  for (const id of PAINTED_PORTRAITS) q(paintedPortraitKey(id), `client/art/${ALIENS.has(id) ? 'alien' : 'port'}_${id}.png`);
  for (const id of PAINTED_SCENES) q(paintedSceneKey(id), `client/art/scene_${id}.png`);
  scene.load.once('complete', () => applyNearest(scene));
}

/** NEAREST-filter every painted texture that loaded (pixel-crisp at any zoom). */
export function applyNearest(scene) {
  const keys = [...PAINTED_PORTRAITS.map(paintedPortraitKey), ...PAINTED_SCENES.map(paintedSceneKey)];
  for (const k of keys) if (scene.textures.exists(k)) scene.textures.get(k).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Painted portrait key for a speaker id, or null when there is no plate. */
export function paintedPortrait(scene, id) {
  const k = paintedPortraitKey(id);
  return id && scene.textures.exists(k) ? k : null;
}

/** Full-screen cover-scaled backdrop image (centred at x,y), or null. */
export function paintedBackdrop(scene, id, x, y, width, height) {
  const k = paintedSceneKey(id);
  if (!scene.textures.exists(k)) return null;
  const src = scene.textures.get(k).getSourceImage();
  const s = Math.max(width / src.width, height / src.height);
  return scene.add.image(x, y, k).setScale(s);
}
