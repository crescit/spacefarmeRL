"""Parallel Space Farmer environments, one isolated Node simulation per worker."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

import numpy as np

from rl.python.env_gym import FarmGymEnv


class ParallelFarmEnv:
    """Small dependency-free vector runner for rollout collection.

    Each environment owns a separate Node subprocess. Calls are issued through
    threads because the work happens in those child processes, not in Python.
    """

    def __init__(self, num_envs: int, horizon_days: int | None = None):
        if num_envs < 1:
            raise ValueError("num_envs must be positive")
        self.num_envs = int(num_envs)
        self.envs = [FarmGymEnv(horizon_days=horizon_days) for _ in range(self.num_envs)]
        self.pool = ThreadPoolExecutor(max_workers=self.num_envs)

    def reset(self, seeds: Iterable[int] | None = None):
        seed_list = list(seeds if seeds is not None else range(self.num_envs))
        if len(seed_list) != self.num_envs:
            raise ValueError("one seed is required per environment")
        results = list(self.pool.map(lambda pair: pair[0].reset(seed=pair[1]), zip(self.envs, seed_list)))
        observations, infos = zip(*results)
        return np.stack(observations), list(infos)

    def step(self, actions: Iterable[int]):
        action_list = [int(action) for action in actions]
        if len(action_list) != self.num_envs:
            raise ValueError("one action is required per environment")
        results = list(self.pool.map(lambda pair: pair[0].step(pair[1]), zip(self.envs, action_list)))
        observations, rewards, terminated, truncated, infos = zip(*results)
        return (
            np.stack(observations),
            np.asarray(rewards, dtype=np.float32),
            np.asarray(terminated, dtype=np.bool_),
            np.asarray(truncated, dtype=np.bool_),
            list(infos),
        )

    def close(self) -> None:
        for env in self.envs:
            env.close()
        self.pool.shutdown(wait=True)

    def __enter__(self):
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
