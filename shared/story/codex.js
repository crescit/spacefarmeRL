// shared/story/codex.js — StoryBank: the Colony Codex (worldbuilding lore).
//
// These are the press-[L] worldbuilding entries the plaza shows: short
// story-pulses about B-612 — the arrival, why we farm, the exchange, rumors,
// gravity, the ranched hearths, the Sol Earth Festival. Written ONCE here;
// the browser renders them and the narrative layer can quote them.
//
// Authoring rule: add a new codex entry here as [HEADING, BODY]. Keep BODY to
// two sentences of evocative prose; never write rules or numbers here that
// contradict server/farmroom truth (the codex is a camera, not an authority).
//
// Loads everywhere (same pattern as shared/calendar.js):
//   - Node (CommonJS):  const codex = require("../shared/story/codex.js");
//   - Browser (plain script): <script src="shared/story/codex.js"> → window.SpaceFarmerStory.codex
//   - ESM client wrapper: client/systems/StoryService.js re-exports it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.SpaceFarmerStory = Object.assign(root.SpaceFarmerStory || {}, { codex: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const title = "COLONY CODEX";
  const closeHint = "[L] close";

  // Each entry is [HEADING, BODY] — the plaza renders the heading bold and
  // the body wrapped beneath it.
  const entries = [
    ["THE ARRIVAL", "Sol 0: the Stardust lander set down in the Sleepy Mane crater. The first domes went up before the survey dust settled. We farmed because the colony ships ran on grown air long before they ran on credits."],
    ["WHY WE FARM", "The hydroponic decks are life support. Every nebula-pepper you ripen is a breath the colony breathes tonight. Farming is the quiet engine under all the blinking screens."],
    ["THE EXCHANGE", "The Grand Exchange trusts one currency and one promise: fair trade. The pulsing orb above the post ticks once for every contract honored since Sol 3."],
    ["THE CANTINA", "Sol 12 rumor: the cantina serves a drink that glows the color of old supernova light. Nobody confirms. Everybody orders it."],
    ["THE DOMES", "Each habitat dome is pressurized twice a week — one bad seal and the colony learns a new definition of silence. So far: never. The seam lights are not decoration."],
    ["THE METAL SIDE", "Nova and Cora farm the circuits, not the soil. They keep the deck warm and the reactor honest. Treat them well - they log everything."],
    ["GRAVITY IS A RUMOR", "The colony runs at 0.4g and nobody bothers to say sorry when you float into a shelf. Grandpa's last rule, painted above the airlock: \"Farms are not for throwing things.\" The paint is peeling. So is the rule."],
    ["THE RANCHED HEARTHS", "Our cows, chickens, and sheep all wear flight helmets. Official reason: solar wind. Unofficial reason, per Rhea: \"They look ridiculous and the colony needed it.\""],
    ["SOL EARTH FESTIVAL", "Once a year the whole rock eats a meal reconstituted from Earth rations. It tastes like grief and salt. The line to the cantina still wraps the block."],
    ["THE STARDUST STORY", "The colony has a story, and you are in it. The ◆ marker up top is your place in it; [Q] opens the full log. Villagers will tell you what comes next — they always know, which is the creepy part."],
  ];

  return {
    title,
    closeHint,
    entries,
  };
});
