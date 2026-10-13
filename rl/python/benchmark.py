#!/usr/bin/env python3
"""Compare reproducible random and economic baseline policies."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv

ADVANCE = ACTION_LABELS.index("advance")
SELL = ACTION_LABELS.index("sell")
MINE = ACTION_LABELS.index("mine")
HARVEST = ACTION_LABELS.index("harvest")
WATER = ACTION_LABELS.index("water")
PLANT = ACTION_LABELS.index("plant")
TILL = ACTION_LABELS.index("till")
EQUIP = ACTION_LABELS.index("equip")
FILL_WATER = ACTION_LABELS.index("fillWater")

# Harvested crops the farmer baseline sells. Animal products and cooked food
# count too — they are grown/produced on the farm, unlike mined ores.
CROPS = (
    "space-wheat", "star-berry", "moon-melon", "plasma-tomato",
    "nebula-pepper", "glow-kelp", "egg", "milk", "wool", "cooked-food",
)

# equip is allowed once per in-world day per environment (farm work is slow).
_LAST_EQUIP_DAY: dict[int, int] = {}

# Energy-costing farm work keeps the farmer above the low-energy floor (the
# energy-floor shaping penalises energy < 10 and each work action costs 5
# stamina), so harvest/water/plant are held back while energy < WORK_ENERGY_FLOOR
# and the farmer rests instead (advance recovers stamina each night).
WORK_ENERGY_FLOOR = 15


def choose_farmer(env: FarmGymEnv, rng: np.random.Generator, step: int) -> int:
    """Deterministic farming baseline driven only by masks and codec indices."""
    del rng  # the farmer is fully deterministic; rng is kept for interface parity
    mask = env.action_masks()
    obs = env.raw_obs
    inventory = (obs or {}).get("inventory") or {}
    energy = float((obs or {}).get("energy", 0))
    equipped = str((obs or {}).get("equipped", "") or "")
    if mask[HARVEST] and energy >= WORK_ENERGY_FLOOR:
        return HARVEST
    if mask[SELL] and any(int(inventory.get(name, 0)) > 0 for name in CROPS):
        return SELL
    if mask[WATER] and energy >= WORK_ENERGY_FLOOR:
        return WATER
    if mask[PLANT] and energy >= WORK_ENERGY_FLOOR:
        return PLANT
    if mask[TILL] and energy > 30:
        return TILL
    if mask[EQUIP] and env.codec._pick_tool(obs) != equipped:
        state = _LAST_EQUIP_DAY.setdefault(id(env), {})
        day = int((obs or {}).get("day", 0))
        if state.get("day") != day:
            state["day"] = day
            return EQUIP
    if mask[FILL_WATER]:
        return FILL_WATER
    return ADVANCE


@dataclass
class Episode:
    policy: str
    seed: int
    reward: float
    steps: int
    credits: float
    harvests: int = 0


def choose_random(env: FarmGymEnv, rng: np.random.Generator, step: int) -> int:
    valid = np.flatnonzero(env.action_masks())
    return int(rng.choice(valid))


def choose_economic(env: FarmGymEnv, _rng: np.random.Generator, step: int) -> int:
    mask = env.action_masks()
    if mask[SELL]:
        return SELL
    if mask[MINE] and step % 20 < 18:
        return MINE
    return ADVANCE


def run_episode(policy: str, seed: int, horizon_days: int) -> Episode:
    env = FarmGymEnv(horizon_days=horizon_days)
    rng = np.random.default_rng(seed)
    chooser = {
        "random": choose_random,
        "economic": choose_economic,
        "farmer": choose_farmer,
    }[policy]
    try:
        env.reset(seed=seed)
        total = 0.0
        harvests = 0
        for step in range(2000):
            _obs, reward, terminated, truncated, info = env.step(chooser(env, rng, step))
            total += reward
            if info.get("ok") and info.get("type") == "harvest":
                harvests += 1
            if terminated or truncated:
                return Episode(policy, seed, total, step + 1,
                               float(env.raw_obs["credits"]), harvests)
        raise RuntimeError("episode exceeded safety step limit")
    finally:
        env.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--horizon-days", type=int, default=None,
                        help="days per episode (default: one season per Node's calendar)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    episodes = [
        run_episode(policy, seed, args.horizon_days)
        for policy in ("random", "economic", "farmer")
        for seed in range(1, args.seeds + 1)
    ]
    summary = {}
    for policy in ("random", "economic", "farmer"):
        selected = [episode for episode in episodes if episode.policy == policy]
        summary[policy] = {
            "mean_reward": float(np.mean([episode.reward for episode in selected])),
            "mean_credits": float(np.mean([episode.credits for episode in selected])),
            "episodes": [episode.__dict__ for episode in selected],
        }
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print("policy       mean reward    mean credits")
        for policy, values in summary.items():
            print(f"{policy:<12} {values['mean_reward']:>11.3f} {values['mean_credits']:>15.1f}")


if __name__ == "__main__":
    main()
