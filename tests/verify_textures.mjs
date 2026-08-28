// verify_textures.mjs — ensure every texture key referenced in scene code
// exists in the SpriteSystem TEXTURES registry (catches missing-sprite bugs).
import { readFileSync } from 'node:fs';
import { TEXTURES } from '../client/systems/SpriteSystem.js';

const files = [
  'client/scenes/PlanetScene.js',
  'client/scenes/SpaceshipScene.js',
  'client/scenes/IntroScene.js',
];
const registryKeys = new Set(Object.keys(TEXTURES));

// keys of interest: 'tile.*','ship.*','player.*','npc.*','decor.*','bld.*','fx.*'
const KEY_RE = /['"]((?:tile|ship|player|npc|decor|bld|fx)\.[a-z0-9_]+)['"]/g;
const seen = new Set();
const locations = {};

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = KEY_RE.exec(src)) !== null) {
    const key = m[1];
    seen.add(key);
    (locations[key] = locations[key] || []).push(f.replace('client/scenes/', ''));
  }
}

let missing = 0;
console.log(`registry has ${registryKeys.size} keys; scenes reference ${seen.size} distinct keys:\n`);
for (const key of [...seen].sort()) {
  const ok = registryKeys.has(key);
  if (!ok) {
    missing++;
    console.log(`  ✗ MISSING: ${key}  (referenced in ${locations[key].join(', ')})`);
  }
}
if (missing === 0) console.log('  ✓ all referenced keys exist in the registry');
console.log(`\n${missing} missing`);
process.exit(missing > 0 ? 1 : 0);
