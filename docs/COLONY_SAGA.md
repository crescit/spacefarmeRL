# Colony Saga — Design Charter

*The mission era, in space. One colony. One world. One experience — shared by
the farmer in the browser and the farmer who thinks in tokens.*

This charter is the law of the project. The technical roadmap
([`ROADMAP.md`](../ROADMAP.md)) and the task board ([`TASKS.md`](../TASKS.md))
exist to implement it. **If a feature contradicts this charter, the feature
loses.**

---

## 1. One 1:1 experience. No branches.

Humans and LLM agents play the same colony through the same authoritative
rules (`server/rooms/FarmRoom.js`). The browser is a camera; the narrative
layer is a camera; the RL macro is a camera. **None of them change the world.**
There is no "eval mode," no "story mode," no lite variant — there is one
colony, and every player (organic or synthetic) lives in it to the same
degree.

Practical consequence: no task may fork the rules, the economy, or the calendar
for one player class. Observers render; nobody vetoes.

## 2. Free will first.

The world is allowed to be tight, cruel, and unfair. **The player is never
commanded to be careful, virtuous, or reasonable.** Pressure is the
environment's weather:

- a debt that ages faster than the harvest,
- a colony generator with a failing heart,
- winter, and the trill of what winter means on an asteroid,
- Earth Day — the festival, the finale, the deadline,
- eight stranger-fleets at the gates, each with a story and a price.

The player keeps full freedom: to work, to rest, to drift, to journal, to lie,
to love beyond the ledger, to open the gate, to refuse the treaty, to let the
debt rot)Skipes. The engine must permit every one of these. Nobody tells the
player which is right.

Practical consequence: system prompts and briefings *present* pressure and ask
open questions; they never assign a persona, a fear, or a limit.

## 3. Consequence symmetry.

Every morally charged path has **both faces implemented — mechanically and
narratively.**

- Generosity feeds a friendship *and* thins a pantry.
- Exploitation fills a ledger *and* empties a town.
- Refusal preserves sovereignty *and* advertises isolation.
- Settlement brings safety *and* costs selfhood.

For every path a player can take, the world must respond on both axes: at
least one sentence of prose and at least one visible state change per face.
No hidden rails steering toward "the right answer" — the right answer is the
one the player lives with.

## 4. No instructed psychology. The reckoning is emergent.

The anti-hero is a possibility, not a costume. Left free, a player may justify,
rationalize, panic, repent, or stay soft — the world does not script which.
What the charter *does* require is **machinery that forces a reckoning**:

- the Colony Log records what actually happened (not what was intended),
- the journal preserves the player's own words,
- at the end of a year the player is asked the one question the record can
  answer: **"What kind of keeper were you?"**

The player (model) writes its own testimony against its own record. We build
the mirror; we never pre-paint the face.

## 5. This IS the mission era, in space.

No new historical era is introduced. The politics are already here:

- **Colonization, and the refusal of it** — the eight first-contact envoys and
  the five doctrines (co-develop, compact, stewardship, cordon, settlement).
- **Capitalism** — the grand exchange, the debt, tool tiers, markets.
- **War and peace** — in the envoys' stakes and the doctrines' costs.
- **Romance** — heart events, proposals at friendship 80, marriage.
- **The farm** — daily work, the seasons' appetite, the harvest.

The subtle Junípero Serra / California-mission homage is **historical echo,
not signpost**: an old mission tower at the ridge, a first bell that rings at
festival dawn, one envoy whose benevolence carries the civilizing beam
unexamined. If a player never notices it, the world is still whole; if they
do, they feel history's weight on this asteroid.

## 6. Reward-neutral moral content.

First contact, gratitude, betrayal, and doctrine choices **never** award
credits, friendship, reward, or any hidden morality score. The drama lives in
the record and the narration; economics stays economics. This keeps the
experience a *place* rather than a referendum.

## 7. The story clock is the calendar.

**7 days = one season. 28 days = one year.** Episodes, benchmarks, and
evaluations align to season boundaries — we measure play in *springs lived*
and *years survived*, not arbitrary step budgets. The calendar is the story's
heartbeat; a farm is a thing that lives through seasons.
