// verify_textures.mjs — ensure every texture key referenced in scene code
// exists in the SpriteSystem TEXTURES registry (catches missing-sprite bugs).
//
// Scenes resolve art through AssetTheme roles (`tex('bld.shop')`) rather than
// raw keys. This test:
//   1. resolves every role call in scene code through the active theme,
//   2. also scans for any remaining literal texture keys,
//   3. confirms every resolved key exists in the TEXTURES registry.
import { readFileSync } from 'node:fs';
import { TEXTURES } from '../client/systems/SpriteSystem.js';
import { THEME, tex, texAt, resolveKey } from '../client/systems/AssetTheme.js';

const files = [
  'client/scenes/PlanetScene.js',
  'client/scenes/SpaceshipScene.js',
  'client/scenes/IntroScene.js',
  'client/systems/AssetTheme.js',
];
const registryKeys = new Set(Object.keys(TEXTURES));

// keys of interest: 'tile.*','ship.*','player.*','npc.*','decor.*','bld.*','fx.*'
const KEY_RE = /['"]((?:tile|ship|player|npc|decor|bld|fx|int|alien|port)\.[a-z0-9_]+)['"]/g;
const ROLE_RE = /\b(tex|texAt|resolveKey)\(\s*'([a-z]+\.[a-zA-Z0-9_]+)'/g;

let missing = 0;
const seen = new Set();
const locations = {};

function record(key, where) {
  seen.add(key);
  (locations[key] = locations[key] || []).push(where);
}

// 1. Resolve theme-role calls in scene code → texture keys.
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // strip role-call substrings so the literal scan below doesn't re-flag them
  const stripped = src.replace(ROLE_RE, (_, fn, role) => {
    let key;
    try {
      key = fn === 'resolveKey' ? resolveKey(role) : (fn === 'texAt' ? texAt(role, 0) : tex(role));
    } catch {
      key = `<<UNRESOLVED:${role}>>`;
    }
    record(key, f.replace('client/scenes/', '').replace('client/systems/', ''));
    return '';
  });
  // 2. Any remaining literal texture keys (skip comment lines).
  for (const line of stripped.split('\n')) {
    if (line.trim().startsWith('//')) continue;
    let m;
    while ((m = KEY_RE.exec(line)) !== null) record(m[1], f.replace('client/scenes/', '').replace('client/systems/', ''));
  }
}

// 3. Role values baked into the default theme (the registry contract).
function walk(node, where) {
  for (const v of Object.values(node)) {
    if (typeof v === 'string') record(v, where);
    else if (Array.isArray(v)) v.forEach(x => record(x, where));
    else if (v && typeof v === 'object') walk(v, where);
  }
}
walk(THEME, 'AssetTheme');

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
