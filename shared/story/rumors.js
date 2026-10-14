// shared/story/rumors.js — StoryBank: the colony's daily rumor lines.
//
// ROADMAP A3: the morning-after card ends with ONE gossip line. These are the
// rumors the colony passes around between domes — heard at the Grand Exchange,
// by the mission bell, in the cantina queue. Written ONCE here; PlanetScene
// renders them deterministically.
//
// Authoring rule: ONE one-line rumor per entry, space-colony tone, ≤ 90 chars,
// referencing colony NPCs (Nova, Luna, Zephyr, Vega, Quasar, Rhea, Astra,
// Orion, Comet, C.O.R.A.) or the envoys/bell vaguely. Never a rule, never a
// number the server owns — a rumor is camera talk, not authority.
//
// Loads everywhere (same pattern as shared/story/codex.js):
//   - Node (CommonJS):  const rumors = require("../shared/story/rumors.js");
//   - Browser (plain script): <script src="shared/story/rumors.js"> →
//     window.SpaceFarmerStory.rumors
//   - ESM client wrapper: client/systems/StoryService.js re-exports it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.SpaceFarmerStory = Object.assign(root.SpaceFarmerStory || {}, { rumors: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ≥ 21 one-line rumors. Pick of the day is deterministic:
  //   rumors[(day * 7 + 3) % rumors.length]  (rumorForDay below).
  const rumors = [
    'Luna swears the nebula shebang moved a degree since Sol 40 — the dome agrees.',
    'Vega traded three nebula-peppers for one glow-kelp strand and bragged all morning.',
    'Quasar says the reactor hum dropped half a tone; Nova logged it, nobody else.',
    'Rhea painted a cow helmet amber today; the herd applauded by standing very still.',
    'Orion found a stardust fleck in the shore mud and refused to say where exactly.',
    'C.O.R.A. answered a question with a question; the plaza took it as a compliment.',
    'Zephyr raced Comet to the exchange post and lost only by a boat-length of dust.',
    'The old bell rang once at dawn with nobody nearby; everyone pretended not to count.',
    'Astra says the shore taps colder this season; the seals disagree, politely.',
    'Nova rebuilt a drone wing overnight and logged the sound as "satisfactory".',
    'Comet collected dew off the greenhouse glass before anyone could ask why.',
    'An envoy watched the wheat for an hour and left without trading a single seed.',
    'Quasar bet the cantina a plate that gravity loosens near the old mission.',
    'Vega planted moon-melon early and now defends the decision louder than ever.',
    'Rhea counted sheep twice and got a different number both times; she blames wind.',
    'Luna hums the bell tone on the way to the domes; half the colony hums it back.',
    'Orion says the deep drop echoes for exactly three breaths — he timed it with salt.',
    'C.O.R.A. queued at the exchange twice today and bought nothing either time.',
    'Zephyr says the fence beams taste of copper at dusk; nobody has dared to check.',
    'Astra left a tomato on the airlock step with no note; the note case is open.',
    'Comet swears the fest confetti still drifts through dome seams on quiet nights.',
    'Nova polished the Grand Exchange orb until it ticked twice instead of once.',
    'An envoy hummed back to Luna across the plaza; the colony agreed to keep that.',
    'Rhea says the cows dream in amber; the chickens decline to comment.',
  ];

  // Deterministic daily pick — same day number, same rumor, everywhere
  // (browser, server, tests). Never returns undefined for a valid day ≥ 1.
  const rumorForDay = (day) => {
    const n = Number(day);
    const d = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    return rumors[(d * 7 + 3) % rumors.length];
  };

  return { rumors, rumorForDay };
});
