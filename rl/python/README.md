# Python RL interface

## Install

~~~bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r rl/python/requirements.txt
~~~

## Gymnasium

~~~python
from rl.python.env_gym import ACTION_LABELS, FarmGymEnv

env = FarmGymEnv(horizon_days=30)
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(
    ACTION_LABELS.index("mine")
)
print(info["native_action"], info["action_mask"])
env.close()
~~~

`SimBridge` is the canonical one-to-one interface. It accepts the same message
name and payload fields as the browser, such as
`{"type": "plant", "tileX": 2, "tileY": 3, "crop": "space-wheat"}`.
For the Grand Exchange, whose payload itself has a `type`, use the unambiguous
wire envelope `{"type":"order","data":{"type":"sell",...}}`.
Each step returns a lossless `obs["state"]`, the direct handler result in
`info["result"]`, and all emitted messages in `info["messages"]`.

`FarmGymEnv` adds a derived numeric observation and one convenience macro for
each of the 25 wire actions so standard discrete algorithms can still train.
`native_step()` bypasses macro argument selection and preserves exact control.

## Parallel rollouts

~~~python
from rl.python.vector_env import ParallelFarmEnv

with ParallelFarmEnv(4, horizon_days=30) as envs:
    observations, infos = envs.reset([1, 2, 3, 4])
    observations, rewards, terms, truncs, infos = envs.step([6, 6, 6, 6])
~~~

Each worker has its own Node process and deterministic RNG stream.

## Trajectories

`TrajectoryRecorder` writes a schema-version-free JSONL header followed by
native transitions. Every transition includes the handler result and complete
message stream. `replay_trajectory(path)` re-executes every action and checks
the complete raw observation, reward, and termination flags.

## Baselines and PPO

~~~bash
python -m rl.python.benchmark --seeds 10 --horizon-days 30
python -m pip install -r rl/python/requirements-train.txt
python -m rl.python.train_ppo --timesteps 10000 --seed 7
~~~

PPO uses `sb3-contrib` MaskablePPO and the environment's live action mask.

## OpenAI-compatible policy evaluation

~~~bash
npm run eval:endpoint -- http://127.0.0.1:8000
~~~

The endpoint runner discovers the sole model from `/v1/models`, derives safe
artifact paths, and applies the locked release settings: 30 seeds, one season,
thinking disabled, a full-game mechanics prompt, strict JSON, 256 output
tokens, streamed responses, and resumable serial execution. The reward weights,
horizon, remaining days, time-advance rule, crop loop, and crop credit values
come from the Node environment. Each legal action includes the exact resolved
native schema, and the model supplies every argument itself, so buying, crop
selection, fishing, mining, ranching, social choices, and alien doctrines are
policy decisions rather than evaluator defaults. The
model briefly compares expected returns before emitting its action. No model family
gets an automatic private task token. `--model-task action` is an explicit
DeepSeek-only diagnostic and is recorded as a separate interface. Pass
`--model` only for a gateway that advertises multiple
models, or `--workers N` only when the backend supports that concurrency.
Release trajectories live in the semantically named
`trajectories/<model>/<protocol>/` directory so resume cannot mix
actions produced under different reasoning protocols.

`advance` is never an evaluator fallback. It executes only when the model
explicitly returns the native `advance` action. A recognizable but illegal
payload is dispatched unchanged so the production handler can reject and log
it; completely unparseable output stops the episode without executing any game
action, and the validity gate refuses the report. Every primary and retry
response plus its validation error is retained in the trajectory.

`--action-batch-size N` enables an experimental batched protocol. The model
plans up to `N` macro actions in one JSON response; actions execute one at a
time and are revalidated against current state. The first invalid queued action
clears the remaining plan and requests a fresh completion. Combining batching
with a non-default effort automatically uses isolated names such as
`energy-grounded-native-batch-8-high-stream`.

The release default remains one action per call; batching stays experimental.

The model receives a compact state summary and only currently valid macro
actions. The report includes reward, final credits, steps, request latency,
random/economic baselines, and per-seed replayable trajectories. Keep
`--seeds`, `--seed-start`, and `--horizon-days` fixed when comparing models.
Each trajectory step audits the exact resolved native action, state deltas, and
the model's rationale/token/retry/timing metadata.
Malformed responses deterministically fall back to the first valid action.
The npm evaluator enables `--resume` by default. Each completed seed is
checkpointed in the output JSON, and replay-valid partial trajectories continue
at their next step. With `--resume`, a
compatible report skips those seeds; an interrupted in-progress seed restarts.

### Report v4 — biography, not a bar

Every episode also carries the environment's own **narrative record** (report
`report_version: 4`): days survived, quests completed, friendships gained,
journal entries written, festivals claimed, unique tools used — plus the
**testimony**, the end-of-season reckoning the env renders from that record
("What kind of keeper were you?"). The testimony is reward-neutral prose
computed by the Node authority; it never changes credits or reward. Each
trajectory stores the same record as its terminal `episode-summary` line
(replay skips it, so the transition byte-stream stays replay-exact).

### Release protocol — 30 season-ones

For release evals, run thirty one-season episodes (30 days each):

~~~bash
npm run eval:endpoint -- http://127.0.0.1:8000
~~~

- `--horizon 1 season | 1 year | N` resolves against the single-source B-612
  calendar (season = 30 days); `--horizon-days` still gives exact control.
- `--workers N` runs independent seeds concurrently — each worker owns its own
  simulation process and policy instance — while preserving the partial-report
  checkpoint after every completed seed. The locked default is `1`, which avoids
  queue-inflated latency on single-sequence serving profiles.
- The Markdown leaderboard (`compare_evals.py`) and HTML dashboard
  (`render_eval_report.py`) surface the narrative columns beside reward,
  credits, steps, and latency; per-seed testimony renders in the dashboard and
  in the `transcript.py` diaries.
