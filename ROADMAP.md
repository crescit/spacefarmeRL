# Space Farmer — Technical Roadmap

*The mission era, in space. One colony, one world, one experience — shared by the
farmer in the browser and the farmer who thinks in tokens.*

Status: locked for execution. No external deployment in scope. Everything below
is orderable, testable work with a definition of done per phase.

> Execution lives in **[`TASKS.md`](TASKS.md)** — the dependency-ordered task
> board (small tasks, explicit deps, `Done when` per task). Read it before
> starting anything; the roadmap below gives the why, the board gives the how.

---

## 0. The Charter (design laws — everything else obeys these)

1. **One 1:1 experience, no branches.** Humans and LLM agents play the same
   colony through the same authoritative rules. The browser is a *camera*;
   the narrative layer is a camera; neither changes the world. No "eval mode,"
   no "story mode," no cut-down variants — one experience, many eyes.
2. **Free will first.** The world is allowed to be tight and terrible; the
   agent is never allowed to be commanded. Pressure is the environment's
   weather (debt clock, failing generator, winter, Earth Day deadline, the
   eight envoys at the gates) — never an instruction about what the agent may
   or may not risk. The agent can be generous, greedy, lazy, reckless,
   devout, or defiant — and the world will *consequence* it either way.
3. **Consequence symmetry.** Every morally charged path has both faces
   implemented — mechanically *and* narratively. Kindness feeds friendships
   and starves a pantry. Exploitation fills a ledger and hollows a town.
   At least one sentence of prose and at least one visible state change per
   face. No hidden rails toward "the right answer."
4. **No instructed psychology.** Anti-hero reckoning is *emergent*: the model
   makes free choices, the Colony Log and journal record them, and the end-of-
   year testimony ("What kind of keeper were you?") asks the player to answer
   with the record it left. We build the machinery that forces a reckoning;
   we never script the apology.
