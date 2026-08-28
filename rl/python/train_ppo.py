#!/usr/bin/env python3
"""Train and evaluate a masked PPO policy on Space Farmer."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from rl.python.env_gym import FarmGymEnv


def evaluate(model, episodes: int, seed: int, horizon_days: int) -> dict:
    rewards = []
    credits = []
    for episode in range(episodes):
        env = FarmGymEnv(horizon_days=horizon_days)
        try:
            obs, _info = env.reset(seed=seed + episode)
            total = 0.0
            for _step in range(4000):
                action, _state = model.predict(obs, deterministic=True, action_masks=env.action_masks())
                obs, reward, terminated, truncated, _info = env.step(int(action))
                total += reward
                if terminated or truncated:
                    break
            rewards.append(total)
            credits.append(float(env.raw_obs["credits"]))
        finally:
            env.close()
    return {
        "episodes": episodes,
        "mean_reward": float(np.mean(rewards)),
        "std_reward": float(np.std(rewards)),
        "mean_credits": float(np.mean(credits)),
        "rewards": rewards,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timesteps", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--horizon-days", type=int, default=12)
    parser.add_argument("--eval-episodes", type=int, default=5)
    parser.add_argument("--output", type=Path, default=Path("artifacts/ppo"))
    parser.add_argument("--check-env", action="store_true")
    args = parser.parse_args()

    env = FarmGymEnv(horizon_days=args.horizon_days)
    if args.check_env:
        from gymnasium.utils.env_checker import check_env
        try:
            check_env(env, skip_render_check=True)
            print("Gymnasium environment check: OK")
        finally:
            env.close()
        return

    try:
        from sb3_contrib import MaskablePPO
    except ImportError as error:
        raise SystemExit(
            "Training dependencies are missing. Run: "
            "python -m pip install -r rl/python/requirements-train.txt"
        ) from error

    args.output.mkdir(parents=True, exist_ok=True)
    model = MaskablePPO(
        "MlpPolicy",
        env,
        seed=args.seed,
        verbose=1,
        n_steps=min(256, max(32, args.timesteps // 4)),
        batch_size=32,
        gamma=0.99,
        learning_rate=3e-4,
        policy_kwargs={"net_arch": [128, 128]},
    )
    try:
        model.learn(total_timesteps=args.timesteps, progress_bar=False)
        model_path = args.output / "space_farmer_masked_ppo"
        model.save(model_path)
    finally:
        env.close()

    metrics = evaluate(model, args.eval_episodes, args.seed + 10_000, args.horizon_days)
    metrics.update({
        "algorithm": "MaskablePPO",
        "seed": args.seed,
        "timesteps": args.timesteps,
        "horizon_days": args.horizon_days,
        "model": str(model_path.with_suffix(".zip")),
    })
    metrics_path = args.output / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
