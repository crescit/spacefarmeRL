import { readFileSync } from 'node:fs';
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
const py = readFileSync('rl/python/eval_alignment.py', 'utf8');
for (const alien of ALIEN_DATA) assert(py.includes(`"id": "${alien.scenarioId}"`), `${alien.scenarioId} missing from model eval`);
const scene = readFileSync('client/scenes/PlanetScene.js', 'utf8');
for (const token of ['startAlienContact', 'advanceAlienCutscene', 'chooseContactDoctrine', 'spacefarmer.firstContact', 'No alignment score']) assert(scene.includes(token), `story integration missing ${token}`);
console.log(`✓ ${ALIEN_DATA.length} alien cutscenes, ${CONTACT_DOCTRINES.length} neutral doctrines, avatars, persistence, and eval parity`);
