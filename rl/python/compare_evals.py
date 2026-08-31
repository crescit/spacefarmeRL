#!/usr/bin/env python3
"""Render comparable Space Farmer model-evaluation reports as Markdown."""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


def mean_std(rows: list[dict[str, Any]], key: str) -> tuple[float, float]:
    values = [float(row[key]) for row in rows if row.get(key) is not None]
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
        "file": source.name,
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
        "latency_episodes": sum(
            row.get("mean_latency_ms") is not None for row in model_episodes
        ),
        "vs_random": reward - random_reward if random_episodes else None,
        "oracle_gap": economic_reward - reward if economic_episodes else None,
        "replay_ok": all(bool(row.get("replay_ok")) for row in model_episodes),
    }


def load_rows(paths: list[Path]) -> list[dict[str, Any]]:
    rows = [
        report_row(json.loads(path.read_text(encoding="utf-8")), path)
        for path in paths
        if path.name != "models.json"  # registry metadata, not a report
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


def load_registry(path: Path | None) -> dict[str, dict[str, Any]]:
    """Read reports/evals/models.json run metadata (validity flags) if present."""
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {key: value for key, value in (data.get("runs") or {}).items()}


def check_validity(
    rows: list[dict[str, Any]],
    registry: dict[str, dict[str, Any]],
    allow_invalid: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split rows into comparable and invalid/archived sets.

    Invalid reports (regardless of archive location) are refused loudly unless
    --allow-invalid is given; the comparable table only ever mixes valid rows.
    """
    valid, invalid = [], []
    for row in rows:
        meta = registry.get(row["file"], {})
        if meta.get("validity") == "invalid" or meta.get("archived"):
            invalid.append(row)
        else:
            valid.append(row)
    if invalid and not allow_invalid:
        names = ", ".join(row["file"] for row in invalid)
        raise ValueError(
            f"refusing invalid/archived evaluation reports (protocol lock); pass "
            f"--allow-invalid to display them flagged instead: {names}"
        )
    return valid, invalid


def metric(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def render_markdown(
    rows: list[dict[str, Any]],
    invalid: list[dict[str, Any]] | None = None,
    registry: dict[str, dict[str, Any]] | None = None,
) -> str:
    invalid = invalid or []
    registry = registry or {}
    if not rows:
        header = "# Space Farmer model leaderboard\n\n*No valid reports on the locked protocol yet.* "
        header += "The pipeline refuses to present invalid/archived runs as comparable.\n"
    else:
        first = rows[0]
        seeds = first["seeds"]
        header = (
            "# Space Farmer model leaderboard\n\n"
            f"Protocol: `{first['action_interface']}` · horizon: "
            f"{first['horizon_days']} days · seeds: {seeds[0]}–{seeds[-1]} "
            f"({len(seeds)} episodes/model)\n"
        )
    lines = [header, ""]
    if rows:
        lines += [
            "| Model | Reward μ±σ | Credits μ±σ | Steps μ | Latency/action | Δ vs random | Gap to oracle | Replay |",
            "|---|---:|---:|---:|---:|---:|---:|:---:|",
        ]
        for row in rows:
            latency = f"{row['latency_ms']:.1f} ms"
            if row["latency_episodes"] != row["episodes"]:
                latency += f" ({row['latency_episodes']}/{row['episodes']} eps)"
            lines.append(
                f"| {row['model']} | {row['reward']:.3f} ± {row['reward_std']:.3f} "
                f"| {row['credits']:.1f} ± {row['credits_std']:.1f} "
                f"| {row['steps']:.1f} | {latency} "
                f"| {metric(row['vs_random'], 3)} | {metric(row['oracle_gap'], 3)} "
                f"| {'✓' if row['replay_ok'] else '✗'} |"
            )
        lines += [
            "",
            "Higher reward and credits are better. “Δ vs random” is model reward minus",
            "the masked-random baseline; “Gap to oracle” is economic-baseline reward",
            "minus model reward. Compare only reports generated with this exact protocol.",
            "",
        ]
    if invalid:
        lines.append("## ⚠ Invalid / archived reports — NOT compared")
        lines.append("")
        lines.append(
            "These reports fail the validity gate (see `models.json`); they are "
            "infrastructure diagnostics, never evidence of model quality:"
        )
        lines.append("")
        lines.append("| Report | Model | Protocol | Reason |")
        lines.append("|---|---|---|---|")
        for row in invalid:
            meta = registry.get(row["file"], {})
            reason = (meta.get("note") or meta.get("validity") or "archived")
            protocol = str(
                meta.get("protocol")
                or row.get("action_interface")
                or "unknown"
            )
            lines.append(
                f"| `{row['file']}` | {row['model']} | `{protocol}` | {reason} |"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--markdown", type=Path, help="also write the table to this file")
    parser.add_argument(
        "--models", type=Path, default=None,
        help="path to models.json (run registry); invalid/archived runs are refused by default",
    )
    parser.add_argument(
        "--allow-invalid", action="store_true",
        help="include invalid/archived reports visibly flagged instead of refusing",
    )
    args = parser.parse_args()
    try:
        rows = load_rows(args.reports)
        valid, invalid = check_validity(rows, load_registry(args.models), args.allow_invalid)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    markdown = render_markdown(valid, invalid, load_registry(args.models))
    print(markdown)
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(markdown, encoding="utf-8")
        print(f"wrote {args.markdown}")


if __name__ == "__main__":
    main()
