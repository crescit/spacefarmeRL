# Space Farmer — Task Board (Jira-style, dependency-ordered)

> Companion to [`ROADMAP.md`](ROADMAP.md). **The canonical executable plan.**
> Every task below is small, independently verifiable, and carries its
> dependencies so work can only start in a valid order.

## Legend
- **ID** — `P<phase>.<n>`; phase prefixes encode ordering (P0 foundations → P5 web).
- **Deps** — task IDs that must be `✅ Done` before this one may start.
- **Done when** — the verification that marks a task complete (a test, a
  render, a review step). No task is done on vibes.

## Working rules
1. **Ordered by deps only.** Never start a task whose deps are open — even if
   it looks independent to the eye.
2. **Done = verified.** Each task's `Done when` must actually run/read before
   flipping it.
3. **Statuses:** `⬜ todo` · `🔄 in progress` · `✅ done`. Update as you go.
4. **Stubs before endpoints.** Only the tasks marked *(gate: endpoint)* require
   the real model endpoint (`OPENAI_BASE_URL`, default
   `http://127.0.0.1:8000/v1`). Everything before them runs on stubs.

---

## The queue in one glance (topological start order)

**Ready immediately (no deps):** P0.2, P5.1, P5.4, P5.6, P5.8
**P0 (foundations):** P0.1 → P0.2 → P0.3 → P0.4 → P0.5 → P0.7 → P0.8 (P0.6
parallel under P0.3) — everything RL sits on this.
**P1 (tool-calling):** P1.1 → P1.2 → P1.3 / P1.4 → P1.5 → P1.6
**P2 (living world):** P2.1 → P2.2 → P2.3 → P2.4, and P2.5 under P1.5
**P3 (MCP):** P3.1 → P3.2 → P3.3
**P4 (trustworthy eval):** P4.1 → P4.2 → P4.3 → P4.4
**P5 (web/art):** P5.1 → P5.2 → P5.3 · P5.4 → P5.5 → P5.7 · P5.6/P5.8 anytime

---

## Phase P0 — Foundations (Node core, no endpoint)

| ID | Task | Deps | Done when |
|---|---|---|---|
| P0.1 | **Charter doc** — write `docs/COLONY_SAGA.md`: 7 design laws, free-will/ consequence-symmetry spec, mission-era framing, Serra-homage placement, season/year clock | — | Doc reviewed & committed; ROADMAP points at it |
| P0.2 | **Calendar** — add `SEASONS`, 7-day season / 28-day year constants, `seasonOf(day)`/`horizonInSeasons` helpers to `env_core.cjs` | — | `node -e` prints season boundaries; unit tests |
| P0.3 | **Tool schema** — single-source `TOOLS` (18 tools: till/plant/water/harvest/sell/buy_animal/feed/upgrade_tool/fish/mine/gift/talk/claim_festival/advance_day + inspect/get_state/read_colony_log/write_journal) with world-voice descriptions + JSON params | P0.1, P0.2 | Schema validates against engine params; 0 drift between consumers by construction |
| P0.4 | **Bridge spec v2** — expose `tools` + `narrative` capability in `spec`; bump `protocolVersion` backward-compatibly | P0.3 | Bridge spec test; old clients unaffected |
| P0.5 | **Colony Briefing** — headless `briefing()` in `env_core`: sensory prose + colony pressure (debt, generator, winter, Earth Day) + quest arc (ACT 1–3) + compact legal-state block | P0.2, P0.3, P0.1 | Deterministic briefing renders; prose snapshot test |
| P0.6 | **Tool-result prose** — `describe()` engine: colorful, consequence-symmetric one-liners per action type (+/- faces) | P0.3 | Every tool has ≥1 line per outcome; determinism test |
| P0.7 | **Trajectory v2** — header gains `action_interface`, records native actions + tool names + prose; exact replay; v1 files still replay | P0.4 | Replay fixture (v1 + v2) round-trips byte-exact |
| P0.8 | **P0 test gate** — schema, calendar, briefing/prose determinism, trajectory compat | P0.5, P0.6, P0.7 | `npm run test:rl` + focused node tests green |
| P0.9 | **Stamina/energy authority (1:1)** — one server-side gate (`ENERGY_COSTS` + `_spendEnergy`) shared by browser and RL; stamina as a trainable skill (`staminaMax` conditioning + rest recovery); seeds owned by handlers; `till` intent actually sent; client reads authoritative stamina; `verify_energy.mjs` | P0.3, P0.4 | `verify_energy` + full suite green (done) |

