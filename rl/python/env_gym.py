"""Gymnasium adapter for the authoritative Space Farmer simulation.

The Node process owns all game rules. Python supplies transport, observation
flattening, and a compact 14-action macro codec suitable for starter agents.
Native action dictionaries remain available through SimBridge.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterable

import gymnasium as gym
import numpy as np
from gymnasium import spaces

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_ENTRY = REPO_ROOT / "rl" / "bridge.cjs"

ACTION_LABELS = (
    "till", "plant", "water", "harvest", "sell", "fish", "mine", "feed",
    "buy_animal", "upgrade_tool", "gift", "talk", "claim_festival",
    "advance_day",
)
ANIMALS = ("chicken", "cow", "sheep")
FRIENDS = ("luna", "zephyr", "vega", "quasar", "rhea", "astra", "orion", "comet")
SALEABLE = (
    "space-wheat", "star-berry", "moon-melon", "plasma-tomato",
    "nebula-pepper", "glow-kelp", "moonfish", "stardust-salmon",
    "comet-trout", "nebula-marlin", "asteroid-dust", "nickel-iron",
    "silicon-carbide", "void-diamond", "egg", "milk", "wool", "cooked-food",
)
SCALARS = (
    "credits", "energy", "staminaMax", "day", "season", "mineHp", "mineMax", "isDay",
    "festival", "festivalClaimed", "tool", "married", "questsCompleted", "arcDone",
)


class SimBridge:
    """Persistent JSON-lines client for rl/bridge.cjs."""

    def __init__(self, node_bin: str = "node", entry: Path | None = None):
        self.node_bin = node_bin
        self.entry = Path(entry or BRIDGE_ENTRY)
        self._proc: subprocess.Popen[str] | None = None
        self.spec: dict[str, Any] = {}

    def _start(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return
        self._proc = subprocess.Popen(
            [self.node_bin, str(self.entry)], cwd=REPO_ROOT,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None,
            text=True, bufsize=1,
        )
        self.spec = self.request({"cmd": "spec"})

    def request(self, command: dict[str, Any]) -> dict[str, Any]:
        self._start()
        assert self._proc and self._proc.stdin and self._proc.stdout
        self._proc.stdin.write(json.dumps(command, separators=(",", ":")) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        # Some optional Node dependencies print a one-line startup banner
        # before our bridge owns stdout. Ignore only those pre-protocol lines.
        while line and not line.lstrip().startswith("{"):
            line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError(f"simulation bridge exited unexpectedly ({self._proc.poll()})")
        result = json.loads(line)
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "unknown simulation error"))
        result.pop("ok", None)
        return result

    def reset(self, seed: int = 1, horizon_days: int = 28, narrative: bool = False):
        result = self.request({"cmd": "reset", "seed": int(seed), "horizonDays": int(horizon_days), "narrative": bool(narrative)})
        return result["obs"], result.get("info", {})

    def step(self, action: dict[str, Any]):
        result = self.request({"cmd": "step", "action": action})
        return (
            result["obs"], float(result["reward"]), bool(result["terminated"]),
            bool(result["truncated"]), dict(result.get("info") or {}),
        )

    def save(self, path: str | None = None) -> str:
        return str(self.request({"cmd": "save", "path": path})["path"])

    def load(self, path: str):
        result = self.request({"cmd": "load", "path": path})
        return result["obs"], result.get("info", {})

    def close(self) -> None:
        if self._proc is None:
            return
        process = self._proc
        if process.poll() is None:
            try:
                self.request({"cmd": "close"})
                process.wait(timeout=2)
            except (BrokenPipeError, RuntimeError, subprocess.TimeoutExpired):
                process.kill()
                process.wait(timeout=2)
        if process.stdin:
            process.stdin.close()
        if process.stdout:
            process.stdout.close()
        self._proc = None

    def __enter__(self):
        self._start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def flatten_observation(obs: dict[str, Any], item_count: int) -> np.ndarray:
    values = [
        float(obs.get("credits", 0)) / 10_000.0,
        float(obs.get("energy", 0)) / 150.0,
        float(obs.get("staminaMax", 100)) / 150.0,
        float(obs.get("day", 0)) / 100.0,
        float(obs.get("season", 0)) / 3.0,
        float(obs.get("mineHp", 0)) / 7.0,
        float(obs.get("mineMax", 0)) / 7.0,
        float(obs.get("isDay", 0)), float(obs.get("festival", 0)),
        float(obs.get("festivalClaimed", 0)), float(obs.get("tool", 0)) / 4.0,
        float(obs.get("married", 0)), float(obs.get("questsCompleted", 0)) / 14.0,
        float(obs.get("arcDone", 0)),
    ]
    goal = obs.get("goalProgress")
    values.append(-1.0 if goal is None else float(goal))
    values.extend(float(v) / 99.0 for v in list(obs.get("inventory") or [])[:item_count])
    values.extend(float(v) / 4.0 for v in list(obs.get("farmState") or [])[:64])
    values.extend(float(v) / 6.0 for v in list(obs.get("farmCrop") or [])[:64])
    values.extend(float(v) for v in list(obs.get("farmWatered") or [])[:64])
    values.extend(float(v) / 10.0 for v in list(obs.get("animals") or [])[:3])
    values.extend(float(v) for v in list(obs.get("animalsFedToday") or [])[:3])
    friendships = obs.get("friendships") or {}
    values.extend(float(friendships.get(name, 0)) / 100.0 for name in FRIENDS)
    return np.clip(np.asarray(values, dtype=np.float32), -1.0, 100.0)


class MacroActionCodec:
    """Map the 14 engine action types to useful, state-aware native actions."""

    def __init__(self, items: Iterable[str]):
        self.items = tuple(items)
        self.item_index = {name: index for index, name in enumerate(self.items)}

    @staticmethod
    def _tile(
        obs: dict[str, Any], states: set[int], *, require_unwatered: bool = False
    ) -> tuple[int, int]:
        grid = list(obs.get("farmState") or [])
        watered = list(obs.get("farmWatered") or [0] * len(grid))
        index = next((
            i for i, state in enumerate(grid)
            if int(state) in states and (not require_unwatered or not bool(watered[i]))
        ), 0)
        return index % 8, index // 8

    def _count(self, obs: dict[str, Any], item: str) -> int:
        inventory = list(obs.get("inventory") or [])
        index = self.item_index.get(item, -1)
        return int(inventory[index]) if 0 <= index < len(inventory) else 0

    def decode(self, label: int, obs: dict[str, Any]) -> dict[str, Any]:
        action = ACTION_LABELS[int(label)]
        if action in {"till", "plant", "water", "harvest"}:
            required = {"till": {0}, "plant": {1}, "water": {2, 3}, "harvest": {4}}[action]
            x, y = self._tile(obs, required, require_unwatered=action == "water")
            native: dict[str, Any] = {"type": action, "tileX": x, "tileY": y}
            if action == "plant":
                crops = {0: "space-wheat", 1: "star-berry", 2: "nebula-pepper", 3: "glow-kelp"}
                native["crop"] = crops.get(int(obs.get("season", 0)), "space-wheat")
            return native
        if action == "sell":
            item = next((name for name in SALEABLE if self._count(obs, name) > 0), "space-wheat")
            return {"type": action, "item": item, "quantity": 1}
        if action == "fish":
            return {"type": action, "spot": "stardust", "night": not bool(obs.get("isDay", 1))}
        if action == "feed":
            counts = list(obs.get("animals") or [0] * len(ANIMALS))
            fed = list(obs.get("animalsFedToday") or [0] * len(ANIMALS))
            index = next((
                i for i, count in enumerate(counts)
                if int(count) > 0 and not bool(fed[i])
            ), 0)
            return {"type": action, "species": ANIMALS[index]}
        if action == "buy_animal":
            return {"type": action, "species": "chicken", "quantity": 1}
        if action == "gift":
            item = next((name for name in self.items if self._count(obs, name) > 0), "weeds")
            return {"type": action, "npc": "rhea", "item": item}
        if action == "talk":
            return {"type": action, "npc": "rhea"}
        return {"type": action}

    def mask(self, obs: dict[str, Any]) -> np.ndarray:
        states = [int(v) for v in (obs.get("farmState") or [])]
        watered = list(obs.get("farmWatered") or [0] * len(states))
        grid = set(states)
        energy = float(obs.get("energy", 0))
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        mask[0] = int(0 in grid and energy > 0)
        mask[1] = int(1 in grid and self._count(obs, "seeds") > 0 and energy > 0)
        mask[2] = int(any(s in {2, 3} and not bool(watered[i]) for i, s in enumerate(states)) and energy > 0)
        mask[3] = int(4 in grid)
        mask[4] = int(any(self._count(obs, name) > 0 for name in SALEABLE))
        mask[5] = int(energy >= 10)
        mask[6] = int(energy >= 5)
        counts = list(obs.get("animals") or [0] * len(ANIMALS))
        fed = list(obs.get("animalsFedToday") or [0] * len(ANIMALS))
        mask[7] = int(any(
            int(count) > 0 and not bool(fed[i]) for i, count in enumerate(counts)
        ))
        mask[8] = int(float(obs.get("credits", 0)) >= 100)
        tool = int(obs.get("tool", 0))
        credits = float(obs.get("credits", 0))
        mask[9] = int((tool == 0 and credits >= 150) or (tool == 1 and credits >= 400))
        mask[10] = int(sum(int(v) for v in (obs.get("inventory") or [])) > 0)
        mask[11] = int(not bool(obs.get("talkedRheaToday", 0)))
        mask[12] = int(bool(obs.get("festival")) and not bool(obs.get("festivalClaimed")))
        mask[13] = 1
        return mask


class FarmGymEnv(gym.Env):
    """Deterministic Gymnasium environment backed by the production rules."""

    metadata = {"render_modes": ["ansi"], "render_fps": 4}

    def __init__(self, horizon_days: int = 28, render_mode: str | None = None):
        super().__init__()
        self.horizon_days = int(horizon_days)
        self.render_mode = render_mode
        self.bridge = SimBridge()
        self.bridge._start()
        self.codec = MacroActionCodec(self.bridge.spec["items"])
        self.action_space = spaces.Discrete(len(ACTION_LABELS))
        size = len(SCALARS) + 1 + len(self.bridge.spec["items"]) + 64 + 64 + 64 + 3 + 3 + len(FRIENDS)
        self.observation_space = spaces.Box(low=-1.0, high=100.0, shape=(size,), dtype=np.float32)
        self.raw_obs: dict[str, Any] | None = None

    def _info(self, info: dict[str, Any]) -> dict[str, Any]:
        assert self.raw_obs is not None
        return {**info, "action_mask": self.codec.mask(self.raw_obs)}

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        actual_seed = int(seed if seed is not None else self.np_random.integers(0, 2**31 - 1))
        horizon = int((options or {}).get("horizon_days", self.horizon_days))
        self.raw_obs, info = self.bridge.reset(actual_seed, horizon)
        return flatten_observation(self.raw_obs, len(self.codec.items)), self._info(info)

    def step(self, action: int):
        if self.raw_obs is None:
            raise RuntimeError("reset() must be called before step()")
        native = self.codec.decode(int(action), self.raw_obs)
        self.raw_obs, reward, terminated, truncated, info = self.bridge.step(native)
        return (
            flatten_observation(self.raw_obs, len(self.codec.items)), reward,
            terminated, truncated, self._info({**info, "native_action": native}),
        )

    def action_masks(self) -> np.ndarray:
        if self.raw_obs is None:
            return np.ones(len(ACTION_LABELS), dtype=np.int8)
        return self.codec.mask(self.raw_obs)

    def render(self) -> str | None:
        if self.raw_obs is None:
            return None
        return json.dumps({key: self.raw_obs[key] for key in ("day", "credits", "energy")}, sort_keys=True)

    def close(self) -> None:
        self.bridge.close()
