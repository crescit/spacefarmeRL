// client/systems/CalendarService.js — ESM wrapper over the B-612 calendar
// service (shared/calendar.js is the ONE implementation of season math,
// crop maturity, and festival dates — the browser never re-implements it).
//
// Two load paths, same module:
//   1. Browser: index.html loads shared/calendar.js as a plain <script>, which
//      installs window.SpaceFarmerCalendar; we read that global.
//   2. Headless (Node tests): no global — we load the CommonJS source directly
//      via createRequire. Either way we get the SAME singleton the server and
//      the RL environment use.
const g = globalThis.SpaceFarmerCalendar;

let mod;
if (g) {
  mod = g;
} else {
  // Headless / tooling only — never reached in the browser (the <script> tag
  // above runs first). Dynamic import keeps 'node:module' out of the bundle.
  const { createRequire } = await import('node:module');
  const localRequire = createRequire(import.meta.url);
  mod = localRequire('../../shared/calendar.js');
}

export const Calendar = mod.Calendar;
export const createCalendar = mod.createCalendar;
export const DEFAULT_CALENDAR = mod.DEFAULT_CALENDAR;
export const DAYS_PER_SEASON = mod.DAYS_PER_SEASON;
export const SEASONS = mod.SEASONS;
export const SEASON_NAMES = mod.SEASON_NAMES;
export const SEASON_COUNT = mod.SEASON_COUNT;
export const DEFAULT_FESTIVALS = mod.DEFAULT_FESTIVALS;

// The shared default calendar instance — identical to the server's and the
// RL env's, so the browser, the room, and the episodes all agree on seasons,
// growth, and festival dates with no duplicated definitions.
export const calendar = mod.DEFAULT_CALENDAR;
