"""JSONL trajectory recording and deterministic replay validation."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rl.python.env_gym import FarmGymEnv, SimBridge


class TrajectoryRecorder:
    def __init__(self, env: FarmGymEnv, path: str | Path):
        self.env = env
        self.path = Path(path)
        self.handle = None
        self.steps = 0

    def reset(self, *, seed: int, options: dict[str, Any] | None = None):
        obs, info = self.env.reset(seed=seed, options=options)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.handle:
            self.handle.close()
        self.handle = self.path.open("w", encoding="utf-8")
        header = {
            "kind": "space-farmer-trajectory", "version": 1, "seed": int(seed),
            "horizon_days": int((options or {}).get("horizon_days", self.env.horizon_days)),
            "initial_observation": self.env.raw_obs,
        }
        self.handle.write(json.dumps(header, separators=(",", ":")) + "\n")
        self.steps = 0
        return obs, info

    def step(self, action: int):
        if self.handle is None:
            raise RuntimeError("reset() must be called before step()")
        result = self.env.step(action)
        _obs, reward, terminated, truncated, info = result
        record = {
            "step": self.steps,
            "action": int(action),
            "native_action": info["native_action"],
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            "info": {key: value for key, value in info.items() if key != "action_mask"},
            "observation": self.env.raw_obs,
        }
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.handle.flush()
        self.steps += 1
        return result

    def close(self) -> None:
        if self.handle:
            self.handle.close()
            self.handle = None
        self.env.close()


def replay_trajectory(path: str | Path) -> dict[str, Any]:
    records = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line]
    if not records or records[0].get("kind") != "space-farmer-trajectory":
        raise ValueError("not a Space Farmer trajectory")
    header, transitions = records[0], records[1:]
    total_reward = 0.0
    with SimBridge() as bridge:
        initial, _ = bridge.reset(header["seed"], header["horizon_days"])
        if initial != header["initial_observation"]:
            raise AssertionError("initial observation does not replay")
        for transition in transitions:
            obs, reward, terminated, truncated, _info = bridge.step(transition["native_action"])
            expected = (
                transition["observation"], float(transition["reward"]),
                bool(transition["terminated"]), bool(transition["truncated"]),
            )
            actual = (obs, reward, terminated, truncated)
            if actual != expected:
                raise AssertionError(f"trajectory diverged at step {transition['step']}")
            total_reward += reward
    return {"steps": len(transitions), "total_reward": total_reward, "seed": header["seed"]}
