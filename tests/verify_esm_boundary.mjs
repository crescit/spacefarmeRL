#!/usr/bin/env node
// SF27: verify the ESM/CommonJS boundary is explicit — client/ is ESM, root stays CommonJS.
import { readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function warnLines(stderr) {
  return (stderr || '').split('\n').filter((l) => l.includes('MODULE_TYPELESS_PACKAGE_JSON')).join('; ').slice(0, 300);
}

// (1) client/package.json parses and declares type: module
let clientType = null;
try {
  clientType = JSON.parse(readFileSync(path.join(root, 'client/package.json'), 'utf8')).type;
  check('client/package.json parses', true);
} catch (err) {
  check('client/package.json parses', false, err.message);
}
check('client/package.json type === "module"', clientType === 'module', String(clientType));

// (2) root package.json has no "type" key
try {
  const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  check('root package.json parses', true);
  check('root package.json has no "type" key', !('type' in rootPkg), rootPkg.type ? `root declares "type"=${rootPkg.type}; would break CommonJS server/rl` : undefined);
} catch (err) {
  check('root package.json parses', false, err.message);
  check('root package.json has no "type" key', false, err.message);
}

// (3) node tests/verify_textures.mjs must exit 0 and its stderr must not contain
//     MODULE_TYPELESS_PACKAGE_JSON (ROADMAP A4: explicit ESM boundary).
function runTextures() {
  const result = spawnSync(process.execPath, ['tests/verify_textures.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  return { stderr: result.stderr || '', code: result.status };
}
function probeWarning() {
  // Dynamic import of a client module under the nearest package.json —
  // this is the path Node warns about (MODULE_TYPELESS_PACKAGE_JSON).
  const result = spawnSync(process.execPath, ['-e', "import('./client/systems/SpriteSystem.js')"], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  return { stderr: result.stderr || '', code: result.status };
}

{
  const { stderr, code } = runTextures();
  check('verify_textures.mjs exits 0', code === 0, `exit ${code}`);
  check('verify_textures stderr has no MODULE_TYPELESS_PACKAGE_JSON', !stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'), warnLines(stderr));
  const probe = probeWarning();
  check('dynamic client import exits 0', probe.code === 0, `exit ${probe.code}`);
  check('dynamic client import stderr has no MODULE_TYPELESS_PACKAGE_JSON', !probe.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'), warnLines(probe.stderr));
}

// Self-proving mutation: with client/package.json renamed away, the MODULE_TYPELESS
// warning must reappear (gate fails against the old state).
{
  const pkgPath = path.join(root, 'client/package.json');
  const backupPath = path.join(root, 'client/package.json.sf27-bak');
  renameSync(pkgPath, backupPath);
  let mutatedType = null;
  try {
    mutatedType = JSON.parse(readFileSync(pkgPath, 'utf8')).type;
  } catch {
    mutatedType = undefined;
  }
  check('mutation: client/package.json no longer declares type module', mutatedType !== 'module', String(mutatedType));
  const mutatedProbe = probeWarning();
  check('mutation: MODULE_TYPELESS_PACKAGE_JSON warning reappears', mutatedProbe.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'), warnLines(mutatedProbe.stderr) || `probe exit ${mutatedProbe.code}`);
  const mutatedTextures = runTextures();
  check('mutation: verify_textures still exits 0 (runtime intact)', mutatedTextures.code === 0, `exit ${mutatedTextures.code}`);
  renameSync(backupPath, pkgPath);
}

console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
