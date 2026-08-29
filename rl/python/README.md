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

env = FarmGymEnv(horizon_days=12)
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

with ParallelFarmEnv(4, horizon_days=12) as envs:
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
python -m rl.python.benchmark --seeds 10 --horizon-days 12
python -m pip install -r rl/python/requirements-train.txt
python -m rl.python.train_ppo --timesteps 10000 --seed 7
~~~

PPO uses `sb3-contrib` MaskablePPO and the environment's live action mask.

## OpenAI-compatible policy evaluation

~~~bash
export OPENAI_BASE_URL=http://127.0.0.1:8000/v1
export OPENAI_API_KEY=sk-local
export OPENAI_MODEL=local-coder
python -m rl.python.eval_local_model --seeds 10 --horizon-days 12 --resume
~~~

The model receives a compact state summary and only currently valid macro
actions. The report includes reward, final credits, steps, request latency,
random/economic baselines, and per-seed replayable trajectories. Keep
`--seeds`, `--seed-start`, and `--horizon-days` fixed when comparing models.
Malformed responses deterministically fall back to the first valid action.
The npm evaluator enables `--resume` by default. Each completed seed is
checkpointed in the output JSON, and replay-valid partial trajectories continue
at their next step. With `--resume`, a
compatible report skips those seeds; an interrupted in-progress seed restarts.
