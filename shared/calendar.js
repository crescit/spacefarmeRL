// shared/calendar.js — THE B-612 calendar service. Single source of truth.
//
// Every part of the game reads the calendar from HERE — the authoritative
// server (server/rooms/FarmRoom.js), the deterministic RL mirror
// (rl/env_core.cjs), and the browser client (via client/systems/CalendarService.js).
// No module keeps its own copy of season math, crop maturity, or festival
// dates; if you want to change how long a season lasts, change
// DAYS_PER_SEASON below (or pass { daysPerSeason } to createCalendar) and the
// whole game — seasons, growth pacing, festival dates, cutscenes — follows.
//
// Loads everywhere:
//   - Node (CommonJS):      const { Calendar, DEFAULT_CALENDAR } = require('../shared/calendar.js');
//   - Browser (plain script): <script src="shared/calendar.js"> → window.SpaceFarmerCalendar
//   - ESM client wrapper:     client/systems/CalendarService.js re-exports it.
//
// The calendar is INJECTABLE: services that depend on it accept a Calendar
// instance (constructor/field injection) and fall back to DEFAULT_CALENDAR, so
// tests and variants can swap the whole calendar without touching consumer code.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.SpaceFarmerCalendar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── THE KNOB ─────────────────────────────────────────────────────────
  // Change this one number and every derived value below re-tunes itself:
  // season boundaries, festival dates, crop maturity, eval horizons, calls.
  const DAYS_PER_SEASON = 30;

  const SEASON_NAMES = ['SPRING', 'SUMMER', 'FALL', 'WINTER'];
  const SEASONS = SEASON_NAMES.map((n) => n.toLowerCase());
  const SEASON_COUNT = SEASONS.length; // 4

  // ── Yearly-recurring festivals ─────────────────────────────────────────
  // Each festival happens exactly once per B-612 year (30-day seasons, so a
  // 120-day year). The dates echo the old church calendar Earth left behind —
  // Annunciation / Lady Day, Midsummer / Saint John, Michaelmas, Christmas —
  // kept as memory of home, not as worship, the way the colony's mission-era
  // bells kept the old feast days. `season`/`dayInSeason` are offsets, so the
  // dates move with DAYS_PER_SEASON automatically.
  const DEFAULT_FESTIVALS = [
    {
      id: 'naming',
      season: 0, dayInSeason: 25,            // Spring 25 — Annunciation / Lady Day (Mar 25)
      name: 'The Naming',
      short: 'THE NAMING',
      earthDay: false,
      blurb: 'Spring 25 — the colony marks the first dawn of B-612, the day the land was already named. The old mission bell rings at first light, and every colonist is welcome to hear it.',
    },
    {
      id: 'solar-flare-fair',
      season: 1, dayInSeason: 24,            // Summer 24 — Midsummer / Nativity of Saint John (Jun 24)
      name: 'Solar Flare Fair',
      short: 'SOLAR FLARE FAIR',
      earthDay: false,
      blurb: 'Summer 24 — midsummer, the feast the first colonists kept for Saint John. The flares peak and the bonfires outshine them; Rhea runs the zero-g cooking contest and the fireworks go on at dusk.',
    },
    {
      id: 'galactic-harvest',
      season: 2, dayInSeason: 29,            // Fall 29 — Michaelmas (Sep 29)
      name: 'Galactic Harvest Festival',
      short: 'HARVEST FESTIVAL',
      earthDay: false,
      blurb: 'Fall 29 — Michaelmas, the old end of the harvest, kept as the colony once kept it. The fields give their last, full answer, the Exchange runs at festival prices, and Orion challenges you to a harvest-off.',
    },
    {
      id: 'hearthnight',
      season: 3, dayInSeason: 25,            // Winter 25 — Christmas (Dec 25)
      name: 'Hearthnight',
      short: 'HEARTHNIGHT',
      earthDay: true,                        // the Sol Earth Festival — ACT 3's finale is here
      blurb: 'Winter 25 — the colony\u2019s one midwinter holiday, kept for everyone, whatever they believe: hearth, light, gifts, and the whole town eating together. And because the only home they can share is the one they left, it is also the night they eat Earth rations — the meal that tastes like grief and salt.',
    },
  ];

  function clampInt(v, lo, hi) {
    const n = Number(v);
    return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
  }

  class Calendar {
    constructor(opts = {}) {
      // daysPerSeason is the single tuning knob.
      this.daysPerSeason = clampInt(opts.daysPerSeason ?? DAYS_PER_SEASON, 1, 366);
      const names = Array.isArray(opts.seasonNames) && opts.seasonNames.length ? opts.seasonNames : SEASON_NAMES;
      this.seasonNames = names.map((n) => String(n).toUpperCase());
      this.seasonCount = this.seasonNames.length;

      // Crop maturity: ONE formula, shared by server and every mirror.
      // Scales with season length so longer seasons grow crops at the same
      // felt pace; override explicitly with { cropMaturityDays } if you want
      // a fixed number instead.
      this.cropMaturityDays = opts.cropMaturityDays != null
        ? clampInt(opts.cropMaturityDays, 1, 90)
        : clampInt(this.daysPerSeason / 5, 3, 10);

      // Resolve festival offsets to absolute year-days (moves with daysPerSeason).
      const list = Array.isArray(opts.festivals) && opts.festivals.length ? opts.festivals : DEFAULT_FESTIVALS;
      this.festivals = list
        .map((f) => {
          const season = clampInt(f.season, 0, this.seasonCount - 1);
          const dayInSeason = clampInt(f.dayInSeason, 1, this.daysPerSeason);
          return {
            id: String(f.id),
            name: String(f.name),
            short: String(f.short || f.name).toUpperCase(),
            earthDay: !!f.earthDay,
            blurb: String(f.blurb || ''),
            season,
            dayInSeason,
            dayInYear: season * this.daysPerSeason + dayInSeason,
          };
        })
        .sort((a, b) => a.dayInYear - b.dayInYear);
    }

    // A B-612 year = four seasons.
    get yearLength() { return this.daysPerSeason * this.seasonCount; }

    // 1-based absolute day → 0-based season index (wraps across years).
    seasonIndex(day) {
      const d = Math.max(1, Math.floor(day));
      return Math.max(0, Math.min(
        this.seasonCount - 1,
        Math.floor((d - 1) / this.daysPerSeason) % this.seasonCount,
      ));
    }

    // Lowercase season name for an absolute day ('spring', 'summer', …).
    seasonName(day) { return String(this.seasonNames[this.seasonIndex(day)]).toLowerCase(); }

    // Uppercase label ('SPRING').
    seasonLabel(day) { return this.seasonNames[this.seasonIndex(day)]; }

    // 1-based day within its season (1..daysPerSeason).
    dayInSeason(day) { return ((Math.max(1, Math.floor(day)) - 1) % this.daysPerSeason) + 1; }

    // 1-based day within the 120-day year (1..yearLength).
    dayInYear(day) { return ((Math.max(1, Math.floor(day)) - 1) % this.yearLength) + 1; }

    // 1-based year number containing the day.
    yearOf(day) { return Math.floor((Math.max(1, Math.floor(day)) - 1) / this.yearLength) + 1; }

    // The festival landing exactly on this absolute day, or null.
    festivalForDay(day) {
      const d = Math.max(1, Math.floor(day));
      const yday = this.dayInYear(d);
      const f = this.festivals.find((x) => x.dayInYear === yday);
      if (!f) return null;
      return { ...f, day: d };
    }

    // Whether this absolute day is any festival day.
    isFestivalDay(day) { return !!this.festivalForDay(day); }

    // Soonest festival strictly after `day` (same calendar rules → at most one
    // year away, since every festival recurs yearly). Returns {…, day, inDays}.
    nextFestivalAfter(day) {
      const d = Math.max(0, Math.floor(day));
      for (let n = 1; n <= this.yearLength; n++) {
        const f = this.festivalForDay(d + n);
        if (f) return { ...f, day: d + n, inDays: n };
      }
      return null;
    }

    // How fast crops drink the season: winter is slowest, spring/summer fastest.
    growthMultiplier(seasonIndex) {
      const s = Math.max(0, Math.min(this.seasonCount - 1, seasonIndex));
      if (s === this.seasonCount - 1) return 0.5;   // winter
      return (s === 0 || s === 1) ? 1 : 0.75;        // spring/summer : fall
    }

    // Watered in-season growth-days a crop needs to mature (shared by server).
    maturityDays() { return this.cropMaturityDays; }
  }

  function createCalendar(opts = {}) { return new Calendar(opts); }

  // The one calendar the whole game runs on. Inject a different instance only
  // when you explicitly want a variant (tests, experiments).
  const DEFAULT_CALENDAR = createCalendar();

  return {
    Calendar,
    createCalendar,
    DEFAULT_CALENDAR,
    DAYS_PER_SEASON,
    SEASONS,
    SEASON_NAMES,
    SEASON_COUNT,
    DEFAULT_FESTIVALS,
    // Stateless shorthand bound to the default calendar (kept for old callers;
    // season math still lives here and nowhere else).
    seasonOf: (day) => DEFAULT_CALENDAR.seasonIndex(day),
    seasonName: (day) => DEFAULT_CALENDAR.seasonName(day),
    festivalForDay: (day) => DEFAULT_CALENDAR.festivalForDay(day),
    nextFestivalAfter: (day) => DEFAULT_CALENDAR.nextFestivalAfter(day),
  };
});
