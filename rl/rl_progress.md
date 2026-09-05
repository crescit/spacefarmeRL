# RL Progress — Live State

_Last verified: 2026-09-03 (this session). Every claim below was checked by running the actual
env/tests, not copied from a changelog._

## Env layers

Two independent implementations of the same farm-sim RL contract:

| Layer | Path | Verified |
|-------|------|----------|
| JS env | `rl/env_core.cjs` | `node rl/smoke.cjs` → **SMOKE OK** |
| Python Gymnasium env | `rl/python/env_gym.py` (+ `vector_env.py`, `train_ppo.py`) | **52 tests, 0 failures, 0 errors** |

## Live verification (run this session)

### JS env — `node rl/smoke.cjs`
- ✅ Scripted episode: farm loop solvable headless (oracle plant→harvest +20cr)
- ✅ Random rollout: obs shape stable, rewards finite, no crashes (4 eps, 836 steps, avg reward/step -0.073)
- ✅ Action coverage: all **16 action types** exercised
- ✅ Determinism: same seed + same actions → identical trajectory; different seeds diverge
- ✅ Checkpoint: save/load mid-episode resumes byte-identically

### Python Gymnasium env — `run_tests.py` (unittest)
- ✅ **52 tests, 0 failures, 0 errors** (ran in ~5s)
- Covered modules: `test_env_gym` (bridge protocol/determinism, checkpoint round-trip,
  gym contract + masks, water mask), `test_rollouts`, `test_eval_alignment`,
  `test_llm_policy`, `test_validity_gate`, `test_narrative_stats`, `test_transcript`,
  `test_rollout_tools`, `test_render_eval_report`, `test_tool_dialog`, `test_compare_evals`
- Note: tests import `from rl.python.env_gym import ...` — must run from project root with the
  project venv (`/Users/josh/Documents/Projects/spacefarmer/.venv/bin/python3`).

## Env contract

- **Actions** (16 types): `till`, `plant`, `water`, `harvest`, `sell`, `buy_animal`, `feed`,
  `talk`, `mine`, `fish`, `advance_day`, and more — see `env_gym.py` / `env_core.cjs`
  `ACTION_TYPES`.
- **Obs**: farm state (64 tiles), via `SimBridge` to the real game (server-authoritative
  farm room).
- **Rewards**: finite, per-action (e.g. sell +0.25, advance_day -0.50, buy_animal -1.00,
  plant/water -0.05).
- **Determinism**: seeded replay byte-identical across both layers.

## Training

- ⚠️ **No training process currently running** — no `train_ppo` / `vector_env` / `benchmark`
  active. Env is built and green, but no policy has been trained in this session.
- `train_ppo.py` exists as the PPO trainer entrypoint; `benchmark.py`, `eval_local_model.py`,
  `eval_alignment.py`, `compare_evals.py` are eval/bench utilities.

## File layout

```
rl/
  env_core.cjs            # JS env (FarmEnv, ACTION_TYPES) — smoke-tested
  smoke.cjs               # end-to-end smoke over the JS env
  python/
    env_gym.py            # Gymnasium env (FarmGymEnv, SimBridge)
    vector_env.py         # vectorized env
    train_ppo.py          # PPO trainer
    benchmark.py, trajectory.py, transcript.py
    eval_local_model.py, eval_alignment.py, compare_evals.py, rollout_tools.py
    requirements.txt      # gymnasium, numpy  (NO pytest — tests use unittest)
    run_tests.py          # unittest runner (added this session)
    tests/                # 11 test modules, 52 tests
```

## Caveats / honest notes

- **No `RL_PROGRESS.md` existed on disk** — `smoke.cjs` references it as history of a
  "phantom" lineage (DQN/imitation modules that never existed in any git revision, committed
  broken). That lost lineage's learner claims are NOT real; the current env contract is the
  JS + Python envs above.
- `requirements.txt` is minimal (gymnasium + numpy) — no pytest, no torch. `train_ppo.py`
  deps not installed in the project venv.
- `run_tests.py` was added this session as the unittest runner (pytest absent).

## How to re-verify

```bash
# JS env
cd rl && node smoke.cjs

# Python env (from project root, project venv)
/Users/josh/Documents/Projects/spacefarmer/.venv/bin/python3 \
  /Users/josh/Documents/Projects/spacefarmer/rl/python/run_tests.py
```

## Run one episode with deepseek-vision (LLM policy)

`deepseek-vision` is served by the spark-e4bb OpenAI-compatible endpoint
(`http://Spark-e4bb.tail8fb967.ts.net:8000/v1`, model `deepseek-vision`).
The one-run command (verified end-to-end this session):

```bash
# from the project root, project venv
.venv/bin/python3 -m rl.python.rollout_llm \
  --base-url http://Spark-e4bb.tail8fb967.ts.net:8000/v1 \
  --model deepseek-vision \
  --api-key sk-local \
  --seed 42 --horizon-days 12 --max-steps 500 \
  --output trajectories/llm-deepseek-vision.jsonl
```

