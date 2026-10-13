// shared/story/reckoning.js — StoryBank: the season's end reckoning.
//
// Charter #1/#4: humans and agents share one experience, and every season ends
// with the same question. rl/env_core.cjs testimony() already renders the
// agent's reckoning; THIS file gives the human player the SAME face of the
// same story — the two surfaces read identical topics in identical words:
//
//   fields worked vs left to the weather · ledger solvent/thin/in debt ·
//   colonists known vs stranger to stranger · envoys answered (with the
//   doctrine list) vs the frontier unanswered · quests closed vs open ·
//   and the bell's final question.
//
// It is reward-neutral on purpose: no score, no grade, no reward rides on it
// (charter #6) — the object it returns carries only { title, lines }.
//
// Loads everywhere (same pattern as shared/story/aliens.js):
//   - Node (CommonJS):  const { buildReckoning } = require("../shared/story/reckoning.js");
//   - Browser (plain script): <script src="shared/story/reckoning.js"> →
//     window.SpaceFarmerStory.reckoning
//   - ESM client wrapper: client/systems/StoryService.js re-exports it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.SpaceFarmerStory = Object.assign(root.SpaceFarmerStory || {}, { reckoning: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

// Season names: read the shared calendar's names when it is present (the
// browser loads shared/calendar.js before this script; the server requires
// shared/calendar.js beside it) so the wording never drifts from season math.
const seasonNames = () => {
  const cal = (typeof globalThis !== "undefined" && globalThis.SpaceFarmerCalendar) || null;
  const names = cal && Array.isArray(cal.SEASON_NAMES) && cal.SEASON_NAMES.length ? cal.SEASON_NAMES : null;
  return names || ["SPRING", "SUMMER", "FALL", "WINTER"];
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : 0;
};

// Pluralize a small count without punctuation games.
const units = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// buildReckoning(r): pure, deterministic prose. r is the per-player record:
//   { season, credits, lifetime:{earned,harvested,sold,fished,mined,gifts},
//     friends:{npcId:points}, contactChoices:{scenarioId:doctrineId},
//     questsCompleted, marriedTo }
// Returns { title:'<Season> on B-612 is over.', lines:[...] }.
function buildReckoning(r) {
  const rec = r || {};
  const names = seasonNames();
  const seasonIdx = Math.max(0, Math.min(names.length - 1, num(rec.season)));
  const seasonName = String(names[seasonIdx]).toLowerCase();
  const credits = num(rec.credits);
  const lt = rec.lifetime || {};
  const harvested = num(lt.harvested), sold = num(lt.sold), fished = num(lt.fished);
  const mined = num(lt.mined), gifts = num(lt.gifts);
  const friends = rec.friends || {};
  const friendIds = Object.keys(friends);
  const trustTotal = friendIds.reduce((sum, id) => sum + num(friends[id]), 0);
  const contacts = rec.contactChoices || {};
  const contactPairs = Object.entries(contacts);
  const questsCompleted = num(rec.questsCompleted);
  const marriedTo = rec.marriedTo || "";

  const lines = [];
  // The work: did the land give? — both faces.
  const field = [];
  if (harvested > 0) field.push(`cut ${units(harvested, "harvest")}`);
  if (sold > 0) field.push(`sold ${units(sold, "crop load")}`);
  if (fished > 0) field.push(`brought in ${fished} catch${fished === 1 ? "" : "es"} of fish`);
  if (mined > 0) field.push(`swung the pick ${units(mined, "time")}`);
  if (gifts > 0) field.push(`gave ${units(gifts, "gift")} away`);
  if (!field.length) lines.push("The fields were left to the weather; nothing was planted, nothing cut.");
  else lines.push("The years record: " + field.join(", ") + ".");
  // The ledger: money is allowed to be tight or terrible — all three faces.
  if (credits >= 150) lines.push(`The colony ledger closes at ${credits} cr — solvent, this season, by the keeper's hand.`);
  else if (credits >= 0) lines.push(`The ledger closes at ${credits} cr — thin, but not in debt.`);
  else lines.push(`The ledger closes at ${credits} cr — the colony owes, and the debt column has this keeper's name on it.`);
  // The people: friendships are a record, not a number to optimize.
  if (friendIds.length > 0) lines.push(`${units(friendIds.length, "colonist")} came to know you — ${Math.round(trustTotal)} heart-units of trust carried across the season.`);
  else lines.push("No colonist was met on the way — the season passed stranger to stranger.");
  if (marriedTo) lines.push(`You are bound to ${marriedTo} — a vow was made in the colony's daylight.`);
  // The frontier: envoys answered, or unanswered.
  if (contactPairs.length > 0) {
    lines.push(`${units(contactPairs.length, "first-contact charter")} entered colony history: ${contactPairs.map(([scenario, doctrine]) => `${scenario}=${doctrine}`).join(", ")}. No judgment number was assigned.`);
  } else {
    lines.push("The alien envoys received no doctrine from this keeper; the frontier remained unanswered.");
  }
  // The word kept: quests carried to their close, or left open.
  if (questsCompleted > 0) lines.push(`The colony's thread moved: ${units(questsCompleted, "quest")} carried to their close.`);
  else lines.push("The colony's thread moved nowhere new — quests were left open where you found them.");

  lines.push("");
  lines.push("The bell asks the only question worth asking: What kind of keeper were you?");
  return {
    title: `${String(names[seasonIdx]).charAt(0).toUpperCase() + String(names[seasonIdx]).slice(1)} on B-612 is over.`,
    lines,
  };
}

return { buildReckoning };
});