5. **The mission era IS the setting.** Colonization, refusal of colonization,
   capitalism, romance, war, and peace are already the politics of this
   asteroid — no new "era" to add. The subtle Junípero Serra / California-
   mission homage (a first bell, old-mission lore, one envoy's resonance)
   is woven into world content as historical echo, never a signpost.
6. **Reward-neutral moral content.** First contact, gratitude, and betrayal
   never award credits, friendship, reward, or any hidden morality score.
   The drama lives in the record and the narration; economics stays economics.
7. **The story clock is the calendar.** Episodes, benchmarks, and evaluations
   align to the game's own seasons: **7 days = one season, 28 days = one
   year.** We measure play in seasons lived, not arbitrary step budgets.

---

## 1. Architecture invariants (already true — must be preserved)

- `server/rooms/FarmRoom.js` is the *only* authority for economy, crops,
  seasons, quests, relationships, livestock, mining, fishing, and festivals.
- `rl/env_core.cjs` wraps it headlessly; nothing reimplements rules.
- Determinism: seeded episodes, mid-episode checkpoints, exact replay.
- Tool schemas, narrative prose, and observation shapes are **single-sourced
  in Node** and consumed by Python, the evaluator, and the MCP server —
  no drift between interfaces.

---

## 2. RL environment — the living colony for thinking farmers

### W1 — Native tool language (end the JSON-parse hellscape)
- **Single-source tool schema** in `rl/env_core.cjs` (`TOOLS`), exposed through
  the bridge `spec` so Python and MCP derive one definition. ~18 typed
  functions, written in world-voice, not API-voice:
  - Acts on the world: `till`, `plant`, `water`, `harvest`, `sell`,
    `buy_animal`, `feed`, `upgrade_tool`, `fish`, `mine`, `gift`, `talk`,
    `claim_festival`, `advance_day` (rest).
  - Looks and remembers: `inspect`, `get_state`, `read_colony_log`,
    `write_journal`.
- **OpenAI tool-calling loop** in `rl/python/llm_policy.py`: `tools` +
  `tool_choice:"auto"` per the OpenAI contract; execute returned `tool_calls`
  natively against the env; append `role:"tool"` results; loop until the
  player rests or ends the day. Strict-JSON remains only as a *recorded*
  legacy fallback (with validity counters) — never the primary channel.
- **Endpoint:** default `http://127.0.0.1:8000/v1`, overridable via
  `OPENAI_BASE_URL` / `--base-url`, documented for LiteLLM and any
  OpenAI-compatible proxy. This repo goes public again; make it friends'
  hardware friendly.
- **Native step path:** `env_gym.step_native(native)` and trajectory v2
  (records `action_interface`, native actions, tool names, prose) with
  replay-exact guarantees preserved.
- **Faster loop:** season sprints (7 days) for iteration; year-long sagas
  (28 days) for committed reports.
- **Acceptance:** a stub agent plays a full spring season; trajectories
  diverge from the first-valid fallback; replay ✓; validity counters on.

### W2 — Logging & observability (never a black box again)
- `--debug-dir`: capture every raw request/response (content,
  reasoning_content, tool_calls, finish_reason, token usage) for a run.
- Per-tool-call log lines: tool name + args, latency, validity
  (parsed / retried / fallback), tokens, resulting prose.
- **Transcript writer:** a human-readable "day in the life" rendering of every
  episode (briefings, tool calls, prose results, journal entries) as
  Markdown and HTML — the artifact you watch, not just the JSON you read.
- Trajectory JSONL stays the source of truth; transcripts are derived
  artifacts, regenerable, replay-validated.
- **Acceptance:** after any 7-day run you can read a transcript that tells
  the story, and the jsonl replays to the byte.

### W3 — Narrative layer (the world talks back)
- **Colony Briefing** at the top of each day: sensory prose (season light,
  weather, festival lamps), the pressure the colony is under (debt, the
  generator's failing heart, winter, the envoys), the current quest arc
  (ACT 1 The Debt → ACT 2 The Failing Heart → ACT 3 Earth Day), and a
  compact legal-state block so actions stay grounded.
- **Colorful tool results** with consequence symmetry: +42 cr and "Rhea's
  eyes light up — she *loves* cooked-food," or "the pantry is fuller, her
  trust thinner." One sentence per outcome, both faces implemented.
- **Colony Log + journal:** `read_colony_log` narrates the days so far;
  `write_journal` persists the agent's own words to its identity memory —
  the same farmer remembers yesterday, and its past self comes back into
  today's briefing.
- **Narrated world systems:** seasons turning, festival phases, heart events,
  marriage, friendship levels, first-contact aftermaths — all rendered in
  prose without granting reward.
- **Acceptance:** read a spring-season transcript and feel the colony as a
  place with weather, people, obligation, and daylight — not a state vector.

### W4 — Validity gates & trustworthy evaluation
- Evaluator fails loudly (never silently caps) when fallback / parse rates
  exceed a floor; episodes report `primary_valid_rate`, `retry_rate`,
  `fallback_count`.
- Regression tests that would have caught the v2 collapse: a stub model
  producing varied valid actions must *not* equal the fallback trajectory;
  truncation/timeouts surface; parse-rate gates tested.
- `compare_evals.py` reads `models.json` validity — invalid rows are refused
  or visibly flagged in the **Markdown leaderboard** too (HTML already
  flags), so the surfaces cannot contradict.
- Protocol lock: `native-tools-v1` becomes the only evaluated interface;
  `masked-macro-v3-strict` remains for conventional learners; invalid v2
  reports are archived and clearly labeled.
- **Acceptance:** a valid report is produced xor the pipeline refuses loudly.

### W5 — Episode shapes & evaluation metrics
- Season/year horizons (`--horizon 1 season | 1 year`), season boundaries as
  the only cut points; "spring on B-612" is a describable thing.
- Narrative metrics beside reward/credits/steps: days survived, quests
  completed, friendships gained, journal entries, unique tools used, tool
  validity, festivals attended, and the end-of-year testimony surfaced in
  reports.
- **Acceptance:** a report row reads like a biography, not a bar.

### W6 — MCP server (any agent framework can walk in)
- Node stdio server under `mcp/` wrapping `env_core.cjs` in-process — same
  single-sourced schema, zero drift.
- Tools: the full W1 surface. Resources: `farm://state`, `farm://colony-log`,
  `farm://npc/<id>`, `farm://year/<n>`. Prompts: the Keeper framing as an
  optional template (pressure, not fiat).
- `npm run mcp` + `mcp/README.md` with attach instructions (Claude Desktop,
  Open WebUI, Cursor, any MCP client).
- **Acceptance:** an MCP client lists tools, round-trips an action, reads
  resources, and the world narrates.

---

## 3. Web game — the colony with eyes

### A1 — Art & graphics pass (procedural; no asset pipeline magic)
- **Seasonal palettes:** the world visibly turns — spring greens, summer
  golds, fall ambers, winter silvers — in sky, ground tiles, decor, and
  planet hue.
- **Weather & light:** dawn/dusk color grading, drifting stardust,
  atmospheric haze per season, festival lamp bloom and confetti.
- **The first bell:** a subtle mission-tower landmark with an old bell that
  rings at festival dawn — the Junípero Serra echo, one line in world lore,
  never a signpost.
- **Living water & fields:** shimmering pond/kelp, animated crop sway,
  watering glints, aurora borealis nights. Envoy auras and arrival flashes
  polished.
- **Portraits & mood:** more expressive NPC portrait frames (3 → more), mood
  tints in dialogue, skin/value diversity preserved and widened.
- **Acceptance:** day/night + seasonal contact sheets regenerate and the
  sprite suite and texture registry tests stay green.

### A2 — Share the history (1:1 with agents)
- First-contact doctrine choices become **authoritative colony history**
  (room state + persistence) instead of per-browser localStorage: the human
  and the model make choices in the same ledger, and the aftermath persists
  beside the envoy for whoever walks up next.
- A **spectator/companion corridor:** from the web UI, watch an agent's
  season as it happens — briefings, tool calls, journal — streamed from the
  same narrative service. People watch their models live; models are no
  longer remote lab rats.
- **Acceptance:** make a doctrine choice in the browser; an agent's colony
  log inherits it; watch a stubbed agent's day from the plaza.

### A3 — Story content pass
- Sharpen the eight envoys toward mission-era tensions (civilizing beam,
  refuge, sovereignty, war-and-peace stakes) with both faces in the stakes
  text; weave the bell + old-mission lore into STORY.md and world copy.
- Daily rumor lines and heart-event dialogue deepen the interior pressure.
- **Acceptance:** `verify_aliens` (content parity + eval mirror) stays green.

### A4 — Client & server hygiene
- Register the server events the client currently ignores (`daySummary`,
  `milestone`, `festivalPhase`) so the HUD and notifications live on server
  truth.
- Cutscene/HUD/QoL polish; mobile & accessibility passes; remove
  `PlanetScene.js.orig`; resolve the mixed-module warning by making the
  ESM/CommonJS boundary explicit.
- **Acceptance:** `npm test` green incl. live e2e; zero unused-event
  warnings in e2e output.

---

## 4. Sequencing & phases (each green before the next)

| Phase | Scope | Definition of done |
|---|---|---|
| P0 | ROADMAP (+ Colony Saga charter doc), tool schema + narrative core in `env_core.cjs`, trajectory v2 | A briefing and a tool-prose render headlessly; existing tests green |
| P1 | OpenAI tool-calling loop, native step path, `--debug-dir`, validity counters, stub agent runner | Stub plays a spring; diverges from fallback; replay ✓; logs readable |
| P2 | Narrative layer: briefings, colorful symmetric results, Colony Log, journal memory, season narration, transcript renderer (MD/HTML) | A spring-season transcript reads like a world, not a logfile |
| P3 | MCP server (stdio) + resources + prompts + smoke test + docs | Any MCP client can farm, inspect, and read the colony |
| P4 | Validity gates, regression tests, protocol lock, validity-aware leaderboard/compare, archive invalid v2, narrative metrics, report v4 | Valid report or loud refusal; leaderboard can't contradict models.json |
| P5 | Web game: seasonal art/lighting pass, first bell, authoritative colony history, spectator corridor, story pass, event registration, hygiene | Browser and agent share one history; watch a model's day from the plaza; full suite green |

Validation order: stubs and synthetic models first (no endpoint needed), a
real-endpoint season sprint against `:8000` (or the user's chosen
`OPENAI_BASE_URL`) as the final integration gate for each RL phase.

---

## 5. Non-goals (deferred, deliberately)

- External deployment / hosting / public URL.
- PPO convergence work (`train_ppo` stays an example; the macro path stays
  the learner interface).
- Breaking up the `FarmRoom`/`PlanetScene` monoliths (kept, but sectioned;
  survives intact to stay honest: one authority, fewer interfaces to drift).
- Any new historical "era" content — the mission era is already the setting.

---

*The measure of success: a model plays a year on B-612, keeps a journal,
falls in love or starts a war, justifies itself to the bell — and you want to
read what it wrote.*
