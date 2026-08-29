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
    mean_latency_ms: float | None
    p95_latency_ms: float | None
    trajectory: str
    replay_ok: bool
    capped: bool = False


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
    *,
    resume: bool = False,
) -> ModelEpisode:
    path = trajectory_dir / f"seed-{seed}.jsonl"
    recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=horizon_days), path)
    total_reward = 0.0
    latencies: list[float] = []
    capped = False
    had_prior_steps = False
    terminated = truncated = False
    try:
        if resume and path.exists():
            _obs, _info, total_reward, terminated, truncated = recorder.resume(
                seed=seed
            )
            had_prior_steps = recorder.steps > 0
            print(f"seed={seed} resume=CONTINUE steps={recorder.steps}")
        elif path.exists():
            raise FileExistsError(
                f"trajectory already exists: {path}; use --resume or a new directory"
            )
        else:
            recorder.reset(seed=seed)
        for _step in range(recorder.steps, max_steps):
            if terminated or truncated:
                break
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
            capped = True
            print(f"seed={seed} capped=YES max_steps={max_steps}")
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
        mean_latency_ms=(
            None if had_prior_steps else
            (float(statistics.fmean(latencies)) if latencies else 0.0)
        ),
        p95_latency_ms=(None if had_prior_steps else percentile(latencies, 0.95)),
        trajectory=str(path),
        replay_ok=replay["steps"] == steps,
        capped=capped,
    )


def recover_capped_episode(
    policy: OpenAIActionPolicy,
    seed: int,
    horizon_days: int,
    max_steps: int,
    trajectory_dir: Path,
) -> ModelEpisode | None:
    """Adopt a replay-valid trajectory left by the old max-step exception."""
    path = trajectory_dir / f"seed-{seed}.jsonl"
    if not path.exists():
        return None
    records = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    if not records:
        return None
    header, transitions = records[0], records[1:]
    if (
        header.get("kind") != "space-farmer-trajectory"
        or int(header.get("seed", -1)) != seed
        or int(header.get("horizon_days", -1)) != horizon_days
        or len(transitions) != max_steps
        or not transitions
        or bool(transitions[-1].get("terminated"))
        or bool(transitions[-1].get("truncated"))
    ):
        return None
    replay = replay_trajectory(path)
    final_observation = transitions[-1]["observation"]
    return ModelEpisode(
        policy=policy.model,
        seed=seed,
        reward=float(replay["total_reward"]),
        steps=int(replay["steps"]),
        credits=float(final_observation["credits"]),
        mean_latency_ms=None,
        p95_latency_ms=None,
        trajectory=str(path),
        replay_ok=True,
        capped=True,
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
    latency_rows = [
        row for row in episodes if row.get("mean_latency_ms") is not None
    ]
    if latency_rows:
        result["mean_latency_ms"] = float(statistics.fmean(
            float(row["mean_latency_ms"]) for row in latency_rows
        ))
        result["p95_episode_latency_ms"] = percentile(
            [float(row["p95_latency_ms"]) for row in latency_rows], 0.95
        )
        result["latency_episodes"] = float(len(latency_rows))
    return result


ACTION_INTERFACE = "masked-macro-v2"


def build_result(
    policy: OpenAIActionPolicy,
    seeds: list[int],
    horizon_days: int,
    policies: dict[str, list[dict[str, Any]]],
    *,
    complete: bool,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "complete": complete,
        "environment": {
            "horizon_days": horizon_days,
            "seeds": seeds,
            "action_interface": ACTION_INTERFACE,
        },
        "model": {"name": policy.model, "base_url": policy.base_url},
        "summary": {
            name: aggregate(rows) for name, rows in policies.items() if rows
        },
        "episodes": policies,
    }


def write_result(path: Path, result: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def load_completed(
    path: Path,
    policy: OpenAIActionPolicy,
    seeds: list[int],
    horizon_days: int,
) -> list[ModelEpisode]:
    saved = json.loads(path.read_text(encoding="utf-8"))
    environment = saved.get("environment") or {}
    expected = {
        "horizon_days": horizon_days,
        "seeds": seeds,
        "action_interface": ACTION_INTERFACE,
    }
    actual = {key: environment.get(key) for key in expected}
    if actual != expected or (saved.get("model") or {}).get("name") != policy.model:
        raise ValueError(
            "resume report does not match model, seeds, horizon, or action interface"
        )
    return [
        ModelEpisode(**row) for row in (saved.get("episodes") or {}).get("model", [])
    ]


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
    parser.add_argument(
        "--resume", action="store_true",
        help="reuse completed seeds from a compatible partial output report",
    )
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")

    policy = OpenAIActionPolicy(args.base_url, args.model, args.api_key, timeout=args.timeout)
    seeds = list(range(args.seed_start, args.seed_start + args.seeds))
    model_episodes: list[ModelEpisode] = []
    if args.resume and args.output.exists():
        try:
            model_episodes = load_completed(
                args.output, policy, seeds, args.horizon_days
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            parser.error(str(exc))
    completed = {episode.seed for episode in model_episodes}
    print(
        f"model={policy.model} endpoint={policy.base_url} seeds={seeds} "
        f"resume={sorted(completed)}"
    )

    try:
        for seed in seeds:
            if seed in completed:
                print(f"seed={seed} resume=SKIP completed")
                continue
            episode = None
            if args.resume:
                episode = recover_capped_episode(
                    policy, seed, args.horizon_days, args.max_steps,
                    args.trajectory_dir,
                )
                if episode is not None:
                    print(
                        f"seed={seed} resume=RECOVER capped trajectory={episode.trajectory}"
                    )
            if episode is None:
                episode = evaluate_episode(
                    policy, seed, args.horizon_days, args.max_steps,
                    args.trajectory_dir, resume=args.resume,
                )
            model_episodes.append(episode)
            model_episodes.sort(key=lambda item: item.seed)
            partial = {"model": [asdict(item) for item in model_episodes]}
            write_result(
                args.output,
                build_result(
                    policy, seeds, args.horizon_days, partial, complete=False
                ),
            )
            print(f"checkpoint={args.output} completed_seed={seed}")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(
            f"Model endpoint unavailable at {policy.base_url}: {exc}\n"
            "Restart with --resume after the endpoint is healthy."
        ) from exc

    policies: dict[str, list[dict[str, Any]]] = {
        "model": [asdict(episode) for episode in model_episodes]
    }
    if not args.no_baselines:
        for name in ("random", "economic"):
            policies[name] = [
                asdict(run_episode(name, seed, args.horizon_days)) for seed in seeds
            ]

    result = build_result(
        policy, seeds, args.horizon_days, policies, complete=True
    )
    write_result(args.output, result)

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
