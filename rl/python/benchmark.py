#!/usr/bin/env python3
"""Compare reproducible random and economic baseline policies."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv

ADVANCE = ACTION_LABELS.index("advance")
SELL = ACTION_LABELS.index("sell")
MINE = ACTION_LABELS.index("mine")


@dataclass
class Episode:
    policy: str
    seed: int
    reward: float
    steps: int
    credits: float


def choose_random(env: FarmGymEnv, rng: np.random.Generator, step: int) -> int:
    valid = np.flatnonzero(env.action_masks())
    return int(rng.choice(valid))


def choose_economic(env: FarmGymEnv, _rng: np.random.Generator, step: int) -> int:
    mask = env.action_masks()
    if mask[SELL]:
        return SELL
    if mask[MINE] and step % 20 < 18:
        return MINE
    return ADVANCE


def run_episode(policy: str, seed: int, horizon_days: int) -> Episode:
    env = FarmGymEnv(horizon_days=horizon_days)
    rng = np.random.default_rng(seed)
    chooser = choose_random if policy == "random" else choose_economic
    try:
        env.reset(seed=seed)
        total = 0.0
        for step in range(2000):
            _obs, reward, terminated, truncated, _info = env.step(chooser(env, rng, step))
            total += reward
            if terminated or truncated:
                return Episode(policy, seed, total, step + 1, float(env.raw_obs["credits"]))
        raise RuntimeError("episode exceeded safety step limit")
    finally:
        env.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--horizon-days", type=int, default=None,
                        help="days per episode (default: one season per Node's calendar)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    episodes = [
        run_episode(policy, seed, args.horizon_days)
        for policy in ("random", "economic")
        for seed in range(1, args.seeds + 1)
    ]
    summary = {}
    for policy in ("random", "economic"):
        selected = [episode for episode in episodes if episode.policy == policy]
        summary[policy] = {
            "mean_reward": float(np.mean([episode.reward for episode in selected])),
            "mean_credits": float(np.mean([episode.credits for episode in selected])),
            "episodes": [episode.__dict__ for episode in selected],
        }
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print("policy       mean reward    mean credits")
        for policy, values in summary.items():
            print(f"{policy:<12} {values['mean_reward']:>11.3f} {values['mean_credits']:>15.1f}")


if __name__ == "__main__":
    main()
