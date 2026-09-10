"""JSONL trajectory recording and deterministic replay validation."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from rl.python.env_gym import FarmGymEnv, SimBridge


class TrajectoryRecorder:
    def __init__(self, env: FarmGymEnv, path: str | Path, action_interface: str = "energy-grounded-native-strict"):
        self.env = env
        self.path = Path(path)
        self.action_interface = action_interface
        self.handle = None
        self.steps = 0
        self._summary_written = False
        self.last_record: dict[str, Any] | None = None

    def _changes(
        self, before: dict[str, Any], after: dict[str, Any]
    ) -> dict[str, Any]:
        changes: dict[str, Any] = {}
        for key in ("credits", "energy", "day", "waterLevel", "questsCompleted"):
            delta = float(after.get(key, 0)) - float(before.get(key, 0))
            if delta:
                changes[f"{key}_delta"] = delta
        before_inventory = before.get("inventory") or {}
        after_inventory = after.get("inventory") or {}
        inventory_delta = {
            name: int(after_inventory.get(name, 0)) - int(before_inventory.get(name, 0))
            for name in sorted(set(before_inventory) | set(after_inventory))
            if int(after_inventory.get(name, 0)) != int(before_inventory.get(name, 0))
        }
        if inventory_delta:
            changes["inventory_delta"] = inventory_delta
        species = ("chicken", "cow", "sheep")
        animal_delta = {
            name: int(after.get("animals", [0, 0, 0])[index])
            - int(before.get("animals", [0, 0, 0])[index])
            for index, name in enumerate(species)
            if int(after.get("animals", [0, 0, 0])[index])
            != int(before.get("animals", [0, 0, 0])[index])
        }
        if animal_delta:
            changes["animals_delta"] = animal_delta
        return changes

    @staticmethod
    def _energy_budget(before: dict[str, Any], after: dict[str, Any]) -> dict[str, float]:
        energy_before = float(before.get("energy", 0))
        energy_after = float(after.get("energy", 0))
        return {
            "before": energy_before,
            "cost": max(0.0, energy_before - energy_after),
            "after": energy_after,
            "capacity": float(after.get("staminaMax", before.get("staminaMax", 100))),
        }

    def reset(self, *, seed: int, options: dict[str, Any] | None = None):
        obs, info = self.env.reset(seed=seed, options=options)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.handle:
            self.handle.close()
        self.handle = self.path.open("w", encoding="utf-8")
        header = {
            "kind": "space-farmer-trajectory",
            "action_interface": self.action_interface,
            "seed": int(seed),
            "horizon_days": int((options or {}).get("horizon_days", self.env.horizon_days)),
            "initial_observation": self.env.raw_obs,
        }
        self.handle.write(json.dumps(header, separators=(",", ":")) + "\n")
        self.steps = 0
        return obs, info

    def resume(self, *, seed: int):
        """Replay and append to an existing deterministic trajectory."""
        records = [
            json.loads(line)
            for line in self.path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        if not records or records[0].get("kind") != "space-farmer-trajectory":
            raise ValueError(f"cannot resume invalid trajectory: {self.path}")
        header, transitions = records[0], records[1:]
        if (
            int(header.get("seed", -1)) != int(seed)
            or int(header.get("horizon_days", -1)) != self.env.horizon_days
            or header.get("action_interface") != self.action_interface
        ):
            raise ValueError(
                "trajectory seed, horizon, or action interface does not match resume command"
            )
        obs, info = self.env.reset(seed=seed)
        if self.env.raw_obs != header.get("initial_observation"):
            raise AssertionError("trajectory initial observation does not replay")
        transitions = [record for record in records[1:] if not record.get("kind")]
        total_reward = 0.0
        terminated = truncated = False
        for transition in transitions:
            if isinstance(transition.get("action"), int):
                obs, reward, terminated, truncated, info = self.env.step(
                    int(transition["action"])
                )
            else:
                native = transition["native_action"]
                obs, reward, terminated, truncated, info = self.env.native_step(native)
            expected = (
                transition["native_action"], transition["observation"],
                float(transition["reward"]), bool(transition["terminated"]),
                bool(transition["truncated"]),
            )
            actual = (
                info["native_action"], self.env.raw_obs, float(reward),
                bool(terminated), bool(truncated),
            )
            if actual != expected:
                raise AssertionError(
                    f"trajectory diverged at step {transition['step']}"
                )
            total_reward += reward
        # A previous interrupted attempt leaves a provisional narrative summary
        # at EOF. Remove only summaries before appending so the resumed episode
        # gets one authoritative final summary; retain policy-failure audit events.
        preserved = [
            record for record in records
            if record.get("kind") != "episode-summary"
        ]
        self.path.write_text(
            "".join(
                json.dumps(record, separators=(",", ":")) + "\n"
                for record in preserved
            ),
            encoding="utf-8",
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a", encoding="utf-8")
        self.steps = len(transitions)
        return obs, info, total_reward, terminated, truncated

    def record_policy_failure(self, policy_decision: dict[str, Any]) -> None:
        """Audit a model response that produced no executable game action."""
        if self.handle is None:
            raise RuntimeError("reset() must be called before recording a policy failure")
        record = {
            "kind": "policy-failure",
            "step": self.steps,
            "policy_decision": policy_decision,
        }
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.handle.flush()

    def step(self, action: int, *, policy_decision: dict[str, Any] | None = None):
        if self.handle is None:
            raise RuntimeError("reset() must be called before step()")
        before = dict(self.env.raw_obs or {})
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
            "changes": self._changes(before, self.env.raw_obs or {}),
            "energy": self._energy_budget(before, self.env.raw_obs or {}),
            "observation": self.env.raw_obs,
        }
        if policy_decision is not None:
            record["policy_decision"] = policy_decision
        self.last_record = record
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.handle.flush()
        self.steps += 1
        return result

    def step_native(
        self, native: dict[str, Any], *, tool: str | None = None,
        policy_decision: dict[str, Any] | None = None,
    ):
        """Record one native (tool-driven) transition into the trajectory."""
        if self.handle is None:
            raise RuntimeError("reset() must be called before step()")
        before = dict(self.env.raw_obs or {})
        result = self.env.native_step(native)
        _obs, reward, terminated, truncated, info = result
        record = {
            "step": self.steps,
            "action": tool or native.get("type"),
            "native_action": native,
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            "info": {key: value for key, value in info.items() if key != "action_mask"},
            "changes": self._changes(before, self.env.raw_obs or {}),
            "energy": self._energy_budget(before, self.env.raw_obs or {}),
            "observation": self.env.raw_obs,
        }
        if info.get("prose"):
            record["prose"] = info["prose"]
        if policy_decision is not None:
            record["policy_decision"] = policy_decision
        self.last_record = record
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.handle.flush()
        self.steps += 1
        return result

    def close(self) -> None:
        if self.handle:
            self._append_summary()
            self.handle.close()
            self.handle = None
        self.env.close()

    def _append_summary(self) -> None:
        """Append the episode's narrative record (stats + testimony) as a
        terminal non-transition line. replay_trajectory() skips it, so the
        transition byte-stream stays replay-exact while the record survives
        in the same file as the source of truth."""
        if self._summary_written or self.env.raw_obs is None:
            return
        record = {
            "kind": "episode-summary",
            "stats": self.env.narrative_stats(),
            "testimony": self.env.testimony(),
        }
        self.handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.handle.flush()
        self._summary_written = True


def replay_trajectory(path: str | Path) -> dict[str, Any]:
    records = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line]
    if not records or records[0].get("kind") != "space-farmer-trajectory":
        raise ValueError("not a Space Farmer trajectory")
    header, transitions = records[0], records[1:]
    transitions = [record for record in transitions if not record.get("kind")]
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
