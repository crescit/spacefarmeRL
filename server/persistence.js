// persistence.js — JSON file saves for Space Farmer (zero-dep, ARM64-safe).
// One file per stable player id: saves/<playerId>.json. Atomic writes
// (tmp + rename) so a crash mid-write never corrupts a save.
const fs = require('node:fs');
const path = require('node:path');

const SAVE_DIR = path.join(__dirname, '..', 'saves');
const SAVE_VERSION = 1;

function _ensureDir() {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
}

function savePathFor(playerId) {
  // keep ids filesystem-safe
  const safe = String(playerId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
  return path.join(SAVE_DIR, `${safe}.json`);
}

// Save a player's full state. `data` is a plain object produced by the room.
function savePlayer(playerId, data) {
  try {
    _ensureDir();
    const p = savePathFor(playerId);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: SAVE_VERSION, savedAt: Date.now(), ...data }, null, 0));
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    console.warn(`[persistence] save failed for ${playerId}: ${e.message}`);
    return false;
  }
}

// Load a saved player. Returns the parsed payload or null (no save / corrupt).
function loadPlayer(playerId) {
  try {
    const raw = fs.readFileSync(savePathFor(playerId), 'utf8');
    const data = JSON.parse(raw);
    return (data && data.v === SAVE_VERSION) ? data : null;
  } catch {
    return null;
  }
}

// List existing save files (for tooling / a future "profile select").
function listSaves() {
  try {
    return fs.readdirSync(SAVE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
  } catch {
    return [];
  }
}

// Delete a save (testing helper).
function deleteSave(playerId) {
  try { fs.unlinkSync(savePathFor(playerId)); return true; } catch { return false; }
}

module.exports = { savePlayer, loadPlayer, listSaves, deleteSave, SAVE_DIR, SAVE_VERSION };
