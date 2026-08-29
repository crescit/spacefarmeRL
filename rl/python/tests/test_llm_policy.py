import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from rl.python.env_gym import ACTION_LABELS
from rl.python.eval_local_model import (
    ACTION_INTERFACE, ModelEpisode, aggregate, build_result, evaluate_episode,
    load_completed, percentile, recover_capped_episode, write_result,
)
from rl.python.llm_policy import parse_action


class LlmPolicyTests(unittest.TestCase):
    def test_json_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("mine"))

    def test_invalid_action_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance_day")] = 1
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("advance_day"))

    def test_null_content_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance_day")] = 1
        self.assertEqual(parse_action(None, mask), ACTION_LABELS.index("advance_day"))

    def test_numeric_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action_index":5}', mask), 5)

    def test_resume_loads_compatible_completed_seeds(self):
        policy = SimpleNamespace(model="test-model", base_url="http://localhost/v1")
        episode = ModelEpisode(
            policy="test-model", seed=1, reward=2.0, steps=4, credits=120,
            mean_latency_ms=10, p95_latency_ms=15,
            trajectory="seed-1.jsonl", replay_ok=True,
        )
        result = build_result(
            policy, [1, 2], 12, {"model": [episode.__dict__]}, complete=False
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "partial.json"
            write_result(path, result)
            loaded = load_completed(path, policy, [1, 2], 12)
            self.assertEqual([item.seed for item in loaded], [1])
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(saved["complete"])
            self.assertEqual(saved["environment"]["action_interface"], ACTION_INTERFACE)

    def test_max_steps_caps_and_recovers_episode(self):
        policy = SimpleNamespace(
            model="test-model", base_url="http://localhost/v1",
            choose=lambda env: ACTION_LABELS.index("advance_day"),
        )
        with tempfile.TemporaryDirectory() as directory:
            trajectory_dir = Path(directory)
            episode = evaluate_episode(policy, 1, 12, 2, trajectory_dir)
            self.assertTrue(episode.capped)
            self.assertEqual(episode.steps, 2)
            recovered = recover_capped_episode(policy, 1, 12, 2, trajectory_dir)
            self.assertIsNotNone(recovered)
            self.assertTrue(recovered.capped)
            self.assertEqual(recovered.reward, episode.reward)
            self.assertIsNone(recovered.mean_latency_ms)
            continued = evaluate_episode(
                policy, 1, 12, 3, trajectory_dir, resume=True
            )
            self.assertEqual(continued.steps, 3)
            self.assertTrue(continued.capped)
            self.assertIsNone(continued.mean_latency_ms)

    def test_eval_summary_and_percentile(self):
        rows = [
            {"reward": 1.0, "credits": 100, "steps": 4,
             "mean_latency_ms": 10, "p95_latency_ms": 14},
            {"reward": 3.0, "credits": 300, "steps": 8,
             "mean_latency_ms": 20, "p95_latency_ms": 26},
        ]
        summary = aggregate(rows)
        self.assertEqual(summary["mean_reward"], 2.0)
        self.assertEqual(summary["mean_credits"], 200.0)
        self.assertEqual(summary["mean_steps"], 6.0)
        self.assertEqual(summary["mean_latency_ms"], 15.0)
        self.assertEqual(percentile([1, 9, 4, 7], 0.95), 9.0)


if __name__ == "__main__":
    unittest.main()