---

## Phase P1 — Native tool-calling & observability

| ID | Task | Deps | Done when |
|---|---|---|---|
| P1.1 | **Native step path** — `env_gym.step_native(native)` + legal-state helpers; no macro codec needed | P0.4 | Python `step_native` matches Node env step semantics |
| P1.2 | **Tool loop** — `llm_policy.py` OpenAI `tools` + `tool_choice:"auto"` + `role:tool` results + conversation memory; endpoint default `:8000`, `OPENAI_BASE_URL`/`--base-url` override | P0.3, P0.4 | Stub OpenAI server round-trips a `tool_calls` dialogue; legacy strict-JSON path recorded as fallback only |
| P1.3 | **Introspection tools** — `get_state`/`inspect`/`read_colony_log`/`write_journal` execute against obs + log/journal storage | P1.2, P0.5 | Stub agent can read state and write a journal entry |
| P1.4 | **Debug capture** — `--debug-dir` raw request/response logs + per-call latency/validity/token lines | P1.2 | A run writes readable per-call logs; no secrets leaked |
| P1.5 | **Runner** — `rollout_tools.py` + `eval_local_model.py --tools` with season horizon (default 1 season = 7d) | P1.4, P0.7 | Season sprint runs end-to-end; trajectory v2 written |
| P1.6 | **Stub divergence + gate tests** — stub with varied valid actions must diverge from first-valid fallback; truncation/timeout surfaced; fallback counters filled | P1.5 | New regression suite red-if-collapse (this is the v2-bug trap) |

*(gate: endpoint)* P1.7 | **Real-endpoint season sprint** — one spring on `:8000`, verify validity counters & logs | P1.6 | Valid sprint report; no silent fallback |

---

## Phase P2 — The living colony (narrative experience)

| ID | Task | Deps | Done when |
|---|---|---|---|
| P2.1 | **Briefing turns** — day-open briefing injected into the tool loop; conversation bounded per day | P1.2, P0.5 | A full day reads as one narrative turn |
| P2.2 | **Flavor to tools** — `describe()` prose flows into every `role:tool` result (both faces) | P0.6, P1.2 | Tool results in transcript carry consequence lines |
| P2.3 | **Memory** — Colony Log + journal persisted per identity under `trajectories/<run>/<identity>/`; past journal returns in briefings | P1.3, P0.5 | Day 8 briefing quotes the player's day-1 entry |
| P2.4 | **Narrated systems** — season turns, festival phases, heart events, marriage, friendships, contact aftermaths rendered in prose (never rewarded) | P2.2, P0.6 | Season/festival/marriage events appear in transcript |
| P2.5 | **Transcript renderer** — "day in the life" Markdown + HTML from a season trajectory | P1.5 | `npm run transcript -- <traj>` emits an MD + HTML diary |

---

## Phase P3 — MCP (any agent framework can walk in)

| ID | Task | Deps | Done when |
|---|---|---|---|
| P3.1 | **MCP server shell** — Node stdio server under `mcp/`; tools derive from the single schema (same names/params) | P0.3, P0.6 | `tools/list` returns the full surface |
| P3.2 | **Resources + prompts** — `farm://state`, `farm://colony-log`, `farm://npc/<id>`, `farm://year/<n>`; optional Keeper prompt (pressure, no fiat) | P3.1 | `resources/list` + a resource round-trips |
| P3.3 | **Smoke + docs** — MCP client test (list, act, read), `npm run mcp`, `mcp/README.md` with attach instructions | P3.2 | Scripted MCP client farms a tile and reads the log |

---

## Phase P4 — Trustworthy evaluation

| ID | Task | Deps | Done when |
|---|---|---|---|
| P4.1 | **Validity gate** — evaluator fails loudly if fallback/parse rates breach floor; per-episode `primary_valid_rate`/`retry_rate`/`fallback_count` | P1.6 | A deliberately broken policy run refuses, loudly |
| P4.2 | **Validity-aware surfaces** — `compare_evals` + markdown leaderboard read `models.json`; invalid rows refused or visibly flagged (HTML matches) | P4.1 | Leaderboard cannot contradict models.json |
| P4.3 | **Protocol lock + archive** — `native-tools-v1` the only evaluated interface; invalid v2 reports archived & labeled; models.json updated | P4.2 | `compare` refuses v1/v2 mix; archive notes explain |
| P4.4 | **Narrative metrics + report v4** — days survived, quests, friendships, journal entries, tools used, festivals; season/year horizons; report v4 | P4.1, P0.2 | A report row reads like a biography |

