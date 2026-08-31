// client/systems/StoryService.js — ESM wrapper over the StoryBank
// (shared/story/*.js is the ONE source of story content — NPC dialogue,
// first-contact aliens, intro crawl, season/festival/pressure prose, colony
// codex). Mirrors CalendarService.js exactly:
//
//   1. Browser: index.html loads each shared/story/<domain>.js as a plain
//      <script>, which installs window.SpaceFarmerStory.<domain>; we read
//      that global.
//   2. Headless (Node tests / tooling): no global — we load the CommonJS
//      sources directly via createRequire. Either way we get the SAME objects
//      the browser, the server, and the RL environment share — no drift by
//      construction.
const globalStory = globalThis.SpaceFarmerStory;

let storyBank;
if (globalStory) {
  storyBank = globalStory;
} else {
  // Headless / tooling only — never reached in the browser (the <script>
  // tags above run first). Dynamic import keeps 'node:module' out of the bundle.
  const { createRequire } = await import('node:module');
  const localRequire = createRequire(import.meta.url);
  const load = (domain) => localRequire(`../../shared/story/${domain}.js`);
  storyBank = {
    npcs: load('npcs'),
    aliens: load('aliens'),
    intro: load('intro'),
    season: load('season'),
    codex: load('codex'),
  };
}

export const npcs = storyBank.npcs;
export const aliens = storyBank.aliens;
export const intro = storyBank.intro;
export const season = storyBank.season;
export const codex = storyBank.codex;
export const story = storyBank;
