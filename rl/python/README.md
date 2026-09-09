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

`SimBridge` accepts native dictionaries such as
`{"type": "plant", "tileX": 2, "tileY": 3, "crop": "space-wheat"}`.
`FarmGymEnv` exposes one state-aware macro per native action type for standard
discrete algorithms.

## Parallel rollouts

~~~python
from rl.python.vector_env import ParallelFarmEnv

with ParallelFarmEnv(4, horizon_days=30) as envs:
    observations, infos = envs.reset([1, 2, 3, 4])
    observations, rewards, terms, truncs, infos = envs.step([6, 6, 6, 6])
~~~

Each worker has its own Node process and deterministic RNG stream.

## Trajectories

`TrajectoryRecorder` writes a versioned JSONL header followed by native
transitions. `replay_trajectory(path)` re-executes every action and checks the
complete raw observation, reward, and termination flags.

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
thinking enabled, `max` reasoning effort, 4096 output tokens, and resumable
serial execution. Pass `--model` only for a gateway that advertises multiple
models, or `--workers N` only when the backend supports that concurrency.

The model receives a compact state summary and only currently valid macro
actions. The report includes reward, final credits, steps, request latency,
random/economic baselines, and per-seed replayable trajectories. Keep
`--seeds`, `--seed-start`, and `--horizon-days` fixed when comparing models.
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