*(gate: endpoint)* P4.5 | **Real-endpoint year run + report** — one year on `:8000`; produce the first *valid* public report | P4.4 | Report + transcript committed; replay ✓ |

---

## Phase P5 — The web game with eyes (art & shared history)

| ID | Task | Deps | Done when |
|---|---|---|---|
| P5.1 | **Seasonal palette pass** — sky, ground tiles, decor, planet hue shift with season (spring/summer/fall/winter) | — | Day/night + seasonal contact sheets regenerate; sprite tests green |
| P5.2 | **The first bell** — subtle mission-tower landmark + old bell; rings at festival dawn; one line of world lore | P5.1 | Landmark in world; lore in STORY.md; fairness: never a signpost |
| P5.3 | **Weather & living set-dressing** — dawn/dusk grading, drifting stardust, haze, festival lamps + confetti, shimmering water/field sway, portrait frame expansion | P5.1 | Contact sheets updated; texture registry green |
| P5.4 | **Authoritative colony history** — first-contact doctrine choices move from `localStorage` to room state + persistence; humans and agents share one ledger | — | Make a doctrine choice in browser → it persists server-side and survives reload/another client |
| P5.5 | **Spectator corridor** — web view streams an agent's season (briefings, tool calls, journal) live from the narrative service | P5.4, P2.5 | From the browser you can watch a stub agent's day unfold in the plaza |
| P5.6 | **Server events to HUD** — register `daySummary`/`milestone`/`festivalPhase`; notifications on server truth | — | e2e logs show zero unused-event warnings |
| P5.7 | **Story content pass** — envoy stakes gain both faces, mission-era resonance, bell/old-mission copy, daily rumor + heart-event lines | P0.1, P5.2 | `verify_aliens` parity green; content reads Tolstoy-angled |
| P5.8 | **Housekeeping** — remove `PlanetScene.js.orig`, make ESM/CommonJS boundary explicit, sweep warnings | — | Clean repo; `npm test` green |

---

## Critical path (the longest pole)
**P0.1 → P0.2 → P0.3 → P0.4 → P0.5 → P0.7 → P0.8 → P1.1 → P1.2 → P1.3/1.4 → P1.5 → P1.6 → P4.1 → P4.2 → P4.3 → P4.4** (P2/P3 can branch off P1.5/P1.2; P5.4 + P2.5 → P5.5.)

## Guardrails
- **Never** mark a task done without its `Done when`.
- **Never** start P2/P3/P4 before the P0 gate is green — the schema/narrative core is load-bearing.
- P5.4 must land before P5.5 (spectator depends on shared history).
- The endpoint is *only* required at P1.7 and P4.5; everything else is stub-proof.

---

## Progress log (append-only)

- **2026-08-29 (overnight sprint)** — `6fe8dba`:
  - ✅ P0.1 charter (`docs/COLONY_SAGA.md`) · ✅ P0.2 story clock (7d/28d, `seasonOf`)
  - ✅ P0.3 single-source `TOOLS` (18 world-voice tools) in `rl/env_core.cjs`
  - ✅ P0.4 bridge spec v2 (`tools` + vocabulary + narrative commands)
  - ✅ P0.5 Colony Briefing · ✅ P0.6 consequence-symmetric tool prose
  - ✅ P0.7 trajectory v2 (`action_interface`, native/tool/prose records, v1-compatible)
  - ✅ P0.8 gate: `verify_narrative.mjs` + `verify_energy.mjs` wired into `npm test`
  - ✅ P0.9 **Stamina authority**: one gate (`ENERGY_COSTS`/`_spendEnergy`); work tires you, rest recovers, conditioning trains `staminaMax` (a skill you build); seeds/plant owned by the handler; browser `till` intent now actually sent; client reads authoritative stamina; obs exposes `staminaMax` (`f6d86a9`)
  - ✅ P1.1 native step path: `env_gym.native_step()` + narrative accessors (`briefing/state_text/inspect_text/colony_log/write_journal/journal_text`) through the bridge

**Open next:** P1.2 OpenAI tool-calling loop (tools/`tool_choice`/`role:tool`, rest = end of turn) with a stub-server round-trip test.
