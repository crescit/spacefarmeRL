#!/usr/bin/env python3
"""Render comparable Space Farmer model-evaluation reports as Markdown."""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


def mean_std(rows: list[dict[str, Any]], key: str) -> tuple[float, float]:
    values = [float(row[key]) for row in rows]
    if not values:
        return 0.0, 0.0
    return float(statistics.fmean(values)), float(statistics.pstdev(values))


def report_row(report: dict[str, Any], source: Path) -> dict[str, Any]:
    environment = report["environment"]
    episodes = report["episodes"]
    model_episodes = episodes["model"]
    random_episodes = episodes.get("random", [])
    economic_episodes = episodes.get("economic", [])
    reward, reward_std = mean_std(model_episodes, "reward")
    credits, credits_std = mean_std(model_episodes, "credits")
    steps, _steps_std = mean_std(model_episodes, "steps")
    latency, _latency_std = mean_std(model_episodes, "mean_latency_ms")
    random_reward, _ = mean_std(random_episodes, "reward")
    economic_reward, _ = mean_std(economic_episodes, "reward")
    return {
        "source": str(source),
        "model": report["model"]["name"],
        "seeds": tuple(int(seed) for seed in environment["seeds"]),
        "horizon_days": int(environment["horizon_days"]),
        "action_interface": environment["action_interface"],
        "episodes": len(model_episodes),
        "reward": reward,
        "reward_std": reward_std,
        "credits": credits,
        "credits_std": credits_std,
        "steps": steps,
        "latency_ms": latency,
        "vs_random": reward - random_reward if random_episodes else None,
        "oracle_gap": economic_reward - reward if economic_episodes else None,
        "replay_ok": all(bool(row.get("replay_ok")) for row in model_episodes),
    }


def load_rows(paths: list[Path]) -> list[dict[str, Any]]:
    rows = [
        report_row(json.loads(path.read_text(encoding="utf-8")), path)
        for path in paths
    ]
    if not rows:
        raise ValueError("no evaluation reports supplied")
    expected = (
        rows[0]["seeds"], rows[0]["horizon_days"], rows[0]["action_interface"]
    )
    incompatible = [
        row["source"] for row in rows
        if (row["seeds"], row["horizon_days"], row["action_interface"]) != expected
    ]
    if incompatible:
        raise ValueError(
            "reports are not directly comparable; seeds, horizon, and action "
            f"interface must match: {', '.join(incompatible)}"
        )
    return sorted(rows, key=lambda row: (-row["reward"], -row["credits"], row["model"]))


def metric(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def render_markdown(rows: list[dict[str, Any]]) -> str:
    first = rows[0]
    seeds = first["seeds"]
    lines = [
        "# Space Farmer model leaderboard",
        "",
        (
            f"Protocol: `{first['action_interface']}` · horizon: "
            f"{first['horizon_days']} days · seeds: {seeds[0]}–{seeds[-1]} "
            f"({len(seeds)} episodes/model)"
        ),
        "",
        "| Model | Reward μ±σ | Credits μ±σ | Steps μ | Latency/action | Δ vs random | Gap to oracle | Replay |",
        "|---|---:|---:|---:|---:|---:|---:|:---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['model']} | {row['reward']:.3f} ± {row['reward_std']:.3f} "
            f"| {row['credits']:.1f} ± {row['credits_std']:.1f} "
            f"| {row['steps']:.1f} | {row['latency_ms']:.1f} ms "
            f"| {metric(row['vs_random'], 3)} | {metric(row['oracle_gap'], 3)} "
            f"| {'✓' if row['replay_ok'] else '✗'} |"
        )
    lines.extend([
        "",
        "Higher reward and credits are better. “Δ vs random” is model reward minus",
        "the masked-random baseline; “Gap to oracle” is economic-baseline reward",
        "minus model reward. Compare only reports generated with this exact protocol.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--markdown", type=Path, help="also write the table to this file")
    args = parser.parse_args()
    try:
        rows = load_rows(args.reports)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    markdown = render_markdown(rows)
    print(markdown)
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(markdown, encoding="utf-8")
        print(f"wrote {args.markdown}")


if __name__ == "__main__":
    main()
