import tempfile
import json
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

    def test_resume_replaces_provisional_summary_and_keeps_failure_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "resume.jsonl"
            first = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            try:
                first.reset(seed=9)
                first.step_native({"type": "advance"})
                first.record_policy_failure({"raw_output": "not json"})
            finally:
                first.close()

            resumed = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            try:
                resumed.resume(seed=9)
                during = [
                    json.loads(line) for line in path.read_text().splitlines() if line
                ]
                self.assertFalse(any(
                    row.get("kind") == "episode-summary" for row in during
                ))
                resumed.step_native({"type": "advance"})
            finally:
                resumed.close()

            records = [
                json.loads(line) for line in path.read_text().splitlines() if line
            ]
            self.assertEqual(
                sum(row.get("kind") == "episode-summary" for row in records), 1
            )
            self.assertEqual(
                sum(row.get("kind") == "policy-failure" for row in records), 1
            )
            self.assertEqual(replay_trajectory(path)["steps"], 2)

    def test_action_labels_cover_engine_surface(self):
        self.assertEqual(len(ACTION_LABELS), 26)
        self.assertIn("advance", ACTION_LABELS)
        self.assertIn("equip", ACTION_LABELS)
        self.assertIn("fillWater", ACTION_LABELS)
        self.assertIn("contact", ACTION_LABELS)

    def test_trajectory_audits_native_action_state_delta_and_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            try:
                recorder.reset(seed=1)
                recorder.step(
                    ACTION_LABELS.index("sell"),
                    policy_decision={"source": "primary_content", "rationale": "cash"},
                )
            finally:
                recorder.close()
            record = json.loads(path.read_text().splitlines()[1])
            self.assertEqual(record["native_action"]["item"], "cooked-food")
            self.assertEqual(record["changes"]["credits_delta"], 40)
            self.assertEqual(record["changes"]["inventory_delta"]["cooked-food"], -1)
            self.assertEqual(record["policy_decision"]["rationale"], "cash")
            self.assertTrue(any(
                message["type"] == "sell"
                for message in record["info"]["messages"]
            ))

    def test_trajectory_records_explicit_actual_energy_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "energy.jsonl"
            recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            try:
                recorder.reset(seed=1)
                recorder.step_native({"type": "equip", "tool": "hoe"}, tool="equip")
                recorder.step_native(
                    {"type": "till", "tileX": 0, "tileY": 0}, tool="till"
                )
            finally:
                recorder.close()
            rows = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(rows[1]["energy"], {
                "before": 100.0, "cost": 0.0, "after": 100.0, "capacity": 100.0,
            })
            self.assertEqual(rows[2]["energy"], {
                "before": 100.0, "cost": 5.0, "after": 95.0, "capacity": 100.0,
            })


if __name__ == "__main__":
    unittest.main()
