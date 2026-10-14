"""Baseline gate: the farmer policy must beat the economic policy.

Every model and every previous baseline ends a season with negative reward.
This gate pins the first honest season: the farmer baseline harvests crops and
finishes each episode, and its mean reward beats the economic sell/mine loop on
the same seeds.
"""
from __future__ import annotations

import statistics
import unittest

import numpy as np

from rl.python.benchmark import run_episode


class FarmerBaselineTests(unittest.TestCase):
    SEEDS = (1, 2, 3)

    def test_farmer_finishes_and_beats_economic(self):
        farmer = [run_episode("farmer", seed, 30) for seed in self.SEEDS]
        economic = [run_episode("economic", seed, 30) for seed in self.SEEDS]
        for episode in farmer:
            # each episode finishes inside the safety step limit
            self.assertLess(episode.steps, 2000, f"seed {episode.seed} unfinished")
        farmer_mean = statistics.mean(episode.reward for episode in farmer)
        economic_mean = statistics.mean(episode.reward for episode in economic)
        print(
            f"farmer mean reward {farmer_mean:.3f}  economic mean reward "
            f"{economic_mean:.3f}"
        )
        self.assertGreater(
            farmer_mean, economic_mean,
            f"farmer {farmer_mean:.3f} must beat economic {economic_mean:.3f}",
        )

    def test_farmer_harvests(self):
        episodes = [run_episode("farmer", seed, 30) for seed in self.SEEDS]
        for episode in episodes:
            self.assertGreater(episode.harvests, 0, f"seed {episode.seed} harvested nothing")
        print(f"farmer harvests per season: {', '.join(str(episode.harvests) for episode in episodes)}")


if __name__ == "__main__":
    unittest.main()
