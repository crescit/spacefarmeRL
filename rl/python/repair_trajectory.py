#!/usr/bin/env python3
"""Rebase recorded model actions onto the current deterministic environment.

This preserves model decisions and timing telemetry while regenerating every
environment-owned field (state, reward, info, deltas, and narrative summary).
It is intended for trajectories interrupted by an environment code change.
"""
from __future__ import annotations

import argparse
import json
import shutil
import statistics
from pathlib import Path
from typing import Any

from rl.python.env_gym import SimBridge
from rl.python.eval_local_model import aggregate, percentile
from rl.python.trajectory import replay_trajectory


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key in ("credits", "energy", "day", "waterLevel", "questsCompleted"):
        delta = float(after.get(key, 0)) - float(before.get(key, 0))
        if delta:
            result[f"{key}_delta"] = delta
    old_inventory = before.get("inventory") or {}
    new_inventory = after.get("inventory") or {}
    inventory_delta = {
        item: int(new_inventory.get(item, 0)) - int(old_inventory.get(item, 0))
        for item in sorted(set(old_inventory) | set(new_inventory))
        if int(new_inventory.get(item, 0)) != int(old_inventory.get(item, 0))
    }
    if inventory_delta:
        result["inventory_delta"] = inventory_delta
    species = ("chicken", "cow", "sheep")
    old_animals = list(before.get("animals") or [0, 0, 0])
    new_animals = list(after.get("animals") or [0, 0, 0])
    animal_delta = {
        name: int(new_animals[index]) - int(old_animals[index])
        for index, name in enumerate(species)
        if int(new_animals[index]) != int(old_animals[index])
    }
    if animal_delta:
        result["animals_delta"] = animal_delta
    return result


def energy_budget(before: dict[str, Any], after: dict[str, Any]) -> dict[str, float]:
    energy_before = float(before.get("energy", 0))
    energy_after = float(after.get("energy", 0))
    return {
        "before": energy_before,
        "cost": max(0.0, energy_before - energy_after),
        "after": energy_after,
        "capacity": float(after.get("staminaMax", before.get("staminaMax", 100))),
    }


