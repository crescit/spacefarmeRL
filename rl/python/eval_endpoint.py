#!/usr/bin/env python3
"""Run the locked release evaluation by pointing at one OpenAI-compatible endpoint."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse


RELEASE_REASONING_EFFORT = "low"
RELEASE_TRAJECTORY_PROFILE = "energy-grounded-native-stream"


def evaluation_profile(
    reasoning_effort: str, action_batch_size: int, model_task: str | None = None
) -> str:
    if action_batch_size == 1 and reasoning_effort == RELEASE_REASONING_EFFORT:
        profile = RELEASE_TRAJECTORY_PROFILE
    else:
        profile = f"energy-grounded-native-batch-{action_batch_size}-{reasoning_effort}-stream"
    if model_task:
        profile += f"-{model_task}-task"
    return profile


def normalize_base_url(endpoint: str) -> str:
    value = endpoint.strip()
    if not value:
        raise ValueError("endpoint must not be empty")
    if "://" not in value:
        value = "http://" + value
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"invalid HTTP endpoint: {endpoint!r}")
    path = parsed.path.rstrip("/")
    if not path:
        path = "/v1"
    elif not path.endswith("/v1"):
        path += "/v1"
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def discover_models(base_url: str, api_key: str, timeout: float) -> list[str]:
    request = urllib.request.Request(
        base_url + "/models",
        headers={"Authorization": "Bearer " + api_key},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload: dict[str, Any] = json.load(response)
    return [
        str(row["id"])
        for row in payload.get("data", [])
        if isinstance(row, dict) and row.get("id")
    ]


def choose_model(models: list[str], requested: str | None = None) -> str:
    if requested:
        if models and requested not in models:
            raise ValueError(
                f"model {requested!r} is not served; endpoint advertises {models}"
            )
        return requested
    if len(models) != 1:
        raise ValueError(
            "endpoint must advertise exactly one model for automatic selection; "
            f"found {models or 'none'}"
        )
    return models[0]


def model_slug(model: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", model).strip("-.")
    if not slug:
        raise ValueError(f"model id has no filesystem-safe characters: {model!r}")
    return slug


def build_command(args: argparse.Namespace, base_url: str, model: str) -> list[str]:
    slug = model_slug(model)
    reasoning_effort = getattr(args, "reasoning_effort", RELEASE_REASONING_EFFORT)
    action_batch_size = getattr(args, "action_batch_size", 1)
    model_task = getattr(args, "model_task", "none")
    if model_task == "none":
        model_task = None
    profile = evaluation_profile(reasoning_effort, action_batch_size, model_task)
    output = args.output or Path("reports/evals") / f"{slug}-{profile}.json"
    trajectories = (
        args.trajectory_dir
        or Path("trajectories") / slug / profile
    )
    command = [
        sys.executable, "-m", "rl.python.eval_local_model",
        "--base-url", base_url,
        "--model", model,
        "--seeds", str(args.seeds),
        "--seed-start", str(args.seed_start),
        "--horizon", args.horizon,
        "--workers", str(args.workers),
        "--max-steps", str(args.max_steps),
        "--timeout", str(args.timeout),
        "--no-thinking",
        "--reasoning-effort", reasoning_effort,
        "--max-output-tokens", str(args.max_output_tokens),
        "--policy-retries", str(args.policy_retries),
        "--action-batch-size", str(action_batch_size),
        "--stream",
        "--resume",
        "--output", str(output),
        "--trajectory-dir", str(trajectories),
    ]
    if model_task:
        command.extend(("--model-task", model_task))
    return command


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("endpoint", help="server root or /v1 URL")
    parser.add_argument("--api-key", default=os.getenv("OPENAI_API_KEY", "sk-local"))
    parser.add_argument("--model", help="only needed when /models advertises more than one model")
    parser.add_argument("--seeds", type=int, default=30)
    parser.add_argument("--seed-start", type=int, default=1)
    parser.add_argument("--horizon", default="1 season")
    parser.add_argument("--workers", type=int, default=1,
                        help="default 1 for comparable latency and single-sequence servers")
    parser.add_argument("--max-steps", type=int, default=500)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--max-output-tokens", type=int, default=256)
    parser.add_argument("--policy-retries", type=int, default=1)
    parser.add_argument(
        "--reasoning-effort",
        choices=("low", "medium", "high", "max", "xhigh"),
        default=RELEASE_REASONING_EFFORT,
        help="low is the locked release default; overrides create a separate profile",
    )
    parser.add_argument(
        "--action-batch-size", type=int, default=1,
        help="1 is the locked release default; values above 1 create a batched profile",
    )
    parser.add_argument(
        "--model-task", choices=("none", "action"), default="none",
        help="optional model-native diagnostic hint; release runs use none",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--trajectory-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.action_batch_size < 1:
        parser.error("--action-batch-size must be positive")

    try:
        base_url = normalize_base_url(args.endpoint)
        models = discover_models(base_url, args.api_key, args.timeout)
        model = choose_model(models, args.model)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))

    command = build_command(args, base_url, model)
    print(
        f"endpoint={base_url} model={model} "
        f"effort={args.reasoning_effort} thinking=off stream=on "
        f"batch={args.action_batch_size} model_task={args.model_task} workers={args.workers}"
    )
    print("report=" + command[command.index("--output") + 1])
    if args.dry_run:
        print("command=" + " ".join(command))
        return

    env = {**os.environ, "OPENAI_API_KEY": args.api_key}
    raise SystemExit(subprocess.run(command, env=env, check=False).returncode)


if __name__ == "__main__":
    main()
