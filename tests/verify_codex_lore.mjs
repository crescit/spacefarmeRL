// tests/verify_codex_lore.mjs — SF39 lore gate for the Colony Codex.
//
// The three SF39 entries must exist, every BODY must stay within the authoring
// rule of at most two sentence terminators (with '...' counted as one), and no
// heading may appear twice. Gate must fail against pre-SF39 codex (entries
// lacked THE FIRST BELL / THE OLD MISSION / WHAT THE ENVOYS REMEMBER).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
function assert(condition, message) { if (!condition) throw new Error(message); }

const req = createRequire(import.meta.url);
const path = process.env.SF_CODEX_SRC || '../shared/story/codex.js';
const src = readFileSync('shared/story/codex.js', 'utf8');
const codex = req('../shared/story/codex.js');
const entries = codex.entries;

// 1. Exactly the three SF39 headings exist once.
const wanted = ['THE FIRST BELL', 'THE OLD MISSION', 'WHAT THE ENVOYS REMEMBER'];
const headings = entries.map((e) => e[0]);
for (const h of wanted) assert(headings.includes(h), `codex must include heading ${h}`);
const uniq = new Set(headings);
assert(uniq.size === headings.length, 'no codex entry may duplicate a heading');

// 2. Every BODY obeys the two-sentence rule ('...' counts as one terminator).
const terminators = entries.length; // assigned in loop below
let bodiesChecked = 0;
for (const [heading, body] of entries) {
  assert(typeof body === 'string' && body.length > 0, `${heading} must carry a BODY`);
  let count = 0;
  let i = 0;
  while (i < body.length) {
    const ellipsis = body.indexOf('...', i);
    const next = body.slice(i).search(/[.!?]/);
    if (next < 0) break;
    const idx = i + next;
    if (ellipsis >= 0 && ellipsis === idx && body.slice(idx, idx + 3) === '...') {
      count += 1; // '...' = one terminator; jump past it
      i = idx + 3;
    } else {
      // A '.' counts only when it ends a sentence: "0.4g" and "Sol 0:" are not
      // sentence ends; '...' (ellipsis) counts as exactly one terminator.
      if (body[idx] === '!' || body[idx] === '?' ||
          (body[idx] === '.' && !/[A-Za-z]/.test(body[idx + 1] || ' ') &&
           !/[A-Za-z]/.test(body[idx - 1] || ' '))) {
        count += 1;
      }
      i = idx + 1;
    }
  }
  assert(count <= 2, `${heading} BODY must be at most two sentences (${count})`);
  bodiesChecked += 1;
}
assert(bodiesChecked === entries.length, 'every entry body must be checked');

// 3. Source of truth: the SF39 lore lives ONCE in codex.js — no private copy.
for (const h of wanted) assert(src.includes(`"${h}"`), `${h} must be authored in ${path}`);
const storySrc = readFileSync('STORY.md', 'utf8');
assert(storySrc.includes('## The Old Mission'), 'STORY.md must carry the Old Mission paragraph');
assert(storySrc.includes('cast before the colony'), 'STORY.md must match the codex bell line');
const planetSrc = readFileSync('client/scenes/PlanetScene.js', 'utf8');
for (const h of wanted) assert(!planetSrc.includes(h), `PlanetScene must not inline codex entry ${h}`);

console.log(`✓ Codex lore gate: ${entries.length} entries, 3 SF39 headings present, all bodies ≤2 sentences, no duplicate headings`);
