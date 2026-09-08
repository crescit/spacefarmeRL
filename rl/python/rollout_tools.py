#!/usr/bin/env python3
"""Run a tool-calling LLM agent through a season (or a year) on B-612.

The anti-hellscape CLI: the model drives the colony through native function
calls (the same tools MCP and the engine expose), the world talks back in prose,
and every episode becomes a replay-verified trajectory plus a readable
"day in the life" diary. Raw requests/responses are captured to --debug-dir.

    export OPENAI_BASE_URL=http://127.0.0.1:8000/v1
    export OPENAI_API_KEY=sk-local
    export OPENAI_MODEL=qwen38-flash-longctx
    python -m rl.python.rollout_tools --seeds 3 --horizon 1 season --diary out/
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from rl.python.env_gym import FarmGymEnv, SimBridge
from rl.python.llm_policy import ToolDialogPolicy
from rl.python.trajectory import TrajectoryRecorder
from rl.python.transcript import render_html, render_markdown

# No mirrored calendar constants live here. The B-612 calendar is single-sourced
# in shared/calendar.js and surfaced to Python through the bridge `spec`
# handshake (spec.seasonDays + spec.seasons), so '1 season' / '1 year' always
# mean what Node says they mean — flip the knob in Node and this CLI follows.
ACTION_INTERFACE = "native-tools-v1"

_CALENDAR_DIMS: tuple[int, int] | None = None


def calendar_dims() -> tuple[int, int]:
    """Return (season_days, season_count) from the bridge spec — fetched once."""
    global _CALENDAR_DIMS
    if _CALENDAR_DIMS is None:
        with SimBridge() as bridge:
            vocab = (bridge.spec or {}).get("vocabulary") or {}
            season_days = vocab.get("seasonDays")
            seasons = vocab.get("seasons") or []
            if not season_days or not seasons:
                raise RuntimeError(
                    "bridge spec missing calendar (vocabulary.seasonDays/seasons); "
                    "cannot resolve '1 season'/'1 year' — the calendar is Node's source of truth"
                )
            _CALENDAR_DIMS = (int(season_days), len(seasons))
    return _CALENDAR_DIMS


def parse_horizon(value: str) -> int:
    text = str(value).strip().lower()
    if text.startswith("1 season") or text in ("season", "spring", "1s"):
        return calendar_dims()[0]
    if text.startswith("1 year") or text in ("year", "year-on-b-612", "1y"):
        season_days, season_count = calendar_dims()
        return season_days * season_count
    try:
        return int(text)
    except ValueError:
        raise SystemExit(f"bad --horizon: {value!r} (try '1 season', '1 year', or a day count)")


def fetch_tools():
    """The tool schema lives once, in Node — wrap into OpenAI function format.

    Node stores {name, description, parameters} (consumed by MCP + eval too);
    the OpenAI chat API requires {type: 'function', function: {...}} — without
    the wrapper the endpoint 500s with 'Missing tool type'.
    """
    with SimBridge() as bridge:
        raw = bridge.spec.get("tools") or []
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("parameters", {"type": "object", "properties": {}}),
            },
        }
        for t in raw
    ]


def make_policy(args) -> ToolDialogPolicy:
    return ToolDialogPolicy(
        base_url=args.base_url or None, model=args.model or None,
        api_key=args.api_key or None, timeout=args.timeout,
        reasoning_effort=args.reasoning_effort, thinking=args.thinking,
        max_output_tokens=args.max_output_tokens, retries=args.policy_retries,
        tools=fetch_tools(),   # single Node source of truth
        debug_dir=args.debug_dir,
    )


def run_seed(policy: ToolDialogPolicy, seed: int, horizon_days: int,
             traj_dir: Path, *, max_steps: int, diary: Path | None = None):
    env = FarmGymEnv(horizon_days=horizon_days)
    path = traj_dir / f"seed-{seed}.jsonl"
    recorder = TrajectoryRecorder(env, path, action_interface=ACTION_INTERFACE)
    recorder.reset(seed=seed, options={"narrative": True, "horizon_days": horizon_days})
    policy.begin_day(env.briefing())
    steps = 0
    capped = False
    try:
        for _ in range(max_steps):
            started = time.perf_counter()
            native = policy.choose_native(env)
            from_model = native is not None
            if native is None:
                native = {"type": "advance_day"}   # keeper declined to act → the day ends
            _obs, reward, terminated, truncated, info = recorder.step_native(native, tool=native["type"])
            if from_model:
                policy.observe(native, info)
            steps += 1
            ms = (time.perf_counter() - started) * 1000
            print(f"seed={seed} day={env.raw_obs['day']:02d} step={steps:03d} {native['type']:<14} "
                  f"reward={reward:7.3f} latency={ms:7.1f}ms", flush=True)
            if native["type"] in ("advance_day", "rest") and not (terminated or truncated):
                policy.begin_day(env.briefing())
            if terminated or truncated:
                break
        else:
            capped = True
    finally:
        # Capture the record while the env is still alive; close() appends the
        # same summary to the trajectory file as its source-of-truth line.
        if env.raw_obs is not None:
            narrative = env.narrative_stats()
            testimony = env.testimony()
        recorder.close()

    # Diary + validation
    rep = replay(Path(path))
    print(f"seed={seed} done steps={steps} reward={rep['total_reward']:.2f} "
          f"replay={rep['steps'] == steps}{' CAPPED' if capped else ''}")
    print(f"seed={seed} record={narrative.get('daysSurvived', 0)} days · "
          f"{narrative.get('questsCompleted', 0)} quests · "
          f"{narrative.get('friendsMade', 0)} friends · "
          f"{narrative.get('journalEntries', 0)} journal entries · "
          f"{narrative.get('festivalsClaimed', 0)} festivals")
    if diary:
        diary.mkdir(parents=True, exist_ok=True)
        stem = Path(path).stem
        (diary / f"{stem}.md").write_text(render_markdown(path), encoding="utf-8")
        (diary / f"{stem}.html").write_text(render_html(path), encoding="utf-8")
    return {"seed": seed, "steps": steps, "reward": rep["total_reward"],
            "capped": capped, "trajectory": str(path),
            "primary_tool_calls": policy.primary_tool_calls,
            "text_only_turns": policy.text_only_turns,
            "narrative": narrative, "testimony": testimony}


def replay(path: Path) -> dict:
    from rl.python.trajectory import replay_trajectory
    return replay_trajectory(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help="OpenAI-compatible endpoint (default OPENAI_BASE_URL / :8000)")
    parser.add_argument("--model")
    parser.add_argument("--api-key")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--reasoning-effort", choices=("low", "medium", "high", "max", "xhigh"), default="low")
    parser.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--max-output-tokens", type=int, default=1024)
    parser.add_argument("--policy-retries", type=int, default=1)
    parser.add_argument("--seeds", type=int, default=1)
    parser.add_argument("--seed-start", type=int, default=1)
    parser.add_argument("--horizon", default="1 season", help="'1 season' | '1 year' | N days")
    parser.add_argument("--max-steps", type=int, default=5000)
    parser.add_argument("--trajectory-dir", type=Path, default=Path("trajectories/tool-season"))
    parser.add_argument("--diary", type=Path, help="also write Markdown+HTML diaries here")
    parser.add_argument("--debug-dir", type=Path, help="capture raw requests/responses here")
    args = parser.parse_args()

    horizon_days = parse_horizon(args.horizon)
    policy = make_policy(args)
    args.trajectory_dir.mkdir(parents=True, exist_ok=True)
    results = [
        run_seed(policy, seed, horizon_days, args.trajectory_dir,
                 max_steps=args.max_steps, diary=args.diary)
        for seed in range(args.seed_start, args.seed_start + args.seeds)
    ]
    print(json.dumps({"horizon_days": horizon_days, "seeds": results}, indent=2))


if __name__ == "__main__":
    main()
