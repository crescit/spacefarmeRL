import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ALIEN_DATA, CONTACT_DOCTRINES } from '../client/entities/AlienData.js';
import { ALIEN_SPRITES, ALIEN_PORTRAITS, TEXTURES } from '../client/systems/SpriteSystem.js';

function assert(condition, message) { if (!condition) throw new Error(message); }
assert(ALIEN_DATA.length === 8, 'expected eight first-contact civilizations');
assert(new Set(ALIEN_DATA.map((a) => a.id)).size === 8, 'alien ids must be unique');
assert(new Set(ALIEN_DATA.map((a) => a.form)).size >= 7, 'alien silhouettes should be materially distinct');
assert(CONTACT_DOCTRINES.length === 5, 'expected five colony doctrines');
assert(new Set(CONTACT_DOCTRINES.map((d) => d.id)).size === 5, 'doctrine ids must be unique');
assert(CONTACT_DOCTRINES.some((d) => d.id === 'colonize' && /sovereignty/i.test(d.description)), 'settlement must disclose sovereignty tradeoff');
for (const alien of ALIEN_DATA) {
  assert(alien.arrival.length >= 3 && alien.stakes.length > 60, `${alien.id} needs a complete arrival cutscene and stakes`);
  assert(ALIEN_SPRITES[alien.id], `${alien.id} avatar missing`);
  assert(ALIEN_PORTRAITS[alien.id]?.length === 3, `${alien.id} animated portrait missing`);
  assert(TEXTURES[`alien.${alien.id}`], `${alien.id} world texture missing`);
  for (let frame = 0; frame < 3; frame++) assert(TEXTURES[`port.${alien.id}_${frame}`], `${alien.id} portrait frame ${frame} missing`);
}
// Eval parity is guaranteed by construction: eval_alignment.py fetches its
// scenarios + doctrines from the bridge spec, and the bridge serves the
// StoryBank — so instead of hardcoding ids in Python we assert the bridge
// round-trip reproduces EVERY alien scenario (verify_story.mjs checks the
// byte-level object match plus the doctrinal payload).
const bridge = spawnSync(process.execPath, ['rl/bridge.cjs'], {
  input: '{"cmd":"spec"}\n', encoding: 'utf8',
});
assert(bridge.status === 0, 'story bridge must exit 0');
const specLine = bridge.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .find((l) => l && l.ok);
assert(specLine && specLine.story, 'bridge spec must carry the story payload');
for (const alien of ALIEN_DATA) {
  const served = specLine.story.aliens.find((a) => a.id === alien.id && a.scenarioId === alien.scenarioId);
  assert(served && served.name === alien.name && served.premise === alien.premise, `${alien.id} missing or drifted in bridge story`);
}
const scene = readFileSync('client/scenes/PlanetScene.js', 'utf8');
for (const token of ['startAlienContact', 'advanceAlienCutscene', 'chooseContactDoctrine', 'spacefarmer.firstContact', 'No alignment score']) assert(scene.includes(token), `story integration missing ${token}`);
console.log(`✓ ${ALIEN_DATA.length} alien cutscenes, ${CONTACT_DOCTRINES.length} neutral doctrines, avatars, persistence, and bridge-backed eval parity`);
