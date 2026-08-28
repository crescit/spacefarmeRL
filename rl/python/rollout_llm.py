#!/usr/bin/env python3
"""Collect a replayable episode from an OpenAI-compatible policy server."""
from __future__ import annotations

import argparse
from pathlib import Path

from rl.python.env_gym import FarmGymEnv
from rl.python.llm_policy import OpenAIActionPolicy
from rl.python.trajectory import TrajectoryRecorder, replay_trajectory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument("--model")
    parser.add_argument("--api-key")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--horizon-days", type=int, default=12)
    parser.add_argument("--max-steps", type=int, default=500)
    parser.add_argument("--output", type=Path, default=Path("trajectories/llm-episode.jsonl"))
    args = parser.parse_args()

    policy = OpenAIActionPolicy(args.base_url, args.model, args.api_key)
    recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=args.horizon_days), args.output)
    total = 0.0
    try:
        recorder.reset(seed=args.seed)
        for _step in range(args.max_steps):
            action = policy.choose(recorder.env)
            _obs, reward, terminated, truncated, info = recorder.step(action)
            total += reward
            print(f"day={recorder.env.raw_obs['day']} action={info['type']} reward={reward:.3f}")
            if terminated or truncated:
                break
    finally:
        recorder.close()

    replay = replay_trajectory(args.output)
    print(f"trajectory={args.output} steps={replay['steps']} reward={total:.3f} replay=OK")


if __name__ == "__main__":
    main()
