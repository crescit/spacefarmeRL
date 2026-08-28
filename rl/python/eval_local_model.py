#!/usr/bin/env python3
"""Evaluate an OpenAI-compatible model policy across deterministic farm seeds."""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from rl.python.benchmark import run_episode
from rl.python.env_gym import FarmGymEnv
from rl.python.llm_policy import OpenAIActionPolicy
from rl.python.trajectory import TrajectoryRecorder, replay_trajectory


@dataclass
class ModelEpisode:
    policy: str
    seed: int
    reward: float
    steps: int
    credits: float
    mean_latency_ms: float
    p95_latency_ms: float
    trajectory: str
    replay_ok: bool


def percentile(values: list[float], fraction: float) -> float:
    """Nearest-rank percentile without an optional statistics dependency."""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return float(ordered[index])


def evaluate_episode(
    policy: OpenAIActionPolicy,
    seed: int,
    horizon_days: int,
    max_steps: int,
    trajectory_dir: Path,
) -> ModelEpisode:
    path = trajectory_dir / f"seed-{seed}.jsonl"
    recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=horizon_days), path)
    total_reward = 0.0
    latencies: list[float] = []
    try:
        recorder.reset(seed=seed)
        for _step in range(max_steps):
            started = time.perf_counter()
            action = policy.choose(recorder.env)
            latencies.append((time.perf_counter() - started) * 1000.0)
            _obs, reward, terminated, truncated, info = recorder.step(action)
            total_reward += reward
            print(
                f"seed={seed} step={recorder.steps:03d} "
                f"day={recorder.env.raw_obs['day']} action={info['type']:<14} "
                f"reward={reward:7.3f} latency={latencies[-1]:7.1f}ms"
            )
            if terminated or truncated:
                break
        else:
            raise RuntimeError(
                f"seed {seed} exceeded --max-steps={max_steps}; "
                "raise the limit or inspect the policy"
            )
        credits = float(recorder.env.raw_obs["credits"])
        steps = recorder.steps
    finally:
        recorder.close()

    replay = replay_trajectory(path)
    return ModelEpisode(
        policy=policy.model,
        seed=seed,
        reward=total_reward,
        steps=steps,
        credits=credits,
        mean_latency_ms=float(statistics.fmean(latencies)) if latencies else 0.0,
        p95_latency_ms=percentile(latencies, 0.95),
        trajectory=str(path),
        replay_ok=replay["steps"] == steps,
    )


def aggregate(episodes: list[dict[str, Any]]) -> dict[str, float]:
    def mean(key: str) -> float:
        return float(statistics.fmean(float(row[key]) for row in episodes))
    result = {
        "episodes": float(len(episodes)),
        "mean_reward": mean("reward"),
        "mean_credits": mean("credits"),
        "mean_steps": mean("steps"),
    }
    if episodes and "mean_latency_ms" in episodes[0]:
        result["mean_latency_ms"] = mean("mean_latency_ms")
        result["p95_episode_latency_ms"] = percentile(
            [float(row["p95_latency_ms"]) for row in episodes], 0.95
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate a local chat model against deterministic Space Farmer seeds."
    )
    parser.add_argument("--base-url")
    parser.add_argument("--model")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=float, default=30.0, help="request timeout in seconds")
    parser.add_argument("--seeds", type=int, default=5, help="number of seeds")
    parser.add_argument("--seed-start", type=int, default=1)
    parser.add_argument("--horizon-days", type=int, default=12)
    parser.add_argument("--max-steps", type=int, default=500)
    parser.add_argument(
        "--output", type=Path, default=Path("artifacts/evals/local-model.json")
    )
    parser.add_argument(
        "--trajectory-dir", type=Path, default=Path("trajectories/local-model-eval")
    )
    parser.add_argument(
        "--no-baselines", action="store_true", help="skip random/economic comparisons"
    )
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")

    policy = OpenAIActionPolicy(args.base_url, args.model, args.api_key, timeout=args.timeout)
    seeds = list(range(args.seed_start, args.seed_start + args.seeds))
    print(f"model={policy.model} endpoint={policy.base_url} seeds={seeds}")

    try:
        model_episodes = [
            evaluate_episode(
                policy, seed, args.horizon_days, args.max_steps, args.trajectory_dir
            )
            for seed in seeds
        ]
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(
            f"Model endpoint unavailable at {policy.base_url}: {exc}\n"
            "Start your OpenAI-compatible server and verify its /v1/chat/completions route."
        ) from exc

    policies: dict[str, list[dict[str, Any]]] = {
        "model": [asdict(episode) for episode in model_episodes]
    }
    if not args.no_baselines:
        for name in ("random", "economic"):
            policies[name] = [
                asdict(run_episode(name, seed, args.horizon_days)) for seed in seeds
            ]

    result = {
        "schema_version": 1,
        "environment": {
            "horizon_days": args.horizon_days,
            "seeds": seeds,
            "action_interface": "masked-macro-v1",
        },
        "model": {
            "name": policy.model,
            "base_url": policy.base_url,
        },
        "summary": {name: aggregate(rows) for name, rows in policies.items()},
        "episodes": policies,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("\npolicy       mean reward    mean credits    mean steps    latency")
    for name, values in result["summary"].items():
        latency = (
            f"{values['mean_latency_ms']:.1f}ms"
            if "mean_latency_ms" in values else "-"
        )
        print(
            f"{name:<12} {values['mean_reward']:>11.3f} "
            f"{values['mean_credits']:>15.1f} {values['mean_steps']:>13.1f} "
            f"{latency:>10}"
        )
    print(f"\nreport={args.output}")
    print(f"trajectories={args.trajectory_dir} replay=OK")


if __name__ == "__main__":
    main()
