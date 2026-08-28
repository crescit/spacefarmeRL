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

## OpenAI-compatible policies

~~~bash
OPENAI_BASE_URL=http://127.0.0.1:4000/v1 \
OPENAI_API_KEY=sk-local \
OPENAI_MODEL=local-coder \
python -m rl.python.rollout_llm
~~~

The model receives a compact state summary and valid action names. Invalid or
malformed responses deterministically fall back to the first valid action.
