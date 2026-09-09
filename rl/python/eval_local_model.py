#!/usr/bin/env python3
"""Evaluate an OpenAI-compatible model policy across deterministic farm seeds."""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from rl.python.benchmark import run_episode
from rl.python.env_gym import FarmGymEnv
from rl.python.llm_policy import OpenAIActionPolicy
from rl.python.rollout_tools import parse_horizon
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
    primary_valid_rate: float | None = None
    retry_rate: float | None = None
    fallback_count: int = 0
    # ── narrative record (report v4: biography, not a bar) ──
    days: int = 0
    quests: int = 0
    friendships: float = 0.0
    friends_made: int = 0
    journal_entries: int = 0
    festivals: int = 0
    unique_tools: int = 0
    testimony: str = ""


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
    primary_valid = retries_used = fallback_count = 0
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
            decision = getattr(policy, "last_decision", None)
            if decision is not None:
                primary_valid += int(decision.parsed and not decision.retry_used)
                retries_used += int(decision.retry_used)
                fallback_count += int(not decision.parsed)
            latencies.append((time.perf_counter() - started) * 1000.0)
            _obs, reward, terminated, truncated, info = recorder.step(action)
            total_reward += reward
            print(
                f"seed={seed} step={recorder.steps:03d} "
                f"day={recorder.env.raw_obs['day']} action={info['type']:<14} "
                f"reward={reward:7.3f} latency={latencies[-1]:7.1f}ms "
                f"decision={getattr(decision, 'source', 'untracked')}"
            )
            if terminated or truncated:
                break
        else:
            capped = True
            print(f"seed={seed} capped=YES max_steps={max_steps}")
        credits = float(recorder.env.raw_obs["credits"])
        steps = recorder.steps
    finally:
        # The episode's narrative record is captured before the env closes —
        # stats/and testimony come from the Node authority, not parsed prose.
        narrative = (
            recorder.env.narrative_stats()
            if recorder.env.raw_obs is not None else {}
        )
        testimony = (
            recorder.env.testimony()
            if recorder.env.raw_obs is not None else ""
        )
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
        primary_valid_rate=(
            None if had_prior_steps or not latencies else primary_valid / len(latencies)
        ),
        retry_rate=(
            None if had_prior_steps or not latencies else retries_used / len(latencies)
        ),
        fallback_count=fallback_count,
        days=int(narrative.get("daysSurvived", 0)),
        quests=int(narrative.get("questsCompleted", 0)),
        friendships=float(narrative.get("friendshipsTotal", 0.0)),
        friends_made=int(narrative.get("friendsMade", 0)),
        journal_entries=int(narrative.get("journalEntries", 0)),
        festivals=int(narrative.get("festivalsClaimed", 0)),
        unique_tools=len(narrative.get("tools") or []),
        testimony=testimony,
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
    transitions = [
        record for record in transitions
        if record.get("kind") != "episode-summary"
    ]
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
    # narrative record (report v4) — only when the report carries the fields
    narrative_keys = {
        "mean_days": "days",
        "mean_quests": "quests",
        "mean_friendships": "friendships",
        "mean_friends": "friends_made",
        "mean_journal_entries": "journal_entries",
        "mean_festivals": "festivals",
        "mean_unique_tools": "unique_tools",
    }
    for label, key in narrative_keys.items():
        if all(key in row for row in episodes):
            result[label] = mean(key)
    latency_rows = [
        row for row in episodes if row.get("mean_latency_ms") is not None
    ]
    decision_rows = [row for row in episodes if row.get("primary_valid_rate") is not None]
    if decision_rows:
        result["mean_primary_valid_rate"] = float(statistics.fmean(
            float(row["primary_valid_rate"]) for row in decision_rows
        ))
        result["mean_retry_rate"] = float(statistics.fmean(
            float(row["retry_rate"]) for row in decision_rows
        ))
        result["fallback_count"] = float(sum(
            int(row.get("fallback_count", 0)) for row in decision_rows
        ))
    if latency_rows:
        result["mean_latency_ms"] = float(statistics.fmean(
            float(row["mean_latency_ms"]) for row in latency_rows
        ))
        result["p95_episode_latency_ms"] = percentile(
            [float(row["p95_latency_ms"]) for row in latency_rows], 0.95
        )
        result["latency_episodes"] = float(len(latency_rows))
    return result


DEFAULT_PARSE_FLOOR = 0.8
DEFAULT_FALLBACK_CEILING = 0.1