def repair(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if not records or records[0].get("kind") != "space-farmer-trajectory":
        raise ValueError(f"not a Space Farmer trajectory: {path}")
    header = records[0]
    original = [row for row in records[1:] if not row.get("kind")]
    audit_events = [
        row for row in records[1:]
        if row.get("kind") and row.get("kind") != "episode-summary"
    ]
    repaired: list[dict[str, Any]] = []
    with SimBridge() as bridge:
        observation, _ = bridge.reset(header["seed"], header["horizon_days"])
        if observation != header["initial_observation"]:
            raise AssertionError(f"current initial observation differs: {path}")
        for old in original:
            before = observation
            observation, reward, terminated, truncated, info = bridge.step(old["native_action"])
            row = dict(old)
            row.update({
                "reward": float(reward),
                "terminated": bool(terminated),
                "truncated": bool(truncated),
                "info": {key: value for key, value in info.items() if key != "action_mask"},
                "changes": changes(before, observation),
                "energy": energy_budget(before, observation),
                "observation": observation,
            })
            if info.get("prose"):
                row["prose"] = info["prose"]
            else:
                row.pop("prose", None)
            repaired.append(row)
        stats = dict(bridge.request({"cmd": "stats"}).get("stats") or {})
        testimony = str(bridge.request({"cmd": "testimony"}).get("testimony", ""))

    summary = {"kind": "episode-summary", "stats": stats, "testimony": testimony}
    candidate = path.with_suffix(path.suffix + ".repairing")
    candidate.write_text(
        "".join(
            json.dumps(row, separators=(",", ":")) + "\n"
            for row in [header, *repaired, *audit_events, summary]
        ),
        encoding="utf-8",
    )
    replay_trajectory(candidate)
    backup = path.with_suffix(path.suffix + ".pre-exchange-fix.bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    candidate.replace(path)
    return repaired[-1]["observation"], stats


def episode_row(path: Path, policy: str) -> dict[str, Any]:
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    transitions = [row for row in records[1:] if not row.get("kind")]
    summary = next(
        row for row in reversed(records[1:])
        if row.get("kind") == "episode-summary"
    )
    decisions = [row["policy_decision"] for row in transitions if row.get("policy_decision")]
    latencies = [float(row["latency_ms"]) for row in decisions if row.get("latency_ms") is not None]
    model_call_latencies: list[float] = []
    for row in decisions:
        if row.get("model_called", True):
            count = max(1, int(row.get("model_call_count", 1)))
            model_call_latencies.extend([float(row["latency_ms"]) / count] * count)
    ttfts = [float(row["ttft_ms"]) for row in decisions if row.get("ttft_ms") is not None]
    stats = summary.get("stats") or {}
    final = transitions[-1]["observation"]
    return {
        "policy": policy,
        "seed": int(records[0]["seed"]),
        "reward": sum(float(row["reward"]) for row in transitions),
        "steps": len(transitions),
        "credits": float(final["credits"]),
        "mean_latency_ms": statistics.fmean(latencies) if latencies else 0.0,
        "p95_latency_ms": percentile(latencies, 0.95),
        "trajectory": str(path),
        "replay_ok": True,
        "capped": not bool(transitions[-1]["terminated"] or transitions[-1]["truncated"]),
        "primary_valid_rate": (sum(bool(row.get("parsed")) and not bool(row.get("retry_used")) for row in decisions) / len(decisions)) if decisions else None,
        "retry_rate": (sum(bool(row.get("retry_used")) for row in decisions) / len(decisions)) if decisions else None,
        "fallback_count": sum(not bool(row.get("parsed")) for row in decisions),
        "model_calls": len(model_call_latencies),
        "mean_model_call_latency_ms": statistics.fmean(model_call_latencies) if model_call_latencies else 0.0,
        "actions_per_model_call": len(decisions) / len(model_call_latencies) if model_call_latencies else None,
        "mean_ttft_ms": statistics.fmean(ttfts) if ttfts else None,
        "days": int(stats.get("daysSurvived", 0)),
        "quests": int(stats.get("questsCompleted", 0)),
        "friendships": float(stats.get("friendshipsTotal", 0.0)),
        "friends_made": int(stats.get("friendsMade", 0)),
        "journal_entries": int(stats.get("journalEntries", 0)),
        "festivals": int(stats.get("festivalsClaimed", 0)),
        "unique_tools": len(stats.get("tools") or []),
        "contacts": int(stats.get("contactsMade", 0)),
        "contact_choices": dict(stats.get("contactChoices") or {}),
        "testimony": str(summary.get("testimony", "")),
    }


def update_report(
    report_path: Path, paths: list[Path], *, finalize_subset: bool = False
) -> None:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    policy = str((report.get("model") or {}).get("name", "model"))
    rows = sorted((episode_row(path, policy) for path in paths), key=lambda row: row["seed"])
    report["episodes"] = {"model": rows}
    report["summary"] = {"model": aggregate(rows)}
    if finalize_subset:
        report.setdefault("environment", {})["seeds"] = [row["seed"] for row in rows]
    report["complete"] = len(rows) == len((report.get("environment") or {}).get("seeds") or [])
    backup = report_path.with_suffix(report_path.suffix + ".pre-exchange-fix.bak")
    if not backup.exists():
        shutil.copy2(report_path, backup)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trajectories", nargs="+", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument(
        "--finalize-subset", action="store_true",
        help="make the supplied trajectory seeds the report's complete seed set",
    )
    args = parser.parse_args()
    for path in args.trajectories:
        final, _stats = repair(path)
        replay = replay_trajectory(path)
        print(f"repaired={path} seed={replay['seed']} steps={replay['steps']} day={final['day']} reward={replay['total_reward']:.3f}")
    if args.report:
        update_report(
            args.report, args.trajectories,
            finalize_subset=args.finalize_subset,
        )
        print(f"report={args.report}")


if __name__ == "__main__":
    main()
