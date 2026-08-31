// shared/story/season.js — StoryBank: the world's VOICE over the calendar.
//
// The calendar numbers live in shared/calendar.js (single source of truth);
// THIS file holds the prose the world speaks about that calendar — the season
// light, the festival lamps, the pressures pressing on the colony. The RL
// environment (rl/env_core.cjs) and the browser client both read from here,
// so a season, festival, or pressure line written once appears in briefings,
// transcripts, festival cutscenes, and the plaza alike.
//
// Authoring rule: edit this file and every surface updates. Never duplicate a
// line into a scene or an eval script.
//
// Loads everywhere (same pattern as shared/calendar.js):
//   - Node (CommonJS):  const season = require("../shared/story/season.js");
//   - Browser (plain script): <script src="shared/story/season.js"> → window.SpaceFarmerStory.season
//   - ESM client wrapper: client/systems/StoryService.js re-exports it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.SpaceFarmerStory = Object.assign(root.SpaceFarmerStory || {}, { season: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Season light — the day the colony wakes into ──
  const seasonText = {
    spring: "Spring haze softens the crater rim; the soil smells of stardust and of debt.",
    summer: "Summer light bakes the plaza boards; the fields run gold and the work runs long.",
    fall: "Fall air carries ozone and the smell of boiling wine; the fields give their last, full answer.",
    winter: "Winter's silver dusk closes in; the generator's hum is one beat slower than it was.",
  };

  // ── Named per festival — the lamps are lit for whatever the calendar says is on ──
  const festivalText = {
    naming: "The lamps come up the ridge path and the old mission bell answers the dawn — it is The Naming, and B-612 remembers the first light.",
    "solar-flare-fair": "Bonfires leap higher than the solar flares tonight — it is the Solar Flare Fair, and the colony\u2019s cooking contest hangs in zero-g over the plaza.",
    "galactic-harvest": "The Exchange boards run gold and the air smells of boiling wine — it is the Galactic Harvest Festival, and the fields gave their last, full answer.",
    hearthnight: "Every dome is lit at once, every table set, every door open — it is Hearthnight, the colony\u2019s shared holiday. And tonight they eat Earth rations, the meal that tastes like grief and salt.",
  };

  // Fallback for any festival the calendar has no named flavor for yet — an
  // injected/test festival id must never borrow a *named* festival's prose.
  const genericFestivalText = "The lamps come up across the plaza and the colony turns out — some festival is on, and B-612 gathers to keep it together.";

  // ── Pressures — the weather of obligation: debt, the failing generator,
  // winter, and the still bell on the old mission tower ──
  const pressures = [
    "The debt is older this morning, and the ledger does not sleep.",
    "Somewhere in the generator housing, a knock repeats like a word you almost know.",
    "Winter is a rumor that grows louder each dawn.",
    "On the ridge, the bell on the old mission tower is still.",
  ];

  return {
    seasonText,
    festivalText,
    genericFestivalText,
    pressures,
  };
});
