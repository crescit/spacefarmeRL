"""Gymnasium adapter for the authoritative Space Farmer simulation.

The Node process owns all game rules. Python supplies transport, observation
flattening, and a compact 16-action macro codec suitable for starter agents.
Native action dictionaries remain available through SimBridge.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterable, Literal

import gymnasium as gym
import numpy as np
from gymnasium import spaces

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_ENTRY = REPO_ROOT / "rl" / "bridge.cjs"

ACTION_LABELS = (
    "till", "plant", "water", "harvest", "sell", "fish", "mine", "feed",
    "buy_animal", "upgrade_tool", "gift", "talk", "claim_festival",
    "advance_day", "equip", "fill_water",
)
ANIMALS = ("chicken", "cow", "sheep")
TOOLS_ORDER = ("", "hoe", "watering", "pickaxe", "rod")
TIER_VALUE = {"base": 0, "iron": 1, "gold": 2}
TOOL_IDS = ("hoe", "watering", "pickaxe", "rod")
WATER_USE_COST = 20
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

    def reset(self, seed: int = 1, horizon_days: int | None = None, narrative: bool = False):
        if horizon_days is None:
            # Default "one season" comes from Node's calendar (single source of
            # truth, handshaked in the spec): spec.vocabulary.seasonDays.
            horizon_days = int((self.spec.get("vocabulary") or {}).get("seasonDays", 30))
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
    # tool kit: equipped one-hot + per-tool tier + can tank
    equipped = obs.get("equipped", "") or ""
    values.extend(1.0 if equipped == tool_name else 0.0 for tool_name in TOOLS_ORDER)
    tool_tiers = obs.get("toolTiers") or {}
    for tool_name in TOOL_IDS:
        tier = TIER_VALUE.get(str(tool_tiers.get(tool_name, "base")), 0)
        values.append(float(tier) / 2.0)
    values.append(float(obs.get("waterLevel", 100)) / 100.0)
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
    """Map the 16 engine action types to useful, state-aware native actions."""

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
        if action == "equip":
            return {"type": action, "tool": self._pick_tool(obs)}
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

    @staticmethod
    def _pick_tool(obs: dict[str, Any]) -> str:
        """Deterministic tool choice the macro layer uses for the equip action.

        Mirrors the field logic: harvest with hands when crops are ripe, water
        with the can when young crops are thirsty, till with the hoe when soil
        is empty, otherwise mine with the pickaxe.
        """
        equipped = obs.get("equipped", "") or ""
        states = [int(v) for v in (obs.get("farmState") or [])]
        watered = list(obs.get("farmWatered") or [0] * len(states))
        grid = set(states)
        if 4 in grid and equipped != "":
            return ""                                   # ripe crops → bare hands to harvest
        thirsty = any(int(s) in {2, 3} and not bool(w) for s, w in zip(states, watered))
        if thirsty and float(obs.get("waterLevel", 100)) >= WATER_USE_COST and equipped != "watering":
            return "watering"
        if 0 in grid and equipped != "hoe":
            return "hoe"
        if int(obs.get("mineHp", 0)) > 0 and equipped != "pickaxe":
            return "pickaxe"
        if equipped == "":
            return "pickaxe"
        return equipped                                # already holding the right tool

    def mask(self, obs: dict[str, Any]) -> np.ndarray:
        states = [int(v) for v in (obs.get("farmState") or [])]
        watered = list(obs.get("farmWatered") or [0] * len(states))
        grid = set(states)
        energy = float(obs.get("energy", 0))
        equipped = str(obs.get("equipped", "") or "")
        tank = float(obs.get("waterLevel", 100))
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        # farm work is tool-gated: mask each craft off until its tool is in hand
        mask[0] = int(0 in grid and energy > 0 and equipped == "hoe")
        mask[1] = int(1 in grid and self._count(obs, "seeds") > 0 and energy > 0)
        mask[2] = int(
            any(s in {2, 3} and not bool(watered[i]) for i, s in enumerate(states))
            and energy > 0 and equipped == "watering" and tank >= WATER_USE_COST
        )
        mask[3] = int(4 in grid and equipped == "")
        mask[4] = int(any(self._count(obs, name) > 0 for name in SALEABLE))
        mask[5] = int(energy >= 10 and equipped == "rod")
        mask[6] = int(energy >= 5 and equipped == "pickaxe")
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
        mask[14] = 1   # equip is always legal (re-tooling is never wasteful)
        mask[15] = 1   # fill_water is always legal (it only no-ops when full)
        return mask


class FarmGymEnv(gym.Env):
    """Deterministic Gymnasium environment backed by the production rules."""

    metadata = {"render_modes": ["ansi"], "render_fps": 4}

    def __init__(self, horizon_days: int | None = None, render_mode: str | None = None):
        super().__init__()
        self.render_mode = render_mode
        self.bridge = SimBridge()
        self.bridge._start()
        if horizon_days is None:
            # Default "one season" comes from Node's calendar (single source of
            # truth, handshaked in the spec): spec.vocabulary.seasonDays.
            horizon_days = (self.bridge.spec.get("vocabulary") or {}).get("seasonDays")
        if horizon_days is None:
            raise RuntimeError(
                "bridge spec missing calendar vocabulary.seasonDays; refusing to "
                "guess the season length — the calendar is Node's source of truth"
            )
        self.horizon_days = int(horizon_days)
        self.codec = MacroActionCodec(self.bridge.spec["items"])
        self.action_space = spaces.Discrete(len(ACTION_LABELS))
        size = (len(SCALARS) + 1 + len(TOOLS_ORDER) + len(TOOL_IDS) + 1
                + len(self.bridge.spec["items"]) + 64 + 64 + 64 + 3 + 3 + len(FRIENDS))
        self.observation_space = spaces.Box(low=-1.0, high=100.0, shape=(size,), dtype=np.float32)
        self.raw_obs: dict[str, Any] | None = None

    def _info(self, info: dict[str, Any]) -> dict[str, Any]:
        assert self.raw_obs is not None
        return {**info, "action_mask": self.codec.mask(self.raw_obs)}

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        actual_seed = int(seed if seed is not None else self.np_random.integers(0, 2**31 - 1))
        horizon = int((options or {}).get("horizon_days", self.horizon_days))
        narrative = bool((options or {}).get("narrative", False))
        self.raw_obs, info = self.bridge.reset(actual_seed, horizon, narrative=narrative)
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

    def native_step(self, native: dict[str, Any]):
        """Step the authoritative world with one native action (tool-driven).

        No macro codec — the model talks to the world directly, exactly as the
        browser client does (same FarmRoom handlers, same stamina gate, same
        denial semantics).
        """
        if self.raw_obs is None:
            raise RuntimeError("reset() must be called before step()")
        self.raw_obs, reward, terminated, truncated, info = self.bridge.step(native)
        return (
            flatten_observation(self.raw_obs, len(self.codec.items)), reward,
            terminated, truncated, {**info, "native_action": native},
        )

    # ── Narrative accessors: the world speaks through the one Node authority ──
    def briefing(self) -> str:
        return str(self.bridge.request({"cmd": "briefing"}).get("briefing", ""))

    def state_text(self) -> str:
        return str(self.bridge.request({"cmd": "state"}).get("state", ""))

    def inspect_text(self, target: str) -> str:
        return str(self.bridge.request({"cmd": "inspect", "target": target}).get("text", ""))

    def colony_log(self) -> str:
        return str(self.bridge.request({"cmd": "log"}).get("log", ""))

    def write_journal(self, entry: str) -> str:
        return str(self.bridge.request({"cmd": "journal", "entry": str(entry)}).get("reply", ""))

    def journal_text(self) -> str:
        return str(self.bridge.request({"cmd": "journal"}).get("journal", ""))

    def narrative_stats(self) -> dict[str, Any]:
        """The episode's narrative record (Node authority): days survived,
        quests, friendships, ledger tallies, unique tools, journal entries."""
        return dict(self.bridge.request({"cmd": "stats"}).get("stats") or {})

    def testimony(self) -> str:
        """End-of-season reckoning prose — reward-neutral, deterministic."""
        return str(self.bridge.request({"cmd": "testimony"}).get("testimony", ""))

    def action_masks(self) -> np.ndarray:
        if self.raw_obs is None:
            return np.ones(len(ACTION_LABELS), dtype=np.int8)
        return self.codec.mask(self.raw_obs)

    def render(self) -> str | None:
        if self.raw_obs is None:
            return None
        return json.dumps({key: self.raw_obs[key] for key in ("day", "credits", "energy")}, sort_keys=True)

    def __enter__(self) -> "FarmGymEnv":
        return self

    def __exit__(self, *args: object) -> Literal[False]:
        self.close()
        return False

    def close(self) -> None:
        self.bridge.close()