def validate_runtime_quality(
    episodes: list[ModelEpisode],
    *,
    parse_floor: float = DEFAULT_PARSE_FLOOR,
    fallback_ceiling: float = DEFAULT_FALLBACK_CEILING,
    allow_capped: int = 0,
) -> None:
    """W4 validity gate: a trustworthy report XOR a loud refusal.

    Raises ValueError listing every offending episode when a run's decision
    quality cannot support a valid report: model output parsed on the primary
    attempt below ``parse_floor``, unparsed (fallback) steps above
    ``fallback_ceiling`` of the episode, or silent capping past max_steps.

    Episodes recovered on resume carry no decision telemetry
    (``primary_valid_rate`` is None) and are exempt — they were already
    replay-validated on adoption; they cannot be re-gated.
    """
    offenders: list[str] = []
    capped = 0
    for episode in episodes:
        if episode.primary_valid_rate is None:
            continue  # recovered/untracked — no validity signal to gate on
        if episode.capped:
            capped += 1
            offenders.append(f"seed={episode.seed}: hit max_steps without terminating")
            continue
        if episode.primary_valid_rate < parse_floor:
            offenders.append(
                f"seed={episode.seed}: primary_valid_rate="
                f"{episode.primary_valid_rate:.3f} < {parse_floor}"
            )
        fallback = episode.fallback_count / max(1, episode.steps)
        if fallback > fallback_ceiling:
            offenders.append(
                f"seed={episode.seed}: fallback_ratio={fallback:.3f} > {fallback_ceiling}"
            )
    if capped > allow_capped:
        offenders.append(f"{capped} capped episode(s) exceed allow_capped={allow_capped}")
    if offenders:
        raise ValueError(
            "validity gate refused — this run produced no trustworthy report; "
            + "; ".join(offenders)
        )


ACTION_INTERFACE = "masked-macro-v3-strict"


