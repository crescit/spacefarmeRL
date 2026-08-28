import tempfile
import unittest
from pathlib import Path

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv, SimBridge


class BridgeTests(unittest.TestCase):
    def test_protocol_and_determinism(self):
        script = [
            {"type": "mine"}, {"type": "mine"},
            {"type": "fish", "spot": "stardust"}, {"type": "advance_day"},
        ]
        trajectories = []
        for _ in range(2):
            with SimBridge() as bridge:
                obs, info = bridge.reset(seed=77, horizon_days=8)
                self.assertEqual(info["seed"], 77)
                self.assertEqual(len(obs["farmState"]), 64)
                trajectories.append([bridge.step(action) for action in script])
        self.assertEqual(trajectories[0], trajectories[1])

    def test_checkpoint_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = str(Path(directory) / "checkpoint.json")
            with SimBridge() as bridge:
                bridge.reset(seed=9, horizon_days=8)
                bridge.step({"type": "mine"})
                path = bridge.save(checkpoint)
                expected = bridge.step({"type": "mine"})
                restored, info = bridge.load(path)
                self.assertTrue(info["loaded"])
                actual = bridge.step({"type": "mine"})
                self.assertEqual(expected, actual)
                self.assertEqual(restored["day"], 1)


class GymTests(unittest.TestCase):
    def test_gym_contract_and_masks(self):
        env = FarmGymEnv(horizon_days=4)
        try:
            obs, info = env.reset(seed=42)
            self.assertTrue(env.observation_space.contains(obs))
            self.assertEqual(info["action_mask"].shape, (len(ACTION_LABELS),))
            self.assertEqual(info["action_mask"][-1], 1)
            obs2, reward, terminated, truncated, info2 = env.step(ACTION_LABELS.index("mine"))
            self.assertTrue(env.observation_space.contains(obs2))
            self.assertTrue(np.isfinite(reward))
            self.assertIsInstance(terminated, bool)
            self.assertIsInstance(truncated, bool)
            self.assertEqual(info2["native_action"]["type"], "mine")
        finally:
            env.close()

    def test_water_mask_tracks_watered_tiles(self):
        env = FarmGymEnv(horizon_days=4)
        try:
            env.reset(seed=42)
            env.step(ACTION_LABELS.index("till"))
            env.step(ACTION_LABELS.index("plant"))
            water = ACTION_LABELS.index("water")
            self.assertEqual(env.action_masks()[water], 1)
            _obs, _reward, _terminated, _truncated, info = env.step(water)
            self.assertEqual(env.raw_obs["farmWatered"][0], 1)
            self.assertEqual(info["action_mask"][water], 0)
            env.step(ACTION_LABELS.index("advance_day"))
            self.assertEqual(env.raw_obs["farmWatered"][0], 0)
            self.assertEqual(env.action_masks()[water], 1)
        finally:
            env.close()

    def test_same_seed_same_macro_trajectory(self):
        actions = [6, 6, 5, 13, 6, 4]
        outputs = []
        for _ in range(2):
            env = FarmGymEnv(horizon_days=5)
            try:
                env.reset(seed=123)
                outputs.append([env.step(action)[:4] for action in actions])
            finally:
                env.close()
        for left, right in zip(outputs[0], outputs[1]):
            np.testing.assert_array_equal(left[0], right[0])
            self.assertEqual(left[1:], right[1:])


if __name__ == "__main__":
    unittest.main()
