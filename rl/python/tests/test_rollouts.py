import tempfile
import unittest
from pathlib import Path

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv
from rl.python.trajectory import TrajectoryRecorder, replay_trajectory
from rl.python.vector_env import ParallelFarmEnv


class RolloutTests(unittest.TestCase):
    def test_parallel_env_shapes(self):
        with ParallelFarmEnv(3, horizon_days=4) as envs:
            obs, infos = envs.reset([11, 12, 13])
            self.assertEqual(obs.shape[0], 3)
            self.assertEqual(len(infos), 3)
            next_obs, rewards, terms, truncs, next_infos = envs.step([6, 6, 6])
            self.assertEqual(next_obs.shape, obs.shape)
            self.assertEqual(rewards.shape, (3,))
            self.assertEqual(terms.shape, (3,))
            self.assertEqual(truncs.shape, (3,))
            self.assertEqual(len(next_infos), 3)

    def test_trajectory_replays_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "episode.jsonl"
            recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            try:
                recorder.reset(seed=55)
                for action in [6, 6, 5, 13, 6, 4]:
                    recorder.step(action)
            finally:
                recorder.close()
            result = replay_trajectory(path)
            self.assertEqual(result["steps"], 6)
            self.assertEqual(result["seed"], 55)

    def test_action_labels_cover_engine_surface(self):
        # 14 original macro actions + equip + fill_water (tool-gated world)
        self.assertEqual(len(ACTION_LABELS), 16)
        self.assertIn("advance_day", ACTION_LABELS)
        self.assertIn("equip", ACTION_LABELS)
        self.assertIn("fill_water", ACTION_LABELS)


if __name__ == "__main__":
    unittest.main()