def build_result(
    policy: OpenAIActionPolicy,
    seeds: list[int],
    horizon_days: int,
    policies: dict[str, list[dict[str, Any]]],
    *,
    complete: bool,
) -> dict[str, Any]:
    return {
        "report_version": 4,
        "schema_version": 2,
        "complete": complete,
        "environment": {
            "horizon_days": horizon_days,
            "seeds": seeds,
            "action_interface": ACTION_INTERFACE,
        },
        "model": {
            "name": policy.model, "base_url": policy.base_url,
            "reasoning_effort": getattr(policy, "reasoning_effort", "max"),
            "thinking": getattr(policy, "thinking", False),
            "max_output_tokens": getattr(policy, "max_output_tokens", 512),
            "policy_retries": getattr(policy, "retries", 1),
        },
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
    saved_model = saved.get("model") or {}
    expected_model = {
        "name": policy.model,
        "reasoning_effort": policy.reasoning_effort,
        "thinking": policy.thinking,
        "max_output_tokens": policy.max_output_tokens,
        "policy_retries": policy.retries,
    }
    actual_model = {key: saved_model.get(key) for key in expected_model}
    if actual != expected or actual_model != expected_model:
        raise ValueError(
            "resume report does not match model, reasoning settings, seeds, horizon, or action interface"
        )
    return [
        ModelEpisode(**row) for row in (saved.get("episodes") or {}).get("model", [])
    ]


def make_policy(args: argparse.Namespace) -> OpenAIActionPolicy:
    """Each worker gets its own policy instance — urllib/chat state stays local."""
    return OpenAIActionPolicy(
        args.base_url, args.model, args.api_key, timeout=args.timeout,
        reasoning_effort=args.reasoning_effort, thinking=args.thinking,
        max_output_tokens=args.max_output_tokens, retries=args.policy_retries,
    )


def evaluate_seeds(
    args: argparse.Namespace,
    seeds: list[int],
    trajectory_dir: Path,
    completed: set[int],
    *,
    policy_factory=None,
) -> list[ModelEpisode]:
    """Run every missing seed, sequentially or across --workers threads.

    Each completed seed is checkpointed to the partial report immediately
    (resume-safe after Ctrl-C or an endpoint outage), exactly as the serial
    runner already did — just faster for 30-season release runs.
    ``policy_factory`` is injectable so tests can substitute a stub policy.
    """
    if policy_factory is None:
        policy_factory = lambda: make_policy(args)
    missing = [seed for seed in seeds if seed not in completed]
    found: dict[int, ModelEpisode] = {}

    def work(seed: int) -> tuple[int, ModelEpisode | None]:
        if args.resume:
            episode = recover_capped_episode(
                policy_factory(), seed, args.horizon_days,
                args.max_steps, trajectory_dir,
            )
            if episode is not None:
                print(f"seed={seed} resume=RECOVER capped trajectory={episode.trajectory}")
                return seed, episode
        episode = evaluate_episode(
            policy_factory(), seed, args.horizon_days, args.max_steps,
            trajectory_dir, resume=args.resume,
        )
        return seed, episode

    def checkpoint(seed: int) -> None:
        episodes = sorted(found.values(), key=lambda item: item.seed)
        partial = {"model": [asdict(item) for item in episodes]}
        write_result(
            args.output,
            build_result(make_policy(args), seeds, args.horizon_days, partial, complete=False),
        )
        print(f"checkpoint={args.output} completed_seed={seed}")

    if args.workers == 1:
        for seed in missing:
            _seed, episode = work(seed)
            assert episode is not None
            found[seed] = episode
            checkpoint(seed)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(work, seed): seed for seed in missing}
            try:
                for future in as_completed(futures):
                    seed, episode = future.result()
                    if episode is not None:
                        found[seed] = episode
                    checkpoint(seed)
            except (urllib.error.URLError, TimeoutError) as exc:
                pool.shutdown(wait=False, cancel_futures=True)
                raise
    return [found[seed] for seed in seeds if seed in found]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate a local chat model against deterministic Space Farmer seeds."
    )
    parser.add_argument("--base-url")
    parser.add_argument("--model")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=float, default=30.0, help="request timeout in seconds")
    parser.add_argument(
        "--reasoning-effort", choices=("low", "medium", "high", "max", "xhigh"),
        default="max", help="reasoning effort sent to the chat template",
    )
    parser.add_argument(
        "--thinking", action=argparse.BooleanOptionalAction, default=False,
        help="explicitly enable or disable model thinking",
    )
    parser.add_argument("--max-output-tokens", type=int, default=4096)
    parser.add_argument("--policy-retries", type=int, default=1)
    parser.add_argument("--seeds", type=int, default=5, help="number of seeds")
    parser.add_argument("--seed-start", type=int, default=1)
    parser.add_argument(
        "--horizon", default=None,
        help="'1 season' | '1 year' | N days (single-source B-612 calendar); "
             "overrides --horizon-days",
    )
    parser.add_argument(
        "--horizon-days", type=int, default=None,
        help="days per episode (default: one season per Node's calendar)",
    )
    parser.add_argument(
        "--workers", type=int, default=1,
        help="parallel seeds; each worker runs its own env + policy (default 1)",
    )
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
    if args.workers < 1:
        parser.error("--workers must be positive")
    if args.horizon is not None:
        args.horizon_days = parse_horizon(args.horizon)
    if args.horizon_days is None:
        args.horizon_days = parse_horizon("1 season")

    policy = make_policy(args)
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
        f"horizon={args.horizon_days} workers={args.workers} resume={sorted(completed)}"
    )

    try:
        new_episodes = evaluate_seeds(
            args, seeds, args.trajectory_dir, completed
        )
        seen = {episode.seed for episode in model_episodes}
        model_episodes.extend(
            episode for episode in new_episodes if episode.seed not in seen
        )
        model_episodes.sort(key=lambda item: item.seed)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SystemExit(
            f"Model endpoint unavailable at {policy.base_url}: {exc}\n"
            "Restart with --resume after the endpoint is healthy."
        ) from exc

    # W4 validity gate: a trustworthy report XOR a loud refusal. A run whose
    # model decisions never parsed (or that silently capped) is diagnostic data,
    # not model evidence — refuse before a complete report is written.
    try:
        validate_runtime_quality(model_episodes)
    except ValueError as exc:
        raise SystemExit(f"validity-gate refused: {exc}") from exc

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
    if "model" in result["summary"]:
        narrative = result["summary"]["model"]
        print(
            f"narrative (30-season report v4): {narrative['mean_days']:.0f} days survived · "
            f"{narrative['mean_quests']:.1f} quests · {narrative['mean_friends']:.1f} friends · "
            f"{narrative['mean_journal_entries']:.1f} journal entries · "
            f"{narrative['mean_festivals']:.1f} festivals · {narrative['mean_unique_tools']:.1f} tools"
        )
    print(f"\nreport={args.output}")
    print(f"trajectories={args.trajectory_dir} replay=OK")


if __name__ == "__main__":
    main()
