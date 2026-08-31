// shared/story/intro.js — StoryBank: the cinematic intro (crawl + title card).
//
// The opening crawl and title-card copy for the browser intro live HERE, not
// in IntroScene.js, so the words a player reads can also appear in docs, the
// spectator corridor, and any future cinematic. IntroScene renders this data;
// it does not own it.
//
// Loads everywhere (same pattern as shared/calendar.js):
//   - Node (CommonJS):  const intro = require("../shared/story/intro.js");
//   - Browser (plain script): <script src="shared/story/intro.js"> → window.SpaceFarmerStory.intro
//   - ESM client wrapper: client/systems/StoryService.js re-exports it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.SpaceFarmerStory = Object.assign(root.SpaceFarmerStory || {}, { intro: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── The opening crawl, line by line ──
  const crawl = [
    "YEAR 2987.",
    "EARTH IS A DUSTBALL.",
    "",
    "The Galactic Farm Initiative —",
    "humanity's last great project —",
    "seeded the cosmos with",
    "terraforming stations.",
    "",
    "Mars was tamed.",
    "Venus was harvested.",
    "A comet-based agri-platform",
    "orbited Jupiter.",
    "",
    "But the crown jewel was",
    "ASTEROID B-612 — a small",
    "rocky world with impossibly",
    "rich cosmic soil.",
    "",
    "Your grandfather built it.",
    "Tamed the solar winds.",
    "Made friends with the",
    "nebula-dwellers.",
    "",
    "He also left a note:",
    "\"If you're reading this, I'm dead,",
    "\"and the compost is yours.",
    "",
    "Now he's gone.",
    "The farm — and the very large",
    "unpaid debt to Quasar —",
    "is yours.",
    "",
    "Welcome, farmer. There's food",
    "to grow, a colony to feed, and",
    "two AIs who may or may not",
    "love you.",
    "",
    "— SPACE FARMER —",
  ];

  // ── Title card copy shown after the crawl ──
  const title = "SPACE FARMER";
  const eyebrow = "A  B-612  FRONTIER  STORY";
  const subtitle = "Grow a future at the edge of the known sky";
  const pressStart = "SPACE  /  TAP  TO  ARRIVE";

  return {
    crawl,
    title,
    eyebrow,
    subtitle,
    pressStart,
  };
});