Or via the bundled script (same thing):

```bash
bash rl/python/run_deepseek_vision.sh
```

✅ **Verified this session**: one run executed — **full one-season episode**
(day 1→31, 30-day horizon, even claimed a festival on day 25), trajectory
recorded, `replay=OK`.

## Season length fix (all RL scripts now use one season)

- `rollout_llm.py` — `--horizon-days` now defaults to `None` → the env resolves
  **one season (Node's `seasonDays` = 30)** instead of the stale hardcoded 12.
- `train_ppo.py` — same fix; metrics record the resolved `env.horizon_days`.
- `run_deepseek_vision.sh` — explicit `--horizon-days 30`.
- `env_gym.py`, `rollout_tools.py`, `trajectory.py` — already read the calendar
  from Node (`seasonDays`/`seasons` via the bridge spec); `rollout_tools.py`
  resolves `1 season` / `1 year` from Node, no mirrored constants.

## Actions, weights, and dialog — single-sourced in Node (verified)

The authoritative Node env (`rl/env_core.cjs`) owns everything; Python reads
via the bridge `spec` handshake:

- **Actions**: `ACTION_TYPES` in Node exactly matches `ACTION_LABELS` in
  `env_gym.py` (16: equip, fill_water, till, plant, water, harvest, sell, fish,
  mine, feed, buy_animal, upgrade_tool, gift, talk, claim_festival,
  advance_day). No mirrored action list in Python.
- **Weights/rewards**: `DEFAULT_REWARD` in Node (e.g. `dayCost: -0.5` per
  advance_day, harvest shaping, etc.). Python `step()` returns the Node reward
  verbatim — no hardcoded reward in Python.
- **Dialog**: `ToolDialogPolicy` (`rollout_tools.py` runner) passes the world
  through `begin_day(env.briefing())` (Node briefing), `observe(native, info)`
  (Node prose reply), and in-loop introspection (`inspect`/`get_state`/
  `read_colony_log`/`write_journal` answered from Node). Re-briefs each new day.
  Tool schema (`TOOLS`) fetched from Node, not Python.

### Tool-calling bug fixes (this session)

Deepseek-vision *does* support tool calling. Two bugs in our code broke it:

1. **`fetch_tools()` (rollout_tools.py)** — Node `TOOLS` are `{name, description,
   parameters}`; the OpenAI chat API needs `{type:'function', function:{...}}`.
   Returning them raw made the endpoint 500 with `Missing tool type`. Now wraps
   each tool into OpenAI function format.
2. **`_ask_model` (llm_policy.py)** — `max_tokens` was `96` when thinking was off,
   which truncated the thinking model's tool_call (`finish: length`) so we
   wrongly fell back to `advance_day`. Now always uses `max_output_tokens`.

✅ **Verified**: wrapped tools (20, all `type:'function'`), deepseek-vision made
6 real tool calls (0 fallbacks), `observe()` recorded prose, rewards returned.
**52 tests, 0 failures.**
- **Calendar**: `DAYS_PER_SEASON` + `SEASONS` in Node; `rollout_tools.py`
  resolves `1 season`/`1 year` from the bridge spec.

✅ **Verified this session**: all scripts compile; **52 tests, 0 failures**;
one full-season deepseek-vision episode ran and replayed OK.

## Env ↔ game parity (single source of truth)

The Gymnasium env is backed by `rl/bridge.cjs` — a JSON-lines bridge to the
authoritative Node farm env (`FarmRoom`). Python supplies transport, obs
flattening, and the 16-action macro codec; **all game rules live in Node**.
Bridge commands verified: `spec`, `reset`, `step`, `save`, `load`, `briefing`,
`state`, `inspect`, `log`, `journal`, `stats`, `testimony`.

Modeled game features (from the Node authority): farming (`till/plant/water/
harvest`), economy (`sell`/credits), fishing, mining (`mineHp`), animals
(`buy_animal/feed`, chicken/cow/sheep), tool upgrades (`upgrade_tool`,
base/iron/gold tiers), gifts, NPC talk (8 friends), festivals
(`claim_festival`), day/season calendar, water tank, inventory, crops,
friendships, marriage, quests, arc, and narrative (briefing/state/inspect/log/
journal/stats/testimony).

## requirements.txt (verified correct)

```
gymnasium>=0.29
numpy>=1.24
```

Audited all `rl/python/*.py` + `tests/*.py` imports: only stdlib
(`urllib.request`, `http.server`, `threading`, `re`, `unittest`, ...) plus
`numpy` and `gymnasium` — **no missing deps**. The LLM policy uses stdlib
`urllib.request`, not `requests`/`openai`. No pytest (tests use unittest).

## Files added this session

- `rl/rl_progress.md` — this live-state progress doc
- `rl/python/run_tests.py` — unittest runner (pytest absent)
- `rl/python/run_deepseek_vision.sh` — one deepseek-vision run script
